/**
 * Habit Confidence Scoring
 * Calculates and tracks confidence in habit suggestions based on success rate,
 * frequency, recency, and user feedback.
 * 
 * Requirements: 13.6
 */

import type { Habit } from './habit-extraction.js';

/**
 * Breakdown of confidence score components.
 */
export interface ConfidenceBreakdown {
  successRate: number;        // 0..1, based on habit success rate
  frequency: number;          // 0..1, based on usage frequency
  recency: number;            // 0..1, based on recency with decay
  feedback: number;           // 0..1, based on user corrections/dismissals
  context: number;            // 0..1, based on context match
  overall: number;            // 0..1, weighted combination
}

/**
 * User feedback about a habit suggestion.
 */
export interface HabitFeedback {
  habitId: string;
  accepted: boolean;          // User accepted the suggestion
  corrected: boolean;         // User had to correct the habit
  dismissed: boolean;         // User dismissed the suggestion
  timeToCorrection?: number;  // ms until user corrected
  feedback?: string;          // Optional user feedback
  timestamp: number;
}

/**
 * Configuration for confidence scoring.
 */
export interface ScoringConfig {
  weights: {
    successRate: number;      // Weight for success rate component
    frequency: number;        // Weight for frequency component
    recency: number;          // Weight for recency component
    feedback: number;         // Weight for feedback component
    context: number;          // Weight for context match
  };
  recencyHalfLife: number;    // Days until recency score drops to 50%
  frequencyNormalization: number;  // Number of uses for 100% frequency score
  feedbackDecayRate: number;  // How fast negative feedback decays (0..1)
  minConfidenceThreshold: number;  // Minimum confidence to suggest (0..1)
}

const DEFAULT_CONFIG: ScoringConfig = {
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

/**
 * Calculates success rate confidence (0..1).
 * Higher success rate = higher confidence.
 * 
 * @param habit - The habit to score
 * @returns Success rate score (0..1)
 */
export function calculateSuccessRateScore(habit: Habit): number {
  // Success rate is directly used as confidence
  return Math.max(0, Math.min(1, habit.successRate));
}

/**
 * Calculates frequency confidence (0..1).
 * How often the habit is used. Normalizes to config setting.
 * 
 * @param habit - The habit to score
 * @param config - Scoring configuration
 * @returns Frequency score (0..1)
 */
export function calculateFrequencyScore(habit: Habit, config: ScoringConfig): number {
  // Normalize attempts to 0..1 range
  const normalized = habit.totalAttempts / config.frequencyNormalization;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculates recency confidence (0..1).
 * How recently the habit was used. Applies exponential decay.
 * 
 * @param habit - The habit to score
 * @param config - Scoring configuration
 * @returns Recency score (0..1)
 */
export function calculateRecencyScore(habit: Habit, config: ScoringConfig): number {
  const now = Date.now();
  const daysSinceUse = (now - habit.lastUsed) / (1000 * 60 * 60 * 24);
  
  // Exponential decay: 2^(-daysSinceUse / halfLife)
  const score = Math.pow(2, -daysSinceUse / config.recencyHalfLife);
  return Math.max(0, Math.min(1, score));
}

/**
 * Calculates feedback confidence (0..1).
 * Increases with acceptances, decreases with corrections/dismissals.
 * 
 * @param habit - The habit to score
 * @param feedbackHistory - Recent feedback entries
 * @param config - Scoring configuration
 * @returns Feedback score (0..1)
 */
export function calculateFeedbackScore(
  habit: Habit,
  feedbackHistory: HabitFeedback[],
  config: ScoringConfig
): number {
  if (feedbackHistory.length === 0) {
    // No feedback yet, neutral score
    return 0.5;
  }

  // Weight recent feedback more heavily
  const now = Date.now();
  let positiveWeight = 0;
  let negativeWeight = 0;

  feedbackHistory.forEach((fb) => {
    // Apply time decay to feedback
    const ageMs = now - fb.timestamp;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const decayFactor = Math.pow(config.feedbackDecayRate, ageDays);

    if (fb.accepted && !fb.corrected && !fb.dismissed) {
      positiveWeight += decayFactor;
    } else if (fb.dismissed) {
      negativeWeight += decayFactor * 0.5;  // Dismissal is less negative than correction
    } else if (fb.corrected) {
      negativeWeight += decayFactor;  // Correction is strong negative signal
    }
  });

  // Calculate net feedback score
  const netFeedback = (positiveWeight - negativeWeight) / (positiveWeight + negativeWeight + 1);
  // Shift from -1..1 range to 0..1 range
  return (netFeedback + 1) / 2;
}

/**
 * Calculates context match confidence (0..1).
 * Based on how well the current context matches habit conditions.
 * 
 * @param habit - The habit to score
 * @param contextMatchScore - Pre-calculated context match score (0..1)
 * @returns Context score (0..1)
 */
export function calculateContextScore(
  habit: Habit,
  contextMatchScore: number = 1.0
): number {
  // If no conditions, use the provided context match score (default 1.0 = always match)
  if (habit.conditions.length === 0) {
    return Math.max(0, Math.min(1, contextMatchScore));
  }
  
  // Otherwise use the provided context match score
  return Math.max(0, Math.min(1, contextMatchScore));
}

/**
 * Calculates overall habit confidence using weighted combination.
 * 
 * @param habit - The habit to score
 * @param feedbackHistory - Recent feedback entries
 * @param contextMatchScore - Pre-calculated context match score (0..1)
 * @param config - Scoring configuration
 * @returns Confidence breakdown and overall score
 */
export function calculateHabitConfidence(
  habit: Habit,
  feedbackHistory: HabitFeedback[] = [],
  contextMatchScore: number = 1.0,
  config: Partial<ScoringConfig> = {}
): ConfidenceBreakdown {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const successRateScore = calculateSuccessRateScore(habit);
  const frequencyScore = calculateFrequencyScore(habit, cfg);
  const recencyScore = calculateRecencyScore(habit, cfg);
  const feedbackScore = calculateFeedbackScore(habit, feedbackHistory, cfg);
  const contextScore = calculateContextScore(habit, contextMatchScore);

  // Weighted combination
  const overallScore =
    successRateScore * cfg.weights.successRate +
    frequencyScore * cfg.weights.frequency +
    recencyScore * cfg.weights.recency +
    feedbackScore * cfg.weights.feedback +
    contextScore * cfg.weights.context;

  return {
    successRate: successRateScore,
    frequency: frequencyScore,
    recency: recencyScore,
    feedback: feedbackScore,
    context: contextScore,
    overall: Math.max(0, Math.min(1, overallScore)),
  };
}

/**
 * Determines if a habit should be suggested based on confidence.
 * 
 * @param habit - The habit to evaluate
 * @param feedbackHistory - Recent feedback entries
 * @param contextMatchScore - Pre-calculated context match score (0..1)
 * @param config - Scoring configuration
 * @returns Whether habit should be suggested
 */
export function shouldSuggestHabit(
  habit: Habit,
  feedbackHistory: HabitFeedback[] = [],
  contextMatchScore: number = 1.0,
  config: Partial<ScoringConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const confidence = calculateHabitConfidence(habit, feedbackHistory, contextMatchScore, cfg);
  return confidence.overall >= cfg.minConfidenceThreshold;
}

/**
 * Ranks multiple habits by confidence.
 * 
 * @param habits - Habits to rank
 * @param feedbackHistory - Map of habit ID to feedback entries
 * @param contextScores - Map of habit ID to context match score
 * @param config - Scoring configuration
 * @returns Ranked habits with their confidence scores
 */
export function rankHabits(
  habits: Habit[],
  feedbackHistory: Map<string, HabitFeedback[]> = new Map(),
  contextScores: Map<string, number> = new Map(),
  config: Partial<ScoringConfig> = {}
): Array<{
  habit: Habit;
  confidence: ConfidenceBreakdown;
  shouldSuggest: boolean;
}> {
  return habits
    .map((habit) => {
      const feedback = feedbackHistory.get(habit.id) || [];
      const contextScore = contextScores.get(habit.id) ?? 1.0;
      const confidence = calculateHabitConfidence(habit, feedback, contextScore, config);
      const shouldSuggest = shouldSuggestHabit(habit, feedback, contextScore, config);

      return { habit, confidence, shouldSuggest };
    })
    .sort((a, b) => b.confidence.overall - a.confidence.overall);
}

/**
 * Calculates confidence trends over time.
 * Useful for understanding habit reliability.
 * 
 * @param feedbackHistory - Feedback entries to analyze
 * @param windowSizeMs - Time window size (default: 1 day)
 * @returns Confidence trend data
 */
export function calculateConfidenceTrend(
  feedbackHistory: HabitFeedback[],
  windowSizeMs: number = 24 * 60 * 60 * 1000
): Array<{
  timestamp: number;
  confidence: number;
  sampleSize: number;
}> {
  if (feedbackHistory.length === 0) {
    return [];
  }

  // Sort by timestamp
  const sorted = [...feedbackHistory].sort((a, b) => a.timestamp - b.timestamp);

  // Group into time windows
  const now = Date.now();
  const windows: Map<number, HabitFeedback[]> = new Map();

  sorted.forEach((fb) => {
    const windowKey = Math.floor(fb.timestamp / windowSizeMs);
    if (!windows.has(windowKey)) {
      windows.set(windowKey, []);
    }
    windows.get(windowKey)!.push(fb);
  });

  // Calculate confidence for each window
  const trends: Array<{
    timestamp: number;
    confidence: number;
    sampleSize: number;
  }> = [];

  windows.forEach((feedbacks, windowKey) => {
    const windowTimestamp = windowKey * windowSizeMs + windowSizeMs / 2;
    const confidence = calculateFeedbackScore(
      {
        totalAttempts: 0,
        successCount: 0,
        successRate: 0.5,
        lastUsed: windowTimestamp,
        timesSuggested: 0,
        timesAccepted: 0,
        timesDismissed: 0,
        timesCorrectRd: 0,
        frequencyScore: 0.5,
        recencyScore: 0.5,
        feedbackScore: 0,
        lessons: [],
        variants: [],
        conditions: [],
        actionSequence: [],
        firstSeen: 0,
        description: '',
        target: '',
        id: '' as any,
        state: 'learning',
      } as any,
      feedbacks,
      DEFAULT_CONFIG
    );

    trends.push({
      timestamp: windowTimestamp,
      confidence,
      sampleSize: feedbacks.length,
    });
  });

  return trends;
}

/**
 * Explains the confidence score in human-readable terms.
 * 
 * @param breakdown - Confidence breakdown
 * @param habit - The habit being explained
 * @returns Human-readable explanation
 */
export function explainConfidence(breakdown: ConfidenceBreakdown, habit: Habit): string {
  const percent = (n: number) => `${(n * 100).toFixed(0)}%`;

  const parts: string[] = [
    `Overall confidence: ${percent(breakdown.overall)}`,
    `Success rate: ${percent(breakdown.successRate)}`,
    `Frequency: ${percent(breakdown.frequency)}`,
    `Recency: ${percent(breakdown.recency)}`,
    `Feedback: ${percent(breakdown.feedback)}`,
    `Context: ${percent(breakdown.context)}`,
  ];

  // Add interpretation
  if (breakdown.overall >= 0.8) {
    parts.push('Very confident - habit should be suggested');
  } else if (breakdown.overall >= 0.6) {
    parts.push('Fairly confident - habit is likely useful');
  } else if (breakdown.overall >= 0.4) {
    parts.push('Moderately confident - habit may be useful');
  } else {
    parts.push('Low confidence - habit needs more data or feedback');
  }

  return parts.join(' | ');
}

/**
 * Adapts scoring weights based on observed habit performance.
 * Emphasizes factors that better predict successful suggestions.
 * 
 * @param feedbackHistory - Recent feedback
 * @param baseConfig - Base configuration
 * @returns Adapted configuration with updated weights
 */
export function adaptScoringWeights(
  feedbackHistory: HabitFeedback[],
  baseConfig: ScoringConfig = DEFAULT_CONFIG
): ScoringConfig {
  if (feedbackHistory.length < 5) {
    // Not enough data to adapt
    return baseConfig;
  }

  // Analyze correlation between factors and success
  // For now, use simple heuristics
  const successRate = feedbackHistory.filter((fb) => fb.accepted && !fb.corrected).length / feedbackHistory.length;
  const correctionRate = feedbackHistory.filter((fb) => fb.corrected).length / feedbackHistory.length;

  // If many corrections, reduce weight on recency (older habits may be more stable)
  // If low correction rate, increase feedback weight (signal is reliable)
  const weights = { ...baseConfig.weights };

  if (correctionRate > 0.3) {
    weights.successRate += 0.1;
    weights.recency -= 0.05;
    weights.feedback -= 0.05;
  }

  if (successRate > 0.7) {
    weights.feedback += 0.1;
    weights.recency -= 0.05;
  }

  // Normalize weights to sum to 1
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  Object.keys(weights).forEach((key) => {
    weights[key as keyof typeof weights] /= sum;
  });

  return {
    ...baseConfig,
    weights,
  };
}
