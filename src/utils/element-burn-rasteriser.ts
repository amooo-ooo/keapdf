import type {
  VideoElement,
  AudioElement,
  ThreeDElement,
  AttachmentElement,
} from '../stores/canvas-types';
import { formatByteSize } from '../services/pdf/operations/metadata-ops';

/**
 * Escapes characters for safe inclusion in SVG text content.
 *
 * @param text Raw input string.
 * @returns XML-safe escaped string.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates vector SVG markup for a video element matching VideoElementRender.svelte.
 *
 * @param element The video canvas element.
 * @returns SVG markup string conforming to the canvas visual appearance.
 */
export function generateVideoElementSvg(element: VideoElement): string {
  const w = Math.max(80, Math.round(element.width));
  const h = Math.max(50, Math.round(element.height));
  const title = escapeXml(element.title || element.fileName || 'ISO 32000 RichMedia Video');
  const hasSource = Boolean(element.src);
  const clipId = `video-card-clip-${escapeXml(element.id.replace(/[^a-zA-Z0-9_-]/g, '_'))}`;

  if (hasSource) {
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    const playRadius = Math.min(20, Math.max(14, Math.round(Math.min(w, h) * 0.14)));
    const triOffset = Math.round(playRadius * 0.4);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <clipPath id="${clipId}">
      <rect x="0" y="0" width="${w}" height="${h}" rx="6" ry="6" />
    </clipPath>
  </defs>
  <g clip-path="url(#${clipId})">
    <rect x="0" y="0" width="${w}" height="${h}" fill="#000000" stroke="#404040" stroke-width="1.5" />
    <circle cx="${cx}" cy="${cy}" r="${playRadius}" fill="rgba(0, 0, 0, 0.65)" stroke="rgba(255, 255, 255, 0.3)" stroke-width="1.5" />
    <polygon points="${cx - triOffset + 2},${cy - triOffset} ${cx + triOffset + 3},${cy} ${cx - triOffset + 2},${cy + triOffset}" fill="#ffffff" />
    <g transform="translate(6, 6)">
      <rect x="0" y="0" width="${Math.min(w - 12, 160)}" height="18" rx="3" ry="3" fill="rgba(0, 0, 0, 0.75)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" />
      <path d="M4 4h10v10H4z M6 4v10 M12 4v10 M4 7h10 M4 11h10" fill="none" stroke="#3b82f6" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" transform="scale(0.8) translate(2, 2)" />
      <text x="20" y="12" fill="#d4d4d8" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="500">${title}</text>
    </g>
  </g>
</svg>`;
  }

  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" ry="6" fill="#171717" stroke="#404040" stroke-width="1.5" stroke-dasharray="4 3" />
  <g transform="translate(${cx - 14}, ${cy - 22}) scale(1.1)">
    <rect x="2" y="4" width="16" height="12" rx="2" fill="none" stroke="#71717a" stroke-width="1.5" />
    <polygon points="18,8 23,5 23,15 18,12" fill="none" stroke="#71717a" stroke-width="1.5" stroke-linejoin="round" />
  </g>
  <text x="${cx}" y="${cy + 6}" text-anchor="middle" fill="#e4e4e7" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600">Video Media Stream</text>
  <text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="#71717a" font-family="system-ui, -apple-system, sans-serif" font-size="9">ISO 32000-1 Clause 13.2</text>
</svg>`;
}

/**
 * Generates vector SVG markup for an audio element matching AudioElementRender.svelte.
 *
 * @param element The audio canvas element.
 * @returns SVG markup string conforming to the canvas visual appearance.
 */
export function generateAudioElementSvg(element: AudioElement): string {
  const w = Math.max(100, Math.round(element.width));
  const h = Math.max(30, Math.round(element.height));
  const title = escapeXml(element.title || element.fileName || 'Audio Track');
  const sizeFormatted = element.fileSize ? ` | ${Math.round(element.fileSize / 1024)} KB` : '';
  const hasSource = Boolean(element.src);

  if (hasSource) {
    const playBtnX = 20;
    const playBtnY = Math.round(h / 2);
    const playRadius = Math.min(15, Math.max(12, Math.round(h * 0.28)));
    const triOffset = Math.round(playRadius * 0.45);

    const titleX = playBtnX + playRadius + 10;
    const titleY = Math.round(h / 2) - 2;
    const subY = titleY + 13;

    const eqX = w - 24;
    const eqY = Math.round(h / 2);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" ry="6" fill="#171717" stroke="#404040" stroke-width="1.2" />
  <circle cx="${playBtnX}" cy="${playBtnY}" r="${playRadius}" fill="rgba(59, 130, 246, 0.2)" stroke="rgba(59, 130, 246, 0.4)" stroke-width="1.2" />
  <polygon points="${playBtnX - triOffset + 2},${playBtnY - triOffset} ${playBtnX + triOffset + 2},${playBtnY} ${playBtnX - triOffset + 2},${playBtnY + triOffset}" fill="#3b82f6" />
  <g transform="translate(${titleX}, ${titleY - 9})">
    <path d="M9 18V5l12-2v13 M9 9l12-2" fill="none" stroke="#3b82f6" stroke-width="1.6" transform="scale(0.55)" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="5" cy="10" r="2" fill="#3b82f6" />
    <circle cx="11.5" cy="9" r="2" fill="#3b82f6" />
  </g>
  <text x="${titleX + 15}" y="${titleY}" fill="#f4f4f5" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600">${title}</text>
  <text x="${titleX}" y="${subY}" fill="#a1a1aa" font-family="system-ui, -apple-system, sans-serif" font-size="9">ISO 32000-1 Clause 13.3${sizeFormatted}</text>
  <g transform="translate(${eqX}, ${eqY - 7})">
    <rect x="0" y="2" width="2.5" height="12" rx="1" fill="#3b82f6" />
    <rect x="5" y="6" width="2.5" height="8" rx="1" fill="#3b82f6" opacity="0.8" />
    <rect x="10" y="0" width="2.5" height="14" rx="1" fill="#3b82f6" />
  </g>
</svg>`;
  }

  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" ry="6" fill="#171717" stroke="#404040" stroke-width="1.2" stroke-dasharray="3 3" />
  <g transform="translate(${cx - 45}, ${cy - 8}) scale(0.7)">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07 M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" />
  </g>
  <text x="${cx + 8}" y="${cy + 3}" text-anchor="middle" fill="#a1a1aa" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="500">No audio source</text>
</svg>`;
}

/**
 * Generates vector SVG markup for a 3D element matching ThreeDElementRender.svelte.
 *
 * @param element The 3D canvas element.
 * @returns SVG markup string conforming to the canvas visual appearance.
 */
export function generateThreeDElementSvg(element: ThreeDElement): string {
  const w = Math.max(80, Math.round(element.width));
  const h = Math.max(60, Math.round(element.height));
  const tag = escapeXml((element.modelFormat || 'U3D').toUpperCase());
  const title = escapeXml(element.title || element.fileName || '3D Artwork');
  const gradId = `threed-grad-${escapeXml(element.id.replace(/[^a-zA-Z0-9_-]/g, '_'))}`;

  const cx = Math.round(w / 2);
  const cubeScale = Math.min(0.85, Math.max(0.4, Math.min(w / 140, h / 140)));
  const cubeY = Math.round(h * 0.38);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#09090b" />
      <stop offset="50%" stop-color="#18181b" />
      <stop offset="100%" stop-color="#09090b" />
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" ry="6" fill="url(#${gradId})" stroke="#404040" stroke-width="1.2" />
  <g transform="translate(${cx - 50 * cubeScale}, ${cubeY - 50 * cubeScale}) scale(${cubeScale})">
    <polygon points="50,15 85,35 50,55 15,35" fill="#3b82f6" fill-opacity="0.25" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" />
    <polygon points="15,35 50,55 50,90 15,70" fill="#3b82f6" fill-opacity="0.15" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" />
    <polygon points="50,55 85,35 85,70 50,90" fill="#3b82f6" fill-opacity="0.35" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" />
    <line x1="50" y1="55" x2="50" y2="25" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="3 2" />
    <line x1="50" y1="55" x2="75" y2="40" stroke="#f43f5e" stroke-width="1.8" stroke-dasharray="3 2" />
    <line x1="50" y1="55" x2="25" y2="40" stroke="#22c55e" stroke-width="1.8" stroke-dasharray="3 2" />
  </g>
  <g transform="translate(${cx}, ${Math.round(h * 0.76)})">
    <rect x="-45" y="-12" width="24" height="15" rx="3" fill="rgba(59, 130, 246, 0.2)" stroke="rgba(59, 130, 246, 0.35)" stroke-width="1" />
    <text x="-33" y="-1" text-anchor="middle" fill="#60a5fa" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="700">${tag}</text>
    <text x="-16" y="-1" fill="#f4f4f5" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600">${title}</text>
    <text x="0" y="11" text-anchor="middle" fill="#71717a" font-family="system-ui, -apple-system, sans-serif" font-size="9">ISO 32000-1 Clause 13.6</text>
  </g>
  <g transform="translate(${w - 96}, ${h - 18})">
    <rect x="0" y="0" width="90" height="14" rx="3" fill="rgba(0, 0, 0, 0.6)" stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.8" />
    <circle cx="9" cy="7" r="3" fill="none" stroke="#3b82f6" stroke-width="1.2" />
    <path d="M4 7s2-3.5 5-3.5 5 3.5 5 3.5-2 3.5-5 3.5-5-3.5-5-3.5z" fill="none" stroke="#3b82f6" stroke-width="1" />
    <text x="20" y="10" fill="#a1a1aa" font-family="system-ui, -apple-system, sans-serif" font-size="8">Interactive 3D View</text>
  </g>
</svg>`;
}

/**
 * Generates vector SVG markup for an attachment element matching AttachmentElementRender.svelte.
 *
 * @param element The attachment canvas element.
 * @returns SVG markup string conforming to the canvas visual appearance.
 */
export function generateAttachmentElementSvg(element: AttachmentElement): string {
  const w = Math.max(100, Math.round(element.width));
  const h = Math.max(28, Math.round(element.height));
  const fileName = escapeXml(element.fileName || 'Attached File');
  const sizeFormatted = element.fileSize ? ` | ${formatByteSize(element.fileSize)}` : '';

  const cy = Math.round(h / 2);
  const iconBoxSize = Math.min(26, Math.max(20, Math.round(h * 0.65)));
  const iconBoxY = Math.round((h - iconBoxSize) / 2);

  const textX = 14 + iconBoxSize;
  const titleY = cy - 2;
  const subY = titleY + 12;

  const dlX = w - 24;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" ry="6" fill="#171717" stroke="#404040" stroke-width="1.2" />
  <rect x="8" y="${iconBoxY}" width="${iconBoxSize}" height="${iconBoxSize}" rx="4" fill="rgba(59, 130, 246, 0.12)" stroke="rgba(59, 130, 246, 0.25)" stroke-width="1" />
  <g transform="translate(${8 + (iconBoxSize - 14) / 2}, ${iconBoxY + (iconBoxSize - 14) / 2}) scale(0.6)">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" fill="none" stroke="#3b82f6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  </g>
  <text x="${textX}" y="${titleY}" fill="#f4f4f5" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600">${fileName}</text>
  <text x="${textX}" y="${subY}" fill="#a1a1aa" font-family="system-ui, -apple-system, sans-serif" font-size="9">ISO 32000-2 AF${sizeFormatted}</text>
  <g transform="translate(${dlX}, ${cy - 7})">
    <path d="M12 15V3m0 12-4-4m4 4 4-4M2 17l.62 2.48A2 2 0 0 0 4.56 21h14.88a2 2 0 0 0 1.94-1.52L22 17" fill="none" stroke="#a1a1aa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="scale(0.65)" />
  </g>
</svg>`;
}

/**
 * High-performance browser rasteriser converting SVG markup into raw ImageData.
 * Supersamples at 2x resolution to maintain crisp typography and vector edges in PDFs.
 * Uses Blob object URLs with automatic resource revocation and data URL fallback.
 *
 * @param svgMarkup The vector SVG XML markup.
 * @param width Target rendered width in points.
 * @param height Target rendered height in points.
 * @returns Promise resolving to an ImageData instance containing RGBA pixel buffer.
 */
export async function rasterizeSvgToImageData(
  svgMarkup: string,
  width: number,
  height: number
): Promise<{ width: number; height: number; imgData: ImageData } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }

  const scale = 2;
  const pixelWidth = Math.max(1, Math.round(width * scale));
  const pixelHeight = Math.max(1, Math.round(height * scale));

  return new Promise((resolve) => {
    let resolved = false;
    let blobUrl: string | null = null;

    const cleanup = (): void => {
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // Ignore revocation errors
        }
        blobUrl = null;
      }
    };

    const safeResolve = (res: { width: number; height: number; imgData: ImageData } | null): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(res);
    };

    // Safety timeout after 4000ms to prevent hanging PDF export
    const timer = setTimeout(() => {
      safeResolve(null);
    }, 4000);

    const drawToCanvas = (img: HTMLImageElement): void => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          safeResolve(null);
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);

        const imgData = ctx.getImageData(0, 0, pixelWidth, pixelHeight);
        safeResolve({
          width: pixelWidth,
          height: pixelHeight,
          imgData,
        });
      } catch (err) {
        console.error('Failed to rasterise SVG to ImageData:', err);
        safeResolve(null);
      }
    };

    try {
      const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      blobUrl = URL.createObjectURL(svgBlob);
      const img = new Image();

      img.onload = (): void => {
        drawToCanvas(img);
      };

      img.onerror = (): void => {
        // Fallback: try data URI if Blob URL fails
        try {
          cleanup();
          const fallbackImg = new Image();
          const encoded = encodeURIComponent(svgMarkup);
          fallbackImg.onload = (): void => {
            drawToCanvas(fallbackImg);
          };
          fallbackImg.onerror = (): void => {
            clearTimeout(timer);
            safeResolve(null);
          };
          fallbackImg.src = `data:image/svg+xml;charset=utf-8,${encoded}`;
        } catch {
          clearTimeout(timer);
          safeResolve(null);
        }
      };

      img.src = blobUrl;
      if (img.complete && img.naturalWidth > 0) {
        drawToCanvas(img);
      }
    } catch {
      clearTimeout(timer);
      safeResolve(null);
    }
  });
}
