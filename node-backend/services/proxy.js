/**
 * services/proxy.js — Forwards multipart image requests to the Python FastAPI service.
 * Returns binary (blob) or JSON depending on the endpoint.
 * Uses Node native FormData/fetch (Node 24+) — no external form-data dependency.
 * Single source of truth for PYTHON_API_URL.
 */

const PYTHON_API_URL = (process.env.PYTHON_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

const REQUEST_TIMEOUT_MS = parseInt(process.env.PYTHON_REQUEST_TIMEOUT_MS, 10) || 120000;

/**
 * Build multipart FormData from a multer memory file.
 */
function buildFormData(fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  }
  if (file) {
    const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
    fd.append('image', blob, file.originalname || 'image.jpg');
  }
  return fd;
}

/**
 * Forward a multipart request to Python.
 * Returns parsed response: { ok, status, data (Blob or JSON), headers }
 */
async function forwardToPython(path, file, fields = {}, options = {}) {
  const url = PYTHON_API_URL + path;
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;

  const fd = buildFormData(fields, file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: fd,
      signal: controller.signal,
      headers: {}, // let fetch set multipart boundary
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('UPSTREAM_TIMEOUT');
    }
    throw new Error('UPSTREAM_UNREACHABLE: ' + err.message);
  } finally {
    clearTimeout(timeoutId);
  }

  const contentType = response.headers.get('content-type') || '';
  let data;

  if (contentType.includes('application/json')) {
    data = await response.json();
  } else if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
    const buffer = await response.arrayBuffer();
    data = new Blob([buffer], { type: contentType || 'application/octet-stream' });
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    let message = `Upstream error (${response.status})`;
    let details = null;
    if (typeof data === 'object' && data !== null && !(data instanceof Blob)) {
      message = data.error || data.message || message;
      details = data;
    }
    const e = new Error(message);
    e.status = response.status;
    e.details = details;
    throw e;
  }

  return { ok: true, status: response.status, data, contentType, headers: response.headers };
}

module.exports = {
  PYTHON_API_URL,
  forwardToPython,
  buildFormData,
};
