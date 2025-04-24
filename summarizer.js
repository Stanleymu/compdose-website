const fs = require('fs');
const path = require('path');
const express = require('express');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const ContentChunker = require('./utils/contentChunker');
const watcher = require('./watcher');
const emitter = watcher.emitter;

module.exports = (app, { summaryDir, processedDir }) => {
  // ensure summary directory exists
  if (!fs.existsSync(summaryDir)) {
    fs.mkdirSync(summaryDir, { recursive: true });
  }
  // ensure processed directory exists
  if (processedDir && !fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  // serve raw JSON files for direct download
  app.use('/summaries', express.static(summaryDir));

  // handle new uploads
  emitter.on('fileAdded', async filePath => {
    console.log(`[${new Date().toISOString()}] [summarizer] Processing file: ${filePath}`);
    try {
      const data = await pdfParse(fs.readFileSync(filePath));
      // Preprocess: drop initial header section if present
      let rawText = data.text;
      const paras = rawText.split(/\r?\n\s*\r?\n/);
      if (paras.length > 1 && paras[0].length < 1000) {
        console.log(`[${new Date().toISOString()}] [summarizer] Dropping header: ${paras[0].slice(0,50).replace(/\n/g, ' ')}...`);
        rawText = paras.slice(1).join('\n\n');
      }
      // Choose chunker based on env flag
      const useSmartChunker = process.env.USE_SMART_CHUNKER === 'true';
      const chunks = useSmartChunker
        ? ContentChunker.splitIntoChunks(rawText)
        : ContentChunker.splitContent(rawText);
      console.log(`[${new Date().toISOString()}] [summarizer] Using ${useSmartChunker ? 'smart' : 'default'} chunker, split into ${chunks.length} chunks`);
      // Debug: log each chunk's length and preview
      chunks.forEach((chunk, i) => {
        console.log(`[chunk debug] ${i+1}/${chunks.length}: ${chunk.length} chars; preview: ${chunk.slice(0,100).replace(/\n/g, ' ')}`);
      });

      // If only one chunk, do direct summarization and exit early
      if (false && chunks.length <= 1) {
        console.log(`[${new Date().toISOString()}] [summarizer] Single chunk detected, using direct summarization`);
        const miniSummaries = [];
        let finalSummary = '';
        try {
          const resp = await axios.post(
            process.env.PERPLEXITY_ENDPOINT,
            {
              model: process.env.PERPLEXITY_MODEL,
              messages: [
                { role: 'system', content: 'You are an expert summarizer. Summarize the following document into a concise overview. Retain only the core content. Ignore letterhead, addresses, or metadata.' },
                { role: 'user', content: chunks[0] }
              ],
              max_tokens: Number(process.env.PERPLEXITY_FINAL_MAX_TOKENS || process.env.PERPLEXITY_MAX_TOKENS),
              temperature: Number(process.env.PERPLEXITY_TEMPERATURE),
              top_p: Number(process.env.PERPLEXITY_TOP_P),
              presence_penalty: Number(process.env.PERPLEXITY_PRESENCE_PENALTY),
              frequency_penalty: Number(process.env.PERPLEXITY_FREQUENCY_PENALTY)
            },
            { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } }
          );
          finalSummary = (resp.data.choices?.[0]?.message?.content || resp.data.text || '').trim();
          if (!/[.?!]$/.test(finalSummary)) finalSummary += '.';
          miniSummaries.push(finalSummary);
        } catch (err) {
          console.error(`[${new Date().toISOString()}] [summarizer] Error on direct summarization:`, err);
          finalSummary = chunks[0].slice(0, Math.min(chunks[0].length, 1000)).trim();
          if (!/[.?!]$/.test(finalSummary)) finalSummary += '.';
          miniSummaries.push(finalSummary);
        }
        // Write out JSON and move file
        const result = {
          fileName: path.basename(filePath),
          processedAt: new Date().toISOString(),
          finalSummary,
          chunkSummaries: miniSummaries
        };
        const outFile = path.join(summaryDir, `${path.basename(filePath, path.extname(filePath))}.json`);
        fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
        console.log(`[${new Date().toISOString()}] [summarizer] Wrote direct summary: ${outFile}`);
        if (processedDir) {
          const dest = path.join(processedDir, path.basename(filePath));
          if (fs.existsSync(filePath)) {
            fs.renameSync(filePath, dest);
            console.log(`[${new Date().toISOString()}] [summarizer] Moved file to processed: ${dest}`);
          } else {
            console.warn(`[${new Date().toISOString()}] [summarizer] File not found, skipping move: ${filePath}`);
          }
        }
        return;
      }

      const useMock = process.env.MOCK_SUMMARIES === 'true';

      // Generate mini summaries in parallel
      const miniSummaries = await Promise.all(
        chunks.map(async (chunk, idx) => {
          if (useMock) {
            console.log(`[${new Date().toISOString()}] [summarizer] Mock summarizing chunk ${idx+1}`);
            return `Mock summary for chunk ${idx+1}/${chunks.length}: ${chunk.slice(0, 100).replace(/\n/g, ' ')}...`;
          }
          console.log(`[${new Date().toISOString()}] [summarizer] Sending chunk ${idx+1}/${chunks.length}`);
          try {
            const resp = await axios.post(
              process.env.PERPLEXITY_ENDPOINT,
              {
                model: process.env.PERPLEXITY_MODEL,
                messages: [
                  { role: 'system', content: `You are an expert summarizer. Summarize chunk ${idx+1} of ${chunks.length} using only the provided text. Provide a concise summary focusing on core content, omitting metadata and addresses. Do not introduce external information, examples, or citations.` },
                  { role: 'user', content: chunk }
                ],
                max_tokens: Number(process.env.PERPLEXITY_MAX_TOKENS),
                temperature: Number(process.env.PERPLEXITY_TEMPERATURE),
                top_p: Number(process.env.PERPLEXITY_TOP_P),
                presence_penalty: Number(process.env.PERPLEXITY_PRESENCE_PENALTY),
                frequency_penalty: Number(process.env.PERPLEXITY_FREQUENCY_PENALTY)
              },
              { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } }
            );
            console.log(`[${new Date().toISOString()}] [summarizer] Received mini summary for chunk ${idx+1}`);
            return (resp.data.choices?.[0]?.message?.content || resp.data.text || '').trim();
          } catch (err) {
            console.error(`[${new Date().toISOString()}] [summarizer] Error on chunk ${idx+1}:`, err.response?.status, err.message);
            console.warn(`[${new Date().toISOString()}] [summarizer] Falling back to raw chunk content for chunk ${idx+1}`);
            let fallback = chunk.slice(0, Math.min(chunk.length, 500)).trim();
            if (!/[.?!]$/.test(fallback)) fallback += '...';
            return fallback;
          }
        })
      );
      console.log(`[${new Date().toISOString()}] [summarizer] Generated ${miniSummaries.length}/${chunks.length} mini summaries`);
      // Debug: preview mini summaries
      console.log(`[miniSummaries debug] total ${miniSummaries.length}`);
      miniSummaries.forEach((sum, i) => {
        console.log(`[mini debug] ${i+1}/${miniSummaries.length}: ${sum.slice(0,100).replace(/\n/g, ' ')}`);
      });

      // Compare mini-summary to original chunk sizes
      console.log('--- Chunk summary length comparison ---');
      chunks.forEach((chunk, i) => {
        const s = miniSummaries[i] || '';
        console.log(`Chunk ${i+1}: original ${chunk.length} chars, summary ${s.length} chars, ratio ${(s.length/chunk.length*100).toFixed(1)}%`);
      });

      // Build comparison data for JSON output
      const comparisons = chunks.map((chunk, i) => {
        const s = miniSummaries[i] || '';
        return {
          chunk: i+1,
          originalLength: chunk.length,
          summaryLength: s.length,
          ratio: Number((s.length / chunk.length * 100).toFixed(1))
        };
      });

      // Determine consolidation strategy
      const useHierarchical = process.env.USE_HIERARCHICAL === 'true';

      // Final refine step with skip for small chunk counts
      let finalSummary = '';
      if (useMock) {
        console.log(`[${new Date().toISOString()}] [summarizer] Using mock final summary`);
        finalSummary = miniSummaries.join(' ');
      } else if (chunks.length <= 2) {
        console.log(`[${new Date().toISOString()}] [summarizer] Skipping final refine for ${chunks.length} chunks`);
        finalSummary = miniSummaries.join(' ');
      } else if (useHierarchical) {
        console.log(`[${new Date().toISOString()}] [summarizer] Using hierarchical summarization`);
        try {
          const batchSize = parseInt(process.env.HIERARCHY_BATCH_SIZE, 10) || 2;
          const intermediateSummaries = [];
          for (let i = 0; i < miniSummaries.length; i += batchSize) {
            const group = miniSummaries.slice(i, i + batchSize);
            const groupContent = group.join('\n\n---\n\n');
            const resp = await axios.post(
              process.env.PERPLEXITY_ENDPOINT,
              {
                model: process.env.PERPLEXITY_MODEL,
                messages: [
                  { role: 'system', content: 'You are an expert summarizer. Compile **all bullet points and numeric details** from the following chunk summaries. Organize them under section headings matching the original chunk order. Do not omit or abbreviate any items. Preserve the original level of detail.' },
                  { role: 'user', content: groupContent }
                ],
                max_tokens: Number(process.env.PERPLEXITY_FINAL_MAX_TOKENS || process.env.PERPLEXITY_MAX_TOKENS * 2),
                temperature: Number(process.env.PERPLEXITY_TEMPERATURE),
                top_p: Number(process.env.PERPLEXITY_TOP_P),
                presence_penalty: Number(process.env.PERPLEXITY_PRESENCE_PENALTY),
                frequency_penalty: Number(process.env.PERPLEXITY_FREQUENCY_PENALTY)
              },
              { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } }
            );
            const choice = resp.data.choices?.[0];
            intermediateSummaries.push((choice?.message?.content || resp.data.text || '').trim());
          }
          // Merge intermediate summaries
          const finalContent = intermediateSummaries.join('\n\n---\n\n');
          const finalResp = await axios.post(
            process.env.PERPLEXITY_ENDPOINT,
            {
              model: process.env.PERPLEXITY_MODEL,
              messages: [
                { role: 'system', content: 'You are an expert summarizer. Compile **all bullet points and numeric details** from the following intermediate summaries. Organize them under section headings matching the original order. Do not omit or abbreviate any items. Preserve the original level of detail.' },
                { role: 'user', content: finalContent }
              ],
              max_tokens: Number(process.env.PERPLEXITY_FINAL_MAX_TOKENS || process.env.PERPLEXITY_MAX_TOKENS * 2),
              temperature: Number(process.env.PERPLEXITY_TEMPERATURE),
              top_p: Number(process.env.PERPLEXITY_TOP_P),
              presence_penalty: Number(process.env.PERPLEXITY_PRESENCE_PENALTY),
              frequency_penalty: Number(process.env.PERPLEXITY_FREQUENCY_PENALTY)
            },
            { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } }
          );
          const finalChoice = finalResp.data.choices?.[0];
          finalSummary = (finalChoice?.message?.content || finalResp.data.text || '').trim();
        } catch (err) {
          console.error(`[${new Date().toISOString()}] [summarizer] Error hierarchical summarization:`, err);
          finalSummary = miniSummaries.join('\n\n');
        }
      } else {
        console.log(`[${new Date().toISOString()}] [summarizer] Sending final refine request`);
        try {
          const concat = miniSummaries.join('\n\n---\n\n');
          // Primary final summary request with extended token budget and explicit no-truncate instruction
          const refine = await axios.post(
            process.env.PERPLEXITY_ENDPOINT,
            {
              model: process.env.PERPLEXITY_MODEL,
              messages: [
                { role: 'system', content: 'You are an expert summarizer. Combine the following chunk summaries into one coherent overview using only the provided summaries. Do not introduce external information, examples, or citations. Ensure sentences are complete.' },
                { role: 'user', content: concat }
              ],
              max_tokens: Number(process.env.PERPLEXITY_FINAL_MAX_TOKENS || process.env.PERPLEXITY_MAX_TOKENS * 2),
              temperature: Number(process.env.PERPLEXITY_TEMPERATURE),
              top_p: Number(process.env.PERPLEXITY_TOP_P),
              presence_penalty: Number(process.env.PERPLEXITY_PRESENCE_PENALTY),
              frequency_penalty: Number(process.env.PERPLEXITY_FREQUENCY_PENALTY)
            },
            { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } }
          );
          // Collect initial summary and finish reason
          const choice = refine.data.choices?.[0];
          let initialSummary = choice?.message?.content || refine.data.text || miniSummaries.join('\n\n');
          finalSummary = initialSummary.trim();
          let finishReason = choice?.finish_reason;
          let attempt = 0;
          // Retry continuation up to 3 times if truncated
          while ((finishReason === 'length' || !/[.?!]$/.test(finalSummary)) && attempt < 3) {
            console.log(`[${new Date().toISOString()}] [summarizer] Final summary truncated (reason=${finishReason}), continuation attempt ${attempt+1}`);
            try {
              const contResp = await axios.post(
                process.env.PERPLEXITY_ENDPOINT,
                {
                  model: process.env.PERPLEXITY_MODEL,
                  messages: [
                    { role: 'system', content: 'You are an expert summarizer. Continue the summary using only the provided content. Do not add external information, examples, or citations. Complete any incomplete sentences and ensure proper punctuation.' },
                    { role: 'user', content: finalSummary }
                  ],
                  max_tokens: Number(process.env.PERPLEXITY_FINAL_MAX_TOKENS || process.env.PERPLEXITY_MAX_TOKENS * 2),
                  temperature: Number(process.env.PERPLEXITY_TEMPERATURE),
                  top_p: Number(process.env.PERPLEXITY_TOP_P),
                  presence_penalty: Number(process.env.PERPLEXITY_PRESENCE_PENALTY),
                  frequency_penalty: Number(process.env.PERPLEXITY_FREQUENCY_PENALTY)
                },
                { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } }
              );
              const contChoice = contResp.data.choices?.[0];
              const contText = contChoice?.message?.content || contResp.data.text || '';
              finalSummary += ' ' + contText.trim();
              finishReason = contChoice?.finish_reason;
              if (finishReason !== 'length' && /[.?!]$/.test(finalSummary)) break;
            } catch (e) {
              console.error(`[${new Date().toISOString()}] [summarizer] Error during continuation attempt:`, e);
              break;
            }
            attempt++;
          }
          console.log(`[${new Date().toISOString()}] [summarizer] Received final summary`);
        } catch (err) {
          console.error(`[${new Date().toISOString()}] [summarizer] Error refining summary:`, err);
          finalSummary = miniSummaries.join('\n\n');
        }
      }

      // Final polish pass for cohesion without removing any content
      if (!useMock) {
        console.log(`[${new Date().toISOString()}] [summarizer] Polishing summary for flow without removing content`);
        try {
          const polishResp = await axios.post(
            process.env.PERPLEXITY_ENDPOINT,
            {
              model: process.env.PERPLEXITY_MODEL,
              messages: [
                { role: 'system', content: 'You are an expert summarizer. Rewrite the following summary to improve cohesion and flow. Do not remove or shorten any content; preserve all information exactly. Only adjust phrasing.' },
                { role: 'user', content: finalSummary }
              ],
              max_tokens: Number(process.env.PERPLEXITY_FINAL_MAX_TOKENS || process.env.PERPLEXITY_MAX_TOKENS * 2),
              temperature: Number(process.env.PERPLEXITY_TEMPERATURE),
              top_p: Number(process.env.PERPLEXITY_TOP_P),
              presence_penalty: Number(process.env.PERPLEXITY_PRESENCE_PENALTY),
              frequency_penalty: Number(process.env.PERPLEXITY_FREQUENCY_PENALTY)
            },
            { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } }
          );
          const polishChoice = polishResp.data.choices?.[0];
          if (polishChoice?.message?.content) {
            finalSummary = polishChoice.message.content.trim();
          }
        } catch (e) {
          console.error(`[${new Date().toISOString()}] [summarizer] Error during polish pass:`, e);
        }
      }

      // Ensure finalSummary ends with proper punctuation
      finalSummary = finalSummary.trim();
      if (!/[.?!]$/.test(finalSummary)) {
        finalSummary += '.';
      }

      // Write out JSON
      const result = {
        fileName: path.basename(filePath),
        processedAt: new Date().toISOString(),
        chunkComparisons: comparisons,
        chunkSummaries: miniSummaries,
        finalSummary
      };
      const outFile = path.join(summaryDir, `${path.basename(filePath, path.extname(filePath))}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
      console.log(`[${new Date().toISOString()}] [summarizer] Wrote summary: ${outFile}`);
      // Move processed file
      if (processedDir) {
        const dest = path.join(processedDir, path.basename(filePath));
        if (fs.existsSync(filePath)) {
          fs.renameSync(filePath, dest);
          console.log(`[${new Date().toISOString()}] [summarizer] Moved file to processed: ${dest}`);
        } else {
          console.warn(`[${new Date().toISOString()}] [summarizer] File not found, skipping move: ${filePath}`);
        }
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [summarizer] Error processing ${filePath}:`, error);
    }
  });

  // endpoint to list summaries
  app.get('/api/summaries', async (req, res) => {
    try {
      const files = await fs.promises.readdir(summaryDir);
      const summaries = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async f => {
            const content = await fs.promises.readFile(path.join(summaryDir, f), 'utf-8');
            return JSON.parse(content);
          })
      );
      res.json(summaries);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [summarizer] Error listing summaries:`, error);
      res.status(500).json({ error: error.message });
    }
  });
};
