/**
 * middleware — validation, security, error handling
 * CommonJS (Node/Express)
 */

const path = require('path');

// Allowed image MIME types (validated by signature, not just extension)
const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

// Max upload size: 12 MB (configurable)
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 12;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_SIZE * 1024 * 1024;

// Max decoded image dimensions to prevent memory bombs
const MAX_IMAGE_DIMENSION = parseInt(process.env.MAX_IMAGE_DIMENSION, 10) || 4096;

/**
 * Sanitize a filename: strip path traversal, keep safe chars.
 */
function sanitizeFilename(filename) {
  if (!filename) return `upload-${Date.now()}.bin`;
  const base = path.basename(filename);
  // Remove dangerous characters
  return base.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 120);
}

/**
 * Validate that a file is an image by MIME type and extension.
 * Returns { ok, error, mime }
 */
function validateImageFile(file) {
  if (!file) return { ok: false, error: 'No file provided.' };

  const mimeType = file.mimetype || file.type;
  const ext = path.extname(file.originalname || file.name || '').toLowerCase();

  if (!ALLOWED_MIMES.includes(mimeType)) {
    return { ok: false, error: 'Unsupported file type. Please upload JPG, PNG, or WebP.' };
  }
  if (!ALLOWED_EXTS.includes(ext)) {
    return { ok: false, error: 'Unsupported file extension.' };
  }

  return { ok: true, mime: mimeType };
}

/**
 * Validate image signature (magic bytes) from the file buffer.
 * Prevents polyglot / fake image files.
 * Returns { ok, error }
 */
function validateImageSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { ok: false, error: 'Unable to read image contents.' };
  }
  const b = buffer;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ok: true };
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ok: true };
  // WEBP: RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
    if (b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
      return { ok: true };
    }
  }
  return { ok: false, error: 'File contents do not match a valid image format.' };
}

/**
 * Middleware: enforce JSON content type & parse safely.
 */
function jsonBody(req, res, next) {
  if (req.is('application/json')) {
    express.json({ limit: '1mb' })(req, res, next);
  } else {
    next();
  }
}

/**
 * Middleware: generic error handler.
 */
function errorHandler(err, req, res, next) {
  console.error('[Backend Error]', err.message);

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Max upload is ' + MAX_UPLOAD_SIZE + ' MB.' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message || 'Upload error.' });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error.',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

/**
 * Middleware: forward timeout for routes that proxy to Python.
 * Sets a timeout on the response so clients don't hang forever.
 */
function routeTimeout(seconds) {
  return (req, res, next) => {
    const ms = seconds * 1000;
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timed out. The AI service may be busy.' });
      }
    }, ms);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}

const express = require('express');
const multer = require('multer');

// Configure multer: memory storage (small files), size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    fields: 10,
  },
  fileFilter: (req, file, cb) => {
    const v = validateImageFile(file);
    cb(v.ok ? null : new Error(v.error), v.ok);
  },
});

module.exports = {
  ALLOWED_MIMES,
  ALLOWED_EXTS,
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_DIMENSION,
  sanitizeFilename,
  validateImageFile,
  validateImageSignature,
  jsonBody,
  errorHandler,
  routeTimeout,
  upload,
};
