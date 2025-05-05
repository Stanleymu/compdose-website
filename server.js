const dotenv = require('dotenv');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();

// Middleware
app.use(express.json());
app.use('/stylesheets', express.static(path.join(__dirname, 'public/stylesheets')));
app.use('/scripts', express.static(path.join(__dirname, 'public/javascripts')));
app.use(express.static(path.join(__dirname, 'public')));

// Set up EJS view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Basic request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Configuration directories
const SUMMARY_DIR = path.join(__dirname, 'summaries');
if (!fs.existsSync(SUMMARY_DIR)) {
  fs.mkdirSync(SUMMARY_DIR, { recursive: true });
}

// Homepage route
app.get('/', (req, res) => {
  res.render('index');
});

// Initialize only the simplified summarizer without file watching or processing
require('./summarizer')(app, { summaryDir: SUMMARY_DIR });

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server running on http://localhost:${PORT}`);
  console.log(`[${new Date().toISOString()}] Summary files will be served from: ${SUMMARY_DIR}`);
  console.log(`[${new Date().toISOString()}] NOTE: External process required for generating summary files`);
});

module.exports = app;
