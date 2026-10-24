/**
 * filters.js — Filters Studio
 * Apply filters via backend (Pillow/OpenCV) so the exported image actually reflects the filter.
 * Intensity slider, reset, original preview, download.
 */

import { showLoading, hideLoading, toast, handleError, abortController, setAbortController } from './app.js';
import { api } from './api.js';

const FILTERS = {
  natural: { label: 'Natural' },
  warm: { label: 'Warm' },
  cool: { label: 'Cool' },
  vintage: { label: 'Vintage' },
  cinematic: { label: 'Cinematic' },
  bw: { label: 'Black & White' },
  brightness: { label: 'Brightness' },
  contrast: { label: 'Contrast' },
  saturation: { label: 'Saturation' },
  sharpness: { label: 'Sharpness' },
  blur: { label: 'Blur' },
};

const state = {
  file: null,
  previewURL: null,
  filteredBlob: null,
  filter: 'natural',
  intensity: 100,
  processing: false,
};

const selectors = {
  fileInput: '#filterFileInput',
  uploadArea: '#filterUploadArea',
  preview: '#filterPreview',
  controls: '#filterControls',
  filterBtn: '#filterBtn',
  downloadBtn: '#filterDownloadBtn',
  resetBtn: '#filterResetBtn',
  status: '#filterStatus',
  filterButtons: '#filterButtons',
  intensity: '#filterIntensity',
  intensityVal: '#filterIntensityVal',
  nameBadge: '#filterNameBadge',
};

function $(s) {
  return document.querySelector(s);
}

/* ---------- Init ---------- */
export function initFilters() {
  const fileInput = $(selectors.fileInput);
  const uploadArea = $(selectors.uploadArea);
  const filterBtn = $(selectors.filterBtn);
  const downloadBtn = $(selectors.downloadBtn);
  const resetBtn = $(selectors.resetBtn);

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

  // Filter chips
  $(selectors.filterButtons).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    $(selectors.filterButtons).querySelectorAll('button').forEach((b) => {
      b.classList.remove('btn--primary');
      b.classList.add('btn--outline');
    });
    btn.classList.remove('btn--outline');
    btn.classList.add('btn--primary');
    state.filter = btn.getAttribute('data-filter');
    $(selectors.nameBadge).textContent = (FILTERS[state.filter] && FILTERS[state.filter].label) || state.filter;
    $(selectors.filterBtn).disabled = false;
  });

  // Intensity slider
  $(selectors.intensity).addEventListener('input', (e) => {
    state.intensity = parseInt(e.target.value, 10);
    $(selectors.intensityVal).textContent = state.intensity + '%';
  });

  // Apply
  filterBtn.addEventListener('click', () => {
    if (!state.file) {
      toast('Please upload a photo first.', 'info');
      return;
    }
    runFilter();
  });

  // Download
  downloadBtn.addEventListener('click', () => {
    if (!state.filteredBlob) return;
    api.createDownloadURL(state.filteredBlob, `filtered-${state.filter}-${Date.now()}.jpg`);
  });

  // Reset
  resetBtn.addEventListener('click', () => {
    const preview = $(selectors.preview);
    preview.innerHTML = `<img src="${state.previewURL}" alt="Original" style="width:100%;height:100%;object-fit:contain;background:#000;" />`;
    preview.style.display = 'block';
    $(selectors.downloadBtn).style.display = 'none';
    $(selectors.resetBtn).style.display = 'none';
    $(selectors.filterBtn).disabled = false;
    $(selectors.status).textContent = '';
    state.filteredBlob = null;
  });
}

/* ---------- File handling ---------- */
function handleSelectedFile(file) {
  if (!isImageFile(file)) {
    toast('Please select a valid image (JPG, PNG, WebP).', 'error');
    return;
  }

  state.file = file;
  state.filteredBlob = null;

  const preview = $(selectors.preview);
  const url = URL.createObjectURL(file);
  state.previewURL = url;
  preview.innerHTML = `<img src="${url}" alt="Original" style="width:100%;height:100%;object-fit:contain;background:#000;" />`;
  preview.style.display = 'block';

  $(selectors.controls).classList.remove('hidden');
  $(selectors.filterBtn).disabled = false;
  $(selectors.downloadBtn).style.display = 'none';
  $(selectors.resetBtn).style.display = 'none';
  $(selectors.status).textContent = '';
}

/* ---------- Apply filter ---------- */
async function runFilter() {
  const btn = $(selectors.filterBtn);
  const status = $(selectors.status);
  const downloadBtn = $(selectors.downloadBtn);
  const resetBtn = $(selectors.resetBtn);

  state.processing = true;
  btn.disabled = true;
  downloadBtn.style.display = 'none';
  resetBtn.style.display = 'none';
  status.textContent = 'Applying filter…';

  const ctrl = new AbortController();
  setAbortController(ctrl);

  showLoading('Applying filter…', FILTERS[state.filter].label, true, () => ctrl.abort());

  try {
    const resp = await api.applyFilter(state.file, {
      filter: state.filter,
      intensity: state.intensity,
      timeout: 60000,
      signal: ctrl.signal,
    });

    hideLoading();
    setAbortController(null);
    state.processing = false;
    btn.disabled = false;

    if (resp.data instanceof Blob) {
      state.filteredBlob = resp.data;
      const preview = $(selectors.preview);
      const filteredURL = URL.createObjectURL(resp.data);
      preview.innerHTML = `<img src="${filteredURL}" alt="Filtered" style="width:100%;height:100%;object-fit:contain;background:#000;" />`;
      preview.style.display = 'block';
      downloadBtn.style.display = 'block';
      resetBtn.style.display = 'block';
      status.textContent = `Filter applied: ${FILTERS[state.filter].label}.`;
      toast('Filter applied', 'success');
    } else {
      toast('Filter applied.', 'success');
      status.textContent = 'Filter applied.';
    }
  } catch (err) {
    hideLoading();
    setAbortController(null);
    state.processing = false;
    btn.disabled = false;
    handleError(err, 'Filter failed.');
    status.textContent = 'Filter failed.';
  }
}

/* ---------- Helpers ---------- */
function isImageFile(file) {
  return /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
}

window.photoStudioAPI = window.photoStudioAPI || {};
