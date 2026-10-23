/**
 * app.js — Core app controller
 * Handles navigation, theme, toasts, modals, and global UI state.
 * Lightweight, dependency-free.
 */

const { API_CONFIG, api, APIError } = window.photoStudioAPI || {};

const els = {
  app: document.getElementById('app'),
  sections: document.querySelectorAll('.section'),
  navItems: document.querySelectorAll('.nav-item'),
  themeToggle: document.getElementById('themeToggle'),
  settingsBtn: document.getElementById('settingsBtn'),
  mainContent: document.getElementById('mainContent'),
  loadingModal: document.getElementById('loadingModal'),
  loadingTitle: document.getElementById('loadingTitle'),
  loadingSub: document.getElementById('loadingSub'),
  loadingBar: document.getElementById('loadingBar'),
  loadingCancel: document.getElementById('loadingCancel'),
  resultModal: document.getElementById('resultModal'),
  resultTitle: document.getElementById('resultTitle'),
  resultBody: document.getElementById('resultBody'),
  resultCloseBtn: document.getElementById('resultCloseBtn'),
  resultClose: document.getElementById('resultClose'),
  resultActionBtn: document.getElementById('resultActionBtn'),
  toastContainer: document.getElementById('toastContainer'),
  apiBaseInput: document.getElementById('apiBaseInput'),
  saveApiBtn: document.getElementById('saveApiBtn'),
  resetApiBtn: document.getElementById('resetApiBtn'),
};

let currentSection = 'home';
let abortController = null;

/* ---------- Theme ---------- */
function getSavedTheme() {
  try {
    return localStorage.getItem('photoStudio.theme');
  } catch (e) {
    return null;
  }
}
function setSavedTheme(v) {
  try { localStorage.setItem('photoStudio.theme', v); } catch (e) {}
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    els.themeToggle.textContent = '☀️';
  } else if (theme === 'light') {
    document.documentElement.removeAttribute('data-theme');
    els.themeToggle.textContent = '🌙';
  } else {
    // system
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
      els.themeToggle.textContent = '☀️';
    } else {
      document.documentElement.removeAttribute('data-theme');
      els.themeToggle.textContent = '🌙';
    }
  }
}

function initTheme() {
  const saved = getSavedTheme();
  applyTheme(saved || 'system');

  els.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    let next;
    if (!current) {
      // currently system/light; check system
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        next = 'light';
      } else {
        next = 'dark';
      }
    } else if (current === 'dark') {
      next = 'light';
    } else {
      next = 'system';
    }
    setSavedTheme(next === 'system' ? null : next);
    applyTheme(next);
  });

  // Listen for system theme changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!getSavedTheme()) applyTheme(e.matches ? 'dark' : 'light');
    });
  }
}

/* ---------- Navigation ---------- */
function showSection(id) {
  if (id === currentSection) return;
  // Hide all
  els.sections.forEach((s) => s.classList.add('hidden'));
  els.navItems.forEach((n) => {
    n.classList.remove('active');
    n.setAttribute('aria-current', 'false');
  });
  // Show target
  const target = document.getElementById(`section-${id}`);
  if (target) {
    target.classList.remove('hidden');
    target.scrollTop = 0;
  }
  const activeNav = document.querySelector(`.nav-item[data-section="${id}"]`);
  if (activeNav) {
    activeNav.classList.add('active');
    activeNav.setAttribute('aria-current', 'true');
  }
  currentSection = id;
}

function initNavigation() {
  els.navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const section = item.getAttribute('data-section');
      showSection(section);
      // Close any open camera on section leave handled by modules
    });
  });

  // Cards on home open sections
  document.querySelectorAll('[data-open]').forEach((card) => {
    card.addEventListener('click', () => {
      showSection(card.getAttribute('data-open'));
    });
  });

  // Settings button
  if (els.settingsBtn) {
    els.settingsBtn.addEventListener('click', () => showSection('settings'));
  }

  // Default
  showSection('home');
}

/* ---------- Toasts ---------- */
function toast(message, type = 'info', duration = 4000) {
  const container = els.toastContainer;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);
  // Force reflow
  el.offsetHeight;
  el.classList.add('show');

  const timer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);

  el.addEventListener('click', () => {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  });
}

/* ---------- Loading modal ---------- */
function showLoading(title, sub, cancelable, onCancel) {
  els.loadingModal.classList.add('open');
  els.loadingTitle.textContent = title || 'Processing…';
  els.loadingSub.textContent = sub || 'Please wait';
  if (els.loadingBar) els.loadingBar.style.width = '0%';
  if (cancelable && onCancel) {
    els.loadingCancel.style.display = 'block';
    els.loadingCancel.onclick = () => {
      hideLoading();
      onCancel();
    };
  } else {
    els.loadingCancel.style.display = 'none';
  }
  abortController = new AbortController();
}

function setLoadingProgress(pct) {
  if (els.loadingBar) els.loadingBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function hideLoading() {
  els.loadingModal.classList.remove('open');
  if (abortController) {
    try { abortController.abort(); } catch (e) {}
    abortController = null;
  }
}

/* ---------- Result modal ---------- */
function showResult(title, bodyHTML, actionLabel = 'Done', onAction) {
  els.resultTitle.textContent = title;
  els.resultBody.innerHTML = bodyHTML;
  els.resultActionBtn.textContent = actionLabel;
  els.resultActionBtn.onclick = (e) => {
    e.preventDefault();
    hideResult();
    if (onAction) onAction();
  };
  els.resultModal.classList.add('open');
}

function hideResult() {
  els.resultModal.classList.remove('open');
  els.resultBody.innerHTML = '';
}

/* ---------- Modal close handlers ---------- */
function initModals() {
  [els.resultClose, els.resultCloseBtn].forEach((b) => {
    if (b) b.addEventListener('click', hideResult);
  });
  // Click backdrop to close
  els.resultModal.addEventListener('click', (e) => {
    if (e.target === els.resultModal) hideResult();
  });
  els.loadingModal.addEventListener('click', (e) => {
    if (e.target === els.loadingModal) {
      // don't close loading by backdrop unless cancelable
    }
  });
}

/* ---------- API URL config ---------- */
function initAPIConfig() {
  const input = els.apiBaseInput;
  if (!input) return;
  input.value = API_CONFIG.getBaseURL() === window.location.origin ? '' : API_CONFIG.getBaseURL();

  els.saveApiBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (val) {
      try {
        new URL(val); // validate
      } catch (e) {
        toast('Invalid URL', 'error');
        return;
      }
      API_CONFIG.setBaseURL(val);
      toast('API URL saved', 'success');
    } else {
      API_CONFIG.clearBaseURL();
      input.value = '';
      toast('API URL reset to default', 'info');
    }
  });

  els.resetApiBtn.addEventListener('click', () => {
    API_CONFIG.clearBaseURL();
    input.value = '';
    toast('API URL reset', 'info');
  });
}

/* ---------- Global error handler ---------- */
function handleError(err, fallbackMessage) {
  hideLoading();
  let message = fallbackMessage || 'Something went wrong.';
  if (err instanceof APIError) {
    message = err.message || message;
    if (err.status === 0) {
      message = 'Unable to reach the server. Please check your connection and try again.';
    } else if (err.status >= 500) {
      message = 'The server is temporarily unavailable. Please try again later.';
    } else if (err.status === 413) {
      message = 'The image is too large. Please upload a smaller photo.';
    }
  } else {
    console.error(err);
  }
  toast(message, 'error');
}

/* ---------- Export ---------- */
function setAbortController(c) {
  abortController = c;
}
function getAbortController() {
  return abortController;
}

export {
  els,
  showSection,
  toast,
  showLoading,
  setLoadingProgress,
  hideLoading,
  showResult,
  hideResult,
  handleError,
  initTheme,
  initNavigation,
  initModals,
  initAPIConfig,
  setAbortController,
  getAbortController,
};
