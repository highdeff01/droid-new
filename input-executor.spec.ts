import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputQueue } from './input-executor.js';
import { TransientOSError } from './input-errors.js';

describe('InputQueue', () => {
  let queue: InputQueue;

  beforeEach(() => {
    queue = new InputQueue({ minDelayMs: 10, maxQueueSize: 5, maxRetries: 3, retryBaseMs: 50 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rate limiting', () => {
    it('enforces minimum delay between dispatches', async () => {
      const start = Date.now();
      await queue.canDispatch();
      const second = queue.canDispatch();
      await vi.advanceTimersByTimeAsync(10);
      await second;
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });

    it('allows immediate dispatch for first call', async () => {
      const start = Date.now();
      await queue.canDispatch();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5);
    });

    it('respects setRateLimit changes', async () => {
      queue.setRateLimit(50);
      const start = Date.now();
      await queue.canDispatch();
      const second = queue.canDispatch();
      await vi.advanceTimersByTimeAsync(50);
      await second;
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(50);
    });
  });

  describe('queue capacity', () => {
    it('checks queue capacity', () => {
      expect(queue.canQueue()).toBe(true);
    });

    it('rejects enqueue when queue is full', async () => {
      const fullQueue = new InputQueue({ maxQueueSize: 1 });
      let release!: (value: string) => void;
      const first = fullQueue.enqueue(() => new Promise<string>((resolve) => { release = resolve; }));
      await Promise.resolve();
      await Promise.resolve();
      await expect(fullQueue.enqueue(async () => 'result2')).rejects.toThrow('Input queue full');
      release('result1');
      await expect(first).resolves.toBe('result1');
    });
  });

  describe('enqueue and execute', () => {
    it('executes function from queue', async () => {
      const result = await queue.enqueue(async () => 'test-result');
      expect(result).toBe('test-result');
    });

    it('applies rate limiting to enqueued function', async () => {
      const fn = vi.fn(async () => 'result');
      await queue.enqueue(fn);
      const second = queue.enqueue(fn);
      await vi.advanceTimersByTimeAsync(10);
      await second;
      
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry with exponential backoff', () => {
    it('retries on transient error', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          const step: any = { id: 'test', name: 'test', action: 'click', x: 0, y: 0, status: 'pending' };
          throw new TransientOSError('Transient error', step);
        }
        return 'success';
      };

      const retrying = queue.retry(fn);
      await vi.runAllTimersAsync();
      const result = await retrying;
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('applies exponential backoff timing', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const fn = async () => {
        attempts++;
        delays.push(Date.now());
        if (attempts < 3) {
          const step: any = { id: 'test', name: 'test', action: 'click', x: 0, y: 0, status: 'pending' };
          throw new TransientOSError('Transient error', step);
        }
        return 'success';
      };

      const retrying = queue.retry(fn);
      await vi.runAllTimersAsync();
      await retrying;
      
      // Check exponential backoff: 50ms, then 100ms
      const gap1 = delays[1] - delays[0];
      const gap2 = delays[2] - delays[1];
      expect(gap2).toBeGreaterThanOrEqual(gap1);
    });

    it('fails immediately on non-transient error', async () => {
      const fn = async () => {
        throw new Error('Permanent error');
      };

      const assertion = expect(queue.retry(fn)).rejects.toThrow('Permanent error');
      await vi.runAllTimersAsync();
      await assertion;
    });

    it('respects max retry attempts', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        const step: any = { id: 'test', name: 'test', action: 'click', x: 0, y: 0, status: 'pending' };
        throw new TransientOSError('Always fails', step);
      };

      const assertion = expect(queue.retry(fn, 2)).rejects.toThrow('Retry exhausted');
      await vi.runAllTimersAsync();
      await assertion;
      expect(attempts).toBe(2);
    });
  });

  describe('queue size tracking', () => {
    it('tracks queued item count', async () => {
      expect(queue.getQueueSize()).toBe(0);

      await queue.enqueue(async () => 'result');
      expect(queue.getQueueSize()).toBe(0); // Decremented after execution
    });
  });
});
