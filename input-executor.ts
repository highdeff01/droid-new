import { TransientOSError } from './input-errors.js';

/**
 * Configuration for the input queue.
 */
export interface InputQueueConfig {
  minDelayMs?: number;      // Minimum delay between actions (default 50ms)
  maxQueueSize?: number;    // Maximum pending actions (default 100)
  maxRetries?: number;      // Max retry attempts (default 3)
  retryBaseMs?: number;     // Base retry delay (default 100ms)
}

/**
 * Manages input dispatch queue with rate limiting, backpressure, and retry logic.
 */
export class InputQueue {
  private minDelayMs: number;
  private maxQueueSize: number;
  private maxRetries: number;
  private retryBaseMs: number;
  private lastDispatchTime: number | null = null;
  private dispatchTail: Promise<void> = Promise.resolve();
  private queuedCount = 0;

  constructor(config: InputQueueConfig = {}) {
    this.minDelayMs = config.minDelayMs ?? 50;
    this.maxQueueSize = config.maxQueueSize ?? 100;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 100;
  }

  /**
   * Wait until the next dispatch slot is available (rate limiting).
   */
  async canDispatch(): Promise<void> {
    const dispatch = this.dispatchTail.then(async () => {
      if (this.lastDispatchTime !== null) {
        const delayMs = this.minDelayMs - (Date.now() - this.lastDispatchTime);
        if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      this.lastDispatchTime = Date.now();
    });
    this.dispatchTail = dispatch.catch(() => {});
    await dispatch;
  }

  /**
   * Check if queue has capacity to accept more items.
   */
  canQueue(): boolean {
    return this.queuedCount < this.maxQueueSize;
  }

  /**
   * Add item to queue, applying backpressure if full.
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canQueue()) {
      throw new Error(`Input queue full (${this.queuedCount}/${this.maxQueueSize})`);
    }

    this.queuedCount++;
    try {
      await this.canDispatch();
      return await fn();
    } finally {
      this.queuedCount--;
    }
  }

  /**
   * Set the minimum delay between actions.
   */
  setRateLimit(minMs: number): void {
    if (!Number.isFinite(minMs) || minMs < 0) throw new RangeError('Rate limit must be a non-negative number');
    this.minDelayMs = minMs;
  }

  /**
   * Get current queue size.
   */
  getQueueSize(): number {
    return this.queuedCount;
  }

  /**
   * Retry a function with exponential backoff on transient errors.
   */
  async retry<T>(fn: () => Promise<T>, maxAttempts?: number): Promise<T> {
    const attempts = maxAttempts ?? this.maxRetries;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof TransientOSError) {
          if (attempt === attempts) {
            throw new Error(`Retry exhausted after ${attempts} attempts: ${error.message}`, { cause: error });
          }
          const delayMs = this.retryBaseMs * 2 ** (attempt - 1);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        } else {
          throw error;
        }
      }
    }

    throw new Error('Retry exhausted');
  }
}
