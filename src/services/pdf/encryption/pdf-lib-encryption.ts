import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  PDFBool,
  type PDFContext,
} from 'pdf-lib';
import { PdfObjectCipher, type PdfObjectId } from './object-cipher';
import { bytesEqual } from './crypto-primitives';
import {
  resolveFileEncryptionKey,
  UnsupportedPdfEncryptionError,
  type PdfCryptMethod,
  type PdfPasswordRole,
  type StandardSecurityParams,
} from './standard-security-handler';

/**
 * Bridges the Standard Security Handler with pdf-lib documents so that pdf-lib
 * rewrites of an encrypted PDF are re-encrypted with the original file key,
 * /Encrypt dictionary and /ID, keeping every password and permission intact.
 */

/** Everything required to re-encrypt pdf-lib output exactly like the source document. */
export interface PdfEncryptionContext {
  /** Object cipher bound to the original file encryption key. */
  readonly cipher: PdfObjectCipher;
  /** Detached snapshot of the original /Encrypt dictionary (strings are never encrypted). */
  readonly encryptDict: PDFDict;
  /** Original trailer /ID pair. */
  readonly fileIds: readonly [Uint8Array, Uint8Array];
  /** Password class that unlocked the file key. */
  readonly passwordRole: PdfPasswordRole;
}

/** Options mirroring pdf-lib SaveOptions that remain meaningful for encrypted output. */
export interface EncryptedSaveOptions {
  /** Regenerates AcroForm field appearances before encryption. Defaults to true like pdf-lib. */
  readonly updateFieldAppearances?: boolean;
  /** Adds a blank page when the document is empty. Defaults to true like pdf-lib. */
  readonly addDefaultPage?: boolean;
}

/** Direction of an in-place object transformation. */
type CryptDirection = 'encrypt' | 'decrypt';

/**
 * Resolves the encryption context of serialised PDF bytes.
 *
 * @param encryptedBytes Bytes of the encrypted document as produced by PDFium.
 * @param password Password used to open or unlock the document.
 * @return The context, or null when the bytes carry no /Encrypt dictionary.
 */
export async function resolvePdfEncryptionContext(
  encryptedBytes: Uint8Array,
  password: string
): Promise<PdfEncryptionContext | null> {
  const pdfDoc = await PDFDocument.load(encryptedBytes, { ignoreEncryption: true, updateMetadata: false });
  return readPdfEncryptionContext(pdfDoc, password);
}

/**
 * Reads the encryption context from an already parsed pdf-lib document.
 *
 * @param pdfDoc Document loaded with ignoreEncryption.
 * @param password Password used to open or unlock the document.
 * @return The context, or null when the document carries no /Encrypt dictionary.
 */
export function readPdfEncryptionContext(pdfDoc: PDFDocument, password: string): PdfEncryptionContext | null {
  const { context } = pdfDoc;
  const encryptEntry = context.trailerInfo.Encrypt;
  if (!encryptEntry) return null;

  const encryptDict = context.lookup(encryptEntry);
  if (!(encryptDict instanceof PDFDict)) {
    throw new UnsupportedPdfEncryptionError('The trailer /Encrypt entry is not a dictionary.');
  }

  const fileIds = readFileIds(context);
  const params = parseStandardSecurityParams(encryptDict, fileIds[0]);
  const { key, role } = resolveFileEncryptionKey(params, password);

  return {
    cipher: new PdfObjectCipher(params, key),
    encryptDict: detachPdfObject(encryptDict, context) as PDFDict,
    fileIds,
    passwordRole: role,
  };
}

/**
 * Checks whether a document loaded with ignoreEncryption uses the same security handler
 * (identical /O, /U and first /ID element) as the given context.
 *
 * @param pdfDoc Document loaded from encrypted bytes.
 * @param encryption Candidate context.
 * @return True when the context can decrypt and extend the document.
 */
export function matchesPdfEncryption(pdfDoc: PDFDocument, encryption: PdfEncryptionContext): boolean {
  const { context } = pdfDoc;
  const encryptEntry = context.trailerInfo.Encrypt;
  const encryptDict = encryptEntry ? context.lookup(encryptEntry) : undefined;
  if (!(encryptDict instanceof PDFDict)) return false;

  const { params } = encryption.cipher;
  const ownerKey = readBytes(encryptDict, 'O');
  const userKey = readBytes(encryptDict, 'U');
  return (
    ownerKey !== null &&
    userKey !== null &&
    bytesEqual(ownerKey, params.ownerKey) &&
    bytesEqual(userKey, params.userKey) &&
    bytesEqual(readFileIds(context)[0], params.fileId)
  );
}

/**
 * Parses a Standard Security Handler /Encrypt dictionary.
 *
 * @param encryptDict The /Encrypt dictionary.
 * @param fileId First element of the trailer /ID array.
 * @return Parsed parameters.
 * @throws UnsupportedPdfEncryptionError For non-standard handlers or malformed entries.
 */
export function parseStandardSecurityParams(encryptDict: PDFDict, fileId: Uint8Array): StandardSecurityParams {
  const filter = encryptDict.lookup(PDFName.of('Filter'));
  if (!(filter instanceof PDFName) || filter.asString() !== '/Standard') {
    throw new UnsupportedPdfEncryptionError('Only the Standard Security Handler can be preserved.');
  }

  const version = readNumber(encryptDict, 'V', 0);
  const revision = readNumber(encryptDict, 'R', 2);
  const ownerKey = readBytes(encryptDict, 'O');
  const userKey = readBytes(encryptDict, 'U');
  if (!ownerKey || !userKey) {
    throw new UnsupportedPdfEncryptionError('The /Encrypt dictionary is missing /O or /U.');
  }

  const encryptMetadataEntry = encryptDict.lookup(PDFName.of('EncryptMetadata'));
  const encryptMetadata = encryptMetadataEntry instanceof PDFBool ? encryptMetadataEntry.asBoolean() : true;

  let stringMethod: PdfCryptMethod = 'rc4';
  let streamMethod: PdfCryptMethod = 'rc4';
  let keyBits = readNumber(encryptDict, 'Length', 40);

  if (version >= 4) {
    const stringFilter = resolveCryptFilter(encryptDict, 'StrF');
    const streamFilter = resolveCryptFilter(encryptDict, 'StmF');
    stringMethod = stringFilter.method;
    streamMethod = streamFilter.method;
    keyBits = streamFilter.lengthBits ?? stringFilter.lengthBits ?? 128;
  }

  // note: mirrors PDFium, which treats crypt filter lengths below 40 as byte counts
  if (keyBits < 40) keyBits *= 8;
  let keyLength = Math.floor(keyBits / 8);
  if (stringMethod === 'aesv2' || streamMethod === 'aesv2') keyLength = 16;
  if (version >= 5 || stringMethod === 'aesv3' || streamMethod === 'aesv3') keyLength = 32;
  if (version === 1) keyLength = 5;

  return {
    version,
    revision,
    keyLength,
    ownerKey,
    userKey,
    ownerEncryptedKey: readBytes(encryptDict, 'OE') ?? undefined,
    userEncryptedKey: readBytes(encryptDict, 'UE') ?? undefined,
    permissions: readNumber(encryptDict, 'P', -4) | 0,
    encryptMetadata,
    stringMethod,
    streamMethod,
    fileId,
  };
}

/**
 * Encrypts every string and stream of a plaintext pdf-lib document in place and
 * attaches the original /Encrypt dictionary and /ID. Lazily embedded fonts, images
 * and pages are flushed first so that no object escapes encryption.
 *
 * @param pdfDoc Plaintext document (must not already declare /Encrypt).
 * @param encryption Context of the source document.
 * @param options Save behaviour mirroring pdf-lib defaults.
 * @return Serialised encrypted bytes.
 */
export async function saveEncryptedPdfDocument(
  pdfDoc: PDFDocument,
  encryption: PdfEncryptionContext,
  options: EncryptedSaveOptions = {}
): Promise<Uint8Array> {
  const { updateFieldAppearances = true, addDefaultPage = true } = options;
  if (addDefaultPage && pdfDoc.getPageCount() === 0) pdfDoc.addPage();
  if (updateFieldAppearances && pdfDoc.catalog.has(PDFName.of('AcroForm'))) {
    pdfDoc.getForm().updateFieldAppearances();
  }
  await pdfDoc.flush();

  encryptPdfDocument(pdfDoc, encryption);

  // note: object streams would wrap already encrypted strings, which ISO 32000 forbids
  return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
}

/**
 * Re-encrypts plaintext PDF bytes with the context of the source document.
 *
 * @param plainBytes Unencrypted PDF bytes (for example pdf-lib output).
 * @param encryption Context of the source document.
 * @return Encrypted PDF bytes.
 */
export async function encryptPdfBytes(plainBytes: Uint8Array, encryption: PdfEncryptionContext): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(plainBytes, { updateMetadata: false });
  return saveEncryptedPdfDocument(pdfDoc, encryption, { updateFieldAppearances: false, addDefaultPage: false });
}

/**
 * Encrypts all indirect objects of a plaintext pdf-lib document in place and
 * attaches the original /Encrypt dictionary and /ID to the trailer. Callers must
 * flush pending embeds beforehand and serialise without object streams.
 *
 * @param pdfDoc Plaintext document.
 * @param encryption Context of the source document.
 * @throws Error When the document already declares /Encrypt.
 */
export function encryptPdfDocument(pdfDoc: PDFDocument, encryption: PdfEncryptionContext): void {
  const { context } = pdfDoc;
  if (context.trailerInfo.Encrypt) {
    throw new Error('Refusing to encrypt a document that already declares /Encrypt.');
  }

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    context.assign(ref, encryptPdfObject(object, ref, encryption, context));
  }

  context.trailerInfo.Encrypt = context.register(detachPdfObject(encryption.encryptDict, context));
  context.trailerInfo.ID = context.obj([
    PDFHexString.of(toHex(encryption.fileIds[0])),
    PDFHexString.of(toHex(encryption.fileIds[1])),
  ]);
}

/**
 * Decrypts all indirect objects of a pdf-lib document loaded with ignoreEncryption,
 * leaving the trailer /Encrypt and /ID untouched so incremental updates can chain.
 *
 * @param pdfDoc Document loaded from encrypted bytes.
 * @param encryption Context resolved from the same bytes.
 */
export function decryptPdfDocument(pdfDoc: PDFDocument, encryption: PdfEncryptionContext): void {
  const { context } = pdfDoc;
  const encryptEntry = context.trailerInfo.Encrypt;
  const encryptRef = encryptEntry instanceof PDFRef ? encryptEntry : null;

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (encryptRef && ref === encryptRef) continue;
    context.assign(ref, transformIndirectObject(object, ref, encryption, context, 'decrypt'));
  }
}

/**
 * Returns an encrypted copy of a single indirect object, leaving the input untouched.
 * Used by incremental writers that serialise objects individually.
 *
 * @param object Plaintext indirect object.
 * @param ref Reference the object is written under.
 * @param encryption Context of the source document.
 * @param context Owning pdf-lib context.
 * @return Encrypted object (the same instance when nothing required encryption).
 */
export function encryptPdfObject(
  object: PDFObject,
  ref: PDFRef,
  encryption: PdfEncryptionContext,
  context: PDFContext
): PDFObject {
  return transformIndirectObject(object, ref, encryption, context, 'encrypt');
}

/**
 * Transforms the strings and stream data of one indirect object without mutating shared
 * direct containers, which pdf-lib may reference from several indirect objects.
 *
 * @param object Indirect object value.
 * @param ref Object reference supplying the per-object key.
 * @param encryption Encryption context.
 * @param context Owning pdf-lib context.
 * @param direction Encrypt or decrypt.
 * @return Transformed object.
 */
function transformIndirectObject(
  object: PDFObject,
  ref: PDFRef,
  encryption: PdfEncryptionContext,
  context: PDFContext,
  direction: CryptDirection
): PDFObject {
  const id: PdfObjectId = { objectNumber: ref.objectNumber, generationNumber: ref.generationNumber };

  if (object instanceof PDFStream) {
    const dict = transformDirectObject(object.dict, id, encryption, context, direction) as PDFDict;
    const contents = object.getContents();
    if (!shouldCryptStreamContents(object.dict, encryption)) {
      return dict === object.dict && object instanceof PDFRawStream ? object : PDFRawStream.of(dict, contents);
    }
    const transformed =
      direction === 'encrypt'
        ? encryption.cipher.encryptStream(contents, id)
        : encryption.cipher.decryptStream(contents, id);
    return PDFRawStream.of(dict === object.dict ? cloneDict(dict, context) : dict, transformed);
  }

  return transformDirectObject(object, id, encryption, context, direction);
}

/**
 * Recursively transforms strings within a direct object using copy-on-write semantics.
 *
 * @param object Direct object value.
 * @param id Owning indirect object.
 * @param encryption Encryption context.
 * @param context Owning pdf-lib context.
 * @param direction Encrypt or decrypt.
 * @return The original instance when unchanged, otherwise a transformed copy.
 */
function transformDirectObject(
  object: PDFObject,
  id: PdfObjectId,
  encryption: PdfEncryptionContext,
  context: PDFContext,
  direction: CryptDirection
): PDFObject {
  if (object instanceof PDFString || object instanceof PDFHexString) {
    const bytes = object.asBytes();
    const transformed =
      direction === 'encrypt'
        ? encryption.cipher.encryptString(bytes, id)
        : encryption.cipher.decryptString(bytes, id);
    return PDFHexString.of(toHex(transformed));
  }

  if (object instanceof PDFDict) {
    const skipContents = isSignatureDictionary(object);
    let copy: PDFDict | null = null;
    for (const [key, value] of object.entries()) {
      // note: ISO 32000-1 7.6.1 exempts the signature /Contents string from encryption
      if (skipContents && key === PDFName.of('Contents')) continue;
      const next = transformDirectObject(value, id, encryption, context, direction);
      if (next !== value) {
        copy ??= cloneDict(object, context);
        copy.set(key, next);
      }
    }
    return copy ?? object;
  }

  if (object instanceof PDFArray) {
    let copy: PDFArray | null = null;
    for (let i = 0; i < object.size(); i++) {
      const value = object.get(i);
      const next = transformDirectObject(value, id, encryption, context, direction);
      if (next !== value) {
        copy ??= cloneArray(object, context);
        copy.set(i, next);
      }
    }
    return copy ?? object;
  }

  return object;
}

/**
 * Decides whether a stream's data participates in document encryption.
 *
 * @param dict Stream dictionary.
 * @param encryption Encryption context.
 * @return True when the stream contents must be encrypted or decrypted.
 */
function shouldCryptStreamContents(dict: PDFDict, encryption: PdfEncryptionContext): boolean {
  const type = dict.lookup(PDFName.of('Type'));
  if (type === PDFName.of('XRef')) return false;
  if (type === PDFName.of('Metadata') && !encryption.cipher.encryptsMetadata) return false;

  // note: streams carrying their own /Crypt filter are governed by that filter instead
  const filter = dict.lookup(PDFName.of('Filter'));
  if (filter === PDFName.of('Crypt')) return false;
  if (filter instanceof PDFArray && filter.asArray().some((entry) => entry === PDFName.of('Crypt'))) return false;
  return true;
}

/**
 * Detects signature and document timestamp dictionaries.
 *
 * @param dict Candidate dictionary.
 * @return True when the dictionary is a signature value dictionary.
 */
function isSignatureDictionary(dict: PDFDict): boolean {
  if (dict.has(PDFName.of('ByteRange'))) return true;
  const type = dict.lookup(PDFName.of('Type'));
  return type === PDFName.of('Sig') || type === PDFName.of('DocTimeStamp');
}

/**
 * Resolves the cipher of a named crypt filter (/StrF or /StmF).
 *
 * @param encryptDict The /Encrypt dictionary.
 * @param entry Either StrF or StmF.
 * @return Cipher method and optional key length in bits.
 */
function resolveCryptFilter(
  encryptDict: PDFDict,
  entry: 'StrF' | 'StmF'
): { method: PdfCryptMethod; lengthBits?: number } {
  const name = encryptDict.lookup(PDFName.of(entry));
  if (!(name instanceof PDFName) || name === PDFName.of('Identity')) {
    return { method: 'none' };
  }

  const filters = encryptDict.lookup(PDFName.of('CF'));
  const filter = filters instanceof PDFDict ? filters.lookup(name) : undefined;
  if (!(filter instanceof PDFDict)) {
    throw new UnsupportedPdfEncryptionError(`Crypt filter ${name.asString()} is not defined in /CF.`);
  }

  const cfm = filter.lookup(PDFName.of('CFM'));
  const lengthEntry = filter.lookup(PDFName.of('Length'));
  const lengthBits = lengthEntry instanceof PDFNumber ? lengthEntry.asNumber() : undefined;

  switch (cfm instanceof PDFName ? cfm.asString() : '/None') {
    case '/V2':
      return { method: 'rc4', lengthBits };
    case '/AESV2':
      return { method: 'aesv2', lengthBits };
    case '/AESV3':
      return { method: 'aesv3', lengthBits };
    case '/None':
      return { method: 'none', lengthBits };
    default:
      throw new UnsupportedPdfEncryptionError(`Unsupported crypt filter method ${String(cfm)}.`);
  }
}

/**
 * Reads the trailer /ID pair, synthesising a stable pair when it is absent.
 *
 * @param context Source pdf-lib context.
 * @return The two file identifiers.
 */
function readFileIds(context: PDFContext): readonly [Uint8Array, Uint8Array] {
  const idEntry = context.trailerInfo.ID ? context.lookup(context.trailerInfo.ID) : undefined;
  if (idEntry instanceof PDFArray && idEntry.size() >= 1) {
    const first = bytesOf(idEntry.lookup(0)) ?? new Uint8Array(0);
    const second = idEntry.size() >= 2 ? bytesOf(idEntry.lookup(1)) ?? first : first;
    return [first, second];
  }
  // note: Algorithm 2 hashes an empty /ID when none is present
  return [new Uint8Array(0), new Uint8Array(0)];
}

/**
 * Deep copies a direct object graph into another context, resolving nothing indirect.
 *
 * @param object Source object.
 * @param context Destination context.
 * @return Detached copy.
 */
function detachPdfObject(object: PDFObject, context: PDFContext): PDFObject {
  if (object instanceof PDFDict) {
    const copy = PDFDict.withContext(context);
    for (const [key, value] of object.entries()) copy.set(key, detachPdfObject(value, context));
    return copy;
  }
  if (object instanceof PDFArray) {
    const copy = PDFArray.withContext(context);
    for (const value of object.asArray()) copy.push(detachPdfObject(value, context));
    return copy;
  }
  return object;
}

/**
 * Shallow copies a dictionary.
 *
 * @param dict Source dictionary.
 * @param context Owning context.
 * @return New dictionary sharing entry values.
 */
function cloneDict(dict: PDFDict, context: PDFContext): PDFDict {
  const copy = PDFDict.withContext(context);
  for (const [key, value] of dict.entries()) copy.set(key, value);
  return copy;
}

/**
 * Shallow copies an array.
 *
 * @param array Source array.
 * @param context Owning context.
 * @return New array sharing element values.
 */
function cloneArray(array: PDFArray, context: PDFContext): PDFArray {
  const copy = PDFArray.withContext(context);
  for (const value of array.asArray()) copy.push(value);
  return copy;
}

/**
 * Reads a numeric dictionary entry.
 *
 * @param dict Source dictionary.
 * @param key Entry name without the leading slash.
 * @param fallback Value used when the entry is missing.
 * @return The number.
 */
function readNumber(dict: PDFDict, key: string, fallback: number): number {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

/**
 * Reads a string dictionary entry as raw bytes.
 *
 * @param dict Source dictionary.
 * @param key Entry name without the leading slash.
 * @return The bytes, or null when missing.
 */
function readBytes(dict: PDFDict, key: string): Uint8Array | null {
  return bytesOf(dict.lookup(PDFName.of(key)));
}

/**
 * Extracts raw bytes from a literal or hexadecimal string object.
 *
 * @param value Candidate object.
 * @return The bytes, or null for non-string objects.
 */
function bytesOf(value: PDFObject | undefined): Uint8Array | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.asBytes();
  return null;
}

/**
 * Encodes bytes as uppercase hexadecimal.
 *
 * @param bytes Source bytes.
 * @return Hexadecimal string.
 */
function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out.toUpperCase();
}
