/**
 * Habit Suggestion Engine
 * Evaluates habits against current context and suggests the most relevant one.
 * 
 * Requirements: 13.7
 */

import { matchAllConditions, matchAnyCondition, type MatchContext } from './habit-condition-matching.js';
import {
  calculateHabitConfidence,
  rankHabits,
  shouldSuggestHabit,
  type HabitFeedback,
  type ScoringConfig,
} from './habit-confidence-scoring.js';
import type { Habit } from './habit-extraction.js';

/**
 * A suggestion to show to the user.
 */
export interface HabitSuggestion {
  habitId: string;
  target: string;
  description: string;
  actionSequence: Array<{
    action: string;
    target?: string;
    duration?: number;
  }>;
  confidence: number;
  confidenceBreakdown?: {
    successRate: number;
    frequency: number;
    recency: number;
    feedback: number;
    context: number;
  };
  reason?: string;  // Why this habit was suggested
  estimatedDuration?: number;  // ms to complete
  conditionsMatched?: string[];  // Which conditions matched
}

/**
 * Configuration for suggestion engine.
 */
export interface SuggestionEngineConfig {
  maxSuggestions: number;  // Maximum suggestions to return
  minConfidence: number;   // Minimum confidence to suggest
  matchingLogic: 'AND' | 'OR';  // How to combine conditions
  conditionLogic: 'AND' | 'OR';  // How to combine multiple matching strategies
  enableContextAwareness: boolean;  // Consider context when scoring
  enableRecencyBoosting: boolean;  // Boost recently successful habits
  recencyBoostFactor: number;  // How much to boost (1.0 = no boost, 1.5 = 50% boost)
  cooldownMs: number;  // Minimum time between suggestions for same habit
}

const DEFAULT_CONFIG: SuggestionEngineConfig = {
  maxSuggestions: 3,
  minConfidence: 0.6,
  matchingLogic: 'AND',  // All conditions must match
  conditionLogic: 'OR',  // Consider habit suggestable if ANY strategy matches
  enableContextAwareness: true,
  enableRecencyBoosting: true,
  recencyBoostFactor: 1.2,
  cooldownMs: 5 * 60 * 1000,  // 5 minutes
};

/**
 * Suggestion engine that evaluates and suggests habits.
 */
export class HabitSuggestionEngine {
  private config: SuggestionEngineConfig;
  private lastSuggestionTime: Map<string, number> = new Map();
  private suggestionCounts: Map<string, number> = new Map();

  constructor(config: Partial<SuggestionEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Suggests the best habit(s) given current context.
   * 
   * @param habits - Available habits to consider
   * @param context - Current user context
   * @param feedbackHistory - User feedback per habit
   * @param scoringConfig - Confidence scoring config
   * @returns Array of suggestions
   */
  public suggestHabits(
    habits: Habit[],
    context: MatchContext,
    feedbackHistory: Map<string, HabitFeedback[]> = new Map(),
    scoringConfig?: Partial<ScoringConfig>
  ): HabitSuggestion[] {
    const candidates: Array<{
      habit: Habit;
      confidence: number;
      contextScore: number;
      reason: string;
      conditionsMatched: string[];
    }> = [];

    // Evaluate each habit
    habits.forEach((habit) => {
      // Check cooldown
      if (!this.isInCooldown(habit.id)) {
        // Calculate context match
        const contextScore = this.calculateContextMatchScore(habit, context);

        // Calculate confidence with context
        let confidence = this.calculateConfidenceWithContext(
          habit,
          feedbackHistory.get(habit.id) || [],
          contextScore,
          scoringConfig
        );

        // Apply recency boosting
        if (this.config.enableRecencyBoosting && habit.recencyScore > 0.7) {
          confidence *= this.config.recencyBoostFactor;
          confidence = Math.min(1, confidence);  // Cap at 1.0
        }

        // Check if should suggest
        if (confidence >= this.config.minConfidence) {
          const conditionsMatched = this.explainContextMatch(habit, context);
          
          candidates.push({
            habit,
            confidence,
            contextScore,
            reason: `Confidence: ${(confidence * 100).toFixed(0)}%, Context match: ${(contextScore * 100).toFixed(0)}%`,
            conditionsMatched,
          });
        }
      }
    });

    // Sort by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);

    // Convert to suggestions
    const suggestions = candidates.slice(0, this.config.maxSuggestions).map((c) =>
      this.habitToSuggestion(c.habit, c.confidence, c.reason, c.conditionsMatched)
    );

    // Update suggestion tracking
    suggestions.forEach((s) => {
      this.lastSuggestionTime.set(s.habitId, Date.now());
      this.suggestionCounts.set(s.habitId, (this.suggestionCounts.get(s.habitId) || 0) + 1);
    });

    return suggestions;
  }

  /**
   * Scores a single habit against current context.
   * 
   * @param habit - Habit to score
   * @param context - Current context
   * @param feedbackHistory - User feedback
   * @param scoringConfig - Scoring configuration
   * @returns Confidence score (0..1)
   */
  public scoreHabit(
    habit: Habit,
    context: MatchContext,
    feedbackHistory: HabitFeedback[] = [],
    scoringConfig?: Partial<ScoringConfig>
  ): number {
    const contextScore = this.calculateContextMatchScore(habit, context);
    return this.calculateConfidenceWithContext(habit, feedbackHistory, contextScore, scoringConfig);
  }

  /**
   * Calculates how well the current context matches habit conditions.
   * 
   * @param habit - Habit to evaluate
   * @param context - Current context
   * @returns Match score (0..1)
   */
  private calculateContextMatchScore(habit: Habit, context: MatchContext): number {
    if (habit.conditions.length === 0) {
      return 1.0;  // No conditions = always matches
    }

    if (!this.config.enableContextAwareness) {
      return 1.0;  // Context awareness disabled
    }

    // Use AND or OR logic based on config
    const result =
      this.config.matchingLogic === 'AND'
        ? matchAllConditions(habit.conditions, context)
        : matchAnyCondition(habit.conditions, context);

    return result.overallConfidence;
  }

  /**
   * Calculates confidence with context adjustment.
   * 
   * @param habit - Habit to score
   * @param feedbackHistory - User feedback
   * @param contextScore - Pre-calculated context match score
   * @param scoringConfig - Scoring configuration
   * @returns Confidence (0..1)
   */
  private calculateConfidenceWithContext(
    habit: Habit,
    feedbackHistory: HabitFeedback[],
    contextScore: number,
    scoringConfig?: Partial<ScoringConfig>
  ): number {
    const breakdown = calculateHabitConfidence(habit, feedbackHistory, contextScore, scoringConfig);
    return breakdown.overall;
  }

  /**
   * Checks if a habit is currently in cooldown period.
   * 
   * @param habitId - Habit ID
   * @returns True if in cooldown
   */
  private isInCooldown(habitId: string): boolean {
    const lastTime = this.lastSuggestionTime.get(habitId);
    if (!lastTime) return false;
    return Date.now() - lastTime < this.config.cooldownMs;
  }

  /**
   * Explains which conditions matched for a habit in current context.
   * 
   * @param habit - Habit to explain
   * @param context - Current context
   * @returns Array of matched condition descriptions
   */
  private explainContextMatch(habit: Habit, context: MatchContext): string[] {
    if (habit.conditions.length === 0) {
      return [];
    }

    const result = matchAllConditions(habit.conditions, context);
    return result.results
      .filter((r) => r.matched)
      .map((r) => {
        switch (r.conditionType) {
          case 'element-state':
            return `Element state: ${r.reason}`;
          case 'context-match':
            return `Context: ${r.reason}`;
          case 'time-pattern':
            return `Time: ${r.reason}`;
          case 'sequence-history':
            return `Sequence: ${r.reason}`;
          default:
            return r.reason || 'Condition matched';
        }
      });
  }

  /**
   * Converts a habit to a suggestion.
   * 
   * @param habit - Habit to convert
   * @param confidence - Confidence score
   * @param reason - Reason for suggestion
   * @param conditionsMatched - Matched condition descriptions
   * @returns Suggestion
   */
  private habitToSuggestion(
    habit: Habit,
    confidence: number,
    reason: string,
    conditionsMatched: string[]
  ): HabitSuggestion {
    const estimatedDuration = habit.actionSequence.reduce((sum, step) => sum + (step.duration || 0), 0);

    return {
      habitId: habit.id,
      target: habit.target,
      description: habit.description,
      actionSequence: habit.actionSequence.map((step) => ({
        action: step.action,
        target: step.target,
        duration: step.duration,
      })),
      confidence,
      reason,
      estimatedDuration,
      conditionsMatched,
    };
  }

  /**
   * Gets suggestion statistics.
   * 
   * @param habitId - Optional, for specific habit
   * @returns Statistics
   */
  public getStatistics(habitId?: string): Record<string, unknown> {
    if (habitId) {
      return {
        habitId,
        suggestionCount: this.suggestionCounts.get(habitId) || 0,
        lastSuggestionTime: this.lastSuggestionTime.get(habitId) || null,
        inCooldown: this.isInCooldown(habitId),
      };
    }

    return {
      totalSuggestions: Array.from(this.suggestionCounts.values()).reduce((a, b) => a + b, 0),
      habitsWithSuggestions: this.suggestionCounts.size,
      suggestionsByHabit: Object.fromEntries(this.suggestionCounts),
    };
  }

  /**
   * Resets cooldown for a habit.
   * Use when user interacts with habit.
   * 
   * @param habitId - Habit ID
   */
  public resetCooldown(habitId: string): void {
    this.lastSuggestionTime.delete(habitId);
  }

  /**
   * Clears all suggestion history.
   */
  public clearHistory(): void {
    this.lastSuggestionTime.clear();
    this.suggestionCounts.clear();
  }
}

/**
 * Explains a suggestion in detail.
 * 
 * @param suggestion - The suggestion to explain
 * @returns Human-readable explanation
 */
export function explainSuggestion(suggestion: HabitSuggestion): string {
  const parts: string[] = [
    `Habit: ${suggestion.target}`,
    `Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`,
  ];

  if (suggestion.estimatedDuration) {
    parts.push(`Est. Duration: ${suggestion.estimatedDuration}ms (${(suggestion.estimatedDuration / 1000).toFixed(1)}s)`);
  }

  if (suggestion.conditionsMatched?.length) {
    parts.push(`Conditions: ${suggestion.conditionsMatched.join(', ')}`);
  }

  if (suggestion.reason) {
    parts.push(`Reason: ${suggestion.reason}`);
  }

  return parts.join(' | ');
}

/**
 * Compares two suggestions.
 * 
 * @param s1 - First suggestion
 * @param s2 - Second suggestion
 * @returns Comparison details
 */
export function compareSuggestions(
  s1: HabitSuggestion,
  s2: HabitSuggestion
): {
  better: HabitSuggestion;
  reason: string;
  confidenceDiff: number;
} {
  const diff = s1.confidence - s2.confidence;
  const better = diff > 0 ? s1 : s2;
  const reason =
    Math.abs(diff) > 0.05
      ? `Confidence difference: ${Math.abs(diff).toFixed(2)}`
      : 'Nearly equal confidence';

  return { better, reason, confidenceDiff: diff };
}

/**
 * Batches habit evaluation for efficiency.
 * 
 * @param engine - Suggestion engine instance
 * @param habitBatches - Batches of habits to evaluate
 * @param context - Current context
 * @param feedbackHistory - User feedback
 * @param scoringConfig - Scoring configuration
 * @returns Suggestions from each batch
 */
export function batchEvaluateHabits(
  engine: HabitSuggestionEngine,
  habitBatches: Habit[][],
  context: MatchContext,
  feedbackHistory: Map<string, HabitFeedback[]> = new Map(),
  scoringConfig?: Partial<ScoringConfig>
): HabitSuggestion[][] {
  return habitBatches.map((batch) => engine.suggestHabits(batch, context, feedbackHistory, scoringConfig));
}
