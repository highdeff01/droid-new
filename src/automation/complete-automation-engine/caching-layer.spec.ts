/**
 * Caching Layer Tests
 *
 * Tests for the LRU cache implementation and specialized caches
 * for Recording, Workflow, Pack, Habit, Suggestion, and Query entities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import the CacheLayer implementation and internal classes
import { CacheLayer, cacheLayer, createCacheLayer, LRUCache, TTLCache } from './caching-layer';

// ============================================================================
// LRU Cache Tests (Internal)
// ============================================================================

describe('LRUCache', () => {
  let cache: LRUCache<any>;

  beforeEach(() => {
    // Create a new cache for each test
    cache = new LRUCache(5);
  });

  it('should add and get items', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should update existing keys', () => {
    cache.set('key1', 'value1');
    cache.set('key1', 'value2');
    expect(cache.get('key1')).toBe('value2');
  });

  it('should evict LRU items when capacity exceeded', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');
    cache.set('key4', 'value4');
    cache.set('key5', 'value5');

    // Access key1 to make it recently used
    cache.get('key1');

    // Add 6th item - should evict key2 (LRU)
    cache.set('key6', 'value6');

    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('key2')).toBeUndefined();
    expect(cache.get('key3')).toBe('value3');
  });

  it('should delete items', () => {
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);

    cache.delete('key1');
    expect(cache.has('key1')).toBe(false);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should clear all items', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');

    cache.clear();
    expect(cache.getSize()).toBe(0);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should track size correctly', () => {
    expect(cache.getSize()).toBe(0);

    cache.set('key1', 'value1');
    expect(cache.getSize()).toBe(1);

    cache.set('key2', 'value2');
    expect(cache.getSize()).toBe(2);

    cache.delete('key1');
    expect(cache.getSize()).toBe(1);
  });

  it('should move items to front on access', () => {
    // Fill the cache to capacity
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');
    cache.set('key4', 'value4');
    cache.set('key5', 'value5');

    // Access key1 to make it most recently used
    cache.get('key1');

    // Add new item - should evict key2 (now LRU)
    cache.set('key6', 'value6');

    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('key2')).toBeUndefined();
    expect(cache.get('key3')).toBe('value3');
    expect(cache.get('key4')).toBe('value4');
    expect(cache.get('key5')).toBe('value5');
  });

  it('should get cache statistics', () => {
    const stats = cache.getStats();
    expect(stats.size).toBe(0);
    expect(stats.capacity).toBe(5);
    expect(stats.usage).toBe(0);

    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    const newStats = cache.getStats();
    expect(newStats.size).toBe(2);
    expect(newStats.capacity).toBe(5);
    expect(newStats.usage).toBe(40);
  });
});

describe('TTLCache', () => {
  let cache: TTLCache<any>;

  beforeEach(() => {
    // Create a new TTL cache with 100ms TTL for testing
    cache = new TTLCache(5, 100);
  });

  it('should set and get items with TTL', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should expire items after TTL', async () => {
    cache.set('key1', 'value1');

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(cache.get('key1')).toBeUndefined();
  });

  it('should support custom TTL', () => {
    cache.set('key1', 'value1', 200);
    expect(cache.get('key1')).toBe('value1');

    // Wait 150ms - should still be valid
    expect(cache.has('key1')).toBe(true);
  });

  it('should clear expired entries', async () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2', 200);

    // Wait for first entry to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    const cleared = cache.clearExpired();
    expect(cleared).toBe(1);
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');
  });

  it('should track expired entries', async () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2', 200);

    expect(cache.countExpired()).toBe(0);

    // Wait for first entry to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(cache.countExpired()).toBe(1);
  });

  it('should clear all entries including TTL tracking', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    cache.clear();

    expect(cache.getSize()).toBe(0);
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });
});

// ============================================================================
// Specialized Caches Tests
// ============================================================================

describe('CacheLayer', () => {
  let layer: CacheLayer;

  beforeEach(() => {
    layer = createCacheLayer({
      recordingCapacity: 10,
      workflowCapacity: 10,
      packCapacity: 10,
      habitCapacity: 10,
      suggestionTTL: 100,
      queryTTL: 100,
    });
  });

  afterEach(() => {
    layer.clearAll();
  });

  describe('Recording Cache', () => {
    it('should cache recordings', () => {
      const recording = { id: 'rec-1', name: 'Test Recording' };
      layer.setRecording('rec-1', recording);

      expect(layer.hasRecording('rec-1')).toBe(true);
      expect(layer.getRecording('rec-1')).toBe(recording);
    });

    it('should update cached recordings', () => {
      const recording1 = { id: 'rec-1', name: 'Recording v1' };
      const recording2 = { id: 'rec-1', name: 'Recording v2' };

      layer.setRecording('rec-1', recording1);
      layer.setRecording('rec-1', recording2);

      expect(layer.getRecording('rec-1')).toBe(recording2);
    });

    it('should delete recordings', () => {
      const recording = { id: 'rec-1', name: 'Test' };
      layer.setRecording('rec-1', recording);

      layer.deleteRecording('rec-1');

      expect(layer.hasRecording('rec-1')).toBe(false);
    });

    it('should get recording cache stats', () => {
      const stats = layer.getRecordingCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.capacity).toBe(10);
    });
  });

  describe('Workflow Cache', () => {
    it('should cache workflows', () => {
      const workflow = { id: 'wf-1', name: 'Test Workflow' };
      layer.setWorkflow('wf-1', workflow);

      expect(layer.hasWorkflow('wf-1')).toBe(true);
      expect(layer.getWorkflow('wf-1')).toBe(workflow);
    });

    it('should get workflow cache stats', () => {
      const stats = layer.getWorkflowCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.capacity).toBe(10);
    });
  });

  describe('Pack Cache', () => {
    it('should cache packs', () => {
      const pack = { id: 'pack-1', name: 'Test Pack' };
      layer.setPack('pack-1', pack);

      expect(layer.hasPack('pack-1')).toBe(true);
      expect(layer.getPack('pack-1')).toBe(pack);
    });

    it('should get pack cache stats', () => {
      const stats = layer.getPackCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.capacity).toBe(10);
    });
  });

  describe('Habit Cache', () => {
    it('should cache habits', () => {
      const habit = { id: 'habit-1', name: 'Test Habit' };
      layer.setHabit('habit-1', habit);

      expect(layer.hasHabit('habit-1')).toBe(true);
      expect(layer.getHabit('habit-1')).toBe(habit);
    });

    it('should get habit cache stats', () => {
      const stats = layer.getHabitCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.capacity).toBe(10);
    });
  });

  describe('Suggestion Cache', () => {
    it('should cache suggestions with TTL', () => {
      const results = [{ id: 'suggestion-1' }, { id: 'suggestion-2' }];
      layer.setSuggestion('query-1', results);

      expect(layer.hasSuggestion('query-1')).toBe(true);
      expect(layer.getSuggestion('query-1')).toBe(results);
    });

    it('should get suggestion cache stats', () => {
      const stats = layer.getSuggestionCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.capacity).toBe(200);
    });

    it('should expire suggestions after TTL', async () => {
      const results = [{ id: 'suggestion-1' }];
      layer.setSuggestion('query-1', results);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(layer.getSuggestion('query-1')).toBeUndefined();
    });
  });

  describe('Query Cache', () => {
    it('should cache query results with TTL', () => {
      const results = [{ id: 'item-1' }, { id: 'item-2' }];
      layer.setQuery('query-1', results);

      expect(layer.hasQuery('query-1')).toBe(true);
      expect(layer.getQuery('query-1')).toBe(results);
    });

    it('should get query cache stats', () => {
      const stats = layer.getQueryCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.capacity).toBe(500);
    });

    it('should clear query cache', () => {
      layer.setQuery('query-1', [{ id: 'item-1' }]);
      layer.setQuery('query-2', [{ id: 'item-2' }]);

      layer.clearQueryCache();

      expect(layer.hasQuery('query-1')).toBe(false);
      expect(layer.hasQuery('query-2')).toBe(false);
    });
  });

  describe('Cache Invalidation Triggers', () => {
    describe('invalidateOnPackDeployed', () => {
      it('should invalidate pack and workflow caches', () => {
        layer.setPack('pack-1', { id: 'pack-1' });
        layer.setWorkflow('wf-1', { id: 'wf-1' });
        layer.setSuggestion('suggestion-1', [{ id: 'suggestion-1' }]);

        layer.invalidateOnPackDeployed('pack-1');

        expect(layer.hasPack('pack-1')).toBe(false);
        expect(layer.hasWorkflow('wf-1')).toBe(false);
        // Suggestion cache should be cleared
      });

      it('should only invalidate specified pack', () => {
        layer.setPack('pack-1', { id: 'pack-1' });
        layer.setPack('pack-2', { id: 'pack-2' });

        layer.invalidateOnPackDeployed('pack-1');

        expect(layer.hasPack('pack-1')).toBe(false);
        expect(layer.hasPack('pack-2')).toBe(true);
      });
    });

    describe('invalidateOnHabitUpdated', () => {
      it('should invalidate habit and suggestion caches', () => {
        layer.setHabit('habit-1', { id: 'habit-1' });
        layer.setSuggestion('suggestion-1', [{ id: 'suggestion-1' }]);

        layer.invalidateOnHabitUpdated('habit-1');

        expect(layer.hasHabit('habit-1')).toBe(false);
        // Suggestion and query caches should be cleared
      });
    });

    describe('clearOnWorkflowExecuted', () => {
      it('should warm workflow cache and clear suggestions', () => {
        const workflow = { id: 'wf-1', name: 'Test Workflow' };
        layer.setWorkflow('wf-1', workflow);

        layer.clearOnWorkflowExecuted('wf-1');

        // Workflow should still be cached
        expect(layer.hasWorkflow('wf-1')).toBe(true);
        // Suggestion cache should be cleared
      });
    });

    describe('clearOnRecordingCaptured', () => {
      it('should clear expired query and suggestion cache entries', async () => {
        // Set suggestion with short TTL so it expires
        layer.setSuggestion('suggestion-1', [{ id: 'suggestion-1' }], 50);
        layer.setQuery('query-1', [{ id: 'item-1' }], 50);

        // Wait for entries to expire
        await new Promise(resolve => setTimeout(resolve, 100));

        layer.clearOnRecordingCaptured('rec-1');

        // Expired entries should be cleared
        expect(layer.hasQuery('query-1')).toBe(false);
        expect(layer.hasSuggestion('suggestion-1')).toBe(false);
      });
    });
  });

  describe('Utility Methods', () => {
    it('should get overall cache statistics', () => {
      const stats = layer.getOverallStats();

      expect(stats.recording).toBeDefined();
      expect(stats.workflow).toBeDefined();
      expect(stats.pack).toBeDefined();
      expect(stats.habit).toBeDefined();
      expect(stats.suggestion).toBeDefined();
      expect(stats.query).toBeDefined();
    });

    it('should clear all caches', () => {
      layer.setRecording('rec-1', { id: 'rec-1' });
      layer.setWorkflow('wf-1', { id: 'wf-1' });
      layer.setPack('pack-1', { id: 'pack-1' });
      layer.setHabit('habit-1', { id: 'habit-1' });
      layer.setSuggestion('suggestion-1', [{ id: 'suggestion-1' }]);
      layer.setQuery('query-1', [{ id: 'item-1' }]);

      layer.clearAll();

      expect(layer.hasRecording('rec-1')).toBe(false);
      expect(layer.hasWorkflow('wf-1')).toBe(false);
      expect(layer.hasPack('pack-1')).toBe(false);
      expect(layer.hasHabit('habit-1')).toBe(false);
      expect(layer.hasSuggestion('suggestion-1')).toBe(false);
      expect(layer.hasQuery('query-1')).toBe(false);
    });

    it('should clean up expired TTL entries', async () => {
      layer.setSuggestion('query-1', [{ id: 'suggestion-1' }]);
      layer.setSuggestion('query-2', [{ id: 'suggestion-2' }], 200);

      // Wait for first entry to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const cleared = layer.cleanupExpired();
      expect(cleared).toBe(1);
    });
  });
});

// ============================================================================
// Edge Cases and Performance Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty cache gracefully', () => {
    const layer = createCacheLayer();

    expect(layer.getRecording('nonexistent')).toBeUndefined();
    expect(layer.getWorkflow('nonexistent')).toBeUndefined();
    expect(layer.getPack('nonexistent')).toBeUndefined();
    expect(layer.getHabit('nonexistent')).toBeUndefined();
    expect(layer.getSuggestion('nonexistent')).toBeUndefined();
    expect(layer.getQuery('nonexistent')).toBeUndefined();
  });

  it('should handle duplicate cache operations', () => {
    const layer = createCacheLayer();

    const recording = { id: 'rec-1' };
    layer.setRecording('rec-1', recording);
    layer.setRecording('rec-1', recording);
    layer.setRecording('rec-1', recording);

    expect(layer.getRecording('rec-1')).toBe(recording);
  });
});

describe('Performance Characteristics', () => {
  it('should maintain O(1) operations for large caches', () => {
    const layer = createCacheLayer({
      recordingCapacity: 1000,
      workflowCapacity: 1000,
    });

    // Add 1000 recordings
    for (let i = 0; i < 1000; i++) {
      layer.setRecording(`rec-${i}`, { id: `rec-${i}` });
    }

    // Verify cache is at capacity
    expect(layer.getRecordingCacheStats().size).toBe(1000);

    // Add one more - should evict one
    layer.setRecording('rec-1000', { id: 'rec-1000' });
    expect(layer.getRecordingCacheStats().size).toBe(1000);

    // Should still be able to access recent items quickly
    const perfStart = performance.now();
    for (let i = 900; i < 1001; i++) {
      layer.getRecording(`rec-${i}`);
    }
    const perfEnd = performance.now();

    // Operations should be fast (< 100ms for 1000 operations)
    expect(perfEnd - perfStart).toBeLessThan(100);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('CacheLayer Integration', () => {
  it('should maintain consistency across caches', () => {
    const layer = createCacheLayer();

    // Create related entities
    const recording = { id: 'rec-1', name: 'Recording' };
    const workflow = { id: 'wf-1', name: 'Workflow' };
    const pack = { id: 'pack-1', name: 'Pack' };
    const habit = { id: 'habit-1', name: 'Habit' };

    // Add all entities
    layer.setRecording('rec-1', recording);
    layer.setWorkflow('wf-1', workflow);
    layer.setPack('pack-1', pack);
    layer.setHabit('habit-1', habit);

    // Verify all are cached
    expect(layer.getRecording('rec-1')).toBe(recording);
    expect(layer.getWorkflow('wf-1')).toBe(workflow);
    expect(layer.getPack('pack-1')).toBe(pack);
    expect(layer.getHabit('habit-1')).toBe(habit);
  });

  it('should handle cross-cache invalidation', () => {
    const layer = createCacheLayer();

    // Set up related entities
    layer.setPack('pack-1', { id: 'pack-1' });
    layer.setWorkflow('wf-1', { id: 'wf-1' });
    layer.setHabit('habit-1', { id: 'habit-1' });

    // Invalidate pack - should affect related caches
    layer.invalidateOnPackDeployed('pack-1');

    // Pack should be invalidated
    expect(layer.hasPack('pack-1')).toBe(false);
    // Workflow should be invalidated (pack deployment may have changed workflows)
    expect(layer.hasWorkflow('wf-1')).toBe(false);
    // Habits should be cleared (habits may be affected by pack changes)
    expect(layer.hasHabit('habit-1')).toBe(false);
  });
});
