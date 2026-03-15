//--------------------------------------------------------------
// FILE: src/core/pipeline.ts
// Continuum Adaptive Parser – Full Memory Pipeline
// FIXED: Actually write human_blocks.json!
//--------------------------------------------------------------

import fs from "fs";
import path from "path";
import { readFile } from "fs/promises";
import mammoth from "mammoth";
// pdf-parse loaded dynamically due to CommonJS/ESM interop issues
let pdfParser: (dataBuffer: Buffer) => Promise<{ text: string }>;
async function getPdfParser(): Promise<(dataBuffer: Buffer) => Promise<{ text: string }>> {
  if (!pdfParser) {
    const module = await import("pdf-parse");
    pdfParser = (module as any).default || module;
  }
  return pdfParser;
}

import {
  ExportRoot,
  MappingNode,
  PersonaBlock,
  ArchivalMemoryItem,
  DiscoveryMeta,
} from "../types/memory.js";

import { ConversationThread } from "../types/threads.js";

import { runDiscovery } from "../discovery/discoveryPass.js";
import { runExtraction } from "../extraction/extractionPass.js";
import { processThreadsConcurrently } from "./threads.js";
import { dedupeBlocks, dedupeArchivalBlocks } from "./postprocess.js";

//--------------------------------------------------------------
// GROK EXPORT CONVERSION
//--------------------------------------------------------------

interface GrokResponse {
  response: {
    _id: string;
    conversation_id: string;
    message: string;
    sender: "human" | "assistant";
    create_time: { $date: { $numberLong: string } };
    parent_response_id: string | null;
    model?: string;
  };
}

interface GrokConversation {
  conversation: {
    id: string;
    title: string;
    create_time: string;
  };
  responses: GrokResponse[];
}

interface GrokExport {
  conversations: GrokConversation[];
}

function isGrokExport(parsed: any): parsed is GrokExport {
  return (
    parsed &&
    Array.isArray(parsed.conversations) &&
    parsed.conversations.length > 0 &&
    parsed.conversations[0].responses !== undefined
  );
}

function convertGrokToExportRoot(grok: GrokExport): ExportRoot {
  const mapping: Record<string, MappingNode> = {};

  for (const convo of grok.conversations) {
    for (const resp of convo.responses) {
      const r = resp.response;
      const id = r._id;

      // Parse the MongoDB-style timestamp
      let createTime: number | null = null;
      if (r.create_time?.$date?.$numberLong) {
        createTime = parseInt(r.create_time.$date.$numberLong, 10) / 1000; // Convert ms to seconds
      }

      // Map sender to role
      const role = r.sender === "human" ? "user" : "assistant";

      // Find children (responses that have this as parent)
      const children = convo.responses
        .filter(other => other.response.parent_response_id === id)
        .map(other => other.response._id);

      mapping[id] = {
        id,
        parent: r.parent_response_id,
        children,
        message: {
          id,
          author: { role },
          content: {
            content_type: "text",
            parts: [r.message || ""],
          },
          create_time: createTime,
          metadata: {
            model: r.model,
            conversation_id: r.conversation_id,
            conversation_title: convo.conversation.title,
          },
        },
      };
    }
  }

  return { mapping };
}

//--------------------------------------------------------------
// CLAUDE.AI EXPORT CONVERSION
//--------------------------------------------------------------

interface ClaudeContentBlock {
  type: string;
  text: string;
  start_timestamp?: string;
  stop_timestamp?: string;
  flags?: any;
  citations?: any[];
}

interface ClaudeMessage {
  uuid: string;
  text: string;
  content: ClaudeContentBlock[];
  sender: "human" | "assistant";
  created_at: string;
  updated_at: string;
  attachments: any[];
  files: any[];
}

interface ClaudeConversation {
  uuid: string;
  name: string;
  summary?: string;
  created_at: string;
  updated_at: string;
  account: { uuid: string };
  chat_messages: ClaudeMessage[];
}

function isClaudeExport(parsed: any): parsed is ClaudeConversation[] {
  return (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed[0].chat_messages !== undefined &&
    parsed[0].uuid !== undefined
  );
}

function convertClaudeToExportRoot(conversations: ClaudeConversation[]): ExportRoot {
  const mapping: Record<string, MappingNode> = {};

  for (const convo of conversations) {
    let prevId: string | null = null;

    for (const msg of convo.chat_messages) {
      const id = msg.uuid;

      // Extract text from content blocks (type=text) or fall back to top-level text field
      const text =
        msg.content
          ?.filter(c => c.type === "text")
          .map(c => c.text)
          .join("\n")
          .trim() ||
        msg.text ||
        "";

      const role = msg.sender === "human" ? "user" : "assistant";
      const createTime = new Date(msg.created_at).getTime() / 1000;

      // Update previous node's children list
      if (prevId && mapping[prevId]) {
        mapping[prevId].children.push(id);
      }

      mapping[id] = {
        id,
        parent: prevId,
        children: [],
        message: {
          id,
          author: { role },
          content: {
            content_type: "text",
            parts: [text],
          },
          create_time: createTime,
          metadata: {
            conversation_id: convo.uuid,
            conversation_title: convo.name || "",
          },
        },
      };

      prevId = id;
    }
  }

  return { mapping };
}

//--------------------------------------------------------------
// FILE TEXT EXTRACTION HELPERS
//--------------------------------------------------------------

async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    // Plain text and Markdown - read verbatim
    return await readFile(filePath, "utf8");
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else if (ext === ".pdf") {
    // PDF extraction
    const dataBuffer = await readFile(filePath);
    const pdf = await getPdfParser();
    const pdfData = await pdf(dataBuffer);
    return pdfData.text;
  } else if (ext === ".doc") {
    // .doc (old binary format) - try to read as text first, may not work perfectly
    try {
      return await readFile(filePath, "utf8");
    } catch {
      throw new Error(`.doc file format not fully supported. Please convert ${filePath} to .docx or .txt`);
    }
  } else {
    // Try to read as text for other files
    return await readFile(filePath, "utf8");
  }
}

//--------------------------------------------------------------
// TEXT DOCUMENT TO MAPPING CONVERSION
// Preserves content verbatim, line by line
// Uses "document" role so content goes ONLY to archival_memories
// (skips persona_blocks and human_blocks)
//--------------------------------------------------------------

/**
 * Detect whether a file's content belongs to the assistant or
 * the human user based on filename patterns.
 *
 * Uses ASSISTANT_NAME and USER_NAME env vars (comma-separated for aliases).
 * Example:  ASSISTANT_NAME=ari
 *           USER_NAME=lauren,lor
 *
 * Falls back to "document" for unrecognized files (archival only).
 */
function detectRoleFromFilename(filePath: string): string {
  const name = path.basename(filePath).toLowerCase();

  const assistantNames = (process.env.ASSISTANT_NAME || "")
    .split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
  const userNames = (process.env.USER_NAME || "")
    .split(",").map(n => n.trim().toLowerCase()).filter(Boolean);

  // Build a regex that matches any of the names as a "word" in the filename
  // (separated by start/end, spaces, underscores, hyphens, or dots)
  function matchesAny(names: string[]): boolean {
    for (const n of names) {
      const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[\\s_\\-])${escaped}s?(?:[\\s_\\-.]|$)`);
      if (re.test(name)) return true;
    }
    return false;
  }

  if (assistantNames.length && matchesAny(assistantNames)) return "assistant";
  if (userNames.length && matchesAny(userNames)) return "user";

  return "document";
}

/**
 * Split text into paragraph-level chunks instead of individual lines.
 * For markdown, standalone headers are merged with the following paragraph
 * so context isn't lost.
 */
function chunkIntoParagraphs(text: string): string[] {
  const rawChunks = text.split(/\n\s*\n/);
  const chunks: string[] = [];

  let pendingHeader = "";

  for (const raw of rawChunks) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // If this is a lone markdown header, merge it with the next chunk
    if (/^#{1,6}\s+/.test(trimmed) && !trimmed.includes('\n')) {
      pendingHeader = trimmed;
      continue;
    }

    if (pendingHeader) {
      chunks.push(`${pendingHeader}\n\n${trimmed}`);
      pendingHeader = "";
    } else {
      chunks.push(trimmed);
    }
  }

  // Don't lose a trailing header with no body
  if (pendingHeader) {
    chunks.push(pendingHeader);
  }

  return chunks;
}

// Max characters of document content per embedding chunk.
// Leave headroom below the embedder's 8000-char truncation limit
// so the [Source: ...] prefix never pushes a chunk over the edge.
const CHUNK_CHAR_LIMIT = parseInt(process.env.CHUNK_CHAR_LIMIT || "6000", 10);

/**
 * Split text into chunks that never exceed CHUNK_CHAR_LIMIT characters,
 * always breaking at a line boundary so no line is ever split mid-way.
 * Each returned string already includes the "[Source: …] [Part X of Y]" header.
 */
function chunkTextByLines(text: string, fileName: string): string[] {
  const lines = text.split("\n");
  const rawChunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    const lineLen = line.length + 1; // +1 for the newline we'll rejoin with

    // If this single line is itself larger than the limit, force-flush then add it alone
    if (currentLen + lineLen > CHUNK_CHAR_LIMIT && current.length > 0) {
      rawChunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }

    current.push(line);
    currentLen += lineLen;
  }

  if (current.length > 0) {
    rawChunks.push(current.join("\n"));
  }

  const total = rawChunks.length;
  return rawChunks.map((chunk, i) => {
    const partLabel = total > 1 ? ` [Part ${i + 1} of ${total}]` : "";
    return `[Source: ${fileName}]${partLabel}\n\n${chunk.trim()}`;
  });
}

function convertTextToExportRoot(text: string, sourceFile: string): ExportRoot {
  const mapping: Record<string, MappingNode> = {};
  const fileName = path.basename(sourceFile);
  const role = detectRoleFromFilename(sourceFile);
  const now = Date.now() / 1000;
  const baseId = `doc_${fileName.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}`;

  const chunks = chunkTextByLines(text.trim(), fileName);

  for (let i = 0; i < chunks.length; i++) {
    const docId = chunks.length > 1 ? `${baseId}_p${i + 1}` : baseId;
    mapping[docId] = {
      id: docId,
      parent: null,
      children: [],
      message: {
        id: docId,
        author: { role },
        content: {
          content_type: "text",
          parts: [chunks[i]],
        },
        create_time: now,
        metadata: {
          source_file: fileName,
          source_type: "document",
          chunk_index: i + 1,
          chunk_total: chunks.length,
        },
      },
    };
  }

  const roleLabel = role === "assistant" ? "→ persona blocks"
                  : role === "user"      ? "→ human blocks"
                  :                        "→ archival only";
  const chunkNote = chunks.length > 1 ? ` (${chunks.length} chunks)` : "";
  console.log(`   📄 Loaded ${fileName}: ${chunks.length} chunk${chunks.length > 1 ? "s" : ""} (${roleLabel})${chunkNote}`);

  return { mapping };
}

async function loadFileAsExport(filePath: string): Promise<ExportRoot | null> {
  const ext = path.extname(filePath).toLowerCase();

  try {
    const text = await extractTextFromFile(filePath);

    // For JSON files, try to parse as structured data first
    if (ext === ".json") {
      try {
        const parsed = JSON.parse(text);

        // Grok export format (conversations with responses)
        if (isGrokExport(parsed)) {
          console.log(`   🔄 Detected Grok export format, converting...`);
          return convertGrokToExportRoot(parsed);
        }

        // Claude.ai export format (array with chat_messages)
        if (isClaudeExport(parsed)) {
          console.log(`   🔄 Detected Claude.ai export format, converting...`);
          return convertClaudeToExportRoot(parsed);
        }

        // ChatGPT export array (multiple conversations with mapping)
        if (Array.isArray(parsed)) {
          const merged: Record<string, MappingNode> = {};
          for (const convo of parsed) {
            if (convo && convo.mapping) Object.assign(merged, convo.mapping);
          }
          return { mapping: merged };
        }

        // Normal export with mapping
        if (parsed.mapping) {
          return parsed as ExportRoot;
        }

        // JSON without recognized structure - treat as text document
        console.log(`   📄 JSON without mapping structure, treating as text document...`);
        return convertTextToExportRoot(text, filePath);
      } catch {
        // Invalid JSON - treat as text
        console.log(`   📄 Invalid JSON, treating as text document...`);
        return convertTextToExportRoot(text, filePath);
      }
    }

    // For text documents (txt, md, pdf, docx, doc) - preserve verbatim
    if ([".txt", ".md", ".pdf", ".docx", ".doc"].includes(ext)) {
      return convertTextToExportRoot(text, filePath);
    }

    // Unknown extension - try as text
    return convertTextToExportRoot(text, filePath);
  } catch (err) {
    // File read error
    console.warn(`Warning: Could not read file ${filePath}: ${err}`);
    return null;
  }
}

//--------------------------------------------------------------
// LOAD EXPORT (JSON OR FOLDER)
//--------------------------------------------------------------

export async function loadExport(filePath: string): Promise<ExportRoot> {
  const stats = fs.statSync(filePath);

  // Folder of documents → combine into one mapping
  if (stats.isDirectory()) {
    const merged: Record<string, MappingNode> = {};
    const files = fs.readdirSync(filePath);

    // Process conversations.json first if it exists
    const conversationsJsonPath = path.join(filePath, "conversations.json");
    if (fs.existsSync(conversationsJsonPath)) {
      const root = await loadFileAsExport(conversationsJsonPath);
      if (root && root.mapping) {
        Object.assign(merged, root.mapping);
      }
    }

    // Process other files (.txt, .md, .pdf, .doc, .docx, and other JSON files)
    for (const f of files) {
      // Skip conversations.json as we already processed it
      if (f === "conversations.json") continue;

      const p = path.join(filePath, f);
      const ext = path.extname(f).toLowerCase();

      // Process supported file types
      const supportedExtensions = [".txt", ".md", ".pdf", ".doc", ".docx", ".json"];
      if (supportedExtensions.includes(ext)) {
        const root = await loadFileAsExport(p);
        if (root && root.mapping) {
          Object.assign(merged, root.mapping);
        }
      }
    }

    return { mapping: merged };
  }

  // Single file - try to load it
  const root = await loadFileAsExport(filePath);
  if (root) {
    return root;
  }

  throw new Error(`Unrecognized export format in ${filePath}`);
}

//--------------------------------------------------------------
// THREAD EXTRACTION
//--------------------------------------------------------------

export function extractThreads(root: ExportRoot): ConversationThread[] {
  const mapping = root.mapping;
  const visited = new Set<string>();
  const threads: ConversationThread[] = [];

  const roots = Object.values(mapping).filter(
    node => !node.parent || !mapping[node.parent]
  );

  // Iterative walk using stack (avoids recursion stack overflow)
  function walkIterative(startId: string): MappingNode[] {
    const out: MappingNode[] = [];
    const stack: string[] = [startId];

    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const n = mapping[id];
      if (!n) continue;

      out.push(n);

      // Add children to stack in reverse order to maintain traversal order
      const children = n.children || [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }

    return out;
  }

  for (const r of roots) {
    const msgs = walkIterative(r.id);

    // Iterative sum to avoid potential issues with very long arrays
    let total = 0;
    for (const x of msgs) {
      total += x.message?.weight || 1;
    }
    const avg = msgs.length ? total / msgs.length : 1;

    threads.push({
      id: r.id,
      messages: msgs,
      weight: avg,
    });
  }

  return threads;
}

//--------------------------------------------------------------
// FULL PIPELINE
//--------------------------------------------------------------

export async function runFullPipeline(
  root: ExportRoot,
  options: {
    mode: "accurate" | "fast";
    goblin: boolean;
    onProgress?: (phase: string, progress: number) => void;
  }
) {
  const report = options.onProgress ?? (() => {});

  // ---------------------------
  // 1) Discovery pass
  // ---------------------------

  report("Analyzing content...", 10);
  const discovery: DiscoveryMeta = runDiscovery(root);

  // ---------------------------
  // 2) Thread extraction
  // ---------------------------

  report("Splitting conversation threads...", 20);
  const threads = extractThreads(root);

  const personaBlocks: any[] = [];
  const humanBlocks: any[] = [];
  const archivalMemories: any[] = [];

  // ---------------------------
  // 3) Run per-thread extraction
  // ---------------------------

  report(`Extracting memories from ${threads.length} threads...`, 25);
  await processThreadsConcurrently(
    threads,
    options,
    personaBlocks,
    humanBlocks,
    archivalMemories
  );

  // ---------------------------
  // 4) Merge + Dedupe
  // ---------------------------

  report("Deduplicating memories...", 55);
  const dedupedPersona = dedupeBlocks(personaBlocks, options.mode);
  const dedupedHuman = dedupeBlocks(humanBlocks, options.mode);
  const dedupedArchival = dedupeArchivalBlocks(archivalMemories, options.mode);

  report("Extraction complete.", 65);

  return {
    discovery,
    personaBlocks: dedupedPersona,
    humanBlocks: dedupedHuman,
    archivalMemories: dedupedArchival,
  };
}