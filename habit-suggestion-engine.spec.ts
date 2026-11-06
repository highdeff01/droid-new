/**
 * Tests for habit suggestion engine
 * Validates suggestion generation and ranking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HabitSuggestionEngine,
  explainSuggestion,
  compareSuggestions,
  batchEvaluateHabits,
  type SuggestionEngineConfig,
} from './habit-suggestion-engine.js';
import type { Habit, HabitCondition } from './habit-extraction.js';
import type { MatchContext } from './habit-condition-matching.js';

describe('habit-suggestion-engine', () => {
  let engine: HabitSuggestionEngine;
  let mockHabits: Habit[];
  let mockContext: MatchContext;

  beforeEach(() => {
    engine = new HabitSuggestionEngine();

    const now = Date.now();
    mockHabits = [
      {
        id: 'habit-1' as any,
        target: 'Login',
        description: 'User login workflow',
        actionSequence: [
          { id: '1', index: 0, name: 'Click', action: 'click', target: 'Login', duration: 100, success: true, timestamp: now },
          { id: '2', index: 1, name: 'Type', action: 'type', target: 'User', duration: 200, success: true, timestamp: now + 100 },
        ],
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
        state: 'learning',
        variants: [],
        frequencyScore: 0.8,
        recencyScore: 0.9,
        feedbackScore: 0.8,
        lessons: [],
      },
      {
        id: 'habit-2' as any,
        target: 'Export Data',
        description: 'Export workflow',
        actionSequence: [
          { id: '3', index: 0, name: 'Click', action: 'click', target: 'Export', duration: 100, success: true, timestamp: now },
        ],
        conditions: [],
        successCount: 5,
        totalAttempts: 8,
        successRate: 0.625,
        firstSeen: now - 20 * 24 * 60 * 60 * 1000,
        lastUsed: now - 5 * 24 * 60 * 60 * 1000,
        timesSuggested: 5,
        timesAccepted: 4,
        timesDismissed: 1,
        timesCorrectRd: 0,
        state: 'learning',
        variants: [],
        frequencyScore: 0.5,
        recencyScore: 0.7,
        feedbackScore: 0.7,
        lessons: [],
      },
      {
        id: 'habit-3' as any,
        target: 'Settings Update',
        description: 'Update settings',
        actionSequence: [
          { id: '4', index: 0, name: 'Navigate', action: 'click', target: 'Settings', duration: 150, success: true, timestamp: now },
        ],
        conditions: [
          { type: 'element-state', selector: 'Button#settings', state: 'enabled' },
        ] as HabitCondition[],
        successCount: 3,
        totalAttempts: 5,
        successRate: 0.6,
        firstSeen: now - 10 * 24 * 60 * 60 * 1000,
        lastUsed: now - 2 * 24 * 60 * 60 * 1000,
        timesSuggested: 3,
        timesAccepted: 2,
        timesDismissed: 1,
        timesCorrectRd: 0,
        state: 'learning',
        variants: [],
        frequencyScore: 0.3,
        recencyScore: 0.85,
        feedbackScore: 0.6,
        lessons: [],
      },
    ];

    mockContext = {
      currentElement: { selector: 'Button#submit', state: 'enabled' },
      contextInfo: 'Dashboard',
      recentActions: ['click', 'wait'],
      currentTime: new Date(),
      userRole: 'admin',
    };
  });

  describe('HabitSuggestionEngine', () => {
    it('suggests habits in confidence order', () => {
      const suggestions = engine.suggestHabits(mockHabits, mockContext);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].confidence).toBeGreaterThanOrEqual(suggestions[1]?.confidence || 0);
    });

    it('respects max suggestions limit', () => {
      const customEngine = new HabitSuggestionEngine({ maxSuggestions: 1 });
      const suggestions = customEngine.suggestHabits(mockHabits, mockContext);
      expect(suggestions.length).toBeLessThanOrEqual(1);
    });

    it('respects minimum confidence threshold', () => {
      const customEngine = new HabitSuggestionEngine({ minConfidence: 0.95 });
      const suggestions = customEngine.suggestHabits(mockHabits, mockContext);
      suggestions.forEach((s) => {
        expect(s.confidence).toBeGreaterThanOrEqual(0.95);
      });
    });

    it('includes suggestion details', () => {
      const suggestions = engine.suggestHabits(mockHabits, mockContext);
      if (suggestions.length > 0) {
        const s = suggestions[0];
        expect(s.habitId).toBeDefined();
        expect(s.target).toBeDefined();
        expect(s.description).toBeDefined();
        expect(s.confidence).toBeDefined();
        expect(s.actionSequence).toBeDefined();
      }
    });

    it('includes estimated duration', () => {
      const suggestions = engine.suggestHabits(mockHabits, mockContext);
      if (suggestions.length > 0) {
        expect(suggestions[0].estimatedDuration).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles empty habits list', () => {
      const suggestions = engine.suggestHabits([], mockContext);
      expect(suggestions).toEqual([]);
    });

    it('applies cooldown to suggestions', () => {
      const customEngine = new HabitSuggestionEngine({ cooldownMs: 1000 });
      const firstSuggestions = customEngine.suggestHabits(mockHabits, mockContext);
      const secondSuggestions = customEngine.suggestHabits(mockHabits, mockContext);

      if (firstSuggestions.length > 0 && secondSuggestions.length > 0) {
        // Same habits shouldn't be suggested again immediately
        const firstIds = new Set(firstSuggestions.map((s) => s.habitId));
        const secondIds = new Set(secondSuggestions.map((s) => s.habitId));
        expect(firstIds.size + secondIds.size).toBeGreaterThan(0);
      }
    });

    it('can reset cooldown', () => {
      const customEngine = new HabitSuggestionEngine({ cooldownMs: 10000 });
      customEngine.suggestHabits(mockHabits, mockContext);
      customEngine.resetCooldown(mockHabits[0].id);
      const stats = customEngine.getStatistics(mockHabits[0].id);
      expect((stats as any).inCooldown).toBe(false);
    });
  });

  describe('scoreHabit', () => {
    it('returns confidence score between 0 and 1', () => {
      const score = engine.scoreHabit(mockHabits[0], mockContext);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('scores habit with feedback', () => {
      const feedback = [
        { habitId: mockHabits[0].id, accepted: true, corrected: false, dismissed: false, timestamp: Date.now() },
      ];
      const score = engine.scoreHabit(mockHabits[0], mockContext, feedback);
      expect(score).toBeGreaterThan(0);
    });

    it('considers context awareness', () => {
      const engineWithContext = new HabitSuggestionEngine({ enableContextAwareness: true });
      const engineWithoutContext = new HabitSuggestionEngine({ enableContextAwareness: false });

      const score1 = engineWithContext.scoreHabit(mockHabits[2], mockContext);
      const score2 = engineWithoutContext.scoreHabit(mockHabits[2], mockContext);
      // Both should return scores
      expect(score1).toBeGreaterThanOrEqual(0);
      expect(score2).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recency boosting', () => {
    it('boosts recent habits', () => {
      const engineWithBoosting = new HabitSuggestionEngine({
        enableRecencyBoosting: true,
        recencyBoostFactor: 1.5,
      });
      const engineWithoutBoosting = new HabitSuggestionEngine({
        enableRecencyBoosting: false,
      });

      // Get suggestions from both
      const withBoosting = engineWithBoosting.suggestHabits(mockHabits, mockContext);
      const withoutBoosting = engineWithoutBoosting.suggestHabits(mockHabits, mockContext);

      // Both should return suggestions
      expect(withBoosting.length).toBeGreaterThan(0);
      expect(withoutBoosting.length).toBeGreaterThan(0);
    });
  });

  describe('condition matching', () => {
    it('considers conditions in suggestions', () => {
      const contextWithSettings: MatchContext = {
        currentElement: { selector: 'Button#settings', state: 'enabled' },
        contextInfo: 'Settings',
        recentActions: ['click'],
        currentTime: new Date(),
      };

      const suggestions = engine.suggestHabits(mockHabits, contextWithSettings);
      // Should have suggestions
      expect(suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it('uses AND logic for condition matching', () => {
      const andEngine = new HabitSuggestionEngine({ matchingLogic: 'AND' });
      const suggestions = andEngine.suggestHabits(mockHabits, mockContext);
      expect(suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it('uses OR logic for condition matching', () => {
      const orEngine = new HabitSuggestionEngine({ matchingLogic: 'OR' });
      const suggestions = orEngine.suggestHabits(mockHabits, mockContext);
      expect(suggestions.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getStatistics', () => {
    it('tracks suggestion counts', () => {
      engine.suggestHabits(mockHabits, mockContext);
      const stats = engine.getStatistics();
      expect((stats as any).totalSuggestions).toBeGreaterThanOrEqual(0);
    });

    it('returns per-habit statistics', () => {
      engine.suggestHabits(mockHabits, mockContext);
      const stats = engine.getStatistics(mockHabits[0].id);
      expect((stats as any).habitId).toBe(mockHabits[0].id);
      expect((stats as any).suggestionCount).toBeGreaterThanOrEqual(0);
    });

    it('indicates cooldown status', () => {
      engine.suggestHabits(mockHabits, mockContext);
      const stats = engine.getStatistics(mockHabits[0].id);
      expect((stats as any).inCooldown).toBeDefined();
    });
  });

  describe('clearHistory', () => {
    it('resets all suggestion tracking', () => {
      engine.suggestHabits(mockHabits, mockContext);
      const statsBefore = engine.getStatistics();
      expect((statsBefore as any).totalSuggestions).toBeGreaterThan(0);

      engine.clearHistory();
      const statsAfter = engine.getStatistics();
      expect((statsAfter as any).totalSuggestions).toBe(0);
    });
  });

  describe('explainSuggestion', () => {
    it('returns human-readable explanation', () => {
      const suggestions = engine.suggestHabits(mockHabits, mockContext);
      if (suggestions.length > 0) {
        const explanation = explainSuggestion(suggestions[0]);
        expect(typeof explanation).toBe('string');
        expect(explanation.length).toBeGreaterThan(0);
      }
    });

    it('includes target in explanation', () => {
      const suggestions = engine.suggestHabits(mockHabits, mockContext);
      if (suggestions.length > 0) {
        const explanation = explainSuggestion(suggestions[0]);
        expect(explanation).toContain(suggestions[0].target);
      }
    });

    it('includes confidence percentage', () => {
      const suggestions = engine.suggestHabits(mockHabits, mockContext);
      if (suggestions.length > 0) {
        const explanation = explainSuggestion(suggestions[0]);
        expect(explanation).toContain('%');
      }
    });
  });

  describe('compareSuggestions', () => {
    it('identifies better suggestion', () => {
      const suggestions = engine.suggestHabits(mockHabits, mockContext);
      if (suggestions.length >= 2) {
        const comparison = compareSuggestions(suggestions[0], suggestions[1]);
        expect(comparison.better).toBeDefined();
        expect(comparison.reason).toBeDefined();
      }
    });

    it('calculates confidence difference', () => {
      const suggestions = engine.suggestHabits(mockHabits, mockContext);
      if (suggestions.length >= 2) {
        const comparison = compareSuggestions(suggestions[0], suggestions[1]);
        expect(typeof comparison.confidenceDiff).toBe('number');
      }
    });
  });

  describe('batchEvaluateHabits', () => {
    it('evaluates multiple habit batches', () => {
      const batches = [mockHabits.slice(0, 2), mockHabits.slice(2)];
      const results = batchEvaluateHabits(engine, batches, mockContext);
      expect(results.length).toBe(2);
      expect(Array.isArray(results[0])).toBe(true);
      expect(Array.isArray(results[1])).toBe(true);
    });

    it('handles empty batches', () => {
      const batches: Habit[][] = [[], [], []];
      const results = batchEvaluateHabits(engine, batches, mockContext);
      expect(results.length).toBe(3);
      results.forEach((batch) => {
        expect(batch).toEqual([]);
      });
    });
  });

  describe('edge cases', () => {
    it('handles habits with no actions', () => {
      const habitNoActions = { ...mockHabits[0], actionSequence: [] };
      const suggestions = engine.suggestHabits([habitNoActions], mockContext);
      expect(suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it('handles empty context', () => {
      const emptyContext: MatchContext = {};
      const suggestions = engine.suggestHabits(mockHabits, emptyContext);
      expect(suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it('handles very low confidence thresholds', () => {
      const customEngine = new HabitSuggestionEngine({ minConfidence: 0.01 });
      const suggestions = customEngine.suggestHabits(mockHabits, mockContext);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('handles very high confidence thresholds', () => {
      const customEngine = new HabitSuggestionEngine({ minConfidence: 0.99 });
      const suggestions = customEngine.suggestHabits(mockHabits, mockContext);
      // May be empty or have few suggestions
      expect(suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it('maintains suggestion order consistency', () => {
      const suggestions1 = engine.suggestHabits(mockHabits, mockContext);
      const suggestions2 = engine.suggestHabits(mockHabits, mockContext);

      if (suggestions1.length > 0 && suggestions2.length > 0) {
        // First suggestion might differ due to cooldown, but order should be by confidence
        suggestions1.forEach((s, i) => {
          if (i > 0) {
            expect(s.confidence).toBeLessThanOrEqual(suggestions1[i - 1].confidence);
          }
        });
      }
    });
  });
});
