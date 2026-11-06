/**
 * Tests for Habit condition matchers
 * Validates element-state, context-match, time-pattern, and sequence-history matchers
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ElementStateMatcher,
  ContextMatchMatcher,
  TimePatternMatcher,
  SequenceHistoryMatcher,
  SelectorMatcher,
  PatternMatcher,
  HabitMatchContext,
  createMatcher,
} from './habit-matchers.js';
import { HabitConditionEngine, HabitMatchQuality } from './habit-condition-engine.js';
import type { HabitCondition } from './habit-types.js';

describe('habit-matchers', () => {
  describe('ElementStateMatcher', () => {
    let matcher: ElementStateMatcher;
    let mockContext: HabitMatchContext;

    beforeEach(() => {
      matcher = new ElementStateMatcher();
      mockContext = {
        currentElement: {
          selector: '#submit-button',
          state: 'enabled',
        },
        applicationContext: {
          url: 'https://example.com/login',
          title: 'Login Page',
        },
      };
    });

    it('validates element-state condition with required fields', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: '#submit-button',
        state: 'enabled',
      };

      expect(matcher.validateCondition(condition)).toBe(true);
    });

    it('rejects element-state condition without selector', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        state: 'enabled',
      };

      expect(matcher.validateCondition(condition)).toBe(false);
    });

    it('rejects element-state condition without state', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: '#submit-button',
      };

      expect(matcher.validateCondition(condition)).toBe(false);
    });

    it('matches when element selector and state match', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: '#submit-button',
        state: 'enabled',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.conditionType).toBe('element-state');
    });

    it('does not match when selector differs', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: '#cancel-button',
        state: 'enabled',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('does not match when state differs', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: '#submit-button',
        state: 'disabled',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('handles missing element in context', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: '#submit-button',
        state: 'enabled',
      };

      const emptyContext: HabitMatchContext = {};
      const result = matcher.evaluate(condition, emptyContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('provides detailed reason for match', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: '#submit-button',
        state: 'enabled',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.reason).toBeDefined();
      expect(result.reason?.includes('enabled')).toBe(true);
    });

    it('includes metadata with match details', () => {
      const condition: HabitCondition = {
        type: 'element-state',
        selector: '#submit-button',
        state: 'enabled',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.expectedState).toBe('enabled');
    });
  });

  describe('ContextMatchMatcher', () => {
    let matcher: ContextMatchMatcher;
    let mockContext: HabitMatchContext;

    beforeEach(() => {
      matcher = new ContextMatchMatcher();
      mockContext = {
        applicationContext: {
          url: 'https://example.com/login',
          title: 'Login Page - My App',
          viewName: 'Auth',
          environment: { mode: 'production' },
        },
        currentElement: {
          selector: '#submit-button',
          state: 'enabled',
        },
      };
    });

    it('validates context-match condition with context string', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Login',
      };

      expect(matcher.validateCondition(condition)).toBe(true);
    });

    it('rejects context-match condition without context', () => {
      const condition: HabitCondition = {
        type: 'context-match',
      };

      expect(matcher.validateCondition(condition)).toBe(false);
    });

    it('matches when context contains expected string', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Login',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('matches with URL pattern', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        urlPattern: 'https://example\\.com/.*',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('matches with title pattern', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        titlePattern: '.*Login.*',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
    });

    it('matches with view name', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        viewName: 'Auth',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('matches with environment variables', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        environment: { mode: 'production' },
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
    });

    it('does not match when context differs', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Settings',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('handles missing context', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Login',
      };

      const emptyContext: HabitMatchContext = {};
      const result = matcher.evaluate(condition, emptyContext);
      expect(result.matched).toBe(false);
    });

    it('includes condition details in metadata', () => {
      const condition: HabitCondition = {
        type: 'context-match',
        context: 'Login',
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.conditions).toBeDefined();
    });
  });

  describe('TimePatternMatcher', () => {
    let matcher: TimePatternMatcher;
    let mockContext: HabitMatchContext;

    beforeEach(() => {
      matcher = new TimePatternMatcher();
      // January 15, 2024 is a Monday (day 1)
      mockContext = {
        currentTime: new Date('2024-01-15T14:30:00'),
      };
    });

    it('validates time-pattern condition', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [1],
      };

      expect(matcher.validateCondition(condition)).toBe(true);
    });

    it('matches when day of week matches', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [1], // Monday
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('does not match when day of week differs', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [5], // Friday
      };

      const result = matcher.evaluate(condition, mockContext);
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

      const result = matcher.evaluate(condition, mockContext);
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

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
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

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('matches when only day specified and matches', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [1], // Monday
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
    });

    it('matches when only time specified and within range', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        timeRange: {
          start: '14:00',
          end: '15:00',
        },
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
    });

    it('includes detailed metadata', () => {
      const condition: HabitCondition = {
        type: 'time-pattern',
        dayOfWeek: [1],
        timeRange: {
          start: '14:00',
          end: '15:00',
        },
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.currentTime).toBeDefined();
      expect(result.metadata?.dayOfWeek).toEqual([1]);
    });
  });

  describe('SequenceHistoryMatcher', () => {
    let matcher: SequenceHistoryMatcher;
    let mockContext: HabitMatchContext;

    beforeEach(() => {
      matcher = new SequenceHistoryMatcher();
      mockContext = {
        recentActions: ['click', 'wait', 'type', 'click'],
      };
    });

    it('validates sequence-history condition with sequence', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click', 'wait'],
      };

      expect(matcher.validateCondition(condition)).toBe(true);
    });

    it('rejects sequence-history condition without sequence', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
      };

      expect(matcher.validateCondition(condition)).toBe(false);
    });

    it('matches when sequence is in recent actions', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click', 'wait'],
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('matches full sequence', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click', 'wait', 'type', 'click'],
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(true);
    });

    it('does not match when sequence is not in recent actions', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['drag', 'drop'],
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('handles empty sequence in condition', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: [],
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.matched).toBe(false);
    });

    it('handles missing recent actions', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click'],
      };

      const emptyContext: HabitMatchContext = {};
      const result = matcher.evaluate(condition, emptyContext);
      expect(result.matched).toBe(false);
    });

    it('includes sequence details in metadata', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click', 'wait'],
      };

      const result = matcher.evaluate(condition, mockContext);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.foundSequence).toEqual(['click', 'wait']);
    });

    it('performs fuzzy matching when enabled', () => {
      const condition: HabitCondition = {
        type: 'sequence-history',
        sequence: ['click', 'wait', 'submit'],
        fuzzyMatch: true,
      };

      const context: HabitMatchContext = {
        recentActions: ['click', 'wait', 'type', 'submit'],
      };

      const result = matcher.evaluate(condition, context);
      // Should match because 3 of 4 actions appear in order (75%)
      expect(result.matched).toBe(true);
    });
  });

  describe('SelectorMatcher', () => {
    let matcher: SelectorMatcher;

    beforeEach(() => {
      matcher = new SelectorMatcher();
    });

    it('matches exact selectors', () => {
      expect(matcher.matches('#button', '#button')).toBe(true);
    });

    it('matches partial selectors', () => {
      expect(matcher.matches('button', '#submit-button')).toBe(true);
    });

    it('matches CSS selectors', () => {
      expect(matcher.matches('.btn.primary', 'button.btn.primary#submit')).toBe(true);
    });

    it('fuzzily matches similar selectors', () => {
      expect(matcher.matches('#submit', '#submit-button')).toBe(true);
      expect(matcher.matches('#submit-button', '#submit')).toBe(true);
    });

    it('does not match completely different selectors', () => {
      expect(matcher.matches('#submit', '#cancel')).toBe(false);
    });
  });

  describe('PatternMatcher', () => {
    let matcher: PatternMatcher;

    beforeEach(() => {
      matcher = new PatternMatcher();
    });

    it('matches regex patterns', () => {
      expect(matcher.matchesPattern('https://example\\.com/.*', 'https://example.com/login')).toBe(true);
    });

    it('matches case-insensitive substring', () => {
      expect(matcher.matchesPattern('login', 'Login Page')).toBe(true);
    });

    it('does not match when pattern does not apply', () => {
      expect(matcher.matchesPattern('settings', 'Login Page')).toBe(false);
    });

    it('matches environment variables', () => {
      const expected = { mode: 'production', region: 'us' };
      const actual = { mode: 'production', region: 'us', version: '1.0' };

      expect(matcher.matchesEnvironment(expected, actual)).toBe(true);
    });

    it('does not match when environment variable differs', () => {
      const expected = { mode: 'staging' };
      const actual = { mode: 'production' };

      expect(matcher.matchesEnvironment(expected, actual)).toBe(false);
    });
  });

  describe('createMatcher', () => {
    it('creates element-state matcher', () => {
      const matcher = createMatcher('element-state');
      expect(matcher).toBeInstanceOf(ElementStateMatcher);
    });

    it('creates context-match matcher', () => {
      const matcher = createMatcher('context-match');
      expect(matcher).toBeInstanceOf(ContextMatchMatcher);
    });

    it('creates time-pattern matcher', () => {
      const matcher = createMatcher('time-pattern');
      expect(matcher).toBeInstanceOf(TimePatternMatcher);
    });

    it('creates sequence-history matcher', () => {
      const matcher = createMatcher('sequence-history');
      expect(matcher).toBeInstanceOf(SequenceHistoryMatcher);
    });

    it('throws error for unknown condition type', () => {
      expect(() => createMatcher('unknown-type' as any)).toThrow();
    });
  });

  describe('HabitConditionEngine', () => {
    let engine: HabitConditionEngine;
    let mockContext: HabitMatchContext;

    beforeEach(() => {
      engine = new HabitConditionEngine();
      mockContext = {
        currentElement: {
          selector: '#submit-button',
          state: 'enabled',
        },
        applicationContext: {
          url: 'https://example.com/login',
          title: 'Login Page',
        },
        recentActions: ['click', 'wait', 'type'],
        currentTime: new Date('2024-01-15T14:30:00'),
      };
    });

    it('evaluates single condition', () => {
      const conditions: HabitCondition[] = [
        {
          type: 'element-state',
          selector: '#submit-button',
          state: 'enabled',
        },
      ];

      const result = engine.evaluate(conditions, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);  // Perfect match
    });

    it('evaluates AND conditions - all match', () => {
      const conditions: HabitCondition[] = [
        {
          type: 'element-state',
          selector: '#submit-button',
          state: 'enabled',
        },
        {
          type: 'context-match',
          context: 'Login',
        },
      ];

      const result = engine.evaluate(conditions, mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('evaluates AND conditions - one fails', () => {
      const conditions: HabitCondition[] = [
        {
          type: 'element-state',
          selector: '#submit-button',
          state: 'enabled',
        },
        {
          type: 'context-match',
          context: 'Settings',
        },
      ];

      const result = engine.evaluate(conditions, mockContext);
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('evaluates OR conditions', () => {
      const conditions: HabitCondition[] = [
        {
          type: 'element-state',
          selector: '#cancel-button',
          state: 'enabled',
        },
        {
          type: 'context-match',
          context: 'Login',
        },
      ];

      const result = engine.evaluate(conditions, mockContext, { logic: 'OR' });
      expect(result.matched).toBe(true);
    });

    it('calculates weighted confidence', () => {
      const conditions: HabitCondition[] = [
        {
          type: 'element-state',
          selector: '#submit-button',
          state: 'enabled',
          weight: 0.8,
        },
        {
          type: 'context-match',
          context: 'Login',
          weight: 0.2,
        },
      ];

      const result = engine.evaluate(conditions, mockContext);
      expect(result.weightedConfidence).toBeDefined();
      expect(result.weightedConfidence).toBeGreaterThan(0);
    });

    it('calculates match quality metrics', () => {
      const conditions: HabitCondition[] = [
        {
          type: 'element-state',
          selector: '#submit-button',
          state: 'enabled',
        },
        {
          type: 'context-match',
          context: 'Login',
        },
      ];

      const result = engine.evaluate(conditions, mockContext);
      expect(result.matchQuality).toBeDefined();
      
      const quality: HabitMatchQuality = result.matchQuality;
      expect(quality.score).toBeGreaterThanOrEqual(0);
      expect(quality.score).toBeLessThanOrEqual(1);
      expect(quality.matchedCount).toBe(2);
      expect(quality.totalConditions).toBe(2);
    });

    it('handles negated conditions', () => {
      const conditions: HabitCondition[] = [
        {
          type: 'element-state',
          selector: '#cancel-button',
          state: 'disabled',
          negate: true,
        },
      ];

      // Condition says "cancel button should be disabled", but it's enabled
      // With negation, this means "cancel button should NOT be disabled"
      // Since cancel button doesn't exist in context, the condition "doesn't match"
      // With negation, "doesn't match" becomes "passed"
      const result = engine.evaluate(conditions, mockContext);
      expect(result.matched).toBe(true);
    });

    it('generates human-readable explanation', () => {
      const conditions: HabitCondition[] = [
        {
          type: 'element-state',
          selector: '#submit-button',
          state: 'enabled',
        },
        {
          type: 'context-match',
          context: 'Login',
        },
      ];

      const result = engine.evaluate(conditions, mockContext);
      expect(result.explanation).toBeDefined();
      expect(result.explanation?.length).toBeGreaterThan(0);
      expect(result.explanation?.includes('MATCHED')).toBe(true);
    });

    it('handles empty conditions', () => {
      const result = engine.evaluate([], mockContext);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('validates context requirements', () => {
      const requirements = [
        {
          type: 'url',
          pattern: 'https://example\\.com/.*',
        },
        {
          type: 'environment',
          values: { mode: 'production' },
        },
      ];

      const context: HabitMatchContext = {
        applicationContext: {
          url: 'https://example.com/login',
          environment: { mode: 'production' },
        },
      };

      const result = engine.validateContextRequirements(requirements, context);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('detects invalid context requirements', () => {
      const requirements = [
        {
          type: 'url',
          pattern: 'https://different\\.com/.*',
        },
      ];

      const context: HabitMatchContext = {
        applicationContext: {
          url: 'https://example.com/login',
        },
      };

      const result = engine.validateContextRequirements(requirements, context);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
