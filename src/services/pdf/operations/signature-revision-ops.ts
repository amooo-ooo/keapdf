import forge from 'node-forge';
import {
  PDFArray,
  PDFCrossRefStream,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  rgb,
  type PDFContext,
  type PDFImage,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import type {
  DocMdpPermissionLevel,
  SignPdfOptions,
  VisualSignatureOptions,
} from './signature-ops';
import {
  decryptPdfDocument,
  encryptPdfObject,
  matchesPdfEncryption,
  saveEncryptedPdfDocument,
  type PdfEncryptionContext,
} from '../encryption/pdf-lib-encryption';

/**
 * Signature revision builders for ISO 32000-1 Clause 12.8 digital signatures.
 *
 * The first signature on a document is written through a full pdf-lib serialisation,
 * which is safe because no earlier byte ranges exist. Every subsequent signature is
 * written as a true incremental update (ISO 32000-1 Clause 7.5.6): the original bytes
 * are preserved verbatim and only new or modified objects are appended, followed by a
 * cross-reference section chained to the previous one through /Prev. This keeps every
 * earlier /ByteRange digest intact so prior signatures continue to verify.
 */

/** Byte capacity allocated for the detached signature placeholder (chains, CAdES, and timestamps). */
export const SIGNATURE_PLACEHOLDER_LENGTH = 16384; // 16384 bytes = 32768 hex characters

/** Sentinel /ByteRange written before the real offsets are known. */
const BYTE_RANGE_SENTINEL = 1000000000;

/** Signature appearance text colour (matches the on-page stamp of the first revision). */
const SIGNATURE_TEXT_RGB: readonly [number, number, number] = [0.1, 0.12, 0.16];

/** Number of trailing bytes scanned when locating the final startxref keyword. */
const STARTXREF_TAIL_SCAN_BYTES = 4096;

/** PDF rectangle expressed as [llx, lly, urx, ury]. */
type PdfRect = [number, number, number, number];

/** Shared inputs for both signature revision builders. */
export interface SignatureRevisionParams {
  /** Signing configuration supplied by the caller. */
  options: SignPdfOptions;
  /** Resolved /SubFilter value. */
  subFilter: string;
  /** Signing time formatted as a PDF date string. */
  pdfDateStr: string;
  /**
   * Security handler of an encrypted source document. Initial revisions then expect
   * plaintext input and re-encrypt the output; incremental revisions expect the original
   * encrypted bytes and encrypt every appended object.
   */
  encryption?: PdfEncryptionContext;
}

/** Placement of the visual signature graphic and signer name relative to the box origin. */
interface VisualSignatureLayout {
  /** Box for the handwritten graphic, or null when no graphic is rendered. */
  graphic: { x: number; y: number; width: number; height: number } | null;
  /** Baseline placement for the signer name, or null when the name is omitted. */
  name: { y: number; fontSize: number; maxWidth: number } | null;
}

/**
 * Detects whether a PDF already contains at least one populated digital signature by
 * scanning for /ByteRange arrays that hold real offsets rather than placeholder sentinels.
 *
 * @param pdfBytes Raw binary bytes of the PDF document.
 * @return True if at least one populated signature exists.
 */
export function hasPopulatedSignatures(pdfBytes: Uint8Array): boolean {
  const pdfStr = toBinaryString(pdfBytes);
  const byteRangeRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  for (const match of pdfStr.matchAll(byteRangeRegex)) {
    const l1 = parseInt(match[2], 10);
    const b2 = parseInt(match[3], 10);
    const l2 = parseInt(match[4], 10);
    const isPlaceholder =
      l1 === BYTE_RANGE_SENTINEL && b2 === BYTE_RANGE_SENTINEL && l2 === BYTE_RANGE_SENTINEL;
    if (!isPlaceholder) {
      return true;
    }
  }
  return false;
}

/**
 * Builds the first signature revision through a full pdf-lib serialisation. The returned
 * bytes contain /ByteRange and /Contents placeholders ready for digest injection.
 *
 * @param pdfBytes Unsigned PDF bytes.
 * @param params Signing options, subfilter, and formatted signing date.
 * @return Serialised PDF bytes containing the signature placeholders.
 */
export async function buildInitialSignatureRevision(
  pdfBytes: Uint8Array,
  params: SignatureRevisionParams
): Promise<Uint8Array> {
  const { options } = params;
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const { context } = pdfDoc;

  const acroForm = resolveAcroForm(pdfDoc, null);
  const certificationLevel = isDocMdpPermissionLevel(options.certificationLevel)
    ? options.certificationLevel
    : undefined;
  const signatureRef = context.register(
    createSignatureDictionary(context, params, certificationLevel)
  );
  if (certificationLevel !== undefined) {
    setDocMdpPermission(pdfDoc, signatureRef);
  }

  const targetPageIdx = options.visual
    ? options.visual.pageIndex
    : clampPageIndex(options.pageIndex ?? 0, pdfDoc.getPageCount());
  const page = pdfDoc.getPage(targetPageIdx);

  const widgetRef = context.register(
    createSignatureWidget(context, {
      rect: options.rect ? normaliseRect(options.rect) : [0, 0, 0, 0],
      pageRef: page.ref,
      signatureRef,
      appearanceRef: null,
    })
  );

  // The first revision stamps the visual appearance directly onto the page content,
  // which is safe because no earlier signed byte ranges exist yet.
  if (isRenderableVisual(options.visual)) {
    await drawVisualSignatureOnPage(pdfDoc, page, options.visual, resolveSignerDisplayName(options));
  }

  appendRefToArrayEntry(context, acroForm, PDFName.of('Fields'), widgetRef, null);
  appendRefToArrayEntry(context, page.node, PDFName.of('Annots'), widgetRef, null);

  if (options.embedDss) {
    mergeDssCertificates(pdfDoc, resolveCertificateChain(options));
  }

  if (params.encryption) {
    return saveEncryptedPdfDocument(pdfDoc, params.encryption);
  }
  return pdfDoc.save({ useObjectStreams: false });
}

/**
 * Builds a subsequent signature revision as a true ISO 32000-1 incremental update. The
 * original bytes are copied verbatim and only new or modified objects are appended, so
 * every earlier signature digest remains valid. The visual appearance is carried by the
 * widget /AP stream rather than the page content, which must not be rewritten.
 *
 * @param pdfBytes PDF bytes that already contain populated signatures.
 * @param params Signing options, subfilter, and formatted signing date.
 * @return The original bytes followed by the appended revision with signature placeholders.
 */
export async function buildIncrementalSignatureRevision(
  pdfBytes: Uint8Array,
  params: SignatureRevisionParams
): Promise<Uint8Array> {
  const { options } = params;
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const { context } = pdfDoc;

  if (params.encryption) {
    if (!matchesPdfEncryption(pdfDoc, params.encryption)) {
      throw new Error(
        'Cannot append an encrypted signature revision because the document security handler does not match the active encryption key.'
      );
    }
    // note: work on plaintext objects so re-emitted strings are not encrypted twice
    decryptPdfDocument(pdfDoc, params.encryption);
  }

  const rootRef = context.trailerInfo.Root;
  if (!(rootRef instanceof PDFRef)) {
    throw new Error(
      'Cannot append an incremental signature revision because the trailer /Root entry is not an indirect reference.'
    );
  }

  if (readCertificationPermissionLevel(pdfDoc) === 1) {
    throw new Error(
      'This document is certified with DocMDP permission level 1, which forbids any further changes. Adding another signature would invalidate the existing certification.'
    );
  }

  if (options.certificationLevel !== undefined) {
    console.warn(
      'Ignoring certificationLevel: ISO 32000-1 Clause 12.8.2.2 only permits a certification signature as the first signature in a document.'
    );
  }

  // pdf-lib discards object stream and cross-reference stream containers while parsing, so
  // its largestObjectNumber can under-count. Reserve numbers above every declared object.
  context.largestObjectNumber = Math.max(context.largestObjectNumber, readHighestDeclaredObjectNumber(pdfBytes));
  const firstNewObjectNumber = context.largestObjectNumber + 1;
  const modifiedObjectNumbers = new Set<number>([rootRef.objectNumber]);

  const signatureRef = context.register(createSignatureDictionary(context, params, undefined));

  const page = pdfDoc.getPage(
    clampPageIndex(options.visual ? options.visual.pageIndex : options.pageIndex ?? 0, pdfDoc.getPageCount())
  );
  modifiedObjectNumbers.add(page.ref.objectNumber);

  const visual = isRenderableVisual(options.visual) ? options.visual : null;
  const appearanceRef = visual
    ? await buildSignatureAppearanceStream(pdfDoc, visual, resolveSignerDisplayName(options))
    : null;

  let rect: PdfRect = [0, 0, 0, 0];
  if (options.rect) {
    rect = normaliseRect(options.rect);
  } else if (visual) {
    rect = normaliseRect(visual);
  }

  const widgetRef = context.register(
    createSignatureWidget(context, { rect, pageRef: page.ref, signatureRef, appearanceRef })
  );

  const acroForm = resolveAcroForm(pdfDoc, modifiedObjectNumbers);
  appendRefToArrayEntry(context, acroForm, PDFName.of('Fields'), widgetRef, modifiedObjectNumbers);
  appendRefToArrayEntry(context, page.node, PDFName.of('Annots'), widgetRef, modifiedObjectNumbers);

  if (options.embedDss) {
    mergeDssCertificates(pdfDoc, resolveCertificateChain(options));
  }

  // Materialise lazily embedded fonts and images so they are registered as new objects.
  await pdfDoc.flush();

  return serialiseIncrementalUpdate(
    pdfBytes,
    context,
    rootRef,
    firstNewObjectNumber,
    modifiedObjectNumbers,
    params.encryption
  );
}

/**
 * Creates the /Sig dictionary with /ByteRange and /Contents placeholders and optional
 * DocMDP /Reference transform.
 *
 * @param context The pdf-lib object context.
 * @param params Signing options, subfilter, and formatted signing date.
 * @param certificationLevel DocMDP permission level, or undefined for approval signatures.
 * @return The unregistered signature dictionary.
 */
function createSignatureDictionary(
  context: PDFContext,
  params: SignatureRevisionParams,
  certificationLevel: DocMdpPermissionLevel | undefined
): PDFDict {
  const { options, subFilter, pdfDateStr } = params;

  const byteRangePlaceholder = PDFArray.withContext(context);
  byteRangePlaceholder.push(PDFNumber.of(0));
  byteRangePlaceholder.push(PDFNumber.of(BYTE_RANGE_SENTINEL));
  byteRangePlaceholder.push(PDFNumber.of(BYTE_RANGE_SENTINEL));
  byteRangePlaceholder.push(PDFNumber.of(BYTE_RANGE_SENTINEL));

  const sigDict = context.obj({
    Type: PDFName.of('Sig'),
    Filter: PDFName.of('Adobe.PPKLite'),
    SubFilter: PDFName.of(subFilter),
    ByteRange: byteRangePlaceholder,
    Contents: PDFHexString.of('0'.repeat(SIGNATURE_PLACEHOLDER_LENGTH * 2)),
    Reason: PDFString.of(options.reason || 'Document Digitally Signed and Verified'),
    M: PDFString.of(pdfDateStr),
    Name: PDFString.of(options.signerName || options.identity.subject.commonName),
    ...(options.location ? { Location: PDFString.of(options.location) } : {}),
    ...(options.contactInfo ? { ContactInfo: PDFString.of(options.contactInfo) } : {}),
  });

  if (certificationLevel !== undefined) {
    const transformParams = context.obj({
      Type: PDFName.of('TransformParams'),
      P: PDFNumber.of(certificationLevel),
      V: PDFName.of('1.2'),
    });
    const sigRefDict = context.obj({
      Type: PDFName.of('SigRef'),
      TransformMethod: PDFName.of('DocMDP'),
      TransformParams: transformParams,
    });
    sigDict.set(PDFName.of('Reference'), context.obj([sigRefDict]));
  }

  return sigDict;
}

/**
 * Creates the signature field widget annotation linking the page and signature value.
 *
 * @param context The pdf-lib object context.
 * @param params Widget rectangle, owning page, signature value, and optional appearance.
 * @return The unregistered widget dictionary.
 */
function createSignatureWidget(
  context: PDFContext,
  params: { rect: PdfRect; pageRef: PDFRef; signatureRef: PDFRef; appearanceRef: PDFRef | null }
): PDFDict {
  const widget = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    Rect: params.rect,
    T: PDFString.of(`Signature_${Date.now()}`),
    F: 132, // Print | Lock
    P: params.pageRef,
    V: params.signatureRef,
  });
  if (params.appearanceRef) {
    widget.set(PDFName.of('AP'), context.obj({ N: params.appearanceRef }));
  }
  return widget;
}

/**
 * Resolves the catalog /AcroForm dictionary, creating it when absent, and enforces
 * /SigFlags 3 (SignaturesExist | AppendOnly).
 *
 * @param pdfDoc The pdf-lib document.
 * @param modifiedObjectNumbers Tracks indirect objects that must be re-emitted, or null for full saves.
 * @return The AcroForm dictionary.
 */
function resolveAcroForm(pdfDoc: PDFDocument, modifiedObjectNumbers: Set<number> | null): PDFDict {
  const { context, catalog } = pdfDoc;
  const entry = catalog.get(PDFName.of('AcroForm'));
  const resolved = entry instanceof PDFRef ? context.lookup(entry) : entry;

  let acroForm: PDFDict;
  if (resolved instanceof PDFDict) {
    acroForm = resolved;
    if (entry instanceof PDFRef) {
      modifiedObjectNumbers?.add(entry.objectNumber);
    }
  } else {
    acroForm = context.obj({ Fields: [], SigFlags: 3 });
    catalog.set(PDFName.of('AcroForm'), context.register(acroForm));
  }

  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  return acroForm;
}

/**
 * Appends an indirect reference to an array-valued dictionary entry, following indirect
 * arrays and creating the array when absent.
 *
 * @param context The pdf-lib object context.
 * @param dict Dictionary owning the array entry.
 * @param key Entry name (for example /Fields or /Annots).
 * @param ref Reference to append.
 * @param modifiedObjectNumbers Tracks indirect objects that must be re-emitted, or null for full saves.
 */
function appendRefToArrayEntry(
  context: PDFContext,
  dict: PDFDict,
  key: PDFName,
  ref: PDFRef,
  modifiedObjectNumbers: Set<number> | null
): void {
  const entry = dict.get(key);
  if (entry instanceof PDFRef) {
    const resolved = context.lookup(entry);
    if (resolved instanceof PDFArray) {
      resolved.push(ref);
      modifiedObjectNumbers?.add(entry.objectNumber);
      return;
    }
  } else if (entry instanceof PDFArray) {
    entry.push(ref);
    return;
  }
  dict.set(key, context.obj([ref]));
}

/**
 * Registers the signature as the catalog /Perms /DocMDP certification entry.
 *
 * @param pdfDoc The pdf-lib document.
 * @param signatureRef Reference to the certification signature dictionary.
 */
function setDocMdpPermission(pdfDoc: PDFDocument, signatureRef: PDFRef): void {
  const existingPerms = pdfDoc.catalog.lookup(PDFName.of('Perms'));
  if (existingPerms instanceof PDFDict) {
    existingPerms.set(PDFName.of('DocMDP'), signatureRef);
  } else {
    pdfDoc.catalog.set(PDFName.of('Perms'), pdfDoc.context.obj({ DocMDP: signatureRef }));
  }
}

/**
 * Reads the DocMDP permission level of an existing certification signature.
 *
 * @param pdfDoc The pdf-lib document.
 * @return The permission level, or undefined when the document is not certified.
 */
function readCertificationPermissionLevel(pdfDoc: PDFDocument): DocMdpPermissionLevel | undefined {
  const perms = pdfDoc.catalog.lookup(PDFName.of('Perms'));
  if (!(perms instanceof PDFDict)) return undefined;
  const docMdpSig = perms.lookup(PDFName.of('DocMDP'));
  if (!(docMdpSig instanceof PDFDict)) return undefined;

  const references = docMdpSig.lookup(PDFName.of('Reference'));
  if (references instanceof PDFArray) {
    for (let i = 0; i < references.size(); i++) {
      const sigRef = references.lookup(i);
      if (!(sigRef instanceof PDFDict)) continue;
      if (sigRef.lookup(PDFName.of('TransformMethod')) !== PDFName.of('DocMDP')) continue;
      const transformParams = sigRef.lookup(PDFName.of('TransformParams'));
      const level = transformParams instanceof PDFDict
        ? transformParams.lookup(PDFName.of('P'))
        : undefined;
      const numericLevel = level instanceof PDFNumber ? level.asNumber() : 2;
      return isDocMdpPermissionLevel(numericLevel) ? numericLevel : 2;
    }
  }

  // ISO 32000-1 Table 254: /P defaults to 2 when absent.
  return 2;
}

/**
 * Merges the signer certificate chain into the document /DSS dictionary, preserving any
 * existing /Certs, /OCSPs, /CRLs, and /VRI entries and deduplicating certificates by
 * SHA-256 fingerprint so that sequential signing operations accumulate every chain.
 *
 * @param pdfDoc The pdf-lib document whose catalog receives the merged /DSS.
 * @param certChain Certificates to add to the /DSS /Certs array.
 */
function mergeDssCertificates(pdfDoc: PDFDocument, certChain: forge.pki.Certificate[]): void {
  const { context, catalog } = pdfDoc;
  const existingDss = catalog.lookup(PDFName.of('DSS'));
  const dssDict = existingDss instanceof PDFDict
    ? existingDss.clone(context)
    : context.obj({ Type: PDFName.of('DSS') });

  const certEntries: PDFObject[] = [];
  const knownFingerprints = new Set<string>();

  const existingCerts = dssDict.lookup(PDFName.of('Certs'));
  if (existingCerts instanceof PDFArray) {
    for (let i = 0; i < existingCerts.size(); i++) {
      const resolved = existingCerts.lookup(i);
      if (resolved instanceof PDFRawStream) {
        knownFingerprints.add(sha256Hex(toBinaryString(resolved.contents)));
      }
      certEntries.push(existingCerts.get(i));
    }
  }

  for (const cert of certChain) {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const fingerprint = sha256Hex(der);
    if (knownFingerprints.has(fingerprint)) continue;
    knownFingerprints.add(fingerprint);
    certEntries.push(context.register(context.stream(fromBinaryString(der))));
  }

  dssDict.set(PDFName.of('Certs'), context.obj(certEntries));
  catalog.set(PDFName.of('DSS'), context.register(dssDict));
}

