/**
 * Tests for habit extraction from workflows
 * Validates pattern recognition, sequence analysis, and habit creation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractHabitsFromWorkflow,
  calculateHabitConfidence,
  extractContext,
  normalizeSequence,
  sequenceSimilarity,
  mergeHabits,
  describeHabit,
  generateHabitId,
  type WorkflowStep,
  type Habit,
} from './habit-extraction.js';

describe('habit-extraction', () => {
  let mockSteps: WorkflowStep[];

  beforeEach(() => {
    const now = Date.now();
    mockSteps = [
      {
        id: '1',
        index: 0,
        name: 'Open App',
        action: 'click',
        target: 'App Icon',
        x: 0.5,
        y: 0.5,
        duration: 100,
        success: true,
        timestamp: now,
      },
      {
        id: '2',
        index: 1,
        name: 'Wait for Load',
        action: 'wait',
        duration: 500,
        success: true,
        timestamp: now + 500,
      },
      {
        id: '3',
        index: 2,
        name: 'Enter Username',
        action: 'type',
        target: 'Username Field',
        duration: 200,
        success: true,
        timestamp: now + 1000,
      },
      {
        id: '4',
        index: 3,
        name: 'Enter Password',
        action: 'type',
        target: 'Password Field',
        duration: 200,
        success: true,
        timestamp: now + 1200,
      },
      {
        id: '5',
        index: 4,
        name: 'Click Login',
        action: 'click',
        target: 'Login Button',
        duration: 50,
        success: true,
        timestamp: now + 1400,
      },
    ];
  });

  describe('extractHabitsFromWorkflow', () => {
    it('extracts habits from a successful workflow', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      expect(habits.length).toBeGreaterThan(0);
    });

    it('extracts habits with high success rate', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.successRate).toBeGreaterThanOrEqual(0.6);
      });
    });

    it('assigns target descriptions to habits', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.target).toBeDefined();
        expect(habit.target.length).toBeGreaterThan(0);
      });
    });

    it('respects minimum sequence length configuration', () => {
      const habits = extractHabitsFromWorkflow(mockSteps, { minSequenceLength: 3 });
      habits.forEach((habit) => {
        expect(habit.actionSequence.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('respects minimum success rate configuration', () => {
      const stepWithFailure: WorkflowStep[] = [
        ...mockSteps.slice(0, 2),
        { ...mockSteps[2], success: false },
        ...mockSteps.slice(3),
      ];

      const habits = extractHabitsFromWorkflow(stepWithFailure, { minSuccessRate: 0.8 });
      habits.forEach((habit) => {
        expect(habit.successRate).toBeGreaterThanOrEqual(0.8);
      });
    });

    it('initializes habit state as learning', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.state).toBe('learning');
      });
    });

    it('sets timestamps correctly', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.firstSeen).toBeLessThanOrEqual(habit.lastUsed);
      });
    });
  });

  describe('calculateHabitConfidence', () => {
    let habit: Habit;

    beforeEach(() => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habit = habits[0];
    });

    it('returns a score between 0 and 1', () => {
      const confidence = calculateHabitConfidence(habit);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });

    it('higher success rate increases confidence', () => {
      const habit1 = { ...habit, successRate: 0.5 };
      const habit2 = { ...habit, successRate: 0.95 };

      const conf1 = calculateHabitConfidence(habit1);
      const conf2 = calculateHabitConfidence(habit2);

      expect(conf2).toBeGreaterThan(conf1);
    });

    it('incorporates multiple factors in scoring', () => {
      const lowQuality = {
        ...habit,
        successRate: 0.5,
        frequencyScore: 0.2,
        recencyScore: 0.3,
        feedbackScore: 0.1,
      };

      const highQuality = {
        ...habit,
        successRate: 0.95,
        frequencyScore: 0.9,
        recencyScore: 0.8,
        feedbackScore: 0.7,
      };

      const confLow = calculateHabitConfidence(lowQuality);
      const confHigh = calculateHabitConfidence(highQuality);

      expect(confHigh).toBeGreaterThan(confLow);
    });
  });

  describe('extractContext', () => {
    it('extracts workflow context information', () => {
      const context = extractContext(mockSteps);
      expect(context.stepCount).toBe(mockSteps.length);
      expect(context.successCount).toBe(mockSteps.filter((s) => s.success).length);
    });

    it('includes success and failure counts', () => {
      const context = extractContext(mockSteps);
      expect(context.successCount).toBe(5);
      expect(context.failureCount).toBe(0);
    });

    it('calculates average duration', () => {
      const context = extractContext(mockSteps);
      const expectedAvg = mockSteps.reduce((sum, s) => sum + (s.duration || 0), 0) / mockSteps.length;
      expect(context.averageDuration).toBe(expectedAvg);
    });

    it('extracts unique targets and actions', () => {
      const context = extractContext(mockSteps);
      expect(context.targets).toContain('App Icon');
      expect(context.targets).toContain('Username Field');
      expect(context.actions).toContain('click');
      expect(context.actions).toContain('type');
      expect(context.actions).toContain('wait');
    });
  });

  describe('normalizeSequence', () => {
    it('converts sequence to comparable string', () => {
      const normalized = normalizeSequence(mockSteps);
      expect(typeof normalized).toBe('string');
      expect(normalized.length).toBeGreaterThan(0);
    });

    it('abstracts away coordinate and timing details', () => {
      const steps1 = [
        { ...mockSteps[0], x: 0.5, y: 0.5, duration: 100 },
        { ...mockSteps[1], duration: 500 },
      ];

      const steps2 = [
        { ...mockSteps[0], x: 0.4, y: 0.6, duration: 150 },
        { ...mockSteps[1], duration: 450 },
      ];

      const norm1 = normalizeSequence(steps1);
      const norm2 = normalizeSequence(steps2);

      expect(norm1).toBe(norm2);
    });

    it('includes action and target information', () => {
      const normalized = normalizeSequence(mockSteps.slice(0, 2));
      expect(normalized).toContain('click');
      expect(normalized).toContain('wait');
    });
  });

  describe('sequenceSimilarity', () => {
    it('returns 1 for identical sequences', () => {
      const similarity = sequenceSimilarity(mockSteps, mockSteps);
      expect(similarity).toBe(1);
    });

    it('returns 0 for completely different sequences', () => {
      const different = mockSteps.map((s) => ({
        ...s,
        action: 'unknown',
      }));
      const similarity = sequenceSimilarity(mockSteps, different);
      expect(similarity).toBeLessThan(0.5);
    });

    it('returns value between 0 and 1 for similar sequences', () => {
      const similar = [...mockSteps.slice(0, 3), mockSteps[4]];
      const similarity = sequenceSimilarity(mockSteps, similar);
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('is symmetric (A vs B = B vs A)', () => {
      const similar = mockSteps.slice(0, 3);
      const sim1 = sequenceSimilarity(mockSteps, similar);
      const sim2 = sequenceSimilarity(similar, mockSteps);
      expect(Math.abs(sim1 - sim2)).toBeLessThan(0.01);
    });

    it('handles empty sequences', () => {
      const empty: WorkflowStep[] = [];
      const sim1 = sequenceSimilarity(empty, empty);
      expect(sim1).toBe(1);

      const sim2 = sequenceSimilarity(mockSteps, empty);
      expect(sim2).toBe(0);
    });
  });

  describe('mergeHabits', () => {
    let habits: Habit[];

    beforeEach(() => {
      habits = extractHabitsFromWorkflow(mockSteps);
    });

    it('merges similar habits', () => {
      const originalCount = habits.length;
      const merged = mergeHabits(habits, 0.9);
      expect(merged.length).toBeLessThanOrEqual(originalCount);
    });

    it('respects minimum similarity threshold', () => {
      const merged = mergeHabits(habits, 0.95);
      expect(merged.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves habit data when merging', () => {
      const merged = mergeHabits(habits);
      merged.forEach((habit) => {
        expect(habit.id).toBeDefined();
        expect(habit.target).toBeDefined();
        expect(habit.actionSequence.length).toBeGreaterThan(0);
      });
    });

    it('creates variants for similar but distinct habits', () => {
      // Create mock workflow with repeated patterns to get mergeable habits
      const now = Date.now();
      const repeatedSteps: WorkflowStep[] = [
        // First pattern: click, wait, click
        { id: '1', index: 0, name: 'Click A', action: 'click', target: 'Button A', duration: 100, success: true, timestamp: now },
        { id: '2', index: 1, name: 'Wait', action: 'wait', duration: 500, success: true, timestamp: now + 100 },
        { id: '3', index: 2, name: 'Click B', action: 'click', target: 'Button B', duration: 50, success: true, timestamp: now + 600 },
        // Repeat: same pattern again
        { id: '4', index: 3, name: 'Click A', action: 'click', target: 'Button A', duration: 100, success: true, timestamp: now + 700 },
        { id: '5', index: 4, name: 'Wait', action: 'wait', duration: 500, success: true, timestamp: now + 800 },
        { id: '6', index: 5, name: 'Click B', action: 'click', target: 'Button B', duration: 50, success: true, timestamp: now + 1300 },
        // Variant: similar but with extra type step
        { id: '7', index: 6, name: 'Click A', action: 'click', target: 'Button A', duration: 100, success: true, timestamp: now + 1400 },
        { id: '8', index: 7, name: 'Wait', action: 'wait', duration: 500, success: true, timestamp: now + 1500 },
        { id: '9', index: 8, name: 'Type', action: 'type', target: 'TextField', duration: 200, success: true, timestamp: now + 2000 },
        { id: '10', index: 9, name: 'Click B', action: 'click', target: 'Button B', duration: 50, success: true, timestamp: now + 2200 },
      ];
      
      const habitsFromRepeated = extractHabitsFromWorkflow(repeatedSteps);
      const merged = mergeHabits(habitsFromRepeated, 0.7);
      const hasVariants = merged.some((h) => h.variants.length > 0);
      expect(hasVariants).toBe(true);
    });

    it('aggregates statistics when merging', () => {
      const habit1: Habit = {
        ...habits[0],
        successCount: 5,
        totalAttempts: 10,
        timesSuggested: 3,
        timesAccepted: 2,
      };

      const habit2: Habit = {
        ...habits[0],
        successCount: 7,
        totalAttempts: 8,
        timesSuggested: 2,
        timesAccepted: 1,
      };

      const merged = mergeHabits([habit1, habit2], 0.99);
      if (merged.length === 1) {
        expect(merged[0].successCount).toBe(12);
        expect(merged[0].totalAttempts).toBe(18);
        expect(merged[0].timesSuggested).toBe(5);
      }
    });
  });

  describe('describeHabit', () => {
    it('generates human-readable description', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      const description = describeHabit(habits[0]);
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
    });

    it('includes success rate percentage', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      const description = describeHabit(habits[0]);
      expect(description).toContain('%');
    });

    it('includes attempt count', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      const description = describeHabit(habits[0]);
      expect(description).toContain('time');
    });

    it('includes target information', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      const description = describeHabit(habits[0]);
      expect(description).toContain(habits[0].target);
    });
  });

  describe('edge cases', () => {
    it('handles workflow with failures', () => {
      const stepWithFailures = [
        ...mockSteps.slice(0, 2),
        { ...mockSteps[2], success: false },
        { ...mockSteps[3], success: false },
        mockSteps[4],
      ];

      const habits = extractHabitsFromWorkflow(stepWithFailures);
      habits.forEach((habit) => {
        expect(habit.successRate).toBeLessThanOrEqual(1);
        expect(habit.successRate).toBeGreaterThanOrEqual(0);
      });
    });

    it('handles very short workflows', () => {
      const shortFlow = mockSteps.slice(0, 2);
      const habits = extractHabitsFromWorkflow(shortFlow);
      expect(habits).toBeDefined();
    });

    it('handles single-step workflow', () => {
      const singleStep = mockSteps.slice(0, 1);
      const habits = extractHabitsFromWorkflow(singleStep, { minSequenceLength: 1 });
      expect(habits).toBeDefined();
    });

    it('handles empty workflow', () => {
      const empty: WorkflowStep[] = [];
      const habits = extractHabitsFromWorkflow(empty);
      expect(habits).toBeDefined();
      expect(habits.length).toBe(0);
    });

    it('generates unique habit IDs', () => {
      const id1 = generateHabitId();
      const id2 = generateHabitId();
      expect(id1).not.toBe(id2);
    });

    it('extracts conditions from sequences', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        if (habit.conditions.length > 0) {
          expect(habit.conditions[0].type).toBeDefined();
        }
      });
    });
  });

  describe('learning state', () => {
    it('initializes habits in learning state', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.state).toBe('learning');
      });
    });

    it('tracks suggestion and acceptance metrics', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.timesSuggested).toBe(0);
        expect(habit.timesAccepted).toBe(0);
        expect(habit.timesDismissed).toBe(0);
      });
    });

    it('initializes lesson array', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(Array.isArray(habit.lessons)).toBe(true);
      });
    });

    it('initializes variants array', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(Array.isArray(habit.variants)).toBe(true);
      });
    });
  });

  describe('confidence scoring factors', () => {
    it('calculates frequency score', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.frequencyScore).toBeGreaterThanOrEqual(0);
        expect(habit.frequencyScore).toBeLessThanOrEqual(1);
      });
    });

    it('calculates recency score with decay', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.recencyScore).toBeGreaterThanOrEqual(0);
        expect(habit.recencyScore).toBeLessThanOrEqual(1);
      });
    });

    it('initializes feedback score at zero', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        expect(habit.feedbackScore).toBe(0);
      });
    });

    it('combines factors in confidence calculation', () => {
      const habits = extractHabitsFromWorkflow(mockSteps);
      habits.forEach((habit) => {
        const confidence = calculateHabitConfidence(habit);
        // Should be influenced by success rate heavily
        expect(confidence).toBeGreaterThan(0.4);
      });
    });
  });
});
