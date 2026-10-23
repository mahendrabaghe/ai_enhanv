# Lightweight AI Face Analyzer & 4K Photo Studio

Mobile-first, premium photo editing web app with Node.js + Python FastAPI backends.
Designed for Android, desktop, and future Capacitor APK packaging.

## Project Structure

```
photo edit/
├── frontend/                 # Capacitor-compatible frontend (HTML/CSS/Vanilla JS)
│   ├── index.html
│   ├── manifest.json         # PWA manifest
│   ├── service-worker.js     # Safe static asset caching (no user images)
│   ├── css/style.css         # Premium lavender/pink/violet theme, dark mode
│   └── js/
│       ├── app.js            # Core controller (nav, theme, toasts, modals)
│       ├── api.js            # API config & client (single config layer)
│       ├── camera.js         # Camera preview, capture, switch, permissions
│       ├── face-analyzer.js  # Face analysis UI
│       ├── image-enhancer.js # Enhancer, before/after compare, download
│       ├── image-optimizer.js# Compress/resize optimizer
│       └── filters.js        # Filters studio
├── node-backend/             # Express.js API gateway
│   ├── server.js
│   ├── routes/api.js
│   ├── middleware/index.js   # Validation, security, error handling
│   ├── services/proxy.js     # Proxies to Python AI service
│   ├── package.json
│   └── .env.example
├── python-ai/                # FastAPI AI service
│   ├── main.py               # Face detection, enhancement, optimize, filters
│   ├── requirements.txt
│   └── .env.example
├── README.md
└── .gitignore
```

## Quick Start (Local)

### 1. Python AI service
```bash
cd "photo edit/python-ai"
cp .env.example .env
python -m venv venv
# Windows: venv\Scripts\activate
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Node.js backend
```bash
cd "photo edit/node-backend"
cp .env.example .env
# Set PYTHON_API_URL=http://localhost:8000 in .env
npm install
npm start   # http://localhost:3000
```

### 3. Open the app
Visit `http://localhost:3000` in your browser.

The frontend is served by the Node backend. It also works by opening `frontend/index.html` directly (API defaults to current origin).

## Render Deployment

Deploy **two separate Web Services** on Render:

### Python FastAPI Service
- Runtime: Python 3
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Env: `PORT`, `CORS_ORIGINS` (set to your Node/ frontend URL), `LOG_LEVEL`

### Node.js Express Service
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Env: `PORT`, `PYTHON_API_URL` (your Python service URL), `FRONTEND_ORIGIN` (your frontend URL), `NODE_ENV=production`

Connect them by setting the Node service's `PYTHON_API_URL` to the Python service's Render URL.

## Android APK (Capacitor) — Future Steps

The frontend is hosting-independent and uses relative paths + a single API config layer.

1. Initialize Capacitor in `frontend/`:
   ```bash
   cd frontend
   npm init -y
   npm install @capacitor/core @capacitor/cli
   npx cap init
   ```
2. Add Android:
   ```bash
   npm install @capacitor/android
   npx cap add android
   ```
3. Configure `capacitor.config.ts`:
   - `appId`, `appName`, `webDir` = `../frontend` (or `.` if inside frontend)
   - Set `server.url` to your production Render URL (never `localhost` on Android).
4. Add Android camera permission in `android/app/src/main/AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.CAMERA" />
   ```
5. Build APK:
   ```bash
   npx cap copy
   npx cap open android
   # Then Build > Build Bundle(s) / APK(s) in Android Studio
   ```

See `APK_GUIDE` section below for details.

## Features

- **Face AI Analyzer**: Live camera preview, face detection with bounding boxes, photo capture + gallery upload, face count, image-quality analysis, facial symmetry estimate (geometric only — not a beauty/worth measure).
- **Photo Enhancer**: Standard / HD / 2× / 4× upscaling, brightness, contrast, sharpness, denoise, before/after comparison, download.
- **Image Optimizer**: JPG/PNG/WebP compression, adjustable quality, custom resize, aspect-ratio preservation, web/social presets, size-reduction %, download.
- **Filters Studio**: Natural, Warm, Cool, Vintage, Cinematic, Black & White, Brightness, Contrast, Saturation, Sharpness, Blur — intensity slider, reset, download. Filters affect the exported image.
- Premium dark/light theme, mobile-first responsive, bottom nav (mobile) / top nav (desktop), PWA manifest + service worker.

## Security & Privacy

- HTTPS in production, CORS configured, MIME/signature validation, filename sanitization, upload size & dimension limits, temp-file cleanup after processing.
- No permanent image storage, no database, no user accounts, no facial data logging.
- Images processed in-memory where possible; temp files deleted after each request.

## Limitations

- Face detection uses OpenCV Haar cascades (frontal faces work best; profile/low-light faces may be missed).
- Super-resolution is lightweight LANCZOS upscaling by default. Real-ESRGAN is optional and resource-heavy (enable only with sufficient RAM/CPU).
- Render free tier may spin down services; first request after sleep can be slow.
- No guaranteed 4K output on low-memory devices — depends on input size and server resources.
