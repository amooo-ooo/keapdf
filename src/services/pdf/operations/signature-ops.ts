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

