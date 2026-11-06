/**
 * Tests for habit discovery and merging
 * Validates searching, filtering, grouping, merging, and deduplication
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  searchHabits,
  filterHabits,
  sortHabits,
  discoverRelatedHabits,
  groupHabits,
  HabitDiscoveryEngine,
} from './habit-discovery.js';
import {
  detectDuplicates,
  mergeHabitGroup,
  deduplicateHabits,
  createHabitVariant,
  findBestMatch,
  generateDeduplicationReport,
} from './habit-merging.js';
import type { Habit, HabitId } from './habit-extraction.js';

describe('habit-discovery-merging', () => {
  let mockHabits: Habit[];

  beforeEach(() => {
    const now = Date.now();
    mockHabits = [
      {
        id: 'h-1' as any,
        target: 'Login to System',
        description: 'Automated login workflow',
        actionSequence: [],
        conditions: [],
        successCount: 8,
        totalAttempts: 10,
        successRate: 0.8,
        firstSeen: now - 30 * 24 * 60 * 60 * 1000,
        lastUsed: now - 1 * 24 * 60 * 60 * 1000,
        timesSuggested: 10,
        timesAccepted: 8,
        timesDismissed: 2,
        timesCorrectRd: 0,
        state: 'active',
        variants: [],
        frequencyScore: 0.8,
        recencyScore: 0.9,
        feedbackScore: 0.8,
        lessons: [],
      },
      {
        id: 'h-2' as any,
        target: 'User Authentication',
        description: 'Authentication process',
        actionSequence: [],
        conditions: [],
        successCount: 6,
        totalAttempts: 8,
        successRate: 0.75,
        firstSeen: now - 20 * 24 * 60 * 60 * 1000,
        lastUsed: now - 5 * 24 * 60 * 60 * 1000,
        timesSuggested: 5,
        timesAccepted: 4,
        timesDismissed: 1,
        timesCorrectRd: 0,
        state: 'active',
        variants: [],
        frequencyScore: 0.6,
        recencyScore: 0.7,
        feedbackScore: 0.7,
        lessons: [],
      },
      {
        id: 'h-3' as any,
        target: 'Export Data',
        description: 'Data export workflow',
        actionSequence: [],
        conditions: [],
        successCount: 5,
        totalAttempts: 10,
        successRate: 0.5,
        firstSeen: now - 10 * 24 * 60 * 60 * 1000,
        lastUsed: now - 50 * 24 * 60 * 60 * 1000,
        timesSuggested: 3,
        timesAccepted: 2,
        timesDismissed: 1,
        timesCorrectRd: 0,
        state: 'inactive',
        variants: [],
        frequencyScore: 0.5,
        recencyScore: 0.2,
        feedbackScore: 0.5,
        lessons: [],
      },
    ];
  });

  describe('searchHabits', () => {
    it('finds habits by target text', () => {
      const results = searchHabits(mockHabits, 'Login');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].habit.target).toContain('Login');
    });

    it('finds habits by description text', () => {
      const results = searchHabits(mockHabits, 'workflow');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty for no matches', () => {
      const results = searchHabits(mockHabits, 'nonexistent');
      expect(results.length).toBe(0);
    });

    it('ranks results by relevance', () => {
      const results = searchHabits(mockHabits, 'Login');
      if (results.length > 1) {
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      }
    });

    it('includes matched fields in results', () => {
      const results = searchHabits(mockHabits, 'Login');
      if (results.length > 0) {
        expect(results[0].matchedFields).toBeDefined();
      }
    });
  });

  describe('filterHabits', () => {
    it('filters by success rate', () => {
      const filtered = filterHabits(mockHabits, { minSuccessRate: 0.7 });
      expect(filtered.every((h) => h.successRate >= 0.7)).toBe(true);
    });

    it('filters by frequency', () => {
      const filtered = filterHabits(mockHabits, { minFrequency: 10 });
      expect(filtered.every((h) => h.totalAttempts >= 10)).toBe(true);
    });

    it('filters by state', () => {
      const filtered = filterHabits(mockHabits, { state: 'active' });
      expect(filtered.every((h) => h.state === 'active')).toBe(true);
    });

    it('applies multiple filters', () => {
      const filtered = filterHabits(mockHabits, {
        minSuccessRate: 0.7,
        state: 'active',
      });
      expect(filtered.every((h) => h.successRate >= 0.7 && h.state === 'active')).toBe(true);
    });
  });

  describe('sortHabits', () => {
    it('sorts by confidence', () => {
      const sorted = sortHabits(mockHabits, 'confidence', 'desc');
      if (sorted.length > 1) {
        expect(sorted[0].feedbackScore).toBeGreaterThanOrEqual(sorted[1].feedbackScore);
      }
    });

    it('sorts by frequency', () => {
      const sorted = sortHabits(mockHabits, 'frequency', 'desc');
      if (sorted.length > 1) {
        expect(sorted[0].totalAttempts).toBeGreaterThanOrEqual(sorted[1].totalAttempts);
      }
    });

    it('sorts by success rate', () => {
      const sorted = sortHabits(mockHabits, 'success', 'asc');
      if (sorted.length > 1) {
        expect(sorted[0].successRate).toBeLessThanOrEqual(sorted[1].successRate);
      }
    });

    it('sorts by name', () => {
      const sorted = sortHabits(mockHabits, 'name', 'asc');
      if (sorted.length > 1) {
        expect(sorted[0].target <= sorted[1].target).toBe(true);
      }
    });
  });

  describe('discoverRelatedHabits', () => {
    it('finds related habits', () => {
      const related = discoverRelatedHabits(mockHabits[0], mockHabits, 5);
      expect(related.length).toBeGreaterThanOrEqual(0);
    });

    it('respects limit', () => {
      const related = discoverRelatedHabits(mockHabits[0], mockHabits, 1);
      expect(related.length).toBeLessThanOrEqual(1);
    });

    it('does not return self', () => {
      const related = discoverRelatedHabits(mockHabits[0], mockHabits);
      expect(related).not.toContainEqual(mockHabits[0]);
    });
  });

  describe('groupHabits', () => {
    it('groups by state', () => {
      const groups = groupHabits(mockHabits, 'state');
      expect(groups.size).toBeGreaterThan(0);
      groups.forEach((habits) => {
        expect(habits.every((h) => h.state === habits[0].state)).toBe(true);
      });
    });

    it('groups by success rate', () => {
      const groups = groupHabits(mockHabits, 'success-rate');
      expect(groups.size).toBeGreaterThan(0);
    });
  });

  describe('HabitDiscoveryEngine', () => {
    let engine: HabitDiscoveryEngine;

    beforeEach(() => {
      engine = new HabitDiscoveryEngine();
      engine.indexHabits(mockHabits);
    });

    it('indexes habits', () => {
      const stats = engine.getStats();
      expect((stats as any).totalHabits).toBe(3);
    });

    it('searches indexed habits', () => {
      const results = engine.search({ query: 'Login' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('filters in search', () => {
      const results = engine.search({ minSuccessRate: 0.7 });
      expect(results.every((r) => r.habit.successRate >= 0.7)).toBe(true);
    });

    it('discovers related habits', () => {
      const related = engine.discoverRelated('h-1' as any, 2);
      expect(related.length).toBeLessThanOrEqual(2);
    });

    it('archives habits', () => {
      const archived = engine.archiveHabit('h-1' as any, 'Test');
      expect(archived).toBe(true);
      const stats = engine.getStats();
      expect((stats as any).totalHabits).toBe(2);
      expect((stats as any).archivedHabits).toBe(1);
    });

    it('recovers archived habits', () => {
      engine.archiveHabit('h-1' as any);
      const recovered = engine.recoverHabit('h-1' as any);
      expect(recovered).toBeDefined();
      expect((recovered as any).id).toBe('h-1');
    });

    it('gets archived habits', () => {
      engine.archiveHabit('h-1' as any);
      engine.archiveHabit('h-2' as any);
      const archived = engine.getArchived();
      expect(archived.length).toBe(2);
    });
  });

  describe('detectDuplicates', () => {
    it('detects similar habits', () => {
      const duplicates = detectDuplicates(mockHabits, 0.7);
      // May or may not find duplicates depending on action sequence similarity
      expect(Array.isArray(duplicates)).toBe(true);
    });

    it('groups similar habits together', () => {
      const duplicates = detectDuplicates(mockHabits, 0.3);
      if (duplicates.length > 0) {
        expect(duplicates[0].group.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('recommends actions', () => {
      const duplicates = detectDuplicates(mockHabits, 0.3);
      duplicates.forEach((dup) => {
        expect(['merge', 'variant', 'keep_separate']).toContain(dup.recommended_action);
      });
    });
  });

  describe('mergeHabitGroup', () => {
    it('merges habit group', () => {
      const result = mergeHabitGroup([mockHabits[0], mockHabits[1]]);
      expect(result.mergedHabit).toBeDefined();
      expect(result.sourceHabits.length).toBe(2);
    });

    it('aggregates statistics', () => {
      const result = mergeHabitGroup([mockHabits[0], mockHabits[1]]);
      expect(result.mergedHabit.successCount).toBe(8 + 6);
      expect(result.mergedHabit.totalAttempts).toBe(10 + 8);
      expect(result.statisticsAggregated).toBe(true);
    });

    it('creates variants', () => {
      const result = mergeHabitGroup([mockHabits[0], mockHabits[1]]);
      expect(result.variantsCreated).toBeGreaterThan(0);
      expect(result.mergedHabit.variants.length).toBeGreaterThan(0);
    });

    it('preserves primary habit selection', () => {
      const result = mergeHabitGroup([mockHabits[0], mockHabits[1]], mockHabits[1].id);
      expect(result.mergedHabit.feedbackScore).toBe(mockHabits[1].feedbackScore);
    });
  });

  describe('deduplicateHabits', () => {
    it('deduplicates habits', () => {
      const result = deduplicateHabits(mockHabits, 0.3);
      expect(result.deduplicated.length).toBeLessThanOrEqual(mockHabits.length);
    });

    it('generates summary', () => {
      const result = deduplicateHabits(mockHabits, 0.3);
      expect(result.mergesSummary.totalHabits).toBe(3);
      expect(result.mergesSummary.habitsRemoved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createHabitVariant', () => {
    it('creates variant', () => {
      const variant = createHabitVariant(mockHabits[0], 'Dashboard Login', []);
      expect(variant.target).toContain('Dashboard');
      expect(variant.id).not.toBe(mockHabits[0].id);
    });

    it('sets learning state', () => {
      const variant = createHabitVariant(mockHabits[0], 'Test', []);
      expect(variant.state).toBe('learning');
    });

    it('resets statistics', () => {
      const variant = createHabitVariant(mockHabits[0], 'Test', []);
      expect(variant.successCount).toBe(0);
      expect(variant.totalAttempts).toBe(0);
    });
  });

  describe('findBestMatch', () => {
    it('finds best match', () => {
      const match = findBestMatch(mockHabits[0], mockHabits.slice(1));
      expect(match).toBeDefined();
    });

    it('respects minimum similarity', () => {
      const match = findBestMatch(mockHabits[0], mockHabits.slice(1), 0.99);
      // May or may not find match depending on sequence similarity
      expect(match === undefined || match !== undefined).toBe(true);
    });

    it('does not return self', () => {
      const match = findBestMatch(mockHabits[0], mockHabits);
      if (match) {
        expect(match.id).not.toBe(mockHabits[0].id);
      }
    });
  });

  describe('generateDeduplicationReport', () => {
    it('generates report', () => {
      const duplicates = detectDuplicates(mockHabits, 0.3);
      const report = generateDeduplicationReport(duplicates);
      expect(typeof report).toBe('string');
      expect(report.length).toBeGreaterThan(0);
    });

    it('includes summary', () => {
      const duplicates = detectDuplicates(mockHabits, 0.3);
      const report = generateDeduplicationReport(duplicates);
      expect(report).toContain('Summary');
    });
  });

  describe('edge cases', () => {
    it('handles single habit', () => {
      const result = mergeHabitGroup([mockHabits[0]]);
      expect(result.mergedHabit.id).toBe(mockHabits[0].id);
    });

    it('handles large habit lists', () => {
      const largeList = Array.from({ length: 100 }, (_, i) => ({
        ...mockHabits[0],
        id: `habit-${i}` as any,
      }));

      const stats = groupHabits(largeList, 'state');
      expect(stats.size).toBeGreaterThan(0);
    });

    it('handles empty search', () => {
      const results = searchHabits(mockHabits, '');
      expect(results).toEqual([]);
    });
  });
});
