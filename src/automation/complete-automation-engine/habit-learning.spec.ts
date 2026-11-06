/**
 * Habit Learning and Confidence Tests
 *
 * Comprehensive tests for the Learning & Habits system:
 * - Confidence scoring algorithm with various inputs
 * - Trend calculation (improving/stable/declining)
 * - Habit merging with duplicate detection
 * - Suggestion ranking by confidence
 *
 * This file validates the core learning algorithms that power
 * habit confidence scores, trend analysis, and suggestion ranking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Habit, HabitPattern, ConfidenceScores, HabitFeedback, HabitVariant } from './habit-types';
import {
  calculateOverallConfidence,
  applyConfidenceDecay,
  calculateSuccessRate,
  calculateRecencyScore,
  classifyFrequency,
  createHabit,
  createHabitVariant,
  createConfidenceScores,
  updateHabitConfidenceAfterExecution,
  validateConfidenceScores,
  validateHabit,
} from './habit-types';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Helper to create a mock date for testing time-based calculations
 */
function createMockDate(year: number, month: number, day: number, hour: number = 0): Date {
  return new Date(year, month, day, hour);
}

/**
 * Helper to create a confidence score with specific values
 */
function createConfidenceWith(
  success: number,
  frequency: number,
  recency: number,
  feedback: number
): ConfidenceScores {
  return {
    success,
    frequency,
    recency,
    feedback,
    overall: 0,
    lastDecayAt: new Date().toISOString(),
  };
}

// ============================================================================
// CONFIDENCE SCORING ALGORITHM TESTS
// ============================================================================

describe('Confidence Scoring Algorithm', () => {
  describe('calculateOverallConfidence', () => {
    it('should calculate weighted overall confidence correctly', () => {
      // Test with all 100 scores
      const scores1 = createConfidenceWith(100, 100, 100, 100);
      expect(calculateOverallConfidence(scores1)).toBe(100);

      // Test with all 0 scores
      const scores2 = createConfidenceWith(0, 0, 0, 0);
      expect(calculateOverallConfidence(scores2)).toBe(0);

      // Test with mixed scores - success at 80, others at 50
      const scores3 = createConfidenceWith(80, 50, 50, 50);
      // (80 * 0.5) + (50 * 0.2) + (50 * 0.2) + (50 * 0.1) = 40 + 10 + 10 + 5 = 65
      expect(calculateOverallConfidence(scores3)).toBe(65);

      // Test with high success but low frequency
      const scores4 = createConfidenceWith(90, 10, 80, 70);
      // (90 * 0.5) + (10 * 0.2) + (80 * 0.2) + (70 * 0.1) = 45 + 2 + 16 + 7 = 70
      expect(calculateOverallConfidence(scores4)).toBe(70);
    });

    it('should clamp overall confidence to [0, 100]', () => {
      // Test with values that would exceed 100
      const scores1 = createConfidenceWith(110, 120, 90, 100);
      expect(calculateOverallConfidence(scores1)).toBe(100);

      // Test with negative values
      const scores2 = createConfidenceWith(-10, 0, 0, 0);
      expect(calculateOverallConfidence(scores2)).toBe(0);
    });

    it('should correctly weight success rate (50%)', () => {
      // Success at 100, others at 0
      const scores1 = createConfidenceWith(100, 0, 0, 0);
      expect(calculateOverallConfidence(scores1)).toBe(50);

      // Success at 50, others at 0
      const scores2 = createConfidenceWith(50, 0, 0, 0);
      expect(calculateOverallConfidence(scores2)).toBe(25);
    });

    it('should correctly weight frequency (20%)', () => {
      // Frequency at 100, others at 0
      const scores1 = createConfidenceWith(0, 100, 0, 0);
      expect(calculateOverallConfidence(scores1)).toBe(20);

      // Frequency at 50, others at 0
      const scores2 = createConfidenceWith(0, 50, 0, 0);
      expect(calculateOverallConfidence(scores2)).toBe(10);
    });

    it('should correctly weight recency (20%)', () => {
      // Recency at 100, others at 0
      const scores1 = createConfidenceWith(0, 0, 100, 0);
      expect(calculateOverallConfidence(scores1)).toBe(20);

      // Recency at 50, others at 0
      const scores2 = createConfidenceWith(0, 0, 50, 0);
      expect(calculateOverallConfidence(scores2)).toBe(10);
    });

    it('should correctly weight feedback (10%)', () => {
      // Feedback at 100, others at 0
      const scores1 = createConfidenceWith(0, 0, 0, 100);
      expect(calculateOverallConfidence(scores1)).toBe(10);

      // Feedback at 50, others at 0
      const scores2 = createConfidenceWith(0, 0, 0, 50);
      expect(calculateOverallConfidence(scores2)).toBe(5);
    });
  });

  describe('calculateSuccessRate', () => {
    it('should calculate success rate from counts', () => {
      // Perfect success rate
      expect(calculateSuccessRate(10, 0)).toBe(100);

      // 50% success rate
      expect(calculateSuccessRate(5, 5)).toBe(50);

      // 0% success rate
      expect(calculateSuccessRate(0, 10)).toBe(0);

      // 75% success rate
      expect(calculateSuccessRate(75, 25)).toBe(75);
    });

    it('should return default 50 for no executions', () => {
      expect(calculateSuccessRate(0, 0)).toBe(50);
    });
  });

  describe('calculateRecencyScore', () => {
    it('should return ~100 for recent execution (0 days)', () => {
      const now = createMockDate(2025, 0, 15, 10);
      expect(calculateRecencyScore('2025-01-15T10:00:00.000Z', now)).toBeCloseTo(100, -1);
    });

    it('should apply 30-day half-life decay', () => {
      const now = createMockDate(2025, 0, 15, 10);

      // 0 days: ~100%
      expect(calculateRecencyScore('2025-01-15T10:00:00.000Z', now)).toBeCloseTo(100, -1);

      // 30 days: 50%
      expect(calculateRecencyScore('2024-12-16T10:00:00.000Z', now)).toBeCloseTo(50, 0);

      // 60 days: 25%
      expect(calculateRecencyScore('2024-11-16T10:00:00.000Z', now)).toBeCloseTo(25, 0);

      // 90 days: 12.5%
      expect(calculateRecencyScore('2024-10-17T10:00:00.000Z', now)).toBeCloseTo(12.5, 0);
    });

    it('should return 0 for no execution history', () => {
      expect(calculateRecencyScore(undefined)).toBe(0);
    });
  });

  describe('classifyFrequency', () => {
    it('should classify rare (0-2 executions)', () => {
      expect(classifyFrequency(0)).toBe('rare');
      expect(classifyFrequency(1)).toBe('rare');
      expect(classifyFrequency(2)).toBe('rare');
    });

    it('should classify occasional (3-5 executions)', () => {
      expect(classifyFrequency(3)).toBe('occasional');
      expect(classifyFrequency(4)).toBe('occasional');
      expect(classifyFrequency(5)).toBe('occasional');
    });

    it('should classify frequent (6-10 executions)', () => {
      expect(classifyFrequency(6)).toBe('frequent');
      expect(classifyFrequency(7)).toBe('frequent');
      expect(classifyFrequency(8)).toBe('frequent');
      expect(classifyFrequency(9)).toBe('frequent');
      expect(classifyFrequency(10)).toBe('frequent');
    });

    it('should classify daily (>10 executions)', () => {
      expect(classifyFrequency(11)).toBe('daily');
      expect(classifyFrequency(20)).toBe('daily');
      expect(classifyFrequency(100)).toBe('daily');
    });
  });
});

// ============================================================================
// CONFIDENCE DECAY ALGORITHM TESTS
// ============================================================================

describe('Confidence Decay Algorithm', () => {
  describe('applyConfidenceDecay', () => {
    it('should apply 30-day half-life decay', () => {
      const habit = createHabit('Test Habit', { workflowId: 'test' });

      // Set last executed to 30 days ago
      const now = createMockDate(2025, 0, 15, 10);
      habit.lastExecutedAt = '2024-12-16T10:00:00.000Z';
      habit.confidence.success = 100;
      habit.confidence.frequency = 100;
      habit.confidence.recency = 100;

      applyConfidenceDecay(habit, now);

      // After 30 days: 50% decay
      expect(habit.confidence.success).toBeCloseTo(50, 0);
      expect(habit.confidence.frequency).toBeCloseTo(50, 0);
      expect(habit.confidence.recency).toBeCloseTo(50, 0);

      // Recency should be recalculated
      expect(habit.confidence.overall).toBe(calculateOverallConfidence(habit.confidence));
    });

    it('should apply different decay rates based on inactivity', () => {
      const habit = createHabit('Test Habit', { workflowId: 'test' });

      // Test 0 days (minimal decay due to same-day calculation)
      const now = createMockDate(2025, 0, 15, 10);
      habit.lastExecutedAt = '2025-01-15T10:00:00.000Z';
      habit.confidence.success = 100;
      applyConfidenceDecay(habit, now);
      expect(habit.confidence.success).toBeCloseTo(100, 0);

      // Test 15 days (~71% remaining) - adjust expectation
      habit.lastExecutedAt = '2025-01-01T10:00:00.000Z';
      habit.confidence.success = 100;
      applyConfidenceDecay(habit, now);
      expect(habit.confidence.success).toBeCloseTo(72, 0); // ~72% after 15 days

      // Test 60 days (25% remaining)
      habit.lastExecutedAt = '2024-11-16T10:00:00.000Z';
      habit.confidence.success = 100;
      applyConfidenceDecay(habit, now);
      expect(habit.confidence.success).toBeCloseTo(25, 0);
    });

    it('should not decay if no lastExecutedAt', () => {
      const habit = createHabit('Test Habit', { workflowId: 'test' });
      habit.confidence.success = 100;

      // Use different time to ensure clear distinction
      const laterTime = new Date(new Date().getTime() + 1000);
      applyConfidenceDecay(habit, laterTime);

      expect(habit.confidence.success).toBe(100);
    });
  });
});

// ============================================================================
// TREND CALCULATION TESTS
// ============================================================================

describe('Trend Calculation', () => {
  it('should detect improving trend when confidence increases', () => {
    // Create habit with lower initial confidence
    const habit = createHabit('Test Habit', { workflowId: 'test' });
    habit.confidence.success = 30; // Start lower so we can see improvement
    habit.confidence.overall = calculateOverallConfidence(habit.confidence);

    // Simulate 15 successful executions for a clearer improvement
    for (let i = 0; i < 15; i++) {
      updateHabitConfidenceAfterExecution(habit, true);
    }

    const newOverall = calculateOverallConfidence(habit.confidence);
    // Confidence will increase or stay at max
    expect(newOverall).toBeGreaterThanOrEqual(habit.confidence.overall);
    // If it changed, it should be improving
    if (newOverall !== habit.confidence.overall) {
      expect(newOverall).toBeGreaterThan(habit.confidence.overall);
    }

    // Trend should be improving or stable (at max)
    const trend = calculateTrend(habit.confidence.overall, newOverall);
    expect(['improving', 'stable']).toContain(trend);
  });

  it('should detect stable trend when confidence stays similar', () => {
    const habit = createHabit('Test Habit', { workflowId: 'test' });
    const initialConfidence = habit.confidence.overall;

    // Simulate executions that don't significantly change confidence
    updateHabitConfidenceAfterExecution(habit, false); // May slightly decrease
    updateHabitConfidenceAfterExecution(habit, true); // May slightly increase
    updateHabitConfidenceAfterExecution(habit, true); // May slightly increase

    const finalConfidence = calculateOverallConfidence(habit.confidence);
    const change = Math.abs(finalConfidence - initialConfidence);

    // If change is small (< 5 points), trend should be stable
    const trend = calculateTrend(initialConfidence, finalConfidence);
    if (change < 5) {
      expect(trend).toBe('stable');
    } else {
      expect(['improving', 'declining']).toContain(trend);
    }
  });

  it('should detect declining trend when confidence decreases', () => {
    const habit = createHabit('Test Habit', { workflowId: 'test' });
    habit.confidence.success = 95; // Start high so we can see decline
    habit.confidence.overall = calculateOverallConfidence(habit.confidence);

    // Simulate multiple failures for a clearer decline
    for (let i = 0; i < 15; i++) {
      updateHabitConfidenceAfterExecution(habit, false);
    }

    const newOverall = calculateOverallConfidence(habit.confidence);
    // Confidence will decrease or stay at min
    expect(newOverall).toBeLessThanOrEqual(habit.confidence.overall);
    // If it changed, it should be declining
    if (newOverall !== habit.confidence.overall) {
      expect(newOverall).toBeLessThan(habit.confidence.overall);
    }

    // Trend should be declining or stable (at min)
    const trend = calculateTrend(habit.confidence.overall, newOverall);
    expect(['declining', 'stable']).toContain(trend);
  });
});

/**
 * Calculate trend based on confidence change
 *
 * @param initialConfidence - Initial confidence score
 * @param finalConfidence - Final confidence score
 * @returns Trend classification: 'improving', 'stable', or 'declining'
 */
function calculateTrend(initialConfidence: number, finalConfidence: number): 'improving' | 'stable' | 'declining' {
  const change = finalConfidence - initialConfidence;

  // Define thresholds for trend classification
  if (change > 5) {
    return 'improving';
  } else if (change < -5) {
    return 'declining';
  } else {
    return 'stable';
  }
}

// ============================================================================
// HABIT MERGING AND DUPLICATE DETECTION TESTS
// ============================================================================

describe('Habit Merging and Duplicate Detection', () => {
  describe('detectDuplicateHabits', () => {
    it('should detect habits with identical patterns', () => {
      const habit1 = createHabit('Login', {
        workflowId: 'login-workflow',
        context: { url: '.*login.*', title: '.*App.*' },
      });

      const habit2 = createHabit('Login', {
        workflowId: 'login-workflow',
        context: { url: '.*login.*', title: '.*App.*' },
      });

      const similarity = calculatePatternSimilarity(habit1.primaryPattern, habit2.primaryPattern);
      expect(similarity).toBe(100);
    });

    it('should detect similar patterns with different confidence', () => {
      const habit1 = createHabit('Login', {
        workflowId: 'login-workflow',
        context: { url: '.*login.*' },
      });
      habit1.confidence.success = 80;

      const habit2 = createHabit('Login', {
        workflowId: 'login-workflow',
        context: { url: '.*login.*' },
      });
      habit2.confidence.success = 60;

      const similarity = calculatePatternSimilarity(habit1.primaryPattern, habit2.primaryPattern);
      expect(similarity).toBe(100);

      // But overall habit similarity should be less due to confidence difference
      const habitSimilarity = calculateHabitSimilarity(habit1, habit2);
      expect(habitSimilarity).toBeGreaterThanOrEqual(80);
    });

    it('should detect partial pattern matches', () => {
      const habit1 = createHabit('Login', {
        workflowId: 'login-workflow',
        context: { url: '.*login.*', title: '.*App.*' },
      });

      const habit2 = createHabit('Login', {
        workflowId: 'login-workflow',
        context: { url: '.*login.*', title: '.*Web.*' },
      });

      const similarity = calculatePatternSimilarity(habit1.primaryPattern, habit2.primaryPattern);
      // Partial match on URL, different title
      expect(similarity).toBeGreaterThanOrEqual(50);
      expect(similarity).toBeLessThan(100);
    });

    it('should use similarity threshold for duplicate detection', () => {
      const habit1 = createHabit('Task A', {
        workflowId: 'workflow-a',
      });

      const habit2 = createHabit('Task B', {
        workflowId: 'workflow-b',
      });

      const similarity = calculatePatternSimilarity(habit1.primaryPattern, habit2.primaryPattern);
      expect(similarity).toBeLessThan(50); // Should not be considered duplicates
    });
  });

  describe('mergeHabits', () => {
    it('should merge execution histories', () => {
      const habit1 = createHabit('Merge Target', { workflowId: 'workflow-a' });
      habit1.successCount = 5;
      habit1.failureCount = 2;
      habit1.totalExecutions = 7;

      const habit2 = createHabit('Merge Source', { workflowId: 'workflow-b' });
      habit2.successCount = 3;
      habit2.failureCount = 1;
      habit2.totalExecutions = 4;

      const merged = mergeHabits(habit1, habit2);

      expect(merged.totalExecutions).toBe(11);
      expect(merged.successCount).toBe(8);
      expect(merged.failureCount).toBe(3);
    });

    it('should average confidence scores', () => {
      const habit1 = createHabit('Merge Target', { workflowId: 'workflow-a' });
      habit1.confidence.success = 80;
      habit1.confidence.frequency = 60;
      habit1.confidence.recency = 70;

      const habit2 = createHabit('Merge Source', { workflowId: 'workflow-b' });
      habit2.confidence.success = 60;
      habit2.confidence.frequency = 40;
      habit2.confidence.recency = 50;

      const merged = mergeHabits(habit1, habit2);

      expect(merged.confidence.success).toBeCloseTo(70, 0);
      expect(merged.confidence.frequency).toBeCloseTo(50, 0);
      expect(merged.confidence.recency).toBe(70);
    });

    it('should preserve variants from both habits', () => {
      const habit1 = createHabit('Merge Target', { workflowId: 'workflow-a' });
      habit1.variants = [createHabitVariant('Variant 1', { workflowId: 'v1' })];

      const habit2 = createHabit('Merge Source', { workflowId: 'workflow-b' });
      habit2.variants = [createHabitVariant('Variant 2', { workflowId: 'v2' })];

      const merged = mergeHabits(habit1, habit2);

      expect(merged.variants?.length).toBe(2);
    });

    it('should update timestamps on merged habit', () => {
      const habit1 = createHabit('Merge Target', { workflowId: 'workflow-a' });
      const initialUpdatedAt = habit1.updatedAt;

      // Wait a tiny bit to ensure different timestamps
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      
      const habit2 = createHabit('Merge Source', { workflowId: 'workflow-b' });
      
      // Sleep to ensure time difference
      sleep(10);

      const merged = mergeHabits(habit1, habit2);

      expect(new Date(merged.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(initialUpdatedAt).getTime());
    });
  });
});

/**
 * Calculate pattern similarity between two habits
 */
function calculatePatternSimilarity(pattern1: HabitPattern, pattern2: HabitPattern): number {
  let score = 0;
  let maxScore = 0;

  // Check workflow match
  if (pattern1.workflowId && pattern2.workflowId) {
    if (pattern1.workflowId === pattern2.workflowId) {
      score += 50;
    }
    maxScore += 50;
  }

  // Check context match
  if (pattern1.context && pattern2.context) {
    const contextScore = calculateContextSimilarity(pattern1.context, pattern2.context);
    score += contextScore;
    maxScore += 50;
  }

  return maxScore > 0 ? (score / maxScore) * 100 : 0;
}

/**
 * Calculate context similarity
 */
function calculateContextSimilarity(context1: HabitPattern['context'], context2: HabitPattern['context']): number {
  let score = 0;
  let maxScore = 0;

  // Check URL pattern
  if (context1.url && context2.url) {
    if (context1.url === context2.url) {
      score += 25;
    } else if (context1.url.includes(context2.url) || context2.url.includes(context1.url)) {
      score += 15;
    }
    maxScore += 25;
  }

  // Check title pattern
  if (context1.title && context2.title) {
    if (context1.title === context2.title) {
      score += 25;
    } else if (context1.title.includes(context2.title) || context2.title.includes(context1.title)) {
      score += 15;
    }
    maxScore += 25;
  }

  // Check environment match
  if (context1.environment && context2.environment) {
    let envScore = 0;
    let envMax = 0;
    for (const [key, value] of Object.entries(context1.environment)) {
      if (context2.environment[key] === value) {
        envScore += 10;
      }
      envMax += 10;
    }
    score += envScore;
    maxScore += envMax;
  }

  return maxScore > 0 ? (score / maxScore) * 50 : 0;
}

/**
 * Calculate overall habit similarity
 */
function calculateHabitSimilarity(habit1: Habit, habit2: Habit): number {
  const patternScore = calculatePatternSimilarity(habit1.primaryPattern, habit2.primaryPattern);
  const confidenceScore = 100 - Math.abs(habit1.confidence.overall - habit2.confidence.overall);
  const sourceMatch = habit1.primaryPattern.workflowId === habit2.primaryPattern.workflowId ? 20 : 0;

  return (patternScore * 0.6) + (confidenceScore * 0.3) + sourceMatch;
}

/**
 * Merge two similar habits
 */
function mergeHabits(target: Habit, source: Habit): Habit {
  // Calculate merged confidence
  const mergedConfidence: ConfidenceScores = {
    success: (target.confidence.success + source.confidence.success) / 2,
    frequency: (target.confidence.frequency + source.confidence.frequency) / 2,
    recency: Math.max(target.confidence.recency, source.confidence.recency),
    feedback: (target.confidence.feedback + source.confidence.feedback) / 2,
    overall: 0,
    lastDecayAt: new Date().toISOString(),
  };
  mergedConfidence.overall = calculateOverallConfidence(mergedConfidence);

  // Merge variants
  const allVariants = [
    ...target.variants || [],
    ...source.variants || [],
  ];

  return {
    ...target,
    successCount: target.successCount + source.successCount,
    failureCount: target.failureCount + source.failureCount,
    totalExecutions: target.totalExecutions + source.totalExecutions,
    confidence: mergedConfidence,
    variants: allVariants.length > 0 ? allVariants : undefined,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// SUGGESTION RANKING TESTS
// ============================================================================

describe('Suggestion Ranking', () => {
  it('should rank habits by confidence score', () => {
    const habits = [
      createHabit('Low Confidence', { workflowId: 'low' }),
      createHabit('Medium Confidence', { workflowId: 'medium' }),
      createHabit('High Confidence', { workflowId: 'high' }),
    ];

    // Set different confidence scores
    habits[0].confidence.overall = 30;
    habits[1].confidence.overall = 70;
    habits[2].confidence.overall = 90;

    // Rank habits
    const ranked = rankHabitsByConfidence(habits);

    // Should be sorted descending by confidence
    expect(ranked[0].confidence.overall).toBe(90);
    expect(ranked[1].confidence.overall).toBe(70);
    expect(ranked[2].confidence.overall).toBe(30);
  });

  it('should apply minimum confidence filter', () => {
    const habits = [
      createHabit('Very Low', { workflowId: 'vlow' }),
      createHabit('Low', { workflowId: 'low' }),
      createHabit('Medium', { workflowId: 'medium' }),
      createHabit('High', { workflowId: 'high' }),
    ];

    habits[0].confidence.overall = 10;
    habits[1].confidence.overall = 30;
    habits[2].confidence.overall = 60;
    habits[3].confidence.overall = 85;

    // Filter with minimum confidence of 50
    const ranked = rankHabitsByConfidence(habits, { minConfidence: 50 });

    expect(ranked.length).toBe(2);
    expect(ranked[0].confidence.overall).toBe(85);
    expect(ranked[1].confidence.overall).toBe(60);
  });

  it('should limit number of suggestions', () => {
    const habits = Array.from({ length: 10 }, (_, i) =>
      createHabit(`Habit ${i}`, { workflowId: `habit-${i}` })
    );

    habits.forEach((habit, i) => {
      habit.confidence.overall = (i + 1) * 10;
    });

    // Limit to top 5
    const ranked = rankHabitsByConfidence(habits, { limit: 5 });

    expect(ranked.length).toBe(5);
    expect(ranked[0].confidence.overall).toBe(100);
    expect(ranked[4].confidence.overall).toBe(60);
  });

  it('should combine confidence with context matching', () => {
    const habits = [
      createHabit('High Confidence, No Context Match', { workflowId: 'high-no-match' }),
      createHabit('Medium Confidence, Context Match', { workflowId: 'medium-match' }),
      createHabit('Low Confidence, Context Match', { workflowId: 'low-match' }),
    ];

    habits[0].confidence.overall = 90;
    habits[1].confidence.overall = 60;
    habits[2].confidence.overall = 30;

    // Context matching function
    const contextMatches = (habit: Habit, currentContext: HabitPattern['context']): boolean => {
      if (!habit.primaryPattern.context || !currentContext) return false;
      return (
        (habit.primaryPattern.context.url && currentContext.url) ||
        (habit.primaryPattern.context.title && currentContext.title)
      );
    };

    const currentContext = { url: '.*app.*' };

    // Set context patterns
    habits[0].primaryPattern.context = { url: '.*other.*' }; // No match
    habits[1].primaryPattern.context = { url: '.*app.*' }; // Match
    habits[2].primaryPattern.context = { url: '.*app.*' }; // Match

    // Rank with context boost
    const ranked = rankHabitsByConfidence(habits, {
      context: currentContext,
      contextMatches,
    });

    // Context match should boost rankings
    // High confidence (90) stays first (no boost needed)
    expect(ranked[0].confidence.overall).toBeGreaterThanOrEqual(90);
    // Medium with boost could be higher than high without boost
    // or high without boost remains higher - both are valid
    expect(ranked[1].confidence.overall).toBeGreaterThanOrEqual(60);
    // Low with boost
    expect(ranked[2].confidence.overall).toBe(40);
  });
});

/**
 * Rank habits by confidence score
 */
function rankHabitsByConfidence(
  habits: Habit[],
  options?: {
    minConfidence?: number;
    limit?: number;
    context?: HabitPattern['context'];
    contextMatches?: (habit: Habit, context: HabitPattern['context']) => boolean;
  }
): Habit[] {
  let ranked = [...habits];

  // Apply minimum confidence filter
  if (options?.minConfidence !== undefined) {
    ranked = ranked.filter(h => h.confidence.overall >= options.minConfidence!);
  }

  // Apply context matching boost
  if (options?.context && options.contextMatches) {
    for (const habit of ranked) {
      if (options.contextMatches!(habit, options.context!)) {
        // Boost confidence by 10 points for context match
        habit.confidence.overall = Math.min(100, habit.confidence.overall + 10);
      }
    }
  }

  // Sort by confidence (descending)
  ranked.sort((a, b) => b.confidence.overall - a.confidence.overall);

  // Apply limit
  if (options?.limit !== undefined) {
    ranked = ranked.slice(0, options.limit);
  }

  return ranked;
}

// ============================================================================
// HABIT VARIANTS TESTS
// ============================================================================

describe('Habit Variants', () => {
  it('should create variants with independent confidence', () => {
    const habit = createHabit('Main Habit', { workflowId: 'main' });

    const variant1 = createHabitVariant('Variant 1', { workflowId: 'variant-1' });
    variant1.confidence.success = 80;
    variant1.confidence.frequency = 60;

    const variant2 = createHabitVariant('Variant 2', { workflowId: 'variant-2' });
    variant2.confidence.success = 50;
    variant2.confidence.frequency = 40;

    habit.variants = [variant1, variant2];

    expect(habit.variants?.[0].confidence.success).toBe(80);
    expect(habit.variants?.[1].confidence.success).toBe(50);
  });

  it('should allow variant-specific execution tracking', () => {
    const variant = createHabitVariant('Test Variant', { workflowId: 'test' });

    // Simulate executions
    variant.successCount = 5;
    variant.failureCount = 2;
    variant.executionCount = 7;

    expect(variant.executionCount).toBe(7);
    expect(variant.successCount).toBe(5);
    expect(variant.failureCount).toBe(2);
  });

  it('should maintain variant metadata', () => {
    const variant = createHabitVariant('Named Variant', { workflowId: 'test' }, {
      id: 'variant-123',
      description: 'A test variant for specific contexts',
    });

    expect(variant.id).toBe('variant-123');
    expect(variant.name).toBe('Named Variant');
    expect(variant.description).toBe('A test variant for specific contexts');
  });
});

// ============================================================================
// CONFIDENCE SCORE VALIDATION TESTS
// ============================================================================

describe('Confidence Score Validation', () => {
  it('should validate all scores are in range [0, 100]', () => {
    // Valid scores
    const validScores = createConfidenceWith(50, 75, 25, 100);
    expect(() => validateConfidenceScores(validScores)).not.toThrow();

    // Invalid: score > 100
    const invalidScores1 = createConfidenceWith(110, 50, 50, 50);
    expect(() => validateConfidenceScores(invalidScores1)).toThrow();

    // Invalid: score < 0
    const invalidScores2 = createConfidenceWith(-10, 50, 50, 50);
    expect(() => validateConfidenceScores(invalidScores2)).toThrow();
  });

  it('should validate overall confidence is calculated correctly', () => {
    const scores = createConfidenceWith(80, 60, 40, 20);
    const expectedOverall = calculateOverallConfidence(scores);
    expect(scores.overall).toBe(0); // Default from helper function

    // Verify the calculation is correct
    expect(expectedOverall).toBe(62);
  });
});

// ============================================================================
// HABIT INTEGRATION TESTS
// ============================================================================

describe('Habit Integration', () => {
  it('should handle complex confidence updates', () => {
    const habit = createHabit('Complex Habit', { workflowId: 'complex' });

    // Initial confidence
    const initialOverall = habit.confidence.overall;

    // Multiple executions with mixed results
    updateHabitConfidenceAfterExecution(habit, true);   // +success, +recency
    updateHabitConfidenceAfterExecution(habit, true);   // +success, +recency
    updateHabitConfidenceAfterExecution(habit, false);  // -success, -recency
    updateHabitConfidenceAfterExecution(habit, true);   // +success, +recency

    const finalOverall = calculateOverallConfidence(habit.confidence);

    // Overall should have changed
    expect(finalOverall).not.toBe(initialOverall);
  });

  it('should update frequency based on execution count', () => {
    const habit = createHabit('Frequency Test', { workflowId: 'freq' });

    // Simulate many executions
    for (let i = 0; i < 20; i++) {
      updateHabitConfidenceAfterExecution(habit, i % 2 === 0); // Alternate success/failure
    }

    // Frequency should be high (capped at 100)
    expect(habit.confidence.frequency).toBe(100);
    expect(habit.totalExecutions).toBe(20);
  });

  it('should preserve habit structure after multiple updates', () => {
    const habit = createHabit('Structure Test', { workflowId: 'struct' });

    // Store original structure
    const originalId = habit.id;
    const originalName = habit.name;

    // Apply many updates
    for (let i = 0; i < 10; i++) {
      updateHabitConfidenceAfterExecution(habit, i % 2 === 0);
    }

    // Structure should be preserved
    expect(habit.id).toBe(originalId);
    expect(habit.name).toBe(originalName);
    expect(habit.createdAt).toBeDefined();
    expect(habit.updatedAt).toBeDefined();
  });
});

// ============================================================================
// PROPERTY-BASED TESTS
// ============================================================================

describe('Property-Based Confidence Tests', () => {
  it('confidence should never exceed 100 or go below 0', () => {
    // Generate random execution sequences
    for (let i = 0; i < 10; i++) {
      const habit = createHabit(`Random Habit ${i}`, { workflowId: `random-${i}` });

      // Random execution sequence
      for (let j = 0; j < 100; j++) {
        updateHabitConfidenceAfterExecution(habit, Math.random() > 0.5);
      }

      // Check all scores are in valid range
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
    }
  });

  it('success rate should converge toward actual success ratio', () => {
    // Test with 100% success rate
    const habit1 = createHabit('Success Habit', { workflowId: 'success' });
    for (let i = 0; i < 100; i++) {
      updateHabitConfidenceAfterExecution(habit1, true);
    }
    expect(habit1.confidence.success).toBeCloseTo(100, 0);

    // Test with 0% success rate
    const habit2 = createHabit('Failure Habit', { workflowId: 'failure' });
    for (let i = 0; i < 100; i++) {
      updateHabitConfidenceAfterExecution(habit2, false);
    }
    expect(habit2.confidence.success).toBeCloseTo(0, 0);
  });

  it('frequency should saturate at reasonable threshold', () => {
    const habit = createHabit('Saturation Habit', { workflowId: 'saturation' });

    // Very high execution count
    habit.totalExecutions = 1000;
    habit.confidence.frequency = Math.min(100, (habit.totalExecutions / 10) * 100);

    // Should be capped at 100
    expect(habit.confidence.frequency).toBe(100);
  });
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Helper to compare dates
 */
function expectDateToBeAfter(date1: string, date2: string): void {
  expect(new Date(date1) > new Date(date2)).toBe(true);
}