const fs = require('fs');
const path = require('path');
const express = require('express');

/**
 * Simplified summarizer module that only serves pre-generated summary files
 * External processes are responsible for generating summary JSON files
 * and placing them in the summaries directory
 */
module.exports = (app, { summaryDir }) => {
  // Ensure summary directory exists
  if (!fs.existsSync(summaryDir)) {
    fs.mkdirSync(summaryDir, { recursive: true });
  }

  // Serve static summary files
  app.use('/summaries', express.static(summaryDir));

  // Endpoint to list all available summaries
  app.get('/api/summaries', async (req, res) => {
    try {
      const files = await fs.promises.readdir(summaryDir);
      const summaries = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => fs.promises.readFile(path.join(summaryDir, f), 'utf-8')
            .then(content => {
              try {
                return JSON.parse(content);
              } catch (parseErr) {
                console.error(`[${new Date().toISOString()}] [summarizer] Error parsing ${f}:`, parseErr);
                return {
                  fileName: f,
                  processedAt: new Date().toISOString(),
                  error: 'Invalid JSON format',
                  summary: 'Could not parse summary file.'
                };
              }
            })
          )
      );
      
      // Sort summaries by date (newest first)
      summaries.sort((a, b) => {
        const dateA = a.processedAt ? new Date(a.processedAt) : new Date(0);
        const dateB = b.processedAt ? new Date(b.processedAt) : new Date(0);
        return dateB - dateA;
      });
      
      res.json(summaries);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [summarizer] Error listing summaries:`, err);
      res.status(500).json({ error: err.message });
    }
  });

  console.log(`[${new Date().toISOString()}] [summarizer] Initialized in display-only mode. External summarization process required.`);
};
