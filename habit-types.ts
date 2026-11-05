/**
 * Habit System Type Definitions
 *
 * Defines the complete type model for learned automation patterns extracted from
 * execution history. Habits include confidence scoring with multi-factor decay,
 * support for pattern variants, and user feedback integration for continuous learning.
 * This is the foundation for the Learning & Habits subsystem.
 *
 * Confidence Scoring Formula:
 * overall = (success * 0.5) + (frequency * 0.2) + (recency * 0.2) + (feedback * 0.1)
 *
 * Decay Algorithm:
 * 30-day half-life: decay_factor = 0.5 ^ (days_inactive / 30)
 */

/**
 * Pattern definition describing when a habit should be suggested or triggered.
 *
 * Habits are contextual — they only apply in specific circumstances.
 * Patterns define these circumstances through workflow/pack references,
 * context conditions (URL, window title, environment), and frequency hints.
 */
export interface HabitPattern {
  /** Reference to the workflow this habit automates (optional if pack-based) */
  workflowId?: string;

  /** Reference to the pack this habit uses (optional if workflow-based) */
  packId?: string;

  /** Context conditions that must be met for this pattern to apply */
  context?: {
    /** URL pattern (regex) — matches current window URL for web apps */
    url?: string;

    /** Window/page title pattern (regex) — identifies the application/page */
    title?: string;

    /** Environment variables or application state that must be present */
    environment?: Record<string, string>;
  };

  /** Frequency hint: how often this pattern is typically used */
  frequency?: 'rare' | 'occasional' | 'frequent' | 'daily';

  /** Optional trigger condition (e.g., "time of day", "user action", "scheduled") */
  triggerCondition?: string;
}

/**
 * User feedback about a habit — approval, rejection, or modification.
 *
 * Feedback drives habit confidence scoring and learning. Multiple feedback
 * entries create a history that informs trend calculations.
 */
export interface HabitFeedback {
  /** Type of feedback: approve, reject, or modify */
  type: 'approve' | 'reject' | 'modify';

  /** ISO 8601 timestamp of when feedback was given */
  timestamp: string;

  /** Reason for feedback (optional) — explains user's intent */
  reason?: string;

  /** Weight of this feedback (0..1, default 1.0) — recent feedback weighted more heavily */
  weight?: number;
}

/**
 * Confidence breakdown showing the components that feed into overall confidence.
 *
 * Confidence is a multi-factor score combining:
 * - Success rate: How often the habit succeeds when executed (50% weight)
 * - Frequency: How often the habit is used (20% weight)
 * - Recency: How recently the habit was used (20% weight, with decay)
 * - Feedback: Explicit user feedback and corrections (10% weight)
 *
 * All scores are normalized to 0..100 (percentage).
 */
export interface ConfidenceScores {
  /** Overall confidence (0..100 percentage) combining all factors */
  overall: number;

  /**
   * Success rate component (0..100 percentage).
   * Based on: successes / (successes + failures)
   * Weight: 50%
   */
  success: number;

  /**
   * Frequency component (0..100 percentage).
   * Based on: execution count (capped at a reasonable threshold)
   * Weight: 20%
   */
  frequency: number;

  /**
   * Recency component (0..100 percentage).
   * Based on: days since last execution (with exponential decay)
   * Weight: 20%
   */
  recency: number;

  /**
   * Feedback component (0..100 percentage).
   * Based on: user approvals, rejections, and corrections
   * Weight: 10%
   */
  feedback: number;

  /** ISO 8601 timestamp of when decay was last applied to this score */
  lastDecayAt?: string;

  /** ISO 8601 timestamp of when this score was updated (for history tracking) */
  decayedAt?: string;
}

/**
 * Alternative execution pattern for the same habit in different contexts.
 *
 * Habits can have multiple variants representing different ways to achieve
 * the same goal. For example, "login" habit might have Firefox variant and
 * Chrome variant with different UI elements but same outcome.
 */
export interface HabitVariant {
  /** Unique identifier for this variant within its parent habit */
  id: string;

  /** Human-readable name for this variant (e.g., "Firefox Login") */
  name: string;

  /** Optional description of when this variant applies */
  description?: string;

  /** Pattern for this specific variant */
  pattern: HabitPattern;

  /** Confidence scores specific to this variant */
  confidence: ConfidenceScores;

  /** Total number of times this variant has been executed */
  executionCount: number;

  /** Number of successful executions of this variant */
  successCount: number;

  /** Number of failed executions of this variant */
  failureCount: number;

  /** ISO 8601 timestamp of the last execution of this variant */
  lastExecutedAt?: string;

  /** ISO 8601 timestamp when this variant was created */
  createdAt: string;
}

/**
 * Learned automation habit extracted from execution patterns.
 *
 * A habit is a reusable pattern learned from successful workflow executions.
 * Habits are suggested to the user when the current context matches the habit's
 * conditions. Habits improve over time through execution and user feedback.
 */
export interface Habit {
  /** Unique identifier for this habit in the system */
  id: string;

  /** Human-readable name for this habit (e.g., "Login to Email", "Submit Form") */
  name: string;

  /** Optional longer description of what this habit does */
  description?: string;

  /** Primary pattern that defines this habit's conditions and actions */
  primaryPattern: HabitPattern;

  /** Confidence scores for this habit's overall effectiveness */
  confidence: ConfidenceScores;

  // Execution History

  /** Total number of times this habit has been executed */
  totalExecutions: number;

  /** Number of successful executions */
  successCount: number;

  /** Number of failed executions */
  failureCount: number;

  /** ISO 8601 timestamp of the most recent execution */
  lastExecutedAt?: string;

  // Variants

  /**
   * Alternative patterns for executing this habit in different contexts.
   * For example, different UI implementations across browsers.
   */
  variants?: HabitVariant[];

  // User Feedback

  /**
   * Collection of user feedback entries (approvals, rejections, corrections).
   * Drives confidence scoring and habit refinement.
   */
  feedback?: HabitFeedback[];

  // Metadata

  /** ISO 8601 timestamp when this habit was created */
  createdAt: string;

  /** ISO 8601 timestamp when this habit was last modified */
  updatedAt: string;

  /** Tags for categorization and discovery */
  tags?: string[];

  /** ISO 8601 timestamp when this habit was suggested to the user (if applicable) */
  suggestedAt?: string;
}

/**
 * Execution record for a single habit invocation.
 *
 * Tracks what happened when a habit was executed, including success/failure,
 * duration, and any corrections the user made.
 */
export interface HabitExecutionRecord {
  /** Unique identifier for this execution */
  id: string;

  /** Habit ID that was executed */
  habitId: string;

  /** ISO 8601 timestamp of the execution */
  timestamp: string;

  /** Source of the execution trigger (suggestion, auto, or manual) */
  source: 'suggestion-accepted' | 'auto-executed' | 'manual-trigger';

  /** Whether the execution succeeded */
  success: boolean;

  /** Duration of the execution in milliseconds */
  duration: number;

  /** User feedback after execution (if provided) */
  userFeedback?: 'approved' | 'corrected' | 'rejected';

  /** Corrections made to individual steps (if applicable) */
  corrections?: Record<number, {
    originalAction: string;
    correctedAction: string;
    reason?: string;
  }>;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Apply confidence decay to a habit based on inactivity.
 *
 * Uses 30-day half-life exponential decay:
 * decay_factor = 0.5 ^ (days_inactive / 30)
 *
 * Applied to all confidence components.
 *
 * @param habit - The habit to apply decay to
 * @param now - Current timestamp (defaults to now)
 */
export function applyConfidenceDecay(habit: Habit, now: Date = new Date()): void {
  if (!habit.lastExecutedAt) {
    return;
  }

  const lastExecuted = new Date(habit.lastExecutedAt);
  const daysInactive = (now.getTime() - lastExecuted.getTime()) / (24 * 60 * 60 * 1000);

  // Decay factor: 0.5 ^ (days_inactive / 30)
  // After 30 days: 0.5
  // After 60 days: 0.25
  // After 90 days: 0.125
  const decayFactor = Math.pow(0.5, daysInactive / 30);

  // Apply decay to all confidence components
  habit.confidence.success *= decayFactor;
  habit.confidence.frequency *= decayFactor;
  habit.confidence.recency *= decayFactor;

  // Recalculate overall confidence
  habit.confidence.overall = calculateOverallConfidence(habit.confidence);
  habit.confidence.decayedAt = now.toISOString();
}

/**
 * Calculate overall confidence from component breakdown.
 *
 * Formula: overall = (success * 0.5) + (frequency * 0.2) + (recency * 0.2) + (feedback * 0.1)
 *
 * @param scores - The confidence scores breakdown
 * @returns Overall confidence (0..100)
 */
export function calculateOverallConfidence(scores: ConfidenceScores): number {
  const overall = (scores.success * 0.5) +
                  (scores.frequency * 0.2) +
                  (scores.recency * 0.2) +
                  (scores.feedback * 0.1);

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, overall));
}

/**
 * Classify frequency category based on execution count.
 *
 * @param executionCount - Total number of executions
 * @returns Frequency classification
 */
export function classifyFrequency(executionCount: number): 'rare' | 'occasional' | 'frequent' | 'daily' {
  if (executionCount <= 2) {
    return 'rare';
  } else if (executionCount <= 5) {
    return 'occasional';
  } else if (executionCount <= 10) {
    return 'frequent';
  } else {
    return 'daily';
  }
}

/**
 * Create a habit with sensible defaults.
 *
 * @param name - Habit name
 * @param primaryPattern - Pattern that defines the habit
 * @param options - Optional configuration
 * @returns New Habit instance
 */
export function createHabit(
  name: string,
  primaryPattern: HabitPattern,
  options?: Partial<{
    id: string;
    description: string;
    tags: string[];
  }>
): Habit {
  const now = new Date().toISOString();

  const confidence: ConfidenceScores = {
    success: 50,
    frequency: 0,
    recency: 50,
    feedback: 50,
    overall: 0,
    lastDecayAt: now,
  };

  // Calculate overall from components
  confidence.overall = calculateOverallConfidence(confidence);

  return {
    id: options?.id ?? `habit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    description: options?.description,
    primaryPattern,
    confidence,
    totalExecutions: 0,
    successCount: 0,
    failureCount: 0,
    variants: [],
    feedback: [],
    tags: options?.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create a habit variant with defaults.
 *
 * @param name - Variant name
 * @param pattern - Pattern for this variant
 * @param options - Optional configuration
 * @returns New HabitVariant instance
 */
export function createHabitVariant(
  name: string,
  pattern: HabitPattern,
  options?: Partial<{
    id: string;
    description: string;
  }>
): HabitVariant {
  const now = new Date().toISOString();

  const confidence: ConfidenceScores = {
    success: 50,
    frequency: 0,
    recency: 50,
    feedback: 50,
    overall: 0,
    lastDecayAt: now,
  };

  // Calculate overall from components
  confidence.overall = calculateOverallConfidence(confidence);

  return {
    id: options?.id ?? `variant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    description: options?.description,
    pattern,
    confidence,
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdAt: now,
  };
}

/**
 * Create confidence scores with defaults.
 *
 * @param options - Initial score values
 * @returns ConfidenceScores instance
 */
export function createConfidenceScores(options?: Partial<ConfidenceScores>): ConfidenceScores {
  const scores: ConfidenceScores = {
    success: options?.success ?? 50,
    frequency: options?.frequency ?? 0,
    recency: options?.recency ?? 50,
    feedback: options?.feedback ?? 50,
    overall: 50,
    lastDecayAt: new Date().toISOString(),
  };

  scores.overall = calculateOverallConfidence(scores);
  return scores;
}

/**
 * Validate that a confidence score is within valid ranges.
 *
 * @param scores - The scores to validate
 * @throws Error if any score is outside [0, 100] range
 */
export function validateConfidenceScores(scores: ConfidenceScores): void {
  const validateScore = (value: number, name: string): void => {
    if (typeof value !== 'number' || value < 0 || value > 100) {
      throw new Error(`${name} must be a number between 0 and 100, got ${value}`);
    }
  };

  validateScore(scores.overall, 'overall confidence');
  validateScore(scores.success, 'success score');
  validateScore(scores.frequency, 'frequency score');
  validateScore(scores.recency, 'recency score');
  validateScore(scores.feedback, 'feedback score');
}

/**
 * Validate that a habit has correct structure and values.
 *
 * @param habit - The habit to validate
 * @throws Error if validation fails
 */
export function validateHabit(habit: Habit): void {
  if (!habit.id || typeof habit.id !== 'string') {
    throw new Error('Habit must have a string id');
  }

  if (!habit.name || typeof habit.name !== 'string') {
    throw new Error('Habit must have a string name');
  }

  if (!habit.primaryPattern) {
    throw new Error('Habit must have a primaryPattern');
  }

  if (!habit.confidence) {
    throw new Error('Habit must have confidence scores');
  }

  validateConfidenceScores(habit.confidence);

  if (!Array.isArray(habit.variants)) {
    throw new Error('Habit variants must be an array');
  }

  if (typeof habit.totalExecutions !== 'number' || habit.totalExecutions < 0) {
    throw new Error('totalExecutions must be a non-negative number');
  }

  if (typeof habit.successCount !== 'number' || habit.successCount < 0) {
    throw new Error('successCount must be a non-negative number');
  }

  if (typeof habit.failureCount !== 'number' || habit.failureCount < 0) {
    throw new Error('failureCount must be a non-negative number');
  }

  // Validate timestamps are ISO 8601
  const validateIso8601 = (value: string, name: string): void => {
    if (!value || typeof value !== 'string') {
      throw new Error(`${name} must be an ISO 8601 string`);
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error(`${name} is not a valid ISO 8601 timestamp: ${value}`);
    }
  };

  validateIso8601(habit.createdAt, 'createdAt');
  validateIso8601(habit.updatedAt, 'updatedAt');

  if (habit.lastExecutedAt) {
    validateIso8601(habit.lastExecutedAt, 'lastExecutedAt');
  }

  if (habit.suggestedAt) {
    validateIso8601(habit.suggestedAt, 'suggestedAt');
  }
}

/**
 * Serialize a habit to JSON string.
 *
 * @param habit - The habit to serialize
 * @returns JSON string representation
 */
export function serializeHabit(habit: Habit): string {
  validateHabit(habit);
  return JSON.stringify(habit);
}

/**
 * Deserialize a habit from JSON string.
 *
 * @param json - The JSON string to deserialize
 * @returns Deserialized Habit instance
 * @throws Error if JSON is invalid or deserialized object is invalid
 */
export function deserializeHabit(json: string): Habit {
  const habit = JSON.parse(json) as Habit;
  validateHabit(habit);
  return habit;
}

/**
 * Update habit confidence after an execution event.
 *
 * @param habit - The habit to update
 * @param success - Whether the execution succeeded
 * @param feedback - Optional user feedback
 */
export function updateHabitConfidenceAfterExecution(
  habit: Habit,
  success: boolean,
  feedback?: HabitFeedback
): void {
  // Update execution counts
  habit.totalExecutions += 1;
  if (success) {
    habit.successCount += 1;
  } else {
    habit.failureCount += 1;
  }

  // Adjust confidence components based on result
  if (success) {
    // Successful execution: increase success rate and recency
    habit.confidence.success = Math.min(100, habit.confidence.success + 5);
    habit.confidence.recency = Math.min(100, habit.confidence.recency + 3);
  } else {
    // Failed execution: decrease success rate significantly
    habit.confidence.success = Math.max(0, habit.confidence.success - 10);
    habit.confidence.recency = Math.max(0, habit.confidence.recency - 5);
  }

  // Increase frequency based on execution count (with cap)
  const frequencyScore = Math.min(100, (habit.totalExecutions / 10) * 100);
  habit.confidence.frequency = frequencyScore;

  // Apply user feedback if provided
  if (feedback) {
    if (feedback.type === 'approve') {
      habit.confidence.feedback = Math.min(100, habit.confidence.feedback + (feedback.weight ?? 1) * 5);
    } else if (feedback.type === 'reject') {
      habit.confidence.feedback = Math.max(0, habit.confidence.feedback - (feedback.weight ?? 1) * 10);
    } else if (feedback.type === 'modify') {
      habit.confidence.feedback = Math.max(0, habit.confidence.feedback - (feedback.weight ?? 1) * 5);
    }
  }

  // Recalculate overall confidence
  habit.confidence.overall = calculateOverallConfidence(habit.confidence);
  habit.confidence.lastDecayAt = new Date().toISOString();
  habit.lastExecutedAt = new Date().toISOString();
  habit.updatedAt = new Date().toISOString();
}

/**
 * Calculate success rate from execution counts.
 *
 * @param successCount - Number of successful executions
 * @param failureCount - Number of failed executions
 * @returns Success rate as percentage (0..100)
 */
export function calculateSuccessRate(successCount: number, failureCount: number): number {
  if (successCount + failureCount === 0) {
    return 50; // Default for no executions
  }

  return (successCount / (successCount + failureCount)) * 100;
}

/**
 * Calculate recency score based on time since last execution.
 *
 * Uses exponential decay: recency = 100 * 0.5 ^ (days_since_execution / 30)
 *
 * @param lastExecutedAt - ISO 8601 timestamp of last execution (or undefined)
 * @param now - Current timestamp (defaults to now)
 * @returns Recency score (0..100)
 */
export function calculateRecencyScore(lastExecutedAt?: string, now: Date = new Date()): number {
  if (!lastExecutedAt) {
    return 0; // No execution history
  }

  const lastExecution = new Date(lastExecutedAt);
  const daysSince = (now.getTime() - lastExecution.getTime()) / (24 * 60 * 60 * 1000);

  // Decay: 30-day half-life
  // After 0 days: 100
  // After 30 days: 50
  // After 60 days: 25
  return 100 * Math.pow(0.5, daysSince / 30);
}
