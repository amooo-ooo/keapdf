/**
 * Concurrency Write Lock for Semantic Document Graph (SDG).
 *
 * Implements Section 7.5 of webmcp-pdf-editor-spec.md:
 * "The host application MUST serialise SDG mutations through a single write lock:
 * a mutating handler MUST acquire the lock before validating its anchor and MUST
 * hold it until the SDG update and view update are both complete. A concurrent
 * mutation attempt MUST either queue behind the lock or fail with LOCKED."
 */

export class SdgLock {
  private activeHolderId: string | null = null;

  /**
   * Returns whether the lock is currently held by an in-flight mutation.
   */
  public get isLocked(): boolean {
    return this.activeHolderId !== null;
  }

  /**
   * Gets the ID of the current lock holder, or null if unlocked.
   */
  public get holderToolCallId(): string | null {
    return this.activeHolderId;
  }

  /**
   * Attempts to acquire the write lock immediately without blocking.
   *
   * @param toolCallId Unique identifier of the calling tool invocation.
   * @returns True if the lock was acquired; false if already held.
   */
  public tryAcquire(toolCallId: string): boolean {
    if (this.activeHolderId !== null) {
      return false;
    }
    this.activeHolderId = toolCallId;
    return true;
  }

  /**
   * Releases the write lock if held by the specified toolCallId.
   *
   * @param toolCallId Unique identifier of the calling tool invocation.
   */
  public release(toolCallId: string): void {
    if (this.activeHolderId === toolCallId) {
      this.activeHolderId = null;
    }
  }

  /**
   * Executes an asynchronous mutating operation with the write lock held.
   *
   * @param toolCallId Unique identifier of the calling tool invocation.
   * @param operation Async task to execute while holding the lock.
   * @throws Error with code LOCKED if lock is already held.
   */
  public async withLock<T>(toolCallId: string, operation: () => Promise<T>): Promise<T> {
    if (!this.tryAcquire(toolCallId)) {
      const holder = this.activeHolderId || 'unknown';
      const lockError = new Error(
        `The SDG write lock is held by another in-flight mutation (${holder}).`
      );
      (lockError as Error & { code: string; holderToolCallId: string }).code = 'LOCKED';
      (lockError as Error & { code: string; holderToolCallId: string }).holderToolCallId = holder;
      throw lockError;
    }

    try {
      return await operation();
    } finally {
      this.release(toolCallId);
    }
  }
}
