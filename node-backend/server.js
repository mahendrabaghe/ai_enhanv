/**
 * server.js — Node.js Express entry point
 * Serves the frontend static files, proxies API to Python AI service.
 * CommonJS.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const apiRoutes = require('./routes/api');
const { errorHandler, MAX_UPLOAD_BYTES } = require('./middleware');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

// Trust proxy (Render sets X-Forwarded-Proto)
app.set('trust proxy', 1);

// CORS — restrict in production via FRONTEND_ORIGIN
const corsOptions = {
  origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN.split(','),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
  maxAge: 86400,
};
app.use(cors(corsOptions));

// Rate limiting (general)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use(generalLimiter);

// Stricter limit on heavy processing endpoints
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many processing requests. Please slow down.' },
});

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static frontend
const frontendDir = path.resolve(__dirname, '../frontend');
app.use(express.static(frontendDir));

// API routes (heavy limiter on processing endpoints)
app.use('/api', heavyLimiter, apiRoutes);

// Root — serve index.html for SPA-style navigation / direct access
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Node Backend] Listening on port ${PORT} (${NODE_ENV})`);
  console.log(`[Node Backend] Python API URL: ${process.env.PYTHON_API_URL || 'http://localhost:8000'}`);
});

module.exports = app;
