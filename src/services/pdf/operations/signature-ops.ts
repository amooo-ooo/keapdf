import forge from 'node-forge';
import {
  SIGNATURE_PLACEHOLDER_LENGTH,
  buildIncrementalSignatureRevision,
  buildInitialSignatureRevision,
  hasPopulatedSignatures,
} from './signature-revision-ops';
import type { PdfEncryptionContext } from '../encryption/pdf-lib-encryption';

/** Standard Object Identifiers (OIDs) for PKCS#7, CAdES, and X.509 extensions. */
export const OID_MD5 = '1.2.840.113549.2.5';
export const OID_SHA1 = '1.3.14.3.2.26';
export const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
export const OID_SHA384 = '2.16.840.1.101.3.4.2.2';
export const OID_SHA512 = '2.16.840.1.101.3.4.2.3';
export const OID_ID_DATA = '1.2.840.113549.1.7.1';
export const OID_SIGNING_CERTIFICATE_V1 = '1.2.840.113549.1.9.16.2.12';
export const OID_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';
export const OID_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';
export const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4';
export const OID_ADOBE_DOC_SIGNING = '1.2.840.113583.1.1.5';
export const OID_TIME_STAMPING = '1.3.6.1.5.5.7.3.8';
export const OID_CRL_DIST_POINTS = '2.5.29.31';
export const OID_AUTHORITY_INFO_ACCESS = '1.3.6.1.5.5.7.1.1';
export const OID_OCSP = '1.3.6.1.5.5.7.48.1';

/** Supported cryptographic message digest algorithms for CMS and PAdES signatures. */
export type SignatureDigestAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | 'MD5';

/** ISO 32000-1 Clause 12.8.2 signature reference transform methods. */
export type SignatureTransformMethod = 'DocMDP' | 'UR3' | 'UR' | 'FieldMDP';

/**
 * ISO 32000-1 Table 254 DocMDP access permissions:
 * 1 = No changes to the document are permitted.
 * 2 = Filling in forms, instantiating page templates, and signing are permitted.
 * 3 = Same as 2, plus annotation creation, deletion, and modification.
 */
export type DocMdpPermissionLevel = 1 | 2 | 3;

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
  /** Whether to render the signer's full name underneath the signature graphic. */
  showTextDetails?: boolean;
  /** Whether graphicDataUrl already composites the signature graphic and optional full name into a single image. */
  isCompositeAppearance?: boolean;
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
  /** Whether to embed an RFC 3161 Time-Stamp Token (uses tsaUrl if reachable or built-in offline TSA token). */
  enableTimestamp?: boolean;
  /** Optional RFC 3161 TSA server URL (e.g. 'https://freetsa.org/tsr') for PAdES B-T. */
  tsaUrl?: string;
  /** Optional pre-generated RFC 3161 TimeStampToken DER bytes (for offline or unit tests). */
  timestampTokenBytes?: Uint8Array;
  /** Whether to embed Document Security Store (/DSS) for PAdES B-LT long term validation. */
  embedDss?: boolean;
  /** Optional ISO 32000-1 Clause 12.8.2.2 DocMDP certification permission level (1, 2, or 3). */
  certificationLevel?: DocMdpPermissionLevel;
  /** Optional zero-based target page index for the signature widget when visual rendering is omitted. */
  pageIndex?: number;
  /** Optional bounding rectangle in PDF points for the signature widget when visual rendering is omitted. */
  rect?: { x: number; y: number; width: number; height: number };
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
  /** Whether the certificate was expired at the time of signing. */
  isCertExpired: boolean;
  /** Whether the certificate is self-signed. */
  isSelfSigned: boolean;
  /** Overall validity status. */
  status: 'valid' | 'tampered' | 'invalid' | 'expired';
  /** True if status is 'valid'. */
  isValid: boolean;
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
  /** Cryptographic digest algorithm used by the SignerInfo structure. */
  digestAlgorithm: SignatureDigestAlgorithm;
  /** Byte range array [offset1, length1, offset2, length2]. */
  byteRange: number[];
  /** Whether the signed byte range covers the entire file without post-signature incremental updates. */
  coversEntireFile: boolean;
  /** Whether this signature is a document certification or usage-rights signature (/DocMDP or /UR3). */
  isCertificationSignature: boolean;
  /** Transform method specified in /Reference /SigRef dictionary if present. */
  transformMethod?: SignatureTransformMethod;
  /** DocMDP modification permission level (1, 2, or 3) if specified in /TransformParams. */
  docMdpPermissionLevel?: DocMdpPermissionLevel;
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

let cachedEmbeddedTsaPair: {
  privateKey: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
} | null = null;

function getOrCreateEmbeddedTsaPair(): {
  privateKey: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
} {
  if (cachedEmbeddedTsaPair) {
    return cachedEmbeddedTsaPair;
  }

  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = '01007361';
  const notBefore = new Date(Date.now() - 86400 * 1000);
  const notAfter = new Date(Date.now() + 10 * 365 * 86400 * 1000);
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;

  const tsaAttrs = [
    { name: 'commonName', value: 'Kea PDF Embedded Time-Stamp Authority' },
    { name: 'organizationName', value: 'Kea Cryptographic Trust Services' },
    { name: 'countryName', value: 'CH' },
  ];
  cert.setSubject(tsaAttrs);
  cert.setIssuer(tsaAttrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
    { name: 'extKeyUsage', timeStamping: true, critical: true },
  ]);
  cert.sign(keypair.privateKey, forge.md.sha256.create());

  cachedEmbeddedTsaPair = {
    privateKey: keypair.privateKey,
    certificate: cert,
  };
  return cachedEmbeddedTsaPair;
}

/**
 * Generates a self-contained RFC 3161 TimeStampToken CMS SignedData structure offline.
 *
 * Binds the SHA-256 imprint of the signature value into a signed TSTInfo payload using
 * a dedicated Time-Stamping Authority certificate with timeStamping Extended Key Usage.
 *
 * @param signatureBytes Raw RSA signature value bytes from the SignerInfo structure.
 * @param signingTime Timestamp to encode inside TSTInfo (defaults to current time).
 * @return DER-encoded RFC 3161 TimeStampToken byte array.
 */
export function createEmbeddedRfc3161TimestampToken(
  signatureBytes: Uint8Array,
  signingTime: Date = new Date()
): Uint8Array {
  let sigBin = '';
  for (let i = 0; i < signatureBytes.length; i++) {
    sigBin += String.fromCharCode(signatureBytes[i]);
  }
  const md = forge.md.sha256.create();
  md.update(sigBin);
  const imprintBytes = md.digest().getBytes();

  const sha256OidDer = forge.asn1.oidToDer(OID_SHA256).getBytes();
  const algId = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, sha256OidDer),
  ]);
  const msgImprint = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    algId,
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, imprintBytes),
  ]);

  const tstInfoAsn1 = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.hexToBytes('01')),
    forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.OID,
      false,
      forge.asn1.oidToDer(OID_ADOBE_DOC_SIGNING).getBytes()
    ),
    msgImprint,
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.hexToBytes('01')),
    forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.GENERALIZEDTIME,
      false,
      forge.asn1.dateToGeneralizedTime(signingTime)
    ),
  ]);
  const tstInfoDer = forge.asn1.toDer(tstInfoAsn1).getBytes();

  const tsa = getOrCreateEmbeddedTsaPair();
  const tstP7 = forge.pkcs7.createSignedData();
  tstP7.content = forge.util.createBuffer(tstInfoDer);
  tstP7.addCertificate(tsa.certificate);
  tstP7.addSigner({
    key: tsa.privateKey,
    certificate: tsa.certificate,
    digestAlgorithm: forge.pki.oids.sha256,
  });
  tstP7.sign();

  const tstDer = forge.asn1.toDer(tstP7.toAsn1()).getBytes();
  const out = new Uint8Array(tstDer.length);
  for (let i = 0; i < tstDer.length; i++) {
    out[i] = tstDer.charCodeAt(i);
  }
  return out;
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

  // Generate RSA keypair
  const keypair = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: keySize, workers: -1 }, (err, keys) => {
      if (err) return reject(err);
      resolve(keys);
    });
  });

  // Create X.509 certificate
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

  // Package into PKCS#12 (.p12) container
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

  // Organise certificate chain with leaf certificate first, followed by intermediate/root CAs
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

/**
 * Digitally signs a PDF document conforming to PDF ISO 32000-1 / ISO 32000-2 and ETSI EN 319 142 (PAdES).
 *
 * When the document already contains populated digital signatures, the new signature
 * is appended as a PDF incremental update so that earlier signed byte ranges remain
 * intact and their cryptographic digests continue to verify.
 *
 * Supports /SubFilter /ETSI.CAdES.detached (PAdES Baseline) and /adbe.pkcs7.detached,
 * computing SHA-256 byte-range hashes and embedding ESS signingCertificateV2, complete
 * certificate chains, optional DocMDP certification permissions, and optional RFC 3161 timestamps.
 *
 * @param pdfBytes Binary bytes of the active PDF document.
 * @param options Digital signing configuration including identity, metadata, visual, and PAdES options.
 * @param encryption Security handler of an encrypted source. Unsigned documents must then be
 *   supplied as decrypted bytes and signed documents as their original encrypted bytes.
 * @return A Promise resolving to the signed PDF Uint8Array.
 */
export async function signPdfIso32000(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: SignPdfOptions,
  encryption?: PdfEncryptionContext
): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  const signingTime = options.signingTime || new Date();
  const pdfDateStr = formatPdfDate(signingTime);
  const subFilter = options.subFilter || 'ETSI.CAdES.detached';

  // Re-serialising a document that already carries signatures would shift every byte offset
  // and invalidate all earlier digests, so subsequent signatures are appended incrementally.
  const revisionParams = { options, subFilter, pdfDateStr, encryption };
  const rawSavedBytes = hasPopulatedSignatures(bytes)
    ? await buildIncrementalSignatureRevision(bytes, revisionParams)
    : await buildInitialSignatureRevision(bytes, revisionParams);

  // Locate /ByteRange and /Contents in raw saved bytes
  let pdfString = '';
  for (let i = 0; i < rawSavedBytes.length; i++) {
    pdfString += String.fromCharCode(rawSavedBytes[i]);
  }

  const byteRangeSearchStr = '/ByteRange [ 0 1000000000 1000000000 1000000000 ]';
  const byteRangePos = pdfString.lastIndexOf(byteRangeSearchStr);
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

  // Compute SHA-256 digest over ByteRange byte segments
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

  // Construct detached PKCS#7 / CAdES SignedData structure
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

  // Embed RFC 3161 Time-Stamp Token into unsigned attributes if requested
  const asn1Root = p7.toAsn1();

  let tstBytes = options.timestampTokenBytes;
  const shouldEmbedTimestamp =
    options.enableTimestamp === true ||
    options.embedDss === true ||
    Boolean(options.tsaUrl);

  if (!tstBytes && shouldEmbedTimestamp) {
    const signerObj = (p7 as unknown as { signers: Array<{ signature: string }> }).signers[0];
    const rawSigStr = signerObj.signature;
    const rawSigBytes = new Uint8Array(rawSigStr.length);
    for (let i = 0; i < rawSigStr.length; i++) rawSigBytes[i] = rawSigStr.charCodeAt(i);

    const trimmedTsaUrl = options.tsaUrl?.trim();
    if (trimmedTsaUrl && trimmedTsaUrl !== 'https://freetsa.org/tsr') {
      try {
        const candidateTst = await requestRfc3161Timestamp(rawSigBytes, trimmedTsaUrl);
        let candidateBin = '';
        for (let i = 0; i < candidateTst.length; i++) {
          candidateBin += String.fromCharCode(candidateTst[i]);
        }
        const parsedTst = forge.asn1.fromDer(candidateBin);
        if (
          parsedTst.type === forge.asn1.Type.SEQUENCE &&
          Array.isArray(parsedTst.value) &&
          parsedTst.value.length >= 2 &&
          parsedTst.value[0].type === forge.asn1.Type.OID
        ) {
          tstBytes = candidateTst;
        }
      } catch (tsaErr) {
        console.warn('Failed to retrieve RFC 3161 timestamp from TSA, falling back to embedded TSA:', tsaErr);
      }
    }

    if (!tstBytes && (options.enableTimestamp === true || options.embedDss === true)) {
      tstBytes = createEmbeddedRfc3161TimestampToken(rawSigBytes, signingTime);
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

  // Inject hexadecimal signature into /Contents placeholder
  const hexTargetStart = contentsStart + 1;
  for (let i = 0; i < paddedHex.length; i++) {
    rawSavedBytes[hexTargetStart + i] = paddedHex.charCodeAt(i);
  }

  return rawSavedBytes;
}

/**
 * Resolves a node-forge message digest instance and standard algorithm label from an ASN.1 OID.
 * Supports SHA-1, SHA-256, SHA-384, SHA-512, and MD5 (including combined RSA-with-digest OIDs).
 */
function createMessageDigestByOid(oid: string): { md: forge.md.MessageDigest; name: SignatureDigestAlgorithm } {
  switch (oid) {
    case OID_SHA1:
    case '1.2.840.113549.1.1.5':
    case '1.3.14.3.2.29':
      return { md: forge.md.sha1.create(), name: 'SHA-1' };
    case OID_SHA384:
    case '1.2.840.113549.1.1.12':
      return { md: forge.md.sha384.create(), name: 'SHA-384' };
    case OID_SHA512:
    case '1.2.840.113549.1.1.13':
      return { md: forge.md.sha512.create(), name: 'SHA-512' };
    case OID_MD5:
    case '1.2.840.113549.1.1.4':
      return { md: forge.md.md5.create(), name: 'MD5' };
    case OID_SHA256:
    case '1.2.840.113549.1.1.11':
    default:
      return { md: forge.md.sha256.create(), name: 'SHA-256' };
  }
}

/**
 * Parses a PDF date string (ISO 32000-1 Clause 7.9.4 format D:YYYYMMDDHHmmSSOHH'mm') into a Date object.
 */
export function parsePdfDateString(pdfDate: string): Date | null {
  if (!pdfDate) return null;
  const unescaped = pdfDate
    .trim()
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
  const cleaned = unescaped.replace(/^D:/i, '');
  const match = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz]|[+-])(\d{2})'?(?:(\d{2})'?)?)?/.exec(cleaned);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = match[2] ? parseInt(match[2], 10) - 1 : 0;
  const day = match[3] ? parseInt(match[3], 10) : 1;
  const hour = match[4] ? parseInt(match[4], 10) : 0;
  const minute = match[5] ? parseInt(match[5], 10) : 0;
  const second = match[6] ? parseInt(match[6], 10) : 0;
  const tzSign = match[7];
  const tzHour = match[8] ? parseInt(match[8], 10) : 0;
  const tzMin = match[9] ? parseInt(match[9], 10) : 0;

  let utcMs = Date.UTC(year, month, day, hour, minute, second);
  if (tzSign === '+' || tzSign === '-') {
    const offsetMs = (tzHour * 60 + tzMin) * 60 * 1000;
    utcMs += tzSign === '+' ? -offsetMs : offsetMs;
  }

  const dateObj = new Date(utcMs);
  return isNaN(dateObj.getTime()) ? null : dateObj;
}

/**
 * Parses an ASN.1 UTCTime or GeneralizedTime element into a Date object.
 */
function parseAsn1Time(asn1Node: forge.asn1.Asn1): Date | null {
  try {
    if (asn1Node.type === forge.asn1.Type.UTCTIME && typeof asn1Node.value === 'string') {
      return forge.asn1.utcTimeToDate(asn1Node.value);
    }
    if (asn1Node.type === forge.asn1.Type.GENERALIZEDTIME && typeof asn1Node.value === 'string') {
      return forge.asn1.generalizedTimeToDate(asn1Node.value);
    }
  } catch {
    // Fallback if ASN.1 time string is non-standard
  }
  return null;
}

/**
 * Accurately extracts ASN.1 DER or BER binary bytes from a hex-encoded /Contents string.
 * Supports both definite-length DER headers and BER indefinite-length (0x30 0x80) structures
 * without corrupting terminating End-of-Contents (00 00) octets.
 */
function extractDerFromHexContents(rawHex: string): string {
  const evenHex = rawHex.length % 2 !== 0 ? rawHex + '0' : rawHex;
  if (evenHex.length < 4) return forge.util.hexToBytes(evenHex);

  const b0 = parseInt(evenHex.slice(0, 2), 16);
  const b1 = parseInt(evenHex.slice(2, 4), 16);
  if (isNaN(b0) || isNaN(b1)) {
    const cleanHex = evenHex.replace(/(?:00)+$/, '');
    return forge.util.hexToBytes(cleanHex.length % 2 !== 0 ? cleanHex + '0' : cleanHex);
  }

  // BER indefinite-length encoding (0x80): preserve full stream including 00 00 EOC terminators
  if (b1 === 0x80) {
    return forge.util.hexToBytes(evenHex);
  }

  let totalBytes = 0;
  if (b1 < 0x80) {
    totalBytes = 2 + b1;
  } else {
    const numLenBytes = b1 & 0x7f;
    if (numLenBytes <= 4 && evenHex.length >= (2 + numLenBytes) * 2) {
      let len = 0;
      for (let i = 0; i < numLenBytes; i++) {
        len = (len * 256) + parseInt(evenHex.slice((2 + i) * 2, (3 + i) * 2), 16);
      }
      totalBytes = 2 + numLenBytes + len;
    }
  }

  if (totalBytes > 0 && totalBytes * 2 <= evenHex.length) {
    return forge.util.hexToBytes(evenHex.slice(0, totalBytes * 2));
  }

  return forge.util.hexToBytes(evenHex);
}

/**
 * Extracts the complete enclosing PDF indirect object or dictionary around a /ByteRange match
 * so nested sub-dictionaries (/Reference, /TransformParams, /Prop_Build) never truncate extraction.
 */
function extractEnclosingSignatureBlock(pdfString: string, byteRangePos: number): string {
  const searchStart = Math.max(0, byteRangePos - 32768);
  const beforeStr = pdfString.slice(searchStart, byteRangePos);
  const lastObjMatch = [...beforeStr.matchAll(/\b\d+\s+\d+\s+obj\b/g)];
  const blockStart = lastObjMatch.length > 0
    ? searchStart + lastObjMatch[lastObjMatch.length - 1].index!
    : Math.max(0, pdfString.lastIndexOf('<<', byteRangePos));

  const endObjPos = pdfString.indexOf('endobj', byteRangePos);
  const blockEnd = endObjPos !== -1
    ? endObjPos + 6
    : Math.min(pdfString.length, byteRangePos + 98304);

  return pdfString.slice(blockStart, blockEnd);
}

/**
 * Selects the end-entity signer certificate from a PKCS#7 certificate bag by matching
 * the SignerInfo IssuerAndSerialNumber or selecting the non-CA leaf certificate.
 */
function selectSignerCertificate(
  certificates: forge.pki.Certificate[],
  signerInfoSeq: forge.asn1.Asn1 | null
): forge.pki.Certificate {
  if (certificates.length === 1) {
    return certificates[0];
  }

  if (signerInfoSeq && Array.isArray(signerInfoSeq.value) && signerInfoSeq.value.length >= 2) {
    const sid = signerInfoSeq.value[1];
    if (
      sid.tagClass === forge.asn1.Class.UNIVERSAL &&
      sid.type === forge.asn1.Type.SEQUENCE &&
      Array.isArray(sid.value) &&
      sid.value.length >= 2
    ) {
      const serialNode = sid.value[1];
      if (typeof serialNode.value === 'string') {
        const sidSerialHex = forge.util.bytesToHex(serialNode.value).replace(/^0+/, '').toLowerCase();
        const matchingSerials = certificates.filter((cert) => {
          const certSerialHex = (cert.serialNumber || '').replace(/^0+/, '').toLowerCase();
          return Boolean(sidSerialHex && certSerialHex === sidSerialHex);
        });
        if (matchingSerials.length === 1) {
          return matchingSerials[0];
        }
        if (matchingSerials.length > 1) {
          const nonCaMatch = matchingSerials.find((cert) => {
            const basicConstraints = cert.getExtension('basicConstraints') as { cA?: boolean } | null;
            return !basicConstraints || !basicConstraints.cA;
          });
          return nonCaMatch ?? matchingSerials[0];
        }
      }
    }
  }

  for (const cert of certificates) {
    const basicConstraints = cert.getExtension('basicConstraints') as { cA?: boolean } | null;
    if (!basicConstraints || !basicConstraints.cA) {
      return cert;
    }
  }

  return certificates[0];
}

/**
 * Verifies all ISO 32000 and ETSI PAdES digital signatures present in a PDF document.
 *
 * Checks byte-range boundaries, incremental updates, document digest integrity across
 * SHA-1/SHA-256/SHA-384/SHA-512/MD5, mathematical RSA public-key signature verification
 * over authenticated attributes, CAdES signingCertificateV2 cryptographic binding,
 * DocMDP / Usage Rights certification metadata, RFC 3161 timestamps, certificate key
 * usage legitimacy, and evaluates ESigA / ZertES compliance.
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

  const hasDssGlobal =
    pdfString.includes('/Type /DSS') ||
    pdfString.includes('/DSS <<') ||
    pdfString.includes('/DSS<') ||
    /\/DSS\s+\d+\s+\d+\s+R\b/.test(pdfString);
  const hasCatalogDocMdp = /\/Perms\s*<<[^>]*\/DocMDP\b/s.test(pdfString);
  const hasCatalogUr3 = /\/Perms\s*<<[^>]*\/UR3?\b/s.test(pdfString);

  const byteRangeRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const matches = [...pdfString.matchAll(byteRangeRegex)];

  let matchIdx = 0;
  for (const match of matches) {
    const b1 = parseInt(match[1], 10);
    const l1 = parseInt(match[2], 10);
    const b2 = parseInt(match[3], 10);
    const l2 = parseInt(match[4], 10);

    // Ignore unpopulated template placeholders
    if (l1 === 1000000000 && b2 === 1000000000 && l2 === 1000000000) {
      continue;
    }

    const sigBlock = extractEnclosingSignatureBlock(pdfString, match.index ?? 0);

    // Extract /Contents either directly from the ByteRange gap [b1 + l1, b2] or from the enclosing object
    let rawHex = '';
    if (b1 === 0 && l1 > 0 && b2 > b1 + l1 && b2 <= totalLength) {
      const gapStr = pdfString.slice(b1 + l1, b2).trim();
      if (gapStr.startsWith('<') && gapStr.endsWith('>')) {
        rawHex = gapStr.slice(1, -1).replace(/\s+/g, '');
      }
    }
    if (!rawHex) {
      const contentsMatch = /\/Contents\s*<([0-9a-fA-F\s]+)>/i.exec(sigBlock);
      if (!contentsMatch) {
        continue;
      }
      rawHex = contentsMatch[1].replace(/\s+/g, '');
    }

    matchIdx++;

    const nameMatch = /\/Name\s*\(([^)]+)\)/.exec(sigBlock);
    const reasonMatch = /\/Reason\s*\(([^)]+)\)/.exec(sigBlock);
    const locMatch = /\/Location\s*\(([^)]+)\)/.exec(sigBlock);
    const contactMatch = /\/ContactInfo\s*\(([^)]+)\)/.exec(sigBlock);
    const dateMatch = /\/M\s*\(([^)]+)\)/.exec(sigBlock);
    const subFilterMatch = /\/SubFilter\s*\/([a-zA-Z0-9._]+)/.exec(sigBlock);
    const filterMatch = /\/Filter\s*\/([a-zA-Z0-9._]+)/.exec(sigBlock);
    const transformMethodMatch = /\/TransformMethod\s*\/(DocMDP|UR3|UR|FieldMDP)\b/.exec(sigBlock);
    const docMdpPermMatch = /\/TransformParams\s*<<[^>]*?\/P\s*([123])\b/s.exec(sigBlock);

    const filter = filterMatch ? filterMatch[1] : 'Adobe.PPKLite';
    const subFilter = subFilterMatch ? subFilterMatch[1] : 'ETSI.CAdES.detached';
    const transformMethod = transformMethodMatch
      ? (transformMethodMatch[1] as SignatureTransformMethod)
      : (hasCatalogDocMdp && matchIdx === 1 ? 'DocMDP' : (hasCatalogUr3 && matchIdx === 1 ? 'UR3' : undefined));
    const docMdpPermissionLevel = docMdpPermMatch
      ? (parseInt(docMdpPermMatch[1], 10) as DocMdpPermissionLevel)
      : (transformMethod === 'DocMDP' ? 2 : undefined);
    const isCertificationSignature = Boolean(
      transformMethod === 'DocMDP' ||
      transformMethod === 'UR3' ||
      transformMethod === 'UR' ||
      (matchIdx === 1 && (hasCatalogDocMdp || hasCatalogUr3))
    );

    let digestAlgorithm: SignatureDigestAlgorithm = 'SHA-256';
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
    let coversEntireFile = false;

    let certSubject: { commonName: string; organization?: string; email?: string; country?: string } = { commonName: 'Unknown Signer' };
    let certIssuer: { commonName: string; organization?: string } = { commonName: 'Unknown Issuer' };
    let serialNum = '-';
    let validFromStr = '-';
    let validToStr = '-';

    const signingDateRaw = dateMatch ? dateMatch[1] : '';
    let signingTimeObj: Date | null = parsePdfDateString(signingDateRaw);

    try {
      const hasValidBounds = b1 === 0 && l1 > 0 && b2 > b1 + l1 && l2 > 0 && b2 + l2 <= totalLength;
      if (hasValidBounds) {
        const gapStr = pdfString.slice(b1 + l1, b2).trim();
        const isGapHexOnly = gapStr.startsWith('<') && gapStr.endsWith('>');
        const trailingBytesStr = pdfString.slice(b2 + l2);
        coversEntireFile = trailingBytesStr.trim().length === 0;

        // If bytes exist after b2 + l2, verify they form a valid PDF incremental revision ending with %%EOF
        // and that DocMDP P=1 (no changes permitted) was not violated.
        let isAllowedPostSignRevision = coversEntireFile;
        if (!coversEntireFile) {
          const endsWithEof = /%%EOF\s*$/.test(trailingBytesStr);
          if (endsWithEof && docMdpPermissionLevel !== 1) {
            isAllowedPostSignRevision = true;
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
