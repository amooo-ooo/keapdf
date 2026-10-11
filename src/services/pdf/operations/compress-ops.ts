import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFArray,
} from 'pdf-lib';
import type {
  CompressOptions,
  CompressSummary,
  CompressionInspection,
  CompressImageProcessor,
  PageRasterizer,
  ImageInspectionRecord,
  PageDimensionRecord,
} from '../../../core/types';
import {
  resolveCompressionDefaults,
  resolveMaxPixelDimension,
} from './compress-estimate';

/**
 * Image XObject metadata extracted from indirect objects.
 */
interface ImageXObjectRecord {
  ref: PDFRef;
  stream: PDFRawStream;
  width: number;
  height: number;
  colorSpace: string;
  filter: string;
  hasMask: boolean;
}

/**
 * Scans raw bytes for presence of object stream markers.
 *
 * @param bytes The raw PDF binary buffer.
 * @return True if object streams are detected in the file.
 */
function hasObjectStreamsInBytes(bytes: Uint8Array): boolean {
  const marker = [0x2f, 0x4f, 0x62, 0x6a, 0x53, 0x74, 0x6d];
  const len = bytes.byteLength;
  const mLen = marker.length;
  for (let i = 0; i <= len - mLen; i++) {
    if (bytes[i] === marker[0]) {
      let match = true;
      for (let j = 1; j < mLen; j++) {
        if (bytes[i + j] !== marker[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
  }
  return false;
}

/**
 * Inspects a PDF binary buffer for compressibility characteristics.
 *
 * @param pdfBytes The binary buffer of the PDF to inspect.
 * @return A promise resolving to compression inspection details.
 */
export async function inspectPdfForCompression(
  pdfBytes: Uint8Array | ArrayBuffer
): Promise<CompressionInspection> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const pageCount = pdfDoc.getPageCount();
  let imageCount = 0;
  let totalImageBytes = 0;
  let jpegImageCount = 0;
  let jpegImageBytes = 0;
  let totalStreamBytes = 0;
  let hasObjectStreams = hasObjectStreamsInBytes(bytes);
  let thumbnailCount = 0;
  let thumbnailBytes = 0;
  let pieceInfoBytes = 0;
  let hasPieceInfo = pdfDoc.catalog.has(PDFName.of('PieceInfo'));
  const hasXmpMetadata = pdfDoc.catalog.has(PDFName.of('Metadata'));
  let metadataBytes = 0;

  const images: ImageInspectionRecord[] = [];

  for (const [, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const streamSize = obj.getContentsSize();
      totalStreamBytes += streamSize;

      const subtype = obj.dict.get(PDFName.of('Subtype'));
      const type = obj.dict.get(PDFName.of('Type'));
      if (
        (type instanceof PDFName && (type.asString() === '/ObjStm' || type.asString() === '/XRef')) ||
        (subtype instanceof PDFName && subtype.asString() === '/ObjStm')
      ) {
        hasObjectStreams = true;
      }

      if (subtype instanceof PDFName && subtype.asString() === '/Image') {
        imageCount++;
        totalImageBytes += streamSize;

        const widthObj = obj.dict.get(PDFName.of('Width'));
        const heightObj = obj.dict.get(PDFName.of('Height'));
        const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : 0;
        const height = heightObj instanceof PDFNumber ? heightObj.asNumber() : 0;

        let filter = '';
        const filterObj = obj.dict.get(PDFName.of('Filter'));
        if (filterObj instanceof PDFName) {
          filter = filterObj.asString().replace(/^\//, '');
        } else if (filterObj instanceof PDFArray && filterObj.size() > 0) {
          const first = filterObj.get(0);
          if (first instanceof PDFName) {
            filter = first.asString().replace(/^\//, '');
          }
        }

        let colorSpace = 'DeviceRGB';
        const csObj = obj.dict.get(PDFName.of('ColorSpace'));
        if (csObj instanceof PDFName) {
          colorSpace = csObj.asString().replace(/^\//, '');
        }

        const hasMask =
          obj.dict.has(PDFName.of('SMask')) || obj.dict.has(PDFName.of('Mask'));

        if (filter === 'DCTDecode') {
          jpegImageCount++;
          jpegImageBytes += streamSize;
        }

        images.push({
          width,
          height,
          byteLength: streamSize,
          filter,
          colorSpace,
          hasMask,
        });
      }
    }
  }

  if (hasXmpMetadata) {
    const metaRef = pdfDoc.catalog.get(PDFName.of('Metadata'));
    if (metaRef instanceof PDFRef) {
      const metaObj = pdfDoc.context.lookup(metaRef);
      if (metaObj instanceof PDFRawStream) {
        metadataBytes += metaObj.getContentsSize();
      } else {
        metadataBytes += 200;
      }
    } else {
      metadataBytes += 200;
    }
  }

  if (pdfDoc.context.trailerInfo.Info) {
    metadataBytes += 200;
  }

  if (hasPieceInfo) {
    pieceInfoBytes += 150;
  }

  const pageDimensions: PageDimensionRecord[] = [];

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);
    const size = page.getSize();
    pageDimensions.push({ width: size.width, height: size.height });

    if (page.node.has(PDFName.of('Thumb'))) {
      thumbnailCount++;
      const thumbRef = page.node.get(PDFName.of('Thumb'));
      if (thumbRef instanceof PDFRef) {
        const thumbObj = pdfDoc.context.lookup(thumbRef);
        if (thumbObj instanceof PDFRawStream) {
          thumbnailBytes += thumbObj.getContentsSize();
        } else {
          thumbnailBytes += 100;
        }
      } else {
        thumbnailBytes += 100;
      }
    }

    if (page.node.has(PDFName.of('PieceInfo'))) {
      hasPieceInfo = true;
      pieceInfoBytes += 100;
    }
  }

  const structuralBytes = Math.max(0, bytes.byteLength - totalStreamBytes);

  return {
    originalSizeBytes: bytes.byteLength,
    pageCount,
    imageCount,
    totalImageBytes,
    hasThumbnails: thumbnailCount > 0,
    thumbnailCount,
    hasPieceInfo,
    hasXmpMetadata,
    jpegImageCount,
    jpegImageBytes,
    totalStreamBytes,
    structuralBytes,
    hasObjectStreams,
    thumbnailBytes,
    metadataBytes,
    pieceInfoBytes,
    images,
    pageDimensions,
  };
}

/**
 * Prunes structural bloat such as XMP metadata, embedded thumbnails,
 * private vendor application data, and DocInfo dictionaries.
 *
 * @param pdfDoc The PDFDocument instance to prune.
 * @param options Compression options controlling pruning behaviour.
 * @return Count of pruned items.
 */
export function pruneStructuralBloat(
  pdfDoc: PDFDocument,
  options: CompressOptions
): {
  thumbnailsRemoved: number;
  pieceInfoRemoved: number;
  metadataStripped: boolean;
} {
  let thumbnailsRemoved = 0;
  let pieceInfoRemoved = 0;
  let metadataStripped = false;

  const removeThumb = options.removeThumbnails !== false;
  const removePiece = options.removePieceInfo !== false;
  const removeMeta = Boolean(options.removeMetadata);

  if (removeMeta) {
    const metaRef = pdfDoc.catalog.get(PDFName.of('Metadata'));
    if (metaRef instanceof PDFRef) {
      pdfDoc.context.delete(metaRef);
      pdfDoc.catalog.delete(PDFName.of('Metadata'));
      metadataStripped = true;
    } else if (pdfDoc.catalog.has(PDFName.of('Metadata'))) {
      pdfDoc.catalog.delete(PDFName.of('Metadata'));
      metadataStripped = true;
    }

    if (pdfDoc.context.trailerInfo.Info) {
      const infoRef = pdfDoc.context.trailerInfo.Info;
      if (infoRef instanceof PDFRef) {
        pdfDoc.context.delete(infoRef);
      }
      delete (pdfDoc.context.trailerInfo as Record<string, unknown>).Info;
      metadataStripped = true;
    }
  }

  if (removePiece) {
    const catPiece = pdfDoc.catalog.get(PDFName.of('PieceInfo'));
    if (catPiece instanceof PDFRef) {
      pdfDoc.context.delete(catPiece);
      pdfDoc.catalog.delete(PDFName.of('PieceInfo'));
      pieceInfoRemoved++;
    } else if (pdfDoc.catalog.has(PDFName.of('PieceInfo'))) {
      pdfDoc.catalog.delete(PDFName.of('PieceInfo'));
      pieceInfoRemoved++;
    }
  }

  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);

    if (removeThumb && page.node.has(PDFName.of('Thumb'))) {
      const thumbRef = page.node.get(PDFName.of('Thumb'));
      if (thumbRef instanceof PDFRef) {
        pdfDoc.context.delete(thumbRef);
      }
      page.node.delete(PDFName.of('Thumb'));
      thumbnailsRemoved++;
    }

    if (removePiece && page.node.has(PDFName.of('PieceInfo'))) {
      const pagePiece = page.node.get(PDFName.of('PieceInfo'));
      if (pagePiece instanceof PDFRef) {
        pdfDoc.context.delete(pagePiece);
      }
      page.node.delete(PDFName.of('PieceInfo'));
      pieceInfoRemoved++;
    }
  }

  return {
    thumbnailsRemoved,
    pieceInfoRemoved,
    metadataStripped,
  };
}

/**
 * Collects all image XObjects across the PDF indirect object table.
 *
 * @param pdfDoc The PDFDocument to inspect.
 * @return Array of discovered image XObject records.
 */
function collectImageXObjects(pdfDoc: PDFDocument): ImageXObjectRecord[] {
  const images: ImageXObjectRecord[] = [];

  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') {
      continue;
    }

    const widthObj = obj.dict.get(PDFName.of('Width'));
    const heightObj = obj.dict.get(PDFName.of('Height'));
    if (!(widthObj instanceof PDFNumber) || !(heightObj instanceof PDFNumber)) {
      continue;
    }

    const width = widthObj.asNumber();
    const height = heightObj.asNumber();
    if (width <= 0 || height <= 0) continue;

    let filter = '';
    const filterObj = obj.dict.get(PDFName.of('Filter'));
    if (filterObj instanceof PDFName) {
      filter = filterObj.asString().replace(/^\//, '');
    } else if (filterObj instanceof PDFArray && filterObj.size() > 0) {
      const first = filterObj.get(0);
      if (first instanceof PDFName) {
        filter = first.asString().replace(/^\//, '');
      }
    }

    let colorSpace = 'DeviceRGB';
    const csObj = obj.dict.get(PDFName.of('ColorSpace'));
    if (csObj instanceof PDFName) {
      colorSpace = csObj.asString().replace(/^\//, '');
    }

    const hasMask =
      obj.dict.has(PDFName.of('SMask')) || obj.dict.has(PDFName.of('Mask'));

    images.push({
      ref,
      stream: obj,
      width,
      height,
      colorSpace,
      filter,
      hasMask,
    });
  }

  return images;
}

/**
 * Re-encodes JPEG bytes using browser canvas when available.
 *
 * @param imageBytes The input JPEG image byte buffer.
 * @param targetWidth Scaled image pixel width.
 * @param targetHeight Scaled image pixel height.
 * @param quality Lossy compression quality (0.0 to 1.0).
 * @return A promise resolving to compressed bytes, or null if unsupported.
 */
async function recompressJpegViaBrowser(
  imageBytes: Uint8Array,
  targetWidth: number,
  targetHeight: number,
  quality: number
): Promise<Uint8Array | null> {
  if (typeof Blob === 'undefined') {
    return null;
  }

  const blob = new Blob(
    [imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength) as ArrayBuffer],
    { type: 'image/jpeg' }
  );

  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
        const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        const buf = await outBlob.arrayBuffer();
        return new Uint8Array(buf);
      } finally {
        bitmap.close();
      }
    } catch {
      return null;
    }
  }

  if (typeof document !== 'undefined') {
    try {
      const url = URL.createObjectURL(blob);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Failed to load image element'));
        el.src = url;
      });

      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const outBlob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', quality);
        });
        if (!outBlob) return null;
        const buf = await outBlob.arrayBuffer();
        return new Uint8Array(buf);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      return null;
    }
  }

  return null;
}


/**
 * Recompresses qualifying image XObjects within the PDF document.
 *
 * @param pdfDoc The PDFDocument instance.
 * @param options Compression options.
 * @param processor Optional custom image processor for test environments.
 * @return Number of successfully recompressed images.
 */
export async function recompressImageXObjects(
  pdfDoc: PDFDocument,
  options: CompressOptions,
  processor?: CompressImageProcessor
): Promise<number> {
  const images = collectImageXObjects(pdfDoc);
  if (images.length === 0) return 0;

  const quality = options.imageQuality ?? 0.75;
  const maxDim = resolveMaxPixelDimension(options.maxDpi);
  let compressedCount = 0;

  for (const img of images) {
    if (img.filter !== 'DCTDecode') {
      continue;
    }

    const origBytes = img.stream.asUint8Array();
    const origSize = origBytes.byteLength;
    if (origSize === 0) continue;

    // Preserve 1:1 pixel dimensions when the image carries an /SMask or /Mask
    // so the soft mask dimensions remain synchronised with the colour stream.
    const scale = img.hasMask
      ? 1.0
      : Math.min(1.0, maxDim / Math.max(img.width, img.height));
    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));

    let recompressedBytes: Uint8Array | null = null;

    if (processor) {
      recompressedBytes = await processor.recompressJpeg(
        origBytes,
        img.width,
        img.height,
        targetW,
        targetH,
        quality
      );
    } else {
      recompressedBytes = await recompressJpegViaBrowser(
        origBytes,
        targetW,
        targetH,
        quality
      );
    }

    if (
      recompressedBytes &&
      recompressedBytes.byteLength > 0 &&
      recompressedBytes.byteLength < origSize
    ) {
      const newStream = PDFRawStream.of(img.stream.dict, recompressedBytes);
      newStream.dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      newStream.dict.set(PDFName.of('Width'), PDFNumber.of(targetW));
      newStream.dict.set(PDFName.of('Height'), PDFNumber.of(targetH));
      newStream.dict.set(
        PDFName.of('Length'),
        PDFNumber.of(recompressedBytes.byteLength)
      );
      newStream.dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      newStream.dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      newStream.dict.delete(PDFName.of('DecodeParms'));

      pdfDoc.context.assign(img.ref, newStream);
      compressedCount++;
    }
  }

  return compressedCount;
}

/**
 * Performs full-page lossy flat image rasterisation, converting every page
 * into a single compressed JPEG image on an identical page boundary.
 *
 * @param pdfBytes The source PDF buffer.
 * @param options Compression options.
 * @param pageRasterizer Engine delegate to render pages to JPEG buffers.
 * @return A promise resolving to compressed PDF bytes.
 */
export async function rasterizePdfToFlatImage(
  pdfBytes: Uint8Array,
  options: CompressOptions,
  pageRasterizer: PageRasterizer
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const sourceDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = sourceDoc.getPageCount();
  const targetDoc = await PDFDocument.create();

  const dpi = options.maxDpi ?? 150;
  const scale = dpi / 72.0;
  const quality = options.imageQuality ?? 0.65;

  for (let i = 0; i < pageCount; i++) {
    const rendered = await pageRasterizer(i, scale, quality);
    const embeddedImg = await targetDoc.embedJpg(rendered.bytes);

    const newPage = targetDoc.addPage([rendered.widthPts, rendered.heightPts]);
    newPage.drawImage(embeddedImg, {
      x: 0,
      y: 0,
      width: rendered.widthPts,
      height: rendered.heightPts,
    });
  }

  const bytes = await targetDoc.save({
    useObjectStreams: options.useObjectStreams !== false,
  });

  return { bytes, pageCount };
}


/**
 * Executes PDF compression across selected levels with monotonic size guarantees.
 *
 * @param pdfBytes Binary PDF buffer.
 * @param userOptions Compression options and preset level.
 * @param pageRasterizer Optional page rasterizer for flat-image mode.
 * @return A promise resolving to compressed bytes and a summary of savings.
 */
export async function compressPdf(
  pdfBytes: Uint8Array | ArrayBuffer,
  userOptions: CompressOptions,
  pageRasterizer?: PageRasterizer
): Promise<{ compressedBytes: Uint8Array; summary: CompressSummary }> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const origSize = bytes.byteLength;
  const options = resolveCompressionDefaults(userOptions);

  const inspection = await inspectPdfForCompression(bytes);

  let candidateBytes: Uint8Array;
  let pagesRasterized = 0;
  let thumbnailsRemoved = 0;
  let pieceInfoRemoved = 0;
  let metadataStripped = false;
  let imagesCompressed = 0;

  if (options.level === 'flat_image' && pageRasterizer) {
    const flatResult = await rasterizePdfToFlatImage(bytes, options, pageRasterizer);
    candidateBytes = flatResult.bytes;
    pagesRasterized = flatResult.pageCount;
    metadataStripped = true;
    thumbnailsRemoved = inspection.thumbnailCount;
    pieceInfoRemoved = inspection.hasPieceInfo ? 1 : 0;
  } else {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

    const pruneResult = pruneStructuralBloat(pdfDoc, options);
    thumbnailsRemoved = pruneResult.thumbnailsRemoved;
    pieceInfoRemoved = pruneResult.pieceInfoRemoved;
    metadataStripped = pruneResult.metadataStripped;

    if (options.level !== 'lossless') {
      imagesCompressed = await recompressImageXObjects(
        pdfDoc,
        options,
        options.imageProcessor
      );
    }

    candidateBytes = await pdfDoc.save({
      useObjectStreams: options.useObjectStreams !== false,
    });
  }

  // Strict monotonic safeguard: if candidate is larger than or equal to original, keep original
  let finalBytes: Uint8Array;
  let savingsBytes = 0;
  let savingsPercentage = 0;

  if (candidateBytes.byteLength < origSize) {
    finalBytes = candidateBytes;
    savingsBytes = origSize - candidateBytes.byteLength;
    savingsPercentage = Math.round((savingsBytes / origSize) * 1000) / 10;
  } else {
    finalBytes = bytes;
    savingsBytes = 0;
    savingsPercentage = 0;
  }

  const summary: CompressSummary = {
    originalSizeBytes: origSize,
    compressedSizeBytes: finalBytes.byteLength,
    savingsBytes,
    savingsPercentage,
    imageCount: inspection.imageCount,
    imagesCompressed,
    pagesRasterized,
    thumbnailsRemoved,
    pieceInfoRemoved,
    metadataStripped,
    objectStreamsUsed: options.useObjectStreams !== false,
  };

  return {
    compressedBytes: finalBytes,
    summary,
  };
}

export {
  resolveCompressionDefaults,
  resolveMaxPixelDimension,
  estimatePdfCompression,
  estimateAllPresets,
} from './compress-estimate';
