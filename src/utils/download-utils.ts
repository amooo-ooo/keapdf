/**
 * Trigger a browser file download from a Blob.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 5000);
}

/**
 * Trigger a browser file download from raw bytes.
 */
export function downloadBytes(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
  downloadBlob(blob, fileName);
}
