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

/**
 * Computes the visual signature layout shared by the page stamp and widget appearance.
 *
 * @param visual Visual signature placement options.
 * @param signerName Trimmed signer display name.
 * @param graphicSize Intrinsic size of the embedded graphic, or null when absent.
 * @return Graphic box and name placement relative to the box origin.
 */
function layoutVisualSignature(
  visual: VisualSignatureOptions,
  signerName: string,
  graphicSize: { width: number; height: number } | null
): VisualSignatureLayout {
  const { width: boxWidth, height: boxHeight } = visual;
  const showFullName = Boolean(visual.showTextDetails && signerName.length > 0);
  const isComposite = Boolean(visual.isCompositeAppearance);
  const fontSize = Math.max(8, Math.min(11, Math.round(boxHeight * 0.18 * 10) / 10));
  const nameAreaHeight = showFullName && !isComposite ? fontSize + 6 : 0;

  let graphic: VisualSignatureLayout['graphic'] = null;
  if (graphicSize) {
    const availW = Math.max(10, boxWidth - 8);
    const availH = Math.max(10, boxHeight - nameAreaHeight - 4);
    const aspect = graphicSize.height > 0 ? graphicSize.width / graphicSize.height : 3;
    let width = availW;
    let height = width / aspect;
    if (height > availH) {
      height = availH;
      width = height * aspect;
    }
    graphic = {
      x: (boxWidth - width) / 2,
      y: nameAreaHeight + (availH - height) / 2,
      width,
      height,
    };
  }

  const renderName = (showFullName && !isComposite) || (!graphic && signerName.length > 0);
  const name = renderName
    ? { y: graphic ? 3 : (boxHeight - fontSize) / 2, fontSize, maxWidth: Math.max(10, boxWidth - 6) }
    : null;

  return { graphic, name };
}

/**
 * Stamps the visual signature directly onto the page content (first revision only).
 *
 * @param pdfDoc The pdf-lib document.
 * @param page Target page.
 * @param visual Visual signature placement options.
 * @param signerName Trimmed signer display name.
 */
async function drawVisualSignatureOnPage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  visual: VisualSignatureOptions,
  signerName: string
): Promise<void> {
  const graphic = await embedSignatureGraphic(pdfDoc, visual.graphicDataUrl);
  const layout = layoutVisualSignature(visual, signerName, graphic);

  if (graphic && layout.graphic) {
    page.drawImage(graphic, {
      x: visual.x + layout.graphic.x,
      y: visual.y + layout.graphic.y,
      width: layout.graphic.width,
      height: layout.graphic.height,
    });
  }

  if (layout.name) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const textWidth = font.widthOfTextAtSize(signerName, layout.name.fontSize);
    page.drawText(signerName, {
      x: visual.x + centreTextOffset(visual.width, textWidth, layout.name.maxWidth),
      y: visual.y + layout.name.y,
      size: layout.name.fontSize,
      font,
      color: rgb(...SIGNATURE_TEXT_RGB),
      maxWidth: layout.name.maxWidth,
    });
  }
}

/**
 * Builds a Form XObject carrying the visual signature for the widget /AP /N entry, so
 * that incremental revisions render a visible signature without touching page content.
 *
 * @param pdfDoc The pdf-lib document.
 * @param visual Visual signature placement options.
 * @param signerName Trimmed signer display name.
 * @return Reference to the registered appearance stream, or null when nothing is drawn.
 */
async function buildSignatureAppearanceStream(
  pdfDoc: PDFDocument,
  visual: VisualSignatureOptions,
  signerName: string
): Promise<PDFRef | null> {
  const { context } = pdfDoc;
  const graphic = await embedSignatureGraphic(pdfDoc, visual.graphicDataUrl);
  const layout = layoutVisualSignature(visual, signerName, graphic);

  const operators: string[] = [];
  const resources = context.obj({});

  if (graphic && layout.graphic) {
    const box = layout.graphic;
    operators.push(
      'q',
      `${formatPdfNumber(box.width)} 0 0 ${formatPdfNumber(box.height)} ${formatPdfNumber(box.x)} ${formatPdfNumber(box.y)} cm`,
      '/SigGraphic Do',
      'Q'
    );
    resources.set(PDFName.of('XObject'), context.obj({ SigGraphic: graphic.ref }));
  }

  if (layout.name) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const naturalWidth = font.widthOfTextAtSize(signerName, layout.name.fontSize);
    // Shrink to fit instead of wrapping, since the appearance box is a fixed BBox.
    const fontSize = naturalWidth > layout.name.maxWidth
      ? (layout.name.fontSize * layout.name.maxWidth) / naturalWidth
      : layout.name.fontSize;
    const fittedWidth = font.widthOfTextAtSize(signerName, fontSize);
    const [r, g, b] = SIGNATURE_TEXT_RGB;
    operators.push(
      'BT',
      `${r} ${g} ${b} rg`,
      `/SigFont ${formatPdfNumber(fontSize)} Tf`,
      `${formatPdfNumber(centreTextOffset(visual.width, fittedWidth, layout.name.maxWidth))} ${formatPdfNumber(layout.name.y)} Td`,
      `${font.encodeText(signerName).toString()} Tj`,
      'ET'
    );
    resources.set(PDFName.of('Font'), context.obj({ SigFont: font.ref }));
  }

  if (operators.length === 0) {
    return null;
  }

  const appearance = context.stream(operators.join('\n'), {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, visual.width, visual.height],
    Resources: resources,
  });
  return context.register(appearance);
}

/**
 * Embeds a PNG data URL signature graphic, logging and returning null on failure.
 *
 * @param pdfDoc The pdf-lib document.
 * @param graphicDataUrl Optional PNG data URL.
 * @return The embedded image, or null when absent or invalid.
 */
async function embedSignatureGraphic(
  pdfDoc: PDFDocument,
  graphicDataUrl: string | undefined
): Promise<PDFImage | null> {
  const prefix = 'data:image/png;base64,';
  if (!graphicDataUrl || !graphicDataUrl.startsWith(prefix)) {
    return null;
  }
  try {
    const imgBytes = Uint8Array.from(atob(graphicDataUrl.slice(prefix.length)), (c) => c.charCodeAt(0));
    return await pdfDoc.embedPng(imgBytes);
  } catch (err) {
    console.warn('Failed to embed visual signature graphic:', err);
    return null;
  }
}

/**
 * Serialises new and modified objects after the original bytes, followed by a cross-reference
 * section chained through /Prev. A cross-reference stream is emitted when the previous section
 * is itself a stream, otherwise a classic xref table is written (ISO 32000-1 Clause 7.5.8.4).
 *
 * @param originalBytes Original PDF bytes, copied verbatim.
 * @param context The pdf-lib object context containing all objects.
 * @param rootRef Catalog reference for the new trailer.
 * @param firstNewObjectNumber Objects at or above this number were created in this revision.
 * @param modifiedObjectNumbers Existing objects mutated in this revision.
 * @param encryption Security handler applied to appended objects of encrypted documents.
 * @return The complete PDF bytes including the incremental update.
 */
function serialiseIncrementalUpdate(
  originalBytes: Uint8Array,
  context: PDFContext,
  rootRef: PDFRef,
  firstNewObjectNumber: number,
  modifiedObjectNumbers: Set<number>,
  encryption?: PdfEncryptionContext
): Uint8Array {
  const prevXrefOffset = readLastStartxrefOffset(originalBytes);
  const previousIsXrefStream = !bytesStartWithToken(originalBytes, prevXrefOffset, 'xref');

  const objects = context
    .enumerateIndirectObjects()
    .filter(([ref]) => ref.objectNumber >= firstNewObjectNumber || modifiedObjectNumbers.has(ref.objectNumber))
    .sort(([a], [b]) => a.objectNumber - b.objectNumber);

  const chunks: Uint8Array[] = [];
  let offset = originalBytes.length;
  const write = (chunk: Uint8Array): void => {
    chunks.push(chunk);
    offset += chunk.length;
  };
  const writeIndirectObject = (ref: PDFRef, object: PDFObject): void => {
    write(fromBinaryString(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    write(serialisePdfObject(object));
    write(fromBinaryString('\nendobj\n'));
  };

  // Guarantee the revision starts on a fresh line even if the original lacks a trailing EOL.
  write(fromBinaryString('\n'));

  const xrefEntries: Array<{ ref: PDFRef; offset: number }> = [];
  for (const [ref, object] of objects) {
    xrefEntries.push({ ref, offset });
    writeIndirectObject(ref, encryption ? encryptPdfObject(object, ref, encryption, context) : object);
  }

  const trailerEntries: Record<string, PDFObject> = {
    Root: rootRef,
    Prev: PDFNumber.of(prevXrefOffset),
  };
  const { Info, ID, Encrypt } = context.trailerInfo;
  if (Info) trailerEntries.Info = Info;
  if (ID) trailerEntries.ID = ID;
  if (Encrypt) trailerEntries.Encrypt = Encrypt;

  const xrefOffset = offset;
  if (previousIsXrefStream) {
    const xrefRef = context.nextRef();
    const xrefStream = PDFCrossRefStream.create(
      context.obj({ ...trailerEntries, Type: PDFName.of('XRef'), Size: PDFNumber.of(xrefRef.objectNumber + 1) })
    );
    xrefEntries.push({ ref: xrefRef, offset: xrefOffset });
    for (const entry of xrefEntries) {
      xrefStream.addUncompressedEntry(entry.ref, entry.offset);
    }
    writeIndirectObject(xrefRef, xrefStream);
  } else {
    const trailerDict = context.obj({ ...trailerEntries, Size: PDFNumber.of(context.largestObjectNumber + 1) });
    write(fromBinaryString(`${buildXrefTable(xrefEntries)}trailer\n${trailerDict.toString()}\n`));
  }

  write(fromBinaryString(`startxref\n${xrefOffset}\n%%EOF\n`));

  const result = new Uint8Array(offset);
  result.set(originalBytes, 0);
  let cursor = originalBytes.length;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

/**
 * Builds a classic cross-reference table grouped into contiguous subsections.
 *
 * @param entries Object references and byte offsets, in ascending object number order.
 * @return The xref table text including the leading keyword.
 */
function buildXrefTable(entries: Array<{ ref: PDFRef; offset: number }>): string {
  let table = 'xref\n';
  let start = 0;
  while (start < entries.length) {
    let end = start;
    while (
      end + 1 < entries.length &&
      entries[end + 1].ref.objectNumber === entries[end].ref.objectNumber + 1
    ) {
      end++;
    }
    table += `${entries[start].ref.objectNumber} ${end - start + 1}\n`;
    for (let i = start; i <= end; i++) {
      const { ref, offset } = entries[i];
      // Each entry is exactly 20 bytes including the two-character end-of-line marker.
      table += `${String(offset).padStart(10, '0')} ${String(ref.generationNumber).padStart(5, '0')} n \n`;
    }
    start = end + 1;
  }
  return table;
}

/**
 * Reads the byte offset recorded by the final startxref keyword.
 *
 * @param pdfBytes Raw PDF bytes.
 * @return The previous cross-reference section offset.
 */
function readLastStartxrefOffset(pdfBytes: Uint8Array): number {
  const tail = toBinaryString(pdfBytes.subarray(Math.max(0, pdfBytes.length - STARTXREF_TAIL_SCAN_BYTES)));
  const matches = [...tail.matchAll(/startxref\s+(\d+)/g)];
  if (matches.length === 0) {
    throw new Error('Cannot append an incremental signature revision because the document has no startxref entry.');
  }
  return parseInt(matches[matches.length - 1][1], 10);
}

/**
 * Finds the highest object number declared anywhere in the file, combining indirect object
 * headers with every trailer or cross-reference stream /Size entry (which covers objects
 * stored inside object streams).
 *
 * @param pdfBytes Raw PDF bytes.
 * @return The highest declared object number, or 0 when none is found.
 */
function readHighestDeclaredObjectNumber(pdfBytes: Uint8Array): number {
  const pdfStr = toBinaryString(pdfBytes);
  let highest = 0;
  for (const match of pdfStr.matchAll(/(?:^|[^\d])(\d+)\s+\d+\s+obj\b/g)) {
    highest = Math.max(highest, parseInt(match[1], 10));
  }
  for (const match of pdfStr.matchAll(/\/Size\s+(\d+)/g)) {
    highest = Math.max(highest, parseInt(match[1], 10) - 1);
  }
  return highest;
}

/**
 * Checks whether the bytes at an offset begin with an ASCII token, skipping PDF whitespace.
 *
 * @param bytes Raw bytes.
 * @param offset Start offset.
 * @param token ASCII token to match.
 * @return True when the token is present.
 */
function bytesStartWithToken(bytes: Uint8Array, offset: number, token: string): boolean {
  let cursor = offset;
  while (cursor < bytes.length && isPdfWhitespace(bytes[cursor])) {
    cursor++;
  }
  if (cursor + token.length > bytes.length) return false;
  for (let i = 0; i < token.length; i++) {
    if (bytes[cursor + i] !== token.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Tests whether a byte is a PDF whitespace character (ISO 32000-1 Table 1).
 *
 * @param byte Byte value.
 * @return True for NUL, TAB, LF, FF, CR, and SPACE.
 */
function isPdfWhitespace(byte: number): boolean {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;
}

/**
 * Serialises a pdf-lib object to its exact byte representation.
 *
 * @param object The object to serialise.
 * @return The serialised bytes.
 */
function serialisePdfObject(object: PDFObject): Uint8Array {
  const bytes = new Uint8Array(object.sizeInBytes());
  object.copyBytesInto(bytes, 0);
  return bytes;
}

/**
 * Resolves the signer certificate chain, falling back to the leaf certificate.
 *
 * @param options Signing options.
 * @return The certificate chain.
 */
function resolveCertificateChain(options: SignPdfOptions): forge.pki.Certificate[] {
  return options.identity.certificateChain || [options.identity.certificate];
}

/**
 * Resolves the trimmed signer name rendered in visual appearances.
 *
 * @param options Signing options.
 * @return The display name, possibly empty.
 */
function resolveSignerDisplayName(options: SignPdfOptions): string {
  return (options.signerName || options.identity.subject.commonName || '').trim();
}

/**
 * Narrows a visual configuration to one large enough to render.
 *
 * @param visual Optional visual options.
 * @return True when the box exceeds the minimum renderable size.
 */
function isRenderableVisual(visual: VisualSignatureOptions | undefined): visual is VisualSignatureOptions {
  return Boolean(visual && visual.width > 10 && visual.height > 10);
}

/**
 * Narrows an arbitrary value to a DocMDP permission level.
 *
 * @param value Candidate value.
 * @return True for 1, 2, or 3.
 */
function isDocMdpPermissionLevel(value: unknown): value is DocMdpPermissionLevel {
  return value === 1 || value === 2 || value === 3;
}

/**
 * Normalises a possibly negative-sized rectangle into PDF [llx, lly, urx, ury] form.
 *
 * @param rect Rectangle in PDF points.
 * @return The normalised rectangle.
 */
function normaliseRect(rect: { x: number; y: number; width: number; height: number }): PdfRect {
  return [
    Math.min(rect.x, rect.x + rect.width),
    Math.min(rect.y, rect.y + rect.height),
    Math.max(rect.x, rect.x + rect.width),
    Math.max(rect.y, rect.y + rect.height),
  ];
}

/**
 * Clamps a page index into the valid range for a document.
 *
 * @param pageIndex Requested zero-based index.
 * @param pageCount Total page count.
 * @return The clamped index.
 */
function clampPageIndex(pageIndex: number, pageCount: number): number {
  return Math.max(0, Math.min(pageIndex, pageCount - 1));
}

/**
 * Computes the horizontal offset that centres text within a box, with a 3pt minimum inset.
 *
 * @param boxWidth Box width in points.
 * @param textWidth Measured text width in points.
 * @param maxWidth Maximum permitted text width in points.
 * @return Left offset relative to the box origin.
 */
function centreTextOffset(boxWidth: number, textWidth: number, maxWidth: number): number {
  return Math.max(3, (boxWidth - Math.min(maxWidth, textWidth)) / 2);
}

/**
 * Formats a number for PDF content streams without exponent notation.
 *
 * @param value Numeric value.
 * @return The formatted number.
 */
function formatPdfNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Computes a lowercase hex SHA-256 fingerprint of a binary string.
 *
 * @param binary Binary string (one byte per character).
 * @return The hex digest.
 */
function sha256Hex(binary: string): string {
  const md = forge.md.sha256.create();
  md.update(binary);
  return md.digest().toHex();
}

/**
 * Converts bytes to a binary string (one byte per character).
 *
 * @param bytes Raw bytes.
 * @return The binary string.
 */
function toBinaryString(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return result;
}

/**
 * Converts a binary string (one byte per character) to bytes.
 *
 * @param binary Binary string.
 * @return The raw bytes.
 */
function fromBinaryString(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}
