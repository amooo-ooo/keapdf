import type { PdfiumEngine } from '../../../core/pdfium-engine';

/**
 * Granular document permissions per ISO 32000-1 Table 22 (User access permissions).
 */
export interface PdfPermissionFlags {
  /** Bit 3: Print the document (draft or low resolution). */
  canPrint: boolean;
  /** Bit 4: Modify document contents other than annotations or forms. */
  canModify: boolean;
  /** Bit 5: Copy or extract text and graphics. */
  canCopy: boolean;
  /** Bit 6: Add or modify text annotations, fill interactive form fields. */
  canAnnotate: boolean;
  /** Bit 9: Fill interactive form fields (even if canAnnotate is false). */
  canFillForms: boolean;
  /** Bit 10: Extract text and graphics for accessibility screen readers. */
  canExtractAccessibility: boolean;
  /** Bit 11: Assemble document (insert, rotate, delete pages). */
  canAssemble: boolean;
  /** Bit 12: High-resolution printing. */
  canPrintHighQuality: boolean;
}

/**
 * Options for securing a PDF document with standard encryption.
 */
export interface SecurityOptions {
  /** User password required to decrypt and open the document. */
  userPassword?: string;
  /** Owner password required to modify permissions or decrypt without restrictions. */
  ownerPassword?: string;
  /** Permissions bitmask per ISO 32000-1 Table 22. Defaults to unrestricted (-4). */
  permissions?: number;
}

/**
 * ISO 32000-1 Table 22 default unrestricted permission bitmask (-4 signed, 0xFFFFFFFC).
 * Bits 1 and 2 must be 0; bits 7, 8, and 13 to 32 must be 1.
 */
export const ISO32000_DEFAULT_PERMISSIONS = -4;

/**
 * Bit positions defined in ISO 32000-1 Table 22.
 */
export const DocPermissionBit = {
  Print: 1 << 2, // Bit 3: 4
  Modify: 1 << 3, // Bit 4: 8
  Copy: 1 << 4, // Bit 5: 16
  Annotate: 1 << 5, // Bit 6: 32
  FillForms: 1 << 8, // Bit 9: 256
  ExtractAccessibility: 1 << 9, // Bit 10: 512
  Assemble: 1 << 10, // Bit 11: 1024
  PrintHighQuality: 1 << 11, // Bit 12: 2048
} as const;

/**
 * Decodes a 32-bit permission integer into structured permission flags.
 */
export function decodePermissionBitmask(permissions: number): PdfPermissionFlags {
  return {
    canPrint: Boolean(permissions & DocPermissionBit.Print),
    canModify: Boolean(permissions & DocPermissionBit.Modify),
    canCopy: Boolean(permissions & DocPermissionBit.Copy),
    canAnnotate: Boolean(permissions & DocPermissionBit.Annotate),
    canFillForms: Boolean(permissions & DocPermissionBit.FillForms),
    canExtractAccessibility: Boolean(permissions & DocPermissionBit.ExtractAccessibility),
    canAssemble: Boolean(permissions & DocPermissionBit.Assemble),
    canPrintHighQuality: Boolean(permissions & DocPermissionBit.PrintHighQuality),
  };
}

/**
 * Computes an ISO 32000-1 Table 22 signed 32-bit integer permission mask from flags.
 * Preserves mandatory high-order and reserved bits while clearing restricted bits.
 */
export function computePermissionBitmask(flags: PdfPermissionFlags): number {
  let mask = ISO32000_DEFAULT_PERMISSIONS;

  if (!flags.canPrint) {
    mask &= ~DocPermissionBit.Print;
  }
  if (!flags.canModify) {
    mask &= ~DocPermissionBit.Modify;
  }
  if (!flags.canCopy) {
    mask &= ~DocPermissionBit.Copy;
  }
  if (!flags.canAnnotate) {
    mask &= ~DocPermissionBit.Annotate;
  }
  if (!flags.canFillForms) {
    mask &= ~DocPermissionBit.FillForms;
  }
  if (!flags.canExtractAccessibility) {
    mask &= ~DocPermissionBit.ExtractAccessibility;
  }
  if (!flags.canAssemble) {
    mask &= ~DocPermissionBit.Assemble;
  }
  if (!flags.canPrintHighQuality) {
    mask &= ~DocPermissionBit.PrintHighQuality;
  }

  return mask;
}

/**
 * Checks whether the active document is encrypted.
 */
export function isPdfEncrypted(engine: PdfiumEngine, docHandle: number): boolean {
  if (!docHandle) return false;
  const mod = engine.getModule();
  return mod.EPDF_IsEncrypted(docHandle);
}

/**
 * Checks whether owner permissions are unlocked for the active document.
 */
export function isPdfOwnerUnlocked(engine: PdfiumEngine, docHandle: number): boolean {
  if (!docHandle) return true;
  const mod = engine.getModule();
  if (!mod.EPDF_IsEncrypted(docHandle)) return true;
  return mod.EPDF_IsOwnerUnlocked(docHandle);
}

/**
 * Authenticates with owner password to unlock administrative permissions on an encrypted document.
 */
export function unlockPdfOwnerPermissions(
  engine: PdfiumEngine,
  docHandle: number,
  ownerPassword: string
): boolean {
  if (!docHandle) return false;
  const mod = engine.getModule();
  return mod.EPDF_UnlockOwnerPermissions(docHandle, ownerPassword);
}

/**
 * Applies ISO 32000 standard encryption and permissions to a document.
 */
export function applyPdfSecurity(
  engine: PdfiumEngine,
  docHandle: number,
  options: SecurityOptions
): { success: boolean; isEncrypted: boolean; permissions: number } {
  if (!docHandle) {
    throw new Error('No active document handle to apply security to.');
  }

  const userPassword = options.userPassword ?? '';
  const ownerPassword = options.ownerPassword ?? '';
  const permissions = options.permissions ?? ISO32000_DEFAULT_PERMISSIONS;

  if (!userPassword && !ownerPassword && permissions === ISO32000_DEFAULT_PERMISSIONS) {
    throw new Error('At least a user password, owner password, or restricted permission is required.');
  }

  const mod = engine.getModule();
  const success = mod.EPDF_SetEncryption(docHandle, userPassword, ownerPassword, permissions);

  if (!success) {
    throw new Error('Failed to set PDF document encryption and security handler.');
  }

  return {
    success: true,
    isEncrypted: true,
    permissions,
  };
}

/**
 * Removes encryption and security restrictions from an active document.
 * Requires owner privileges if an owner password was previously configured.
 */
export function removePdfSecurity(
  engine: PdfiumEngine,
  docHandle: number,
  ownerPassword?: string
): { success: boolean } {
  if (!docHandle) {
    throw new Error('No active document handle to remove security from.');
  }

  const mod = engine.getModule();
  if (!mod.EPDF_IsEncrypted(docHandle)) {
    return { success: true };
  }

  if (!mod.EPDF_IsOwnerUnlocked(docHandle)) {
    if (!ownerPassword) {
      throw new Error('Owner password is required to remove document security.');
    }
    const unlocked = mod.EPDF_UnlockOwnerPermissions(docHandle, ownerPassword);
    if (!unlocked) {
      throw new Error('Incorrect owner password provided.');
    }
  }

  const success = mod.EPDF_RemoveEncryption(docHandle);
  if (!success) {
    throw new Error('Failed to remove document encryption.');
  }

  return { success: true };
}
