/**
 * Pattern Detection Engine
 *
 * Implements algorithms for detecting repeatable patterns in workflow executions.
 * Used by the Habit Extraction system to identify sequences that should be
 * converted into reusable habits.
 *
 * Key Algorithms:
 * - Sliding window for sequence detection
 * - Longest common subsequence (LCS) for similarity detection
 * - Jaccard similarity for context comparison
 * - Duplicate removal using normalized sequences
 */

import type { WorkflowStep, Action } from './recording-types.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A detected pattern with metadata.
 */
export interface DetectedPattern {
  /** Unique identifier for this pattern */
  id: string;

  /** Start index in the original workflow */
  startIndex: number;

  /** End index in the original workflow */
  endIndex: number;

  /** The steps that make up this pattern */
  steps: WorkflowStep[];

  /** Number of times this pattern was observed */
  frequency: number;

  /** Success rate for this pattern */
  successRate: number;

  /** Total execution time in milliseconds */
  totalTime: number;

  /** Average execution time in milliseconds */
  avgTime: number;
}

/**
 * A normalized pattern representation for comparison.
 */
export interface NormalizedPattern {
  /** Normalized action sequence (without coordinates) */
  sequence: string[];

  /** Context signature (element selectors) */
  context: string[];

  /** Duration range */
  durationRange: [number, number];

  /** Action types */
  actionTypes: string[];
}

/**
 * Configuration for pattern detection.
 */
export interface PatternDetectionConfig {
  /** Minimum sequence length to consider */
  minSequenceLength: number;

  /** Maximum sequence length to consider */
  maxSequenceLength: number;

  /** Minimum frequency to consider a pattern significant */
  minFrequency: number;

  /** Minimum success rate to consider a pattern */
  minSuccessRate: number;

  /** Similarity threshold for grouping similar patterns */
  similarityThreshold: number;

  /** Time window in milliseconds for considering steps as related */
  timeWindowMs: number;
}

/**
 * Comparison result between two patterns.
 */
export interface PatternComparison {
  /** Jaccard similarity score */
  jaccard: number;

  /** LCS length */
  lcsLength: number;

  /** LCS ratio (LCS length / max sequence length) */
  lcsRatio: number;

  /** Action match percentage */
  actionMatch: number;

  /** Context match percentage */
  contextMatch: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: PatternDetectionConfig = {
  minSequenceLength: 2,
  maxSequenceLength: 20,
  minFrequency: 1,
  minSuccessRate: 0.0,
  similarityThreshold: 0.7,
  timeWindowMs: 5000,
};

// ============================================================================
// Pattern Detector Class
// ============================================================================

/**
 * Detects and analyzes patterns in workflow executions.
 *
 * Provides algorithms for:
 * - Finding repeated action sequences
 * - Calculating pattern similarity
 * - Normalizing patterns for comparison
 * - Detecting duplicate or similar patterns
 */
export class PatternDetector {
  private config: PatternDetectionConfig;

  constructor(config?: Partial<PatternDetectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detects patterns in a workflow execution.
   *
   * Uses sliding window approach to find all possible sequences,
   * then groups similar ones and calculates statistics.
   *
   * @param workflowId - ID of the workflow
   * @param steps - Steps from the workflow execution
   * @returns Detected patterns
   */
  detectPatterns(workflowId: string, steps: WorkflowStep[]): DetectedPattern[] {
    // Step 1: Find all possible sequences
    const allSequences = this.findPossibleSequences(steps);

    // Step 2: Group similar sequences
    const groupedSequences = this.groupSimilarSequences(allSequences);

    // Step 3: Filter by frequency and success rate
    const significantPatterns = groupedSequences.filter(
      (seq) => seq.frequency >= this.config.minFrequency &&
                seq.successRate >= this.config.minSuccessRate
    );

    // Step 4: Convert to detected patterns
    return significantPatterns.map((seq, index) => ({
      id: `${workflowId}-pattern-${index}-${Date.now()}`,
      startIndex: seq.startIndex,
      endIndex: seq.endIndex,
      steps: seq.steps,
      frequency: seq.frequency,
      successRate: seq.successRate,
      totalTime: seq.totalTime,
      avgTime: seq.avgTime,
    }));
  }

  /**
   * Finds all possible action sequences using sliding window.
   *
   * @param steps - Workflow steps
   * @returns Array of action sequence metadata
   */
  private findPossibleSequences(steps: WorkflowStep[]): ActionSequenceStats[] {
    const sequences = new Map<string, ActionSequenceStats>();

    // Sliding window approach
    const maxLen = Math.min(this.config.maxSequenceLength, steps.length);

    for (let windowSize = this.config.minSequenceLength; windowSize <= maxLen; windowSize++) {
      for (let i = 0; i <= steps.length - windowSize; i++) {
        const window = steps.slice(i, i + windowSize);
        const key = this.sequenceToKey(window);

        if (sequences.has(key)) {
          // Merge with existing sequence
          const existing = sequences.get(key)!;
          existing.frequency += 1;
          existing.totalTime += window.reduce((sum, s) => sum + (s.duration || 0), 0);
          existing.successCount += window.filter((s) => s.success).length;
          existing.failureCount += window.filter((s) => !s.success).length;
          existing.endIndex = Math.max(existing.endIndex, i + windowSize - 1);
        } else {
            sequences.set(key, {
              startIndex: i,
              endIndex: i + windowSize - 1,
              steps: window,
              frequency: 1,
              successCount: window.filter((s) => s.success).length,
              failureCount: window.filter((s) => !s.success).length,
              totalTime: window.reduce((sum, s) => sum + (s.duration || 0), 0),
              avgTime: window.length > 0 ? window.reduce((sum, s) => sum + (s.duration || 0), 0) / window.length : 0,
            });
        }
      }
    }

    return Array.from(sequences.values());
  }

  /**
   * Converts a sequence to a unique key for deduplication.
   *
   * @param steps - Sequence of steps
   * @returns Unique key
   */
  private sequenceToKey(steps: WorkflowStep[]): string {
    // Use action and target (without coordinates) for key
    return steps.map((s) => `${s.action}:${s.target || '*'}`).join('|');
  }

  /**
   * Groups similar sequences together.
   *
   * Uses similarity scoring to identify duplicate patterns
   * that differ only in coordinates or timing.
   *
   * @param sequences - Raw sequences
   * @returns Grouped sequences with combined statistics
   */
  private groupSimilarSequences(sequences: ActionSequenceStats[]): ActionSequenceStats[] {
    const grouped: ActionSequenceStats[] = [];

    for (const seq of sequences) {
      let foundSimilar = false;

      for (const group of grouped) {
        const similarity = this.calculateSequenceSimilarity(
          seq.steps,
          group.steps
        );

        if (similarity >= this.config.similarityThreshold) {
          // Merge with this group
          group.frequency += seq.frequency;
          group.totalTime += seq.totalTime;
          group.successCount += seq.successCount;
          group.failureCount += seq.failureCount;
          group.endIndex = Math.max(group.endIndex, seq.endIndex);
          foundSimilar = true;
          break;
        }
      }

      if (!foundSimilar) {
        grouped.push({ ...seq });
      }
    }

    return grouped;
  }

  /**
   * Calculates similarity between two sequences.
   *
   * Uses a combination of:
   * - Jaccard similarity for element overlap
   * - LCS ratio for sequence alignment
   *
   * @param seq1 - First sequence
   * @param seq2 - Second sequence
   * @returns Similarity score (0..1)
   */
  private calculateSequenceSimilarity(seq1: WorkflowStep[], seq2: WorkflowStep[]): number {
    if (seq1.length === 0 && seq2.length === 0) return 1;
    if (seq1.length === 0 || seq2.length === 0) return 0;

    // Action match score
    const actionMatches = this.calculateActionMatch(seq1, seq2);
    
    // Context match score
    const contextMatches = this.calculateContextMatch(seq1, seq2);
    
    // Length similarity
    const lengthSimilarity = 1 - Math.abs(seq1.length - seq2.length) / Math.max(seq1.length, seq2.length);

    // Weighted combination
    return (actionMatches * 0.5) + (contextMatches * 0.3) + (lengthSimilarity * 0.2);
  }

  /**
   * Calculates action match percentage.
   *
   * @param seq1 - First sequence
   * @param seq2 - Second sequence
   * @returns Action match percentage (0..1)
   */
  private calculateActionMatch(seq1: WorkflowStep[], seq2: WorkflowStep[]): number {
    if (seq1.length === 0 || seq2.length === 0) return 0;

    let matches = 0;
    const minLength = Math.min(seq1.length, seq2.length);

    for (let i = 0; i < minLength; i++) {
      if (seq1[i].action === seq2[i].action) {
        matches++;
      }
    }

    return matches / minLength;
  }

  /**
   * Calculates context match percentage.
   *
   * @param seq1 - First sequence
   * @param seq2 - Second sequence
   * @returns Context match percentage (0..1)
   */
  private calculateContextMatch(seq1: WorkflowStep[], seq2: WorkflowStep[]): number {
    if (seq1.length === 0 || seq2.length === 0) return 0;

    let matches = 0;
    const minLength = Math.min(seq1.length, seq2.length);

    for (let i = 0; i < minLength; i++) {
      // Check if targets match (ignoring coordinates)
      const target1 = seq1[i].target;
      const target2 = seq2[i].target;

      if (target1 && target2 && this.targetsMatch(target1, target2)) {
        matches++;
      } else if (target1 === target2) {
        matches++;
      }
    }

    return matches / minLength;
  }

  /**
   * Determines if two element targets match.
   *
   * @param target1 - First target selector
   * @param target2 - Second target selector
   * @returns true if targets match
   */
  private targetsMatch(target1: string, target2: string): boolean {
    // Normalize selectors by removing coordinates and dynamic parts
    const normalizeSelector = (selector: string): string => {
      // Remove coordinate patterns like (100,200)
      return selector.replace(/\(\d+,\d+\)/g, '*')
        .replace(/\[\d+\]/g, '*')
        .replace(/data-\w+=".+?"/g, 'data-*="*"');
    };

    const norm1 = normalizeSelector(target1);
    const norm2 = normalizeSelector(target2);

    return norm1 === norm2;
  }

  /**
   * Normalizes a pattern for comparison.
   *
   * @param steps - Steps to normalize
   * @returns Normalized pattern
   */
  normalizePattern(steps: WorkflowStep[]): NormalizedPattern {
    const sequence = steps.map((s) => s.action);
    const context = steps.map((s) => s.target || '');
    const durations = steps.map((s) => s.duration || 0);
    const durationsSorted = durations.sort((a, b) => a - b);

    return {
      sequence,
      context,
      durationRange: [durationsSorted[0] || 0, durationsSorted[durationsSorted.length - 1] || 0],
      actionTypes: [...new Set(steps.map((s) => s.action))],
    };
  }

  /**
   * Calculates similarity between two normalized patterns.
   *
   * @param pattern1 - First normalized pattern
   * @param pattern2 - Second normalized pattern
   * @returns Similarity score (0..1)
   */
  calculatePatternSimilarity(pattern1: NormalizedPattern, pattern2: NormalizedPattern): number {
    // Action sequence similarity (Jaccard)
    const actionSet1 = new Set(pattern1.sequence);
    const actionSet2 = new Set(pattern2.sequence);
    const actionIntersection = [...actionSet1].filter((x) => actionSet2.has(x)).length;
    const actionUnion = new Set([...actionSet1, ...actionSet2]).size;
    const jaccardActions = actionUnion > 0 ? actionIntersection / actionUnion : 0;

    // Context similarity (Jaccard)
    const contextSet1 = new Set(pattern1.context);
    const contextSet2 = new Set(pattern2.context);
    const contextIntersection = [...contextSet1].filter((x) => contextSet2.has(x)).length;
    const contextUnion = new Set([...contextSet1, ...contextSet2]).size;
    const jaccardContext = contextUnion > 0 ? contextIntersection / contextUnion : 0;

    // Action type overlap
    const actionTypeOverlap = pattern1.actionTypes.filter((x) => pattern2.actionTypes.includes(x)).length;
    const actionTypeUnion = new Set([...pattern1.actionTypes, ...pattern2.actionTypes]).size;
    const actionTypeSimilarity = actionTypeUnion > 0 ? actionTypeOverlap / actionTypeUnion : 0;

    // Duration similarity
    const durationSimilarity = 1 - Math.abs(
      pattern1.durationRange[0] - pattern2.durationRange[0] +
      pattern1.durationRange[1] - pattern2.durationRange[1]
    ) / (pattern1.durationRange[1] + pattern2.durationRange[1] || 1);

    // Combined similarity
    return (jaccardActions * 0.3) + (jaccardContext * 0.3) + (actionTypeSimilarity * 0.2) + (durationSimilarity * 0.2);
  }

  /**
   * Finds the longest common subsequence between two sequences.
   *
   * @param seq1 - First sequence
   * @param seq2 - Second sequence
   * @returns LCS length
   */
  longestCommonSubsequence(seq1: WorkflowStep[], seq2: WorkflowStep[]): number {
    const m = seq1.length;
    const n = seq2.length;

    // Create DP table
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (seq1[i - 1].action === seq2[j - 1].action) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Detects duplicate patterns based on normalization.
   *
   * @param patterns - Patterns to check
   * @returns Array of unique patterns
   */
  deduplicatePatterns(patterns: DetectedPattern[]): DetectedPattern[] {
    const uniquePatterns: DetectedPattern[] = [];
    const seenSignatures = new Set<string>();

    for (const pattern of patterns) {
      const normalized = this.normalizePattern(pattern.steps);
      const signature = this.normalizePatternToKey(normalized);

      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        uniquePatterns.push(pattern);
      }
    }

    return uniquePatterns;
  }

  /**
   * Converts a normalized pattern to a key for deduplication.
   *
   * @param pattern - Normalized pattern
   * @returns Unique key
   */
  private normalizePatternToKey(pattern: NormalizedPattern): string {
    return JSON.stringify({
      sequence: pattern.sequence.join('|'),
      context: pattern.context.sort().join('|'),
      actionTypes: pattern.actionTypes.sort().join('|'),
    });
  }

  /**
   * Calculates Jaccard similarity between two sets.
   *
   * @param set1 - First set
   * @param set2 - Second set
   * @returns Jaccard similarity (0..1)
   */
  jaccardSimilarity<T>(set1: Set<T>, set2: Set<T>): number {
    const intersection = [...set1].filter((x) => set2.has(x)).length;
    const union = new Set([...set1, ...set2]).size;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Analyzes patterns across multiple workflow executions.
   *
   * @param workflowId - Base workflow ID
   * @param allExecutions - All executions to analyze
   * @returns Detected patterns across all executions
   */
  analyzeAcrossExecutions(
    workflowId: string,
    allExecutions: WorkflowStep[][]
  ): DetectedPattern[] {
    // Flatten all executions
    const allSteps: WorkflowStep[] = [];
    const stepToExecution: number[] = [];

    allExecutions.forEach((execution, execIndex) => {
      execution.forEach((step, stepIndex) => {
        allSteps.push({ ...step, index: allSteps.length });
        stepToExecution.push(execIndex);
      });
    });

    // Detect patterns in combined data
    return this.detectPatterns(workflowId, allSteps);
  }

  /**
   * Creates a subsequence from a larger sequence.
   *
   * @param steps - Full sequence
   * @param startIndex - Start index
   * @param endIndex - End index
   * @returns Subsequence
   */
  extractSubsequence(steps: WorkflowStep[], startIndex: number, endIndex: number): WorkflowStep[] {
    return steps.slice(startIndex, endIndex + 1);
  }

  /**
   * Identifies the most common action types in a sequence.
   *
   * @param steps - Steps to analyze
   * @returns Array of action types sorted by frequency
   */
  commonActionTypes(steps: WorkflowStep[]): string[] {
    const frequency: Record<string, number> = {};

    for (const step of steps) {
      frequency[step.action] = (frequency[step.action] || 0) + 1;
    }

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .map(([action]) => action);
  }

  /**
   * Identifies common element selectors in a sequence.
   *
   * @param steps - Steps to analyze
   * @returns Array of selectors sorted by frequency
   */
  commonSelectors(steps: WorkflowStep[]): string[] {
    const frequency: Record<string, number> = {};

    for (const step of steps) {
      if (step.target) {
        frequency[step.target] = (frequency[step.target] || 0) + 1;
      }
    }

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .map(([selector]) => selector);
  }

  /**
   * Calculates the average duration for a specific action type.
   *
   * @param steps - Steps to analyze
   * @param actionType - Action type to average
   * @returns Average duration in milliseconds
   */
  averageDurationForAction(steps: WorkflowStep[], actionType: string): number {
    const relevantSteps = steps.filter((s) => s.action === actionType);
    
    if (relevantSteps.length === 0) {
      return 0;
    }

    return relevantSteps.reduce((sum, s) => sum + (s.duration || 0), 0) / relevantSteps.length;
  }

  /**
   * Finds gaps in a sequence that might indicate pauses or context changes.
   *
   * @param steps - Steps to analyze
   * @param gapThresholdMs - Threshold for considering a gap significant
   * @returns Array of gap information
   */
  findGaps(steps: WorkflowStep[], gapThresholdMs: number = 2000): GapInfo[] {
    const gaps: GapInfo[] = [];

    for (let i = 1; i < steps.length; i++) {
      const prevStep = steps[i - 1];
      const currStep = steps[i];
      const gap = currStep.timestamp - (prevStep.timestamp + (prevStep.duration || 0));

      if (gap >= gapThresholdMs) {
        gaps.push({
          startIndex: i - 1,
          endIndex: i,
          gapMs: gap,
          prevAction: prevStep.action,
          currAction: currStep.action,
        });
      }
    }

    return gaps;
  }

  /**
   * Identifies branches in workflow execution (conditional paths).
   *
   * @param steps - Steps to analyze
   * @param context - Context information
   * @returns Array of identified branches
   */
  findBranches(steps: WorkflowStep[], context: Record<string, unknown> = {}): BranchInfo[] {
    const branches: BranchInfo[] = [];

    // Look for patterns that might indicate conditional branches
    // (e.g., actions that differ based on element state)

    const groupedByTarget = new Map<string, WorkflowStep[]>();

    for (const step of steps) {
      if (step.target) {
        if (!groupedByTarget.has(step.target)) {
          groupedByTarget.set(step.target, []);
        }
        groupedByTarget.get(step.target)?.push(step);
      }
    }

    for (const [target, targetSteps] of groupedByTarget) {
      if (targetSteps.length > 1) {
        // Check if there are different actions for the same target
        const actionTypes = new Set(targetSteps.map((s) => s.action));

        if (actionTypes.size > 1) {
          branches.push({
            target,
            branches: Array.from(actionTypes),
            frequency: targetSteps.length,
          });
        }
      }
    }

    return branches;
  }
}

// ============================================================================
// Helper Interfaces
// ============================================================================

interface ActionSequenceStats {
  startIndex: number;
  endIndex: number;
  steps: WorkflowStep[];
  frequency: number;
  successCount: number;
  failureCount: number;
  totalTime: number;
}

interface GapInfo {
  startIndex: number;
  endIndex: number;
  gapMs: number;
  prevAction: string;
  currAction: string;
}

interface BranchInfo {
  target: string;
  branches: string[];
  frequency: number;
}
