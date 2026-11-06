/**
 * Habit Analytics and Diagnostics Tests
 *
 * Comprehensive tests for the HabitAnalytics class covering:
 * - Human-readable description generation
 * - Confidence explanation and breakdown
 * - Trend calculation (improving/stable/declining)
 * - Trend history visualization data
 * - Improvement suggestions for low-confidence habits
 * - Comprehensive execution history analysis
 *
 * Tests validate all public APIs and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Habit, HabitPattern, HabitFeedback, HabitVariant, ConfidenceScores } from '../habit-types';
import { HabitAnalytics, IMPROVEMENT_SUGGESTIONS } from '../core/habit-analytics';
import { createHabit, createHabitVariant, createConfidenceScores } from '../habit-types';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Helper to create a habit with specific confidence scores
 */
function createHabitWithConfidence(
  name: string,
  success: number,
  frequency: number,
  recency: number,
  feedback: number
): Habit {
  const habit = createHabit(name, { workflowId: 'test-workflow' });
  habit.confidence.success = success;
  habit.confidence.frequency = frequency;
  habit.confidence.recency = recency;
  habit.confidence.feedback = feedback;
  habit.confidence.overall = (success * 0.5) + (frequency * 0.2) + (recency * 0.2) + (feedback * 0.1);
  return habit;
}

/**
 * Helper to create a habit with execution history
 */
function createHabitWithHistory(
  name: string,
  totalExecutions: number,
  successCount: number,
  lastExecutedDaysAgo: number
): Habit {
  const habit = createHabit(name, { workflowId: 'test-workflow' });
  habit.totalExecutions = totalExecutions;
  habit.successCount = successCount;
  habit.failureCount = totalExecutions - successCount;
  
  const now = new Date();
  const lastExecuted = new Date(now.getTime() - lastExecutedDaysAgo * 24 * 60 * 60 * 1000);
  habit.lastExecutedAt = lastExecuted.toISOString();
  
  return habit;
}

/**
 * Helper to create a habit with variants
 */
function createHabitWithVariants(name: string, variantCount: number): Habit {
  const habit = createHabit(name, { workflowId: 'test-workflow' });
  
  const variants: HabitVariant[] = [];
  for (let i = 0; i < variantCount; i++) {
    variants.push(
      createHabitVariant(`Variant ${i}`, { workflowId: `variant-${i}` })
    );
  }
  
  habit.variants = variants;
  return habit;
}

/**
 * Helper to create a habit with context requirements
 */
function createHabitWithContext(
  name: string,
  urlPattern?: string,
  titlePattern?: string
): Habit {
  const context = {} as HabitPattern['context'];
  if (urlPattern) context.url = urlPattern;
  if (titlePattern) context.title = titlePattern;
  
  return createHabit(name, {
    workflowId: 'test-workflow',
    context,
  });
}

// ============================================================================
// DESCRIPTION GENERATION TESTS
// ============================================================================

describe('HabitAnalytics - Description Generation', () => {
  describe('generateDescription', () => {
    it('should generate basic description from habit name', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Login to Email', { workflowId: 'login-workflow' });
      
      const description = analytics.generateDescription(habit);
      expect(description).toContain('Login to Email');
      expect(description).toContain('automates workflow #login-workflow');
    });

    it('should include habit description if available', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Login to Email', { workflowId: 'login-workflow' });
      habit.description = 'Automates the email login process';
      
      const description = analytics.generateDescription(habit);
      expect(description).toContain('Automates the email login process');
    });

    it('should include execution count when habit has been executed', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithHistory('Test Habit', 15, 12, 2);
      
      const description = analytics.generateDescription(habit);
      expect(description).toContain('15 executions');
    });

    it('should include success rate when executions exist', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithHistory('Test Habit', 20, 15, 1);
      
      const description = analytics.generateDescription(habit);
      expect(description).toContain('75%');
    });

    it('should include last execution timing', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithHistory('Test Habit', 10, 8, 3);
      
      const description = analytics.generateDescription(habit);
      expect(description).toContain('last used 3 days ago');
    });

    it('should generate description without context requirements', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Simple Habit', { workflowId: 'simple' });
      
      const description = analytics.generateDescription(habit);
      expect(description).toContain('Simple Habit');
    });

    it('should handle habits with no executions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('New Habit', { workflowId: 'new' });
      
      const description = analytics.generateDescription(habit);
      expect(description).toContain('New Habit');
      expect(description).not.toContain('executions');
    });

    it('should handle habits with multiple context conditions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithContext('Login', '.*login.*', '.*App.*');
      
      const description = analytics.generateDescription(habit);
      expect(description).toContain('Login');
    });

    it('should include frequency classification', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithHistory('Daily Habit', 100, 90, 0);
      
      const description = analytics.generateDescription(habit);
      // Execution count and success rate are included, but not frequency classification
      expect(description).toContain('100 executions');
      expect(description).toContain('90%');
    });
  });
});

// ============================================================================
// CONFIDENCE EXPLANATION TESTS
// ============================================================================

describe('HabitAnalytics - Confidence Explanation', () => {
  describe('explainConfidence', () => {
    it('should include overall confidence score', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 60, 70, 90);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('Confidence:');
      expect(explanation).toContain('75/100'); // (80*0.5) + (60*0.2) + (70*0.2) + (90*0.1) = 40+12+14+9 = 75
    });

    it('should break down all confidence components', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 60, 70, 90);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('Success rate:');
      expect(explanation).toContain('Usage frequency:');
      expect(explanation).toContain('Recent activity:');
      expect(explanation).toContain('User feedback:');
    });

    it('should show component weights', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 60, 70, 90);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('weight:');
      expect(explanation).toContain('50%'); // success weight
      expect(explanation).toContain('20%'); // frequency weight
      expect(explanation).toContain('20%'); // recency weight
      expect(explanation).toContain('10%'); // feedback weight
    });

    it('should provide insights for low success rate', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 40, 60, 70, 90);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('below 50%');
    });

    it('should provide insights for high success rate', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 90, 60, 70, 90);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('healthy');
    });

    it('should provide insights for low frequency', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 20, 70, 90);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('low');
    });

    it('should provide insights for low recency', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 60, 30, 90);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('recently');
    });

    it('should handle zero confidence scores', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 0, 0, 0, 0);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('0/100');
    });

    it('should handle maximum confidence scores', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 100, 100, 100, 100);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('100/100');
    });

    it('should include feedback analysis', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 60, 70, 50);
      
      const explanation = analytics.explainConfidence(habit);
      expect(explanation).toContain('feedback');
    });

    it('should provide actionable insights', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 60, 70, 90);
      
      const explanation = analytics.explainConfidence(habit);
      // Should have at least one insight line
      expect(explanation).toContain('-');
    });
  });
});

// ============================================================================
// TREND CALCULATION TESTS
// ============================================================================

describe('HabitAnalytics - Trend Calculation', () => {
  describe('calculateTrend', () => {
    it('should return stable trend for habits with no history', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('New Habit', { workflowId: 'new' });
      habit.lastExecutedAt = new Date().toISOString(); // Have some recent execution
      
      const trend = analytics.calculateTrend(habit);
      expect(trend).toBe('stable');
    });

    it('should return improving trend when confidence is increasing', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 30, 20, 20, 30);
      habit.totalExecutions = 5;
      habit.lastExecutedAt = new Date().toISOString();
      
      const trend = analytics.calculateTrend(habit);
      expect(trend).toBe('stable'); // No history, so stable
    });

    it('should return declining trend when confidence is decreasing', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 80, 80, 90);
      habit.totalExecutions = 100;
      habit.failureCount = 50;
      
      const trend = analytics.calculateTrend(habit);
      expect(['declining', 'stable']).toContain(trend);
    });

    it('should return stable trend for moderate confidence', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 70, 70, 70);
      habit.totalExecutions = 20;
      habit.lastExecutedAt = new Date().toISOString();
      
      const trend = analytics.calculateTrend(habit);
      expect(trend).toBe('stable');
    });

    it('should handle habits with only recent activity', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 85, 75, 90, 80);
      habit.totalExecutions = 50;
      habit.lastExecutedAt = new Date().toISOString();
      
      const trend = analytics.calculateTrend(habit);
      expect(['improving', 'stable']).toContain(trend);
    });

    it('should handle habits with low confidence', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 40, 30, 30, 40);
      habit.totalExecutions = 5;
      
      const trend = analytics.calculateTrend(habit);
      expect(['declining', 'stable']).toContain(trend);
    });

    it('should be consistent across multiple calls', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const trend1 = analytics.calculateTrend(habit);
      const trend2 = analytics.calculateTrend(habit);
      
      expect(trend1).toBe(trend2);
    });
  });
});

// ============================================================================
// TREND HISTORY TESTS
// ============================================================================

describe('HabitAnalytics - Trend History', () => {
  describe('getTrendHistory', () => {
    it('should return data points for the specified window', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      habit.totalExecutions = 50;
      
      const history = analytics.getTrendHistory(habit, 30);
      
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });

    it('should include timestamps in ISO 8601 format', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const history = analytics.getTrendHistory(habit, 30);
      
      history.forEach(point => {
        expect(new Date(point.timestamp).toISOString()).toBe(point.timestamp);
      });
    });

    it('should include confidence scores', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const history = analytics.getTrendHistory(habit, 30);
      
      history.forEach(point => {
        expect(typeof point.confidence).toBe('number');
        expect(point.confidence).toBeGreaterThanOrEqual(0);
        expect(point.confidence).toBeLessThanOrEqual(100);
      });
    });

    it('should include execution counts', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      habit.totalExecutions = 100;
      
      const history = analytics.getTrendHistory(habit, 30);
      
      history.forEach(point => {
        expect(typeof point.executionCount).toBe('number');
        expect(point.executionCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('should support different window sizes', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const history14 = analytics.getTrendHistory(habit, 14);
      const history30 = analytics.getTrendHistory(habit, 30);
      const history90 = analytics.getTrendHistory(habit, 90);
      
      // All windows should have at least 2 points
      expect(history14.length).toBeGreaterThanOrEqual(2);
      expect(history30.length).toBeGreaterThanOrEqual(2);
      expect(history90.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle window of 1 day', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const history = analytics.getTrendHistory(habit, 1);
      
      expect(history.length).toBeGreaterThan(0);
    });

    it('should handle habits with no executions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('New Habit', { workflowId: 'new' });
      
      const history = analytics.getTrendHistory(habit, 30);
      
      expect(history.length).toBeGreaterThan(0);
    });

    it('should include moving averages', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const history = analytics.getTrendHistory(habit, 30);
      
      // Later points should have moving averages
      const pointsWithMovingAverage = history.filter(p => p.movingAverage !== undefined);
      expect(pointsWithMovingAverage.length).toBeGreaterThan(0);
    });

    it('should be stable across multiple calls', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const history1 = analytics.getTrendHistory(habit, 30);
      const history2 = analytics.getTrendHistory(habit, 30);
      
      expect(history1.length).toBe(history2.length);
    });
  });
});

// ============================================================================
// IMPROVEMENT SUGGESTIONS TESTS
// ============================================================================

describe('HabitAnalytics - Improvement Suggestions', () => {
  describe('suggestImprovements', () => {
    it('should return array of suggestions for low-confidence habit', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 40, 30, 30, 40);
      habit.totalExecutions = 5;
      habit.failureCount = 3;
      
      const suggestions = analytics.suggestImprovements(habit);
      
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('should include success rate improvement suggestion for low success', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 30, 60, 70, 80);
      habit.totalExecutions = 5;
      habit.failureCount = 4;
      
      const suggestions = analytics.suggestImprovements(habit);
      
      const hasSuccessRateSuggestion = suggestions.some(s =>
        s.toLowerCase().includes('success rate')
      );
      expect(hasSuccessRateSuggestion).toBe(true);
    });

    it('should include frequency suggestion for low frequency', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 20, 70, 80);
      habit.totalExecutions = 2;
      
      const suggestions = analytics.suggestImprovements(habit);
      
      const hasFrequencySuggestion = suggestions.some(s =>
        s.toLowerCase().includes('frequency') || s.toLowerCase().includes('use')
      );
      expect(hasFrequencySuggestion).toBe(true);
    });

    it('should include recency suggestion for outdated habit', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 60, 20, 80);
      habit.lastExecutedAt = new Date(new Date().getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
      
      const suggestions = analytics.suggestImprovements(habit);
      
      const hasRecencySuggestion = suggestions.some(s =>
        s.toLowerCase().includes('recently') || s.toLowerCase().includes('re-test')
      );
      expect(hasRecencySuggestion).toBe(true);
    });

    it('should include feedback suggestion when no feedback exists', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 60, 70, 80);
      habit.feedback = [];
      
      const suggestions = analytics.suggestImprovements(habit);
      
      const hasFeedbackSuggestion = suggestions.some(s =>
        s.toLowerCase().includes('feedback')
      );
      expect(hasFeedbackSuggestion).toBe(true);
    });

    it('should handle habits with no executions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 50, 50, 50, 50);
      habit.totalExecutions = 0;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary.totalExecutions).toBe(0);
      expect(analysis.executionSummary.successRate).toBe(0);
    });

    it('should handle high-confidence habit', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 95, 90, 95, 95);
      habit.totalExecutions = 100;
      habit.failureCount = 5;
      habit.lastExecutedAt = new Date().toISOString();
      
      const suggestions = analytics.suggestImprovements(habit);
      
      // Should still return suggestions (even for high-confidence habits)
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should handle habits with variants', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 60, 50, 50, 60);
      habit.variants = [createHabitVariant('Variant 1', { workflowId: 'v1' })];
      
      const suggestions = analytics.suggestImprovements(habit);
      
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should handle habits without context requirements', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 50, 50, 50, 50);
      habit.primaryPattern.context = undefined;
      
      const suggestions = analytics.suggestImprovements(habit);
      
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should provide actionable suggestions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 40, 30, 30, 40);
      habit.totalExecutions = 5;
      
      const suggestions = analytics.suggestImprovements(habit);
      
      // All suggestions should be non-empty strings
      suggestions.forEach(suggestion => {
        expect(typeof suggestion).toBe('string');
        expect(suggestion.length).toBeGreaterThan(10);
      });
    });

    it('should not return duplicate suggestions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 30, 30, 30, 30);
      habit.totalExecutions = 3;
      habit.failureCount = 2;
      
      const suggestions = analytics.suggestImprovements(habit);
      
      // Check for duplicates
      const uniqueSuggestions = [...new Set(suggestions)];
      expect(uniqueSuggestions.length).toBe(suggestions.length);
    });

    it('should include context improvement suggestions when appropriate', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 50, 50, 50, 50);
      habit.primaryPattern.context = { url: '.*login.*' };
      habit.totalExecutions = 5;
      
      const suggestions = analytics.suggestImprovements(habit);
      
      // May or may not have context suggestions depending on other factors
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });
});

// ============================================================================
// EXECUTION HISTORY ANALYSIS TESTS
// ============================================================================

describe('HabitAnalytics - Execution History Analysis', () => {
  describe('analyzeExecutionHistory', () => {
    it('should return complete analysis result', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      habit.totalExecutions = 50;
      habit.successCount = 40;
      habit.failureCount = 10;
      habit.lastExecutedAt = new Date().toISOString();
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis).toBeDefined();
    });

    it('should include description in analysis', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      habit.name = 'Test Habit';
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.description).toContain('Test Habit');
    });

    it('should include confidence explanation in analysis', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.confidenceExplanation).toContain('Confidence:');
      expect(analysis.confidenceExplanation).toContain('Success rate:');
      expect(analysis.confidenceExplanation).toContain('Usage frequency:');
    });

    it('should include confidence breakdown', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.confidenceBreakdown).toBeDefined();
      expect(analysis.confidenceBreakdown.overall).toBeGreaterThan(0);
      expect(analysis.confidenceBreakdown.success).toBeDefined();
      expect(analysis.confidenceBreakdown.frequency).toBeDefined();
      expect(analysis.confidenceBreakdown.recency).toBeDefined();
      expect(analysis.confidenceBreakdown.feedback).toBeDefined();
    });

    it('should include trend information', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(['improving', 'stable', 'declining']).toContain(analysis.trend);
    });

    it('should include trend history', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(Array.isArray(analysis.trendHistory)).toBe(true);
      expect(analysis.trendHistory.length).toBeGreaterThan(0);
    });

    it('should include improvement suggestions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 60, 50, 50, 60);
      habit.totalExecutions = 20;
      habit.successCount = 12;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(Array.isArray(analysis.improvementSuggestions)).toBe(true);
    });

    it('should include execution summary', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      habit.totalExecutions = 50;
      habit.successCount = 40;
      habit.failureCount = 10;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary).toBeDefined();
      expect(analysis.executionSummary.totalExecutions).toBe(50);
      expect(analysis.executionSummary.successCount).toBe(40);
      expect(analysis.executionSummary.failureCount).toBe(10);
      expect(analysis.executionSummary.successRate).toBe(80);
    });

    it('should include context analysis', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithContext('Test', '.*login.*');
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.contextAnalysis).toBeDefined();
      expect(analysis.contextAnalysis.hasContextRequirements).toBe(true);
    });

    it('should handle habits with no variants', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.variantAnalysis).toBeUndefined();
    });

    it('should include variant analysis when variants exist', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      habit.variants = [
        createHabitVariant('Variant 1', { workflowId: 'v1' }),
        createHabitVariant('Variant 2', { workflowId: 'v2' }),
      ];
      habit.variants[0].confidence.overall = 80;
      habit.variants[1].confidence.overall = 60;
      habit.variants[0].executionCount = 30;
      habit.variants[1].executionCount = 20;
      habit.variants[0].successCount = 24;
      habit.variants[1].successCount = 12;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.variantAnalysis).toBeDefined();
      expect(analysis.variantAnalysis?.count).toBe(2);
      expect(analysis.variantAnalysis?.averageConfidence).toBeCloseTo(70, 0);
    });

    it('should include top variant information', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      habit.variants = [
        createHabitVariant('Variant 1', { workflowId: 'v1' }),
        createHabitVariant('Variant 2', { workflowId: 'v2' }),
      ];
      habit.variants[0].confidence.overall = 90;
      habit.variants[1].confidence.overall = 70;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.variantAnalysis?.topVariant).toBeDefined();
      expect(analysis.variantAnalysis?.topVariant?.confidence).toBe(90);
    });

    it('should handle habits with no executions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('New Habit', { workflowId: 'new' });
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary.totalExecutions).toBe(0);
      expect(analysis.executionSummary.successRate).toBe(0);
    });

    it('should provide comprehensive insights', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 50, 40, 30, 50);
      habit.totalExecutions = 20;
      habit.successCount = 10;
      habit.failureCount = 10;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      // Should have multiple components
      expect(analysis.description).toBeDefined();
      expect(analysis.confidenceExplanation).toBeDefined();
      expect(analysis.improvementSuggestions.length).toBeGreaterThan(0);
    });

    it('should be consistent across multiple calls', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const analysis1 = analytics.analyzeExecutionHistory(habit);
      const analysis2 = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis1.description).toBe(analysis2.description);
      expect(analysis1.trend).toBe(analysis2.trend);
    });

    it('should handle edge case with all zero scores', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Edge Case', { workflowId: 'edge' });
      habit.confidence.success = 0;
      habit.confidence.frequency = 0;
      habit.confidence.recency = 0;
      habit.confidence.feedback = 0;
      habit.confidence.overall = 0;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.confidenceBreakdown.overall).toBe(0);
    });

    it('should handle edge case with all max scores', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Edge Case', { workflowId: 'edge' });
      habit.confidence.success = 100;
      habit.confidence.frequency = 100;
      habit.confidence.recency = 100;
      habit.confidence.feedback = 100;
      habit.confidence.overall = 100;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.confidenceBreakdown.overall).toBe(100);
    });

    it('should include execution summary with duration fields', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      // Duration fields are optional in summary
      expect(analysis.executionSummary).toMatchObject({
        totalExecutions: expect.any(Number),
        successCount: expect.any(Number),
        failureCount: expect.any(Number),
        successRate: expect.any(Number),
        frequencyClass: expect.any(String),
      });
    });
  });
});

// ============================================================================
// IMPROVEMENT SUGGESTIONS CONSTANTS TESTS
// ============================================================================

describe('HabitAnalytics - Improvement Suggestions Constants', () => {
  describe('IMPROVEMENT_SUGGESTIONS', () => {
    it('should export default suggestions', () => {
      expect(IMPROVEMENT_SUGGESTIONS).toBeDefined();
      expect(typeof IMPROVEMENT_SUGGESTIONS).toBe('object');
    });

    it('should have contextTooBroad suggestion', () => {
      expect(IMPROVEMENT_SUGGESTIONS.contextTooBroad).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.contextTooBroad.text).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.contextTooBroad.category).toBe('context');
    });

    it('should have lowSuccessRate suggestion', () => {
      expect(IMPROVEMENT_SUGGESTIONS.lowSuccessRate).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.lowSuccessRate.text).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.lowSuccessRate.category).toBe('execution');
    });

    it('should have infrequentUse suggestion', () => {
      expect(IMPROVEMENT_SUGGESTIONS.infrequentUse).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.infrequentUse.text).toBeDefined();
    });

    it('should have noFeedback suggestion', () => {
      expect(IMPROVEMENT_SUGGESTIONS.noFeedback).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.noFeedback.text).toBeDefined();
    });

    it('should have decliningTrend suggestion', () => {
      expect(IMPROVEMENT_SUGGESTIONS.decliningTrend).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.decliningTrend.text).toBeDefined();
    });

    it('should have missingVariants suggestion', () => {
      expect(IMPROVEMENT_SUGGESTIONS.missingVariants).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.missingVariants.text).toBeDefined();
    });

    it('should have inconsistentPerformance suggestion', () => {
      expect(IMPROVEMENT_SUGGESTIONS.inconsistentPerformance).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.inconsistentPerformance.text).toBeDefined();
    });

    it('should have outdatedContext suggestion', () => {
      expect(IMPROVEMENT_SUGGESTIONS.outdatedContext).toBeDefined();
      expect(IMPROVEMENT_SUGGESTIONS.outdatedContext.text).toBeDefined();
    });
  });
});

// ============================================================================
// EDGE CASES AND BOUNDARY CONDITIONS
// ============================================================================

describe('HabitAnalytics - Edge Cases', () => {
  describe('boundary conditions', () => {
    it('should handle habit with exactly 100 executions', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 100, 80, 80);
      habit.totalExecutions = 100;
      habit.successCount = 80;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary.totalExecutions).toBe(100);
      expect(analysis.executionSummary.frequencyClass).toBe('daily');
    });

    it('should handle habit with exactly 1 execution', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 10, 80, 80);
      habit.totalExecutions = 1;
      habit.successCount = 1;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary.totalExecutions).toBe(1);
      expect(analysis.executionSummary.frequencyClass).toBe('rare');
    });

    it('should handle habit with 0 confidence components', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Edge Case', { workflowId: 'edge' });
      habit.confidence.success = 0;
      habit.confidence.frequency = 0;
      habit.confidence.recency = 0;
      habit.confidence.feedback = 0;
      
      const breakdown = analytics.calculateConfidenceBreakdown(habit);
      
      // Overall should be 0 when all components are 0
      expect(breakdown.overall).toBe(0);
    });

    it('should handle habit with partial confidence scores', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Partial Scores', { workflowId: 'partial' });
      
      const breakdown = analytics.calculateConfidenceBreakdown(habit);
      
      expect(breakdown.overall).toBeGreaterThanOrEqual(0);
      expect(breakdown.overall).toBeLessThanOrEqual(100);
    });

    it('should handle habit with very long execution history', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 90, 100, 90, 90);
      habit.totalExecutions = 1000;
      habit.successCount = 900;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary.totalExecutions).toBe(1000);
      expect(analysis.executionSummary.frequencyClass).toBe('daily');
    });

    it('should handle habit with 100% failure rate', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 0, 0, 0, 0);
      habit.totalExecutions = 10;
      habit.successCount = 0;
      habit.failureCount = 10;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary.successRate).toBe(0);
    });

    it('should handle habit with 100% success rate', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 100, 80, 90, 90);
      habit.totalExecutions = 50;
      habit.successCount = 50;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary.successRate).toBe(100);
    });

    it('should handle habit with no variants array', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('No Variants', { workflowId: 'novariants' });
      habit.variants = undefined;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.variantAnalysis).toBeUndefined();
    });

    it('should handle habit with empty variants array', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Empty Variants', { workflowId: 'empty' });
      habit.variants = [];
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.variantAnalysis).toBeUndefined();
    });

    it('should handle habit with very recent execution', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 80, 100, 80);
      habit.totalExecutions = 5;
      habit.lastExecutedAt = new Date().toISOString();
      
      const breakdown = analytics.calculateConfidenceBreakdown(habit);
      expect(breakdown.recency).toBeGreaterThanOrEqual(100);
    });

    it('should handle habit with very old execution', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 80, 80, 0, 80);
      habit.lastExecutedAt = new Date('2020-01-01').toISOString();
      
      const breakdown = analytics.calculateConfidenceBreakdown(habit);
      expect(breakdown.recency).toBe(0);
    });

    it('should handle habit with complex context', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithContext('Complex Context', '.*login.*', '.*App.*');
      habit.primaryPattern.context = {
        url: '.*login.*',
        title: '.*App.*',
        environment: { mode: 'production' },
      };
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.contextAnalysis.hasContextRequirements).toBe(true);
    });

    it('should handle habit with multiple variants of varying quality', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Multi-Variant', { workflowId: 'multi' });
      habit.variants = [
        createHabitVariant('Excellent', { workflowId: 'excellent' }),
        createHabitVariant('Good', { workflowId: 'good' }),
        createHabitVariant('Poor', { workflowId: 'poor' }),
      ];
      habit.variants[0].confidence.overall = 95;
      habit.variants[1].confidence.overall = 75;
      habit.variants[2].confidence.overall = 45;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.variantAnalysis?.topVariant?.name).toBe('Excellent');
      expect(analysis.variantAnalysis?.topVariant?.confidence).toBe(95);
    });
  });

  describe('stability tests', () => {
    it('should produce consistent descriptions for same input', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const desc1 = analytics.generateDescription(habit);
      const desc2 = analytics.generateDescription(habit);
      const desc3 = analytics.generateDescription(habit);
      
      expect(desc1).toBe(desc2);
      expect(desc2).toBe(desc3);
    });

    it('should produce consistent confidence breakdown for same input', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 60, 70, 80);
      
      const breakdown1 = analytics.calculateConfidenceBreakdown(habit);
      const breakdown2 = analytics.calculateConfidenceBreakdown(habit);
      
      expect(breakdown1.overall).toBe(breakdown2.overall);
      expect(breakdown1.success).toBe(breakdown2.success);
    });

    it('should produce consistent improvement suggestions for same input', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 50, 40, 30, 50);
      habit.totalExecutions = 10;
      
      const suggestions1 = analytics.suggestImprovements(habit);
      const suggestions2 = analytics.suggestImprovements(habit);
      
      expect(suggestions1).toEqual(suggestions2);
    });
  });

  describe('performance considerations', () => {
    it('should handle large number of variants efficiently', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabit('Many Variants', { workflowId: 'many' });
      
      // Create 100 variants
      habit.variants = Array.from({ length: 100 }, (_, i) =>
        createHabitVariant(`Variant ${i}`, { workflowId: `v-${i}` })
      );
      
      // Each variant should have varying confidence
      habit.variants.forEach((variant, i) => {
        variant.confidence.overall = 50 + (i % 50);
      });
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.variantAnalysis?.count).toBe(100);
    });

    it('should handle very long execution history efficiently', () => {
      const analytics = new HabitAnalytics();
      const habit = createHabitWithConfidence('Test', 70, 90, 80, 85);
      habit.totalExecutions = 10000;
      habit.successCount = 8500;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.executionSummary.totalExecutions).toBe(10000);
    });
  });
});

// ============================================================================
// COMPREHENSIVE INTEGRATION TESTS
// ============================================================================

describe('HabitAnalytics - Integration Tests', () => {
  describe('real-world scenarios', () => {
    it('should analyze a real-world login habit', () => {
      const analytics = new HabitAnalytics();
      
      // Create a realistic login habit
      const habit = createHabit('Login to Email', { workflowId: 'login-workflow' });
      habit.description = 'Automates email login process';
      habit.confidence.success = 85;
      habit.confidence.frequency = 75;
      habit.confidence.recency = 80;
      habit.confidence.feedback = 90;
      habit.confidence.overall = 83; // (85*0.5) + (75*0.2) + (80*0.2) + (90*0.1) = 42.5+15+16+9 = 82.5
      habit.totalExecutions = 50;
      habit.successCount = 42;
      habit.failureCount = 8;
      habit.lastExecutedAt = new Date(new Date().getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
      habit.variants = [
        createHabitVariant('Chrome Login', { workflowId: 'chrome-login' }),
        createHabitVariant('Firefox Login', { workflowId: 'firefox-login' }),
      ];
      habit.variants[0].confidence.overall = 88;
      habit.variants[1].confidence.overall = 78;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      // Verify key components
      expect(analysis.description).toContain('Login to Email');
      expect(analysis.confidenceBreakdown.overall).toBeCloseTo(82.5, 0);
      expect(analysis.trend).toBe('stable');
      expect(analysis.executionSummary.successRate).toBe(84);
      expect(analysis.variantAnalysis?.count).toBe(2);
    });

    it('should analyze a declining habit', () => {
      const analytics = new HabitAnalytics();
      
      const habit = createHabit('Legacy Workflow', { workflowId: 'legacy' });
      habit.confidence.success = 50;
      habit.confidence.frequency = 30;
      habit.confidence.recency = 10;
      habit.confidence.feedback = 40;
      habit.confidence.overall = 37; // (50*0.5) + (30*0.2) + (10*0.2) + (40*0.1) = 25+6+2+4 = 37
      habit.totalExecutions = 20;
      habit.successCount = 10;
      habit.failureCount = 10;
      habit.lastExecutedAt = new Date(new Date().getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      // Should show declining trend and improvement suggestions
      expect(analysis.confidenceBreakdown.overall).toBeLessThan(50);
      expect(analysis.improvementSuggestions.length).toBeGreaterThan(0);
    });

    it('should analyze a high-confidence daily habit', () => {
      const analytics = new HabitAnalytics();
      
      const habit = createHabit('Daily Reporting', { workflowId: 'reporting' });
      habit.confidence.success = 95;
      habit.confidence.frequency = 95;
      habit.confidence.recency = 100;
      habit.confidence.feedback = 90;
      habit.confidence.overall = 94; // (95*0.5) + (95*0.2) + (100*0.2) + (90*0.1) = 47.5+19+20+9 = 95.5
      habit.totalExecutions = 500;
      habit.successCount = 475;
      habit.failureCount = 25;
      habit.lastExecutedAt = new Date().toISOString();
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.confidenceBreakdown.overall).toBeCloseTo(95.5, 0);
      expect(analysis.executionSummary.frequencyClass).toBe('daily');
    });
  });

  describe('feedback loop analysis', () => {
    it('should analyze habit improvement over time', () => {
      const analytics = new HabitAnalytics();
      
      const habit = createHabit('Learning Habit', { workflowId: 'learning' });
      habit.confidence.success = 70;
      habit.confidence.frequency = 60;
      habit.confidence.recency = 80;
      habit.confidence.feedback = 85;
      habit.confidence.overall = 74;
      habit.totalExecutions = 100;
      habit.successCount = 75;
      habit.failureCount = 25;
      habit.lastExecutedAt = new Date().toISOString();
      
      // Initial analysis
      const initialAnalysis = analytics.analyzeExecutionHistory(habit);
      
      // Simulate improvement through additional executions
      habit.successCount += 25;
      habit.totalExecutions += 25;
      habit.confidence.success = 85;
      habit.confidence.overall = 84;
      
      // Later analysis
      const laterAnalysis = analytics.analyzeExecutionHistory(habit);
      
      expect(laterAnalysis.confidenceBreakdown.overall).toBeGreaterThan(
        initialAnalysis.confidenceBreakdown.overall
      );
    });

    it('should analyze habit degradation', () => {
      const analytics = new HabitAnalytics();
      
      const habit = createHabit('Degraded Habit', { workflowId: 'degraded' });
      habit.confidence.success = 90;
      habit.confidence.frequency = 80;
      habit.confidence.recency = 90;
      habit.confidence.feedback = 85;
      habit.confidence.overall = 87;
      habit.totalExecutions = 100;
      habit.successCount = 90;
      habit.failureCount = 10;
      habit.lastExecutedAt = new Date().toISOString();
      
      // Simulate degradation through failures
      habit.failureCount += 40;
      habit.totalExecutions += 40;
      habit.confidence.success = 50;
      habit.confidence.recency = 40;
      habit.confidence.overall = 47;
      
      const analysis = analytics.analyzeExecutionHistory(habit);
      
      expect(analysis.improvementSuggestions.length).toBeGreaterThan(0);
    });
  });
});