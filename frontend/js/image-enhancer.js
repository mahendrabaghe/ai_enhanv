/**
 * image-enhancer.js — Photo Enhancer
 * Upload → adjust brightness/contrast/sharpness/denoise → enhance via backend → before/after compare → download.
 * Standard enhancement is the lightweight default; HD/2×/4× upscaling are explicit user actions.
 */

import { showLoading, hideLoading, toast, showResult, handleError, abortController, setAbortController } from './app.js';
import { api } from './api.js';

const state = {
  file: null,
  previewURL: null,
  enhancedURL: null,
  enhancedBlob: null,
  type: 'standard',
  brightness: 100,
  contrast: 100,
  sharpness: 100,
  denoise: 0,
  processing: false,
};

const selectors = {
  fileInput: '#enhanceFileInput',
  uploadArea: '#enhanceUploadArea',
  preview: '#enhancePreview',
  controls: '#enhanceControls',
  typeButtons: '#enhanceTypeButtons',
  enhanceBtn: '#enhanceBtn',
  downloadBtn: '#enhanceDownloadBtn',
  info: '#enhanceInfo',
  status: '#enhanceStatus',
  // sliders
  brightness: '#enhBrightness',
  brightnessVal: '#enhBrightnessVal',
  contrast: '#enhContrast',
  contrastVal: '#enhContrastVal',
  sharpness: '#enhSharpness',
  sharpnessVal: '#enhSharpnessVal',
  denoise: '#enhDenoise',
  denoiseVal: '#enhDenoiseVal',
};

function $(s) {
  return document.querySelector(s);
}

/* ---------- Init ---------- */
export function initImageEnhancer() {
  const fileInput = $(selectors.fileInput);
  const uploadArea = $(selectors.uploadArea);
  const preview = $(selectors.preview);
  const enhanceBtn = $(selectors.enhanceBtn);
  const downloadBtn = $(selectors.downloadBtn);
  const typeButtons = $(selectors.typeButtons);

  // File input
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    handleSelectedFile(file);
  });

  // Drag & drop
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) handleSelectedFile(files[0]);
  });

  // Enhancement type
  typeButtons.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    $(selectors.typeButtons).querySelectorAll('button').forEach((b) => {
      b.classList.remove('btn--primary');
      b.classList.add('btn--outline');
    });
    btn.classList.remove('btn--outline');
    btn.classList.add('btn--primary');
    state.type = btn.getAttribute('data-type');
  });

  // Sliders with debounce
  const sliders = ['brightness', 'contrast', 'sharpness', 'denoise'];
  let debounceTimer;
  sliders.forEach((key) => {
    const el = $(selectors[key]);
    const valEl = $(selectors[key + 'Val']);
    el.addEventListener('input', () => {
      state[key] = parseInt(el.value, 10);
      valEl.textContent = key === 'denoise' ? state[key] + '%' : state[key] + '%';
      // debounced local preview update skipped (server-side only) — keep lightweight
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // no-op: preview handled server-side on enhance click
      }, 150);
    });
  });

  // Enhance
  enhanceBtn.addEventListener('click', () => {
    if (!state.file) {
      toast('Please upload a photo first.', 'info');
      return;
    }
    runEnhance();
  });

  // Download
  downloadBtn.addEventListener('click', () => {
    if (!state.enhancedBlob) return;
    const name = `enhanced-${Date.now()}.jpg`;
    api.createDownloadURL(state.enhancedBlob, name);
  });
}

/* ---------- File handling ---------- */
function handleSelectedFile(file) {
  if (!isImageFile(file)) {
    toast('Please select a valid image (JPG, PNG, WebP).', 'error');
    return;
  }

  state.file = file;
  state.enhancedBlob = null;
  state.enhancedURL = null;

  const preview = $(selectors.preview);
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${url}" alt="Original" style="width:100%;height:100%;object-fit:contain;background:#000;" />`;
  preview.style.display = 'block';

  $(selectors.controls).classList.remove('hidden');
  $(selectors.enhanceBtn).disabled = false;
  $(selectors.downloadBtn).style.display = 'none';
  $(selectors.info).textContent = `${formatBytes(file.size)} · ${file.type}`;
  $(selectors.status).textContent = '';

  // Reset any compare UI
  resetCompare();
}

/* ---------- Enhance ---------- */
async function runEnhance() {
  const btn = $(selectors.enhanceBtn);
  const status = $(selectors.status);
  const downloadBtn = $(selectors.downloadBtn);
  const preview = $(selectors.preview);

  state.processing = true;
  btn.disabled = true;
  downloadBtn.style.display = 'none';
  status.textContent = 'Enhancing image…';

  const ctrl = new AbortController();
  setAbortController(ctrl);

  // Determine scale
  let scale = 1;
  if (state.type === 'upscale2x') scale = 2;
  else if (state.type === 'upscale4x') scale = 4;

  showLoading('Enhancing photo…', `Applying ${state.type} enhancement`, true, () => ctrl.abort());

  try {
    const resp = await api.enhanceImage(state.file, {
      type: state.type,
      brightness: state.brightness,
      contrast: state.contrast,
      sharpness: state.sharpness,
      denoise: state.denoise,
      scale,
      timeout: 120000,
      signal: ctrl.signal,
    });

    hideLoading();
    setAbortController(null);
    state.processing = false;
    btn.disabled = false;

    // Backend returns binary image
    if (resp.data instanceof Blob) {
      state.enhancedBlob = resp.data;
      state.enhancedURL = URL.createObjectURL(resp.data);

      // Show before/after compare
      showCompare(preview, state.enhancedURL);

      downloadBtn.style.display = 'block';
      status.textContent = `Enhancement complete (${formatBytes(resp.data.size)}).`;
      toast('Image enhanced', 'success');
    } else {
      // Fallback: JSON with a URL
      const imageUrl = resp.data && (resp.data.image_url || resp.data.download_url);
      if (imageUrl) {
        fetch(imageUrl).then((r) => r.blob()).then((blob) => {
          state.enhancedBlob = blob;
          state.enhancedURL = URL.createObjectURL(blob);
          showCompare(preview, state.enhancedURL);
          downloadBtn.style.display = 'block';
          status.textContent = 'Enhancement complete.';
          toast('Image enhanced', 'success');
        }).catch(() => {
          toast('Enhancement completed but could not load result.', 'error');
        });
      } else {
        toast('Enhancement completed.', 'success');
        status.textContent = 'Enhancement complete.';
      }
    }
  } catch (err) {
    hideLoading();
    setAbortController(null);
    state.processing = false;
    btn.disabled = false;
    if (err instanceof Error && err.message && err.message.includes('timed out')) {
      status.textContent = 'Enhancement timed out.';
      toast('Enhancement timed out. Try "Standard" or a smaller image.', 'error');
    } else {
      handleError(err, 'Enhancement failed.');
      status.textContent = 'Enhancement failed.';
    }
  }
}

/* ---------- Before/After compare ---------- */
function showCompare(previewEl, afterURL) {
  const beforeURL = state.previewURL || (previewEl.querySelector('img') && previewEl.querySelector('img').src);
  // Build compare wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'compare-wrapper compare-left';

  const beforeImg = document.createElement('img');
  beforeImg.src = beforeURL;
  beforeImg.alt = 'Before';
  beforeImg.style.width = '100%';
  beforeImg.style.height = '100%';
  beforeImg.style.objectFit = 'contain';
  beforeImg.style.background = '#000';

  const afterImg = document.createElement('img');
  afterImg.src = afterURL;
  afterImg.alt = 'After';
  afterImg.style.width = '100%';
  afterImg.style.height = '100%';
  afterImg.style.objectFit = 'contain';
  afterImg.style.background = '#000';

  const slider = document.createElement('div');
  slider.className = 'compare-slider';

  const handle = document.createElement('div');
  handle.className = 'compare-handle';

  const leftLabel = document.createElement('div');
  leftLabel.className = 'compare-label';
  leftLabel.textContent = 'Before';

  const rightLabel = document.createElement('div');
  rightLabel.className = 'compare-label';
  rightLabel.textContent = 'After';

  wrapper.appendChild(beforeImg);
  wrapper.appendChild(afterImg);
  wrapper.appendChild(slider);
  slider.appendChild(handle);
  wrapper.appendChild(leftLabel);
  wrapper.appendChild(rightLabel);

  // Replace preview content with compare
  previewEl.innerHTML = '';
  previewEl.appendChild(wrapper);

  // Draggable slider
  let active = false;
  const move = (e) => {
    if (!active) return;
    const rect = wrapper.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    wrapper.classList.remove('compare-left');
    wrapper.classList.add('compare-right');
    afterImg.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    slider.style.left = pct + '%';
    handle.style.left = pct + '%';
  };
  const start = () => { active = true; };
  const stop = () => { active = false; };

  wrapper.addEventListener('mousedown', start);
  wrapper.addEventListener('touchstart', start, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', stop);
  window.addEventListener('touchend', stop);

  // Initial state: show after fully
  afterImg.style.clipPath = 'inset(0 0 0 0)';
  slider.style.left = '100%';
  handle.style.left = '100%';
}

function resetCompare() {
  const preview = $(selectors.preview);
  preview.innerHTML = '';
  preview.style.display = 'none';
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
