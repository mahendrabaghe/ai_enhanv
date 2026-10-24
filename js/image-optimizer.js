/**
 * image-optimizer.js — Image Optimizer
 * Compress & resize JPG/PNG/WebP with quality slider, format presets, size-reduction preview, download.
 * Never overwrites the original.
 */

import { showLoading, hideLoading, toast, handleError, abortController, setAbortController } from './app.js';
import { api } from './api.js';

const state = {
  file: null,
  previewURL: null,
  optimizedBlob: null,
  format: 'webp',
  quality: 85,
  width: null,
  preserveAspect: true,
  processing: false,
};

const selectors = {
  fileInput: '#optimizeFileInput',
  uploadArea: '#optimizeUploadArea',
  preview: '#optimizePreview',
  controls: '#optimizeControls',
  optimizeBtn: '#optimizeBtn',
  downloadBtn: '#optimizeDownloadBtn',
  info: '#optimizeInfo',
  status: '#optimizeStatus',
  formatButtons: '#optFormatButtons',
  quality: '#optQuality',
  qualityVal: '#optQualityVal',
  width: '#optWidth',
  preset: '#optPreset',
};

function $(s) {
  return document.querySelector(s);
}

/* ---------- Init ---------- */
export function initImageOptimizer() {
  const fileInput = $(selectors.fileInput);
  const uploadArea = $(selectors.uploadArea);
  const optimizeBtn = $(selectors.optimizeBtn);
  const downloadBtn = $(selectors.downloadBtn);
  const preset = $(selectors.preset);

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    handleSelectedFile(file);
  });

  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) handleSelectedFile(files[0]);
  });

  // Format chips
  $(selectors.formatButtons).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-format]');
    if (!btn) return;
    $(selectors.formatButtons).querySelectorAll('button').forEach((b) => {
      b.classList.remove('btn--primary');
      b.classList.add('btn--outline');
    });
    btn.classList.remove('btn--outline');
    btn.classList.add('btn--primary');
    state.format = btn.getAttribute('data-format');
    $(selectors.info).textContent = `Format: ${state.format.toUpperCase()} · Quality: ${state.quality}%`;
  });

  // Quality slider
  $(selectors.quality).addEventListener('input', (e) => {
    state.quality = parseInt(e.target.value, 10);
    $(selectors.qualityVal).textContent = state.quality + '%';
    $(selectors.info).textContent = `Format: ${state.format.toUpperCase()} · Quality: ${state.quality}%`;
  });

  // Width
  $(selectors.width).addEventListener('input', (e) => {
    state.width = e.target.value ? parseInt(e.target.value, 10) : null;
  });

  // Preset
  preset.addEventListener('change', (e) => {
    const p = e.target.value;
    const widthEl = $(selectors.width);
    if (p === 'web') { widthEl.value = 1200; state.width = 1200; }
    else if (p === 'instagram') { widthEl.value = 1080; state.width = 1080; }
    else if (p === 'story') { widthEl.value = 1080; state.width = 1080; } // height handled separately if needed
    else if (p === 'thumb') { widthEl.value = 300; state.width = 300; }
    else { widthEl.value = ''; state.width = null; }
  });

  // Optimize
  optimizeBtn.addEventListener('click', () => {
    if (!state.file) {
      toast('Please upload a photo first.', 'info');
      return;
    }
    runOptimize();
  });

  // Download
  downloadBtn.addEventListener('click', () => {
    if (!state.optimizedBlob) return;
    const ext = state.format === 'jpeg' ? 'jpg' : state.format;
    api.createDownloadURL(state.optimizedBlob, `optimized-${Date.now()}.${ext}`);
  });
}

/* ---------- File handling ---------- */
function handleSelectedFile(file) {
  if (!isImageFile(file)) {
    toast('Please select a valid image (JPG, PNG, WebP).', 'error');
    return;
  }

  state.file = file;
  state.optimizedBlob = null;

  const preview = $(selectors.preview);
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${url}" alt="Original" style="width:100%;height:100%;object-fit:contain;background:#000;" />`;
  preview.style.display = 'block';

  $(selectors.controls).classList.remove('hidden');
  $(selectors.optimizeBtn).disabled = false;
  $(selectors.downloadBtn).style.display = 'none';
  $(selectors.info).textContent = `Original: ${formatBytes(file.size)} · ${file.type}`;
  $(selectors.status).textContent = '';
}

/* ---------- Optimize ---------- */
async function runOptimize() {
  const btn = $(selectors.optimizeBtn);
  const status = $(selectors.status);
  const downloadBtn = $(selectors.downloadBtn);

  state.processing = true;
  btn.disabled = true;
  downloadBtn.style.display = 'none';
  status.textContent = 'Optimizing image…';

  const ctrl = new AbortController();
  setAbortController(ctrl);

  showLoading('Optimizing image…', 'Compressing & resizing', true, () => ctrl.abort());

  try {
    const resp = await api.optimizeImage(state.file, {
      format: state.format,
      quality: state.quality,
      width: state.width,
      height: null,
      preserve_aspect: state.preserveAspect,
      timeout: 60000,
      signal: ctrl.signal,
    });

    hideLoading();
    setAbortController(null);
    state.processing = false;
    btn.disabled = false;

    if (resp.data instanceof Blob) {
      state.optimizedBlob = resp.data;
      const origSize = state.file.size;
      const newSize = resp.data.size;
      const reduction = origSize > 0 ? Math.round(((origSize - newSize) / origSize) * 100) : 0;

      downloadBtn.style.display = 'block';
      status.textContent = `Optimized: ${formatBytes(newSize)} (${reduction}% smaller).`;
      $(selectors.info).textContent = `Original: ${formatBytes(origSize)} → Optimized: ${formatBytes(newSize)} (${reduction}% smaller)`;
      toast('Image optimized', 'success');

      // Show optimized preview (replace with blob URL)
      const preview = $(selectors.preview);
      preview.innerHTML = `<img src="${URL.createObjectURL(resp.data)}" alt="Optimized" style="width:100%;height:100%;object-fit:contain;background:#000;" />`;
    } else {
      toast('Optimization completed.', 'success');
      status.textContent = 'Optimization complete.';
    }
  } catch (err) {
    hideLoading();
    setAbortController(null);
    state.processing = false;
    btn.disabled = false;
    handleError(err, 'Optimization failed.');
    status.textContent = 'Optimization failed.';
  }
}

/* ---------- Helpers ---------- */
function isImageFile(file) {
  return /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

window.photoStudioAPI = window.photoStudioAPI || {};
