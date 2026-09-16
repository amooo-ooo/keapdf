import type { PdfiumEngine } from '../../../core/pdfium-engine';
import type {
  AnnotationItem,
  OutlineNode,
  DocumentInfo,
  DocumentMetadata,
  MetadataEntry,
  DocumentMetadataUpdate,
} from '../../../core/types';

export type { DocumentMetadataUpdate };
import type { PDFDict } from 'pdf-lib';

/**
 * Standard PDF annotation subtypes mapped to their human-readable names.
 */
const SUBTYPE_NAMES: Record<number, string> = {
  0: 'Unknown',
  1: 'Text',
  2: 'Link',
  3: 'FreeText',
  4: 'Line',
  5: 'Square',
  6: 'Circle',
  7: 'Polygon',
  8: 'PolyLine',
  9: 'Highlight',
  10: 'Underline',
  11: 'Squiggly',
  12: 'StrikeOut',
  13: 'Stamp',
  14: 'Caret',
  15: 'Ink',
  16: 'Popup',
  17: 'FileAttachment',
  18: 'Sound',
  19: 'Movie',
  20: 'Widget',
  21: 'Screen',
  22: 'PrinterMark',
  23: 'TrapNet',
  24: 'Watermark',
  25: '3D',
  26: 'Redact',
};

/**
 * Standard PDF Info dictionary keys according to the PDF 1.7 / 2.0 specification.
 */
export const STANDARD_INFO_KEYS = new Set<string>([
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
]);

/**
 * Parses raw PDF date format (e.g. D:YYYYMMDDHHmmSSOHH'mm') or ISO string.
 *
 * @param rawDate The raw date string from PDF dictionary.
 * @return An object containing the parsed Date (or null) and formatted string.
 */
export function parsePdfDate(rawDate?: string): { date: Date | null; formatted: string } {
  if (!rawDate || !rawDate.trim()) {
    return { date: null, formatted: '-' };
  }

  const cleaned = rawDate.trim();
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz]|[+-]\d{2}'?\d{2}'?)?/.exec(cleaned);

  if (!match) {
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
      return { date: d, formatted: d.toLocaleString() };
    }
    return { date: null, formatted: cleaned };
  }

  const year = parseInt(match[1], 10);
  const month = match[2] ? parseInt(match[2], 10) - 1 : 0;
  const day = match[3] ? parseInt(match[3], 10) : 1;
  const hour = match[4] ? parseInt(match[4], 10) : 0;
  const min = match[5] ? parseInt(match[5], 10) : 0;
  const sec = match[6] ? parseInt(match[6], 10) : 0;
  const tz = match[7];

  let parsedDate: Date;
  if (tz) {
    let iso = `${year.toString().padStart(4, '0')}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    if (tz === 'Z' || tz === 'z') {
      iso += 'Z';
    } else {
      const tzMatch = /([+-])(\d{2})'?(\d{2})'?/.exec(tz);
      if (tzMatch) {
        iso += `${tzMatch[1]}${tzMatch[2]}:${tzMatch[3]}`;
      }
    }
    const d = new Date(iso);
    parsedDate = isNaN(d.getTime()) ? new Date(Date.UTC(year, month, day, hour, min, sec)) : d;
  } else {
    parsedDate = new Date(Date.UTC(year, month, day, hour, min, sec));
  }

  return {
    date: parsedDate,
    formatted: isNaN(parsedDate.getTime()) ? cleaned : parsedDate.toLocaleString(),
  };
}

/**
 * Formats a byte size count into a human-friendly string.
 *
 * @param bytes Physical size in bytes.
 * @return Formatted size string.
 */
export function formatByteSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Decodes a raw pdf-lib object value into a human-readable text string.
 *
 * @param val The PDF object value to decode.
 * @return The decoded string representation.
 */
function decodePdfObjectValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof (val as { decodeText?: () => string }).decodeText === 'function') {
    return (val as { decodeText: () => string }).decodeText().trim();
  }
  if (typeof (val as { asString?: () => string }).asString === 'function') {
    return (val as { asString: () => string }).asString().replace(/^\//, '').trim();
  }
  if (typeof (val as { asNumber?: () => number }).asNumber === 'function') {
    return (val as { asNumber: () => number }).asNumber().toString();
  }
  if (typeof (val as { asBoolean?: () => boolean }).asBoolean === 'function') {
    return (val as { asBoolean: () => boolean }).asBoolean() ? 'true' : 'false';
  }
  if (typeof (val as { size?: () => number; get?: (i: number) => unknown }).size === 'function') {
    const arr = val as { size: () => number; get: (i: number) => unknown };
    const items: string[] = [];
    for (let i = 0; i < arr.size(); i++) {
      items.push(decodePdfObjectValue(arr.get(i)));
    }
    return items.join(', ');
  }
  return String(val).trim();
}

/**
 * Retrieves all annotations present on a specific page.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle The active page handle.
 * @return An array of parsed AnnotationItem objects.
 */
export function getPageAnnotations(engine: PdfiumEngine, pageHandle: number): AnnotationItem[] {
  const mod = engine.getModule();
  const annotations: AnnotationItem[] = [];

  const annotCount = mod.FPDFPage_GetAnnotCount(pageHandle);
  const rectPtr = engine.allocateMemory(16);

  try {
    for (let i = 0; i < annotCount; i++) {
      const annotHandle = mod.FPDFPage_GetAnnot(pageHandle, i);
      if (!annotHandle) continue;

      const subtypeCode = mod.FPDFAnnot_GetSubtype(annotHandle);
      const subtypeName = SUBTYPE_NAMES[subtypeCode] || `Type ${subtypeCode}`;

      mod.FPDFAnnot_GetRect(annotHandle, rectPtr);
      const heap = mod.pdfium.HEAPF32;
      const left = heap[rectPtr >> 2] || 0;
      const top = heap[(rectPtr >> 2) + 1] || 0;
      const right = heap[(rectPtr >> 2) + 2] || 0;
      const bottom = heap[(rectPtr >> 2) + 3] || 0;

      const contents = readAnnotString(engine, annotHandle, 'Contents');

      annotations.push({
        index: i,
        subtype: subtypeName,
        rect: {
          left: Math.round(left * 10) / 10,
          top: Math.round(top * 10) / 10,
          right: Math.round(right * 10) / 10,
          bottom: Math.round(bottom * 10) / 10,
        },
        contents: contents || '(No text content)',
      });

      mod.FPDFPage_CloseAnnot(annotHandle);
    }
  } finally {
    engine.freeMemory(rectPtr);
  }

  return annotations;
}

/**
 * Safely reads UTF-16LE strings from an annotation dictionary.
 *
 * @param engine The PDFium engine instance.
 * @param annotHandle The annotation handle.
 * @param key The dictionary key to query.
 * @return The decoded string.
 */
function readAnnotString(engine: PdfiumEngine, annotHandle: number, key: string): string {
  const mod = engine.getModule();
  const requiredBytes = mod.FPDFAnnot_GetStringValue(annotHandle, key, 0, 0);
  if (requiredBytes <= 2) return '';

  const bufPtr = engine.allocateMemory(requiredBytes);
  try {
    mod.FPDFAnnot_GetStringValue(annotHandle, key, bufPtr, requiredBytes);
    const uint8 = new Uint8Array(mod.pdfium.HEAPU8.buffer, bufPtr, requiredBytes - 2);
    let str = '';
    for (let i = 0; i < uint8.length; i += 2) {
      const charCode = uint8[i] | (uint8[i + 1] << 8);
      if (charCode !== 0) {
        str += String.fromCharCode(charCode);
      }
    }
    return str;
  } finally {
    engine.freeMemory(bufPtr);
  }
}

/**
 * Retrieves the hierarchical document outline (bookmarks) for a PDF.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @return An array of top-level OutlineNode objects.
 */
export function getOutline(engine: PdfiumEngine, docHandle: number): OutlineNode[] {
  const mod = engine.getModule();
  const firstBookmark = mod.FPDFBookmark_GetFirstChild(docHandle, 0);
  if (!firstBookmark) return [];

  const processLevel = (bookmarkHandle: number): OutlineNode[] => {
    const nodes: OutlineNode[] = [];
    let current: number | null = bookmarkHandle;

    while (current) {
      const title = readOutlineTitle(engine, current);
      const destHandle = mod.FPDFBookmark_GetDest(docHandle, current);
      let pageIndex: number | null = null;

      if (destHandle) {
        pageIndex = mod.FPDFDest_GetDestPageIndex(docHandle, destHandle);
      }

      const childHandle = mod.FPDFBookmark_GetFirstChild(docHandle, current);
      const children = childHandle ? processLevel(childHandle) : [];

      nodes.push({
        title: title || 'Untitled Outline Item',
        pageIndex: pageIndex !== null && pageIndex >= 0 ? pageIndex : null,
        children,
      });

      current = mod.FPDFBookmark_GetNextSibling(docHandle, current);
    }
    return nodes;
  };

  return processLevel(firstBookmark);
}

/**
 * Reads a bookmark title string.
 *
 * @param engine The PDFium engine instance.
 * @param bookmarkHandle The bookmark handle.
 * @return The decoded string.
 */
function readOutlineTitle(engine: PdfiumEngine, bookmarkHandle: number): string {
  const mod = engine.getModule();
  const requiredBytes = mod.FPDFBookmark_GetTitle(bookmarkHandle, 0, 0);
  if (requiredBytes <= 2) return '';

  const bufPtr = engine.allocateMemory(requiredBytes);
  try {
    mod.FPDFBookmark_GetTitle(bookmarkHandle, bufPtr, requiredBytes);
    const uint8 = new Uint8Array(mod.pdfium.HEAPU8.buffer, bufPtr, requiredBytes - 2);
    let str = '';
    for (let i = 0; i < uint8.length; i += 2) {
      const charCode = uint8[i] | (uint8[i + 1] << 8);
      if (charCode !== 0) {
        str += String.fromCharCode(charCode);
      }
    }
    return str;
  } finally {
    engine.freeMemory(bufPtr);
  }
}

/**
 * Extracts generic document statistics and metadata properties.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param fileName The physical file name.
 * @param sizeBytes The physical file size in bytes.
 * @return A DocumentInfo structure containing version and permission details.
 */
export function getDocumentInfo(
  engine: PdfiumEngine,
  docHandle: number,
  fileName: string,
  sizeBytes: number
): DocumentInfo {
  const mod = engine.getModule();
  const pageCount = mod.FPDF_GetPageCount(docHandle);
  const isEncrypted = mod.EPDF_IsEncrypted(docHandle);
  const permissions = mod.FPDF_GetDocUserPermissions
    ? mod.FPDF_GetDocUserPermissions(docHandle)
    : mod.FPDF_GetDocPermissions(docHandle);

  const versionPtr = engine.allocateMemory(4);
  let versionStr = '1.4';
  try {
    const hasVersion = mod.FPDF_GetFileVersion(docHandle, versionPtr);
    if (hasVersion) {
      const view = new Int32Array(mod.pdfium.HEAPU8.buffer, versionPtr, 1);
      const rawVersion = view[0];
      versionStr = `${Math.floor(rawVersion / 10)}.${rawVersion % 10}`;
    }
  } finally {
    engine.freeMemory(versionPtr);
  }

  return {
    name: fileName,
    sizeBytes,
    pageCount,
    pdfVersion: versionStr,
    isEncrypted,
    permissions,
  };
}

/**
 * Reads standard embedded PDF dictionary tags using PDFium FFI.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param tagName The tag name to read (e.g. Title, Author).
 * @return The decoded string value or empty string.
 */
export function readPdfiumMetaText(engine: PdfiumEngine, docHandle: number, tagName: string): string {
  const mod = engine.getModule();
  const requiredBytes = mod.FPDF_GetMetaText(docHandle, tagName, 0, 0);
  if (requiredBytes <= 2) return '';

  const bufPtr = engine.allocateMemory(requiredBytes);
  try {
    mod.FPDF_GetMetaText(docHandle, tagName, bufPtr, requiredBytes);
    const uint8 = new Uint8Array(mod.pdfium.HEAPU8.buffer, bufPtr, requiredBytes - 2);
    let textStr = '';
    for (let i = 0; i < uint8.length; i += 2) {
      const charCode = uint8[i] | (uint8[i + 1] << 8);
      if (charCode !== 0) textStr += String.fromCharCode(charCode);
    }
    return textStr;
  } finally {
    engine.freeMemory(bufPtr);
  }
}

/**
 * Dynamically extracts all standard and custom PDF metadata tags, XMP packets,
 * and technical document properties.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @param rawBuffer Optional binary buffer of the active PDF.
 * @param fileName Optional file name.
 * @param sizeBytes Optional physical size in bytes.
 * @return A fully populated DocumentMetadata object.
 */
export async function extractAllMetadata(
  engine: PdfiumEngine,
  docHandle: number,
  rawBuffer?: ArrayBuffer | Uint8Array,
  _fileName?: string,
  sizeBytes?: number
): Promise<DocumentMetadata> {
  const mod = engine.getModule();

  // 1. Read standard PDFium metadata
  const title = readPdfiumMetaText(engine, docHandle, 'Title');
  const author = readPdfiumMetaText(engine, docHandle, 'Author');
  const subject = readPdfiumMetaText(engine, docHandle, 'Subject');
  const keywords = readPdfiumMetaText(engine, docHandle, 'Keywords');
  const creator = readPdfiumMetaText(engine, docHandle, 'Creator');
  const producer = readPdfiumMetaText(engine, docHandle, 'Producer');
  const creationDate = readPdfiumMetaText(engine, docHandle, 'CreationDate');
  const modDate = readPdfiumMetaText(engine, docHandle, 'ModDate');
  const rawTrapped = mod.EPDF_GetMetaTrapped(docHandle);

  const pageCount = mod.FPDF_GetPageCount(docHandle);
  const isEncrypted = mod.EPDF_IsEncrypted(docHandle);
  const permissions = mod.FPDF_GetDocUserPermissions
    ? mod.FPDF_GetDocUserPermissions(docHandle)
    : mod.FPDF_GetDocPermissions(docHandle);
  const signaturesCount = mod.FPDF_GetSignatureCount(docHandle);
  const attachmentsCount = mod.FPDFDoc_GetAttachmentCount(docHandle);

  let versionStr = '1.4';
  const versionPtr = engine.allocateMemory(4);
  try {
    const hasVersion = mod.FPDF_GetFileVersion(docHandle, versionPtr);
    if (hasVersion) {
      const view = new Int32Array(mod.pdfium.HEAPU8.buffer, versionPtr, 1);
      const rawVersion = view[0];
      versionStr = `${Math.floor(rawVersion / 10)}.${rawVersion % 10}`;
    }
  } finally {
    engine.freeMemory(versionPtr);
  }

  // Trapped status translation
  let trappedStr = 'Unknown';
  if (rawTrapped === 1) trappedStr = 'True';
  else if (rawTrapped === 2) trappedStr = 'False';

  // 2. Prepare dynamic key collections
  const customMetadata: Record<string, string> = {};
  const allEntries: MetadataEntry[] = [];
  const standardDict: Record<string, string> = {
    Title: title,
    Author: author,
    Subject: subject,
    Keywords: keywords,
    Creator: creator,
    Producer: producer,
    CreationDate: creationDate,
    ModDate: modDate,
    Trapped: trappedStr !== 'Unknown' ? trappedStr : '',
  };

  let hasXmp = false;
  let xmpString = '';

  // 3. Inspect full buffer using pdf-lib if buffer is available
  if (rawBuffer && rawBuffer.byteLength > 0) {
    try {
      const bytes = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
      const { PDFDocument, PDFDict: PDFDictClass, PDFName, PDFStream: PDFStreamClass } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

      // Inspect Info Dictionary
      const infoRef = pdfDoc.context.trailerInfo.Info;
      if (infoRef) {
        const infoDict = pdfDoc.context.lookup(infoRef);
        if (infoDict instanceof PDFDictClass) {
          for (const [keyName, val] of infoDict.entries()) {
            const rawKeyStr = keyName.asString();
            const cleanKey = rawKeyStr.replace(/^\//, '').trim();
            const decodedVal = decodePdfObjectValue(val);

            if (!decodedVal || decodedVal === '()' || decodedVal === '<>') continue;

            const isStandard = STANDARD_INFO_KEYS.has(cleanKey);
            let formattedVal = decodedVal;

            if (cleanKey === 'CreationDate' || cleanKey === 'ModDate' || cleanKey === 'SourceModified') {
              formattedVal = parsePdfDate(decodedVal).formatted;
            }

            if (isStandard) {
              if (!standardDict[cleanKey]) {
                standardDict[cleanKey] = decodedVal;
              }
            } else {
              customMetadata[cleanKey] = decodedVal;
            }

            // Avoid duplicate entries
            const existingIdx = allEntries.findIndex((e) => e.key === cleanKey);
            if (existingIdx >= 0) {
              allEntries[existingIdx] = {
                key: cleanKey,
                rawKey: rawKeyStr,
                value: decodedVal,
                isStandard,
                formattedValue: formattedVal !== decodedVal ? formattedVal : undefined,
              };
            } else {
              allEntries.push({
                key: cleanKey,
                rawKey: rawKeyStr,
                value: decodedVal,
                isStandard,
                formattedValue: formattedVal !== decodedVal ? formattedVal : undefined,
              });
            }
          }
        }
      }

      // Inspect XMP stream in catalog
      if (pdfDoc.catalog.has(PDFName.of('Metadata'))) {
        const metaRef = pdfDoc.catalog.get(PDFName.of('Metadata'));
        if (metaRef) {
          const stream = pdfDoc.context.lookup(metaRef);
          if (stream && stream instanceof PDFStreamClass) {
            const rawContents = stream.getContents();
            hasXmp = true;
            xmpString = new TextDecoder('utf-8', { fatal: false }).decode(rawContents);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to parse extended PDF metadata via pdf-lib:', err);
    }
  }

  // Ensure standard entries are present in allEntries list if they have values
  for (const [k, v] of Object.entries(standardDict)) {
    if (v && !allEntries.some((e) => e.key === k)) {
      let formattedVal = v;
      if (k === 'CreationDate' || k === 'ModDate') {
        formattedVal = parsePdfDate(v).formatted;
      }
      allEntries.push({
        key: k,
        rawKey: `/${k}`,
        value: v,
        isStandard: true,
        formattedValue: formattedVal !== v ? formattedVal : undefined,
      });
    }
  }

  // Parse keywords into array
  const keywordsVal = standardDict.Keywords || keywords;
  const keywordsArray = keywordsVal
    ? keywordsVal
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const bytesCount = sizeBytes ?? (rawBuffer ? rawBuffer.byteLength : 0);

  return {
    title: standardDict.Title || title || '',
    author: standardDict.Author || author || '',
    subject: standardDict.Subject || subject || '',
    keywords: keywordsVal || '',
    creator: standardDict.Creator || creator || '',
    producer: standardDict.Producer || producer || '',
    creationDate: standardDict.CreationDate || creationDate || '',
    modDate: standardDict.ModDate || modDate || '',
    trappedStatus: rawTrapped,
    trapped: trappedStr,
    keywordsArray,
    creationDateFormatted: parsePdfDate(standardDict.CreationDate || creationDate).formatted,
    modDateFormatted: parsePdfDate(standardDict.ModDate || modDate).formatted,
    customMetadata,
    allEntries,
    pdfVersion: versionStr,
    pageCount,
    sizeBytes: bytesCount,
    sizeFormatted: formatByteSize(bytesCount),
    isEncrypted,
    permissions,
    signaturesCount,
    attachmentsCount,
    hasXmp,
    xmpString: xmpString || undefined,
  };
}

/**
 * Synchronously retrieves baseline metadata from PDFium handles.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @return A DocumentMetadata object with basic tags.
 */
export function getMetadata(engine: PdfiumEngine, docHandle: number): DocumentMetadata {
  const mod = engine.getModule();

  const title = readPdfiumMetaText(engine, docHandle, 'Title');
  const author = readPdfiumMetaText(engine, docHandle, 'Author');
  const subject = readPdfiumMetaText(engine, docHandle, 'Subject');
  const keywords = readPdfiumMetaText(engine, docHandle, 'Keywords');
  const creator = readPdfiumMetaText(engine, docHandle, 'Creator');
  const producer = readPdfiumMetaText(engine, docHandle, 'Producer');
  const creationDate = readPdfiumMetaText(engine, docHandle, 'CreationDate');
  const modDate = readPdfiumMetaText(engine, docHandle, 'ModDate');
  const rawTrapped = mod.EPDF_GetMetaTrapped(docHandle);

  let trappedStr = 'Unknown';
  if (rawTrapped === 1) trappedStr = 'True';
  else if (rawTrapped === 2) trappedStr = 'False';

  const allEntries: MetadataEntry[] = [];
  const pushIf = (key: string, val: string) => {
    if (val) {
      let formatted = val;
      if (key === 'CreationDate' || key === 'ModDate') {
        formatted = parsePdfDate(val).formatted;
      }
      allEntries.push({
        key,
        rawKey: `/${key}`,
        value: val,
        isStandard: true,
        formattedValue: formatted !== val ? formatted : undefined,
      });
    }
  };

  pushIf('Title', title);
  pushIf('Author', author);
  pushIf('Subject', subject);
  pushIf('Keywords', keywords);
  pushIf('Creator', creator);
  pushIf('Producer', producer);
  pushIf('CreationDate', creationDate);
  pushIf('ModDate', modDate);

  const keywordsArray = keywords
    ? keywords
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    title,
    author,
    subject,
    keywords,
    creator,
    producer,
    creationDate,
    modDate,
    trappedStatus: rawTrapped,
    trapped: trappedStr,
    keywordsArray,
    creationDateFormatted: parsePdfDate(creationDate).formatted,
    modDateFormatted: parsePdfDate(modDate).formatted,
    customMetadata: {},
    allEntries,
  };
}

/**
 * Updates PDF document metadata and custom dictionary tags.
 *
 * @param pdfBytes The binary buffer of the active PDF document.
 * @param updates The metadata fields and custom tags to update.
 * @return A promise resolving to the modified PDF byte array.
 */
export async function updateDocumentMetadata(
  pdfBytes: Uint8Array | ArrayBuffer,
  updates: DocumentMetadataUpdate
): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const { PDFDocument, PDFName, PDFString, PDFDict: PDFDictClass } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  if (updates.title !== undefined) pdfDoc.setTitle(updates.title);
  if (updates.author !== undefined) pdfDoc.setAuthor(updates.author);
  if (updates.subject !== undefined) pdfDoc.setSubject(updates.subject);
  if (updates.keywords !== undefined) {
    const kw = Array.isArray(updates.keywords)
      ? updates.keywords
      : updates.keywords
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
    pdfDoc.setKeywords(kw);
  }
  if (updates.creator !== undefined) pdfDoc.setCreator(updates.creator);
  if (updates.producer !== undefined) pdfDoc.setProducer(updates.producer);
  if (updates.creationDate !== undefined) {
    const parsed = parsePdfDate(updates.creationDate);
    if (parsed.date) pdfDoc.setCreationDate(parsed.date);
  }
  if (updates.modDate !== undefined) {
    const parsed = parsePdfDate(updates.modDate);
    if (parsed.date) pdfDoc.setModificationDate(parsed.date);
  }

  // Handle custom metadata dictionary entries
  let infoDict: PDFDict | undefined;
  const infoRef = pdfDoc.context.trailerInfo.Info;
  if (infoRef) {
    const existing = pdfDoc.context.lookup(infoRef);
    if (existing instanceof PDFDictClass) {
      infoDict = existing;
    }
  }

  if (!infoDict && updates.customMetadata && Object.keys(updates.customMetadata).length > 0) {
    infoDict = pdfDoc.context.obj({});
    pdfDoc.context.trailerInfo.Info = pdfDoc.context.register(infoDict);
  }

  if (infoDict && updates.customMetadata) {
    for (const [k, v] of Object.entries(updates.customMetadata)) {
      const cleanKey = k.replace(/^\//, '').trim();
      if (cleanKey) {
        infoDict.set(PDFName.of(cleanKey), PDFString.of(v));
      }
    }
  }

  // Handle removal of specified keys
  if (infoDict && updates.removeKeys && updates.removeKeys.length > 0) {
    for (const k of updates.removeKeys) {
      const cleanKey = k.replace(/^\//, '').trim();
      infoDict.delete(PDFName.of(cleanKey));
    }
  }

  return pdfDoc.save();
}

/**
 * Counts the number of digital signatures present in the document.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @return The total signature count.
 */
export function getSignatureCount(engine: PdfiumEngine, docHandle: number): number {
  return engine.getModule().FPDF_GetSignatureCount(docHandle);
}

/**
 * Counts the number of embedded file attachments.
 *
 * @param engine The PDFium engine instance.
 * @param docHandle The active document handle.
 * @return The total attachment count.
 */
export function getAttachmentCount(engine: PdfiumEngine, docHandle: number): number {
  return engine.getModule().FPDFDoc_GetAttachmentCount(docHandle);
}
