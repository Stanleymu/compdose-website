const DEFAULT_CHUNK_SIZE = parseInt(process.env.PDF_CHUNK_SIZE, 10) || 8000;
const DEFAULT_CHUNK_OVERLAP = parseInt(process.env.PDF_CHUNK_OVERLAP_SENTENCES, 10) || 0;
const { createHash } = require('crypto');

class ContentChunker {
  /**
   * Split content into semantic chunks preserving context
   * @param {string} text - Input content
   * @param {number} [chunkSize=DEFAULT_CHUNK_SIZE] - Target chunk size in characters
   * @param {number} [overlapSentences=DEFAULT_CHUNK_OVERLAP] - Number of sentences to overlap between chunks
   */
  static splitContent(text, chunkSize = DEFAULT_CHUNK_SIZE, overlapSentences = DEFAULT_CHUNK_OVERLAP) {
    console.log(`[CHUNKER] Hierarchical chunking on text ${text.length} chars`);

    // Dynamic chunk size calculation using geometric mean between min and max chunk counts
    const minChunkSize = parseInt(process.env.PDF_MIN_CHUNK_SIZE, 10) || 2000;
    const maxChunkSize = chunkSize;
    const totalChars = text.length;
    const rawMinChunks = Math.ceil(totalChars / maxChunkSize);
    const rawMaxChunks = Math.ceil(totalChars / minChunkSize);
    // Geometric mean for balanced chunk count
    const geomChunks = Math.ceil(Math.sqrt(rawMinChunks * rawMaxChunks));
    // Cap target chunk count by PDF_MAX_CHUNKS env var
    let targetChunks = Math.min(Math.max(rawMinChunks, geomChunks), rawMaxChunks);
    if (process.env.PDF_MAX_CHUNKS) {
      const maxAllowed = parseInt(process.env.PDF_MAX_CHUNKS, 10);
      if (!isNaN(maxAllowed)) {
        const oldCount = targetChunks;
        targetChunks = Math.min(targetChunks, maxAllowed);
        console.log(`[CHUNKER] Capped chunk count from ${oldCount} to PDF_MAX_CHUNKS=${maxAllowed}`);
      }
    }
    const dynamicSize = Math.ceil(totalChars / targetChunks);
    const finalChunkSize = Math.min(maxChunkSize, Math.max(minChunkSize, dynamicSize));
    console.log(`[CHUNKER] Dynamic chunkSize ${finalChunkSize} chars aiming for ~${targetChunks} chunks (min=${rawMinChunks}, max=${rawMaxChunks})`);
    // Override chunkSize for grouping
    chunkSize = finalChunkSize;
    // Semantic units for grouping
    const headerUnits = text.split(/(?=^#{1,3}\s+)/m);
    const units = headerUnits.length > 1 ? headerUnits : text.split(/\r?\n\s*\r?\n+/);

    // Group units into chunks by dynamic chunkSize
    const overlapCount = overlapSentences;
    const chunks = [];
    const joiner = '\n\n';
    let previousOverlap = '';
    let buffer = '';
    for (const unit of units) {
      const textUnit = unit.trim();
      if (!textUnit) continue;
      const candidate = buffer ? buffer + joiner + textUnit : textUnit;
      if (candidate.length <= chunkSize) {
        buffer = candidate;
      } else {
        if (buffer) chunks.push(buffer);
        const sentences = buffer.split(/(?<=[.!?:])\s+/);
        previousOverlap = overlapCount > 0 ? sentences.slice(-overlapCount).join(' ') : '';
        buffer = previousOverlap ? previousOverlap + joiner + textUnit : textUnit;
      }
    }
    if (buffer) chunks.push(buffer);
    console.log(`[CHUNKER] Created ${chunks.length} chunks with up to ${overlapCount} sentence overlap`);
    // Fallback: if too many chunks, slice uniformly to meet targetChunks
    if (typeof targetChunks !== 'undefined' && chunks.length > targetChunks) {
      console.warn(`[CHUNKER] Chunk count ${chunks.length} exceeds targetChunks ${targetChunks}, falling back to sentence-aware slicing`);
      // Sentence-aware uniform slicing
      const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [];
      const uniform = [];
      let bufferSentence = '';
      for (const sentence of sentences) {
        if ((bufferSentence + sentence).length <= chunkSize) {
          bufferSentence += sentence;
        } else {
          if (bufferSentence) uniform.push(bufferSentence);
          bufferSentence = sentence;
        }
      }
      if (bufferSentence) uniform.push(bufferSentence);
      console.log(`[CHUNKER] Sentence-aware slicing produced ${uniform.length} chunks`);
      // Merge overflow chunks to respect targetChunks
      if (uniform.length > targetChunks) {
        console.warn(`[CHUNKER] Merging last chunks to respect targetChunks ${targetChunks}`);
        while (uniform.length > targetChunks) {
          const last = uniform.pop();
          uniform[uniform.length - 1] += ' ' + last;
        }
        console.log(`[CHUNKER] After merging, produced ${uniform.length} chunks`);
      }
      return uniform;
    }
    return chunks;
  }

  /**
   * Process chunks with validation
   * @param {string[]} chunks
   * @param {Function} processorFn
   */
  static async processChunks(chunks, processorFn) {
    const processed = await Promise.all(
      chunks.map(async (chunk, index) => {
        try {
          return await processorFn(chunk, index);
        } catch (error) {
          console.error(`Error processing chunk ${index}:`, error);
          return null;
        }
      })
    );

    return processed.filter(result => result !== null);
  }

  /**
   * Validate chunk integrity
   * @param {string[]} originalChunks
   * @param {string[]} processedChunks
   */
  static validateChunks(originalChunks, processedChunks) {
    const originalHash = createHash('sha256')
      .update(originalChunks.join(''))
      .digest('hex');

    const processedHash = createHash('sha256')
      .update(processedChunks.join(''))
      .digest('hex');

    if (originalHash !== processedHash) {
      throw new Error('Chunk processing validation failed: Content mismatch');
    }

    return processedChunks;
  }

  // Smart chunking utilities
  /**
   * Split text into logical sections by headers or paragraphs.
   */
  static splitBySections(text) {
    const headerRegex = /(?=^#{1,6}\s+)/m;
    const parts = text.split(headerRegex).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
    return text.split(/\r?\n\s*\r?\n+/).map(s => s.trim()).filter(Boolean);
  }

  /**
   * Create intelligent chunks from sections with overlap.
   */
  static createIntelligentChunks(sections, chunkSize = DEFAULT_CHUNK_SIZE, overlapSentences = DEFAULT_CHUNK_OVERLAP) {
    const chunks = [];
    const joiner = '\n\n';
    let buffer = '';
    let prevOverlap = '';
    for (const sec of sections) {
      const section = sec.trim();
      if (!section) continue;
      const candidate = buffer ? buffer + joiner + section : section;
      if (candidate.length <= chunkSize) {
        buffer = candidate;
      } else {
        if (buffer) {
          chunks.push(buffer);
          const sentences = buffer.split(/(?<=[.!?:])\s+/);
          prevOverlap = overlapSentences > 0 ? sentences.slice(-overlapSentences).join(' ') : '';
        }
        buffer = prevOverlap ? prevOverlap + joiner + section : section;
      }
    }
    if (buffer) chunks.push(buffer);
    return chunks;
  }

  /**
   * Orchestrate section-based chunking and intelligent grouping.
   */
  static splitIntoChunks(text, chunkSize = DEFAULT_CHUNK_SIZE, overlapSentences = DEFAULT_CHUNK_OVERLAP) {
    const sections = this.splitBySections(text);
    return this.createIntelligentChunks(sections, chunkSize, overlapSentences);
  }
}

module.exports = ContentChunker;
