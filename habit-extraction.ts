/**
 * Habit Extraction from Workflows
 * Identifies repeatable patterns in workflows and extracts them as learnable habits.
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

/** Unique identifier for a habit. */
export type HabitId = string & { readonly __brand: 'HabitId' };

/** Type of condition for habit matching. */
export type ConditionType = 'element-state' | 'context-match' | 'time-pattern' | 'sequence-history';

/** Habit lifecycle state. */
export type HabitLifecycleState = 'active' | 'inactive' | 'archived' | 'learning';

/**
 * A step in a workflow or sequence.
 */
export interface WorkflowStep {
  id: string;
  index: number;
  name: string;
  action: string;
  target?: string;
  x?: number;
  y?: number;
  duration?: number;
  success: boolean;
  timestamp: number;
}

/**
 * A sequence of consecutive steps.
 */
export interface ActionSequence {
  steps: WorkflowStep[];
  startIndex: number;
  endIndex: number;
  length: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

/**
 * A condition for habit matching.
 */
export interface HabitCondition {
  type: ConditionType;
  context?: string;  // For context-match
  selector?: string;  // For element-state
  state?: string;  // For element-state (e.g., 'visible', 'enabled', 'focused')
  dayOfWeek?: number[];  // For time-pattern (0=Sunday, 6=Saturday)
  timeRange?: { start: string; end: string };  // For time-pattern (HH:MM format)
  sequence?: string[];  // For sequence-history (list of previous actions)
}

/**
 * A learnable habit extracted from workflows.
 */
export interface Habit {
  id: HabitId;
  target: string;  // What is being automated (e.g., "Login", "Export Data")
  description: string;
  
  // Sequences
  actionSequence: WorkflowStep[];  // The steps that make up this habit
  
  // Conditions for applying the habit
  conditions: HabitCondition[];
  
  // Confidence tracking
  successCount: number;
  totalAttempts: number;
  successRate: number;  // 0..1
  
  // Meta information
  firstSeen: number;  // timestamp
  lastUsed: number;  // timestamp
  timesSuggested: number;
  timesAccepted: number;
  timesDismissed: number;
  timesCorrectRd: number;  // User had to correct
  
  // Learning state
  state: HabitLifecycleState;
  variants: HabitVariant[];
  
  // Confidence breakdown
  frequencyScore: number;  // 0..1, based on how often used
  recencyScore: number;   // 0..1, based on recent usage (decays over time)
  feedbackScore: number;  // 0..1, based on user corrections/dismissals
  
  // Lessons learned
  lessons: Lesson[];
}

/**
 * A variant of a habit for specific contexts.
 */
export interface HabitVariant {
  id: string;
  name: string;
  actionSequence: WorkflowStep[];
  conditions: HabitCondition[];
  successRate: number;
  usageCount: number;
}

/**
 * A lesson extracted from habit execution.
 */
export interface Lesson {
  kind: 'avoid' | 'add' | 'adjust';
  text: string;
  context?: string;
  learned: number;  // timestamp
}

/**
 * Configuration for habit extraction.
 */
export interface HabitExtractionConfig {
  minSequenceLength: number;  // Minimum steps in a sequence
  minSuccessRate: number;  // Minimum success rate to extract
  minFrequency: number;  // Minimum occurrences to extract
  minContextSimilarity: number;  // For grouping similar habits
}

const DEFAULT_CONFIG: HabitExtractionConfig = {
  minSequenceLength: 2,
  minSuccessRate: 0.6,
  minFrequency: 2,
  minContextSimilarity: 0.8,
};

/**
 * Extracts repeatable patterns (habits) from a workflow.
 * Identifies common action sequences that could be automated.
 * 
 * @param steps - Steps from a completed workflow
 * @param config - Extraction configuration
 * @returns Array of extracted habits
 */
export function extractHabitsFromWorkflow(
  steps: WorkflowStep[],
  config: Partial<HabitExtractionConfig> = {}
): Habit[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const habits: Habit[] = [];

  // Find common sequences
  const sequences = findCommonSequences(steps, cfg.minSequenceLength);

  // Filter sequences by success rate
  const goodSequences = sequences.filter((seq) => seq.successRate >= cfg.minSuccessRate);

  // Convert sequences to habits
  goodSequences.forEach((seq) => {
    const habit = sequenceToHabit(seq, steps);
    if (habit) {
      habits.push(habit);
    }
  });

  return habits;
}

/**
 * Finds common action sequences in a workflow.
 * Uses sliding window to find repeating patterns.
 * 
 * @param steps - Workflow steps
 * @param minLength - Minimum sequence length
 * @returns Array of sequences with their statistics
 */
function findCommonSequences(steps: WorkflowStep[], minLength: number): ActionSequence[] {
  const sequences: Map<string, ActionSequence> = new Map();

  // Sliding window approach
  for (let windowSize = minLength; windowSize <= steps.length / 2; windowSize++) {
    for (let i = 0; i <= steps.length - windowSize; i++) {
      const window = steps.slice(i, i + windowSize);
      const key = sequenceToKey(window);

      if (!sequences.has(key)) {
        sequences.set(key, {
          steps: window,
          startIndex: i,
          endIndex: i + windowSize - 1,
          length: windowSize,
          successCount: window.filter((s) => s.success).length,
          failureCount: window.filter((s) => !s.success).length,
          successRate: window.filter((s) => s.success).length / window.length,
        });
      }
    }
  }

  // Return sequences sorted by frequency and success rate
  return Array.from(sequences.values()).sort((a, b) => {
    const scoreA = a.successRate * a.length;
    const scoreB = b.successRate * b.length;
    return scoreB - scoreA;
  });
}

/**
 * Converts an action sequence to a unique key for deduplication.
 * 
 * @param steps - Sequence of steps
 * @returns Unique key
 */
function sequenceToKey(steps: WorkflowStep[]): string {
  return steps.map((s) => `${s.action}:${s.target || 'none'}`).join('->');
}

/**
 * Converts an action sequence to a habit.
 * 
 * @param sequence - The sequence to convert
 * @param allSteps - All steps in the workflow (for context)
 * @returns Habit or null if not valid
 */
function sequenceToHabit(sequence: ActionSequence, allSteps: WorkflowStep[]): Habit | null {
  if (sequence.steps.length < 2) {
    return null;
  }

  const id = `habit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as HabitId;
  const target = sequence.steps.map((s) => s.target || s.action).join(' → ');

  // Extract context conditions
  const conditions = extractConditions(sequence, allSteps);

  const habit: Habit = {
    id,
    target,
    description: `Automated pattern: ${target}`,
    actionSequence: sequence.steps,
    conditions,
    successCount: sequence.successCount,
    totalAttempts: sequence.successCount + sequence.failureCount,
    successRate: sequence.successRate,
    firstSeen: sequence.steps[0].timestamp,
    lastUsed: sequence.steps[sequence.steps.length - 1].timestamp,
    timesSuggested: 0,
    timesAccepted: 0,
    timesDismissed: 0,
    timesCorrectRd: 0,
    state: 'learning',
    variants: [],
    frequencyScore: Math.min(1, (sequence.successCount + sequence.failureCount) / 10),
    recencyScore: calculateRecencyScore(sequence.steps[sequence.steps.length - 1].timestamp),
    feedbackScore: 0,
    lessons: [],
  };

  return habit;
}

/**
 * Extracts conditions from a sequence for habit matching.
 * 
 * @param sequence - The action sequence
 * @param allSteps - All steps for context
 * @returns Array of conditions
 */
function extractConditions(sequence: ActionSequence, allSteps: WorkflowStep[]): HabitCondition[] {
  const conditions: HabitCondition[] = [];

  // Extract element state conditions (if targets are consistent)
  if (sequence.steps.every((s) => s.target)) {
    const firstStep = sequence.steps[0];
    if (firstStep.target) {
      conditions.push({
        type: 'element-state',
        selector: firstStep.target,
        state: 'visible',  // Default assumption
      });
    }
  }

  // Extract time-based patterns if all steps happened within reasonable time
  const timeSpan = Math.max(...sequence.steps.map((s) => s.timestamp)) - Math.min(...sequence.steps.map((s) => s.timestamp));
  if (timeSpan < 60000) {  // Within 1 minute
    conditions.push({
      type: 'time-pattern',
      dayOfWeek: [new Date(sequence.steps[0].timestamp).getDay()],
    });
  }

  return conditions;
}

/**
 * Calculates recency score (0..1) based on how recent the habit was last used.
 * Applies exponential decay over 30 days (half-life).
 * 
 * @param lastUsedTime - Timestamp when habit was last used
 * @returns Recency score (0..1)
 */
function calculateRecencyScore(lastUsedTime: number): number {
  const now = Date.now();
  const daysSinceUse = (now - lastUsedTime) / (1000 * 60 * 60 * 24);
  const halfLife = 30;  // 30 days
  
  // Exponential decay: score = 2^(-daysSinceUse / halfLife)
  // Clamp to [0, 1] to ensure valid score
  return Math.max(0, Math.min(1, Math.pow(2, -daysSinceUse / halfLife)));
}

/**
 * Calculates overall habit confidence (0..1).
 * Combines success rate, frequency, recency, and user feedback.
 * 
 * @param habit - The habit to score
 * @returns Confidence score (0..1)
 */
export function calculateHabitConfidence(habit: Habit): number {
  // Weighted combination of factors
  const weights = {
    successRate: 0.4,
    frequency: 0.2,
    recency: 0.2,
    feedback: 0.2,
  };

  const score =
    habit.successRate * weights.successRate +
    habit.frequencyScore * weights.frequency +
    habit.recencyScore * weights.recency +
    habit.feedbackScore * weights.feedback;

  return Math.max(0, Math.min(1, score));
}

/**
 * Extracts context from a set of steps.
 * Builds understanding of the environment and preconditions.
 * 
 * @param steps - Steps to analyze
 * @returns Context information
 */
export function extractContext(steps: WorkflowStep[]): Record<string, unknown> {
  const context: Record<string, unknown> = {
    stepCount: steps.length,
    successCount: steps.filter((s) => s.success).length,
    failureCount: steps.filter((s) => !s.success).length,
    averageDuration: steps.reduce((sum, s) => sum + (s.duration || 0), 0) / steps.length,
    firstTimestamp: steps[0]?.timestamp,
    lastTimestamp: steps[steps.length - 1]?.timestamp,
    targets: [...new Set(steps.map((s) => s.target).filter(Boolean))],
    actions: [...new Set(steps.map((s) => s.action))],
  };

  return context;
}

/**
 * Normalizes an action sequence for comparison and deduplication.
 * Abstracts away specific coordinates and timing details.
 * 
 * @param steps - Steps to normalize
 * @returns Normalized sequence representation
 */
export function normalizeSequence(steps: WorkflowStep[]): string {
  return steps
    .map((s) => ({
      action: s.action,
      target: s.target,
    }))
    .map((s) => `${s.action}(${s.target || '*'})`)
    .join(' -> ');
}

/**
 * Calculates similarity between two sequences (0..1).
 * Used for habit merging and variant detection.
 * Compares action sequences at a semantic level.
 * 
 * @param seq1 - First sequence
 * @param seq2 - Second sequence
 * @returns Similarity score (0..1)
 */
export function sequenceSimilarity(seq1: WorkflowStep[], seq2: WorkflowStep[]): number {
  if (seq1.length === 0 && seq2.length === 0) return 1;
  if (seq1.length === 0 || seq2.length === 0) return 0;

  // Use length difference as a factor
  const lengthDiff = Math.abs(seq1.length - seq2.length) / Math.max(seq1.length, seq2.length);
  if (lengthDiff > 0.5) return 0;  // Very different lengths = low similarity

  // Compare actions and targets step by step
  let matches = 0;
  const minLength = Math.min(seq1.length, seq2.length);

  for (let i = 0; i < minLength; i++) {
    const step1 = seq1[i];
    const step2 = seq2[i];
    
    // Action match is critical
    if (step1.action === step2.action) {
      matches += 0.6;  // 60% weight to action match
      // If actions match and targets match, count full match
      if (step1.target === step2.target) {
        matches += 0.4;  // Additional 40% for target match
      }
    } else if (step1.target === step2.target && step1.target) {
      // Partial credit if targets match but actions don't
      matches += 0.2;
    }
  }

  // Normalize: 100% matches = minLength * 1.0
  const similarity = matches / minLength;
  return Math.max(0, Math.min(1, similarity));
}

/**
 * Calculates Levenshtein distance between two strings.
 * Used for similarity comparison.
 * 
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,  // Substitution
          matrix[i][j - 1] + 1,      // Insertion
          matrix[i - 1][j] + 1       // Deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Merges similar habits to reduce duplication.
 * 
 * @param habits - Habits to merge
 * @param minSimilarity - Minimum similarity to merge (0..1)
 * @returns Merged habits
 */
export function mergeHabits(habits: Habit[], minSimilarity: number = 0.8): Habit[] {
  const merged: Habit[] = [];
  const processedIndices = new Set<number>();

  habits.forEach((habit1, idx1) => {
    if (processedIndices.has(idx1)) return;

    let mergedHabit = { ...habit1, variants: [...habit1.variants] };
    const similarHabitIndices: number[] = [];

    // Find similar habits
    habits.forEach((habit2, idx2) => {
      if (idx1 === idx2 || processedIndices.has(idx2)) return;

      const similarity = sequenceSimilarity(habit1.actionSequence, habit2.actionSequence);

      if (similarity >= minSimilarity) {
        similarHabitIndices.push(idx2);
        processedIndices.add(idx2);
      }
    });

    // Merge similar habits
    similarHabitIndices.forEach((idx2) => {
      const habit2 = habits[idx2];
      
      // Merge statistics
      mergedHabit.successCount += habit2.successCount;
      mergedHabit.totalAttempts += habit2.totalAttempts;
      mergedHabit.successRate = mergedHabit.successCount / mergedHabit.totalAttempts;
      mergedHabit.timesSuggested += habit2.timesSuggested;
      mergedHabit.timesAccepted += habit2.timesAccepted;
      mergedHabit.timesDismissed += habit2.timesDismissed;
      mergedHabit.timesCorrectRd += habit2.timesCorrectRd;

      // Add as variant if different enough
      const similarity = sequenceSimilarity(habit1.actionSequence, habit2.actionSequence);
      if (similarity < 1) {
        mergedHabit.variants.push({
          id: habit2.id,
          name: habit2.target,
          actionSequence: habit2.actionSequence,
          conditions: habit2.conditions,
          successRate: habit2.successRate,
          usageCount: habit2.totalAttempts,
        });
      }
    });

    merged.push(mergedHabit);
    processedIndices.add(idx1);
  });

  return merged;
}

/**
 * Generates a human-readable description of a habit.
 * 
 * @param habit - The habit to describe
 * @returns Human-readable description
 */
export function describeHabit(habit: Habit): string {
  const accuracy = `${(habit.successRate * 100).toFixed(0)}%`;
  const frequency = `${habit.totalAttempts} time(s)`;
  const conditions =
    habit.conditions.length > 0
      ? `when ${habit.conditions.map((c) => c.context || c.state || 'conditions').join(', ')}`
      : 'in various contexts';

  return `${habit.target} (${accuracy} success rate, tried ${frequency}) ${conditions}`;
}

/**
 * Helper to generate unique habit ID.
 */
export function generateHabitId(): HabitId {
  return `habit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as HabitId;
}
