/**
 * camera.js — Camera preview, capture, switch camera, permission handling.
 * Requests camera access only when the user taps the camera button.
 * Graceful fallback on permission denial.
 */

import { showLoading, hideLoading, toast, showResult, handleError, setAbortController, getAbortController } from './app.js';
import { api } from './api.js';

const state = {
  stream: null,
  facingMode: 'environment', // 'environment' (rear) or 'user' (front)
  videoEl: null,
  containerEl: null,
  overlayEl: null,
  facingEl: null,
  captureBtn: null,
  switchBtn: null,
  isActive: false,
  previewBlob: null, // captured photo blob
};

const selectors = {
  container: '#faceCameraContainer',
  video: '#faceVideo',
  overlay: '#faceCameraOverlay',
  facing: '#faceCameraFacing',
  capture: '#faceCapture',
  switchCam: '#faceSwitchCam',
  fileInput: '#faceFileInput',
  uploadArea: '#faceUploadArea',
  analyzeBtn: '#faceAnalyzeBtn',
  resetBtn: '#faceResetBtn',
  preview: '#facePreview',
  status: '#faceStatus',
};

function $(s) {
  return document.querySelector(s);
}

/* ---------- Init ---------- */
export function initCamera() {
  const video = $(selectors.video);
  const container = $(selectors.container);
  const overlay = $(selectors.overlay);
  const facing = $(selectors.facing);
  const capture = $(selectors.capture);
  const switchCam = $(selectors.switchCam);
  const fileInput = $(selectors.fileInput);
  const uploadArea = $(selectors.uploadArea);
  const analyzeBtn = $(selectors.analyzeBtn);
  const resetBtn = $(selectors.resetBtn);
  const preview = $(selectors.preview);
  const status = $(selectors.status);

  if (!video || !container) return;

  state.videoEl = video;
  state.containerEl = container;
  state.overlayEl = overlay;
  state.facingEl = facing;
  state.captureBtn = capture;
  state.switchBtn = switchCam;

  // Capture button
  capture.addEventListener('click', async () => {
    if (!state.stream) return;
    await capturePhoto();
  });

  // Switch camera
  switchCam.addEventListener('click', async () => {
    if (!state.stream) return;
    state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    await startStream();
  });

  // File upload (gallery)
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!isImageFile(file)) {
      toast('Please select a valid image file (JPG, PNG, WebP).', 'error');
      return;
    }
    stopStream();
    showPreviewFromFile(file);
    state.previewBlob = file;
    analyzeBtn.disabled = false;
    status.textContent = 'Photo ready. Tap Analyze Face.';
  });

  // Drag & drop on upload area
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) {
      const file = files[0];
      if (!isImageFile(file)) {
        toast('Please drop a valid image file.', 'error');
        return;
      }
      stopStream();
      showPreviewFromFile(file);
      state.previewBlob = file;
      analyzeBtn.disabled = false;
      status.textContent = 'Photo ready. Tap Analyze Face.';
    }
  });

  resetBtn.addEventListener('click', () => {
    resetFaceUI();
  });
}

/* ---------- Stream management ---------- */
async function startStream() {
  stopStream();

  const constraints = {
    video: {
      facingMode: state.facingMode,
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };

  try {
    showLoading('Opening camera…', 'Requesting camera permission', false);
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    hideLoading();
    state.stream = stream;
    state.videoEl.srcObject = stream;
    await state.videoEl.play();
    state.isActive = true;
    updateFacingLabel();
    state.overlayEl.style.display = 'none';
    state.containerEl.style.display = 'block';
    state.captureBtn.style.display = 'block';
    state.switchBtn.style.display = 'block';
  } catch (err) {
    hideLoading();
    handleCameraError(err);
  }
}

function handleCameraError(err) {
  let message = 'Camera access is required to use live capture.';
  let fallbackShown = false;

  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
    message = 'Camera permission was denied. You can still upload a photo from your gallery instead.';
    fallbackShown = true;
  } else if (err.name === 'NotFoundError') {
    message = 'No camera found on this device. Use gallery upload instead.';
    fallbackShown = true;
  } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
    message = 'Camera is in use by another app. Close it and try again.';
    fallbackShown = true;
  } else if (err.name === 'OverconstrainedError') {
    message = 'Camera constraints not supported. Trying default settings…';
    // retry without facing mode
    retryStreamDefault();
    return;
  } else {
    message = 'Could not start the camera. Please try again.';
  }

  toast(message, fallbackShown ? 'info' : 'error');
  state.containerEl.style.display = 'none';
  state.overlayEl.style.display = 'flex';
  state.overlayEl.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-md);color:#fff;text-align:center;padding:var(--space-lg);">
      <div style="font-size:2rem;">${fallbackShown ? '📷' : '⚠️'}</div>
      <div style="font-weight:var(--fw-medium);">${escapeHtml(message)}</div>
      <button class="btn btn--outline" id="camRetryBtn" style="margin-top:var(--space-md);">Try again</button>
    </div>
  `;
  const retryBtn = document.getElementById('camRetryBtn');
  if (retryBtn) retryBtn.addEventListener('click', startStream);
}

function retryStreamDefault() {
  const orig = state.facingMode;
  state.facingMode = '';
  startStream().catch(() => {
    state.facingMode = orig;
  });
}

async function capturePhoto() {
  if (!state.stream || !state.videoEl.videoWidth) {
    toast('Camera not ready yet.', 'error');
    return;
  }

  const ctrl = new AbortController();
  setAbortController(ctrl);
  showLoading('Capturing photo…', 'Please hold still', true, () => ctrl.abort());

  try {
    const track = state.stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    const width = state.videoEl.videoWidth || 1280;
    const height = state.videoEl.videoHeight || 720;

    // Use ImageCapture API if available for higher-res still capture
    if (window.ImageCapture) {
      try {
        const imageCapture = new ImageCapture(track);
        const photo = await imageCapture.takePhoto();
        hideLoading();
        setAbortController(null);
        handleCapturedBlob(photo);
        return;
      } catch (e) {
        // fall back to canvas snapshot
      }
    }

    // Canvas snapshot fallback
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(state.videoEl, 0, 0, width, height);

    // Convert to blob with quality control
    canvas.toBlob((blob) => {
      if (ctrl.signal.aborted) return;
      hideLoading();
      setAbortController(null);
      if (!blob) {
        toast('Failed to capture photo.', 'error');
        return;
      }
      handleCapturedBlob(blob);
    }, 'image/jpeg', 0.9);
  } catch (err) {
    hideLoading();
    setAbortController(null);
    toast('Capture failed. Please try again.', 'error');
  }
}

function handleCapturedBlob(blob) {
  state.previewBlob = blob;
  const url = URL.createObjectURL(blob);
  const preview = $(selectors.preview);
  preview.innerHTML = `<img src="${url}" alt="Captured photo" style="width:100%;height:100%;object-fit:cover;" />`;
  preview.style.display = 'block';
  $(selectors.analyzeBtn).disabled = false;
  $(selectors.status).textContent = 'Photo captured. Tap Analyze Face.';
  toast('Photo captured', 'success');
}

function showPreviewFromFile(file) {
  const url = URL.createObjectURL(file);
  const preview = $(selectors.preview);
  preview.innerHTML = `<img src="${url}" alt="Uploaded photo" style="width:100%;height:100%;object-fit:cover;" />`;
  preview.style.display = 'block';
}

function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  state.videoEl.srcObject = null;
  state.isActive = false;
  state.containerEl.style.display = 'none';
  state.overlayEl.style.display = 'flex';
  state.overlayEl.innerHTML = `
    <div class="camera-hint">Tap the camera button to start</div>
  `;
  state.captureBtn.style.display = 'none';
  state.switchBtn.style.display = 'none';
}

function resetFaceUI() {
  stopStream();
  state.previewBlob = null;
  const preview = $(selectors.preview);
  preview.style.display = 'none';
  preview.innerHTML = '';
  $(selectors.analyzeBtn).disabled = true;
  $(selectors.resetBtn).style.display = 'none';
  $(selectors.status).textContent = '';
  const results = document.getElementById('faceResults');
  if (results) {
    results.classList.add('hidden');
    results.innerHTML = '';
  }
}

/* ---------- Helpers ---------- */
function isImageFile(file) {
  return /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
}

function updateFacingLabel() {
  if (state.facingEl) {
    state.facingEl.textContent = state.facingMode === 'environment' ? 'Rear' : 'Front';
  }
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

/* Expose for other modules */
export const cameraState = state;
export { stopStream as stopCamera, startStream as startCamera };
