import type {
  CompressOptions,
  CompressionInspection,
  CompressionEstimate,
} from '../../../core/types';

/**
 * Resolves default parameters for each named compression level.
 *
 * @param options User supplied compression options.
 * @return Normalised options with all defaults populated.
 */
export function resolveCompressionDefaults(options: CompressOptions): CompressOptions {
  const level = options.level;

  switch (level) {
    case 'lossless':
      return {
        level,
        imageQuality: 1.0,
        maxDpi: undefined,
        useObjectStreams: options.useObjectStreams ?? true,
        removeThumbnails: options.removeThumbnails ?? true,
        removePieceInfo: options.removePieceInfo ?? true,
        removeMetadata: options.removeMetadata ?? false,
        removeAnnotations: options.removeAnnotations ?? false,
        imageProcessor: options.imageProcessor,
      };

    case 'recommended':
      return {
        level,
        imageQuality: options.imageQuality ?? 0.75,
        maxDpi: options.maxDpi ?? 150,
        useObjectStreams: options.useObjectStreams ?? true,
        removeThumbnails: options.removeThumbnails ?? true,
        removePieceInfo: options.removePieceInfo ?? true,
        removeMetadata: options.removeMetadata ?? true,
        removeAnnotations: options.removeAnnotations ?? false,
        imageProcessor: options.imageProcessor,
      };

    case 'strong':
      return {
        level,
        imageQuality: options.imageQuality ?? 0.50,
        maxDpi: options.maxDpi ?? 96,
        useObjectStreams: options.useObjectStreams ?? true,
        removeThumbnails: options.removeThumbnails ?? true,
        removePieceInfo: options.removePieceInfo ?? true,
        removeMetadata: options.removeMetadata ?? true,
        removeAnnotations: options.removeAnnotations ?? false,
        imageProcessor: options.imageProcessor,
      };

    case 'flat_image':
      return {
        level,
        imageQuality: options.imageQuality ?? 0.65,
        maxDpi: options.maxDpi ?? 150,
        useObjectStreams: options.useObjectStreams ?? true,
        removeThumbnails: options.removeThumbnails ?? true,
        removePieceInfo: options.removePieceInfo ?? true,
        removeMetadata: options.removeMetadata ?? true,
        removeAnnotations: options.removeAnnotations ?? false,
        imageProcessor: options.imageProcessor,
      };

    case 'custom':
    default:
      return {
        level: 'custom',
        imageQuality: options.imageQuality ?? 0.75,
        maxDpi: options.maxDpi ?? 150,
        useObjectStreams: options.useObjectStreams ?? true,
        removeThumbnails: options.removeThumbnails ?? true,
        removePieceInfo: options.removePieceInfo ?? true,
        removeMetadata: options.removeMetadata ?? false,
        removeAnnotations: options.removeAnnotations ?? false,
        imageProcessor: options.imageProcessor,
      };
  }
}

/**
 * Calculates max pixel dimension based on maxDpi or fallback limits.
 *
 * @param maxDpi Target DPI cap.
 * @return Maximum allowed dimension in pixels.
 */
export function resolveMaxPixelDimension(maxDpi?: number): number {
  if (!maxDpi || maxDpi <= 0) return 4096;
  if (maxDpi <= 96) return 1280;
  if (maxDpi <= 150) return 1920;
  if (maxDpi <= 200) return 2560;
  if (maxDpi <= 300) return 3840;
  return 4096;
}

/**
 * Estimates end file size and breakdown of savings for a given compression configuration.
 *
 * @param inspection Comprehensive inspection results of the document.
 * @param userOptions Compression options and preset level.
 * @return Structured compression estimate with monotonic guarantees.
 */
export function estimatePdfCompression(
  inspection: CompressionInspection,
  userOptions: CompressOptions
): CompressionEstimate {
  const origSize = inspection.originalSizeBytes;
  const options = resolveCompressionDefaults(userOptions);
  const level = options.level;

  if (level === 'flat_image') {
    const dpi = options.maxDpi ?? 150;
    const scale = dpi / 72.0;
    const quality = options.imageQuality ?? 0.65;
    const docBppFactor = 0.015 + 0.08 * Math.pow(quality, 1.8);
    let totalFlatBytes = 1200;

    const pages = inspection.pageDimensions ?? [];
    if (pages.length > 0) {
      for (const page of pages) {
        const pxW = Math.max(1, Math.round(page.width * scale));
        const pxH = Math.max(1, Math.round(page.height * scale));
        const jpegBytes = Math.round(pxW * pxH * docBppFactor) + 1024;
        totalFlatBytes += jpegBytes + 450;
      }
    } else {
      const count = Math.max(1, inspection.pageCount);
      const pxW = Math.round(612 * scale);
      const pxH = Math.round(792 * scale);
      const jpegBytes = Math.round(pxW * pxH * docBppFactor) + 1024;
      totalFlatBytes += count * (jpegBytes + 450);
    }

    const isClamped = totalFlatBytes >= origSize;
    const finalSize = Math.min(origSize, Math.max(100, totalFlatBytes));
    const savings = origSize - finalSize;
    const savingsPct = origSize > 0 ? Math.round((savings / origSize) * 1000) / 10 : 0;

    return {
      originalSizeBytes: origSize,
      estimatedSizeBytes: finalSize,
      estimatedSavingsBytes: savings,
      estimatedSavingsPercentage: savingsPct,
      breakdown: {
        thumbnails: 0,
        pieceInfo: 0,
        metadata: 0,
        objectStreams: 0,
        images: 0,
        rasterisation: savings,
      },
      isMonotonicallyClamped: isClamped,
    };
  }

  const removeThumb = options.removeThumbnails !== false;
  const removePiece = options.removePieceInfo !== false;
  const removeMeta = Boolean(options.removeMetadata);
  const useObjStm = options.useObjectStreams !== false;

  const savingsThumbnails = removeThumb ? (inspection.thumbnailBytes ?? 0) : 0;
  const savingsPieceInfo = removePiece ? (inspection.pieceInfoBytes ?? 0) : 0;
  const savingsMetadata = removeMeta ? (inspection.metadataBytes ?? 0) : 0;

  let savingsObjectStreams = 0;
  if (useObjStm && !inspection.hasObjectStreams) {
    const structural = inspection.structuralBytes ?? Math.max(0, origSize - (inspection.totalStreamBytes ?? 0));
    const minStructural = Math.max(750, (inspection.pageCount ?? 1) * 250 + 500);
    savingsObjectStreams = Math.max(0, Math.round((structural - minStructural) * 0.55));
  }

  let savingsImages = 0;
  if (level !== 'lossless') {
    const quality = options.imageQuality ?? 0.75;
    const maxDim = resolveMaxPixelDimension(options.maxDpi);
    const jpegBppFactor = 0.03 + 0.16 * Math.pow(quality, 1.8);

    if (inspection.images && inspection.images.length > 0) {
      for (const img of inspection.images) {
        if (img.filter !== 'DCTDecode' || img.byteLength <= 0) continue;
        const scale = Math.min(1.0, maxDim / Math.max(img.width, img.height));
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const targetPixels = targetW * targetH;
        const estNewBytes = Math.round(600 + targetPixels * jpegBppFactor);

        if (estNewBytes < img.byteLength) {
          savingsImages += (img.byteLength - estNewBytes);
        }
      }
    } else if ((inspection.jpegImageBytes ?? 0) > 0) {
      const scale = options.maxDpi && options.maxDpi <= 96 ? 0.6 : options.maxDpi && options.maxDpi <= 150 ? 0.8 : 1.0;
      const qualityFactor = Math.min(1.0, quality / 0.85);
      const ratio = Math.min(1.0, (scale * scale) * qualityFactor);
      const estNew = Math.round((inspection.jpegImageBytes ?? 0) * ratio);
      if (estNew < (inspection.jpegImageBytes ?? 0)) {
        savingsImages = (inspection.jpegImageBytes ?? 0) - estNew;
      }
    }
  }

  const totalRawSavings =
    savingsThumbnails +
    savingsPieceInfo +
    savingsMetadata +
    savingsObjectStreams +
    savingsImages;

  const minPossibleDocSize = Math.max(500, (inspection.pageCount ?? 1) * 300);
  const maxAllowedSavings = Math.max(0, origSize - minPossibleDocSize);
  const estimatedSavingsBytes = Math.min(maxAllowedSavings, Math.max(0, totalRawSavings));
  const estimatedSizeBytes = origSize - estimatedSavingsBytes;
  const isClamped = totalRawSavings > maxAllowedSavings || totalRawSavings < 0;
  const estimatedSavingsPercentage =
    origSize > 0 ? Math.round((estimatedSavingsBytes / origSize) * 1000) / 10 : 0;

  return {
    originalSizeBytes: origSize,
    estimatedSizeBytes,
    estimatedSavingsBytes,
    estimatedSavingsPercentage,
    breakdown: {
      thumbnails: savingsThumbnails,
      pieceInfo: savingsPieceInfo,
      metadata: savingsMetadata,
      objectStreams: savingsObjectStreams,
      images: savingsImages,
    },
    isMonotonicallyClamped: isClamped,
  };
}

/**
 * Convenience helper computing estimates across all four preset levels simultaneously.
 *
 * @param inspection Comprehensive inspection results of the document.
 * @return Map of preset names to their respective compression estimates.
 */
export function estimateAllPresets(
  inspection: CompressionInspection
): Record<'lossless' | 'recommended' | 'strong' | 'flat_image', CompressionEstimate> {
  return {
    lossless: estimatePdfCompression(inspection, { level: 'lossless' }),
    recommended: estimatePdfCompression(inspection, { level: 'recommended' }),
    strong: estimatePdfCompression(inspection, { level: 'strong' }),
    flat_image: estimatePdfCompression(inspection, { level: 'flat_image' }),
  };
}
