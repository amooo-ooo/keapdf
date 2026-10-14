import forge from 'node-forge';

/**
 * Low-level byte and cipher primitives used by the ISO 32000 Standard Security Handler.
 * Hashing and AES are delegated to node-forge; RC4 is implemented locally because
 * node-forge does not ship an ARC4 stream cipher.
 */

/** AES block size in bytes. */
export const AES_BLOCK_SIZE = 16;

/**
 * Converts a byte array into a node-forge binary string.
 *
 * @param bytes Source bytes.
 * @return Binary string with one character per byte.
 */
export function toBinaryString(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

/**
 * Converts a node-forge binary string into a byte array.
 *
 * @param binary Binary string with one character per byte.
 * @return Decoded bytes.
 */
export function fromBinaryString(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Concatenates byte arrays into a single contiguous buffer.
 *
 * @param parts Byte arrays to join in order.
 * @return Joined bytes.
 */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/**
 * Compares two byte arrays for equality.
 *
 * @param a First byte array.
 * @param b Second byte array.
 * @return True when both arrays hold identical bytes.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Generates cryptographically secure random bytes.
 *
 * @param length Number of bytes to generate.
 * @return Random bytes.
 */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Supported message digest algorithms. */
export type DigestAlgorithm = 'md5' | 'sha256' | 'sha384' | 'sha512';

/**
 * Computes a message digest over the given bytes.
 *
 * @param algorithm Digest algorithm identifier.
 * @param data Input bytes.
 * @return Digest bytes.
 */
export function digest(algorithm: DigestAlgorithm, data: Uint8Array): Uint8Array {
  const md = createMessageDigest(algorithm);
  md.update(toBinaryString(data));
  return fromBinaryString(md.digest().getBytes());
}

/**
 * Instantiates a node-forge message digest for the given algorithm.
 *
 * @param algorithm Digest algorithm identifier.
 * @return Fresh message digest instance.
 */
function createMessageDigest(algorithm: DigestAlgorithm): forge.md.MessageDigest {
  switch (algorithm) {
    case 'md5':
      return forge.md.md5.create();
    case 'sha256':
      return forge.md.sha256.create();
    case 'sha384':
      return forge.md.sha384.create();
    case 'sha512':
      return forge.md.sha512.create();
  }
}

/**
 * Block cipher finaliser of node-forge. The runtime accepts a padding override that the
 * published typings omit; returning true from it disables PKCS#5 padding.
 */
interface PaddingAwareCipher {
  finish(pad?: () => boolean): boolean;
}

/**
 * Finalises a node-forge AES-CBC cipher with or without PKCS#5 padding.
 *
 * @param cipher Started cipher or decipher.
 * @param pad Whether to apply (encrypt) or strip (decrypt) PKCS#5 padding.
 * @return Whether finalisation succeeded.
 */
function finishCipher(cipher: forge.cipher.BlockCipher, pad: boolean): boolean {
  const finaliser: PaddingAwareCipher = cipher;
  return finaliser.finish(pad ? undefined : () => true);
}

/**
 * Encrypts data with AES in CBC mode.
 *
 * @param key AES key (16 or 32 bytes).
 * @param iv Initialisation vector (16 bytes).
 * @param data Plaintext bytes.
 * @param pad Whether to apply PKCS#5 padding. When false, data must be block aligned.
 * @return Ciphertext bytes (without the IV).
 */
export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, pad: boolean): Uint8Array {
  const cipher = forge.cipher.createCipher('AES-CBC', toBinaryString(key));
  cipher.start({ iv: toBinaryString(iv) });
  cipher.update(forge.util.createBuffer(toBinaryString(data)));
  if (!finishCipher(cipher, pad)) {
    throw new Error('AES-CBC encryption failed.');
  }
  return fromBinaryString(cipher.output.getBytes());
}

/**
 * Decrypts AES-CBC ciphertext.
 *
 * @param key AES key (16 or 32 bytes).
 * @param iv Initialisation vector (16 bytes).
 * @param data Ciphertext bytes (without the IV).
 * @param pad Whether PKCS#5 padding should be stripped.
 * @return Plaintext bytes.
 */
export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, pad: boolean): Uint8Array {
  const decipher = forge.cipher.createDecipher('AES-CBC', toBinaryString(key));
  decipher.start({ iv: toBinaryString(iv) });
  decipher.update(forge.util.createBuffer(toBinaryString(data)));
  if (!finishCipher(decipher, pad)) {
    throw new Error('AES-CBC decryption failed due to invalid padding.');
  }
  return fromBinaryString(decipher.output.getBytes());
}

/**
 * Applies the RC4 (ARC4) stream cipher. Encryption and decryption are identical.
 *
 * @param key Cipher key (1 to 256 bytes).
 * @param data Input bytes.
 * @return Transformed bytes.
 */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = new Uint8Array(256);
  for (let i = 0; i < 256; i++) state[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    const tmp = state[i];
    state[i] = state[j];
    state[j] = tmp;
  }

  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + state[a]) & 0xff;
    const tmp = state[a];
    state[a] = state[b];
    state[b] = tmp;
    out[k] = data[k] ^ state[(state[a] + state[b]) & 0xff];
  }
  return out;
}
