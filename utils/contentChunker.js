const DEFAULT_CHUNK_SIZE = parseInt(process.env.PDF_CHUNK_SIZE, 10) || 50000;
const DEFAULT_CHUNK_OVERLAP = parseInt(process.env.PDF_CHUNK_OVERLAP_SENTENCES, 10) || 2;
const { createHash } = require('crypto');
const compromise = require('compromise');

// Preprocessing function: regex + NLP
function hybridPreprocess(text, log = []) {
  let cleaned = text;
  // 1. Regex/String pass
  // Remove Table of Contents
  cleaned = cleaned.replace(/Table of Contents[\s\S]+?(Section|Article|1\\.|I\\.)/i, '$1');
  // Remove headers/footers/page numbers
  cleaned = cleaned.replace(/^Page \d+.*$/gim, (m) => { log.push(`Removed: ${m}`); return ''; });
  cleaned = cleaned.replace(/^(Confidential|Draft|Sample|—+)$/gim, (m) => { log.push(`Removed: ${m}`); return ''; });
  cleaned = cleaned.replace(/^\d+\s*$/gm, (m) => { log.push(`Removed: ${m}`); return ''; });
  cleaned = cleaned.replace(/^\d+\s+of\s+\d+$/gm, (m) => { log.push(`Removed: ${m}`); return ''; });
  cleaned = cleaned.replace(/This page intentionally left blank/gi, (m) => { log.push(`Removed: ${m}`); return ''; });
  cleaned = cleaned.replace(/Do not distribute/gi, (m) => { log.push(`Removed: ${m}`); return ''; });
  // Collapse whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // 2. NLP pass
  const doc = compromise(cleaned);
  const sentences = doc.sentences().out('array');
  // Detect sections/headings (basic: lines in all caps or numbered)
  const sectionRegex = /^(SECTION|ARTICLE|[A-Z][A-Z\s]+|\d+\.\d+|[IVX]+\.|\d+\))/gm;
  const sectionMatches = [];
  let match;
  while ((match = sectionRegex.exec(cleaned)) !== null) {
    sectionMatches.push({ index: match.index, text: match[0] });
    log.push(`Detected section heading: '${match[0]}' at ${match.index}`);
  }
  // Flag sentences containing definitions or references
  const flagged = sentences.filter(s => /means|refers to|as defined in|see section/i.test(s));
  flagged.forEach(s => log.push(`Flagged for overlap/context: '${s}'`));

  return { cleanedText: cleaned, sentences, sectionMatches, flagged, log };
}

class ContentChunker {
  /**
   * Split content into semantic chunks preserving context
   * @param {string} text - Input content
   * @param {number} [chunkSize=DEFAULT_CHUNK_SIZE] - Target chunk size in characters
   * @param {number} [overlapSentences=DEFAULT_CHUNK_OVERLAP] - Number of sentences to overlap between chunks
   */
  static splitContent(text, chunkSize = DEFAULT_CHUNK_SIZE, overlapSentences = DEFAULT_CHUNK_OVERLAP, enablePreprocessing = true, log = []) {
    let preprocessed = text;
    let preprocessLog = [];
    if (enablePreprocessing) {
      const result = hybridPreprocess(text, preprocessLog);
      preprocessed = result.cleanedText;
      log.push(...preprocessLog);
    }
    // For DeepSeek, typically chunk once at a very high token count
    // But keep chunking logic in case doc is massive
    const maxChunkSize = chunkSize;
    const units = preprocessed.split(/\r?\n\s*\r?\n+/);
    const chunks = [];
    let buffer = '';
    const joiner = '\n\n';
    for (const unit of units) {
      const textUnit = unit.trim();
      if (!textUnit) continue;
      const candidate = buffer ? buffer + joiner + textUnit : textUnit;
      if (candidate.length <= maxChunkSize) {
        buffer = candidate;
      } else {
        if (buffer) chunks.push(buffer);
        buffer = textUnit;
      }
    }
    if (buffer) chunks.push(buffer);
    log.push(`[CHUNKER] Created ${chunks.length} chunks with maxChunkSize ${maxChunkSize}`);
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

  static hybridPreprocess = hybridPreprocess;
}

module.exports = ContentChunker;
