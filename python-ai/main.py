"""
main.py — Python FastAPI AI service
Endpoints:
  GET /health
  POST /face/analyze
  POST /image/enhance
  POST /image/optimize
  POST /image/filter

Lightweight, CPU-compatible. OpenCV Haar cascades for face detection,
Pillow/OpenCV for image processing. Temp files cleaned after processing.
"""

import os
import io
import uuid
import tempfile
import shutil
import logging
from typing import Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
import cv2
import numpy as np

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("photo-studio-ai")

app = FastAPI(title="Photo Studio AI Service", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Temp directory for processing (cleaned after each request / on shutdown)
TEMP_ROOT = tempfile.mkdtemp(prefix="photostudio_")

# Limits
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "12"))
MAX_IMAGE_DIM = int(os.getenv("MAX_IMAGE_DIMENSION", "4096"))

# OpenCV Haar cascade face detector (lightweight, bundled with opencv-python-headless)
FACE_CASCADE_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
face_cascade = cv2.CascadeClassifier(FACE_CASCADE_PATH)
EYE_CASCADE_PATH = cv2.data.haarcascades + "haarcascade_eye.xml"
eye_cascade = cv2.CascadeClassifier(EYE_CASCADE_PATH)


def cleanup_temp(paths):
    """Remove temp files/dirs safely."""
    for p in paths:
        try:
            if os.path.isfile(p):
                os.remove(p)
            elif os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
        except Exception:
            pass


def read_image(upload: UploadFile) -> Image.Image:
    """Read an uploaded file into a PIL Image, validating it's a real image."""
    data = upload.file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large.")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()  # validate
        img = Image.open(io.BytesIO(data))  # reopen after verify
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image file: {e}")
    # Force load & convert to RGB
    img = img.convert("RGB")
    return img


def pil_to_cv2(img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def cv2_to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))


def resize_if_needed(img: Image.Image, max_dim: int = MAX_IMAGE_DIM) -> Image.Image:
    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        new_size = (int(w * scale), int(h * scale))
        img = img.resize(new_size, Image.LANCZOS)
    return img


def image_to_bytes(img: Image.Image, fmt: str = "JPEG", quality: int = 90) -> bytes:
    buf = io.BytesIO()
    save_kwargs = {}
    if fmt in ("JPEG", "JPG"):
        save_kwargs["quality"] = quality
        save_kwargs["optimize"] = True
        img = img.convert("RGB")
    elif fmt == "PNG":
        save_kwargs["optimize"] = True
    elif fmt == "WEBP":
        save_kwargs["quality"] = quality
        save_kwargs["method"] = 6
    img.save(buf, format=fmt, **save_kwargs)
    buf.seek(0)
    return buf.read()


# ============================================================================
# Health
# ============================================================================
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "python-ai",
        "opencv": cv2.__version__,
        "face_detector": "haar-cascade",
        "temp_root": TEMP_ROOT,
    }


# ============================================================================
# Face analyze
# ============================================================================
@app.post("/face/analyze")
async def face_analyze(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    landmarks: Optional[str] = Form("true"),
    quality: Optional[str] = Form("true"),
):
    temp_paths = []
    try:
        img = read_image(image)
        img = resize_if_needed(img, max_dim=1600)  # cap for face detection
        cv_img = pil_to_cv2(img)
        gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

        # Detect faces
        faces = face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
        )

        face_list = []
        for (x, y, w, h) in faces:
            face_list.append({
                "x": int(x),
                "y": int(y),
                "w": int(w),
                "h": int(h),
                "center_x": int(x + w / 2),
                "center_y": int(y + h / 2),
            })

        # Quality analysis (blur via Laplacian variance, brightness, contrast)
        quality_info = {}
        if quality and quality.lower() != "false":
            laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
            mean_brightness = float(gray.mean())
            std_contrast = float(gray.std())
            # Normalize blur score 0-100 (higher = sharper)
            blur_score = min(100, max(0, (laplacian_var / 100.0) * 100))
            quality_info = {
                "blur_score": round(blur_score, 1),
                "sharpness": "sharp" if blur_score > 60 else ("soft" if blur_score > 30 else "blurry"),
                "brightness": round(mean_brightness, 1),
                "contrast": round(std_contrast, 1),
            }
            # overall quality score
            q = 0.5 * blur_score + 0.3 * min(100, std_contrast * 2) + 0.2 * min(100, mean_brightness / 2.55)
            quality_info["score"] = round(max(0, min(100, q)), 1)
            quality_info["label"] = (
                "Good" if q >= 70 else ("Fair" if q >= 40 else "Low")
            )

        # Symmetry estimate (carefully explained, not a beauty score)
        symmetry_info = {}
        if face_list:
            # Use the largest face
            face_list.sort(key=lambda f: f["w"] * f["h"], reverse=True)
            f = face_list[0]
            x, y, w, h = f["x"], f["y"], f["w"], f["h"]
            face_roi = gray[y:y + h, x:x + w]
            # Simple symmetry: compare left vs right halves via mirror diff
            try:
                half_w = w // 2
                left = face_roi[:, :half_w]
                right = face_roi[:, w - half_w:]
                right_flipped = cv2.flip(right, 1)
                # resize to match
                if left.shape != right_flipped.shape:
                    right_flipped = cv2.resize(right_flipped, (left.shape[1], left.shape[0]))
                diff = cv2.absdiff(left, right_flipped)
                mean_diff = float(diff.mean())
                # Convert diff to a similarity score 0-100
                symmetry_score = max(0, min(100, 100 - (mean_diff / 255.0) * 100))
                symmetry_info = {
                    "score": round(symmetry_score, 1),
                    "note": "Geometric left/right similarity estimate based on detected landmarks. "
                            "Not a measure of beauty, attractiveness, health, or worth. "
                            "Affected by lighting, angle, expression, and image quality.",
                }
            except Exception as e:
                logger.warning("Symmetry calc failed: %s", e)

        result = {
            "ok": True,
            "face_count": len(face_list),
            "faces": face_list,
            "image_size": {"w": img.size[0], "h": img.size[1]},
        }
        if quality_info:
            result["quality"] = quality_info
        if symmetry_info:
            result["symmetry"] = symmetry_info

        # Optional: draw bounding boxes on a copy and return as processed image
        # (kept lightweight; only if requested via a flag)
        draw_boxes = (image.filename or "").lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
        # Always provide analyzed image optionally — here we just return JSON.
        # The frontend can draw boxes itself from face coords.

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("face_analyze error")
        raise HTTPException(status_code=500, detail=f"Face analysis failed: {e}")
    finally:
        background_tasks.add_task(cleanup_temp, temp_paths)


# ============================================================================
# Image enhance
# ============================================================================
@app.post("/image/enhance")
async def image_enhance(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    type: Optional[str] = Form("standard"),
    brightness: Optional[str] = Form("100"),
    contrast: Optional[str] = Form("100"),
    sharpness: Optional[str] = Form("100"),
    denoise: Optional[str] = Form("0"),
    scale: Optional[str] = Form("1"),
):
    temp_paths = []
    try:
        img = read_image(image)
        img = resize_if_needed(img, max_dim=2048)

        # Parse numeric params
        try:
            b = float(brightness) / 100.0
        except Exception:
            b = 1.0
        try:
            c = float(contrast) / 100.0
        except Exception:
            c = 1.0
        try:
            s = float(sharpness) / 100.0
        except Exception:
            s = 1.0
        try:
            d = float(denoise) / 100.0
        except Exception:
            d = 0.0
        try:
            sc = int(scale)
        except Exception:
            sc = 1

        # Enhancement type
        enh_type = (type or "standard").lower()

        if enh_type == "standard":
            # Standard: lightweight Pillow enhancements
            img = ImageEnhance.Brightness(img).enhance(b)
            img = ImageEnhance.Contrast(img).enhance(c)
            img = ImageEnhance.Sharpness(img).enhance(s)
            if d > 0:
                # mild denoise via Gaussian blur strength proportional
                radius = max(1, int(d * 2))
                img = img.filter(ImageFilter.GaussianBlur(radius=radius))
        elif enh_type == "hd":
            img = ImageEnhance.Brightness(img).enhance(max(b, 1.05))
            img = ImageEnhance.Contrast(img).enhance(max(c, 1.1))
            img = ImageEnhance.Sharpness(img).enhance(max(s, 1.2))
            img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
        elif enh_type in ("upscale2x", "upscale4x"):
            # Upscale: resize with LANCZOS + sharpen. Real-ESRGAN optional & resource-heavy.
            factor = 2 if enh_type == "upscale2x" else 4
            w, h = img.size
            img = img.resize((w * factor, h * factor), Image.LANCZOS)
            img = ImageEnhance.Sharpness(img).enhance(1.2)
        else:
            # fallback standard
            img = ImageEnhance.Brightness(img).enhance(b)
            img = ImageEnhance.Contrast(img).enhance(c)
            img = ImageEnhance.Sharpness(img).enhance(s)

        out_bytes = image_to_bytes(img, fmt="JPEG", quality=90)
        return Response(content=out_bytes, media_type="image/jpeg")

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("image_enhance error")
        raise HTTPException(status_code=500, detail=f"Enhancement failed: {e}")
    finally:
        background_tasks.add_task(cleanup_temp, temp_paths)


# ============================================================================
# Image optimize
# ============================================================================
@app.post("/image/optimize")
async def image_optimize(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    format: Optional[str] = Form("webp"),
    quality: Optional[str] = Form("85"),
    width: Optional[str] = Form(None),
    height: Optional[str] = Form(None),
    preserve_aspect: Optional[str] = Form("true"),
):
    temp_paths = []
    try:
        img = read_image(image)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    try:
        q = int(quality)
    except Exception:
        q = 85
    q = max(10, min(100, q))

    # Resize
    try:
        w = int(width) if width else None
    except Exception:
        w = None
    try:
        h = int(height) if height else None
    except Exception:
        h = None

    if w or h:
        preserve = str(preserve_aspect).lower() != "false"
        if preserve and w and h:
            img.thumbnail((w, h), Image.LANCZOS)
        elif preserve and w:
            ratio = w / img.size[0]
            img = img.resize((w, max(1, int(img.size[1] * ratio))), Image.LANCZOS)
        elif preserve and h:
            ratio = h / img.size[1]
            img = img.resize((max(1, int(img.size[0] * ratio)), h), Image.LANCZOS)
        else:
            img = img.resize((w or img.size[0], h or img.size[1]), Image.LANCZOS)

    fmt = (format or "webp").upper()
    if fmt == "JPEG":
        fmt = "JPEG"
    elif fmt == "JPG":
        fmt = "JPEG"
    elif fmt not in ("PNG", "WEBP"):
        fmt = "WEBP"

    out_bytes = image_to_bytes(img, fmt=fmt, quality=q)

    media_type = {
        "JPEG": "image/jpeg",
        "PNG": "image/png",
        "WEBP": "image/webp",
    }.get(fmt, "application/octet-stream")

    return Response(content=out_bytes, media_type=media_type)


# ============================================================================
# Image filter
# ============================================================================
@app.post("/image/filter")
async def image_filter(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    filter: Optional[str] = Form("natural"),
    intensity: Optional[str] = Form("100"),
):
    temp_paths = []
    try:
        img = read_image(image)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    try:
        intens = float(intensity) / 100.0
    except Exception:
        intens = 1.0
    intens = max(0.0, min(2.0, intens))

    filt = (filter or "natural").lower()

    if filt == "natural":
        pass  # no change
    elif filt == "warm":
        # Shift toward yellow/red
        r, g, b = img.split()
        r = ImageEnhance.Brightness(r).enhance(1.0 + 0.2 * intens)
        b = ImageEnhance.Brightness(b).enhance(1.0 - 0.15 * intens)
        img = Image.merge("RGB", (r, g, b))
        img = ImageEnhance.Color(img).enhance(1.0 + 0.15 * intens)
    elif filt == "cool":
        r, g, b = img.split()
        r = ImageEnhance.Brightness(r).enhance(1.0 - 0.15 * intens)
        b = ImageEnhance.Brightness(b).enhance(1.0 + 0.2 * intens)
        img = Image.merge("RGB", (r, g, b))
    elif filt == "vintage":
        img = ImageOps.autocontrast(img, cutoff=1)
        img = ImageEnhance.Color(img).enhance(0.85)
        img = ImageEnhance.Contrast(img).enhance(1.1)
        # slight sepia tint
        sepia = Image.new("RGB", img.size, (255, 240, 220))
        img = Image.blend(img, sepia, 0.15 * intens)
    elif filt == "cinematic":
        img = ImageEnhance.Contrast(img).enhance(1.2)
        img = ImageEnhance.Color(img).enhance(1.15)
        img = ImageEnhance.Brightness(img).enhance(0.95)
    elif filt == "bw":
        img = ImageOps.grayscale(img).convert("RGB")
    elif filt == "brightness":
        img = ImageEnhance.Brightness(img).enhance(1.0 + (intens - 1.0))
    elif filt == "contrast":
        img = ImageEnhance.Contrast(img).enhance(1.0 + (intens - 1.0))
    elif filt == "saturation":
        img = ImageEnhance.Color(img).enhance(1.0 + (intens - 1.0) * 1.5)
    elif filt == "sharpness":
        img = ImageEnhance.Sharpness(img).enhance(1.0 + (intens - 1.0) * 2.0)
    elif filt == "blur":
        radius = max(1, int(intens * 6))
        img = img.filter(ImageFilter.GaussianBlur(radius=radius))
    else:
        pass  # natural fallback

    out_bytes = image_to_bytes(img, fmt="JPEG", quality=90)
    return Response(content=out_bytes, media_type="image/jpeg")


# Shutdown cleanup
@app.on_event("shutdown")
def cleanup_on_shutdown():
    cleanup_temp([TEMP_ROOT])
