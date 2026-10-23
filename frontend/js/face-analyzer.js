/**
 * face-analyzer.js — Face AI Analyzer
 * Sends captured/uploaded image to the backend for face detection & analysis.
 * Shows face count, quality, symmetry estimate, and optional landmarks note.
 * No personality/ethnicity/health inference.
 */

import { showLoading, hideLoading, toast, showResult, handleError, abortController, setAbortController } from './app.js';
import { api } from './api.js';
import { cameraState, stopCamera } from './camera.js';

const state = {
  file: null,
  analyzing: false,
};

const selectors = {
  analyzeBtn: '#faceAnalyzeBtn',
  resetBtn: '#faceResetBtn',
  preview: '#facePreview',
  results: '#faceResults',
  status: '#faceStatus',
  fileInput: '#faceFileInput',
};

function $(s) {
  return document.querySelector(s);
}

/* ---------- Init ---------- */
export function initFaceAnalyzer() {
  const analyzeBtn = $(selectors.analyzeBtn);
  const resetBtn = $(selectors.resetBtn);
  const preview = $(selectors.preview);
  const fileInput = $(selectors.fileInput);

  analyzeBtn.addEventListener('click', () => {
    const file = cameraState.previewBlob;
    if (!file) {
      toast('Please capture or upload a photo first.', 'info');
      return;
    }
    runAnalysis(file);
  });

  resetBtn.addEventListener('click', () => {
    const results = $(selectors.results);
    results.classList.add('hidden');
    results.innerHTML = '';
    resetBtn.style.display = 'none';
  });
}

/* ---------- Analysis ---------- */
async function runAnalysis(file) {
  const btn = $(selectors.analyzeBtn);
  const results = $(selectors.results);
  const status = $(selectors.status);

  state.file = file;
  state.analyzing = true;
  btn.disabled = true;
  results.classList.add('hidden');
  results.innerHTML = '';
  resetBtn.style.display = 'none';
  status.textContent = 'Detecting faces…';

  const ctrl = new AbortController();
  setAbortController(ctrl);

  showLoading('Analyzing faces…', 'This may take a few seconds', true, () => {
    ctrl.abort();
  });

  try {
    const resp = await api.analyzeFace(file, {
      landmarks: true,
      quality: true,
      timeout: 60000,
      signal: ctrl.signal,
    });

    hideLoading();
    setAbortController(null);
    state.analyzing = false;
    btn.disabled = false;

    renderResults(resp.data);
    status.textContent = 'Analysis complete.';
    resetBtn.style.display = 'inline-block';
  } catch (err) {
    hideLoading();
    setAbortController(null);
    state.analyzing = false;
    btn.disabled = false;
    if (err.name === 'AbortError' || (err instanceof Error && err.message && err.message.includes('timed out'))) {
      status.textContent = 'Analysis timed out.';
      toast('Analysis timed out. Try a smaller image.', 'error');
    } else {
      handleError(err, 'Face analysis failed.');
      status.textContent = 'Analysis failed.';
    }
  }
}

/* ---------- Render results ---------- */
function renderResults(data) {
  const results = $(selectors.results);
  const faceCount = data.face_count || data.faces || 0;
  const faces = Array.isArray(data.faces) ? data.faces : [];
  const quality = data.quality || {};
  const symmetry = data.symmetry || {};

  let html = '';

  // Summary stat
  html += `
    <div class="result-stat">
      <div class="stat-value">${faceCount}</div>
      <div class="stat-label">Face${faceCount !== 1 ? 's' : ''} detected</div>
    </div>
  `;

  // Quality
  if (quality && Object.keys(quality).length) {
    const qScore = quality.score != null ? quality.score : null;
    const qLabel = quality.label || (qScore != null ? (qScore >= 70 ? 'Good' : qScore >= 40 ? 'Fair' : 'Low') : '—');
    html += `
      <div class="result-stat">
        <div class="stat-value">${qScore != null ? qScore + '%' : '—'}</div>
        <div class="stat-label">Image quality · ${escapeHtml(qLabel)}</div>
      </div>
    `;
  }

  // Symmetry (carefully explained, not a beauty score)
  if (symmetry && Object.keys(symmetry).length) {
    const sScore = symmetry.score != null ? symmetry.score : null;
    html += `
      <div class="result-stat">
        <div class="stat-value">${sScore != null ? sScore + '%' : '—'}</div>
        <div class="stat-label">Facial symmetry estimate</div>
      </div>
      <p class="landmarks-note">
        Symmetry is a geometric estimate based on detected facial landmarks. It is not a measure of beauty,
        attractiveness, health, or personal worth. Lighting, angle, and expression affect the result.
      </p>
    `;
  }

  // Individual faces / landmarks note
  if (faces.length) {
    html += `<div class="landmarks-note" style="margin-top:var(--space-md);">${faces.length} face region${faces.length !== 1 ? 's' : ''} located. Landmark visualization is available on the server-processed image (download if provided).</div>`;
  } else {
    html += `<div style="text-align:center;color:var(--color-text-muted);font-size:var(--fs-sm);padding:var(--space-lg);">No faces detected. Try a well-lit, frontal photo.</div>`;
  }

  // Download processed image if server returned one
  if (data.image_url || data.download_url) {
    html += `
      <div class="image-actions" style="margin-top:var(--space-lg); justify-content:center;">
        <button class="btn btn--primary btn--full" onclick="window.photoStudioAPI.api.downloadFaceResult('${escapeAttr(data.image_url || data.download_url)}')">View analyzed image</button>
      </div>
    `;
  }

  results.innerHTML = html;
  results.classList.remove('hidden');
}

// Expose a download helper on the API object for the result modal button
window.photoStudioAPI = window.photoStudioAPI || {};
window.photoStudioAPI.api = window.photoStudioAPI.api || {};
window.photoStudioAPI.api.downloadFaceResult = function (url) {
  // Best-effort: open or fetch. Since binary handled via blob, fetch then download.
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'analyzed-face.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    })
    .catch(() => {
      // If cross-origin or fails, just open in new tab
      try { window.open(url, '_blank'); } catch (e) {}
    });
};

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
function escapeAttr(text) {
  return String(text).replace(/"/g, '&quot;');
}
