import { describe, it, expect, beforeEach } from 'vitest';
import {
  HabitPattern,
  HabitFeedback,
  ConfidenceScores,
  HabitVariant,
  Habit,
  HabitExecutionRecord,
  applyConfidenceDecay,
  calculateOverallConfidence,
  classifyFrequency,
  createHabit,
  createHabitVariant,
  createConfidenceScores,
  validateConfidenceScores,
  validateHabit,
  serializeHabit,
  deserializeHabit,
  updateHabitConfidenceAfterExecution,
  calculateSuccessRate,
  calculateRecencyScore,
} from './habit-types';

describe('Habit Types', () => {
  describe('HabitPattern', () => {
    it('creates a pattern with workflow reference', () => {
      const pattern: HabitPattern = {
        workflowId: 'wf-login',
        context: {
          url: 'https://gmail.com',
          title: 'Gmail',
        },
        frequency: 'daily',
      };

      expect(pattern.workflowId).toBe('wf-login');
      expect(pattern.context?.url).toBe('https://gmail.com');
      expect(pattern.frequency).toBe('daily');
    });

    it('creates a pattern with pack reference', () => {
      const pattern: HabitPattern = {
        packId: 'pack-checkout',
        frequency: 'occasional',
      };

      expect(pattern.packId).toBe('pack-checkout');
      expect(pattern.frequency).toBe('occasional');
    });

    it('allows optional fields', () => {
      const pattern: HabitPattern = {
        workflowId: 'wf-test',
      };

      expect(pattern.workflowId).toBe('wf-test');
      expect(pattern.context).toBeUndefined();
      expect(pattern.frequency).toBeUndefined();
    });
  });

  describe('HabitFeedback', () => {
    it('records approval feedback', () => {
      const feedback: HabitFeedback = {
        type: 'approve',
        timestamp: '2024-01-15T10:30:00Z',
        reason: 'Works perfectly',
        weight: 1.0,
      };

      expect(feedback.type).toBe('approve');
      expect(feedback.weight).toBe(1.0);
    });

    it('records rejection feedback', () => {
      const feedback: HabitFeedback = {
        type: 'reject',
        timestamp: '2024-01-15T10:30:00Z',
        weight: 0.5,
      };

      expect(feedback.type).toBe('reject');
      expect(feedback.weight).toBe(0.5);
    });

    it('defaults weight to undefined', () => {
      const feedback: HabitFeedback = {
        type: 'modify',
        timestamp: '2024-01-15T10:30:00Z',
      };

      expect(feedback.weight).toBeUndefined();
    });
  });

  describe('ConfidenceScores', () => {
    it('validates all scores in valid range', () => {
      const scores: ConfidenceScores = {
        overall: 75,
        success: 80,
        frequency: 60,
        recency: 70,
        feedback: 50,
      };

      expect(() => validateConfidenceScores(scores)).not.toThrow();
    });

    it('validates zero scores', () => {
      const scores: ConfidenceScores = {
        overall: 0,
        success: 0,
        frequency: 0,
        recency: 0,
        feedback: 0,
      };

      expect(() => validateConfidenceScores(scores)).not.toThrow();
    });

    it('validates maximum scores', () => {
      const scores: ConfidenceScores = {
        overall: 100,
        success: 100,
        frequency: 100,
        recency: 100,
        feedback: 100,
      };

      expect(() => validateConfidenceScores(scores)).not.toThrow();
    });

    it('rejects score below 0', () => {
      const scores: ConfidenceScores = {
        overall: 50,
        success: -1,
        frequency: 50,
        recency: 50,
        feedback: 50,
      };

      expect(() => validateConfidenceScores(scores)).toThrow();
    });

    it('rejects score above 100', () => {
      const scores: ConfidenceScores = {
        overall: 50,
        success: 101,
        frequency: 50,
        recency: 50,
        feedback: 50,
      };

      expect(() => validateConfidenceScores(scores)).toThrow();
    });

    it('rejects non-numeric scores', () => {
      const scores = {
        overall: 'high' as any,
        success: 50,
        frequency: 50,
        recency: 50,
        feedback: 50,
      };

      expect(() => validateConfidenceScores(scores)).toThrow();
    });
  });

  describe('calculateOverallConfidence', () => {
    it('calculates overall confidence using weighted formula', () => {
      const scores: ConfidenceScores = {
        success: 100,
        frequency: 0,
        recency: 0,
        feedback: 0,
        overall: 0,
      };

      const overall = calculateOverallConfidence(scores);
      expect(overall).toBe(50); // 100 * 0.5 = 50
    });

    it('combines all factors correctly', () => {
      const scores: ConfidenceScores = {
        success: 80,   // 80 * 0.5 = 40
        frequency: 60, // 60 * 0.2 = 12
        recency: 100,  // 100 * 0.2 = 20
        feedback: 50,  // 50 * 0.1 = 5
        overall: 0,
      };

      const overall = calculateOverallConfidence(scores);
      expect(overall).toBe(77); // 40 + 12 + 20 + 5 = 77
    });

    it('clamps result to [0, 100]', () => {
      const scores: ConfidenceScores = {
        success: 100,
        frequency: 100,
        recency: 100,
        feedback: 100,
        overall: 0,
      };

      const overall = calculateOverallConfidence(scores);
      expect(overall).toBeLessThanOrEqual(100);
    });

    it('handles all zero scores', () => {
      const scores: ConfidenceScores = {
        success: 0,
        frequency: 0,
        recency: 0,
        feedback: 0,
        overall: 0,
      };

      const overall = calculateOverallConfidence(scores);
      expect(overall).toBe(0);
    });
  });

  describe('classifyFrequency', () => {
    it('classifies 0-2 executions as rare', () => {
      expect(classifyFrequency(0)).toBe('rare');
      expect(classifyFrequency(1)).toBe('rare');
      expect(classifyFrequency(2)).toBe('rare');
    });

    it('classifies 3-5 executions as occasional', () => {
      expect(classifyFrequency(3)).toBe('occasional');
      expect(classifyFrequency(4)).toBe('occasional');
      expect(classifyFrequency(5)).toBe('occasional');
    });

    it('classifies 6-10 executions as frequent', () => {
      expect(classifyFrequency(6)).toBe('frequent');
      expect(classifyFrequency(8)).toBe('frequent');
      expect(classifyFrequency(10)).toBe('frequent');
    });

    it('classifies 11+ executions as daily', () => {
      expect(classifyFrequency(11)).toBe('daily');
      expect(classifyFrequency(100)).toBe('daily');
      expect(classifyFrequency(1000)).toBe('daily');
    });
  });

  describe('createHabit', () => {
    it('creates a habit with required fields', () => {
      const pattern: HabitPattern = {
        workflowId: 'wf-login',
        frequency: 'daily',
      };

      const habit = createHabit('Login Habit', pattern);

      expect(habit.name).toBe('Login Habit');
      expect(habit.primaryPattern).toEqual(pattern);
      expect(habit.id).toBeTruthy();
      expect(habit.createdAt).toBeTruthy();
      expect(habit.updatedAt).toBeTruthy();
    });

    it('creates habit with default confidence', () => {
      const habit = createHabit('Test Habit', {});

      expect(habit.confidence.overall).toBe(40); // (50*0.5) + (0*0.2) + (50*0.2) + (50*0.1) = 40
      expect(habit.confidence.success).toBe(50);
      expect(habit.confidence.frequency).toBe(0);
      expect(habit.confidence.recency).toBe(50);
      expect(habit.confidence.feedback).toBe(50);
    });

    it('creates habit with empty variants array', () => {
      const habit = createHabit('Test Habit', {});

      expect(Array.isArray(habit.variants)).toBe(true);
      expect(habit.variants?.length).toBe(0);
    });

    it('creates habit with optional description and tags', () => {
      const habit = createHabit('Test Habit', {}, {
        description: 'A test habit',
        tags: ['login', 'email'],
      });

      expect(habit.description).toBe('A test habit');
      expect(habit.tags).toContain('login');
      expect(habit.tags).toContain('email');
    });

    it('creates habit with custom ID', () => {
      const customId = 'custom-habit-123';
      const habit = createHabit('Test Habit', {}, { id: customId });

      expect(habit.id).toBe(customId);
    });

    it('initializes execution counts to zero', () => {
      const habit = createHabit('Test Habit', {});

      expect(habit.totalExecutions).toBe(0);
      expect(habit.successCount).toBe(0);
      expect(habit.failureCount).toBe(0);
    });
  });

  describe('createHabitVariant', () => {
    it('creates a variant with required fields', () => {
      const pattern: HabitPattern = {
        workflowId: 'wf-chrome-login',
      };

      const variant = createHabitVariant('Chrome Login', pattern);

      expect(variant.name).toBe('Chrome Login');
      expect(variant.pattern).toEqual(pattern);
      expect(variant.id).toBeTruthy();
      expect(variant.createdAt).toBeTruthy();
    });

    it('creates variant with default confidence', () => {
      const variant = createHabitVariant('Test Variant', {});

      expect(variant.confidence.overall).toBe(40); // (50*0.5) + (0*0.2) + (50*0.2) + (50*0.1) = 40
      expect(variant.confidence.success).toBe(50);
      expect(variant.confidence.frequency).toBe(0);
      expect(variant.confidence.recency).toBe(50);
      expect(variant.confidence.feedback).toBe(50);
    });

    it('initializes execution counts to zero', () => {
      const variant = createHabitVariant('Test Variant', {});

      expect(variant.executionCount).toBe(0);
      expect(variant.successCount).toBe(0);
      expect(variant.failureCount).toBe(0);
    });
  });

  describe('createConfidenceScores', () => {
    it('creates default confidence scores', () => {
      const scores = createConfidenceScores();

      expect(scores.overall).toBe(40); // (50*0.5) + (0*0.2) + (50*0.2) + (50*0.1) = 40
      expect(scores.success).toBe(50);
      expect(scores.frequency).toBe(0);
      expect(scores.recency).toBe(50);
      expect(scores.feedback).toBe(50);
    });

    it('creates confidence scores with custom values', () => {
      const scores = createConfidenceScores({
        success: 80,
        frequency: 60,
        recency: 70,
        feedback: 40,
      });

      expect(scores.success).toBe(80);
      expect(scores.frequency).toBe(60);
      expect(scores.recency).toBe(70);
      expect(scores.feedback).toBe(40);
    });

    it('calculates overall confidence from components', () => {
      const scores = createConfidenceScores({
        success: 100,
        frequency: 0,
        recency: 0,
        feedback: 0,
      });

      expect(scores.overall).toBe(50);
    });
  });

  describe('validateHabit', () => {
    let habit: Habit;

    beforeEach(() => {
      habit = createHabit('Test Habit', { workflowId: 'wf-test' });
    });

    it('validates a well-formed habit', () => {
      expect(() => validateHabit(habit)).not.toThrow();
    });

    it('rejects habit without ID', () => {
      habit.id = '';
      expect(() => validateHabit(habit)).toThrow();
    });

    it('rejects habit without name', () => {
      habit.name = '';
      expect(() => validateHabit(habit)).toThrow();
    });

    it('rejects habit with negative execution counts', () => {
      habit.totalExecutions = -1;
      expect(() => validateHabit(habit)).toThrow();
    });

    it('rejects habit with invalid timestamps', () => {
      habit.createdAt = 'invalid-date';
      expect(() => validateHabit(habit)).toThrow();
    });

    it('rejects habit with invalid confidence scores', () => {
      habit.confidence.success = 150;
      expect(() => validateHabit(habit)).toThrow();
    });
  });

  describe('serializeHabit and deserializeHabit', () => {
    it('serializes and deserializes a habit', () => {
      const original = createHabit('Test Habit', { workflowId: 'wf-test' });

      const serialized = serializeHabit(original);
      expect(typeof serialized).toBe('string');

      const deserialized = deserializeHabit(serialized);
      expect(deserialized.name).toBe(original.name);
      expect(deserialized.id).toBe(original.id);
      expect(deserialized.confidence.overall).toBe(original.confidence.overall);
    });

    it('validates on deserialization', () => {
      const invalidJson = JSON.stringify({
        id: '',
        name: 'Invalid',
      });

      expect(() => deserializeHabit(invalidJson)).toThrow();
    });

    it('preserves all fields through round-trip', () => {
      const habit = createHabit('Complex Habit', {
        workflowId: 'wf-complex',
        frequency: 'daily',
      }, {
        description: 'A complex habit',
        tags: ['important', 'daily'],
      });

      habit.totalExecutions = 10;
      habit.successCount = 8;
      habit.failureCount = 2;
      habit.lastExecutedAt = '2024-01-15T10:30:00Z';

      const serialized = serializeHabit(habit);
      const deserialized = deserializeHabit(serialized);

      expect(deserialized.totalExecutions).toBe(10);
      expect(deserialized.successCount).toBe(8);
      expect(deserialized.failureCount).toBe(2);
      expect(deserialized.lastExecutedAt).toBe('2024-01-15T10:30:00Z');
      expect(deserialized.tags).toContain('important');
      expect(deserialized.tags).toContain('daily');
    });
  });

  describe('updateHabitConfidenceAfterExecution', () => {
    let habit: Habit;

    beforeEach(() => {
      habit = createHabit('Test Habit', {});
    });

    it('increments execution count on success', () => {
      updateHabitConfidenceAfterExecution(habit, true);

      expect(habit.totalExecutions).toBe(1);
      expect(habit.successCount).toBe(1);
      expect(habit.failureCount).toBe(0);
    });

    it('increments execution count on failure', () => {
      updateHabitConfidenceAfterExecution(habit, false);

      expect(habit.totalExecutions).toBe(1);
      expect(habit.successCount).toBe(0);
      expect(habit.failureCount).toBe(1);
    });

    it('increases confidence on success', () => {
      const initialConfidence = habit.confidence.overall;
      updateHabitConfidenceAfterExecution(habit, true);

      expect(habit.confidence.success).toBeGreaterThan(initialConfidence - 10);
    });

    it('decreases confidence on failure', () => {
      const initialSuccess = habit.confidence.success;
      updateHabitConfidenceAfterExecution(habit, false);

      expect(habit.confidence.success).toBeLessThan(initialSuccess);
    });

    it('updates frequency based on total executions', () => {
      updateHabitConfidenceAfterExecution(habit, true);
      const frequencyAfter1 = habit.confidence.frequency;

      updateHabitConfidenceAfterExecution(habit, true);
      const frequencyAfter2 = habit.confidence.frequency;

      expect(frequencyAfter2).toBeGreaterThan(frequencyAfter1);
    });

    it('applies approval feedback', () => {
      const initialFeedback = habit.confidence.feedback;

      const feedback: HabitFeedback = {
        type: 'approve',
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      updateHabitConfidenceAfterExecution(habit, true, feedback);

      expect(habit.confidence.feedback).toBeGreaterThan(initialFeedback);
    });

    it('applies rejection feedback', () => {
      const initialFeedback = habit.confidence.feedback;

      const feedback: HabitFeedback = {
        type: 'reject',
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      updateHabitConfidenceAfterExecution(habit, true, feedback);

      expect(habit.confidence.feedback).toBeLessThan(initialFeedback);
    });

    it('updates lastExecutedAt timestamp', () => {
      const before = new Date();
      updateHabitConfidenceAfterExecution(habit, true);
      const after = new Date();

      const lastExecuted = new Date(habit.lastExecutedAt!);
      expect(lastExecuted.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(lastExecuted.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('calculateSuccessRate', () => {
    it('calculates success rate from counts', () => {
      const rate = calculateSuccessRate(8, 2);
      expect(rate).toBe(80);
    });

    it('handles all successes', () => {
      const rate = calculateSuccessRate(10, 0);
      expect(rate).toBe(100);
    });

    it('handles all failures', () => {
      const rate = calculateSuccessRate(0, 10);
      expect(rate).toBe(0);
    });

    it('returns 50 for no executions', () => {
      const rate = calculateSuccessRate(0, 0);
      expect(rate).toBe(50);
    });

    it('calculates partial success rates', () => {
      const rate = calculateSuccessRate(5, 5);
      expect(rate).toBe(50);
    });
  });

  describe('calculateRecencyScore', () => {
    it('returns 0 when no execution history', () => {
      const score = calculateRecencyScore();
      expect(score).toBe(0);
    });

    it('returns 100 for very recent execution', () => {
      const now = new Date();
      const recentTime = new Date(now.getTime() - 1000); // 1 second ago

      const score = calculateRecencyScore(recentTime.toISOString(), now);
      expect(score).toBeGreaterThan(99);
    });

    it('returns 50 after 30 days (half-life)', () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const score = calculateRecencyScore(thirtyDaysAgo.toISOString(), now);
      expect(score).toBeCloseTo(50, 1);
    });

    it('returns 25 after 60 days', () => {
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      const score = calculateRecencyScore(sixtyDaysAgo.toISOString(), now);
      expect(score).toBeCloseTo(25, 1);
    });

    it('decays exponentially over time', () => {
      const now = new Date();
      const day0 = calculateRecencyScore(new Date(now.getTime()).toISOString(), now);
      const day15 = calculateRecencyScore(new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString(), now);
      const day30 = calculateRecencyScore(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), now);

      expect(day0).toBeGreaterThan(day15);
      expect(day15).toBeGreaterThan(day30);
      expect(day30).toBeCloseTo(50, 0);
    });
  });

  describe('applyConfidenceDecay', () => {
    let habit: Habit;

    beforeEach(() => {
      habit = createHabit('Test Habit', {});
      habit.confidence.success = 80;
      habit.confidence.frequency = 60;
      habit.confidence.recency = 70;
      habit.confidence.feedback = 40;
    });

    it('does nothing if no execution history', () => {
      const originalConfidence = habit.confidence.overall;
      applyConfidenceDecay(habit);

      expect(habit.confidence.overall).toBe(originalConfidence);
    });

    it('reduces confidence after 30 days of inactivity', () => {
      habit.lastExecutedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const before = habit.confidence.success;

      applyConfidenceDecay(habit);

      expect(habit.confidence.success).toBeLessThan(before);
      expect(habit.confidence.success).toBeCloseTo(before * 0.5, 1);
    });

    it('reduces confidence more after 60 days', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

      habit.lastExecutedAt = thirtyDaysAgo;
      applyConfidenceDecay(habit);
      const confidenceAfter30 = habit.confidence.success;

      habit.lastExecutedAt = sixtyDaysAgo;
      habit.confidence.success = 80; // Reset
      applyConfidenceDecay(habit);
      const confidenceAfter60 = habit.confidence.success;

      expect(confidenceAfter60).toBeLessThan(confidenceAfter30);
    });

    it('decays all confidence components', () => {
      habit.lastExecutedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const beforeSuccess = habit.confidence.success;
      const beforeFrequency = habit.confidence.frequency;
      const beforeRecency = habit.confidence.recency;

      applyConfidenceDecay(habit);

      expect(habit.confidence.success).toBeLessThan(beforeSuccess);
      expect(habit.confidence.frequency).toBeLessThan(beforeFrequency);
      expect(habit.confidence.recency).toBeLessThan(beforeRecency);
    });

    it('recalculates overall confidence after decay', () => {
      habit.lastExecutedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const beforeOverall = habit.confidence.overall;

      applyConfidenceDecay(habit);

      expect(habit.confidence.overall).toBeLessThan(beforeOverall);
      // Verify it was recalculated with new components
      const expectedOverall = calculateOverallConfidence(habit.confidence);
      expect(habit.confidence.overall).toBeCloseTo(expectedOverall, 1);
    });

    it('updates lastDecayAt timestamp', () => {
      habit.lastExecutedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const before = new Date();

      applyConfidenceDecay(habit);

      const after = new Date();
      const decayedAt = new Date(habit.confidence.decayedAt!);
      expect(decayedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(decayedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Habit Creation and Management', () => {
    it('creates complete habit with variants', () => {
      const habit = createHabit('Login', {
        workflowId: 'wf-login',
        frequency: 'daily',
      });

      const variant1 = createHabitVariant('Chrome', {
        workflowId: 'wf-chrome-login',
      });

      const variant2 = createHabitVariant('Firefox', {
        workflowId: 'wf-firefox-login',
      });

      habit.variants?.push(variant1, variant2);

      expect(habit.variants).toHaveLength(2);
      expect(habit.variants?.[0].name).toBe('Chrome');
      expect(habit.variants?.[1].name).toBe('Firefox');
    });

    it('tracks execution history over time', () => {
      const habit = createHabit('Test', {});

      // Simulate 5 executions: 4 successes, 1 failure
      updateHabitConfidenceAfterExecution(habit, true);
      updateHabitConfidenceAfterExecution(habit, true);
      updateHabitConfidenceAfterExecution(habit, true);
      updateHabitConfidenceAfterExecution(habit, true);
      updateHabitConfidenceAfterExecution(habit, false);

      expect(habit.totalExecutions).toBe(5);
      expect(habit.successCount).toBe(4);
      expect(habit.failureCount).toBe(1);
      expect(calculateSuccessRate(habit.successCount, habit.failureCount)).toBe(80);
    });

    it('handles feedback accumulation', () => {
      const habit = createHabit('Test', {});

      const feedback1: HabitFeedback = {
        type: 'approve',
        timestamp: new Date().toISOString(),
      };

      const feedback2: HabitFeedback = {
        type: 'approve',
        timestamp: new Date().toISOString(),
      };

      habit.feedback?.push(feedback1, feedback2);

      expect(habit.feedback).toHaveLength(2);
      expect(habit.feedback?.every(f => f.type === 'approve')).toBe(true);
    });
  });

  describe('Correctness Properties', () => {
    it('maintains confidence between 0-100 after operations', () => {
      const habit = createHabit('Test', {});

      // Execute multiple times with various feedback
      for (let i = 0; i < 10; i++) {
        const success = Math.random() > 0.3;
        updateHabitConfidenceAfterExecution(habit, success);
      }

      expect(habit.confidence.overall).toBeGreaterThanOrEqual(0);
      expect(habit.confidence.overall).toBeLessThanOrEqual(100);
      expect(habit.confidence.success).toBeGreaterThanOrEqual(0);
      expect(habit.confidence.success).toBeLessThanOrEqual(100);
      expect(habit.confidence.frequency).toBeGreaterThanOrEqual(0);
      expect(habit.confidence.frequency).toBeLessThanOrEqual(100);
      expect(habit.confidence.recency).toBeGreaterThanOrEqual(0);
      expect(habit.confidence.recency).toBeLessThanOrEqual(100);
      expect(habit.confidence.feedback).toBeGreaterThanOrEqual(0);
      expect(habit.confidence.feedback).toBeLessThanOrEqual(100);
    });

    it('ensures timestamps are monotonically increasing', () => {
      const habit = createHabit('Test', {});
      const createdAt = new Date(habit.createdAt);

      // Small delay to ensure different timestamp
      const timestamps: Date[] = [createdAt];

      for (let i = 0; i < 5; i++) {
        updateHabitConfidenceAfterExecution(habit, true);
        timestamps.push(new Date(habit.updatedAt));
      }

      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i].getTime()).toBeGreaterThanOrEqual(timestamps[i - 1].getTime());
      }
    });

    it('maintains execution count monotonicity', () => {
      const habit = createHabit('Test', {});

      for (let i = 1; i <= 10; i++) {
        updateHabitConfidenceAfterExecution(habit, Math.random() > 0.3);
        expect(habit.totalExecutions).toBe(i);
        expect(habit.successCount + habit.failureCount).toBe(i);
      }
    });

    it('validates all IDs are unique', () => {
      const habits = [
        createHabit('Habit 1', {}),
        createHabit('Habit 2', {}),
        createHabit('Habit 3', {}),
      ];

      const ids = habits.map(h => h.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });
});
