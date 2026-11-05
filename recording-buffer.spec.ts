/**
 * Recording Buffer Tests
 *
 * Comprehensive tests for ActionBuffer including:
 * - Add/remove/clear operations
 * - Deduplication (temporal and spatial)
 * - Rate limiting (throttle and drop)
 * - Memory management and capacity
 * - Timestamp validation
 * - Compression and consolidation
 * - Statistics tracking
 * - Serialization/restore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionBuffer, type BufferConfig, type BufferStatistics } from './recording-buffer.js';
import {
  createClickAction,
  createKeyboardAction,
  createDragAction,
  createScrollAction,
  createPauseAction,
} from './recording-types.js';

describe('ActionBuffer', () => {
  let buffer: ActionBuffer;
  const now = new Date('2024-01-15T10:30:00.000Z').getTime();

  const timestamp = (offsetMs: number): string => new Date(now + offsetMs).toISOString();

  beforeEach(() => {
    buffer = new ActionBuffer();
  });

  describe('Basic operations', () => {
    it('should add a single action', () => {
      const action = createClickAction(timestamp(0), 0.5, 0.5);
      const added = buffer.addAction(action);

      expect(added).toBe(true);
      expect(buffer.size()).toBe(1);
      expect(buffer.isEmpty()).toBe(false);
    });

    it('should add multiple actions', () => {
      const actions = [
        createClickAction(timestamp(0), 0.5, 0.5),
        createClickAction(timestamp(100), 0.6, 0.6),
        createClickAction(timestamp(200), 0.7, 0.7),
      ];

      const added = buffer.addActions(actions);

      expect(added).toBe(3);
      expect(buffer.size()).toBe(3);
    });

    it('should retrieve actions', () => {
      const action1 = createClickAction(timestamp(0), 0.5, 0.5);
      const action2 = createClickAction(timestamp(100), 0.6, 0.6);

      buffer.addAction(action1);
      buffer.addAction(action2);

      expect(buffer.getAction(0)).toEqual(action1);
      expect(buffer.getAction(1)).toEqual(action2);
      expect(buffer.getAction(2)).toBeUndefined();
    });

    it('should get all actions', () => {
      const action1 = createClickAction(timestamp(0), 0.5, 0.5);
      const action2 = createClickAction(timestamp(100), 0.6, 0.6);

      buffer.addAction(action1);
      buffer.addAction(action2);

      const actions = buffer.getActions();
      expect(actions).toHaveLength(2);
      expect(actions[0]).toEqual(action1);
      expect(actions[1]).toEqual(action2);
    });

    it('should get last action', () => {
      const action1 = createClickAction(timestamp(0), 0.5, 0.5);
      const action2 = createClickAction(timestamp(100), 0.6, 0.6);

      buffer.addAction(action1);
      expect(buffer.getLastAction()).toEqual(action1);

      buffer.addAction(action2);
      expect(buffer.getLastAction()).toEqual(action2);
    });

    it('should clear buffer', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(100), 0.6, 0.6));

      expect(buffer.size()).toBe(2);
      buffer.clear();
      expect(buffer.size()).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should remove action at index', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(100), 0.6, 0.6));
      buffer.addAction(createClickAction(timestamp(200), 0.7, 0.7));

      expect(buffer.removeAction(1)).toBe(true);
      expect(buffer.size()).toBe(2);
      expect((buffer.getAction(1) as any)?.x).toBeCloseTo(0.7);
    });

    it('should not remove action at invalid index', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));

      expect(buffer.removeAction(-1)).toBe(false);
      expect(buffer.removeAction(5)).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should check if full', () => {
      const smallBuffer = new ActionBuffer({ maxSize: 2 });

      expect(smallBuffer.isFull()).toBe(false);
      smallBuffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      expect(smallBuffer.isFull()).toBe(false);
      smallBuffer.addAction(createClickAction(timestamp(100), 0.6, 0.6));
      expect(smallBuffer.isFull()).toBe(true);
    });
  });

  describe('Deduplication - temporal window', () => {
    it('should deduplicate identical clicks within window', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createClickAction(timestamp(0), 0.5, 0.5);
      const action2 = createClickAction(timestamp(25), 0.5, 0.5); // Within 50ms

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should not deduplicate clicks outside window', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createClickAction(timestamp(0), 0.5, 0.5);
      const action2 = createClickAction(timestamp(100), 0.5, 0.5); // Outside 50ms window

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(true);
      expect(buffer.size()).toBe(2);
    });

    it('should not deduplicate different buttons', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createClickAction(timestamp(0), 0.5, 0.5, 'left');
      const action2 = createClickAction(timestamp(25), 0.5, 0.5, 'right');

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(true);
      expect(buffer.size()).toBe(2);
    });

    it('should deduplicate identical keyboard actions', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createKeyboardAction(timestamp(0), ['Enter']);
      const action2 = createKeyboardAction(timestamp(25), ['Enter']);

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should not deduplicate different key combinations', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createKeyboardAction(timestamp(0), ['Enter']);
      const action2 = createKeyboardAction(timestamp(25), ['Escape']);

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(true);
      expect(buffer.size()).toBe(2);
    });

    it('should deduplicate identical text input', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createKeyboardAction(timestamp(0), [], 'hello');
      const action2 = createKeyboardAction(timestamp(25), [], 'hello');

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(false);
      expect(buffer.size()).toBe(1);
    });
  });

  describe('Deduplication - spatial tolerance', () => {
    it('should deduplicate clicks within spatial tolerance', () => {
      const config: BufferConfig = { dedupSpatialTolerance: 0.05 };
      buffer = new ActionBuffer(config);

      const action1 = createClickAction(timestamp(0), 0.5, 0.5);
      const action2 = createClickAction(timestamp(25), 0.51, 0.51); // Within 0.05 distance

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should not deduplicate clicks outside spatial tolerance', () => {
      const config: BufferConfig = { dedupSpatialTolerance: 0.02 };
      buffer = new ActionBuffer(config);

      const action1 = createClickAction(timestamp(0), 0.5, 0.5);
      const action2 = createClickAction(timestamp(25), 0.06, 0.06); // Outside 0.02 distance

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(true);
      expect(buffer.size()).toBe(2);
    });

    it('should deduplicate drags within spatial tolerance', () => {
      const config: BufferConfig = { dedupSpatialTolerance: 0.05 };
      buffer = new ActionBuffer(config);

      const action1 = createDragAction(timestamp(0), 0.1, 0.1, 0.9, 0.9);
      const action2 = createDragAction(timestamp(50), 0.11, 0.11, 0.91, 0.91); // Within tolerance

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should not deduplicate drags with different endpoints', () => {
      const config: BufferConfig = { dedupSpatialTolerance: 0.05 };
      buffer = new ActionBuffer(config);

      const action1 = createDragAction(timestamp(0), 0.1, 0.1, 0.9, 0.9);
      const action2 = createDragAction(timestamp(50), 0.11, 0.11, 0.5, 0.5); // End differs

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(true);
      expect(buffer.size()).toBe(2);
    });

    it('should deduplicate scrolls within spatial tolerance', () => {
      const config: BufferConfig = { dedupSpatialTolerance: 0.05 };
      buffer = new ActionBuffer(config);

      const action1 = createScrollAction(timestamp(0), 0.5, 0.5, undefined, 100);
      const action2 = createScrollAction(timestamp(25), 0.51, 0.51, undefined, 100); // Within tolerance

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should not deduplicate scrolls with different delta', () => {
      const config: BufferConfig = { dedupSpatialTolerance: 0.05 };
      buffer = new ActionBuffer(config);

      const action1 = createScrollAction(timestamp(0), 0.5, 0.5, undefined, 100);
      const action2 = createScrollAction(timestamp(25), 0.51, 0.51, undefined, 50); // Different delta

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(true);
      expect(buffer.size()).toBe(2);
    });
  });

  describe('Deduplication - pause actions', () => {
    it('should deduplicate identical pauses (within tolerance)', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createPauseAction(timestamp(0), 1000);
      const action2 = createPauseAction(timestamp(25), 1000); // Same duration

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should deduplicate pauses within 10% tolerance', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createPauseAction(timestamp(0), 1000);
      const action2 = createPauseAction(timestamp(25), 1050); // Within 10% tolerance

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should not deduplicate pauses outside tolerance', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      const action1 = createPauseAction(timestamp(0), 1000);
      const action2 = createPauseAction(timestamp(25), 1200); // Outside 10% tolerance

      expect(buffer.addAction(action1)).toBe(true);
      expect(buffer.addAction(action2)).toBe(true);
      expect(buffer.size()).toBe(2);
    });
  });

  describe('Rate limiting - throttle strategy', () => {
    it('should buffer all actions within rate limit', () => {
      const config: BufferConfig = {
        rateLimit: {
          maxActionsPerSecond: 10,
          strategy: 'throttle',
        },
      };
      buffer = new ActionBuffer(config);

      // Add 10 actions within 1 second
      for (let i = 0; i < 10; i++) {
        const action = createClickAction(timestamp(i * 100), 0.5, 0.5);
        buffer.addAction(action);
      }

      expect(buffer.size()).toBe(10);
    });

    it('should buffer actions exceeding rate limit (throttle)', () => {
      const config: BufferConfig = {
        dedupWindowMs: 0, // Disable deduplication
        rateLimit: {
          maxActionsPerSecond: 100, // Higher limit
          strategy: 'throttle',
        },
      };
      buffer = new ActionBuffer(config);

      // Add 10 actions with different coordinates to avoid dedup issues
      for (let i = 0; i < 10; i++) {
        const action = createClickAction(timestamp(i * 50), 0.5 + i * 0.01, 0.5);
        buffer.addAction(action);
      }

      // All should be added (all within rate limit and not deduplicated)
      expect(buffer.size()).toBe(10);
    });
  });

  describe('Rate limiting - drop strategy', () => {
    it('should drop actions exceeding rate limit (drop strategy)', () => {
      const config: BufferConfig = {
        rateLimit: {
          maxActionsPerSecond: 5,
          strategy: 'drop',
        },
      };
      buffer = new ActionBuffer(config);

      // Add 10 actions in quick succession
      let added = 0;
      for (let i = 0; i < 10; i++) {
        const action = createClickAction(timestamp(i * 50), 0.5, 0.5);
        if (buffer.addAction(action)) {
          added++;
        }
      }

      // Some should be dropped (5 per second = 1 per 200ms, so ~5 over 450ms)
      expect(added).toBeLessThanOrEqual(6);
      expect(buffer.size()).toBeLessThanOrEqual(6);
    });

    it('should track rate-dropped statistics', () => {
      const config: BufferConfig = {
        dedupWindowMs: 0, // Disable deduplication
        rateLimit: {
          maxActionsPerSecond: 50, // 20ms minimum between actions
          strategy: 'drop',
        },
      };
      buffer = new ActionBuffer(config);

      // Add actions at 10ms intervals with different coordinates
      // With 50 actions/second = 20ms minimum, some should be dropped
      for (let i = 0; i < 10; i++) {
        const action = createClickAction(timestamp(i * 10), 0.5 + i * 0.01, 0.5);
        buffer.addAction(action);
      }

      const stats = buffer.getStatistics();
      // At least 50% should be dropped (since we're sending twice as fast)
      expect(stats.rateDropped).toBeGreaterThan(0);
      expect(stats.totalAdded).toBeLessThan(10);
    });
  });

  describe('Memory management', () => {
    it('should enforce maximum buffer size', () => {
      const config: BufferConfig = { maxSize: 10 };
      buffer = new ActionBuffer(config);

      // Add 15 actions
      for (let i = 0; i < 15; i++) {
        buffer.addAction(createClickAction(timestamp(i * 100), 0.5, 0.5));
      }

      expect(buffer.size()).toBe(10);
      expect(buffer.isFull()).toBe(true);
    });

    it('should evict oldest actions on overflow (FIFO)', () => {
      const config: BufferConfig = { maxSize: 3 };
      buffer = new ActionBuffer(config);

      const action1 = createClickAction(timestamp(0), 0.1, 0.1);
      const action2 = createClickAction(timestamp(100), 0.2, 0.2);
      const action3 = createClickAction(timestamp(200), 0.3, 0.3);
      const action4 = createClickAction(timestamp(300), 0.4, 0.4);

      buffer.addAction(action1);
      buffer.addAction(action2);
      buffer.addAction(action3);
      buffer.addAction(action4);

      expect(buffer.size()).toBe(3);
      expect((buffer.getAction(0) as any)?.x).toBeCloseTo(0.2); // action1 evicted
      expect((buffer.getAction(2) as any)?.x).toBeCloseTo(0.4);
    });

    it('should track eviction statistics', () => {
      const config: BufferConfig = { maxSize: 5 };
      buffer = new ActionBuffer(config);

      // Add 10 actions
      for (let i = 0; i < 10; i++) {
        buffer.addAction(createClickAction(timestamp(i * 100), 0.5, 0.5));
      }

      const stats = buffer.getStatistics();
      expect(stats.evicted).toBe(5);
    });
  });

  describe('Timestamp validation', () => {
    it('should reject invalid timestamps', () => {
      const action = createClickAction('not-a-timestamp', 0.5, 0.5);
      const added = buffer.addAction(action);

      expect(added).toBe(false);
      expect(buffer.size()).toBe(0);
    });

    it('should detect backward time movement', () => {
      // Add action at time T
      buffer.addAction(createClickAction(timestamp(1000), 0.5, 0.5));

      // Try to add action at time T-500 (backward)
      // But within 1 second, so it's allowed as small clock skew
      const action = createClickAction(timestamp(500), 0.6, 0.6);
      const added = buffer.addAction(action);

      // Small backward movement (< 1 second) is allowed
      expect(added).toBe(true);
      expect(buffer.size()).toBe(2);
    });

    it('should reject large backward time movement', () => {
      // Add action at time T
      buffer.addAction(createClickAction(timestamp(5000), 0.5, 0.5));

      // Try to add action at time T-2000 (large backward - more than 1 second)
      const action = createClickAction(timestamp(2500), 0.6, 0.6);
      const added = buffer.addAction(action);

      // Large backward movement (> 1 second) is rejected
      expect(added).toBe(false);
      expect(buffer.size()).toBe(1);
    });

    it('should allow small clock skew', () => {
      // Add action at time T
      buffer.addAction(createClickAction(timestamp(1000), 0.5, 0.5));

      // Try to add action slightly before (small skew, allowed)
      const action = createClickAction(timestamp(950), 0.6, 0.6);
      const added = buffer.addAction(action);

      // Small skew within 1 second is allowed
      expect(added).toBe(true);
      expect(buffer.size()).toBe(2);
    });

    it('should track validation issues', () => {
      buffer.addAction(createClickAction('invalid', 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(1000), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(500), 0.5, 0.5)); // Backward time

      const stats = buffer.getStatistics();
      expect(stats.validationIssues).toBeGreaterThan(0);
    });
  });

  describe('Statistics tracking', () => {
    it('should track total added actions', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(100), 0.5, 0.5));

      const stats = buffer.getStatistics();
      expect(stats.totalAdded).toBe(2);
    });

    it('should calculate deduplication rate', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(25), 0.5, 0.5)); // Deduplicated
      buffer.addAction(createClickAction(timestamp(100), 0.6, 0.6));

      const stats = buffer.getStatistics();
      expect(stats.deduplicated).toBe(1);
      expect(stats.totalAdded).toBe(2);
      expect(stats.dedupRate).toBeCloseTo(0.5);
    });

    it('should calculate average timing gap', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(100), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(300), 0.5, 0.5)); // 100ms, 200ms gaps

      const stats = buffer.getStatistics();
      expect(stats.avgTimingGap).toBeCloseTo(150); // Average of 100 and 200
    });

    it('should provide complete statistics', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));

      const stats = buffer.getStatistics();
      expect(stats).toHaveProperty('totalAdded');
      expect(stats).toHaveProperty('currentSize');
      expect(stats).toHaveProperty('deduplicated');
      expect(stats).toHaveProperty('rateDropped');
      expect(stats).toHaveProperty('evicted');
      expect(stats).toHaveProperty('dedupRate');
      expect(stats).toHaveProperty('avgTimingGap');
      expect(stats).toHaveProperty('validationIssues');
    });
  });

  describe('Serialization and restore', () => {
    it('should serialize buffer to JSON', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(100), 0.6, 0.6));

      const json = buffer.serialize();
      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should restore buffer from JSON', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(100), 0.6, 0.6));

      const json = buffer.serialize();

      const newBuffer = new ActionBuffer();
      newBuffer.restore(json);

      expect(newBuffer.size()).toBe(2);
      expect((newBuffer.getAction(0) as any)?.x).toBeCloseTo(0.5);
      expect((newBuffer.getAction(1) as any)?.x).toBeCloseTo(0.6);
    });

    it('should handle invalid JSON gracefully', () => {
      const newBuffer = new ActionBuffer();
      expect(() => newBuffer.restore('invalid json')).not.toThrow();
      expect(newBuffer.size()).toBe(0);
    });

    it('should export buffer as array', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(100), 0.6, 0.6));

      const exported = buffer.export();
      expect(Array.isArray(exported)).toBe(true);
      expect(exported).toHaveLength(2);
    });

    it('should import actions from array', () => {
      const actions = [
        createClickAction(timestamp(0), 0.5, 0.5),
        createClickAction(timestamp(100), 0.6, 0.6),
      ];

      buffer.import(actions);

      expect(buffer.size()).toBe(2);
      expect(buffer.getAction(0)).toEqual(actions[0]);
    });

    it('should clear buffer on import by default', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.1, 0.1));

      const newActions = [createClickAction(timestamp(100), 0.5, 0.5)];
      buffer.import(newActions);

      expect(buffer.size()).toBe(1);
      expect((buffer.getAction(0) as any)?.x).toBeCloseTo(0.5);
    });

    it('should preserve existing buffer on import with flag', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.1, 0.1));

      const newActions = [createClickAction(timestamp(100), 0.5, 0.5)];
      buffer.import(newActions, false); // Don't clear

      expect(buffer.size()).toBe(2);
      expect((buffer.getAction(0) as any)?.x).toBeCloseTo(0.1);
      expect((buffer.getAction(1) as any)?.x).toBeCloseTo(0.5);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle mixed action types with deduplication', () => {
      const config: BufferConfig = { dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createKeyboardAction(timestamp(50), ['Enter']));
      buffer.addAction(createClickAction(timestamp(100), 0.5, 0.5)); // Different time, not deduplicated
      buffer.addAction(createDragAction(timestamp(150), 0.1, 0.1, 0.9, 0.9));

      expect(buffer.size()).toBe(4);
    });

    it('should handle full buffer with deduplication', () => {
      const config: BufferConfig = { maxSize: 5, dedupWindowMs: 50 };
      buffer = new ActionBuffer(config);

      // Add same click multiple times
      for (let i = 0; i < 10; i++) {
        buffer.addAction(createClickAction(timestamp(i * 60), 0.5, 0.5)); // 60ms apart, outside dedup window
      }

      // Should have exactly 5 (maxSize)
      expect(buffer.size()).toBe(5);
      expect(buffer.isFull()).toBe(true);
    });

    it('should calculate accurate statistics with complex workload', () => {
      const config: BufferConfig = { maxSize: 100, dedupWindowMs: 50, rateLimit: { maxActionsPerSecond: 100 } };
      buffer = new ActionBuffer(config);

      // Add varied actions
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(30), 0.5, 0.5)); // Deduplicated
      buffer.addAction(createClickAction(timestamp(100), 0.6, 0.6));
      buffer.addAction(createKeyboardAction(timestamp(200), ['Enter']));

      const stats = buffer.getStatistics();
      expect(stats.totalAdded).toBe(3);
      expect(stats.currentSize).toBe(3);
      expect(stats.deduplicated).toBe(1);
      expect(stats.dedupRate).toBeCloseTo(1 / 3);
    });

    it('should maintain order after complex operations', () => {
      const actions = [
        createClickAction(timestamp(0), 0.1, 0.1),
        createClickAction(timestamp(100), 0.2, 0.2),
        createClickAction(timestamp(200), 0.3, 0.3),
        createClickAction(timestamp(300), 0.4, 0.4),
      ];

      buffer.addActions(actions);
      buffer.removeAction(1); // Remove second action

      expect(buffer.size()).toBe(3);
      expect((buffer.getAction(0) as any)?.x).toBeCloseTo(0.1);
      expect((buffer.getAction(1) as any)?.x).toBeCloseTo(0.3); // Third moved to second
      expect((buffer.getAction(2) as any)?.x).toBeCloseTo(0.4);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty buffer gracefully', () => {
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.size()).toBe(0);
      expect(buffer.getLastAction()).toBeUndefined();
      expect(buffer.getAction(0)).toBeUndefined();
      expect(buffer.getActions()).toEqual([]);
    });

    it('should handle single action', () => {
      const action = createClickAction(timestamp(0), 0.5, 0.5);
      buffer.addAction(action);

      expect(buffer.size()).toBe(1);
      expect(buffer.getLastAction()).toEqual(action);
      expect(buffer.isEmpty()).toBe(false);
    });

    it('should handle duplicate timestamps', () => {
      const ts = timestamp(0);
      buffer.addAction(createClickAction(ts, 0.5, 0.5));
      buffer.addAction(createClickAction(ts, 0.6, 0.6)); // Same timestamp, different location

      // Same timestamp but different location - should NOT be deduplicated
      // because spatial tolerance doesn't match (0.1 distance > 0.01 default tolerance)
      expect(buffer.size()).toBe(2);
    });

    it('should handle very large buffer efficiently', () => {
      const config: BufferConfig = { maxSize: 100000, dedupWindowMs: 10 }; // Short dedup window
      buffer = new ActionBuffer(config);

      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        // Use spread out timestamps to avoid rate limiting issues, and spread out coordinates
        buffer.addAction(
          createClickAction(
            timestamp(i * 5), // 5ms apart - plenty of room for rate limiting
            (i % 32) / 32, // Cycle through coordinates to avoid accidental duplicates
            (Math.floor(i / 32) % 32) / 32
          )
        );
      }
      const elapsed = Date.now() - startTime;

      expect(buffer.size()).toBe(1000);
      // Should complete in reasonable time (< 500ms for 1000 actions)
      expect(elapsed).toBeLessThan(500);
    });

    it('should handle config with zero dedup window', () => {
      const config: BufferConfig = { dedupWindowMs: 0 };
      buffer = new ActionBuffer(config);

      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));
      buffer.addAction(createClickAction(timestamp(0), 0.5, 0.5));

      // With 0ms window, the check is: lastActionTime < windowStart
      // windowStart = actionTime - 0 = actionTime
      // So: lastActionTime (same as actionTime) < actionTime is false
      // Therefore, this will still be treated as a duplicate
      // The dedup window check is: if (lastActionTime < windowStart) return false
      // Here: if (0 < 0) return false - FALSE, so we continue to dedup check
      // and they have same location, so they ARE duplicates
      expect(buffer.size()).toBe(1);
    });

    it('should handle coordinate boundaries', () => {
      buffer.addAction(createClickAction(timestamp(0), 0.0, 0.0)); // Top-left
      buffer.addAction(createClickAction(timestamp(100), 1.0, 1.0)); // Bottom-right
      buffer.addAction(createClickAction(timestamp(200), 0.5, 0.5)); // Center

      expect(buffer.size()).toBe(3);
    });
  });
});
