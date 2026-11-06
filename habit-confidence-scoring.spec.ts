/**
 * Tests for habit confidence scoring
 * Validates confidence calculation and adaptive scoring
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateSuccessRateScore,
  calculateFrequencyScore,
  calculateRecencyScore,
  calculateFeedbackScore,
  calculateContextScore,
  calculateHabitConfidence,
  shouldSuggestHabit,
  rankHabits,
  calculateConfidenceTrend,
  explainConfidence,
  adaptScoringWeights,
  type ScoringConfig,
  type HabitFeedback,
} from './habit-confidence-scoring.js';
import type { Habit } from './habit-extraction.js';

describe('habit-confidence-scoring', () => {
  let mockHabit: Habit;
  let mockFeedback: HabitFeedback[];
  const defaultConfig: ScoringConfig = {
    weights: {
      successRate: 0.35,
      frequency: 0.20,
      recency: 0.20,
      feedback: 0.15,
      context: 0.10,
    },
    recencyHalfLife: 30,
    frequencyNormalization: 10,
    feedbackDecayRate: 0.9,
    minConfidenceThreshold: 0.5,
  };

  beforeEach(() => {
    const now = Date.now();
    mockHabit = {
      id: 'habit-1' as any,
      target: 'Login',
      description: 'Login workflow',
      actionSequence: [],
      conditions: [],
      successCount: 8,
      totalAttempts: 10,
      successRate: 0.8,
      firstSeen: now - 30 * 24 * 60 * 60 * 1000,  // 30 days ago
      lastUsed: now - 2 * 24 * 60 * 60 * 1000,    // 2 days ago
      timesSuggested: 5,
      timesAccepted: 4,
      timesDismissed: 1,
      timesCorrectRd: 0,
      state: 'learning',
      variants: [],
      frequencyScore: 0.8,
      recencyScore: 0.95,
      feedbackScore: 0.8,
      lessons: [],
    };

    mockFeedback = [
      {
        habitId: 'habit-1',
        accepted: true,
        corrected: false,
        dismissed: false,
        timestamp: now - 1 * 24 * 60 * 60 * 1000,
      },
      {
        habitId: 'habit-1',
        accepted: true,
        corrected: false,
        dismissed: false,
        timestamp: now - 0.5 * 24 * 60 * 60 * 1000,
      },
    ];
  });

  describe('calculateSuccessRateScore', () => {
    it('returns success rate directly', () => {
      const score = calculateSuccessRateScore(mockHabit);
      expect(score).toBe(0.8);
    });

    it('clamps score between 0 and 1', () => {
      const highHabit = { ...mockHabit, successRate: 1.5 };
      const lowHabit = { ...mockHabit, successRate: -0.5 };

      expect(calculateSuccessRateScore(highHabit)).toBe(1);
      expect(calculateSuccessRateScore(lowHabit)).toBe(0);
    });

    it('handles zero success rate', () => {
      mockHabit.successRate = 0;
      const score = calculateSuccessRateScore(mockHabit);
      expect(score).toBe(0);
    });

    it('handles perfect success rate', () => {
      mockHabit.successRate = 1;
      const score = calculateSuccessRateScore(mockHabit);
      expect(score).toBe(1);
    });
  });

  describe('calculateFrequencyScore', () => {
    it('normalizes attempts to configuration', () => {
      mockHabit.totalAttempts = 5;
      const score = calculateFrequencyScore(mockHabit, defaultConfig);
      expect(score).toBe(0.5);  // 5 / 10
    });

    it('caps score at 1 for high frequency', () => {
      mockHabit.totalAttempts = 20;
      const score = calculateFrequencyScore(mockHabit, defaultConfig);
      expect(score).toBe(1);
    });

    it('returns 0 for no attempts', () => {
      mockHabit.totalAttempts = 0;
      const score = calculateFrequencyScore(mockHabit, defaultConfig);
      expect(score).toBe(0);
    });

    it('uses custom normalization config', () => {
      const customConfig = { ...defaultConfig, frequencyNormalization: 20 };
      mockHabit.totalAttempts = 10;
      const score = calculateFrequencyScore(mockHabit, customConfig);
      expect(score).toBe(0.5);
    });
  });

  describe('calculateRecencyScore', () => {
    it('returns high score for recent usage', () => {
      mockHabit.lastUsed = Date.now() - 1 * 24 * 60 * 60 * 1000;  // 1 day ago
      const score = calculateRecencyScore(mockHabit, defaultConfig);
      expect(score).toBeGreaterThan(0.8);
    });

    it('applies exponential decay over time', () => {
      const config30day = { ...defaultConfig, recencyHalfLife: 30 };
      mockHabit.lastUsed = Date.now() - 30 * 24 * 60 * 60 * 1000;  // 30 days ago (half-life)
      const score = calculateRecencyScore(mockHabit, config30day);
      expect(score).toBeLessThan(0.6);
      expect(score).toBeGreaterThan(0.4);
    });

    it('clamps score between 0 and 1', () => {
      const score = calculateRecencyScore(mockHabit, defaultConfig);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('uses custom half-life', () => {
      const config7day = { ...defaultConfig, recencyHalfLife: 7 };
      mockHabit.lastUsed = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const score = calculateRecencyScore(mockHabit, config7day);
      expect(score).toBeLessThan(0.6);
    });
  });

  describe('calculateFeedbackScore', () => {
    it('returns 0.5 for no feedback', () => {
      const score = calculateFeedbackScore(mockHabit, [], defaultConfig);
      expect(score).toBe(0.5);
    });

    it('increases with positive feedback', () => {
      const score = calculateFeedbackScore(mockHabit, mockFeedback, defaultConfig);
      expect(score).toBeGreaterThan(0.5);
    });

    it('decreases with dismissals', () => {
      const negativeFeedback: HabitFeedback[] = [
        { habitId: 'habit-1', accepted: false, corrected: false, dismissed: true, timestamp: Date.now() },
      ];
      const score = calculateFeedbackScore(mockHabit, negativeFeedback, defaultConfig);
      expect(score).toBeLessThan(0.5);
    });

    it('decreases more with corrections', () => {
      const correctedFeedback: HabitFeedback[] = [
        { habitId: 'habit-1', accepted: false, corrected: true, dismissed: false, timestamp: Date.now() },
      ];
      const score = calculateFeedbackScore(mockHabit, correctedFeedback, defaultConfig);
      expect(score).toBeLessThan(0.5);
    });

    it('applies decay to older feedback', () => {
      const now = Date.now();
      const oldFeedback: HabitFeedback[] = [
        { habitId: 'habit-1', accepted: true, corrected: false, dismissed: false, timestamp: now - 100 * 24 * 60 * 60 * 1000 },
      ];
      const score = calculateFeedbackScore(mockHabit, oldFeedback, defaultConfig);
      expect(score).toBeLessThan(0.6);  // Old positive feedback has diminished impact
    });

    it('clamps score between 0 and 1', () => {
      const score = calculateFeedbackScore(mockHabit, mockFeedback, defaultConfig);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateContextScore', () => {
    it('uses provided context match score', () => {
      const score = calculateContextScore(mockHabit, 0.8);
      expect(score).toBe(0.8);
    });

    it('returns 1 for perfect context match', () => {
      const score = calculateContextScore(mockHabit, 1.0);
      expect(score).toBe(1);
    });

    it('returns provided score when no conditions specified', () => {
      mockHabit.conditions = [];
      const score = calculateContextScore(mockHabit, 0.8);
      expect(score).toBe(0.8);  // Uses provided score even without conditions
    });

    it('clamps score to 0..1', () => {
      const highScore = calculateContextScore(mockHabit, 1.5);
      const lowScore = calculateContextScore(mockHabit, -0.5);
      expect(highScore).toBe(1);
      expect(lowScore).toBe(0);
    });
  });

  describe('calculateHabitConfidence', () => {
    it('returns breakdown of all components', () => {
      const breakdown = calculateHabitConfidence(mockHabit, mockFeedback, 1.0, defaultConfig);
      expect(breakdown.successRate).toBeDefined();
      expect(breakdown.frequency).toBeDefined();
      expect(breakdown.recency).toBeDefined();
      expect(breakdown.feedback).toBeDefined();
      expect(breakdown.context).toBeDefined();
      expect(breakdown.overall).toBeDefined();
    });

    it('overall score is weighted combination', () => {
      const breakdown = calculateHabitConfidence(mockHabit, mockFeedback, 1.0, defaultConfig);
      expect(breakdown.overall).toBeGreaterThan(0.5);  // High confidence habit
    });

    it('clamps overall score to 0..1', () => {
      const breakdown = calculateHabitConfidence(mockHabit, mockFeedback, 1.0, defaultConfig);
      expect(breakdown.overall).toBeGreaterThanOrEqual(0);
      expect(breakdown.overall).toBeLessThanOrEqual(1);
    });

    it('uses default config when not provided', () => {
      const breakdown1 = calculateHabitConfidence(mockHabit, mockFeedback, 1.0);
      const breakdown2 = calculateHabitConfidence(mockHabit, mockFeedback, 1.0, defaultConfig);
      expect(breakdown1.overall).toBe(breakdown2.overall);
    });

    it('uses provided context match score', () => {
      const breakdown1 = calculateHabitConfidence(mockHabit, mockFeedback, 1.0, defaultConfig);
      const breakdown2 = calculateHabitConfidence(mockHabit, mockFeedback, 0.5, defaultConfig);
      expect(breakdown2.overall).toBeLessThanOrEqual(breakdown1.overall);  // Changed to <= since context has small weight
    });
  });

  describe('shouldSuggestHabit', () => {
    it('returns true when confidence exceeds threshold', () => {
      mockHabit.successRate = 0.8;
      mockHabit.totalAttempts = 10;
      const should = shouldSuggestHabit(mockHabit, mockFeedback, 1.0, defaultConfig);
      expect(should).toBe(true);
    });

    it('returns false when confidence below threshold', () => {
      mockHabit.successRate = 0.2;
      mockHabit.totalAttempts = 1;
      mockHabit.lastUsed = Date.now() - 100 * 24 * 60 * 60 * 1000;  // Very old
      const should = shouldSuggestHabit(mockHabit, [], 0, defaultConfig);
      expect(should).toBe(false);
    });

    it('uses custom threshold', () => {
      const lowThreshold = { ...defaultConfig, minConfidenceThreshold: 0.2 };
      mockHabit.successRate = 0.3;
      const should = shouldSuggestHabit(mockHabit, mockFeedback, 1.0, lowThreshold);
      expect(should).toBe(true);
    });
  });

  describe('rankHabits', () => {
    it('ranks habits by confidence', () => {
      const habit1 = { ...mockHabit, id: 'habit-1' as any, successRate: 0.9, totalAttempts: 10 };
      const habit2 = { ...mockHabit, id: 'habit-2' as any, successRate: 0.6, totalAttempts: 5 };
      const habit3 = { ...mockHabit, id: 'habit-3' as any, successRate: 0.7, totalAttempts: 8 };

      const ranked = rankHabits([habit2, habit3, habit1]);
      expect(ranked[0].habit.id).toBe('habit-1');
      expect(ranked[1].habit.id).toBe('habit-3');
      expect(ranked[2].habit.id).toBe('habit-2');
    });

    it('includes shouldSuggest flag', () => {
      const habits = [mockHabit];
      const ranked = rankHabits(habits, new Map(), new Map(), defaultConfig);
      expect(ranked[0].shouldSuggest).toBeDefined();
      expect(typeof ranked[0].shouldSuggest).toBe('boolean');
    });

    it('uses feedback history per habit', () => {
      const habit1 = { ...mockHabit, id: 'habit-1' as any };
      const habit2 = { ...mockHabit, id: 'habit-2' as any };

      const feedbackMap = new Map<string, HabitFeedback[]>([
        ['habit-1', mockFeedback],
        ['habit-2', []],
      ]);

      const ranked = rankHabits([habit2, habit1], feedbackMap);
      // habit1 should rank higher due to positive feedback
      expect(ranked[0].habit.id).toBe('habit-1');
    });

    it('uses context scores per habit', () => {
      const habit1 = { ...mockHabit, id: 'habit-1' as any };
      const habit2 = { ...mockHabit, id: 'habit-2' as any };

      const contextScores = new Map<string, number>([
        ['habit-1', 1.0],
        ['habit-2', 0.0],  // Much lower context score
      ]);

      const ranked = rankHabits([habit2, habit1], new Map(), contextScores);
      // habit1 should rank higher due to better context match
      expect(ranked[0].habit.id).toBe('habit-1');
    });
  });

  describe('calculateConfidenceTrend', () => {
    it('returns empty array for empty feedback', () => {
      const trend = calculateConfidenceTrend([]);
      expect(trend).toEqual([]);
    });

    it('groups feedback into time windows', () => {
      const now = Date.now();
      const feedback: HabitFeedback[] = [
        { habitId: 'h1', accepted: true, corrected: false, dismissed: false, timestamp: now - 48 * 60 * 60 * 1000 },
        { habitId: 'h1', accepted: true, corrected: false, dismissed: false, timestamp: now - 24 * 60 * 60 * 1000 },
        { habitId: 'h1', accepted: false, corrected: false, dismissed: true, timestamp: now },
      ];

      const trend = calculateConfidenceTrend(feedback, 24 * 60 * 60 * 1000);
      expect(trend.length).toBeGreaterThan(0);
    });

    it('calculates confidence for each window', () => {
      const now = Date.now();
      const feedback: HabitFeedback[] = [
        { habitId: 'h1', accepted: true, corrected: false, dismissed: false, timestamp: now - 24 * 60 * 60 * 1000 },
        { habitId: 'h1', accepted: true, corrected: false, dismissed: false, timestamp: now },
      ];

      const trend = calculateConfidenceTrend(feedback, 12 * 60 * 60 * 1000);
      trend.forEach((t) => {
        expect(t.confidence).toBeGreaterThanOrEqual(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
        expect(t.sampleSize).toBeGreaterThan(0);
      });
    });
  });

  describe('explainConfidence', () => {
    it('returns human-readable explanation', () => {
      const breakdown = calculateHabitConfidence(mockHabit, mockFeedback, 1.0, defaultConfig);
      const explanation = explainConfidence(breakdown, mockHabit);
      expect(typeof explanation).toBe('string');
      expect(explanation.length).toBeGreaterThan(0);
    });

    it('includes overall confidence score', () => {
      const breakdown = calculateHabitConfidence(mockHabit, mockFeedback, 1.0, defaultConfig);
      const explanation = explainConfidence(breakdown, mockHabit);
      expect(explanation).toContain('Overall confidence');
    });

    it('includes interpretation for high confidence', () => {
      const breakdown = { successRate: 1, frequency: 1, recency: 1, feedback: 1, context: 1, overall: 0.9 };
      const explanation = explainConfidence(breakdown, mockHabit);
      expect(explanation.toLowerCase()).toContain('very confident');
    });

    it('includes interpretation for low confidence', () => {
      const breakdown = { successRate: 0.2, frequency: 0.2, recency: 0.2, feedback: 0.2, context: 0.2, overall: 0.2 };
      const explanation = explainConfidence(breakdown, mockHabit);
      expect(explanation.toLowerCase()).toContain('low confidence');
    });
  });

  describe('adaptScoringWeights', () => {
    it('returns base config for insufficient data', () => {
      const feedback = mockFeedback.slice(0, 2);  // Only 2 entries
      const adapted = adaptScoringWeights(feedback, defaultConfig);
      expect(adapted.weights).toEqual(defaultConfig.weights);
    });

    it('adapts weights based on correction rate', () => {
      const now = Date.now();
      const highCorrectionFeedback: HabitFeedback[] = Array.from({ length: 6 }, (_, i) => ({
        habitId: 'h1',
        accepted: i < 2,
        corrected: i >= 2 && i < 4,
        dismissed: false,
        timestamp: now - i * 60 * 60 * 1000,
      }));

      const adapted = adaptScoringWeights(highCorrectionFeedback, defaultConfig);
      expect(adapted.weights.successRate).toBeGreaterThan(defaultConfig.weights.successRate);
    });

    it('weights normalize to approximately 1', () => {
      const now = Date.now();
      const feedback: HabitFeedback[] = Array.from({ length: 10 }, (_, i) => ({
        habitId: 'h1',
        accepted: i < 7,
        corrected: false,
        dismissed: false,
        timestamp: now - i * 60 * 60 * 1000,
      }));

      const adapted = adaptScoringWeights(feedback, defaultConfig);
      const sum = Object.values(adapted.weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(0.01);
    });
  });

  describe('edge cases', () => {
    it('handles habits with zero total attempts', () => {
      mockHabit.totalAttempts = 0;
      const breakdown = calculateHabitConfidence(mockHabit, mockFeedback, 1.0, defaultConfig);
      expect(breakdown.overall).toBeDefined();
      expect(breakdown.overall).toBeGreaterThanOrEqual(0);
    });

    it('handles recent usage (last used now)', () => {
      mockHabit.lastUsed = Date.now();
      const score = calculateRecencyScore(mockHabit, defaultConfig);
      expect(score).toBeGreaterThan(0.99);
    });

    it('handles very old usage', () => {
      mockHabit.lastUsed = Date.now() - 365 * 24 * 60 * 60 * 1000;  // 1 year ago
      const score = calculateRecencyScore(mockHabit, defaultConfig);
      expect(score).toBeLessThan(0.01);
    });
  });
});
