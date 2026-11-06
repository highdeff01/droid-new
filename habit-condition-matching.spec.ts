/**
 * Tests for habit condition matching
 * Validates condition evaluation and matching logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchElementState,
  matchContext,
  matchTimePattern,
  matchSequenceHistory,
  matchCondition,
  matchAllConditions,
  matchAnyCondition,
  explainConditionMatch,
  type MatchContext,
} from './habit-condition-matching.js';
import type { HabitCondition } from './habit-extraction.js';

describe('habit-condition-matching', () => {
  let mockContext: MatchContext;

  beforeEach(() => {
    mockContext = {
      currentElement: {
        selector: 'Button#submit',
        state: 'enabled',
      },
      contextInfo: 'Dashboard',
      recentActions: ['click', 'wait', 'type'],
      currentTime: new Date('2024-01-15T14:30:00'),
      userRole: 'admin',
    };
  });

  describe('matchElementState', () => {
    it('matches when element selector and state match', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: 'Button#submit',
        state: 'enabled',
      };

      const result = matchElementState(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('does not match when selector differs', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: 'Button#cancel',
        state: 'enabled',
      };

      const result = matchElementState(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('does not match when state differs', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: 'Button#submit',
        state: 'disabled',
      };

      const result = matchElementState(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('handles missing element in context', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: 'Button#submit',
        state: 'enabled',
      };

      const emptyContext: MatchContext = {};
      const result = matchElementState(condition, emptyContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('includes reason in result', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: 'Button#submit',
        state: 'enabled',
      };

      const result = matchElementState(condition, mockContext);
      expect(result.reason).toBeDefined();
      expect(result.reason?.length).toBeGreaterThan(0);
    });
  });

  describe('matchContext', () => {
    it('matches when context contains expected string', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Dashboard',
      };

      const result = matchContext(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('does not match when context differs', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Settings',
      };

      const result = matchContext(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('handles missing context in condition', () => {
      const condition: HabitCondition = {
        type: 'context-match',
      };

      const result = matchContext(condition, mockContext);
      expect(result.matched).toBe(false);
    });

    it('handles empty context info', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Dashboard',
      };

      const emptyContext: MatchContext = {};
      const result = matchContext(condition, emptyContext);
      expect(result.matched).toBe(false);
    });
  });

  describe('matchTimePattern', () => {
    it('matches when day of week matches', () => {
      // January 15, 2024 is a Monday (day 1)
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [1], // Monday
      };

      const result = matchTimePattern(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('does not match when day of week differs', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [5], // Friday
      };

      const result = matchTimePattern(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('matches when time is within range', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        timeRange: {
          start: '14:00',
          end: '15:00',
        },
      };

      const result = matchTimePattern(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('does not match when time is outside range', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        timeRange: {
          start: '09:00',
          end: '10:00',
        },
      };

      const result = matchTimePattern(condition, mockContext);
      expect(result.matched).toBe(false);
    });

    it('matches both day and time when both specified', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [1], // Monday
        timeRange: {
          start: '14:00',
          end: '15:00',
        },
      };

      const result = matchTimePattern(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('returns confidence score for time patterns', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [1],
      };

      const result = matchTimePattern(condition, mockContext);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('matchSequenceHistory', () => {
    it('matches when sequence is in recent actions', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click', 'wait'],
      };

      const result = matchSequenceHistory(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('does not match when sequence is not in recent actions', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['type', 'submit'],
      };

      const result = matchSequenceHistory(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('matches full sequence', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click', 'wait', 'type'],
      };

      const result = matchSequenceHistory(condition, mockContext);
      expect(result.matched).toBe(true);
    });

    it('handles empty sequence in condition', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: [],
      };

      const result = matchSequenceHistory(condition, mockContext);
      expect(result.matched).toBe(false);
    });

    it('handles missing recent actions', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click'],
      };

      const emptyContext: MatchContext = {};
      const result = matchSequenceHistory(condition, emptyContext);
      expect(result.matched).toBe(false);
    });
  });

  describe('matchCondition', () => {
    it('delegates to element-state matcher', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: 'Button#submit',
        state: 'enabled',
      };

      const result = matchCondition(condition, mockContext);
      expect(result.conditionType).toBe('element-state');
      expect(result.matched).toBe(true);
    });

    it('delegates to context-match matcher', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Dashboard',
      };

      const result = matchCondition(condition, mockContext);
      expect(result.conditionType).toBe('context-match');
      expect(result.matched).toBe(true);
    });

    it('delegates to time-pattern matcher', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [1],
      };

      const result = matchCondition(condition, mockContext);
      expect(result.conditionType).toBe('time-pattern');
      expect(result.matched).toBe(true);
    });

    it('delegates to sequence-history matcher', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click', 'wait'],
      };

      const result = matchCondition(condition, mockContext);
      expect(result.conditionType).toBe('sequence-history');
      expect(result.matched).toBe(true);
    });

    it('handles unknown condition type', () => {
      const condition: HabitCondition = {
        type: 'unknown-type' as any,
      };

      const result = matchCondition(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.reason?.includes('Unknown')).toBe(true);
    });
  });

  describe('matchAllConditions', () => {
    it('returns true when all conditions match', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#submit', state: 'enabled' },
        { type: 'context-match', context: 'Dashboard' },
      ];

      const { allMatched } = matchAllConditions(conditions, mockContext);
      expect(allMatched).toBe(true);
    });

    it('returns false when any condition does not match', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#submit', state: 'enabled' },
        { type: 'element-state', selector: 'Button#cancel', state: 'enabled' },
      ];

      const { allMatched } = matchAllConditions(conditions, mockContext);
      expect(allMatched).toBe(false);
    });

    it('returns all match results', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#submit', state: 'enabled' },
        { type: 'context-match', context: 'Dashboard' },
      ];

      const { results } = matchAllConditions(conditions, mockContext);
      expect(results.length).toBe(2);
    });

    it('calculates overall confidence as minimum of matched conditions', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#submit', state: 'enabled' }, // confidence 1.0
        { type: 'context-match', context: 'Dashboard' }, // confidence 0.9
      ];

      const { overallConfidence } = matchAllConditions(conditions, mockContext);
      expect(overallConfidence).toBe(0.9);
    });

    it('handles empty conditions array', () => {
      const { allMatched, overallConfidence } = matchAllConditions([], mockContext);
      expect(allMatched).toBe(true);
      expect(overallConfidence).toBe(1.0);
    });
  });

  describe('matchAnyCondition', () => {
    it('returns true when at least one condition matches', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#cancel', state: 'enabled' },
        { type: 'context-match', context: 'Dashboard' },
      ];

      const { anyMatched } = matchAnyCondition(conditions, mockContext);
      expect(anyMatched).toBe(true);
    });

    it('returns false when no conditions match', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#cancel', state: 'enabled' },
        { type: 'context-match', context: 'Settings' },
      ];

      const { anyMatched } = matchAnyCondition(conditions, mockContext);
      expect(anyMatched).toBe(false);
    });

    it('calculates overall confidence as maximum of matched conditions', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#cancel', state: 'enabled' }, // no match
        { type: 'context-match', context: 'Dashboard' }, // confidence 0.9
      ];

      const { overallConfidence } = matchAnyCondition(conditions, mockContext);
      expect(overallConfidence).toBe(0.9);
    });

    it('handles empty conditions array', () => {
      const { anyMatched, overallConfidence } = matchAnyCondition([], mockContext);
      expect(anyMatched).toBe(true);
      expect(overallConfidence).toBe(1.0);
    });
  });

  describe('explainConditionMatch', () => {
    it('explains matching conditions with AND logic', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#submit', state: 'enabled' },
        { type: 'context-match', context: 'Dashboard' },
      ];

      const explanation = explainConditionMatch(conditions, mockContext, 'AND');
      expect(typeof explanation).toBe('string');
      expect(explanation.length).toBeGreaterThan(0);
    });

    it('explains non-matching conditions', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#cancel', state: 'enabled' },
      ];

      const explanation = explainConditionMatch(conditions, mockContext, 'AND');
      expect(explanation).toContain('Not all conditions matched');
    });

    it('handles empty conditions', () => {
      const explanation = explainConditionMatch([], mockContext);
      expect(explanation).toBe('No conditions to evaluate');
    });
  });

  describe('edge cases', () => {
    it('handles time pattern at boundary times', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        timeRange: {
          start: '14:30',
          end: '14:30',
        },
      };

      const result = matchTimePattern(condition, mockContext);
      expect(result.matched).toBe(true);
    });

    it('handles sequence matching with single action', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click'],
      };

      const result = matchSequenceHistory(condition, mockContext);
      expect(result.matched).toBe(true);
    });

    it('handles context matching case sensitivity', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'dashboard',
      };

      const result = matchContext(condition, mockContext);
      expect(result.matched).toBe(false);
    });

    it('matches conditions with all types present', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#submit', state: 'enabled' },
        { type: 'context-match', context: 'Dashboard' },
        { type: 'time-pattern', dayOfWeek: [1] },
        { type: 'sequence-history', sequence: ['click', 'wait'] },
      ];

      const { allMatched } = matchAllConditions(conditions, mockContext);
      expect(allMatched).toBe(true);
    });

    it('maintains confidence scores between 0 and 1', () => {
      const conditions: HabitCondition[] = [
        { type: 'element-state', selector: 'Button#submit', state: 'enabled' },
        { type: 'context-match', context: 'Dashboard' },
        { type: 'time-pattern', dayOfWeek: [1] },
        { type: 'sequence-history', sequence: ['click', 'wait'] },
      ];

      const { results, overallConfidence } = matchAllConditions(conditions, mockContext);
      results.forEach((r) => {
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      });
      expect(overallConfidence).toBeGreaterThanOrEqual(0);
      expect(overallConfidence).toBeLessThanOrEqual(1);
    });
  });
});
