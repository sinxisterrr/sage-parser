#!/usr/bin/env tsx
//--------------------------------------------------------------
// Diagnose NULL Content Issue
// Tests each step of the pipeline to find where content is lost
//--------------------------------------------------------------

import "dotenv/config";
import { readFile } from "fs/promises";
import { loadExport } from "./src/core/pipeline.js";
import type { ExportRoot, Message } from "./src/types/memory.js";

// Copy of getText from extractionPass
function getText(msg: Message): string {
  if (!msg || !msg.content) return "";

  const c: any = msg.content;

  // Handle parts array
  if (Array.isArray(c.parts)) {
    return c.parts
      .filter((part: any) => {
        if (typeof part === 'string') return true;
        if (part === null || part === undefined) return false;
        if (typeof part === 'object' && part.text) {
          return typeof part.text === 'string';
        }
        return false;
      })
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part.text) return part.text;
        return '';
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  // Handle direct text field
  if (typeof c.text === "string") {
    return c.text.trim();
  }

  // If content itself is a string
  if (typeof c === "string") {
    return c.trim();
  }

  return "";
}

async function diagnose() {
  console.log("🔍 DIAGNOSING NULL CONTENT ISSUE\n");
  console.log("=" .repeat(60));

  const inputPath = process.argv[2] || "./input";

  console.log(`\n📂 Loading export from: ${inputPath}`);

  let root: ExportRoot;
  try {
    root = await loadExport(inputPath);
    console.log(`✅ Loaded ${Object.keys(root.mapping).length} nodes`);
  } catch (error: any) {
    console.error(`❌ Failed to load export: ${error.message}`);
    process.exit(1);
  }

  const mapping = root.mapping;
  const ids = Object.keys(mapping);

  console.log(`\n🔬 ANALYZING MESSAGE CONTENT EXTRACTION...`);
  console.log("─" .repeat(60));

  let totalMessages = 0;
  let messagesWithContent = 0;
  let messagesWithParts = 0;
  let messagesWithText = 0;
  let messagesWithStringContent = 0;
  let emptyAfterExtraction = 0;
  let messagesWithAuthor = 0;
  let userMessages = 0;
  let assistantMessages = 0;

  const sampleMessages: Array<{ id: string; extracted: string; raw: any }> = [];

  for (const id of ids) {
    const node = mapping[id];
    if (!node || !node.message) continue;

    const msg = node.message;
    totalMessages++;

    // Check if has author
    if (msg.author) {
      messagesWithAuthor++;
      const role = msg.author.role;
      if (role === 'user') userMessages++;
      if (role === 'assistant') assistantMessages++;
    }

    // Check content structure
    if (msg.content) {
      const c: any = msg.content;

      if (Array.isArray(c.parts)) {
        messagesWithParts++;
      }

      if (typeof c.text === 'string') {
        messagesWithText++;
      }

      if (typeof c === 'string') {
        messagesWithStringContent++;
      }

      // Try to extract text
      const extracted = getText(msg);

      if (extracted && extracted.length > 0) {
        messagesWithContent++;

        // Save first 5 as samples
        if (sampleMessages.length < 5) {
          sampleMessages.push({
            id: msg.id,
            extracted: extracted.substring(0, 100),
            raw: c
          });
        }
      } else {
        emptyAfterExtraction++;

        // Log first 3 failures
        if (emptyAfterExtraction <= 3) {
          console.log(`\n⚠️  EXTRACTION FAILED for message ${msg.id}:`);
          console.log(`   Role: ${msg.author?.role || 'unknown'}`);
          console.log(`   Content structure:`, JSON.stringify(c, null, 2).substring(0, 300));
          console.log();
        }
      }
    }
  }

  console.log("\n📊 STATISTICS:");
  console.log("─" .repeat(60));
  console.log(`Total messages:              ${totalMessages}`);
  console.log(`Messages with author:        ${messagesWithAuthor}`);
  console.log(`  - User messages:           ${userMessages}`);
  console.log(`  - Assistant messages:      ${assistantMessages}`);
  console.log();
  console.log(`Content structure:`);
  console.log(`  - Has content.parts[]:     ${messagesWithParts}`);
  console.log(`  - Has content.text:        ${messagesWithText}`);
  console.log(`  - Content is string:       ${messagesWithStringContent}`);
  console.log();
  console.log(`Extraction results:`);
  console.log(`  ✅ Successfully extracted: ${messagesWithContent}`);
  console.log(`  ❌ Empty after extraction: ${emptyAfterExtraction}`);
  console.log();

  if (messagesWithContent === 0) {
    console.log("🚨 CRITICAL: NO CONTENT EXTRACTED FROM ANY MESSAGE!");
    console.log();
    console.log("This means your conversation export has a different format than expected.");
    console.log("The getText() function needs to be updated to handle your format.");
    console.log();
    console.log("Please share a sample message object from your export so I can fix getText().");
    process.exit(1);
  }

  const successRate = (messagesWithContent / totalMessages * 100).toFixed(1);
  console.log(`Success rate: ${successRate}%`);

  if (emptyAfterExtraction > 0) {
    console.log();
    console.log(`⚠️  ${emptyAfterExtraction} messages had empty content after extraction.`);
    console.log(`   These will be filtered out as junk and won't be saved.`);
  }

  console.log();
  console.log("📝 SAMPLE EXTRACTED CONTENT:");
  console.log("─" .repeat(60));

  for (const sample of sampleMessages) {
    console.log(`\nMessage ${sample.id}:`);
    console.log(`  Extracted: "${sample.extracted}..."`);
    console.log(`  Length: ${sample.extracted.length} chars`);
  }

  console.log();
  console.log("=" .repeat(60));

  if (successRate === "100.0") {
    console.log("✅ CONTENT EXTRACTION IS WORKING PERFECTLY!");
    console.log();
    console.log("All messages have content. If you're still getting NULL in the database,");
    console.log("the problem is AFTER extraction (dedupe, embeddings, or database write).");
    console.log();
    console.log("Next step: Run the full parser with debug logging:");
    console.log("  npm run build");
    console.log("  npm run parse yourfile.json 2>&1 | tee debug.log");
    console.log();
    console.log("Look for these warnings in debug.log:");
    console.log("  - '⚠️  WARNING: Memory X has null/empty content!'");
    console.log("  - '⚠️  Empty text for message X'");
  } else if (parseFloat(successRate) > 50) {
    console.log("⚠️  CONTENT EXTRACTION IS PARTIALLY WORKING");
    console.log();
    console.log(`${successRate}% of messages extracted successfully.`);
    console.log("Some messages might have unexpected formats that getText() doesn't handle.");
    console.log();
    console.log("The empty messages will be filtered out and won't cause NULL in database.");
    console.log("If you want to save those messages too, we need to update getText().");
  } else {
    console.log("❌ CONTENT EXTRACTION IS FAILING!");
    console.log();
    console.log(`Only ${successRate}% of messages extracted successfully.`);
    console.log("Your conversation export format is likely incompatible with getText().");
    console.log();
    console.log("Please share a sample message from your export so we can fix this.");
  }

  console.log("=" .repeat(60));
}

diagnose().catch((error) => {
  console.error("\n❌ DIAGNOSIS FAILED:", error);
  console.error(error.stack);
  process.exit(1);
});
