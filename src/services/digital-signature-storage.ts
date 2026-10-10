/**
 * Persistent offline storage and CacheStorage service for ISO 32000 and PAdES digital signatures.
 *
 * Serialises X.509 certificates, RSA private keys, PKCS#12 bundles, and signing configurations
 * into localStorage and mirrors records into browser CacheStorage for offline resilience.
 */

import forge from 'node-forge';
import type { DigitalIdentity } from './pdf/operations/signature-ops';

/** Supported detached signature subfilter encodings. */
export type DigitalSignatureSubFilter = 'ETSI.CAdES.detached' | 'adbe.pkcs7.detached';

/** Predefined or custom visual signature placement positions on a PDF page. */
export type DigitalSignaturePlacement =
  | 'bottom-right'
  | 'bottom-left'
  | 'center'
  | 'top-right'
  | 'top-left'
  | 'custom';

/**
 * Serialised representation of a cryptographic DigitalIdentity for offline storage.
 */
export interface SerializedDigitalIdentity {
  /** PEM-encoded leaf X.509 certificate. */
  certificatePem: string;
  /** PEM-encoded RSA private key for passwordless reconstruction. */
  privateKeyPem: string;
  /** PEM-encoded X.509 certificate chain preserving leaf, intermediate, and root CAs. */
  certificateChainPems: string[];
  /** Base64-encoded PKCS#12 (.p12/.pfx) binary bundle. */
  p12Base64: string;
  /** Signer subject attributes. */
  subject: {
    commonName: string;
    organization?: string;
    organizationalUnit?: string;
    email?: string;
    country?: string;
  };
  /** Certificate issuer attributes. */
  issuer: {
    commonName: string;
    organization?: string;
  };
  /** ISO 8601 validity start timestamp. */
  validFromIso: string;
  /** ISO 8601 validity expiration timestamp. */
  validToIso: string;
  /** Hexadecimal certificate serial number. */
  serialNumber: string;
}

/**
 * Persisted signing metadata, PAdES compliance options, and visual appearance settings.
 */
export interface SavedDigitalSignatureConfig {
  /** Declared signing reason. */
  reason: string;
  /** Declared signing location. */
  location: string;
  /** Declared signer contact information. */
  contactInfo: string;
  /** Signature standard subfilter. */
  subFilter: DigitalSignatureSubFilter;
  /** Whether RFC 3161 timestamping is enabled. */
  enableTimestamp: boolean;
  /** Time-Stamp Authority server URL. */
  tsaUrl: string;
  /** Whether to embed a Long-Term Validation Document Security Store (/DSS). */
  embedDss: boolean;
  /** Whether to render a visible signature appearance box on the PDF page. */
  isVisibleSignature: boolean;
  /** Target page placement position for visible signatures. */
  placementPosition: DigitalSignaturePlacement;
  /** Optional custom freeform bounding box in top-left canvas points. */
  customRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Optional linked saved handwritten graphic signature identifier. */
  selectedGraphicSigId: string | null;
  /** Whether to render the signer's full name underneath the signature graphic. */
  showTextDetails: boolean;
}

/**
 * Complete saved digital signature record stored in localStorage and offline CacheStorage.
 */
export interface SavedDigitalSignature {
  /** Unique saved digital signature identifier. */
  id: string;
  /** Human-readable label for the digital signature profile. */
  label: string;
  /** Serialised cryptographic identity and key material. */
  identity: SerializedDigitalIdentity;
  /** Saved signing details, PAdES profile settings, and visual appearance options. */
  config: SavedDigitalSignatureConfig;
  /** Creation epoch timestamp in milliseconds. */
  createdAt: number;
  /** Last update epoch timestamp in milliseconds. */
  updatedAt: number;
  /** Whether this digital signature is designated as the default profile. */
  isDefault: boolean;
}

/**
 * Input payload for saving or updating a digital signature record.
 */
export interface SaveDigitalSignatureInput {
  /** Optional explicit record identifier to update. */
  id?: string;
  /** Optional custom label; defaults to signer Common Name and organisation. */
  label?: string;
  /** Unlocked cryptographic DigitalIdentity. */
  identity: DigitalIdentity;
  /** Signing metadata, PAdES options, and visual appearance settings. */
  config: SavedDigitalSignatureConfig;
  /** Whether to mark this digital signature as the default profile. */
  isDefault?: boolean;
}

/** LocalStorage key for saved digital signatures. */
export const DIGITAL_SIGNATURE_STORAGE_KEY = 'pdf_editor_saved_digital_signatures_v1';

/** Browser CacheStorage bucket name for offline digital signature persistence. */
export const DIGITAL_SIGNATURE_CACHE_NAME = 'kea-pdf-digital-signatures-v1';

/** Synthetic CacheStorage request URL used to store the offline JSON snapshot. */
export const DIGITAL_SIGNATURE_CACHE_URL = 'https://kea-pdf.local/__offline_cache__/digital-signatures-v1.json';

const MAX_SAVED_DIGITAL_SIGNATURES = 12;

/**
 * Encodes a Uint8Array byte buffer into a Base64 string.
 *
 * @param bytes Binary byte array to encode.
 * @return Base64-encoded string.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return forge.util.encode64(binary);
}

/**
 * Decodes a Base64 string back into a Uint8Array byte buffer.
 *
 * @param base64 Base64-encoded string.
 * @return Decoded Uint8Array byte buffer.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  if (!base64) {
    return new Uint8Array(0);
  }
  const binary = forge.util.decode64(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Serialises an unlocked DigitalIdentity into a JSON-safe structure for offline storage.
 *
 * @param identity Active cryptographic digital identity.
 * @return Serialised digital identity record.
 */
export function serializeDigitalIdentity(identity: DigitalIdentity): SerializedDigitalIdentity {
  const certificatePem = identity.certificatePem || forge.pki.certificateToPem(identity.certificate);
  const privateKeyPem = forge.pki.privateKeyToPem(identity.privateKey);
  const chainSource =
    identity.certificateChain && identity.certificateChain.length > 0
      ? identity.certificateChain
      : [identity.certificate];
  const certificateChainPems = chainSource.map((cert) => forge.pki.certificateToPem(cert));
  const p12Base64 = uint8ArrayToBase64(identity.p12Bytes);

  return {
    certificatePem,
    privateKeyPem,
    certificateChainPems,
    p12Base64,
    subject: {
      commonName: identity.subject.commonName,
      organization: identity.subject.organization,
      organizationalUnit: identity.subject.organizationalUnit,
      email: identity.subject.email,
      country: identity.subject.country,
    },
    issuer: {
      commonName: identity.issuer.commonName,
      organization: identity.issuer.organization,
    },
    validFromIso: identity.validFrom.toISOString(),
    validToIso: identity.validTo.toISOString(),
    serialNumber: identity.serialNumber,
  };
}

/**
 * Reconstructs a live cryptographic DigitalIdentity from a saved record without requiring a password.
 *
 * @param source Serialised identity or complete SavedDigitalSignature record.
 * @return Reconstructed DigitalIdentity ready for ISO 32000 signing.
 */
export function reconstructDigitalIdentity(
  source: SerializedDigitalIdentity | SavedDigitalSignature
): DigitalIdentity {
  const serialized = 'identity' in source ? source.identity : source;
  const certificate = forge.pki.certificateFromPem(serialized.certificatePem);
  const privateKey = forge.pki.privateKeyFromPem(serialized.privateKeyPem);
  const certificateChain =
    serialized.certificateChainPems && serialized.certificateChainPems.length > 0
      ? serialized.certificateChainPems.map((pem) => forge.pki.certificateFromPem(pem))
      : [certificate];
  const p12Bytes = base64ToUint8Array(serialized.p12Base64);

  return {
    certificate,
    privateKey,
    certificatePem: serialized.certificatePem,
    p12Bytes,
    certificateChain,
    subject: {
      commonName: serialized.subject.commonName,
      organization: serialized.subject.organization,
      organizationalUnit: serialized.subject.organizationalUnit,
      email: serialized.subject.email,
      country: serialized.subject.country,
    },
    issuer: {
      commonName: serialized.issuer.commonName,
      organization: serialized.issuer.organization,
    },
    validFrom: new Date(serialized.validFromIso),
    validTo: new Date(serialized.validToIso),
    serialNumber: serialized.serialNumber,
  };
}

/**
 * Retrieves all saved digital signatures from localStorage.
 *
 * @return Array of saved digital signature records.
 */
export function getSavedDigitalSignatures(): SavedDigitalSignature[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DIGITAL_SIGNATURE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as SavedDigitalSignature[];
    }
    return [];
  } catch (err) {
    console.warn('Failed to read saved digital signatures from localStorage:', err);
    return [];
  }
}

/**
 * Mirrors the saved digital signature collection into browser CacheStorage for offline persistence.
 *
 * @param records Array of saved digital signatures to cache.
 */
export async function syncDigitalSignaturesToOfflineCache(
  records: SavedDigitalSignature[]
): Promise<void> {
  try {
    if (typeof caches === 'undefined' || typeof Response === 'undefined') return;
    const cache = await caches.open(DIGITAL_SIGNATURE_CACHE_NAME);
    const response = new Response(JSON.stringify(records), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
    await cache.put(DIGITAL_SIGNATURE_CACHE_URL, response);
  } catch (err) {
    console.warn('Failed to mirror digital signatures to offline CacheStorage:', err);
  }
}

/**
 * Hydrates saved digital signatures from browser CacheStorage if localStorage is empty.
 *
 * @return Resolved array of saved digital signatures.
 */
export async function hydrateDigitalSignaturesFromOfflineCache(): Promise<SavedDigitalSignature[]> {
  const existing = getSavedDigitalSignatures();
  if (existing.length > 0) {
    return existing;
  }

  try {
    if (typeof caches === 'undefined') return [];
    const cache = await caches.open(DIGITAL_SIGNATURE_CACHE_NAME);
    const match = await cache.match(DIGITAL_SIGNATURE_CACHE_URL);
    if (!match) return [];
    const parsed: unknown = await match.json();
    if (Array.isArray(parsed) && parsed.length > 0) {
      const records = parsed as SavedDigitalSignature[];
      persistDigitalSignaturesToLocalStorage(records);
      return records;
    }
    return [];
  } catch (err) {
    console.warn('Failed to hydrate digital signatures from offline CacheStorage:', err);
    return [];
  }
}

/**
 * Persists saved digital signatures to localStorage with quota eviction protection.
 *
 * @param records Array of saved digital signature records.
 */
function persistDigitalSignaturesToLocalStorage(records: SavedDigitalSignature[]): void {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(DIGITAL_SIGNATURE_STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    // note: evict oldest non-default digital signatures if storage quota is exceeded
    console.warn('LocalStorage quota reached while saving digital signature, evicting older entries:', err);
    const trimmed = records.filter((item, idx) => item.isDefault || idx < 4);
    try {
      localStorage.setItem(DIGITAL_SIGNATURE_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (innerErr) {
      console.error('Failed to persist digital signatures after quota eviction:', innerErr);
    }
  }
}

/**
 * Persists saved digital signatures to both localStorage and offline CacheStorage.
 *
 * @param records Array of saved digital signature records.
 */
function persistDigitalSignatures(records: SavedDigitalSignature[]): void {
  persistDigitalSignaturesToLocalStorage(records);
  void syncDigitalSignaturesToOfflineCache(records);
}

/**
 * Builds a concise human-readable label for a digital identity.
 *
 * @param identity Serialised digital identity.
 * @return Display label string.
 */
function buildDefaultLabel(identity: SerializedDigitalIdentity): string {
  const cn = identity.subject.commonName || 'Digital ID';
  const org = identity.subject.organization?.trim();
  return org ? `${cn} (${org})` : cn;
}

/**
 * Saves or updates a digital signature in offline storage and CacheStorage.
 * Automatically updates matching certificate records in place and enforces collection bounds.
 *
 * @param input Digital identity, signing configuration, and default preference.
 * @return Saved or updated SavedDigitalSignature record.
 */
export function saveDigitalSignature(input: SaveDigitalSignatureInput): SavedDigitalSignature {
  const current = getSavedDigitalSignatures();
  const serializedIdentity = serializeDigitalIdentity(input.identity);
  const now = Date.now();
  const desiredLabel = input.label?.trim() || buildDefaultLabel(serializedIdentity);

  // note: locate existing record by explicit id or matching certificate serial and commonName
  const existingIdx = current.findIndex(
    (item) =>
      (input.id && item.id === input.id) ||
      (item.identity.serialNumber === serializedIdentity.serialNumber &&
        item.identity.subject.commonName === serializedIdentity.subject.commonName)
  );

  const shouldBeDefault = input.isDefault !== undefined ? input.isDefault : true;

  let savedRecord: SavedDigitalSignature;

  if (existingIdx >= 0) {
    const existing = current[existingIdx];
    current.splice(existingIdx, 1);
    savedRecord = {
      ...existing,
      label: desiredLabel,
      identity: serializedIdentity,
      config: { ...input.config },
      updatedAt: now,
      isDefault: shouldBeDefault || existing.isDefault || current.length === 0,
    };
  } else {
    const id = input.id || `dsig_${now}_${Math.random().toString(36).slice(2, 8)}`;
    savedRecord = {
      id,
      label: desiredLabel,
      identity: serializedIdentity,
      config: { ...input.config },
      createdAt: now,
      updatedAt: now,
      isDefault: shouldBeDefault || current.length === 0,
    };
  }

  if (savedRecord.isDefault) {
    for (const item of current) {
      item.isDefault = false;
    }
  } else if (current.length === 0) {
    savedRecord.isDefault = true;
  }

  current.unshift(savedRecord);

  // note: cap collection length by evicting oldest non-default entries
  while (current.length > MAX_SAVED_DIGITAL_SIGNATURES) {
    let removeIdx = -1;
    for (let i = current.length - 1; i >= 0; i--) {
      if (!current[i].isDefault) {
        removeIdx = i;
        break;
      }
    }
    if (removeIdx >= 0) {
      current.splice(removeIdx, 1);
    } else {
      current.pop();
    }
  }

  persistDigitalSignatures(current);
  return savedRecord;
}

/**
 * Deletes a saved digital signature by identifier and reassigns default if needed.
 *
 * @param id Saved digital signature identifier to delete.
 */
export function deleteDigitalSignature(id: string): void {
  const current = getSavedDigitalSignatures().filter((item) => item.id !== id);
  if (current.length > 0 && !current.some((item) => item.isDefault)) {
    current[0].isDefault = true;
  }
  persistDigitalSignatures(current);
}

/**
 * Marks a specific saved digital signature as the default profile.
 *
 * @param id Saved digital signature identifier to set as default.
 */
export function setDefaultDigitalSignature(id: string): void {
  const current = getSavedDigitalSignatures();
  for (const item of current) {
    item.isDefault = item.id === id;
  }
  persistDigitalSignatures(current);
}

/**
 * Returns the default saved digital signature if one exists.
 *
 * @return Default SavedDigitalSignature or null when storage is empty.
 */
export function getDefaultDigitalSignature(): SavedDigitalSignature | null {
  const all = getSavedDigitalSignatures();
  return all.find((item) => item.isDefault) || (all.length > 0 ? all[0] : null);
}
