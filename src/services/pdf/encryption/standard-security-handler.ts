import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  bytesEqual,
  concatBytes,
  digest,
  rc4,
} from './crypto-primitives';

/**
 * ISO 32000-2 Standard Security Handler key derivation (revisions 2 to 6).
 * Resolves the file encryption key from a user or owner password so that new and
 * modified objects can be encrypted with the exact key of the original document,
 * leaving the existing /Encrypt dictionary, passwords and permissions untouched.
 */

/** Cipher applied to a class of objects (strings or streams). */
export type PdfCryptMethod = 'none' | 'rc4' | 'aesv2' | 'aesv3';

/** Parsed parameters of a Standard Security Handler /Encrypt dictionary. */
export interface StandardSecurityParams {
  /** Algorithm version (/V). */
  readonly version: number;
  /** Handler revision (/R). */
  readonly revision: number;
  /** File encryption key length in bytes. */
  readonly keyLength: number;
  /** Owner password verification entry (/O). */
  readonly ownerKey: Uint8Array;
  /** User password verification entry (/U). */
  readonly userKey: Uint8Array;
  /** Owner-wrapped file key (/OE), revisions 5 and 6 only. */
  readonly ownerEncryptedKey?: Uint8Array;
  /** User-wrapped file key (/UE), revisions 5 and 6 only. */
  readonly userEncryptedKey?: Uint8Array;
  /** Signed 32-bit user access permissions (/P). */
  readonly permissions: number;
  /** Whether the document-level XMP metadata stream is encrypted (/EncryptMetadata). */
  readonly encryptMetadata: boolean;
  /** Cipher applied to strings (/StrF). */
  readonly stringMethod: PdfCryptMethod;
  /** Cipher applied to streams (/StmF). */
  readonly streamMethod: PdfCryptMethod;
  /** First element of the trailer /ID array. */
  readonly fileId: Uint8Array;
}

/** Which password class authenticated the file encryption key. */
export type PdfPasswordRole = 'user' | 'owner';

/** Result of a successful password authentication. */
export interface ResolvedFileKey {
  /** File encryption key used for per-object key derivation. */
  readonly key: Uint8Array;
  /** Password class that produced the key. */
  readonly role: PdfPasswordRole;
}

/** Raised when a password does not authenticate against the security handler. */
export class InvalidPdfPasswordError extends Error {
  constructor(message: string = 'The supplied password does not unlock the document encryption key.') {
    super(message);
    this.name = 'InvalidPdfPasswordError';
  }
}

/** Raised when a document uses an encryption scheme this handler cannot reproduce. */
export class UnsupportedPdfEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedPdfEncryptionError';
  }
}

/** ISO 32000-1 Algorithm 2 password padding string. */
const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/** Maximum UTF-8 password length for revisions 5 and 6. */
const MAX_UTF8_PASSWORD_BYTES = 127;

/**
 * Resolves the file encryption key from a password, trying the user password first
 * and falling back to owner password authentication.
 *
 * @param params Parsed security handler parameters.
 * @param password Password supplied when the document was opened or unlocked.
 * @return The file encryption key and the password role that produced it.
 * @throws InvalidPdfPasswordError When the password authenticates neither role.
 */
export function resolveFileEncryptionKey(params: StandardSecurityParams, password: string): ResolvedFileKey {
  assertSupportedRevision(params);

  for (const candidate of encodePasswordCandidates(params, password)) {
    const userKey = authenticateUserPassword(params, candidate);
    if (userKey) return { key: userKey, role: 'user' };
  }
  for (const candidate of encodePasswordCandidates(params, password)) {
    const ownerKey = authenticateOwnerPassword(params, candidate);
    if (ownerKey) return { key: ownerKey, role: 'owner' };
  }
  throw new InvalidPdfPasswordError();
}

/**
 * Computes the /O owner entry for legacy revisions 2 to 4 (ISO 32000-1 Algorithm 3).
 * Exposed so fixtures and future encryption flows can author compatible dictionaries.
 *
 * @param revision Handler revision (2 to 4).
 * @param keyLength File key length in bytes.
 * @param ownerPassword Owner password bytes (falls back to the user password when empty).
 * @param userPassword User password bytes.
 * @return The 32-byte /O value.
 */
export function computeLegacyOwnerKey(
  revision: number,
  keyLength: number,
  ownerPassword: Uint8Array,
  userPassword: Uint8Array
): Uint8Array {
  const rc4Key = deriveLegacyOwnerRc4Key(revision, keyLength, ownerPassword.length > 0 ? ownerPassword : userPassword);
  let value = rc4(rc4Key, padPassword(userPassword));
  if (revision >= 3) {
    for (let i = 1; i <= 19; i++) {
      value = rc4(xorKey(rc4Key, i), value);
    }
  }
  return value;
}

/**
 * Computes the /U user entry for legacy revisions 2 to 4 (ISO 32000-1 Algorithms 4 and 5).
 *
 * @param params Security parameters whose /U value is being authored (userKey ignored).
 * @param fileKey File encryption key derived via Algorithm 2.
 * @return The 32-byte /U value.
 */
export function computeLegacyUserKey(params: StandardSecurityParams, fileKey: Uint8Array): Uint8Array {
  if (params.revision === 2) {
    return rc4(fileKey, PASSWORD_PADDING);
  }
  let value = rc4(fileKey, digest('md5', concatBytes(PASSWORD_PADDING, params.fileId)));
  for (let i = 1; i <= 19; i++) {
    value = rc4(xorKey(fileKey, i), value);
  }
  return concatBytes(value, new Uint8Array(16));
}

/**
 * Derives a legacy (revision 2 to 4) file encryption key per ISO 32000-1 Algorithm 2.
 *
 * @param params Parsed security handler parameters.
 * @param password Raw password bytes (padded or truncated to 32 bytes internally).
 * @return File encryption key of params.keyLength bytes.
 */
export function computeLegacyFileKey(params: StandardSecurityParams, password: Uint8Array): Uint8Array {
  const permissions = new Uint8Array(4);
  new DataView(permissions.buffer).setInt32(0, params.permissions, true);

  const parts: Uint8Array[] = [padPassword(password), params.ownerKey.subarray(0, 32), permissions, params.fileId];
  if (params.revision >= 4 && !params.encryptMetadata) {
    parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }

  const keyLength = params.revision === 2 ? 5 : params.keyLength;
  let hash = digest('md5', concatBytes(...parts));
  if (params.revision >= 3) {
    for (let i = 0; i < 50; i++) {
      hash = digest('md5', hash.subarray(0, keyLength));
    }
  }
  return hash.slice(0, keyLength);
}

/**
 * Verifies a user password and returns the file key when it matches.
 *
 * @param params Parsed security handler parameters.
 * @param password Encoded password bytes.
 * @return File key, or null when the password does not authenticate.
 */
function authenticateUserPassword(params: StandardSecurityParams, password: Uint8Array): Uint8Array | null {
  if (params.revision >= 5) {
    const validationSalt = params.userKey.subarray(32, 40);
    const keySalt = params.userKey.subarray(40, 48);
    const hash = computeModernHash(params.revision, password, validationSalt, new Uint8Array(0));
    if (!bytesEqual(hash, params.userKey.subarray(0, 32))) return null;
    const intermediate = computeModernHash(params.revision, password, keySalt, new Uint8Array(0));
    return unwrapModernFileKey(intermediate, params.userEncryptedKey, 'UE');
  }

  const fileKey = computeLegacyFileKey(params, password);
  const expected = computeLegacyUserKey(params, fileKey);
  const compareLength = params.revision === 2 ? 32 : 16;
  return bytesEqual(expected.subarray(0, compareLength), params.userKey.subarray(0, compareLength)) ? fileKey : null;
}

/**
 * Verifies an owner password and returns the file key when it matches.
 *
 * @param params Parsed security handler parameters.
 * @param password Encoded password bytes.
 * @return File key, or null when the password does not authenticate.
 */
function authenticateOwnerPassword(params: StandardSecurityParams, password: Uint8Array): Uint8Array | null {
  if (params.revision >= 5) {
    const userData = params.userKey.subarray(0, 48);
    const validationSalt = params.ownerKey.subarray(32, 40);
    const keySalt = params.ownerKey.subarray(40, 48);
    const hash = computeModernHash(params.revision, password, validationSalt, userData);
    if (!bytesEqual(hash, params.ownerKey.subarray(0, 32))) return null;
    const intermediate = computeModernHash(params.revision, password, keySalt, userData);
    return unwrapModernFileKey(intermediate, params.ownerEncryptedKey, 'OE');
  }

  // Algorithm 7: recover the padded user password from /O, then authenticate it.
  const rc4Key = deriveLegacyOwnerRc4Key(params.revision, params.keyLength, password);
  let userPassword = params.ownerKey.subarray(0, 32);
  if (params.revision === 2) {
    userPassword = rc4(rc4Key, userPassword);
  } else {
    for (let i = 19; i >= 0; i--) {
      userPassword = rc4(xorKey(rc4Key, i), userPassword);
    }
  }
  return authenticateUserPassword(params, userPassword);
}

/**
 * Derives the RC4 key used to wrap the user password inside /O (Algorithm 3, steps a to d).
 *
 * @param revision Handler revision.
 * @param keyLength File key length in bytes.
 * @param ownerPassword Owner password bytes.
 * @return RC4 key bytes.
 */
function deriveLegacyOwnerRc4Key(revision: number, keyLength: number, ownerPassword: Uint8Array): Uint8Array {
  let hash = digest('md5', padPassword(ownerPassword));
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) {
      hash = digest('md5', hash);
    }
  }
  return hash.slice(0, revision === 2 ? 5 : keyLength);
}

/**
 * Computes the revision 5 or revision 6 password hash (ISO 32000-2 Algorithm 2.B).
 *
 * @param revision Handler revision (5 or 6).
 * @param password UTF-8 password bytes.
 * @param salt Eight-byte validation or key salt.
 * @param userData Forty-eight byte /U prefix for owner operations, empty otherwise.
 * @return Thirty-two byte hash.
 */
function computeModernHash(
  revision: number,
  password: Uint8Array,
  salt: Uint8Array,
  userData: Uint8Array
): Uint8Array {
  let hash = digest('sha256', concatBytes(password, salt, userData));
  if (revision === 5) return hash;

  let round = 0;
  for (;;) {
    const block = concatBytes(password, hash, userData);
    const repeated = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) repeated.set(block, i * block.length);

    const encrypted = aesCbcEncrypt(hash.subarray(0, 16), hash.subarray(16, 32), repeated, false);
    let remainder = 0;
    for (let i = 0; i < 16; i++) remainder += encrypted[i];
    remainder %= 3;

    hash = digest(remainder === 0 ? 'sha256' : remainder === 1 ? 'sha384' : 'sha512', encrypted);
    round++;
    if (round >= 64 && encrypted[encrypted.length - 1] <= round - 32) break;
  }
  return hash.slice(0, 32);
}

/**
 * Unwraps a revision 5 or 6 file key from /UE or /OE using AES-256 with a zero IV.
 *
 * @param intermediateKey Key derived from the password and key salt.
 * @param wrappedKey Thirty-two byte wrapped key entry.
 * @param entryName Dictionary entry name for diagnostics.
 * @return Thirty-two byte file encryption key.
 */
function unwrapModernFileKey(intermediateKey: Uint8Array, wrappedKey: Uint8Array | undefined, entryName: string): Uint8Array {
  if (!wrappedKey || wrappedKey.length < 32) {
    throw new UnsupportedPdfEncryptionError(`The /Encrypt dictionary is missing a valid /${entryName} entry.`);
  }
  return aesCbcDecrypt(intermediateKey, new Uint8Array(16), wrappedKey.subarray(0, 32), false);
}

/**
 * Produces candidate password encodings in priority order for the given revision.
 *
 * @param params Parsed security handler parameters.
 * @param password Password as entered by the user.
 * @return Distinct encoded password byte arrays.
 */
function encodePasswordCandidates(params: StandardSecurityParams, password: string): Uint8Array[] {
  const encoder = new TextEncoder();
  const utf8 = encoder.encode(password);
  if (params.revision >= 5) {
    // note: PDFium hashes the raw UTF-8 bytes, whereas ISO 32000-2 mandates SASLprep,
    // approximated here with NFKC so documents from either producer authenticate.
    const prepared = encoder.encode(password.normalize('NFKC'));
    const candidates = [utf8.subarray(0, MAX_UTF8_PASSWORD_BYTES)];
    if (!bytesEqual(prepared, utf8)) candidates.push(prepared.subarray(0, MAX_UTF8_PASSWORD_BYTES));
    return candidates;
  }

  const candidates: Uint8Array[] = [];
  let latin1: Uint8Array | null = new Uint8Array(password.length);
  for (let i = 0; i < password.length; i++) {
    const code = password.charCodeAt(i);
    if (code > 0xff) {
      latin1 = null;
      break;
    }
    latin1[i] = code;
  }
  if (latin1) candidates.push(latin1);
  if (!latin1 || !bytesEqual(latin1, utf8)) candidates.push(utf8);
  return candidates;
}

/**
 * Pads or truncates a password to exactly 32 bytes (Algorithm 2, step a).
 *
 * @param password Raw password bytes.
 * @return Thirty-two byte padded password.
 */
function padPassword(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  const used = Math.min(password.length, 32);
  out.set(password.subarray(0, used), 0);
  out.set(PASSWORD_PADDING.subarray(0, 32 - used), used);
  return out;
}

/**
 * XORs every byte of a key with a single-byte counter.
 *
 * @param key Source key bytes.
 * @param value Counter value (0 to 255).
 * @return New key bytes.
 */
function xorKey(key: Uint8Array, value: number): Uint8Array {
  const out = new Uint8Array(key.length);
  for (let i = 0; i < key.length; i++) out[i] = key[i] ^ value;
  return out;
}

/**
 * Guards against revisions outside the Standard Security Handler specification.
 *
 * @param params Parsed security handler parameters.
 * @throws UnsupportedPdfEncryptionError For unknown revisions.
 */
function assertSupportedRevision(params: StandardSecurityParams): void {
  if (params.revision < 2 || params.revision > 6) {
    throw new UnsupportedPdfEncryptionError(`Unsupported Standard Security Handler revision ${params.revision}.`);
  }
}
