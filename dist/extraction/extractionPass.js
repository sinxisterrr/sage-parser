//--------------------------------------------------------------
// FILE: src/extraction/extractionPass.ts
// FIXED: Proper text extraction, filtering, and classification
//--------------------------------------------------------------
import { classifyParagraphToMIRA } from "../utils/documentClassifier.js";
import { dedupeArchival } from "./dedupePass.js";
// ------------------ Helpers ------------------
function getText(msg) {
    if (!msg || !msg.content)
        return "";
    const c = msg.content;
    // Handle parts array
    if (Array.isArray(c.parts)) {
        return c.parts
            .filter((part) => {
            // Only keep actual strings, skip objects
            if (typeof part === 'string')
                return true;
            if (part === null || part === undefined)
                return false;
            // If it's an object, try to extract text property
            if (typeof part === 'object' && part.text) {
                return typeof part.text === 'string';
            }
            return false;
        })
            .map((part) => {
            // Extract text from objects that have a text property
            if (typeof part === 'string')
                return part;
            if (typeof part === 'object' && part.text)
                return part.text;
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
function clamp(n) {
    return Math.max(1, Math.min(10, Math.round(n)));
}
function scoreImportance(msg, textLength, text) {
    let score = 5;
    const role = msg.author?.role || "unknown";
    const metadata = msg.metadata;
    // Detect automated/generated content
    const isGenerated = metadata?.dalle_prompt ||
        metadata?.image_gen_async ||
        metadata?.dalle_metadata ||
        text.includes("dalle.create") ||
        text.includes("Generated image") ||
        text.includes("browser.click") ||
        text.includes("browser.search");
    if (isGenerated) {
        score = 3; // Start much lower for generated content
    }
    // Weight from message metadata (but cap it)
    if (typeof msg.weight === "number" && !isGenerated) {
        score += Math.min(2, (msg.weight - 1)); // Cap the boost
    }
    // Role-based adjustments
    if (role === "user")
        score += 1;
    if (role === "system")
        score -= 2;
    if (role === "tool")
        score -= 3;
    // Length-based adjustments (longer = potentially more important)
    if (textLength > 500 && !isGenerated)
        score += 1;
    if (textLength > 1000 && !isGenerated)
        score += 1;
    if (textLength < 50)
        score -= 2;
    // Content quality signals
    const hasEmotionalContent = /\b(feel|feeling|love|hate|scared|happy|sad|angry|excited)\b/i.test(text);
    const hasDecisionMaking = /\b(decide|decided|choice|choose|important|matter)\b/i.test(text);
    const hasPersonalInfo = /\b(my|i'm|i am|me|myself)\b/i.test(text);
    if (hasEmotionalContent)
        score += 1;
    if (hasDecisionMaking)
        score += 1;
    if (hasPersonalInfo)
        score += 0.5;
    return clamp(score);
}
function miraToCategory(m) {
    switch (m) {
        case "memory": return "episodic";
        case "identity": return "identity";
        case "relationship": return "relationship";
        case "agent": return "behavioral";
        default: return "general";
    }
}
function isJunkMessage(text, role, metadata) {
    if (!text || text.length === 0)
        return true;
    // Filter tool calls and image generation
    if (metadata?.dalle_prompt || metadata?.dalle_metadata)
        return true;
    if (metadata?.image_gen_async || metadata?.browser)
        return true;
    // Filter out common junk patterns
    const junkPatterns = [
        /^\[object Object\]/,
        /^Model set context updated\.?$/i,
        /^All the files uploaded by the user have been fully loaded/i,
        /^search\(.+\)$/i,
        /^voice_mode_message:/i,
        /^request_id:/i,
        /^turn_exchange_id:/i,
        /^Searched \d+ sites?$/i,
        /^Clicked on/i,
        /dalle\.create/i,
        /browser\.(click|search|scroll)/i,
        /^Generated image/i,
    ];
    for (const pattern of junkPatterns) {
        if (pattern.test(text))
            return true;
    }
    // Filter emoji-only messages (but keep if there's actual text too)
    const emojiOnly = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+$/u;
    if (emojiOnly.test(text))
        return true;
    // Filter very short tool/system messages
    if ((role === "tool" || role === "system") && text.length < 20)
        return true;
    return false;
}
// ------------------ Main Extraction ------------------
export function runExtraction(root, options = {}) {
    const mapping = root.mapping;
    const ids = Object.keys(mapping);
    const archival = [];
    const personaBuckets = {
        memory: { texts: [], weights: [] },
        identity: { texts: [], weights: [] },
        relationship: { texts: [], weights: [] },
        agent: { texts: [], weights: [] },
        unknown: { texts: [], weights: [] }
    };
    const humanBuckets = {
        memory: { texts: [], weights: [] },
        identity: { texts: [], weights: [] },
        relationship: { texts: [], weights: [] },
        agent: { texts: [], weights: [] },
        unknown: { texts: [], weights: [] }
    };
    let filtered = 0;
    let processed = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    for (const id of ids) {
        const node = mapping[id];
        if (!node || !node.message)
            continue;
        const msg = node.message;
        // Skip messages without author
        if (!msg.author)
            continue;
        const text = getText(msg);
        const role = msg.author.role || "unknown";
        // Filter junk — but NEVER filter document-sourced content (user-curated, keep verbatim)
        const isDocument = msg.metadata?.source_type === "document";
        if (!isDocument && isJunkMessage(text, role, msg.metadata)) {
            filtered++;
            continue;
        }
        processed++;
        // Classify via MIRA — use real source filename so path heuristics fire
        let mira = node.message.metadata?.miraType || "unknown";
        if (mira === "unknown") {
            const sourceFile = msg.metadata?.source_file || "conversations.json";
            const result = classifyParagraphToMIRA(text, sourceFile);
            mira = result.miraType;
        }
        // Route to correct bucket based on role
        if (role === "assistant") {
            personaBuckets[mira].texts.push(text);
            if (typeof msg.weight === "number") {
                personaBuckets[mira].weights.push(msg.weight);
            }
            assistantMessages++;
        }
        else if (role === "user") {
            humanBuckets[mira].texts.push(text);
            if (typeof msg.weight === "number") {
                humanBuckets[mira].weights.push(msg.weight);
            }
            userMessages++;
        }
        // system/tool messages don't go to persona/human blocks
        // Calculate importance
        const importance = scoreImportance(msg, text.length, text);
        // DEBUG: Warn if text is empty
        if (!text || text.trim().length === 0) {
            console.warn(`⚠️  Empty text for message ${msg.id} (role: ${role})`);
        }
        // Create archival memory
        archival.push({
            id: msg.id,
            content: text,
            category: miraToCategory(mira),
            importance,
            timestamp: msg.create_time ?? null,
            tags: [role, `mira:${mira}`],
            metadata: {
                miraType: mira,
                length: text.length,
                // Keep only useful metadata
                ...(msg.metadata?.model_slug && { model: msg.metadata.model_slug }),
                ...(msg.metadata?.gizmo_id && { gizmo_id: msg.metadata.gizmo_id }),
                ...(typeof msg.weight === "number" && { weight: msg.weight }),
                // Preserve source info so document content bypasses dedupe
                ...(msg.metadata?.source_type && { source_type: msg.metadata.source_type }),
                ...(msg.metadata?.source_file && { source_file: msg.metadata.source_file }),
            }
        });
    }
    // Suppress verbose extraction stats in normal runs to keep UI clean.
    // Build persona blocks (assistant messages)
    const personaBlocks = [];
    function addPersonaBlock(label, key, description) {
        const bucket = personaBuckets[key];
        if (!bucket.texts.length)
            return;
        // Calculate weight statistics
        const weightStats = {};
        if (bucket.weights.length > 0) {
            const avgWeight = bucket.weights.reduce((sum, w) => sum + w, 0) / bucket.weights.length;
            weightStats.averageWeight = Math.round(avgWeight * 100) / 100;
            weightStats.minWeight = Math.min(...bucket.weights);
            weightStats.maxWeight = Math.max(...bucket.weights);
        }
        personaBlocks.push({
            label: `persona_${label}`,
            block_type: "persona",
            content: bucket.texts.join("\n\n"),
            description,
            metadata: { miraType: key, count: bucket.texts.length, ...weightStats },
            limit: 8192,
            read_only: false
        });
    }
    addPersonaBlock("identity", "identity", "AI assistant's core identity, values, and self-concept from conversations");
    addPersonaBlock("relationship", "relationship", "AI assistant's understanding of relationship dynamics and shared experiences");
    addPersonaBlock("agent", "agent", "AI assistant's behavioral patterns, preferences, and interaction style");
    addPersonaBlock("memory", "memory", "AI assistant's memories of shared experiences and events");
    // Also include unknown if there's significant content
    if (personaBuckets.unknown.texts.length > 0) {
        addPersonaBlock("general", "unknown", "AI assistant's general statements and miscellaneous information");
    }
    // Build human blocks (user messages)
    const humanBlocks = [];
    function addHumanBlock(label, key, description) {
        const bucket = humanBuckets[key];
        if (!bucket.texts.length)
            return;
        // Calculate weight statistics
        const weightStats = {};
        if (bucket.weights.length > 0) {
            const avgWeight = bucket.weights.reduce((sum, w) => sum + w, 0) / bucket.weights.length;
            weightStats.averageWeight = Math.round(avgWeight * 100) / 100;
            weightStats.minWeight = Math.min(...bucket.weights);
            weightStats.maxWeight = Math.max(...bucket.weights);
        }
        const block = {
            label: `human_${label}`,
            block_type: "human",
            content: bucket.texts.join("\n\n"),
            description,
            metadata: { miraType: key, count: bucket.texts.length, ...weightStats },
            limit: 8192,
            read_only: false
        };
        humanBlocks.push(block);
    }
    addHumanBlock("identity", "identity", "Human user's identity, values, and self-descriptions from conversations");
    addHumanBlock("relationship", "relationship", "Human user's perspective on relationship dynamics and shared experiences");
    addHumanBlock("agent", "agent", "Human user's preferences, habits, and behavioral patterns");
    addHumanBlock("memory", "memory", "Human user's personal memories and experiences shared in conversations");
    // Also include unknown if there's significant content
    if (humanBuckets.unknown.texts.length > 0) {
        addHumanBlock("general", "unknown", "Human user's general statements and miscellaneous information");
    }
    // Dedupe archival
    const dedupedArchival = dedupeArchival(archival, options);
    return {
        personaBlocks,
        humanBlocks,
        archival: dedupedArchival
    };
}
