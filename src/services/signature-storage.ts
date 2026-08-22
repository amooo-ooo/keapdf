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

const STORAGE_KEY = 'pdf_editor_saved_signatures_v1';

/**
 * Retrieves all saved signatures from browser localStorage.
 *
 * @return Array of saved signature records.
 */
export function getSavedSignatures(): SavedSignature[] {
  try {
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
 * Saves a new signature to persistent storage.
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to write signature to localStorage:', err);
  }

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to update localStorage after deletion:', err);
  }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to update default signature in localStorage:', err);
  }
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
 * Trims transparent whitespace margins from a canvas element to produce
 * tightly bounded image coordinates.
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
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const alpha = data[idx + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // If blank canvas, return a fallback small canvas
  if (minX > maxX || minY > maxY) {
    return canvas;
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
 * Renders multiple drawn stroke paths into a smooth transparent PNG Data URL.
 *
 * @param strokes Array of stroke paths, each containing a sequence of DrawPoints.
 * @param strokeWidth Pen stroke thickness in pixels.
 * @param strokeColor CSS stroke color string.
 * @param rawWidth Base canvas width.
 * @param rawHeight Base canvas height.
 * @return High-resolution cropped Data URL and dimensions.
 */
export function renderDrawnStrokesToDataUrl(
  strokes: DrawPoint[][],
  strokeWidth: number,
  strokeColor: string,
  rawWidth = 800,
  rawHeight = 350
): { dataUrl: string; width: number; height: number; aspectRatio: number } {
  const canvas = document.createElement('canvas');
  const dpr = 2; // Supersample for crisp PDF printing
  canvas.width = rawWidth * dpr;
  canvas.height = rawHeight * dpr;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: '', width: rawWidth, height: rawHeight, aspectRatio: rawWidth / rawHeight };
  }

  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  for (const stroke of strokes) {
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

  const cropped = cropCanvasToContent(canvas, 16);
  const dataUrl = cropped.toDataURL('image/png');
  const aspect = cropped.width / Math.max(1, cropped.height);

  return {
    dataUrl,
    width: cropped.width / dpr,
    height: cropped.height / dpr,
    aspectRatio: aspect,
  };
}

/**
 * Renders a typed text string using a handwriting or script font into a transparent PNG Data URL.
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
  if (document.fonts) {
    try {
      await document.fonts.load(`72px "${fontFamily}"`);
    } catch {
      // Font load error fallback
    }
  }

  const canvas = document.createElement('canvas');
  const dpr = 2;
  const testWidth = 1200;
  const testHeight = 400;
  canvas.width = testWidth * dpr;
  canvas.height = testHeight * dpr;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: '', width: 200, height: 60, aspectRatio: 3.33 };
  }

  ctx.scale(dpr, dpr);
  ctx.font = `64px "${fontFamily}", cursive, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  ctx.fillText(text, testWidth / 2, testHeight / 2);

  const cropped = cropCanvasToContent(canvas, 16);
  const dataUrl = cropped.toDataURL('image/png');
  const aspect = cropped.width / Math.max(1, cropped.height);

  return {
    dataUrl,
    width: cropped.width / dpr,
    height: cropped.height / dpr,
    aspectRatio: aspect,
  };
}

/**
 * Cleans an uploaded signature image by removing white or light background
 * and converting non-white ink pixels to a transparent PNG.
 *
 * @param imageSource Base64 Data URL or Image Element.
 * @param threshold Brightness threshold from 0 to 255 (default 215) above which pixels are transparent.
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
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return reject(new Error('Failed to get canvas 2d context.'));
      }

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      let rTarget = 0;
      let gTarget = 0;
      let bTarget = 0;
      let hasTargetColor = false;

      if (targetColor) {
        if (targetColor.startsWith('#') && targetColor.length === 7) {
          rTarget = parseInt(targetColor.slice(1, 3), 16);
          gTarget = parseInt(targetColor.slice(3, 5), 16);
          bTarget = parseInt(targetColor.slice(5, 7), 16);
          hasTargetColor = true;
        }
      }

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a === 0) continue;

        // Calculate perceived brightness (standard luminance formula)
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

        if (luminance >= threshold) {
          // Pure transparent
          data[i + 3] = 0;
        } else {
          // Smooth alpha dropoff near the threshold boundary for anti-aliasing
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
