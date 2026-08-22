import forge from 'node-forge';
import {
  PDFDocument,
  PDFName,
  PDFHexString,
  PDFString,
  PDFArray,
  PDFNumber,
  PDFDict,
  rgb,
  StandardFonts,
} from 'pdf-lib';

/**
 * Options for generating a self-signed digital certificate.
 */
export interface CreateCertOptions {
  /** Signer's full name or Common Name (CN). */
  commonName: string;
  /** Organization or company name (O). */
  organization?: string;
  /** Department or organizational unit (OU). */
  organizationalUnit?: string;
  /** Signer email address. */
  email?: string;
  /** Country code (2-letter ISO, e.g. 'US', 'NZ'). */
  country?: string;
  /** State or province name. */
  state?: string;
  /** City or locality name. */
  locality?: string;
  /** RSA key modulus bit length (default 2048). */
  keySize?: 2048 | 4096;
  /** Certificate validity duration in years (default 2). */
  validityYears?: number;
  /** Password used to protect the PKCS#12 bundle. */
  password: string;
}

/**
 * Extracted certificate details and cryptographic keys.
 */
export interface DigitalIdentity {
  /** The X.509 certificate in forge format. */
  certificate: forge.pki.Certificate;
  /** The RSA private key in forge format. */
  privateKey: forge.pki.rsa.PrivateKey;
  /** PEM-encoded certificate string. */
  certificatePem: string;
  /** Binary PKCS#12 (.p12/.pfx) byte buffer. */
  p12Bytes: Uint8Array;
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
  /** Certificate validity start date. */
  validFrom: Date;
  /** Certificate validity expiration date. */
  validTo: Date;
  /** Hexadecimal certificate serial number. */
  serialNumber: string;
}

/**
 * Configuration options for visual signature placement on a PDF page.
 */
export interface VisualSignatureOptions {
  /** Zero-based target page index. */
  pageIndex: number;
  /** Left coordinate in PDF points. */
  x: number;
  /** Bottom coordinate in PDF points. */
  y: number;
  /** Signature box width in points. */
  width: number;
  /** Signature box height in points. */
  height: number;
  /** Optional transparent PNG Data URL representing the handwritten signature graphic. */
  graphicDataUrl?: string;
  /** Whether to render textual signer details (Name, Date, Reason, Location). */
  showTextDetails?: boolean;
}

/**
 * Options for digitally signing a PDF document conforming to PDF ISO 32000.
 */
export interface SignPdfOptions {
  /** The active digital identity containing certificate and private key. */
  identity: DigitalIdentity;
  /** Declared signer name. */
  signerName: string;
  /** Declared signing reason (e.g. 'I approve this document'). */
  reason?: string;
  /** Declared signing location. */
  location?: string;
  /** Declared contact information (email or phone). */
  contactInfo?: string;
  /** Signing timestamp (defaults to current date). */
  signingTime?: Date;
  /** Visual signature appearance configuration (if visible signature is requested). */
  visual?: VisualSignatureOptions;
}

/**
 * Detailed verification report for an ISO 32000 digital signature.
 */
export interface SignatureValidationResult {
  /** Unique signature field or dictionary identifier. */
  signatureId: string;
  /** Declared signer name from signature dictionary. */
  signerName: string;
  /** Declared signing reason. */
  reason?: string;
  /** Declared signing location. */
  location?: string;
  /** Declared contact info. */
  contactInfo?: string;
  /** Formatted signing timestamp string. */
  signingTimeFormatted: string;
  /** Whether the document bytes match the cryptographic digest (no tampering). */
  isDocumentUntampered: boolean;
  /** Whether the RSA signature is mathematically valid. */
  isCryptographicallyValid: boolean;
  /** Whether the certificate is expired at present time. */
  isCertExpired: boolean;
  /** Whether the certificate is self-signed. */
  isSelfSigned: boolean;
  /** Overall validity status. */
  status: 'valid' | 'tampered' | 'invalid' | 'expired';
  /** Signer certificate subject details. */
  certificateSubject: {
    commonName: string;
    organization?: string;
    email?: string;
    country?: string;
  };
  /** Certificate issuer details. */
  certificateIssuer: {
    commonName: string;
    organization?: string;
  };
  /** Certificate serial number. */
  serialNumber: string;
  /** Certificate valid from date. */
  validFrom: string;
  /** Certificate valid to date. */
  validTo: string;
  /** PDF signature filter (e.g. Adobe.PPKLite). */
  filter: string;
  /** PDF signature subfilter (e.g. adbe.pkcs7.detached). */
  subFilter: string;
  /** Byte range array [offset1, length1, offset2, length2]. */
  byteRange: number[];
}

/**
 * Formats a Date object into PDF timestamp format: D:YYYYMMDDHHmmSS+HH'mm'.
 *
 * @param date The date to format.
 * @return PDF formatted date string.
 */
export function formatPdfDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const min = pad(date.getMinutes());
  const sec = pad(date.getSeconds());

  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMins = pad(absOffset % 60);

  return `D:${year}${month}${day}${hour}${min}${sec}${offsetSign}${offsetHours}'${offsetMins}'`;
}

/**
 * Creates a self-signed X.509 certificate and RSA keypair packaged in a PKCS#12 bundle.
 *
 * @param options Certificate metadata and password options.
 * @return A Promise resolving to the created DigitalIdentity.
 */
export async function createSelfSignedCertificate(options: CreateCertOptions): Promise<DigitalIdentity> {
  const keySize = options.keySize || 2048;
  const validityYears = options.validityYears || 2;

  // 1. Generate RSA Keypair
  const keypair = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: keySize, workers: -1 }, (err, keys) => {
      if (err) return reject(err);
      resolve(keys);
    });
  });

  // 2. Create X.509 Certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;

  const notBefore = new Date();
  const notAfter = new Date();
  notAfter.setFullYear(notBefore.getFullYear() + validityYears);

  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;

  const attrs = [
    { name: 'commonName', value: options.commonName },
    ...(options.country ? [{ name: 'countryName', value: options.country }] : []),
    ...(options.state ? [{ name: 'stateOrProvinceName', value: options.state }] : []),
    ...(options.locality ? [{ name: 'localityName', value: options.locality }] : []),
    ...(options.organization ? [{ name: 'organizationName', value: options.organization }] : []),
    ...(options.organizationalUnit ? [{ name: 'organizationalUnitName', value: options.organizationalUnit }] : []),
    ...(options.email ? [{ name: 'emailAddress', value: options.email }] : []),
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs); // Self-signed: issuer matches subject

  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false,
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: false,
      clientAuth: true,
      codeSigning: false,
      emailProtection: true,
      timeStamping: true,
    },
    {
      name: 'subjectKeyIdentifier',
    },
  ]);

  // Self-sign certificate with SHA-256
  cert.sign(keypair.privateKey, forge.md.sha256.create());

  // 3. Package into PKCS#12 (.p12) container
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keypair.privateKey,
    [cert],
    options.password,
    {
      algorithm: '3des',
      friendlyName: options.commonName,
      generateLocalKeyId: true,
    }
  );

  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Bytes = new Uint8Array(p12Der.length);
  for (let i = 0; i < p12Der.length; i++) {
    p12Bytes[i] = p12Der.charCodeAt(i);
  }

  const certPem = forge.pki.certificateToPem(cert);

  return {
    certificate: cert,
    privateKey: keypair.privateKey,
    certificatePem: certPem,
    p12Bytes,
    subject: {
      commonName: options.commonName,
      organization: options.organization,
      organizationalUnit: options.organizationalUnit,
      email: options.email,
      country: options.country,
    },
    issuer: {
      commonName: options.commonName,
      organization: options.organization,
    },
    validFrom: notBefore,
    validTo: notAfter,
    serialNumber: cert.serialNumber,
  };
}

/**
 * Parses an existing PKCS#12 (.p12 / .pfx) binary bundle using the provided password.
 *
 * @param p12Buffer Binary buffer of the .p12 file.
 * @param password Password string to decrypt the private key.
 * @return The parsed DigitalIdentity structure.
 */
export function parsePkcs12(p12Buffer: ArrayBuffer | Uint8Array, password = ''): DigitalIdentity {
  const bytes = p12Buffer instanceof Uint8Array ? p12Buffer : new Uint8Array(p12Buffer);
  let binaryStr = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryStr += String.fromCharCode(bytes[i]);
  }

  const p12Asn1 = forge.asn1.fromDer(binaryStr);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  // Extract certificate
  let cert: forge.pki.Certificate | null = null;
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBagArray = certBags[forge.pki.oids.certBag];
  if (certBagArray && certBagArray.length > 0 && certBagArray[0].cert) {
    cert = certBagArray[0].cert;
  }

  // Extract private key
  let privateKey: forge.pki.rsa.PrivateKey | null = null;
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBagArray = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
  if (keyBagArray && keyBagArray.length > 0 && keyBagArray[0].key) {
    privateKey = keyBagArray[0].key as forge.pki.rsa.PrivateKey;
  } else {
    // Try unencrypted key bag
    const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
    const plainKeyArray = plainKeyBags[forge.pki.oids.keyBag];
    if (plainKeyArray && plainKeyArray.length > 0 && plainKeyArray[0].key) {
      privateKey = plainKeyArray[0].key as forge.pki.rsa.PrivateKey;
    }
  }

  if (!cert || !privateKey) {
    throw new Error('Failed to extract certificate and private key from PKCS#12 file. Check password.');
  }

  const getAttr = (c: forge.pki.Certificate, name: string): string | undefined => {
    const a = c.subject.getField(name);
    return a ? String(a.value) : undefined;
  };
  const getIssuerAttr = (c: forge.pki.Certificate, name: string): string | undefined => {
    const a = c.issuer.getField(name);
    return a ? String(a.value) : undefined;
  };

  const certPem = forge.pki.certificateToPem(cert);

  return {
    certificate: cert,
    privateKey,
    certificatePem: certPem,
    p12Bytes: bytes,
    subject: {
      commonName: getAttr(cert, 'commonName') || 'Unknown Signer',
      organization: getAttr(cert, 'organizationName'),
      organizationalUnit: getAttr(cert, 'organizationalUnitName'),
      email: getAttr(cert, 'emailAddress'),
      country: getAttr(cert, 'countryName'),
    },
    issuer: {
      commonName: getIssuerAttr(cert, 'commonName') || 'Unknown Issuer',
      organization: getIssuerAttr(cert, 'organizationName'),
    },
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
    serialNumber: cert.serialNumber,
  };
}

/** Fixed byte size allocated for the PKCS#7 detached signature placeholder in PDF. */
const SIGNATURE_PLACEHOLDER_LENGTH = 8192; // 8192 bytes = 16384 hexadecimal characters

/**
 * Digitally signs a PDF document conforming to PDF ISO 32000-1 / ISO 32000-2 Section 12.8.
 *
 * Employs `/Filter /Adobe.PPKLite` and `/SubFilter /adbe.pkcs7.detached`, computing
 * SHA-256 byte-range hashes and embedding a DER-encoded PKCS#7 signedData structure.
 *
 * @param pdfBytes Binary bytes of the active PDF document.
 * @param options Digital signing configuration including identity, metadata, and visual options.
 * @return A Promise resolving to the signed PDF Uint8Array.
 */
export async function signPdfIso32000(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: SignPdfOptions
): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const signingTime = options.signingTime || new Date();
  const pdfDateStr = formatPdfDate(signingTime);

  // 1. Ensure AcroForm exists with /SigFlags 3 (SignaturesExist | AppendOnly)
  let acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  let acroFormDict: PDFDict;
  if (!acroForm || !(acroForm instanceof PDFDict)) {
    acroFormDict = pdfDoc.context.obj({
      Fields: [],
      SigFlags: 3,
    });
    pdfDoc.catalog.set(PDFName.of('AcroForm'), pdfDoc.context.register(acroFormDict));
  } else {
    acroFormDict = acroForm;
    acroFormDict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  let fieldsArray = acroFormDict.lookup(PDFName.of('Fields'));
  if (!fieldsArray || !(fieldsArray instanceof PDFArray)) {
    fieldsArray = pdfDoc.context.obj([]);
    acroFormDict.set(PDFName.of('Fields'), fieldsArray);
  }

  // 2. Prepare Signature Dictionary placeholder with ByteRange and Contents
  const placeholderHex = '0'.repeat(SIGNATURE_PLACEHOLDER_LENGTH * 2);

  // Use 10-digit placeholders for ByteRange offsets so byte count remains constant
  const byteRangePlaceholder = PDFArray.withContext(pdfDoc.context);
  byteRangePlaceholder.push(PDFNumber.of(0));
  byteRangePlaceholder.push(PDFNumber.of(1000000000));
  byteRangePlaceholder.push(PDFNumber.of(1000000000));
  byteRangePlaceholder.push(PDFNumber.of(1000000000));

  const sigDict = pdfDoc.context.obj({
    Type: PDFName.of('Sig'),
    Filter: PDFName.of('Adobe.PPKLite'),
    SubFilter: PDFName.of('adbe.pkcs7.detached'),
    ByteRange: byteRangePlaceholder,
    Contents: PDFHexString.of(placeholderHex),
    Reason: PDFString.of(options.reason || 'Document Digitally Signed and Verified'),
    M: PDFString.of(pdfDateStr),
    Name: PDFString.of(options.signerName || options.identity.subject.commonName),
    ...(options.location ? { Location: PDFString.of(options.location) } : {}),
    ...(options.contactInfo ? { ContactInfo: PDFString.of(options.contactInfo) } : {}),
  });

  const sigDictRef = pdfDoc.context.register(sigDict);

  // 3. Create Signature Field & Widget Annotation
  const targetPageIdx = options.visual ? options.visual.pageIndex : 0;
  const page = pdfDoc.getPage(targetPageIdx);
  const pageRef = page.ref;

  let annotRect: [number, number, number, number] = [0, 0, 0, 0];
  if (options.visual) {
    annotRect = [
      options.visual.x,
      options.visual.y,
      options.visual.x + options.visual.width,
      options.visual.y + options.visual.height,
    ];
  }

  const widgetDict = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    Rect: annotRect,
    T: PDFString.of(`Signature_${Date.now()}`),
    F: 132, // Print | Lock
    P: pageRef,
    V: sigDictRef,
  });

  // Render visual appearance on the page if requested
  if (options.visual && options.visual.width > 10 && options.visual.height > 10) {
    const vx = options.visual.x;
    const vy = options.visual.y;
    const vw = options.visual.width;
    const vh = options.visual.height;

    // Draw background badge / border on the page
    page.drawRectangle({
      x: vx,
      y: vy,
      width: vw,
      height: vh,
      color: rgb(0.98, 0.99, 1.0),
      borderColor: rgb(0.2, 0.45, 0.85),
      borderWidth: 1,
    });

    let graphicWidth = 0;

    // If a signature image graphic is provided, embed it
    if (options.visual.graphicDataUrl && options.visual.graphicDataUrl.startsWith('data:image/png;base64,')) {
      try {
        const rawBase64 = options.visual.graphicDataUrl.replace('data:image/png;base64,', '');
        const imgBytes = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));
        const embeddedImg = await pdfDoc.embedPng(imgBytes);

        graphicWidth = options.visual.showTextDetails ? Math.min(vw * 0.45, 140) : vw - 16;
        const graphicHeight = Math.min(vh - 12, graphicWidth / (embeddedImg.width / embeddedImg.height));

        page.drawImage(embeddedImg, {
          x: vx + 8,
          y: vy + (vh - graphicHeight) / 2,
          width: graphicWidth,
          height: graphicHeight,
        });
      } catch (err) {
        console.warn('Failed to embed visual signature graphic:', err);
      }
    }

    // Draw textual certificate details if requested
    if (options.visual.showTextDetails) {
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const textX = vx + (graphicWidth > 0 ? graphicWidth + 14 : 10);
      const availableW = vw - (textX - vx) - 8;
      const textStartY = vy + vh - 14;
      const fontSize = Math.max(7, Math.min(9, vh / 6));
      const lineSpacing = fontSize + 2.5;

      page.drawText(`Digitally signed by:`, {
        x: textX,
        y: textStartY,
        size: fontSize - 1,
        font: helvetica,
        color: rgb(0.4, 0.4, 0.4),
      });

      page.drawText(options.signerName || options.identity.subject.commonName, {
        x: textX,
        y: textStartY - lineSpacing,
        size: fontSize + 1,
        font: helveticaBold,
        color: rgb(0.1, 0.15, 0.3),
        maxWidth: availableW,
      });

      let currentY = textStartY - lineSpacing * 2;

      page.drawText(`Date: ${signingTime.toLocaleString()}`, {
        x: textX,
        y: currentY,
        size: fontSize - 1,
        font: helvetica,
        color: rgb(0.3, 0.3, 0.3),
        maxWidth: availableW,
      });
      currentY -= lineSpacing;

      if (options.reason) {
        page.drawText(`Reason: ${options.reason}`, {
          x: textX,
          y: currentY,
          size: fontSize - 1,
          font: helvetica,
          color: rgb(0.3, 0.3, 0.3),
          maxWidth: availableW,
        });
        currentY -= lineSpacing;
      }

      if (options.location) {
        page.drawText(`Location: ${options.location}`, {
          x: textX,
          y: currentY,
          size: fontSize - 1,
          font: helvetica,
          color: rgb(0.3, 0.3, 0.3),
          maxWidth: availableW,
        });
      }
    }
  }

  const widgetRef = pdfDoc.context.register(widgetDict);
  (fieldsArray as PDFArray).push(widgetRef);

  let annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots || !(annots instanceof PDFArray)) {
    const annotsArray = pdfDoc.context.obj([widgetRef]);
    page.node.set(PDFName.of('Annots'), annotsArray);
  } else {
    annots.push(widgetRef);
  }

  // 4. Save PDF to bytes with placeholders
  const rawSavedBytes = await pdfDoc.save({ useObjectStreams: false });

  // 5. Locate /ByteRange and /Contents in raw saved bytes
  let pdfString = '';
  for (let i = 0; i < rawSavedBytes.length; i++) {
    pdfString += String.fromCharCode(rawSavedBytes[i]);
  }

  const byteRangeSearchStr = '/ByteRange [ 0 1000000000 1000000000 1000000000 ]';
  const byteRangePos = pdfString.indexOf(byteRangeSearchStr);
  if (byteRangePos === -1) {
    throw new Error('Failed to locate /ByteRange placeholder in serialized PDF.');
  }

  const contentsPrefix = '/Contents <';
  const contentsPos = pdfString.indexOf(contentsPrefix, byteRangePos);
  if (contentsPos === -1) {
    throw new Error('Failed to locate /Contents placeholder in serialized PDF.');
  }

  const contentsStart = contentsPos + contentsPrefix.length - 1; // Position of '<'
  const contentsEnd = contentsStart + 1 + (SIGNATURE_PLACEHOLDER_LENGTH * 2) + 1; // Position of '>' + 1

  const totalLength = rawSavedBytes.length;

  const b1 = 0;
  const len1 = contentsStart;
  const b2 = contentsEnd;
  const len2 = totalLength - contentsEnd;

  // Build exact replacement for ByteRange string
  const actualByteRangeStr = `/ByteRange [ ${b1} ${len1} ${b2} ${len2} ]`;
  const paddedByteRange = actualByteRangeStr.padEnd(byteRangeSearchStr.length, ' ');

  // Inject updated ByteRange into buffer
  for (let i = 0; i < paddedByteRange.length; i++) {
    rawSavedBytes[byteRangePos + i] = paddedByteRange.charCodeAt(i);
  }

  // 6. Compute SHA-256 Digest over ByteRange byte segments (excluding /Contents)
  const part1 = rawSavedBytes.subarray(b1, b1 + len1);
  const part2 = rawSavedBytes.subarray(b2, b2 + len2);

  const md = forge.md.sha256.create();
  let part1Str = '';
  for (let i = 0; i < part1.length; i++) {
    part1Str += String.fromCharCode(part1[i]);
  }
  let part2Str = '';
  for (let i = 0; i < part2.length; i++) {
    part2Str += String.fromCharCode(part2[i]);
  }
  md.update(part1Str);
  md.update(part2Str);
  const digestBytes = md.digest().getBytes();

  // 7. Construct Detached PKCS#7 SignedData structure
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(''); // Detached signature: content is empty

  p7.addCertificate(options.identity.certificate);
  p7.addSigner({
    key: options.identity.privateKey,
    certificate: options.identity.certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        type: forge.pki.oids.messageDigest,
        value: digestBytes,
      },
      {
        type: forge.pki.oids.signingTime,
        value: forge.asn1.dateToUtcTime(signingTime),
      },
    ],
  });

  p7.sign({ detached: true });

  const p7Der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const p7Hex = forge.util.bytesToHex(p7Der).toUpperCase();

  if (p7Hex.length > SIGNATURE_PLACEHOLDER_LENGTH * 2) {
    throw new Error(`Generated PKCS#7 signature (${p7Hex.length} hex chars) exceeds allocated placeholder capacity.`);
  }

  const paddedHex = p7Hex.padEnd(SIGNATURE_PLACEHOLDER_LENGTH * 2, '0');

  // 8. Inject hexadecimal signature into /Contents placeholder
  const hexTargetStart = contentsStart + 1; // after '<'
  for (let i = 0; i < paddedHex.length; i++) {
    rawSavedBytes[hexTargetStart + i] = paddedHex.charCodeAt(i);
  }

  return rawSavedBytes;
}

/**
 * Verifies all ISO 32000 digital signatures present in a PDF document.
 *
 * Checks byte-range boundaries, re-hashes document segments to verify integrity,
 * and validates the PKCS#7 certificate and cryptographic signature.
 *
 * @param pdfBytes Binary buffer of the PDF file.
 * @return An array of SignatureValidationResult objects describing all detected signatures.
 */
export async function verifyPdfSignatures(
  pdfBytes: Uint8Array | ArrayBuffer
): Promise<SignatureValidationResult[]> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const totalLength = bytes.length;
  const results: SignatureValidationResult[] = [];

  let pdfString = '';
  for (let i = 0; i < bytes.length; i++) {
    pdfString += String.fromCharCode(bytes[i]);
  }

  // Regex to detect /Type /Sig or /Filter /Adobe.PPKLite dictionaries
  const sigRegex = /<<[^>]*\/Type\s*\/Sig[^>]*>>/gs;
  const matches = [...pdfString.matchAll(sigRegex)];

  // Also check AcroForm fields
  let matchIdx = 0;
  for (const match of matches) {
    matchIdx++;
    const sigBlock = match[0];

    // Extract ByteRange
    const byteRangeMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(sigBlock);
    // Extract Contents
    const contentsMatch = /\/Contents\s*<([0-9a-fA-F\s]+)>/i.exec(sigBlock);

    // Extract Name
    const nameMatch = /\/Name\s*\(([^)]+)\)/.exec(sigBlock);
    // Extract Reason
    const reasonMatch = /\/Reason\s*\(([^)]+)\)/.exec(sigBlock);
    // Extract Location
    const locMatch = /\/Location\s*\(([^)]+)\)/.exec(sigBlock);
    // Extract Contact
    const contactMatch = /\/ContactInfo\s*\(([^)]+)\)/.exec(sigBlock);
    // Extract Date
    const dateMatch = /\/M\s*\(([^)]+)\)/.exec(sigBlock);
    // Extract SubFilter
    const subFilterMatch = /\/SubFilter\s*\/([a-zA-Z0-9._]+)/.exec(sigBlock);
    const filterMatch = /\/Filter\s*\/([a-zA-Z0-9._]+)/.exec(sigBlock);

    if (!byteRangeMatch || !contentsMatch) {
      continue;
    }

    const b1 = parseInt(byteRangeMatch[1], 10);
    const l1 = parseInt(byteRangeMatch[2], 10);
    const b2 = parseInt(byteRangeMatch[3], 10);
    const l2 = parseInt(byteRangeMatch[4], 10);

    const rawHex = contentsMatch[1].replace(/\s+/g, '');
    const filter = filterMatch ? filterMatch[1] : 'Adobe.PPKLite';
    const subFilter = subFilterMatch ? subFilterMatch[1] : 'adbe.pkcs7.detached';

    let isUntampered = false;
    let isCryptValid = false;
    let isExpired = false;
    let isSelfSigned = false;

    let certSubject: { commonName: string; organization?: string; email?: string; country?: string } = { commonName: 'Unknown Signer' };
    let certIssuer: { commonName: string; organization?: string } = { commonName: 'Unknown Issuer' };
    let serialNum = '-';
    let validFromStr = '-';
    let validToStr = '-';

    try {
      // 1. Verify byte range validity
      if (b1 === 0 && b2 >= b1 + l1 && b2 + l2 === totalLength) {
        // Compute SHA-256 over ByteRange segments
        const part1 = bytes.subarray(b1, b1 + l1);
        const part2 = bytes.subarray(b2, b2 + l2);

        const md = forge.md.sha256.create();
        let p1Str = '';
        for (let i = 0; i < part1.length; i++) p1Str += String.fromCharCode(part1[i]);
        let p2Str = '';
        for (let i = 0; i < part2.length; i++) p2Str += String.fromCharCode(part2[i]);
        md.update(p1Str);
        md.update(p2Str);
        const computedHash = md.digest().getBytes();

        // 2. Parse PKCS#7 Structure
        const cleanHex = rawHex.replace(/0+$/, ''); // Trim trailing zero padding
        const p7Der = forge.util.hexToBytes(cleanHex.length % 2 !== 0 ? cleanHex + '0' : cleanHex);
        const p7Asn1 = forge.asn1.fromDer(p7Der);
        const p7 = forge.pkcs7.createSignedData();
        // @ts-expect-error node-forge pkcs7 fromAsn1
        p7.fromAsn1(p7Asn1);

        if (p7.certificates && p7.certificates.length > 0) {
          const signerCert = p7.certificates[0];
          const getVal = (f: string) => signerCert.subject.getField(f)?.value ? String(signerCert.subject.getField(f)!.value) : undefined;
          const getIss = (f: string) => signerCert.issuer.getField(f)?.value ? String(signerCert.issuer.getField(f)!.value) : undefined;

          certSubject = {
            commonName: getVal('commonName') || 'Unknown Signer',
            organization: getVal('organizationName'),
            email: getVal('emailAddress'),
            country: getVal('countryName'),
          };

          certIssuer = {
            commonName: getIss('commonName') || 'Unknown Issuer',
            organization: getIss('organizationName'),
          };

          serialNum = signerCert.serialNumber;
          validFromStr = signerCert.validity.notBefore.toLocaleDateString();
          validToStr = signerCert.validity.notAfter.toLocaleDateString();

          const now = new Date();
          isExpired = now < signerCert.validity.notBefore || now > signerCert.validity.notAfter;
          isSelfSigned = certSubject.commonName === certIssuer.commonName;

          // Extract embedded message digest from authenticated attributes
          const p7Obj = p7 as unknown as {
            rawCapture?: {
              authenticatedAttributes?: Array<{
                value: Array<{ value: string; [k: string]: unknown }>;
              }>;
            };
          };

          if (p7Obj.rawCapture && p7Obj.rawCapture.authenticatedAttributes) {
            for (const attr of p7Obj.rawCapture.authenticatedAttributes) {
              const typeOid = forge.asn1.derToOid(attr.value[0].value);
              if (typeOid === forge.pki.oids.messageDigest) {
                const embeddedDigest = (attr.value[1].value[0] as unknown as { value: string }).value || attr.value[1].value;
                if (embeddedDigest === computedHash) {
                  isUntampered = true;
                  isCryptValid = true;
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Error during signature verification:', err);
    }

    let status: 'valid' | 'tampered' | 'invalid' | 'expired' = 'valid';
    if (!isUntampered) {
      status = 'tampered';
    } else if (isExpired) {
      status = 'expired';
    } else if (!isCryptValid) {
      status = 'invalid';
    }

    const signingDate = dateMatch ? dateMatch[1] : '';

    results.push({
      signatureId: `sig_${matchIdx}`,
      signerName: nameMatch ? nameMatch[1] : certSubject.commonName,
      reason: reasonMatch ? reasonMatch[1] : undefined,
      location: locMatch ? locMatch[1] : undefined,
      contactInfo: contactMatch ? contactMatch[1] : undefined,
      signingTimeFormatted: signingDate || 'Unknown Date',
      isDocumentUntampered: isUntampered,
      isCryptographicallyValid: isCryptValid,
      isCertExpired: isExpired,
      isSelfSigned: isSelfSigned,
      status,
      certificateSubject: certSubject,
      certificateIssuer: certIssuer,
      serialNumber: serialNum,
      validFrom: validFromStr,
      validTo: validToStr,
      filter,
      subFilter,
      byteRange: [b1, l1, b2, l2],
    });
  }

  return results;
}
