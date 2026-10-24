/**
 * API configuration and client layer
 * Single environment/configuration layer for all API endpoints.
 * Frontend stays independent of hosting provider.
 * Supports HTTPS endpoints and relative paths for Capacitor/APK packaging.
 */

const API_CONFIG = (() => {
  const DEFAULT_TIMEOUT = 30000;
  const STORAGE_KEY = 'photoStudio.apiBase';

  // Try to read a data-api-base attribute from a script tag or meta tag
  function readConfigAttribute() {
    if (typeof document === 'undefined') return null;
    const el = document.querySelector('script[data-api-base], meta[name="api-base"]');
    if (!el) return null;
    return el.getAttribute('data-api-base') || el.getAttribute('content');
  }

  return {
    // Resolve base URL: stored override > data attribute > current origin (relative)
    getBaseURL() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return stored;
      } catch (e) {
        // localStorage unavailable (private mode etc.)
      }
      const attr = readConfigAttribute();
      if (attr) return attr;
      // Default: same origin (relative). Works on Android WebView with Capacitor
      // when the backend is configured to the actual hosted URL.
      return window.location.origin;
    },

    setBaseURL(url) {
      try {
        localStorage.setItem(STORAGE_KEY, url);
      } catch (e) {
        // ignore
      }
    },

    clearBaseURL() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        // ignore
      }
    },

    timeout: DEFAULT_TIMEOUT,

    endpoints: {
      health: '/api/health',
      faceAnalyze: '/api/face/analyze',
      imageEnhance: '/api/image/enhance',
      imageOptimize: '/api/image/optimize',
      imageFilter: '/api/image/filter',
    },

    buildURL(path) {
      const base = this.getBaseURL();
      // Normalize: strip trailing slash from base, leading slash from path
      return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
    },
  };
})();

/**
 * Lightweight fetch wrapper with timeout, retry, and clear error handling.
 * No large image payloads in JSON: binary responses handled via blob.
 */
class APIError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.details = details;
  }
}

async function fetchWithTimeout(input, init = {}) {
  const { timeout = API_CONFIG.timeout, signal, ...rest } = init;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Merge external signal with timeout abort
  const combinedSignal = signal
    ? new AbortSignalAny([signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(input, {
      ...rest,
      signal: combinedSignal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new APIError('Request timed out. The server may be busy or offline.', 0, 'timeout');
    }
    throw new APIError('Network error. Please check your connection and try again.', 0, 'network');
  }
}

// AbortSignal.any polyfill helper
function AbortSignalAny(signals) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.any) {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener(
      'abort',
      () => controller.abort(s.reason),
      { once: true }
    );
  }
  return controller.signal;
}

/**
 * Parse response body depending on content type.
 * Returns { ok, status, data, contentType }
 */
async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  let data;

  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (e) {
      data = null;
    }
  } else if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
    data = await response.blob();
  } else {
    try {
      data = await response.text();
    } catch (e) {
      data = null;
    }
  }

  return { ok: response.ok, status: response.status, data, contentType, headers: response.headers };
}

async function request(method, path, options = {}) {
  const { body, headers = {}, timeout, signal, formData, json, expectBlob = false } = options;
  const url = API_CONFIG.buildURL(path);

  const fetchInit = {
    method,
    signal,
    headers: { ...headers },
    timeout,
  };

  if (formData instanceof FormData) {
    // Do not set Content-Type; browser sets boundary for multipart
    fetchInit.body = formData;
  } else if (json !== undefined) {
    fetchInit.headers['Content-Type'] = 'application/json';
    fetchInit.body = JSON.stringify(json);
  } else if (body !== undefined) {
    fetchInit.body = body;
  }

  const response = await fetchWithTimeout(url, fetchInit);
  const parsed = await parseResponse(response);

  if (!parsed.ok) {
    let message = `Request failed (${parsed.status})`;
    let details = null;
    if (parsed.data && typeof parsed.data === 'object') {
      message = parsed.data.error || parsed.data.message || message;
      details = parsed.data;
    } else if (typeof parsed.data === 'string') {
      message = parsed.data || message;
    }
    throw new APIError(message, parsed.status, details);
  }

  return parsed;
}

const api = {
  health() {
    return request('GET', API_CONFIG.endpoints.health);
  },

  // Face analysis: sends image file, returns JSON result
  analyzeFace(file, options = {}) {
    const formData = new FormData();
    formData.append('image', file);
    if (options.landmarks !== undefined) formData.append('landmarks', String(options.landmarks));
    if (options.quality !== undefined) formData.append('quality', String(options.quality));
    return request('POST', API_CONFIG.endpoints.faceAnalyze, {
      formData,
      timeout: options.timeout || 60000,
      signal: options.signal,
    });
  },

  // Image enhancement: sends image file, returns binary image or JSON
  enhanceImage(file, options = {}) {
    const formData = new FormData();
    formData.append('image', file);
    if (options.type) formData.append('type', options.type); // standard, hd, upscale2x, upscale4x
    if (options.brightness !== undefined) formData.append('brightness', String(options.brightness));
    if (options.contrast !== undefined) formData.append('contrast', String(options.contrast));
    if (options.sharpness !== undefined) formData.append('sharpness', String(options.sharpness));
    if (options.denoise !== undefined) formData.append('denoise', String(options.denoise));
    if (options.scale !== undefined) formData.append('scale', String(options.scale));
    return request('POST', API_CONFIG.endpoints.imageEnhance, {
      formData,
      timeout: options.timeout || 120000,
      signal: options.signal,
      expectBlob: true,
    });
  },

  // Image optimization
  optimizeImage(file, options = {}) {
    const formData = new FormData();
    formData.append('image', file);
    if (options.format) formData.append('format', options.format);
    if (options.quality !== undefined) formData.append('quality', String(options.quality));
    if (options.width !== undefined) formData.append('width', String(options.width));
    if (options.height !== undefined) formData.append('height', String(options.height));
    if (options.preserveAspect !== undefined) formData.append('preserve_aspect', String(options.preserveAspect));
    return request('POST', API_CONFIG.endpoints.imageOptimize, {
      formData,
      timeout: options.timeout || 60000,
      signal: options.signal,
      expectBlob: true,
    });
  },

  // Apply filter
  applyFilter(file, options = {}) {
    const formData = new FormData();
    formData.append('image', file);
    if (options.filter) formData.append('filter', options.filter);
    if (options.intensity !== undefined) formData.append('intensity', String(options.intensity));
    return request('POST', API_CONFIG.endpoints.imageFilter, {
      formData,
      timeout: options.timeout || 60000,
      signal: options.signal,
      expectBlob: true,
    });
  },

  // Create an object URL from a blob response and revoke after download
  createDownloadURL(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  },
};

export { API_CONFIG, APIError, api };
