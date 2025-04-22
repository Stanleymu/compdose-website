const chokidar = require('chokidar');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// Emitter for new file events
const emitter = new EventEmitter();

module.exports = (app, { uploadDir }) => {
  // Initial pass: process existing files in uploadDir
  fs.readdir(uploadDir, (err, files) => {
    if (!err) {
      files
        .filter(f => !/(^|[\/\\])\../.test(f))
        .forEach(file => {
          const filePath = path.join(uploadDir, file);
          console.log(`[${new Date().toISOString()}] [watcher] Initial file found: ${filePath}`);
          // small delay to ensure write completion
          setTimeout(() => emitter.emit('fileAdded', filePath), 100);
        });
    }
  });

  const watcher = chokidar.watch(uploadDir, {
    persistent: true,
    ignoreInitial: true,
    ignored: /(^|[\/\\])\../,
  });

  watcher.on('add', filePath => {
    console.log(`[${new Date().toISOString()}] [watcher] File added: ${filePath}`);
    // small delay to ensure write completion
    setTimeout(() => emitter.emit('fileAdded', filePath), 100);
  });

  return emitter;
};

module.exports.emitter = emitter;
