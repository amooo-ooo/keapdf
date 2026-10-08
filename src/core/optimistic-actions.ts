/**
 * Optimistic action coordination engine for perceived performance enhancements.
 * Manages front-loaded visual transformations, FIFO queued programmatic executions,
 * burst coalescing, and automatic rollback on failure.
 */

export interface QueuedRotation {
  pageIndex: number;
  degreesDelta: 90 | 180 | 270;
}

/**
 * Configuration options for a queued optimistic mutation task.
 */
export interface OptimisticMutationTask<T = void> {
  /** Human-readable description of the mutation for error diagnostics. */
  description?: string;
  /** Synchronous front-end visual state update applied immediately upon enqueueing. */
  applyVisual?: () => void;
  /** Asynchronous programmatic mutation executed when the queue drains. */
  executeProgrammatic: () => Promise<T>;
  /** Synchronous visual state reconciliation invoked after programmatic execution succeeds. */
  reconcileVisual?: (result: T) => void;
  /** Synchronous visual state rollback invoked if programmatic execution throws. */
  rollbackVisual?: (error: unknown) => void;
  /** Callback invoked when the entire mutation queue finishes draining after this task. */
  onQueueDrained?: () => void | Promise<void>;
  /** Optional key used to deduplicate onQueueDrained callbacks across a burst while allowing distinct commit pipelines. */
  commitKey?: string;
  /** Whether to defer reconcileVisual until the post-mutation commit backoff window settles. */
  deferReconcileUntilBackoff?: boolean;
  /** Whether to suppress rethrowing errors after rollback and logging. */
  suppressError?: boolean;
}

/**
 * Initialisation options for OptimisticActionManager.
 */
export interface OptimisticActionManagerOptions {
  /**
   * Settle window in milliseconds after front-end optimistic updates.
   * Additional optimistic actions arriving within this window apply their
   * visual state immediately and extend the settle window before heavy WASM
   * programmatic mutations execute.
   */
  burstWindowMs?: number;
  /**
   * Backoff window in milliseconds after background programmatic mutations finish
   * before invoking the final queue drain commit to reveal engine changes.
   * Additional optimistic actions arriving within this window keep the optimistic
   * display active and extend the backoff.
   */
  commitBackoffMs?: number;
}

interface InternalQueuedTask {
  description: string;
  commitKey: string;
  onQueueDrained?: () => void | Promise<void>;
  execute: (deferResolve: (resolver: () => void) => void) => Promise<void>;
}

function getNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Yields execution to allow the browser paint pipeline (style recalculation, layout, paint, composite)
 * to flush optimistic DOM modifications before executing heavy thread-blocking operations.
 *
 * @return A promise that resolves after the next browser paint frame.
 */
export function yieldToPaint(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      const rafId = requestAnimationFrame(() => setTimeout(done, 0));
      setTimeout(() => {
        cancelAnimationFrame(rafId);
        done();
      }, 35);
    });
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export class OptimisticActionManager {
  private mutationQueue: InternalQueuedTask[] = [];
  private activeMutationLock = false;
  private isDrainingQueue = false;
  private isExecutingTask = false;
  private unrenderedVisualCount = 0;
  private lastEnqueueTimestamp = 0;
  private lastMutationTimestamp = 0;
  private configuredBurstWindowMs: number;
  private configuredCommitBackoffMs: number;
  private queueGeneration = 0;
  private backoffWakeupResolve: (() => void) | null = null;
  private activeDrainResolvers: Array<() => void> = [];
  private deferredReconciles: Array<() => void> = [];

  constructor(options?: OptimisticActionManagerOptions) {
    const isBrowser = typeof requestAnimationFrame === 'function';
    const defaultBurstWindow = isBrowser ? 100 : 35;
    const defaultCommitBackoff = isBrowser ? 220 : 0;
    this.configuredBurstWindowMs =
      options?.burstWindowMs !== undefined ? Math.max(0, options.burstWindowMs) : defaultBurstWindow;
    this.configuredCommitBackoffMs =
      options?.commitBackoffMs !== undefined ? Math.max(0, options.commitBackoffMs) : defaultCommitBackoff;
  }

  /**
   * Checks whether a mutation lock is currently active.
   */
  get isLocked(): boolean {
    return this.activeMutationLock;
  }

  /**
   * Returns the number of queued mutations waiting to execute.
   */
  get pendingCount(): number {
    return this.mutationQueue.length;
  }

  /**
   * Checks whether additional mutations are waiting in the queue.
   */
  get hasPendingMutations(): boolean {
    return this.mutationQueue.length > 0;
  }

  /**
   * Checks whether the manager is currently draining queued mutations.
   */
  get isDraining(): boolean {
    return this.isDrainingQueue || this.isExecutingTask;
  }

  /**
   * Returns the configured burst settle window in milliseconds.
   */
  get burstWindowMs(): number {
    return this.configuredBurstWindowMs;
  }

  /**
   * Updates the burst settle window in milliseconds.
   *
   * @param ms Non-negative burst window duration in milliseconds.
   */
  setBurstWindowMs(ms: number): void {
    this.configuredBurstWindowMs = Math.max(0, ms);
  }

  /**
   * Returns the configured commit backoff window in milliseconds.
   */
  get commitBackoffMs(): number {
    return this.configuredCommitBackoffMs;
  }

  /**
   * Updates the commit backoff window in milliseconds.
   *
   * @param ms Non-negative commit backoff duration in milliseconds.
   */
  setCommitBackoffMs(ms: number): void {
    this.configuredCommitBackoffMs = Math.max(0, ms);
  }

  private notifyBackoffWakeup(): void {
    if (this.backoffWakeupResolve) {
      const wake = this.backoffWakeupResolve;
      this.backoffWakeupResolve = null;
      wake();
    }
  }

  private flushActiveDrainResolvers(): void {
    if (this.activeDrainResolvers.length === 0) return;
    const resolvers = this.activeDrainResolvers.splice(0, this.activeDrainResolvers.length);
    for (const resolveFn of resolvers) {
      resolveFn();
    }
  }

  /**
   * Flushes all deferred visual reconciliation callbacks accumulated during background mutations.
   */
  flushDeferredReconciles(): void {
    if (this.deferredReconciles.length === 0) return;
    const reconciles = this.deferredReconciles.splice(0, this.deferredReconciles.length);
    for (const reconcileFn of reconciles) {
      reconcileFn();
    }
  }

  /**
   * Executes an asynchronous operation inside a single-flight mutation lock.
   *
   * @param operation The asynchronous function to run while holding the lock.
   * @return The operation result, or null if the lock is already held.
   */
  async withMutationLock<T>(operation: () => Promise<T>): Promise<T | null> {
    if (this.activeMutationLock) {
      return null;
    }
    this.activeMutationLock = true;
    try {
      return await operation();
    } finally {
      this.activeMutationLock = false;
    }
  }

  /**
   * Enqueues an optimistic mutation task into the FIFO execution queue.
   * Applies the visual state immediately on the caller thread, waits for the
   * paint pipeline and any ongoing user input burst to settle, and then drains
   * queued programmatic mutations sequentially in the background before committing
   * once the backoff window settles.
   *
   * @param task Configuration for the optimistic visual and programmatic phases.
   * @return A promise resolving with the programmatic execution result.
   */
  enqueueMutation<T = void>(task: OptimisticMutationTask<T>): Promise<T> {
    const generation = this.queueGeneration;

    if (task.applyVisual) {
      task.applyVisual();
      this.unrenderedVisualCount++;
      this.lastEnqueueTimestamp = getNowMs();
    } else if (this.unrenderedVisualCount === 0 && !this.isDrainingQueue) {
      this.unrenderedVisualCount = 1;
      this.lastEnqueueTimestamp = getNowMs();
    } else {
      this.lastEnqueueTimestamp = getNowMs();
    }

    this.notifyBackoffWakeup();

    return new Promise<T>((resolve, reject) => {
      const entry: InternalQueuedTask = {
        description: task.description ?? 'Queued mutation',
        commitKey: task.commitKey ?? 'default',
        onQueueDrained: task.onQueueDrained,
        execute: async (deferResolve) => {
          if (generation !== this.queueGeneration) {
            resolve(undefined as unknown as T);
            return;
          }
          try {
            const result = await task.executeProgrammatic();
            if (task.deferReconcileUntilBackoff && task.reconcileVisual) {
              const reconcile = task.reconcileVisual;
              this.deferredReconciles.push(() => reconcile(result));
            } else {
              task.reconcileVisual?.(result);
            }
            this.lastMutationTimestamp = getNowMs();
            if (task.onQueueDrained || task.deferReconcileUntilBackoff) {
              deferResolve(() => resolve(result));
            } else {
              resolve(result);
            }
          } catch (err: unknown) {
            task.rollbackVisual?.(err);
            this.lastMutationTimestamp = getNowMs();
            if (task.suppressError) {
              console.error(`Failed to execute ${task.description ?? 'queued mutation'}:`, err);
              if (task.onQueueDrained || task.deferReconcileUntilBackoff) {
                deferResolve(() => resolve(undefined as unknown as T));
              } else {
                resolve(undefined as unknown as T);
              }
            } else {
              reject(err);
            }
          }
        },
      };

      this.mutationQueue.push(entry);
      this.startQueueDrain(generation);
    });
  }

  /**
   * Queues a rotation execution for one or more pages, applying optimistic
   * visual rotation at the front, running WASM mutations in the background,
   * and committing the final visual render once the backoff window settles.
   *
   * @param pageIndices Single page index or array of target page indices.
   * @param degreesDelta Clockwise rotation increment in degrees.
   * @param applyVisual Synchronous visual callback executed immediately.
   * @param executeProgrammatic Asynchronous programmatic WASM rotation callback.
   * @param reconcileVisual Synchronous callback executed after programmatic rotation.
   * @param rollbackVisual Synchronous callback executed if programmatic rotation fails.
   * @param onQueueDrained Optional callback invoked once the rotation queue and backoff settle.
   * @return A promise resolving when this queued rotation finishes draining.
   */
  enqueueRotation(
    pageIndices: number | number[],
    degreesDelta: 90 | 180 | 270,
    applyVisual: () => void,
    executeProgrammatic: () => Promise<void>,
    reconcileVisual: () => void,
    rollbackVisual: () => void,
    onQueueDrained?: () => void | Promise<void>,
  ): Promise<void> {
    const indices = Array.isArray(pageIndices) ? pageIndices : [pageIndices];
    return this.enqueueMutation<void>({
      description: `queued rotation (${degreesDelta}deg) for pages ${indices.join(', ')}`,
      applyVisual,
      executeProgrammatic,
      reconcileVisual: () => reconcileVisual(),
      rollbackVisual: () => rollbackVisual(),
      onQueueDrained,
      commitKey: 'rotation',
      suppressError: true,
    });
  }

  /**
   * Clears all pending queued mutations and resets lock state.
   */
  clearChains(): void {
    this.queueGeneration++;
    this.mutationQueue = [];
    this.deferredReconciles = [];
    this.unrenderedVisualCount = 0;
    this.isDrainingQueue = false;
    this.isExecutingTask = false;
    this.activeMutationLock = false;
    this.notifyBackoffWakeup();
    this.flushActiveDrainResolvers();
  }

  /**
   * Waits for the browser paint pipeline and any active user burst window to settle
   * before executing background mutations.
   *
   * @param generation Active queue generation token.
   */
  private async waitForFrontEndBurstToSettle(generation: number): Promise<void> {
    while (this.unrenderedVisualCount > 0 && generation === this.queueGeneration) {
      this.unrenderedVisualCount = 0;
      await yieldToPaint();

      if (this.configuredBurstWindowMs > 0 && generation === this.queueGeneration) {
        while (generation === this.queueGeneration) {
          const elapsed = getNowMs() - this.lastEnqueueTimestamp;
          const remaining = this.configuredBurstWindowMs - elapsed;
          if (remaining <= 0) {
            break;
          }
          await new Promise<void>((res) => setTimeout(res, Math.ceil(remaining)));
        }
      }
    }
  }

  /**
   * Waits for the post-execution commit backoff window to settle so additional user
   * interactions keep the optimistic visual display active and execute in the background
   * before committing heavy engine renders and buffer serialisations.
   *
   * @param generation Active queue generation token.
   */
  private async waitForCommitBackoffToSettle(generation: number): Promise<void> {
    while (
      this.configuredCommitBackoffMs > 0 &&
      generation === this.queueGeneration &&
      this.mutationQueue.length === 0 &&
      this.unrenderedVisualCount === 0
    ) {
      const anchorTimestamp = Math.max(this.lastEnqueueTimestamp, this.lastMutationTimestamp);
      const elapsed = getNowMs() - anchorTimestamp;
      const remaining = this.configuredCommitBackoffMs - elapsed;
      if (remaining <= 0) {
        break;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.backoffWakeupResolve === wake) {
            this.backoffWakeupResolve = null;
          }
          resolve();
        }, Math.ceil(remaining));
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        this.backoffWakeupResolve = wake;
      });
    }
  }

  /**
   * Starts draining the FIFO mutation queue if not already draining.
   *
   * @param generation Active queue generation token.
   */
  private startQueueDrain(generation: number): void {
    if (this.isDrainingQueue) {
      return;
    }
    this.isDrainingQueue = true;

    void (async () => {
      const pendingDrainCallbacks = new Map<string, () => void | Promise<void>>();
      try {
        while (
          (this.mutationQueue.length > 0 ||
            pendingDrainCallbacks.size > 0 ||
            this.deferredReconciles.length > 0) &&
          generation === this.queueGeneration
        ) {
          if (this.unrenderedVisualCount > 0) {
            await this.waitForFrontEndBurstToSettle(generation);
            if (generation !== this.queueGeneration) {
              break;
            }
          }

          const nextTask = this.mutationQueue.shift();
          if (nextTask) {
            if (nextTask.onQueueDrained) {
              pendingDrainCallbacks.set(nextTask.commitKey, nextTask.onQueueDrained);
            }
            this.isExecutingTask = true;
            this.activeMutationLock = true;
            try {
              await nextTask.execute((resolver) => {
                this.activeDrainResolvers.push(resolver);
              });
            } finally {
              this.isExecutingTask = false;
              this.activeMutationLock =
                this.mutationQueue.length > 0 ||
                pendingDrainCallbacks.size > 0 ||
                this.deferredReconciles.length > 0;
            }
            continue;
          }

          if (pendingDrainCallbacks.size > 0 || this.deferredReconciles.length > 0) {
            if (this.configuredCommitBackoffMs > 0) {
              await this.waitForCommitBackoffToSettle(generation);
              if (generation !== this.queueGeneration) {
                break;
              }
              if (this.mutationQueue.length > 0 || this.unrenderedVisualCount > 0) {
                continue;
              }
            }

            const drainFns = Array.from(pendingDrainCallbacks.values());
            pendingDrainCallbacks.clear();
            this.isExecutingTask = true;
            this.activeMutationLock = true;
            try {
              for (const drainFn of drainFns) {
                await drainFn();
              }
              this.flushDeferredReconciles();
            } finally {
              this.isExecutingTask = false;
              this.activeMutationLock = this.mutationQueue.length > 0;
              this.flushActiveDrainResolvers();
            }
          }
        }
      } finally {
        if (generation === this.queueGeneration) {
          this.activeMutationLock = false;
          this.isDrainingQueue = false;
          this.isExecutingTask = false;
          this.flushDeferredReconciles();
          this.flushActiveDrainResolvers();
        }
      }
    })();
  }
}

/** Global singleton instance for optimistic actions coordination. */
export const optimisticActionManager = new OptimisticActionManager();

