/**
 * Pure TypeScript ZIP parser and builder using native Web Streams API.
 * Operates client-side and in headless Bun test runner with zero dependencies.
 */

export interface ZipFileEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/**
 * Precomputed CRC-32 table for fast single-operation byte lookups.
 */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

/**
 * Standard CRC-32 checksum calculation.
 */
export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Sanitises archive entry paths to prevent directory traversal vulnerabilities (Zip Slip).
 */
export function sanitizeZipPath(rawPath: string): string {
  const cleaned = rawPath
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '')
    .replace(/^\/+/, '');

  const segments = cleaned.split('/');
  const safeSegments: string[] = [];

  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (safeSegments.length > 0) safeSegments.pop();
      continue;
    }
    safeSegments.push(seg);
  }

  const result = safeSegments.join('/');
  return rawPath.endsWith('/') && result ? `${result}/` : result;
}

/**
 * Decompresses raw deflate bytes using the Web Streams API.
 * Attached rejection handlers prevent unhandled promise rejections on stream abortion.
 */
async function decompressRawDeflate(compressedBytes: Uint8Array): Promise<Uint8Array> {
  if (compressedBytes.byteLength === 0) {
    return new Uint8Array(0);
  }

  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const writePromise = writer.write(compressedBytes as BufferSource).then(() => writer.close());
  writePromise.catch(() => {});

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLength += value.byteLength;
      }
    }
  } catch (err) {
    throw new Error(`Corrupted deflate stream: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

/**
 * Compresses raw bytes using deflate-raw via the Web Streams API.
 */
async function compressRawDeflate(rawBytes: Uint8Array): Promise<Uint8Array> {
  if (rawBytes.byteLength === 0) {
    return new Uint8Array(0);
  }

  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const writePromise = writer.write(rawBytes as BufferSource).then(() => writer.close());
  writePromise.catch(() => {});

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.byteLength;
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

/**
 * Parses a PKZIP binary buffer into a dictionary of sanitised file paths to uncompressed bytes.
 */
export async function unzipArchive(
  input: ArrayBuffer | Uint8Array
): Promise<Record<string, Uint8Array>> {
  const bytes = input instanceof Uint8Array
    ? input
    : new Uint8Array(input);

  if (bytes.byteLength < 22) {
    return {};
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: Record<string, Uint8Array> = {};

  // Find End of Central Directory record (EOCD) searching backward
  let eocdOffset = -1;
  const searchMin = Math.max(0, bytes.byteLength - 65557);
  for (let i = bytes.byteLength - 22; i >= searchMin; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen <= bytes.byteLength) {
        const cdOffset = view.getUint32(i + 16, true);
        const cdSize = view.getUint32(i + 12, true);
        if (cdOffset + cdSize <= i) {
          eocdOffset = i;
          break;
        }
      }
    }
  }

  const textDecoder = new TextDecoder('utf-8');

  if (eocdOffset !== -1) {
    // Read central directory
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    let cdOffset = view.getUint32(eocdOffset + 16, true);

    for (let i = 0; i < totalEntries && cdOffset + 46 <= bytes.byteLength; i++) {
      if (view.getUint32(cdOffset, true) !== 0x02014b50) {
        break;
      }

      const compressionMethod = view.getUint16(cdOffset + 10, true);
      const compressedSize = view.getUint32(cdOffset + 20, true);
      const fileNameLength = view.getUint16(cdOffset + 28, true);
      const extraFieldLength = view.getUint16(cdOffset + 30, true);
      const fileCommentLength = view.getUint16(cdOffset + 32, true);
      const localHeaderOffset = view.getUint32(cdOffset + 42, true);

      if (cdOffset + 46 + fileNameLength > bytes.byteLength) {
        break;
      }

      const fileNameBytes = bytes.subarray(cdOffset + 46, cdOffset + 46 + fileNameLength);
      const rawFileName = textDecoder.decode(fileNameBytes);
      const fileName = sanitizeZipPath(rawFileName);

      // Read from local file header
      if (
        fileName &&
        localHeaderOffset + 30 <= bytes.byteLength &&
        view.getUint32(localHeaderOffset, true) === 0x04034b50
      ) {
        const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

        if (dataOffset + compressedSize <= bytes.byteLength) {
          const compressedData = bytes.subarray(dataOffset, dataOffset + compressedSize);

          if (compressionMethod === 0) {
            entries[fileName] = new Uint8Array(compressedData);
          } else if (compressionMethod === 8) {
            try {
              entries[fileName] = await decompressRawDeflate(compressedData);
            } catch (err) {
              // Mark decompression failure cleanly rather than storing corrupt raw bytes
              throw new Error(`Failed to decompress "${fileName}": ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }

      cdOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
  } else {
    // Fallback: Scan local headers sequentially
    let offset = 0;
    while (offset + 30 <= bytes.byteLength) {
      if (view.getUint32(offset, true) !== 0x04034b50) {
        break;
      }

      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraFieldLength = view.getUint16(offset + 28, true);

      if (offset + 30 + fileNameLength > bytes.byteLength) {
        break;
      }

      const fileNameBytes = bytes.subarray(offset + 30, offset + 30 + fileNameLength);
      const rawFileName = textDecoder.decode(fileNameBytes);
      const fileName = sanitizeZipPath(rawFileName);
      const dataOffset = offset + 30 + fileNameLength + extraFieldLength;

      if (fileName && dataOffset + compressedSize <= bytes.byteLength) {
        const compressedData = bytes.subarray(dataOffset, dataOffset + compressedSize);

        if (compressionMethod === 0) {
          entries[fileName] = new Uint8Array(compressedData);
        } else if (compressionMethod === 8) {
          try {
            entries[fileName] = await decompressRawDeflate(compressedData);
          } catch (err) {
            throw new Error(`Failed to decompress "${fileName}": ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      offset = dataOffset + compressedSize;
    }
  }

  return entries;
}

/**
 * Retrieves entry data matching a case-insensitive path from unzipped files.
 */
export function getZipEntry(
  entries: Record<string, Uint8Array>,
  targetPath: string
): Uint8Array | undefined {
  const normalisedTarget = sanitizeZipPath(targetPath).toLowerCase();
  if (entries[normalisedTarget]) {
    return entries[normalisedTarget];
  }

  for (const [key, value] of Object.entries(entries)) {
    if (sanitizeZipPath(key).toLowerCase() === normalisedTarget) {
      return value;
    }
  }

  return undefined;
}

/**
 * Retrieves string contents of an entry matching a case-insensitive path.
 */
export function getZipText(
  entries: Record<string, Uint8Array>,
  targetPath: string
): string | undefined {
  const entry = getZipEntry(entries, targetPath);
  if (!entry) return undefined;
  return new TextDecoder('utf-8').decode(entry);
}

/**
 * Lists all file entry paths in the unzipped archive.
 */
export function listZipEntries(entries: Record<string, Uint8Array>): string[] {
  return Object.keys(entries);
}

/**
 * Creates a valid PKZIP binary archive containing the given files.
 * Sets Language Encoding Flag (Bit 11) to ensure UTF-8 filename portability.
 */
export async function createZipArchive(
  files: Record<string, Uint8Array | string>
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const fileEntries: Array<{
    nameBytes: Uint8Array;
    compressedData: Uint8Array;
    crc32: number;
    uncompressedSize: number;
    offset: number;
    compressionMethod: number;
  }> = [];

  const chunks: Uint8Array[] = [];
  let currentOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const rawBytes = typeof content === 'string' ? encoder.encode(content) : content;
    const sanitisedName = sanitizeZipPath(name);
    const nameBytes = encoder.encode(sanitisedName);

    const isZero = rawBytes.byteLength === 0;
    const compressionMethod = isZero ? 0 : 8;
    const compressedData = isZero ? new Uint8Array(0) : await compressRawDeflate(rawBytes);
    const crc = computeCrc32(rawBytes);

    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // Local header signature
    view.setUint16(4, 20, true);         // Version needed to extract (2.0)
    view.setUint16(6, 0x0800, true);     // General purpose bit flag: Bit 11 UTF-8
    view.setUint16(8, compressionMethod, true); // Compression method
    view.setUint16(10, 0, true);         // Last mod file time (00:00:00)
    view.setUint16(12, 0x0021, true);    // Last mod file date (1980-01-01)
    view.setUint32(14, crc, true);       // CRC-32
    view.setUint32(18, compressedData.byteLength, true); // Compressed size
    view.setUint32(22, rawBytes.byteLength, true);       // Uncompressed size
    view.setUint16(26, nameBytes.byteLength, true);      // File name length
    view.setUint16(28, 0, true);         // Extra field length
    localHeader.set(nameBytes, 30);

    chunks.push(localHeader);
    if (compressedData.byteLength > 0) {
      chunks.push(compressedData);
    }

    fileEntries.push({
      nameBytes,
      compressedData,
      crc32: crc,
      uncompressedSize: rawBytes.byteLength,
      offset: currentOffset,
      compressionMethod,
    });

    currentOffset += localHeader.byteLength + compressedData.byteLength;
  }

  const centralDirStart = currentOffset;

  // Build central directory headers
  for (const entry of fileEntries) {
    const cdHeader = new Uint8Array(46 + entry.nameBytes.byteLength);
    const view = new DataView(cdHeader.buffer);

    view.setUint32(0, 0x02014b50, true); // Central directory signature
    view.setUint16(4, 20, true);         // Version made by
    view.setUint16(6, 20, true);         // Version needed to extract
    view.setUint16(8, 0x0800, true);     // General purpose bit flag: Bit 11 UTF-8
    view.setUint16(10, entry.compressionMethod, true); // Compression method
    view.setUint16(12, 0, true);         // Last mod time
    view.setUint16(14, 0x0021, true);    // Last mod date
    view.setUint32(16, entry.crc32, true); // CRC-32
    view.setUint32(20, entry.compressedData.byteLength, true); // Compressed size
    view.setUint32(24, entry.uncompressedSize, true);          // Uncompressed size
    view.setUint16(28, entry.nameBytes.byteLength, true);      // File name length
    view.setUint16(30, 0, true);         // Extra field length
    view.setUint16(32, 0, true);         // File comment length
    view.setUint16(34, 0, true);         // Disk number start
    view.setUint16(36, 0, true);         // Internal file attributes
    view.setUint32(38, 0x81a40000, true); // External file attributes (regular file rw-r--r--)
    view.setUint32(42, entry.offset, true); // Relative offset of local header
    cdHeader.set(entry.nameBytes, 46);

    chunks.push(cdHeader);
    currentOffset += cdHeader.byteLength;
  }

  const centralDirLength = currentOffset - centralDirStart;

  // Build End of Central Directory record (EOCD)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(4, 0, true);          // Disk number
  eocdView.setUint16(6, 0, true);          // Disk with central dir
  eocdView.setUint16(8, fileEntries.length, true);  // Number of entries on disk
  eocdView.setUint16(10, fileEntries.length, true); // Total number of entries
  eocdView.setUint32(12, centralDirLength, true);   // Size of central directory
  eocdView.setUint32(16, centralDirStart, true);    // Offset of central directory
  eocdView.setUint16(20, 0, true);         // Comment length
  chunks.push(eocd);

  let totalSize = 0;
  for (const c of chunks) {
    totalSize += c.byteLength;
  }

  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.byteLength;
  }

  return result;
}
