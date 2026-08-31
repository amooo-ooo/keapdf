/**
 * Safe Cloning Utilities.
 *
 * Deeply clones objects while safely unwrapping Svelte 5 reactive proxies
 * and handling non-cloneable properties without throwing DataCloneError.
 *
 * NOTE: $state.snapshot is a compile-time Svelte 5 rune that cannot be
 * used outside .svelte/.svelte.ts files. Instead, we rely on JSON
 * round-tripping which transparently reads through Svelte Proxy traps,
 * producing a plain object that structuredClone can handle.
 */

/**
 * Safely unwrap Svelte 5 reactive proxies by JSON round-tripping.
 * JSON.stringify transparently invokes Proxy get traps, producing
 * a clean serializable snapshot of the underlying data.
 */
export function safeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    // Non-serializable value (circular refs, functions, etc.)
    return value;
  }
}

/**
 * Deep clones an object safely without throwing DataCloneError on reactive proxies
 * or non-cloneable properties, falling back to JSON serialization or shallow copy.
 */
export function safeClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // First attempt: structuredClone on the raw value (fastest path for plain objects)
  try {
    return structuredClone(value) as T;
  } catch {
    // structuredClone failed (likely a Svelte 5 Proxy), fall through
  }

  // Second attempt: JSON round-trip (reads through Proxy traps)
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    // Non-serializable (circular refs, functions, etc.)
  }

  // Last resort: shallow copy
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => safeClone(item)) as unknown as T;
  }
  return { ...(value as Record<string, unknown>) } as T;
}
