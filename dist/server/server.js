//--------------------------------------------------------------
// FILE: src/server/server.ts
// Sage Memory Parser — Web Server
// Run with: npm start (or npm run web)
//--------------------------------------------------------------
import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { runJob, getJobState } from "./jobRunner.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
// Uploads go in ./uploads/<jobId>/
const uploadDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
// Preserve original filenames inside a per-job directory.
// The jobId is injected onto req before multer runs (see injectJobId below).
const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const dir = path.join(uploadDir, req.jobId);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        // Sanitise but keep the extension so the pipeline knows the file type
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, safe);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file
});
// Attach a jobId to every upload request before multer touches it
function injectJobId(req, _res, next) {
    req.jobId = randomUUID();
    next();
}
// Serve the single-page UI
const publicDir = path.join(__dirname, "../../public");
app.use(express.static(publicDir));
// ── Config status ────────────────────────────────────────────
app.get("/api/config", (_req, res) => {
    res.json({
        hasDatabase: !!process.env.DATABASE_URL,
        hasEmbedder: !!process.env.EMBEDDER_URL,
    });
});
// ── Upload & start job ───────────────────────────────────────
app.post("/api/upload", injectJobId, upload.array("files"), async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
        res.status(400).json({ error: "No files uploaded." });
        return;
    }
    // Config can come from the form body (set via the UI) or fall back to env vars
    const databaseUrl = req.body?.databaseUrl || process.env.DATABASE_URL;
    const embedderUrl = req.body?.embedderUrl || process.env.EMBEDDER_URL;
    const jobDir = path.join(uploadDir, req.jobId);
    // Fire and forget — processing continues even if the client disconnects
    runJob(req.jobId, jobDir, { databaseUrl, embedderUrl }).catch((err) => {
        console.error(`Job ${req.jobId} crashed:`, err);
    });
    res.json({ jobId: req.jobId });
});
// ── Job status polling ───────────────────────────────────────
app.get("/api/job/:id", (req, res) => {
    const state = getJobState(req.params.id);
    if (!state) {
        res.status(404).json({ error: "Job not found." });
        return;
    }
    res.json(state);
});
// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🌐 Sage Memory Parser — web server on port ${PORT}`);
    console.log(`   DATABASE_URL : ${process.env.DATABASE_URL ? "✅ set" : "❌ not set"}`);
    console.log(`   EMBEDDER_URL : ${process.env.EMBEDDER_URL ? "✅ set" : "❌ not set"}\n`);
});
