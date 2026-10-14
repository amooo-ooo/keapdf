import {
  AES_BLOCK_SIZE,
  aesCbcDecrypt,
  aesCbcEncrypt,
  concatBytes,
  digest,
  randomBytes,
  rc4,
} from './crypto-primitives';
import type { PdfCryptMethod, StandardSecurityParams } from './standard-security-handler';

/** Identifies the indirect object whose strings and streams are being transformed. */
export interface PdfObjectId {
  /** Indirect object number. */
  readonly objectNumber: number;
  /** Indirect object generation number. */
  readonly generationNumber: number;
}

/** AESV2 per-object key salt ("sAlT"), ISO 32000-1 Algorithm 1 step b. */
const AES_KEY_SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54]);

/**
 * Encrypts and decrypts individual PDF strings and streams with a resolved file key,
 * implementing ISO 32000-1 Algorithm 1 (RC4, AESV2) and ISO 32000-2 Algorithm 1.A (AESV3).
 */
export class PdfObjectCipher {
  /**
   * @param params Parsed security handler parameters.
   * @param fileKey File encryption key resolved from a password.
   */
  constructor(
    public readonly params: StandardSecurityParams,
    private readonly fileKey: Uint8Array
  ) {}

  /** Whether the document-level XMP metadata stream must be encrypted. */
  get encryptsMetadata(): boolean {
    return this.params.encryptMetadata;
  }

  /**
   * Encrypts string bytes belonging to an indirect object.
   *
   * @param data Plaintext string bytes.
   * @param id Owning indirect object.
   * @return Ciphertext bytes.
   */
  encryptString(data: Uint8Array, id: PdfObjectId): Uint8Array {
    return this.encrypt(this.params.stringMethod, data, id);
  }

  /**
   * Decrypts string bytes belonging to an indirect object.
   *
   * @param data Ciphertext string bytes.
   * @param id Owning indirect object.
   * @return Plaintext bytes.
   */
  decryptString(data: Uint8Array, id: PdfObjectId): Uint8Array {
    return this.decrypt(this.params.stringMethod, data, id);
  }

  /**
   * Encrypts the encoded (post-filter) contents of a stream.
   *
   * @param data Encoded stream bytes.
   * @param id Owning indirect object.
   * @return Ciphertext bytes.
   */
  encryptStream(data: Uint8Array, id: PdfObjectId): Uint8Array {
    return this.encrypt(this.params.streamMethod, data, id);
  }

  /**
   * Decrypts the contents of a stream back to its encoded (post-filter) form.
   *
   * @param data Ciphertext stream bytes.
   * @param id Owning indirect object.
   * @return Encoded stream bytes.
   */
  decryptStream(data: Uint8Array, id: PdfObjectId): Uint8Array {
    return this.decrypt(this.params.streamMethod, data, id);
  }

  /**
   * Encrypts bytes with the given method.
   *
   * @param method Crypt filter method.
   * @param data Plaintext bytes.
   * @param id Owning indirect object.
   * @return Ciphertext bytes.
   */
  private encrypt(method: PdfCryptMethod, data: Uint8Array, id: PdfObjectId): Uint8Array {
    switch (method) {
      case 'none':
        return data;
      case 'rc4':
        return rc4(this.objectKey(id, false), data);
      case 'aesv2':
      case 'aesv3': {
        const iv = randomBytes(AES_BLOCK_SIZE);
        const key = method === 'aesv3' ? this.fileKey : this.objectKey(id, true);
        return concatBytes(iv, aesCbcEncrypt(key, iv, data, true));
      }
    }
  }

  /**
   * Decrypts bytes with the given method.
   *
   * @param method Crypt filter method.
   * @param data Ciphertext bytes.
   * @param id Owning indirect object.
   * @return Plaintext bytes.
   */
  private decrypt(method: PdfCryptMethod, data: Uint8Array, id: PdfObjectId): Uint8Array {
    switch (method) {
      case 'none':
        return data;
      case 'rc4':
        return rc4(this.objectKey(id, false), data);
      case 'aesv2':
      case 'aesv3': {
        // note: ciphertext shorter than IV plus one block cannot carry data
        if (data.length < AES_BLOCK_SIZE * 2) return new Uint8Array(0);
        const usable = data.length - ((data.length - AES_BLOCK_SIZE) % AES_BLOCK_SIZE);
        const key = method === 'aesv3' ? this.fileKey : this.objectKey(id, true);
        return aesCbcDecrypt(
          key,
          data.subarray(0, AES_BLOCK_SIZE),
          data.subarray(AES_BLOCK_SIZE, usable),
          true
        );
      }
    }
  }

  /**
   * Derives the per-object key for RC4 and AESV2 (Algorithm 1, steps a to d).
   *
   * @param id Owning indirect object.
   * @param aes Whether the AESV2 salt must be appended.
   * @return Per-object key bytes.
   */
  private objectKey(id: PdfObjectId, aes: boolean): Uint8Array {
    const suffix = new Uint8Array([
      id.objectNumber & 0xff,
      (id.objectNumber >> 8) & 0xff,
      (id.objectNumber >> 16) & 0xff,
      id.generationNumber & 0xff,
      (id.generationNumber >> 8) & 0xff,
    ]);
    const hash = digest('md5', concatBytes(this.fileKey, suffix, aes ? AES_KEY_SALT : new Uint8Array(0)));
    return hash.slice(0, Math.min(this.fileKey.length + 5, 16));
  }
}
