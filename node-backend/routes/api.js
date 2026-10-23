/**
 * routes/api.js — Node.js Express routes
 * Validates uploads, forwards to Python AI service, returns results.
 */

const express = require('express');
const router = express.Router();
const { upload, validateImageFile, validateImageSignature, routeTimeout, errorHandler } = require('../middleware');
const { forwardToPython, PYTHON_API_URL } = require('../services/proxy');

const { v4: uuidv4 } = require('uuid');

// Health
router.get('/health', async (req, res) => {
  // Check Python service reachability
  let pythonReachable = false;
  let pythonMessage = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(PYTHON_API_URL + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    pythonReachable = r.ok;
    pythonMessage = r.statusText;
  } catch (e) {
    pythonReachable = false;
    pythonMessage = e.message;
  }
  res.json({
    status: 'ok',
    service: 'node-backend',
    python: {
      reachable: pythonReachable,
      url: PYTHON_API_URL,
      message: pythonMessage,
    },
    timestamp: new Date().toISOString(),
  });
});

// ---- Face analyze ----
router.post(
  '/face/analyze',
  upload.single('image'),
  routeTimeout(60),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }
      const validation = validateImageFile(req.file);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }
      const sig = validateImageSignature(req.file.buffer);
      if (!sig.ok) {
        return res.status(400).json({ error: sig.error });
      }

      const fields = {};
      if (req.body.landmarks !== undefined) fields.landmarks = req.body.landmarks;
      if (req.body.quality !== undefined) fields.quality = req.body.quality;

      const result = await forwardToPython('/face/analyze', req.file, fields, {
        timeoutMs: 60000,
      });

      if (result.data instanceof Blob) {
        // Unexpected binary; convert to base64 JSON small or return buffer
        const buf = Buffer.from(await result.data.arrayBuffer());
        return res.status(200).json({ ok: true, image: buf.toString('base64'), contentType: result.contentType });
      }
      res.status(200).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Image enhance ----
router.post(
  '/image/enhance',
  upload.single('image'),
  routeTimeout(120),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }
      const validation = validateImageFile(req.file);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }
      const sig = validateImageSignature(req.file.buffer);
      if (!sig.ok) {
        return res.status(400).json({ error: sig.error });
      }

      const fields = {
        type: req.body.type || 'standard',
        brightness: req.body.brightness,
        contrast: req.body.contrast,
        sharpness: req.body.sharpness,
        denoise: req.body.denoise,
        scale: req.body.scale,
      };

      const result = await forwardToPython('/image/enhance', req.file, fields, {
        timeoutMs: 120000,
      });

      // Return binary image
      if (result.data instanceof Blob) {
        const buf = Buffer.from(await result.data.arrayBuffer());
        res.set('Content-Type', result.contentType || 'image/jpeg');
        res.set('Cache-Control', 'no-store');
        return res.status(200).send(buf);
      }
      res.status(200).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Image optimize ----
router.post(
  '/image/optimize',
  upload.single('image'),
  routeTimeout(60),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }
      const validation = validateImageFile(req.file);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }
      const sig = validateImageSignature(req.file.buffer);
      if (!sig.ok) {
        return res.status(400).json({ error: sig.error });
      }

      const fields = {
        format: req.body.format || 'webp',
        quality: req.body.quality,
        width: req.body.width,
        height: req.body.height,
        preserve_aspect: req.body.preserve_aspect !== undefined ? req.body.preserve_aspect : 'true',
      };

      const result = await forwardToPython('/image/optimize', req.file, fields, {
        timeoutMs: 60000,
      });

      if (result.data instanceof Blob) {
        const buf = Buffer.from(await result.data.arrayBuffer());
        res.set('Content-Type', result.contentType || 'image/webp');
        res.set('Cache-Control', 'no-store');
        return res.status(200).send(buf);
      }
      res.status(200).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Image filter ----
router.post(
  '/image/filter',
  upload.single('image'),
  routeTimeout(60),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }
      const validation = validateImageFile(req.file);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }
      const sig = validateImageSignature(req.file.buffer);
      if (!sig.ok) {
        return res.status(400).json({ error: sig.error });
      }

      const fields = {
        filter: req.body.filter || 'natural',
        intensity: req.body.intensity,
      };

      const result = await forwardToPython('/image/filter', req.file, fields, {
        timeoutMs: 60000,
      });

      if (result.data instanceof Blob) {
        const buf = Buffer.from(await result.data.arrayBuffer());
        res.set('Content-Type', result.contentType || 'image/jpeg');
        res.set('Cache-Control', 'no-store');
        return res.status(200).send(buf);
      }
      res.status(200).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
