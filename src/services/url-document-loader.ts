/**
 * URL Document Loader and Security Sanitization Service.
 *
 * Provides safe query/hash parameter parsing, protocol security verification,
 * PDF magic byte validation, timeout abort handling, and CORS error formatting.
 */

import { resolveDemoPreset } from './demo-documents/registry';
import type { DemoPresetId } from './demo-documents/types';

export type DocumentLoadRequest =
  | { readonly kind: 'preset'; readonly presetId: DemoPresetId }
  | { readonly kind: 'url'; readonly url: string; readonly fileName: string };

export interface UrlSecurityResult {
  readonly isValid: boolean;
  readonly reason?: string;
}

/**
 * Validates the security of a target URL to prevent SSRF, XSS, and local filesystem traversal.
 * Permits only http:, https:, or application-relative URLs.
 */
export function validatePdfUrlSecurity(urlString: string): UrlSecurityResult {
  if (!urlString || typeof urlString !== 'string') {
    return { isValid: false, reason: 'URL string is empty or invalid.' };
  }

  const trimmed = urlString.trim();

  // Allow application-relative paths
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    // Prevent directory escape attacks
    if (trimmed.includes('../..')) {
      return { isValid: false, reason: 'Path traversal sequence is prohibited.' };
    }
    return { isValid: true };
  }

  // Parse as absolute URL
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        isValid: false,
        reason: `Unsupported or dangerous protocol: ${protocol}. Only http: and https: are allowed.`,
      };
    }

    return { isValid: true };
  } catch {
    return { isValid: false, reason: 'Malformed URL structure.' };
  }
}

/**
 * Extracts a clean filename from a URL or fallback name.
 */
export function extractFileNameFromUrl(urlString: string, fallback: string = 'document.pdf'): string {
  try {
    // Relative paths
    if (urlString.startsWith('/') || urlString.startsWith('.')) {
      const parts = urlString.split('?')[0].split('#')[0].split('/');
      const last = parts[parts.length - 1];
      if (last && last.length > 0) {
        return last.toLowerCase().endsWith('.pdf') ? last : `${last}.pdf`;
      }
      return fallback;
    }

    const parsed = new URL(urlString);
    const pathname = parsed.pathname;
    const parts = pathname.split('/');
    const last = parts[parts.length - 1];
    if (last && last.length > 0 && last.toLowerCase().endsWith('.pdf')) {
      return decodeURIComponent(last);
    }
    if (last && last.length > 0) {
      return `${decodeURIComponent(last)}.pdf`;
    }
  } catch {
    // fallback below
  }
  return fallback;
}

/**
 * Parses URL query parameters and hash fragments to detect demo presets or external PDF URLs.
 * Handles ?demo=<id_or_url>, ?url=<url>, ?pdf=<url>, ?file=<url>, and #demo=<id>.
 */
export function parseDocumentLoadRequest(urlOrSearchOrHash: string): DocumentLoadRequest | null {
  if (!urlOrSearchOrHash || typeof urlOrSearchOrHash !== 'string') return null;

  let searchParams: URLSearchParams;
  let rawSearch = '';
  let rawHash = '';

  try {
    if (urlOrSearchOrHash.startsWith('?')) {
      rawSearch = urlOrSearchOrHash.slice(1);
    } else if (urlOrSearchOrHash.startsWith('#')) {
      rawHash = urlOrSearchOrHash.slice(1);
    } else if (urlOrSearchOrHash.includes('?') || urlOrSearchOrHash.includes('#')) {
      const parsed = new URL(urlOrSearchOrHash, 'https://localhost');
      rawSearch = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search;
      rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    } else {
      rawSearch = urlOrSearchOrHash;
    }

    // Attempt decoding search params safely
    searchParams = new URLSearchParams(rawSearch);
  } catch {
    return null;
  }

  // 1. Check `demo` parameter
  const demoParam = searchParams.get('demo') ?? searchParams.get('sample') ?? searchParams.get('template');
  if (demoParam !== null) {
    const trimmed = demoParam.trim();
    if (trimmed.length > 0) {
      // Check if it's an external URL
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const security = validatePdfUrlSecurity(trimmed);
        if (security.isValid) {
          return {
            kind: 'url',
            url: trimmed,
            fileName: extractFileNameFromUrl(trimmed),
          };
        }
      }

      // Check if it's a known preset
      const preset = resolveDemoPreset(trimmed);
      if (preset) {
        return { kind: 'preset', presetId: preset.id };
      }
    }
  }

  // 2. Check `url` parameter
  const urlParam = searchParams.get('url') ?? searchParams.get('pdf') ?? searchParams.get('file');
  if (urlParam !== null) {
    const trimmed = urlParam.trim();
    if (trimmed.length > 0) {
      // Validate safe percent-decoding
      let decodedUrl = trimmed;
      try {
        decodedUrl = decodeURIComponent(trimmed);
      } catch {
        // Malformed URI encoding
        return null;
      }

      const security = validatePdfUrlSecurity(decodedUrl);
      if (security.isValid) {
        return {
          kind: 'url',
          url: decodedUrl,
          fileName: extractFileNameFromUrl(decodedUrl),
        };
      }
    }
  }

  // 3. Fallback to hash fragment parameters (e.g. #demo=vector or #url=https://...)
  if (rawHash.length > 0) {
    try {
      const hashParams = new URLSearchParams(rawHash);
      const hashDemo = hashParams.get('demo');
      if (hashDemo) {
        if (hashDemo.startsWith('http://') || hashDemo.startsWith('https://')) {
          const security = validatePdfUrlSecurity(hashDemo);
          if (security.isValid) {
            return {
              kind: 'url',
              url: hashDemo,
              fileName: extractFileNameFromUrl(hashDemo),
            };
          }
        }
        const preset = resolveDemoPreset(hashDemo);
        if (preset) {
          return { kind: 'preset', presetId: preset.id };
        }
      }

      const hashUrl = hashParams.get('url') ?? hashParams.get('pdf') ?? hashParams.get('file');
      if (hashUrl) {
        let decodedUrl = hashUrl;
        try {
          decodedUrl = decodeURIComponent(hashUrl);
        } catch {
          return null;
        }
        const security = validatePdfUrlSecurity(decodedUrl);
        if (security.isValid) {
          return {
            kind: 'url',
            url: decodedUrl,
            fileName: extractFileNameFromUrl(decodedUrl),
          };
        }
      }
    } catch {
      // Hash parsing error
    }
  }

  return null;
}

/**
 * Verifies that an ArrayBuffer contains a valid PDF header (%PDF-).
 * Per ISO 32000-1 Clause 7.5.2, conforming readers must accept a PDF file
 * if the %PDF- header occurs anywhere within the first 1024 bytes (allowing
 * for UTF-8 byte order marks or leading comments/whitespace).
 */
export function verifyPdfMagicBytes(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 5) return false;
  const view = new Uint8Array(buffer);
  const maxSearch = Math.min(view.byteLength - 4, 1024);

  for (let i = 0; i < maxSearch; i++) {
    if (
      view[i] === 0x25 &&     // %
      view[i + 1] === 0x50 && // P
      view[i + 2] === 0x44 && // D
      view[i + 3] === 0x46 && // F
      view[i + 4] === 0x2d    // -
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Fetches a PDF file from a remote or relative URL with timeout abort support,
 * content verification, and magic byte validation.
 */
export async function fetchPdfFromUrl(
  url: string,
  timeoutMs: number = 15000,
  externalSignal?: AbortSignal,
): Promise<{ buffer: ArrayBuffer; fileName: string }> {
  const security = validatePdfUrlSecurity(url);
  if (!security.isValid) {
    throw new Error(security.reason ?? 'Blocked unsafe URL.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Network timeout: Request exceeded ${timeoutMs / 1000} seconds.`));
  }, timeoutMs);

  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/pdf,application/octet-stream,*/*',
      },
    });

    if (!resp.ok) {
      throw new Error(`HTTP Error ${resp.status}: ${resp.statusText}`);
    }

    const contentType = resp.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) {
      throw new Error('Server returned an HTML document instead of a PDF file.');
    }

    const buffer = await resp.arrayBuffer();

    if (!verifyPdfMagicBytes(buffer)) {
      throw new Error('Invalid binary format: Received file lacks valid %PDF- magic header.');
    }

    const fileName = extractFileNameFromUrl(url);
    return { buffer, fileName };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Produces an informative, user-friendly error message for URL loading failures.
 */
export function formatUrlLoadErrorMessage(err: unknown, url: string): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    // CORS error detection
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('cors')) {
      return `Failed to fetch PDF from "${url}". The remote server does not permit cross-origin requests (CORS). Please download the PDF to your device and open it via "Open PDF File", or use a CORS-enabled mirror.`;
    }

    // Timeout detection
    if (msg.includes('timeout') || msg.includes('aborted')) {
      return `Connection timed out while fetching PDF from "${url}". Please check your internet connection or try again.`;
    }

    // Magic byte / Format detection
    if (msg.includes('magic header') || msg.includes('html document')) {
      return `The resource at "${url}" is not a valid PDF file. Verify that the URL links directly to a .pdf file rather than an HTML web page.`;
    }

    return err.message;
  }

  return `Failed to open document from "${url}".`;
}

/**
 * Updates the browser's address bar with the active demo preset without causing a page reload.
 */
export function syncUrlParameter(presetIdOrUrl: string | null): void {
  if (typeof window === 'undefined') return;

  try {
    const currentUrl = new URL(window.location.href);
    currentUrl.hash = '';
    currentUrl.searchParams.delete('demo');
    currentUrl.searchParams.delete('sample');
    currentUrl.searchParams.delete('template');
    currentUrl.searchParams.delete('url');
    currentUrl.searchParams.delete('pdf');
    currentUrl.searchParams.delete('file');

    if (presetIdOrUrl) {
      if (presetIdOrUrl.startsWith('http://') || presetIdOrUrl.startsWith('https://')) {
        currentUrl.searchParams.set('url', presetIdOrUrl);
      } else {
        currentUrl.searchParams.set('demo', presetIdOrUrl);
      }
    }

    window.history.replaceState({}, '', currentUrl.toString());
  } catch {
    // Ignore history update errors in non-standard environments
  }
}

/**
 * Listens to browser back/forward history navigation and hash changes.
 */
export function listenToUrlChanges(
  onLoadRequest: (req: DocumentLoadRequest) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handlePopState = () => {
    const req = parseDocumentLoadRequest(window.location.href);
    if (req) {
      onLoadRequest(req);
    }
  };

  window.addEventListener('popstate', handlePopState);
  window.addEventListener('hashchange', handlePopState);

  return () => {
    window.removeEventListener('popstate', handlePopState);
    window.removeEventListener('hashchange', handlePopState);
  };
}

/**
 * Checks whether the demo template should be loaded based on the current URL query parameters.
 * Preserved for backwards compatibility with tests and callers.
 */
export function shouldLoadDemoFromUrl(searchString: string): boolean {
  if (!searchString || searchString.length <= 1) return false;
  const raw = searchString.startsWith('?') ? searchString.slice(1) : searchString;
  const params = new URLSearchParams(raw);
  return (
    params.has('demo') ||
    params.has('sample') ||
    params.has('test') ||
    params.has('template')
  );
}

