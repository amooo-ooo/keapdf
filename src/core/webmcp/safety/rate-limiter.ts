/**
 * Mutation rate limiter for WebMCP agent interactions.
 *
 * Implements Section 8.5 of webmcp-pdf-editor-spec.md:
 * "The host application MUST enforce a per-session ceiling on mutation calls
 * per unit time (recommended starting point: 30 mutating calls per minute),
 * returning RATE_LIMITED with a retryAfterMs value when exceeded."
 */

export interface RateLimitStatus {
  allowed: boolean;
  retryAfterMs?: number;
  remainingCalls: number;
}

export class RateLimiter {
  private callTimestamps: number[] = [];

  constructor(
    public readonly maxCallsPerMinute: number = 30,
    public readonly windowMs: number = 60_000
  ) {}

  /**
   * Checks whether a new mutation is allowed within the rate limit window.
   */
  public checkLimit(now: number = Date.now()): RateLimitStatus {
    this.cleanExpired(now);

    if (this.callTimestamps.length >= this.maxCallsPerMinute) {
      const oldest = this.callTimestamps[0];
      const retryAfterMs = Math.max(1, oldest + this.windowMs - now);
      return {
        allowed: false,
        retryAfterMs,
        remainingCalls: 0,
      };
    }

    return {
      allowed: true,
      remainingCalls: this.maxCallsPerMinute - this.callTimestamps.length,
    };
  }

  /**
   * Records an accepted mutation call timestamp into the window.
   */
  public recordCall(now: number = Date.now()): void {
    this.cleanExpired(now);
    this.callTimestamps.push(now);
  }

  /**
   * Resets rate limiter metrics (e.g. on new session or test setup).
   */
  public reset(): void {
    this.callTimestamps = [];
  }

  private cleanExpired(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.callTimestamps.length > 0 && this.callTimestamps[0] <= cutoff) {
      this.callTimestamps.shift();
    }
  }
}
