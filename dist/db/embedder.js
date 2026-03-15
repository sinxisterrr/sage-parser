//--------------------------------------------------------------
// FILE: src/db/embedder.ts
// Client for embedding service
//--------------------------------------------------------------
export class EmbeddingClient {
    constructor(config) {
        this.url = config.url;
        this.maxTextLength = 8000; // Truncate texts longer than this
        this.maxPayloadBytes = 500000; // ~500KB max payload per batch
        console.log(`🔗 Embedding client initialized with URL: ${this.url}`);
    }
    // Truncate text to avoid huge payloads (at natural boundary)
    // Priority: line break > sentence end > space
    truncateText(text) {
        if (text.length <= this.maxTextLength)
            return text;
        const truncated = text.slice(0, this.maxTextLength);
        const minCutoff = this.maxTextLength * 0.6;
        // Priority 1: Find last line break
        const lastNewline = truncated.lastIndexOf('\n');
        if (lastNewline > minCutoff) {
            return truncated.slice(0, lastNewline);
        }
        // Priority 2: Find last sentence end (. ! ?)
        for (let i = truncated.length - 1; i >= minCutoff; i--) {
            const char = truncated[i];
            if (char === '.' || char === '!' || char === '?') {
                return truncated.slice(0, i + 1); // Include the punctuation
            }
        }
        // Priority 3: Find last space to avoid cutting words
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > minCutoff) {
            return truncated.slice(0, lastSpace) + "...";
        }
        // Last resort: just cut at the limit
        return truncated + "...";
    }
    // Smart batching based on payload size, not just count
    createSmartBatches(texts) {
        const batches = [];
        let currentBatch = [];
        let currentSize = 0;
        for (const text of texts) {
            const truncated = this.truncateText(text);
            const textSize = Buffer.byteLength(truncated, 'utf8');
            // If adding this text would exceed limit, start new batch
            if (currentSize + textSize > this.maxPayloadBytes && currentBatch.length > 0) {
                batches.push(currentBatch);
                currentBatch = [];
                currentSize = 0;
            }
            currentBatch.push(truncated);
            currentSize += textSize;
        }
        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }
        return batches;
    }
    async embedBatch(texts, _batchSize = 50) {
        if (texts.length === 0) {
            console.log(`⚠️  embedBatch called with 0 texts, skipping...`);
            return [];
        }
        // Create smart batches based on payload size
        const batches = this.createSmartBatches(texts);
        console.log(`📤 Embedding ${texts.length} texts in ${batches.length} smart batches...`);
        const allEmbeddings = [];
        for (let i = 0; i < batches.length; i++) {
            const chunk = batches[i];
            const chunkNum = i + 1;
            console.log(`   Batch ${chunkNum}/${batches.length} (${chunk.length} texts)...`);
            try {
                const response = await fetch(`${this.url}/embed/batch`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ texts: chunk }),
                });
                if (!response.ok) {
                    const error = await response.text();
                    throw new Error(`Embedder error: ${response.status} - ${error}`);
                }
                const result = await response.json();
                allEmbeddings.push(...result.embeddings);
                console.log(`   ✅ Batch ${chunkNum}/${batches.length} complete (${result.count} embeddings)`);
            }
            catch (err) {
                console.error(`❌ Failed to embed batch ${chunkNum}/${batches.length}: ${err.message}`);
                throw err;
            }
        }
        console.log(`✅ All embeddings complete: ${allEmbeddings.length} total`);
        return allEmbeddings;
    }
    async checkHealth() {
        try {
            console.log(`🏥 Checking embedder health at ${this.url}/health`);
            const response = await fetch(`${this.url}/health`);
            if (!response.ok) {
                console.error(`❌ Health check failed: ${response.status}`);
                return false;
            }
            const health = await response.json();
            console.log(`💓 Embedder health: ${health.status} (model: ${health.model}, ${health.dimensions}D)`);
            return health.ready;
        }
        catch (err) {
            console.error(`❌ Health check error: ${err.message}`);
            return false;
        }
    }
}
