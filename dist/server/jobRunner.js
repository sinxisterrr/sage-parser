//--------------------------------------------------------------
// FILE: src/server/jobRunner.ts
// Background job execution & progress tracking for web mode
//--------------------------------------------------------------
import path from "path";
import fs from "fs";
import { loadExport } from "../core/pipeline.js";
import { runFullPipeline } from "../core/pipeline.js";
import { DatabaseWriter } from "../db/writer.js";
import { EmbeddingClient } from "../db/embedder.js";
// In-memory job store — persists across client disconnects
const jobs = new Map();
// Clean up job files + state after 10 minutes
const JOB_TTL_MS = 10 * 60 * 1000;
export function getJobState(jobId) {
    return jobs.get(jobId);
}
function setPhase(jobId, phase, progress) {
    const job = jobs.get(jobId);
    if (job) {
        job.phase = phase;
        job.progress = Math.min(100, Math.max(0, progress));
    }
}
export async function runJob(jobId, jobDir, config) {
    const state = {
        status: "processing",
        phase: "Loading files...",
        progress: 0,
        startedAt: Date.now(),
    };
    jobs.set(jobId, state);
    const DATABASE_URL = config?.databaseUrl || process.env.DATABASE_URL;
    const EMBEDDER_URL = config?.embedderUrl || process.env.EMBEDDER_URL;
    try {
        // Phase 1: Load uploaded files
        setPhase(jobId, "Loading files...", 5);
        const root = await loadExport(jobDir);
        const nodeCount = Object.keys(root.mapping).length;
        console.log(`[Job ${jobId.slice(0, 8)}] Loaded ${nodeCount} nodes`);
        // Phase 2–4: Discovery, extraction, deduplication (tracked inside pipeline)
        const result = await runFullPipeline(root, {
            mode: "accurate",
            goblin: false,
            onProgress: (phase, pct) => {
                // Pipeline reports 0–100; we map it to the 10–65 range
                const mapped = 10 + Math.round(pct * 0.55);
                setPhase(jobId, phase, mapped);
            },
        });
        console.log(`[Job ${jobId.slice(0, 8)}] Pipeline done — ` +
            `${result.personaBlocks.length} persona, ` +
            `${result.humanBlocks.length} human, ` +
            `${result.archivalMemories.length} archival`);
        if (!DATABASE_URL || !EMBEDDER_URL) {
            // No DB configured — write JSON output files instead
            setPhase(jobId, "Writing output files...", 90);
            const outDir = path.join(jobDir, "output");
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, "persona_blocks.json"), JSON.stringify(result.personaBlocks, null, 2));
            fs.writeFileSync(path.join(outDir, "human_blocks.json"), JSON.stringify(result.humanBlocks, null, 2));
            fs.writeFileSync(path.join(outDir, "archival_memories.json"), JSON.stringify(result.archivalMemories, null, 2));
            fs.writeFileSync(path.join(outDir, "stats.json"), JSON.stringify(result.discovery, null, 2));
        }
        else {
            // Database mode — embed and write to Postgres
            const embedder = new EmbeddingClient({ url: EMBEDDER_URL });
            const db = new DatabaseWriter({ connectionString: DATABASE_URL });
            try {
                await db.initialize();
                const personaTexts = result.personaBlocks.map((b) => b.content);
                const humanTexts = result.humanBlocks.map((b) => b.content);
                const archivalTexts = result.archivalMemories.map((m) => m.content);
                const total = personaTexts.length + humanTexts.length + archivalTexts.length;
                // Phase 5: Embeddings (65–90) — this is the slow part on Railway
                setPhase(jobId, `Generating embeddings for ${total} items...`, 65);
                console.log(`[Job ${jobId.slice(0, 8)}] Embedding ${total} items...`);
                const personaEmbeddings = await embedder.embedBatch(personaTexts);
                setPhase(jobId, "Embedding memories...", 75);
                const humanEmbeddings = await embedder.embedBatch(humanTexts);
                setPhase(jobId, "Embedding memories...", 83);
                const archivalEmbeddings = await embedder.embedBatch(archivalTexts);
                // Phase 6: Write to database (90–100)
                setPhase(jobId, "Writing to database...", 90);
                console.log(`[Job ${jobId.slice(0, 8)}] Writing to database...`);
                if (result.personaBlocks.length > 0) {
                    await db.writePersonaBlocks(result.personaBlocks, personaEmbeddings);
                }
                if (result.humanBlocks.length > 0) {
                    await db.writeHumanBlocks(result.humanBlocks, humanEmbeddings);
                }
                if (result.archivalMemories.length > 0) {
                    await db.writeArchivalMemories(result.archivalMemories, archivalEmbeddings);
                }
                console.log(`[Job ${jobId.slice(0, 8)}] Complete ✓`);
            }
            finally {
                await db.close();
            }
        }
        state.status = "done";
        state.phase = "Done!";
        state.progress = 100;
        state.stats = {
            personaBlocks: result.personaBlocks.length,
            humanBlocks: result.humanBlocks.length,
            archivalMemories: result.archivalMemories.length,
        };
    }
    catch (err) {
        state.status = "error";
        state.phase = "Failed";
        state.error = err?.message || String(err);
        console.error(`[Job ${jobId.slice(0, 8)}] Error:`, err);
    }
    finally {
        state.finishedAt = Date.now();
        // Clean up uploaded files after TTL
        setTimeout(() => {
            jobs.delete(jobId);
            try {
                fs.rmSync(jobDir, { recursive: true, force: true });
            }
            catch { }
        }, JOB_TTL_MS);
    }
}
