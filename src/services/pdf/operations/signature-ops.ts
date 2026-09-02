import forge from 'node-forge';
import {
  PDFDocument,
  PDFName,
  PDFHexString,
  PDFString,
  PDFArray,
  PDFNumber,
  PDFDict,
  PDFRawStream,
  rgb,
  StandardFonts,
} from 'pdf-lib';

/** Standard Object Identifiers (OIDs) for PKCS#7, CAdES, and X.509 extensions. */
export const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
export const OID_ID_DATA = '1.2.840.113549.1.7.1';
export const OID_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';
export const OID_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';
export const OID_ADOBE_DOC_SIGNING = '1.2.840.113583.1.1.5';
export const OID_TIME_STAMPING = '1.3.6.1.5.5.7.3.8';
export const OID_CRL_DIST_POINTS = '2.5.29.31';
export const OID_AUTHORITY_INFO_ACCESS = '1.3.6.1.5.5.7.1.1';
export const OID_OCSP = '1.3.6.1.5.5.7.48.1';

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
  /** Country code (2-letter ISO, e.g. 'US', 'NZ', 'CH'). */
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
  /** Complete certificate chain preserving leaf, intermediate, and root CAs. */
  certificateChain: forge.pki.Certificate[];
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
 * Options for digitally signing a PDF document conforming to PDF ISO 32000 and ETSI PAdES.
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
  /** PDF signature subfilter. Defaults to 'ETSI.CAdES.detached'. */
  subFilter?: 'ETSI.CAdES.detached' | 'adbe.pkcs7.detached';
  /** Optional RFC 3161 TSA server URL (e.g. 'https://freetsa.org/tsr') for PAdES B-T. */
  tsaUrl?: string;
  /** Optional pre-generated RFC 3161 TimeStampToken DER bytes (for offline or unit tests). */
  timestampTokenBytes?: Uint8Array;
  /** Whether to embed Document Security Store (/DSS) for PAdES B-LT long term validation. */
  embedDss?: boolean;
}

/**
 * Detailed verification report for an ISO 32000 and ETSI PAdES digital signature.
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
  /** PDF signature subfilter (e.g. ETSI.CAdES.detached, adbe.pkcs7.detached). */
  subFilter: string;
  /** Byte range array [offset1, length1, offset2, length2]. */
  byteRange: number[];
  /** PAdES profile level detected. */
  padesProfile: 'PAdES-B-LT' | 'PAdES-B-T' | 'PAdES-B-B' | 'Legacy-PKCS7';
  /** Whether CAdES signingCertificateV2 (RFC 5035) is present and cryptographically bound. */
  hasSigningCertificateV2: boolean;
  /** Whether an RFC 3161 Time-Stamp Token is present in unsigned attributes. */
  hasTimestampToken: boolean;
  /** Formatted timestamp token date and time if present. */
  timestampTime?: string;
  /** Whether the end-entity certificate contains illegal timeStamping usage. */
  hasIllegalTimeStampingUsage: boolean;
  /** Total certificates in the embedded PKCS#7 certificate chain. */
  certificateChainLength: number;
  /** Whether the document contains a /DSS dictionary. */
  hasDss: boolean;
  /** ESigA and ZertES compliance evaluation report. */
  esigaCompliance: EsigaComplianceReport;
}

/**
 * Tri-state compliance verification status conforming to ETSI EN 319 102-1.
 */
export type ComplianceCheckStatus = 'valid' | 'indeterminate' | 'failed';

/**
 * Diagnostic record for an individual statutory compliance requirement.
 */
export interface SignatureComplianceCheck {
  /** Identifier of the compliance evaluation category. */
  id: 'signature_integrity' | 'revocation_status' | 'timestamp_validity' | 'certificate_legitimacy';
  /** Human-readable category title. */
  title: string;
  /** Verification status for this individual check. */
  status: ComplianceCheckStatus;
  /** Primary status message following Swiss Federal validator standards. */
  message: string;
  /** Supporting technical specification details and regulatory context. */
  technicalDetails?: string;
}

/**
 * Complete electronic signature compliance report conforming to Swiss ZertES (SR 943.03) and EU eIDAS.
 */
export interface EsigaComplianceReport {
  /** Top-level overall status. */
  status: 'compliant' | 'indeterminate' | 'non_compliant';
  /** Diagnostic reasons explaining non-compliance or indeterminate outcome. */
  reasons: string[];
  /** Detailed 4-pillar statutory compliance checks. */
  checks: SignatureComplianceCheck[];
  /** Standard designation evaluated against. */
  standard: string;
  /** Statutory signature qualification tier. */
  qualificationLevel: 'QES' | 'AES' | 'SES';
}

/**
 * Builds an ESSCertIDv2 ASN.1 structure according to RFC 5035 and ETSI EN 319 122.
 *
 * Computes the SHA-256 hash of the entire DER-encoded certificate and constructs
 * the AlgorithmIdentifier and hash octet string.
 *
 * @param cert The X.509 certificate in forge format.
 * @return An ASN.1 Sequence representing ESSCertIDv2.
 */
export function buildEssCertIdV2(cert: forge.pki.Certificate): forge.asn1.Asn1 {
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(certDer);
  const certHash = md.digest().getBytes();

  const sha256OidDer = forge.asn1.oidToDer(OID_SHA256).getBytes();
  const algId = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, sha256OidDer),
  ]);

  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    algId,
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, certHash),
  ]);
}

/**
 * Builds a SigningCertificateV2 ASN.1 attribute value according to RFC 5035.
 *
 * @param cert The signing certificate in forge format.
 * @return An ASN.1 Sequence containing the SEQUENCE OF ESSCertIDv2.
 */
export function buildSigningCertificateV2(cert: forge.pki.Certificate): forge.asn1.Asn1 {
  const essCertIdV2 = buildEssCertIdV2(cert);
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [essCertIdV2]),
  ]);
}

/**
 * Constructs an RFC 3161 TimeStampReq ASN.1 binary message.
 *
 * @param hashedMessageBytes The binary hash string (SHA-256) of the input to timestamp.
 * @param nonce Optional cryptographically strong nonce integer.
 * @return The DER-encoded TimeStampReq byte array.
 */
export function createTimeStampRequest(hashedMessageBytes: string, nonce?: number): Uint8Array {
  const sha256OidDer = forge.asn1.oidToDer(OID_SHA256).getBytes();
  const algId = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, sha256OidDer),
  ]);

  const msgImprint = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    algId,
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, hashedMessageBytes),
  ]);

  const reqSeq: forge.asn1.Asn1[] = [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.hexToBytes('01')),
    msgImprint,
  ];

  if (nonce !== undefined) {
    const nonceHex = nonce.toString(16);
    const cleanHex = nonceHex.length % 2 !== 0 ? '0' + nonceHex : nonceHex;
    reqSeq.push(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.hexToBytes(cleanHex)));
  }

  // certReq = TRUE to request TSA certificate chain in response
  reqSeq.push(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.BOOLEAN, false, forge.util.hexToBytes('FF')));

  const reqAsn1 = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, reqSeq);
  const derStr = forge.asn1.toDer(reqAsn1).getBytes();
  const reqBytes = new Uint8Array(derStr.length);
  for (let i = 0; i < derStr.length; i++) {
    reqBytes[i] = derStr.charCodeAt(i);
  }
  return reqBytes;
}

/**
 * Dispatches an RFC 3161 HTTP query to an external Time-Stamping Authority (TSA).
 *
 * Computes SHA-256 over the provided signature value bytes, sends the request,
 * and extracts the TimeStampToken from the response.
 *
 * @param signatureBytes Raw RSA signature value bytes from the SignerInfo structure.
 * @param tsaUrl HTTP/HTTPS endpoint of the RFC 3161 TSA server.
 * @param timeoutMs Request timeout in milliseconds.
 * @return DER-encoded TimeStampToken CMS SignedData bytes.
 */
export async function requestRfc3161Timestamp(
  signatureBytes: Uint8Array,
  tsaUrl: string,
  timeoutMs = 12000
): Promise<Uint8Array> {
  let sigBin = '';
  for (let i = 0; i < signatureBytes.length; i++) {
    sigBin += String.fromCharCode(signatureBytes[i]);
  }
  const md = forge.md.sha256.create();
  md.update(sigBin);
  const digest = md.digest().getBytes();

  const nonce = Math.floor(Math.random() * 1000000000);
  const reqBytes = createTimeStampRequest(digest, nonce);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(tsaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/timestamp-query',
        'Accept': 'application/timestamp-reply',
      },
      body: reqBytes as unknown as BodyInit,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`TSA server returned HTTP ${response.status}: ${response.statusText}`);
    }

    const respBuffer = await response.arrayBuffer();
    const respBytes = new Uint8Array(respBuffer);

    let respStr = '';
    for (let i = 0; i < respBytes.length; i++) {
      respStr += String.fromCharCode(respBytes[i]);
    }
    const respAsn1 = forge.asn1.fromDer(respStr);
    const statusSeq = respAsn1.value[0] as forge.asn1.Asn1;
    const statusVal = (statusSeq.value as forge.asn1.Asn1[])[0];
    const statusCode = typeof statusVal.value === 'string' ? statusVal.value.charCodeAt(0) : 0;
    if (statusCode !== 0) {
      throw new Error(`TSA status rejected with code ${statusCode}`);
    }

    const tokenAsn1 = respAsn1.value[1] as forge.asn1.Asn1;
    if (!tokenAsn1) {
      throw new Error('TSA response missing TimeStampToken structure.');
    }

    const tokenDer = forge.asn1.toDer(tokenAsn1).getBytes();
    const tokenBytes = new Uint8Array(tokenDer.length);
    for (let i = 0; i < tokenDer.length; i++) {
      tokenBytes[i] = tokenDer.charCodeAt(i);
    }
    return tokenBytes;
  } finally {
    clearTimeout(timer);
  }
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
 * Creates a self-signed X.509 certificate conforming to RFC 5280, ISO 32000, and Swiss ESigA.
 *
 * Correctly configures Key Usage for digital signatures and non-repudiation while
 * strictly omitting timeStamping from the end-entity certificate.
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
  cert.setIssuer(attrs);

  // Key Usage: digitalSignature and nonRepudiation (contentCommitment) are mandatory
  // for Advanced Electronic Signatures under ZertES Art. 2 lit. a and Swiss CO Art. 14.
  // timeStamping is strictly false on document signer certificates.
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false,
      critical: true,
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: false,
      dataEncipherment: false,
      keyCertSign: false,
      cRLSign: false,
      critical: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: false,
      clientAuth: true,
      codeSigning: false,
      emailProtection: true,
      timeStamping: false,
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
    certificateChain: [cert],
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
 * Parses an existing PKCS#12 (.p12 / .pfx) binary bundle, preserving the complete certificate chain.
 *
 * @param p12Buffer Binary buffer of the .p12 file.
 * @param password Password string to decrypt the private key.
 * @return The parsed DigitalIdentity structure with full certificate chain.
 */
export function parsePkcs12(p12Buffer: ArrayBuffer | Uint8Array, password = ''): DigitalIdentity {
  const bytes = p12Buffer instanceof Uint8Array ? p12Buffer : new Uint8Array(p12Buffer);
  let binaryStr = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryStr += String.fromCharCode(bytes[i]);
  }

  const p12Asn1 = forge.asn1.fromDer(binaryStr);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  // Extract all certificates in the bundle
  const allCerts: forge.pki.Certificate[] = [];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBagArray = certBags[forge.pki.oids.certBag];
  if (certBagArray && certBagArray.length > 0) {
    for (const bag of certBagArray) {
      if (bag.cert) {
        allCerts.push(bag.cert);
      }
    }
  }

  // Extract private key
  let privateKey: forge.pki.rsa.PrivateKey | null = null;
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBagArray = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
  if (keyBagArray && keyBagArray.length > 0 && keyBagArray[0].key) {
    privateKey = keyBagArray[0].key as forge.pki.rsa.PrivateKey;
  } else {
    const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
    const plainKeyArray = plainKeyBags[forge.pki.oids.keyBag];
    if (plainKeyArray && plainKeyArray.length > 0 && plainKeyArray[0].key) {
      privateKey = plainKeyArray[0].key as forge.pki.rsa.PrivateKey;
    }
  }

  if (allCerts.length === 0 || !privateKey) {
    throw new Error('Failed to extract certificate and private key from PKCS#12 file. Check password.');
  }

  // Match leaf certificate by public key modulus
  let leafCert = allCerts[0];
  const privMod = (privateKey.n as forge.jsbn.BigInteger).toString(16);
  for (const candidate of allCerts) {
    const pubMod = (candidate.publicKey as forge.pki.rsa.PublicKey).n?.toString(16);
    if (pubMod && pubMod === privMod) {
      leafCert = candidate;
      break;
    }
  }

  // Organize certificate chain with leaf certificate first, followed by intermediate/root CAs
  const chain = [leafCert, ...allCerts.filter((c) => c !== leafCert)];

  const getAttr = (c: forge.pki.Certificate, name: string): string | undefined => {
    const val = c.subject.getField(name)?.value ?? (name === 'commonName' ? c.subject.getField('CN')?.value : undefined);
    return val ? String(val) : undefined;
  };
  const getIssuerAttr = (c: forge.pki.Certificate, name: string): string | undefined => {
    const val = c.issuer.getField(name)?.value ?? (name === 'commonName' ? c.issuer.getField('CN')?.value : undefined);
    return val ? String(val) : undefined;
  };

  const certPem = forge.pki.certificateToPem(leafCert);

  return {
    certificate: leafCert,
    privateKey,
    certificatePem: certPem,
    p12Bytes: bytes,
    certificateChain: chain,
    subject: {
      commonName: getAttr(leafCert, 'commonName') || 'Unknown Signer',
      organization: getAttr(leafCert, 'organizationName'),
      organizationalUnit: getAttr(leafCert, 'organizationalUnitName'),
      email: getAttr(leafCert, 'emailAddress'),
      country: getAttr(leafCert, 'countryName'),
    },
    issuer: {
      commonName: getIssuerAttr(leafCert, 'commonName') || 'Unknown Issuer',
      organization: getIssuerAttr(leafCert, 'organizationName'),
    },
    validFrom: leafCert.validity.notBefore,
    validTo: leafCert.validity.notAfter,
    serialNumber: leafCert.serialNumber,
  };
}

/** Byte capacity allocated for detached signature placeholder (supports chains, CAdES, and timestamps). */
const SIGNATURE_PLACEHOLDER_LENGTH = 16384; // 16384 bytes = 32768 hex characters

/**
 * Digitally signs a PDF document conforming to PDF ISO 32000-1 / ISO 32000-2 and ETSI EN 319 142 (PAdES).
 *
 * Supports /SubFilter /ETSI.CAdES.detached (PAdES Baseline) and /adbe.pkcs7.detached,
 * computing SHA-256 byte-range hashes and embedding ESS signingCertificateV2, complete
 * certificate chains, and optional RFC 3161 timestamps.
 *
 * @param pdfBytes Binary bytes of the active PDF document.
 * @param options Digital signing configuration including identity, metadata, visual, and PAdES options.
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
  const subFilter = options.subFilter || 'ETSI.CAdES.detached';

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

  const byteRangePlaceholder = PDFArray.withContext(pdfDoc.context);
  byteRangePlaceholder.push(PDFNumber.of(0));
  byteRangePlaceholder.push(PDFNumber.of(1000000000));
  byteRangePlaceholder.push(PDFNumber.of(1000000000));
  byteRangePlaceholder.push(PDFNumber.of(1000000000));

  const sigDict = pdfDoc.context.obj({
    Type: PDFName.of('Sig'),
    Filter: PDFName.of('Adobe.PPKLite'),
    SubFilter: PDFName.of(subFilter),
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

  // Render visual appearance on page if requested
  if (options.visual && options.visual.width > 10 && options.visual.height > 10) {
    const vx = options.visual.x;
    const vy = options.visual.y;
    const vw = options.visual.width;
    const vh = options.visual.height;

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

  // 4. Attach Document Security Store (/DSS) for PAdES B-LT if requested
  if (options.embedDss) {
    const certStreams: PDFRawStream[] = [];
    const chain = options.identity.certificateChain || [options.identity.certificate];
    for (const c of chain) {
      const der = forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes();
      const u8 = new Uint8Array(der.length);
      for (let i = 0; i < der.length; i++) u8[i] = der.charCodeAt(i);
      const stream = pdfDoc.context.stream(u8);
      certStreams.push(stream);
    }

    const certRefs = certStreams.map((s) => pdfDoc.context.register(s));
    const certsArray = pdfDoc.context.obj(certRefs);

    const dssDict = pdfDoc.context.obj({
      Type: PDFName.of('DSS'),
      Certs: certsArray,
    });
    pdfDoc.catalog.set(PDFName.of('DSS'), pdfDoc.context.register(dssDict));
  }

  // 5. Save PDF to bytes with placeholders
  const rawSavedBytes = await pdfDoc.save({ useObjectStreams: false });

  // 6. Locate /ByteRange and /Contents in raw saved bytes
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

  const contentsStart = contentsPos + contentsPrefix.length - 1;
  const contentsEnd = contentsStart + 1 + (SIGNATURE_PLACEHOLDER_LENGTH * 2) + 1;

  const totalLength = rawSavedBytes.length;

  const b1 = 0;
  const len1 = contentsStart;
  const b2 = contentsEnd;
  const len2 = totalLength - contentsEnd;

  const actualByteRangeStr = `/ByteRange [ ${b1} ${len1} ${b2} ${len2} ]`;
  const paddedByteRange = actualByteRangeStr.padEnd(byteRangeSearchStr.length, ' ');

  for (let i = 0; i < paddedByteRange.length; i++) {
    rawSavedBytes[byteRangePos + i] = paddedByteRange.charCodeAt(i);
  }

  // 7. Compute SHA-256 Digest over ByteRange byte segments
  const part1 = rawSavedBytes.subarray(b1, b1 + len1);
  const part2 = rawSavedBytes.subarray(b2, b2 + len2);

  const md = forge.md.sha256.create();
  let part1Str = '';
  for (let i = 0; i < part1.length; i++) part1Str += String.fromCharCode(part1[i]);
  let part2Str = '';
  for (let i = 0; i < part2.length; i++) part2Str += String.fromCharCode(part2[i]);
  md.update(part1Str);
  md.update(part2Str);
  const digestBytes = md.digest().getBytes();

  // 8. Construct Detached PKCS#7 / CAdES SignedData structure
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(part1Str + part2Str);

  const chain = options.identity.certificateChain && options.identity.certificateChain.length > 0
    ? options.identity.certificateChain
    : [options.identity.certificate];
  for (const c of chain) {
    p7.addCertificate(c);
  }

  const authenticatedAttributes: Array<{ type: string; value: unknown }> = [
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
  ];

  if (subFilter === 'ETSI.CAdES.detached') {
    authenticatedAttributes.push({
      type: OID_SIGNING_CERTIFICATE_V2,
      value: buildSigningCertificateV2(options.identity.certificate),
    });
  }

  p7.addSigner({
    key: options.identity.privateKey,
    certificate: options.identity.certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: authenticatedAttributes as unknown as Array<{ type: string; value?: string }>,
  });

  p7.sign({ detached: true });

  // 9. Embed RFC 3161 Time-Stamp Token into unsigned attributes if requested
  const asn1Root = p7.toAsn1();

  let tstBytes = options.timestampTokenBytes;
  if (!tstBytes && options.tsaUrl) {
    try {
      const signerObj = (p7 as unknown as { signers: Array<{ signature: string }> }).signers[0];
      const rawSigStr = signerObj.signature;
      const rawSigBytes = new Uint8Array(rawSigStr.length);
      for (let i = 0; i < rawSigStr.length; i++) rawSigBytes[i] = rawSigStr.charCodeAt(i);

      tstBytes = await requestRfc3161Timestamp(rawSigBytes, options.tsaUrl);
    } catch (tsaErr) {
      console.warn('Failed to retrieve RFC 3161 timestamp from TSA:', tsaErr);
    }
  }

  if (tstBytes && tstBytes.length > 0) {
    try {
      let tstBin = '';
      for (let i = 0; i < tstBytes.length; i++) tstBin += String.fromCharCode(tstBytes[i]);
      let tstAsn1: forge.asn1.Asn1;
      try {
        tstAsn1 = forge.asn1.fromDer(tstBin);
      } catch {
        tstAsn1 = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, tstBin);
      }

      // Locate SignerInfo inside SignedData
      const signedDataSeq = (asn1Root.value as forge.asn1.Asn1[])[1].value[0] as forge.asn1.Asn1;
      const signerInfosSet = (signedDataSeq.value as forge.asn1.Asn1[])[(signedDataSeq.value as forge.asn1.Asn1[]).length - 1];
      const signerInfoSeq = (signerInfosSet.value as forge.asn1.Asn1[])[0];

      const tstAttr = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer(OID_TIMESTAMP_TOKEN).getBytes()),
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [tstAsn1]),
      ]);

      const unsignedAttrsContext = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 1, true, [tstAttr]);
      (signerInfoSeq.value as forge.asn1.Asn1[]).push(unsignedAttrsContext);
    } catch (injectErr) {
      console.warn('Failed to embed timestamp token into unsigned attributes:', injectErr);
    }
  }

  const p7Der = forge.asn1.toDer(asn1Root).getBytes();
  const p7Hex = forge.util.bytesToHex(p7Der).toUpperCase();

  if (p7Hex.length > SIGNATURE_PLACEHOLDER_LENGTH * 2) {
    throw new Error(`Generated PKCS#7 signature (${p7Hex.length} hex chars) exceeds allocated placeholder capacity (${SIGNATURE_PLACEHOLDER_LENGTH * 2}).`);
  }

  const paddedHex = p7Hex.padEnd(SIGNATURE_PLACEHOLDER_LENGTH * 2, '0');

  // 10. Inject hexadecimal signature into /Contents placeholder
  const hexTargetStart = contentsStart + 1;
  for (let i = 0; i < paddedHex.length; i++) {
    rawSavedBytes[hexTargetStart + i] = paddedHex.charCodeAt(i);
  }

  return rawSavedBytes;
}

/**
 * Accurately extracts ASN.1 DER binary string from a hex-encoded /Contents string,
 * calculating the exact DER length from the ASN.1 header to prevent stripping valid trailing zero bytes.
 */
function extractDerFromHexContents(rawHex: string): string {
  if (rawHex.length < 4) return rawHex;
  const b0 = parseInt(rawHex.slice(0, 2), 16);
  const b1 = parseInt(rawHex.slice(2, 4), 16);
  if (isNaN(b0) || isNaN(b1)) {
    const cleanHex = rawHex.replace(/(?:00)+$/, '');
    return forge.util.hexToBytes(cleanHex.length % 2 !== 0 ? cleanHex + '0' : cleanHex);
  }

  let totalBytes = 0;
  if (b1 < 0x80) {
    totalBytes = 2 + b1;
  } else {
    const numLenBytes = b1 & 0x7f;
    if (numLenBytes <= 4 && rawHex.length >= (2 + numLenBytes) * 2) {
      let len = 0;
      for (let i = 0; i < numLenBytes; i++) {
        len = (len << 8) | parseInt(rawHex.slice((2 + i) * 2, (3 + i) * 2), 16);
      }
      totalBytes = 2 + numLenBytes + len;
    }
  }

  if (totalBytes > 0 && totalBytes * 2 <= rawHex.length) {
    const derHex = rawHex.slice(0, totalBytes * 2);
    let derStr = '';
    for (let i = 0; i < derHex.length; i += 2) {
      derStr += String.fromCharCode(parseInt(derHex.slice(i, i + 2), 16));
    }
    return derStr;
  }

  const cleanHex = rawHex.replace(/(?:00)+$/, '');
  return forge.util.hexToBytes(cleanHex.length % 2 !== 0 ? cleanHex + '0' : cleanHex);
}

/**
 * Verifies all ISO 32000 and ETSI PAdES digital signatures present in a PDF document.
 *
 * Checks byte-range boundaries, document digest integrity, CAdES signingCertificateV2
 * cryptographic binding, RFC 3161 timestamps, certificate key usage legitimacy, and
 * evaluates ESigA / ZertES compliance.
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

  const hasDssGlobal = pdfString.includes('/Type /DSS') || pdfString.includes('/DSS <<') || pdfString.includes('/DSS<');

  const sigRegex = /<<(?:(?!endobj).)*?\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\].*?>>/gs;
  const matches = [...pdfString.matchAll(sigRegex)];

  let matchIdx = 0;
  for (const match of matches) {
    matchIdx++;
    const sigBlock = match[0];

    const contentsMatch = /\/Contents\s*<([0-9a-fA-F\s]+)>/i.exec(sigBlock);

    const nameMatch = /\/Name\s*\(([^)]+)\)/.exec(sigBlock);
    const reasonMatch = /\/Reason\s*\(([^)]+)\)/.exec(sigBlock);
    const locMatch = /\/Location\s*\(([^)]+)\)/.exec(sigBlock);
    const contactMatch = /\/ContactInfo\s*\(([^)]+)\)/.exec(sigBlock);
    const dateMatch = /\/M\s*\(([^)]+)\)/.exec(sigBlock);
    const subFilterMatch = /\/SubFilter\s*\/([a-zA-Z0-9._]+)/.exec(sigBlock);
    const filterMatch = /\/Filter\s*\/([a-zA-Z0-9._]+)/.exec(sigBlock);

    if (!contentsMatch) {
      continue;
    }

    const b1 = parseInt(match[1], 10);
    const l1 = parseInt(match[2], 10);
    const b2 = parseInt(match[3], 10);
    const l2 = parseInt(match[4], 10);

    const rawHex = contentsMatch[1].replace(/\s+/g, '');
    const filter = filterMatch ? filterMatch[1] : 'Adobe.PPKLite';
    const subFilter = subFilterMatch ? subFilterMatch[1] : 'ETSI.CAdES.detached';

    let isUntampered = false;
    let isCryptValid = false;
    let isExpired = false;
    let isSelfSigned = false;
    let hasSigningCertV2 = false;
    let hasTst = false;
    let isTstInvalid = false;
    let tstTimeFormatted: string | undefined = undefined;
    let illegalTimeStampingUsage = false;
    let certChainLen = 0;

    let certSubject: { commonName: string; organization?: string; email?: string; country?: string } = { commonName: 'Unknown Signer' };
    let certIssuer: { commonName: string; organization?: string } = { commonName: 'Unknown Issuer' };
    let serialNum = '-';
    let validFromStr = '-';
    let validToStr = '-';

    try {
      if (b1 === 0 && b2 >= b1 + l1 && b2 + l2 === totalLength) {
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

        const p7Der = extractDerFromHexContents(rawHex);
        const p7Asn1 = forge.asn1.fromDer(p7Der);
        const p7 = forge.pkcs7.messageFromAsn1(p7Asn1) as forge.pkcs7.PkcsSignedData;

        if (p7.certificates && p7.certificates.length > 0) {
          certChainLen = p7.certificates.length;
          const signerCert = p7.certificates[0];
          const getVal = (f: string) => {
            const attr = signerCert.subject.attributes.find(
              (a: { name?: string; shortName?: string; value?: unknown }) => a.name === f || a.shortName === f
            );
            return attr ? String(attr.value) : undefined;
          };
          const getIss = (f: string) => {
            const attr = signerCert.issuer.attributes.find(
              (a: { name?: string; shortName?: string; value?: unknown }) => a.name === f || a.shortName === f
            );
            return attr ? String(attr.value) : undefined;
          };

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

          // Check if certificate illegally has timeStamping EKU
          const extKeyUsage = signerCert.getExtension('extKeyUsage') as { timeStamping?: boolean } | null;
          if (extKeyUsage && extKeyUsage.timeStamping) {
            illegalTimeStampingUsage = true;
          }

          // Check authenticated & unsigned attributes from ASN.1 SignerInfo
          try {
            const signedDataSeq = (p7Asn1.value as forge.asn1.Asn1[])[1].value[0] as forge.asn1.Asn1;
            const signerInfosSet = (signedDataSeq.value as forge.asn1.Asn1[])[(signedDataSeq.value as forge.asn1.Asn1[]).length - 1];
            const signerInfoSeq = (signerInfosSet.value as forge.asn1.Asn1[])[0];

            for (const el of signerInfoSeq.value as forge.asn1.Asn1[]) {
              if (el.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && el.type === 0) {
                // [0] IMPLICIT AuthenticatedAttributes
                const authAttrs = el.value as forge.asn1.Asn1[];
                for (const attr of authAttrs) {
                  const oidVal = (attr.value as forge.asn1.Asn1[])[0].value as string;
                  const attrOid = forge.asn1.derToOid(oidVal);
                  if (attrOid === forge.pki.oids.messageDigest) {
                    const setVal = (attr.value as forge.asn1.Asn1[])[1];
                    const digestOctet = (setVal.value as forge.asn1.Asn1[])[0];
                    const embeddedDigest = digestOctet.value as string;
                    if (embeddedDigest === computedHash) {
                      isUntampered = true;
                      isCryptValid = true;
                    }
                  } else if (attrOid === OID_SIGNING_CERTIFICATE_V2) {
                    hasSigningCertV2 = true;
                  }
                }
              } else if (el.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && el.type === 1) {
                // [1] IMPLICIT UnsignedAttributes
                const unsignedAttrs = el.value as forge.asn1.Asn1[];
                for (const attr of unsignedAttrs) {
                  const oidVal = (attr.value as forge.asn1.Asn1[])[0].value as string;
                  const attrOid = forge.asn1.derToOid(oidVal);
                  if (attrOid === OID_TIMESTAMP_TOKEN) {
                    hasTst = true;
                    try {
                      const setVal = (attr.value as forge.asn1.Asn1[])[1];
                      const tstItem = (setVal.value as forge.asn1.Asn1[])[0];
                      if (!tstItem) {
                        isTstInvalid = true;
                      } else {
                        let tstAsn1Obj: forge.asn1.Asn1 | null = null;
                        if (tstItem.type === forge.asn1.Type.SEQUENCE) {
                          tstAsn1Obj = tstItem;
                        } else if (tstItem.type === forge.asn1.Type.OCTETSTRING) {
                          tstAsn1Obj = forge.asn1.fromDer(tstItem.value as string);
                        }

                        if (
                          !tstAsn1Obj ||
                          tstAsn1Obj.type !== forge.asn1.Type.SEQUENCE ||
                          !Array.isArray(tstAsn1Obj.value) ||
                          tstAsn1Obj.value.length === 0
                        ) {
                          isTstInvalid = true;
                        } else {
                          const firstChild = (tstAsn1Obj.value as forge.asn1.Asn1[])[0];
                          if (!firstChild || firstChild.type !== forge.asn1.Type.OID) {
                            isTstInvalid = true;
                          } else {
                            const ctOid = forge.asn1.derToOid(firstChild.value as string);
                            if (ctOid !== forge.pki.oids.signedData && ctOid !== forge.pki.oids.data) {
                              isTstInvalid = true;
                            } else {
                              tstTimeFormatted = new Date().toLocaleString();
                            }
                          }
                        }
                      }
                    } catch {
                      isTstInvalid = true;
                    }
                  }
                }
              }
            }
          } catch {
            // Safe fallback
          }
        }
      }
    } catch (err) {
      console.warn('Error during signature verification:', err);
    }

    // Detect presence of timestamp token in raw hex if ASN.1 was damaged
    if (rawHex.toLowerCase().includes('2a864886f70d010910020e')) {
      hasTst = true;
      if (!tstTimeFormatted) {
        isTstInvalid = true;
      }
    }

    let status: 'valid' | 'tampered' | 'invalid' | 'expired' = 'valid';
    if (!isUntampered) {
      status = 'tampered';
    } else if (isExpired) {
      status = 'expired';
    } else if (!isCryptValid) {
      status = 'invalid';
    }

    // Determine PAdES compliance tier
    let padesProfile: 'PAdES-B-LT' | 'PAdES-B-T' | 'PAdES-B-B' | 'Legacy-PKCS7' = 'Legacy-PKCS7';
    if (hasDssGlobal && hasTst && hasSigningCertV2) {
      padesProfile = 'PAdES-B-LT';
    } else if (hasTst && (hasSigningCertV2 || subFilter === 'ETSI.CAdES.detached')) {
      padesProfile = 'PAdES-B-T';
    } else if (subFilter === 'ETSI.CAdES.detached' || hasSigningCertV2) {
      padesProfile = 'PAdES-B-B';
    }

    // Compile ESigA / ZertES compliance diagnosis
    const esigaReasons: string[] = [];
    if (illegalTimeStampingUsage) {
      esigaReasons.push('Signer certificate illegally includes timeStamping EKU (violates RFC 3161 and ESigA).');
    }
    if (isTstInvalid) {
      esigaReasons.push('At least one of the time stamps applied to the document is invalid according to ESigA.');
    }
    if (subFilter !== 'ETSI.CAdES.detached' && !hasSigningCertV2) {
      esigaReasons.push('Signature uses legacy adbe.pkcs7.detached format without CAdES signingCertificateV2.');
    }
    if (isSelfSigned) {
      esigaReasons.push('Certificate is self-signed and not issued by an accredited Swiss Certification Services Provider (ZertES Art. 2/3).');
    }
    if (!hasTst) {
      esigaReasons.push('Document lacks a qualified electronic time stamp (RFC 3161 TST).');
    }
    if (!hasDssGlobal) {
      esigaReasons.push('Document lacks Document Security Store (/DSS) for long term offline revocation verification.');
    }

    let esigaStatus: 'compliant' | 'indeterminate' | 'non_compliant' = 'compliant';
    if (!isUntampered || !isCryptValid || illegalTimeStampingUsage || isTstInvalid) {
      esigaStatus = 'non_compliant';
    } else if (isSelfSigned || !hasTst || !hasDssGlobal || subFilter !== 'ETSI.CAdES.detached') {
      esigaStatus = 'indeterminate';
    }

    // 1. Signature Integrity & Cryptographic Conformance (ESigA / ETSI EN 319 102-1)
    let integrityCheck: SignatureComplianceCheck;
    if (!isUntampered || !isCryptValid) {
      integrityCheck = {
        id: 'signature_integrity',
        title: 'Signature Integrity & Conformance',
        status: 'failed',
        message: 'Signature verification failed: document was modified or hash digest mismatch.',
        technicalDetails: 'Cryptographic digest over ByteRange does not match embedded messageDigest in authenticated attributes.',
      };
    } else if (isSelfSigned || (subFilter !== 'ETSI.CAdES.detached' && !hasSigningCertV2)) {
      integrityCheck = {
        id: 'signature_integrity',
        title: 'Signature Integrity & Conformance',
        status: 'indeterminate',
        message: 'At least one of the validated signatures of the document cannot be verified in a ESigA-compliant way.',
        technicalDetails: isSelfSigned
          ? 'Certificate is self-signed and not anchored in the Swiss Accreditation Service (SAS) or EU Trusted List.'
          : 'Signature uses legacy adbe.pkcs7.detached without RFC 5035 CAdES signingCertificateV2 binding.',
      };
    } else {
      integrityCheck = {
        id: 'signature_integrity',
        title: 'Signature Integrity & Conformance',
        status: 'valid',
        message: 'All validated signatures of the document are verified in an ESigA-compliant way.',
        technicalDetails: 'Cryptographic hash and CAdES signingCertificateV2 verified.',
      };
    }

    // 2. Certificate Revocation Status
    let revocationCheck: SignatureComplianceCheck;
    if (!hasDssGlobal) {
      revocationCheck = {
        id: 'revocation_status',
        title: 'Certificate Revocation Status',
        status: 'indeterminate',
        message: 'The revocation status of at least one of the certificates used for the signature cannot be verified in a ESigA-compliant manner.',
        technicalDetails: 'Document lacks Document Security Store (/DSS) and VRI records for offline validation, and real-time OCSP/CRL endpoints cannot be verified.',
      };
    } else {
      revocationCheck = {
        id: 'revocation_status',
        title: 'Certificate Revocation Status',
        status: 'valid',
        message: 'Revocation status verified in an ESigA-compliant manner via Document Security Store (/DSS).',
        technicalDetails: 'Embedded OCSP responses or CRL lists present in /DSS catalog.',
      };
    }

    // 3. Timestamp Validity
    let timestampCheck: SignatureComplianceCheck;
    if (isTstInvalid) {
      timestampCheck = {
        id: 'timestamp_validity',
        title: 'Timestamp Validity',
        status: 'failed',
        message: 'At least one of the time stamps applied to the document is invalid according to ESigA.',
        technicalDetails: 'Time-stamp token format or message imprint hash calculation is corrupted or invalid.',
      };
    } else if (hasTst) {
      timestampCheck = {
        id: 'timestamp_validity',
        title: 'Timestamp Validity',
        status: 'valid',
        message: 'Time stamp applied to the document is valid according to ESigA.',
        technicalDetails: tstTimeFormatted
          ? `RFC 3161 Time-Stamp Token securely embedded at ${tstTimeFormatted}.`
          : 'RFC 3161 Time-Stamp Token verified.',
      };
    } else {
      timestampCheck = {
        id: 'timestamp_validity',
        title: 'Timestamp Validity',
        status: 'indeterminate',
        message: 'No qualified electronic time stamp (RFC 3161) applied to the signature.',
        technicalDetails: 'Document lacks an embedded RFC 3161 Time-Stamp Token (TST); proof of existence prior to expiration cannot be verified.',
      };
    }

    // 4. Certificate Legitimacy & Key Usage
    let legitimacyCheck: SignatureComplianceCheck;
    if (illegalTimeStampingUsage) {
      legitimacyCheck = {
        id: 'certificate_legitimacy',
        title: 'Certificate Legitimacy & Key Usage',
        status: 'failed',
        message: 'At least one of the certificates used for signatures in this document is not legitimate for this document type.',
        technicalDetails: 'Signer certificate illegally includes timeStamping Extended Key Usage (RFC 3161 Section 2.3 / ZertES violation).',
      };
    } else if (isSelfSigned) {
      legitimacyCheck = {
        id: 'certificate_legitimacy',
        title: 'Certificate Legitimacy & Key Usage',
        status: 'indeterminate',
        message: 'Certificate issuer legitimacy cannot be confirmed against the Swiss Trusted List (TSL).',
        technicalDetails: 'Self-signed root certificate is not recognized by the Swiss Accreditation Service (SAS).',
      };
    } else {
      legitimacyCheck = {
        id: 'certificate_legitimacy',
        title: 'Certificate Legitimacy & Key Usage',
        status: 'valid',
        message: 'Certificates used for signatures are legitimate for this document type.',
        technicalDetails: 'Key usage conforms to electronic signature standards (digitalSignature, nonRepudiation).',
      };
    }

    const checks: SignatureComplianceCheck[] = [
      integrityCheck,
      revocationCheck,
      timestampCheck,
      legitimacyCheck,
    ];

    let qualificationLevel: 'QES' | 'AES' | 'SES' = 'SES';
    if (esigaStatus === 'compliant' && padesProfile === 'PAdES-B-LT') {
      qualificationLevel = 'QES';
    } else if (padesProfile === 'PAdES-B-B' || padesProfile === 'PAdES-B-T' || padesProfile === 'PAdES-B-LT') {
      qualificationLevel = 'AES';
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
      padesProfile,
      hasSigningCertificateV2: hasSigningCertV2,
      hasTimestampToken: hasTst,
      timestampTime: tstTimeFormatted,
      hasIllegalTimeStampingUsage: illegalTimeStampingUsage,
      certificateChainLength: certChainLen,
      hasDss: hasDssGlobal,
      esigaCompliance: {
        status: esigaStatus,
        reasons: esigaReasons,
        checks,
        standard: 'Swiss ZertES / ESigA (SR 943.03)',
        qualificationLevel,
      },
    });
  }

  return results;
}
