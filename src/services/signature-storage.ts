/**
 * Persistent browser storage service and graphics helpers for user signatures.
 *
 * Stores signatures in localStorage and provides rendering/image processing
 * utilities for drawing, typography, and uploaded signature image background removal.
 */

export type SignatureType = 'draw' | 'type' | 'upload';

export interface SavedSignature {
  /** Unique signature identifier. */
  id: string;
  /** Human-readable title or label for the signature. */
  title: string;
  /** Creation method (drawn, typed, or uploaded). */
  type: SignatureType;
  /** High-resolution transparent PNG Data URL. */
  dataUrl: string;
  /** Optional SVG path or stroke data. */
  svgPath?: string;
  /** Selected font family name if typed. */
  fontFamily?: string;
  /** Text content if typed. */
  text?: string;
  /** Primary signature color (CSS hex/rgb). */
  color: string;
  /** Epoch timestamp in milliseconds when created. */
  createdAt: number;
  /** Whether this signature is marked as the default for quick placement. */
  isDefault: boolean;
  /** Aspect ratio (width / height). */
  aspectRatio: number;
}

export interface StrokeBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

const STORAGE_KEY = 'pdf_editor_saved_signatures_v1';
const MAX_SAVED_SIGNATURES = 12;

/**
 * Retrieves all saved signatures from browser localStorage.
 *
 * @return Array of saved signature records.
 */
export function getSavedSignatures(): SavedSignature[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.warn('Failed to read saved signatures from localStorage:', err);
    return [];
  }
}

/**
 * Attempts to persist the signature list into localStorage with quota protection.
 *
 * @param signatures Array of signatures to persist.
 */
function persistSignatures(signatures: SavedSignature[]): void {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signatures));
  } catch (err) {
    // If quota exceeded, evict oldest non-default signatures and retry
    console.warn('LocalStorage quota issue while saving signature, attempting eviction:', err);
    const trimmed = signatures.filter((s, idx) => s.isDefault || idx < 5);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (innerErr) {
      console.error('Failed to write signature to localStorage after eviction:', innerErr);
    }
  }
}

/**
 * Saves a new signature to persistent storage with quota bounding.
 *
 * @param item Signature details without ID and creation timestamp.
 * @return The created SavedSignature with generated ID.
 */
export function saveSignature(item: Omit<SavedSignature, 'id' | 'createdAt'>): SavedSignature {
  const current = getSavedSignatures();
  const id = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newSignature: SavedSignature = {
    ...item,
    id,
    createdAt: Date.now(),
  };

  // If set as default, clear default flag from all other signatures
  if (newSignature.isDefault) {
    for (const sig of current) {
      sig.isDefault = false;
    }
  } else if (current.length === 0) {
    newSignature.isDefault = true;
  }

  current.unshift(newSignature);

  // Enforce maximum collection capacity to prevent localStorage exhaustion
  while (current.length > MAX_SAVED_SIGNATURES) {
    // Find oldest non-default signature to remove
    let removeIdx = -1;
    for (let i = current.length - 1; i >= 0; i--) {
      if (!current[i].isDefault) {
        removeIdx = i;
        break;
      }
    }
    if (removeIdx >= 0) {
      current.splice(removeIdx, 1);
    } else {
      current.pop();
    }
  }

  persistSignatures(current);
  return newSignature;
}

/**
 * Deletes a signature from persistent storage by ID.
 *
 * @param id The signature ID to remove.
 */
export function deleteSignature(id: string): void {
  const current = getSavedSignatures().filter((s) => s.id !== id);
  if (current.length > 0 && !current.some((s) => s.isDefault)) {
    current[0].isDefault = true;
  }
  persistSignatures(current);
}

/**
 * Sets a specific signature as the default.
 *
 * @param id The signature ID to designate as default.
 */
export function setDefaultSignature(id: string): void {
  const current = getSavedSignatures();
  for (const s of current) {
    s.isDefault = s.id === id;
  }
  persistSignatures(current);
}

/**
 * Retrieves the default saved signature if one exists.
 *
 * @return The default signature or null.
 */
export function getDefaultSignature(): SavedSignature | null {
  const all = getSavedSignatures();
  return all.find((s) => s.isDefault) || (all.length > 0 ? all[0] : null);
}

/**
 * Point representation in 2D coordinate space.
 */
export interface DrawPoint {
  x: number;
  y: number;
  pressure?: number;
}

/**
 * Mathematically calculates the tight bounding box of vector drawn strokes
 * without performing costly pixel buffer scans.
 *
 * @param strokes Array of stroke paths with coordinates.
 * @param strokeWidth Pen stroke thickness.
 * @param padding Margin in pixels around the stroke bounds.
 * @return Analytical bounding box coordinates and dimensions.
 */
export function calculateStrokeBoundingBox(
  strokes: DrawPoint[][],
  strokeWidth = 2.5,
  padding = 12
): StrokeBoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoints = false;

  const halfWidth = Math.ceil(strokeWidth / 2);

  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    for (let j = 0; j < stroke.length; j++) {
      const pt = stroke[j];
      hasPoints = true;
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  if (!hasPoints) {
    return {
      minX: 0,
      minY: 0,
      maxX: 200,
      maxY: 60,
      width: 200,
      height: 60,
    };
  }

  const boundedMinX = minX - halfWidth - padding;
  const boundedMaxX = maxX + halfWidth + padding;
  const boundedMinY = minY - halfWidth - padding;
  const boundedMaxY = maxY + halfWidth + padding;

  return {
    minX: boundedMinX,
    minY: boundedMinY,
    maxX: boundedMaxX,
    maxY: boundedMaxY,
    width: Math.max(1, boundedMaxX - boundedMinX),
    height: Math.max(1, boundedMaxY - boundedMinY),
  };
}

/**
 * Trims transparent whitespace margins from an image canvas using edge scanning.
 *
 * @param canvas The canvas to crop.
 * @param padding Extra padding in pixels to retain around trimmed bounds.
 * @return A new cropped HTMLCanvasElement.
 */
export function cropCanvasToContent(canvas: HTMLCanvasElement, padding = 12): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return canvas;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data32 = new Uint32Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength / 4);

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  // Find top bound
  topLoop: for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      if ((data32[rowOffset + x] & 0xff000000) !== 0) {
        minY = y;
        break topLoop;
      }
    }
  }

  // If blank canvas, return original canvas
  if (minY === h) {
    return canvas;
  }

  // Find bottom bound
  bottomLoop: for (let y = h - 1; y >= minY; y--) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      if ((data32[rowOffset + x] & 0xff000000) !== 0) {
        maxY = y;
        break bottomLoop;
      }
    }
  }

  // Find left bound
  leftLoop: for (let x = 0; x < w; x++) {
    for (let y = minY; y <= maxY; y++) {
      if ((data32[y * w + x] & 0xff000000) !== 0) {
        minX = x;
        break leftLoop;
      }
    }
  }

  // Find right bound
  rightLoop: for (let x = w - 1; x >= minX; x--) {
    for (let y = minY; y <= maxY; y++) {
      if ((data32[y * w + x] & 0xff000000) !== 0) {
        maxX = x;
        break rightLoop;
      }
    }
  }

  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropW = Math.min(w - cropX, maxX - minX + padding * 2);
  const cropH = Math.min(h - cropY, maxY - minY + padding * 2);

  const cropped = document.createElement('canvas');
  cropped.width = cropW;
  cropped.height = cropH;
  const croppedCtx = cropped.getContext('2d');
  if (croppedCtx) {
    croppedCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  }

  return cropped;
}

/**
 * Renders multiple drawn stroke paths into a smooth transparent PNG Data URL
 * using analytical vector bounding box calculation.
 *
 * @param strokes Array of stroke paths, each containing a sequence of DrawPoints.
 * @param strokeWidth Pen stroke thickness in pixels.
 * @param strokeColor CSS stroke color string.
 * @param rawWidth Base canvas width fallback.
 * @param rawHeight Base canvas height fallback.
 * @return High-resolution cropped Data URL and dimensions.
 */
export function renderDrawnStrokesToDataUrl(
  strokes: DrawPoint[][],
  strokeWidth: number,
  strokeColor: string,
  rawWidth = 800,
  rawHeight = 350
): { dataUrl: string; width: number; height: number; aspectRatio: number } {
  if (strokes.length === 0) {
    return { dataUrl: '', width: rawWidth, height: rawHeight, aspectRatio: rawWidth / rawHeight };
  }

  const bbox = calculateStrokeBoundingBox(strokes, strokeWidth, 12);
  const dpr = 2; // Supersample for crisp PDF printing
  const canvasWidth = Math.max(20, Math.ceil(bbox.width * dpr));
  const canvasHeight = Math.max(20, Math.ceil(bbox.height * dpr));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: '', width: bbox.width, height: bbox.height, aspectRatio: bbox.width / bbox.height };
  }

  ctx.scale(dpr, dpr);
  // Shift origin by bounding box offset
  ctx.translate(-bbox.minX, -bbox.minY);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  for (let s = 0; s < strokes.length; s++) {
    const stroke = strokes[s];
    if (stroke.length === 0) continue;
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, strokeWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);

    for (let i = 1; i < stroke.length - 1; i++) {
      const xc = (stroke[i].x + stroke[i + 1].x) / 2;
      const yc = (stroke[i].y + stroke[i + 1].y) / 2;
      ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, xc, yc);
    }

    const last = stroke[stroke.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  const dataUrl = canvas.toDataURL('image/png');
  const logicalWidth = canvasWidth / dpr;
  const logicalHeight = canvasHeight / dpr;
  const aspect = logicalWidth / Math.max(1, logicalHeight);

  return {
    dataUrl,
    width: logicalWidth,
    height: logicalHeight,
    aspectRatio: aspect,
  };
}

let signatureFontsPreloaded = false;

/**
 * Asynchronously preloads Google Fonts required for handwriting signatures
 * without blocking document rendering.
 */
export function preloadSignatureFonts(): void {
  if (signatureFontsPreloaded || typeof document === 'undefined') return;
  signatureFontsPreloaded = true;

  const fontFamilies = [
    'Alex+Brush',
    'Allura',
    'Caveat:wght@600',
    'Dancing+Script:wght@600',
    'Great+Vibes',
    'Pacifico',
  ];

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${fontFamilies.map((f) => `family=${f}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

/**
 * Renders a typed text string using a handwriting or script font into a transparent PNG Data URL
 * using analytical FontMetrics measurement.
 *
 * @param text The signer name or initials string.
 * @param fontFamily Font family to apply.
 * @param color Text color string.
 * @return Cropped Data URL and metrics.
 */
export async function renderTypedSignatureToDataUrl(
  text: string,
  fontFamily: string,
  color: string
): Promise<{ dataUrl: string; width: number; height: number; aspectRatio: number }> {
  const cleanText = text.trim() || 'Signature';

  // Fast font load check with 300ms timeout race to prevent UI deadlocks
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      preloadSignatureFonts();
      if (!document.fonts.check(`64px "${fontFamily}"`)) {
        await Promise.race([
          document.fonts.load(`64px "${fontFamily}"`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Font load timeout')), 300)),
        ]);
      }
    } catch {
      // Graceful fallback to cursive system fonts
    }
  }

  const dpr = 2;
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) {
    return { dataUrl: '', width: 200, height: 60, aspectRatio: 3.33 };
  }

  const fontSize = 56;
  measureCtx.font = `${fontSize}px "${fontFamily}", cursive, sans-serif`;
  const metrics = measureCtx.measureText(cleanText);

  const textWidth = Math.ceil(metrics.width);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || fontSize * 0.75);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || fontSize * 0.25);
  const textHeight = Math.max(20, ascent + descent);

  const padding = 16;
  const logicalW = Math.max(40, textWidth + padding * 2);
  const logicalH = Math.max(20, textHeight + padding * 2);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(logicalW * dpr);
  canvas.height = Math.ceil(logicalH * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: '', width: logicalW, height: logicalH, aspectRatio: logicalW / logicalH };
  }

  ctx.scale(dpr, dpr);
  ctx.font = `${fontSize}px "${fontFamily}", cursive, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  ctx.fillText(cleanText, logicalW / 2, logicalH / 2);

  const dataUrl = canvas.toDataURL('image/png');
  const aspect = logicalW / Math.max(1, logicalH);

  return {
    dataUrl,
    width: logicalW,
    height: logicalH,
    aspectRatio: aspect,
  };
}

/**
 * Cleans an uploaded signature image by downscaling high-resolution photos,
 * removing light backgrounds, and converting ink pixels to a transparent PNG.
 *
 * @param imageSource Base64 Data URL or Image Element.
 * @param threshold Brightness threshold from 0 to 255 (default 220) above which pixels are transparent.
 * @param targetColor Optional override color for ink pixels.
 * @return High-resolution cropped transparent PNG Data URL and metrics.
 */
export async function processUploadedSignatureImage(
  imageSource: string,
  threshold = 220,
  targetColor?: string
): Promise<{ dataUrl: string; width: number; height: number; aspectRatio: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Constrain oversized image dimensions to prevent freezing main thread
      const MAX_UPLOAD_DIM = 600;
      let targetW = img.naturalWidth || img.width;
      let targetH = img.naturalHeight || img.height;

      if (targetW > MAX_UPLOAD_DIM || targetH > MAX_UPLOAD_DIM) {
        if (targetW >= targetH) {
          targetH = Math.max(1, Math.round((targetH * MAX_UPLOAD_DIM) / targetW));
          targetW = MAX_UPLOAD_DIM;
        } else {
          targetW = Math.max(1, Math.round((targetW * MAX_UPLOAD_DIM) / targetH));
          targetH = MAX_UPLOAD_DIM;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return reject(new Error('Failed to get canvas 2d context.'));
      }

      ctx.drawImage(img, 0, 0, targetW, targetH);
      const imgData = ctx.getImageData(0, 0, targetW, targetH);
      const data = imgData.data;

      let rTarget = 0;
      let gTarget = 0;
      let bTarget = 0;
      let hasTargetColor = false;

      if (targetColor && targetColor.startsWith('#') && targetColor.length === 7) {
        rTarget = parseInt(targetColor.slice(1, 3), 16);
        gTarget = parseInt(targetColor.slice(3, 5), 16);
        bTarget = parseInt(targetColor.slice(5, 7), 16);
        hasTargetColor = true;
      }

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a === 0) continue;

        // Calculate perceived brightness via standard luminance formula
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

        if (luminance >= threshold) {
          // Pure transparent
          data[i + 3] = 0;
        } else {
          // Smooth anti-aliasing alpha dropoff near the threshold boundary
          const darknessRatio = Math.max(0, Math.min(1, (threshold - luminance) / 50));
          data[i + 3] = Math.round(a * darknessRatio);

          if (hasTargetColor) {
            data[i] = rTarget;
            data[i + 1] = gTarget;
            data[i + 2] = bTarget;
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);

      const cropped = cropCanvasToContent(canvas, 10);
      const dataUrl = cropped.toDataURL('image/png');
      const aspect = cropped.width / Math.max(1, cropped.height);

      resolve({
        dataUrl,
        width: cropped.width,
        height: cropped.height,
        aspectRatio: aspect,
      });
    };

    img.onerror = () => reject(new Error('Failed to load signature image source.'));
    img.src = imageSource;
  });
}
