const dotenv = require('dotenv');
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

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
const UPLOAD_DIR = path.join(__dirname, 'upload');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const SUMMARY_DIR = path.join(__dirname, 'summaries');
const PROCESSED_DIR = path.join(__dirname, 'processed');
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOAD_DIR });

// Upload endpoint using multer
app.post('/upload', upload.single('file'), (req, res) => {
  console.log(`[${new Date().toISOString()}] [upload] File saved: ${req.file.path}`);
  res.json({ fileName: req.file.filename });
});

// Homepage route
app.get('/', (req, res) => {
  res.render('index');
});

// Initialize modular components (to be implemented)
require('./watcher')(app, { uploadDir: UPLOAD_DIR });
require('./summarizer')(app, { summaryDir: SUMMARY_DIR, processedDir: PROCESSED_DIR });

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
