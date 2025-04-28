const fs = require('fs');
const path = require('path');
const express = require('express');
const pdfParse = require('pdf-parse');
const watcher = require('./watcher');
const emitter = watcher.emitter;

require('dotenv').config();
const { orchestrateText } = require('./utils/orchestrator');

module.exports = (app, { summaryDir, processedDir }) => {
  if (!fs.existsSync(summaryDir)) {
    fs.mkdirSync(summaryDir, { recursive: true });
  }
  if (processedDir && !fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  app.use('/summaries', express.static(summaryDir));

  emitter.on('fileAdded', async filePath => {
    console.log(`[${new Date().toISOString()}] [summarizer] Processing file: ${filePath}`);
    try {
      const data = await pdfParse(fs.readFileSync(filePath));
      let rawText = data.text;
      const paras = rawText.split(/\r?\n\s*\r?\n/);
      if (paras.length > 1 && paras[0].length < 1000) {
        console.log(`[${new Date().toISOString()}] [summarizer] Dropping header`);
        rawText = paras.slice(1).join('\n\n');
      }
      const summaryJson = await orchestrateText(rawText);

      const result = {
        fileName: path.basename(filePath),
        processedAt: new Date().toISOString(),
        summary: summaryJson
      };
      const outFile = path.join(summaryDir, `${path.basename(filePath, path.extname(filePath))}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
      console.log(`[${new Date().toISOString()}] [summarizer] Wrote summary: ${outFile}`);

      if (processedDir) {
        const dest = path.join(processedDir, path.basename(filePath));
        if (fs.existsSync(filePath)) {
          fs.renameSync(filePath, dest);
          console.log(`[${new Date().toISOString()}] [summarizer] Moved file to processed: ${dest}`);
        }
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [summarizer] Error processing ${filePath}:`, error);
    }
  });

  app.get('/api/summaries', async (req, res) => {
    try {
      const files = await fs.promises.readdir(summaryDir);
      const summaries = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => fs.promises.readFile(path.join(summaryDir, f), 'utf-8').then(JSON.parse))
      );
      res.json(summaries);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [summarizer] Error listing summaries:`, err);
      res.status(500).json({ error: err.message });
    }
  });
};
