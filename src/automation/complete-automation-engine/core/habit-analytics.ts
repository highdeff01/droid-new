/**
 * Habit Analytics and Diagnostics System
 *
 * Provides comprehensive analysis capabilities for learned automation habits:
 * - Human-readable habit descriptions
 * - Confidence explanation with breakdown
 * - Habit execution trends over time
 * - Improvement suggestions for low-confidence habits
 * - Detailed execution history analysis
 *
 * This module enables users to understand their habits better and improve
 * automation effectiveness through actionable insights.
 */

import type {
  Habit,
  HabitPattern,
  HabitFeedback,
  HabitVariant,
  ConfidenceScores,
  HabitExecutionRecord,
  ConditionType,
} from '../habit-types';
import { calculateOverallConfidence } from '../habit-types';

// ============================================================================
// ANALYSIS RESULT TYPES
// ============================================================================

/**
 * Comprehensive habit analytics result including all analysis components.
 */
export interface HabitAnalyticsResult {
  /** Human-readable description of what the habit does */
  description: string;

  /** Confidence explanation with detailed breakdown */
  confidenceExplanation: string;

  /** Confidence breakdown showing component scores */
  confidenceBreakdown: ConfidenceBreakdown;

  /** Execution trend over time ('improving', 'stable', or 'declining') */
  trend: 'improving' | 'stable' | 'declining';

  /** Trend history for visualization */
  trendHistory: TrendPoint[];

  /** List of actionable improvement suggestions */
  improvementSuggestions: string[];

  /** Execution summary statistics */
  executionSummary: ExecutionSummary;

  /** Context match analysis */
  contextAnalysis: ContextAnalysis;

  /** Variant analysis (if variants exist) */
  variantAnalysis?: VariantAnalysis;
}

/**
 * Detailed breakdown of confidence scores showing the components
 * that contribute to the overall confidence rating.
 */
export interface ConfidenceBreakdown {
  /** Overall confidence (0..100) */
  overall: number;

  /** Success rate component (0..100) */
  success: number;

  /** Frequency component (0..100) */
  frequency: number;

  /** Recency component (0..100) */
  recency: number;

  /** Feedback component (0..100) */
  feedback: number;

  /** Weight applied to each component (sum = 100%) */
  weights: {
    success: number;
    frequency: number;
    recency: number;
    feedback: number;
  };

  /** Date when confidence was last calculated */
  lastCalculatedAt: string;
}

/**
 * Summary of execution statistics for a habit.
 */
export interface ExecutionSummary {
  /** Total number of executions */
  totalExecutions: number;

  /** Number of successful executions */
  successCount: number;

  /** Number of failed executions */
  failureCount: number;

  /** Success rate as percentage */
  successRate: number;

  /** Average duration per execution in milliseconds */
  averageDuration?: number;

  /** Minimum duration recorded */
  minDuration?: number;

  /** Maximum duration recorded */
  maxDuration?: number;

  /** Frequency classification */
  frequencyClass: 'rare' | 'occasional' | 'frequent' | 'daily';

  /** Last execution timestamp (if any) */
  lastExecutionAt?: string;

  /** Days since last execution (if any) */
  daysSinceLastExecution?: number;
}

/**
 * Analysis of context matching capabilities.
 */
export interface ContextAnalysis {
  /** Whether the habit has context requirements */
  hasContextRequirements: boolean;

  /** Type of context conditions defined */
  conditionTypes: ConditionType[];

  /** URL patterns (if any) */
  urlPatterns?: string[];

  /** Title patterns (if any) */
  titlePatterns?: string[];

  /** Context match score (0..100) */
  contextMatchScore?: number;

  /** Whether current context would match this habit */
  wouldMatchCurrentContext?: boolean;
}

/**
 * Analysis of habit variants (alternative execution patterns).
 */
export interface VariantAnalysis {
  /** Total number of variants */
  count: number;

  /** Average confidence across all variants */
  averageConfidence: number;

  /** Most successful variant */
  topVariant?: {
    id: string;
    name: string;
    confidence: number;
    executionCount: number;
  };

  /** Variant with most execution history */
  mostTestedVariant?: {
    id: string;
    name: string;
    executionCount: number;
    successRate: number;
  };
}

/**
 * Single point in the trend history for visualization.
 */
export interface TrendPoint {
  /** ISO 8601 timestamp for this data point */
  timestamp: string;

  /** Confidence score at this point */
  confidence: number;

  /** Number of executions at this point */
  executionCount: number;

  /** Execution result (success or failure) */
  result?: 'success' | 'failure';

  /** Moving average confidence at this point (for smoother trend lines) */
  movingAverage?: number;
}

// ============================================================================
// TREND AND HISTORY TYPES
// ============================================================================

/**
 * Historical execution record for trend analysis.
 */
interface HistoricalExecution {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** Success or failure */
  success: boolean;

  /** Confidence score after this execution */
  confidenceAfter: number;
}

/**
 * Trend history for visualization.
 */
interface TrendHistory {
  /** Data points over time */
  points: TrendPoint[];

  /** Overall trend direction */
  direction: 'improving' | 'stable' | 'declining';

  /** Slope of the trend line */
  slope: number;
}

// ============================================================================
// IMPROVEMENT SUGGESTIONS
// ============================================================================

/**
 * Structure for improvement suggestion data.
 */
interface ImprovementSuggestionData {
  /** The suggestion text */
  text: string;

  /** Category of improvement */
  category: 'context' | 'execution' | 'feedback' | 'pattern' | 'confidence';

  /** Priority level */
  priority: 'high' | 'medium' | 'low';

  /** Confidence threshold this suggestion relates to */
  confidenceThreshold: number;
}

/**
 * Default improvement suggestions based on common patterns.
 */
const IMPROVEMENT_SUGGESTIONS: Record<string, ImprovementSuggestionData> = {
  contextTooBroad: {
    text: 'Consider narrowing context requirements for better targeting.',
    category: 'context',
    priority: 'medium',
    confidenceThreshold: 70,
  },
  lowSuccessRate: {
    text: 'Focus on improving success rate through better element selectors or workflow optimization.',
    category: 'execution',
    priority: 'high',
    confidenceThreshold: 50,
  },
  infrequentUse: {
    text: 'Use this habit more frequently to build confidence through additional practice.',
    category: 'pattern',
    priority: 'low',
    confidenceThreshold: 60,
  },
  noFeedback: {
    text: 'Provide explicit approval or rejection feedback when the habit succeeds or fails.',
    category: 'feedback',
    priority: 'medium',
    confidenceThreshold: 80,
  },
  decliningTrend: {
    text: 'Trend analysis shows declining confidence. Review recent failures and adjust the habit.',
    category: 'execution',
    priority: 'high',
    confidenceThreshold: 40,
  },
  missingVariants: {
    text: 'Consider creating variants for different contexts where this habit could apply.',
    category: 'pattern',
    priority: 'low',
    confidenceThreshold: 60,
  },
  inconsistentPerformance: {
    text: 'High variance in execution success suggests context-specific issues. Review failure patterns.',
    category: 'context',
    priority: 'high',
    confidenceThreshold: 60,
  },
  outdatedContext: {
    text: 'Last execution was a while ago. Re-test the habit with current application state.',
    category: 'execution',
    priority: 'medium',
    confidenceThreshold: 70,
  },
};

// ============================================================================
// HABIT ANALYTICS CLASS
// ============================================================================

/**
 * Provides analytics and diagnostics for automation habits.
 *
 * This class enables users to understand their habits better through
 * comprehensive analysis including descriptions, confidence breakdowns,
 * trend visualization, and actionable improvement suggestions.
 */
export class HabitAnalytics {
  /**
   * Generate a human-readable description of what the habit does.
   *
   * Uses pattern information, execution history, and metadata to create
   * a natural language description that explains the habit's purpose.
   *
   * @param habit - The habit to describe
   * @returns Human-readable description string
   *
   * @example
   * const habit = createHabit('Login to Email', { workflowId: 'login-workflow' });
   * const description = analytics.generateDescription(habit);
   * // Returns: "Login to Email - Automates email login workflow"
   */
  public generateDescription(habit: Habit): string {
    const parts: string[] = [];

    // Start with habit name
    parts.push(habit.name);

    // Add description if available
    if (habit.description) {
      parts.push(habit.description);
    }

    // Add pattern-based description
    const patternInfo = this.describePattern(habit.primaryPattern);
    if (patternInfo) {
      parts.push(patternInfo);
    }

    // Add execution context
    if (habit.totalExecutions > 0) {
      parts.push(`${habit.totalExecutions} executions`);
      if (habit.lastExecutedAt) {
        const daysAgo = this.daysSince(new Date(habit.lastExecutedAt));
        parts.push(`last used ${daysAgo} days ago`);
      }
    }

    // Add success rate
    if (habit.totalExecutions > 0) {
      const successRate = this.calculateSuccessRate(habit.successCount, habit.failureCount);
      parts.push(`${successRate}% success rate`);
    }

    return parts.join(' - ');
  }

  /**
   * Provide a detailed explanation of how confidence is calculated.
   *
   * Breaks down confidence into its component factors (success, frequency,
   * recency, feedback) and explains the current score and what could improve it.
   *
   * @param habit - The habit to explain
   * @returns Human-readable confidence explanation
   *
   * @example
   * const explanation = analytics.explainConfidence(habit);
   * // Returns: "Confidence: 75/100 (success: 80, frequency: 60, recency: 50, feedback: 90)"
   */
  public explainConfidence(habit: Habit): string {
    const breakdown = this.calculateConfidenceBreakdown(habit);
    const { success, frequency, recency, feedback, weights } = breakdown;

    // Build explanation with component details
    const lines: string[] = [];

    // Overall score
    lines.push(`Confidence: ${breakdown.overall}/100`);

    // Component breakdown
    lines.push(`- Success rate: ${success}/100 (weight: ${weights.success}%)`);
    lines.push(`- Usage frequency: ${frequency}/100 (weight: ${weights.frequency}%)`);
    lines.push(`- Recent activity: ${recency}/100 (weight: ${weights.recency}%)`);
    lines.push(`- User feedback: ${feedback}/100 (weight: ${weights.feedback}%)`);

    // Component analysis
    lines.push(...this.analyzeComponents(habit, breakdown));

    return lines.join('\n');
  }

  /**
   * Calculate the trend direction for a habit's confidence.
   *
   * Analyzes execution history to determine if confidence is improving,
   * stable, or declining over time.
   *
   * @param habit - The habit to analyze
   * @returns Trend classification: 'improving', 'stable', or 'declining'
   *
   * @example
   * const trend = analytics.calculateTrend(habit);
   * // Returns: 'improving' | 'stable' | 'declining'
   */
  public calculateTrend(habit: Habit): 'improving' | 'stable' | 'declining' {
    // Get trend history for the last 30 days
    const history = this.calculateTrendHistory(habit, 30);

    if (history.points.length < 2) {
      return 'stable';
    }

    // Calculate slope of the trend line
    const slope = this.calculateSlope(history.points);

    // Determine trend based on slope
    if (slope > 0.5) {
      return 'improving';
    } else if (slope < -0.5) {
      return 'declining';
    } else {
      return 'stable';
    }
  }

  /**
   * Get trend history data for visualization.
   *
   * Returns an array of trend points showing confidence changes over time,
   * suitable for charting and trend analysis.
   *
   * @param habit - The habit to analyze
   * @param windowDays - Number of days to include in history (default: 30)
   * @returns Array of trend data points
   *
   * @example
   * const history = analytics.getTrendHistory(habit, 60);
   * // Returns: [{ timestamp, confidence, executionCount }, ...]
   */
  public getTrendHistory(habit: Habit, windowDays: number = 30): TrendPoint[] {
    return this.calculateTrendHistory(habit, windowDays).points;
  }

  /**
   * Generate actionable improvement suggestions for low-confidence habits.
   *
   * Analyzes the habit's confidence components, execution history, and
   * context to provide specific, actionable recommendations.
   *
   * @param habit - The habit to analyze
   * @returns Array of improvement suggestion strings
   *
   * @example
   * const suggestions = analytics.suggestImprovements(habit);
   * // Returns: ['Focus on improving success rate...', 'Use more frequently...']
   */
  public suggestImprovements(habit: Habit): string[] {
    const suggestions: string[] = [];
    const breakdown = this.calculateConfidenceBreakdown(habit);
    const executionSummary = this.calculateExecutionSummary(habit);

    // Check for low overall confidence
    if (breakdown.overall < 70) {
      suggestions.push(
        IMPROVEMENT_SUGGESTIONS.lowSuccessRate.text,
        IMPROVEMENT_SUGGESTIONS.inconsistentPerformance.text
      );
    }

    // Check each component
    if (breakdown.success < 60) {
      suggestions.push(IMPROVEMENT_SUGGESTIONS.lowSuccessRate.text);
    }

    if (breakdown.frequency < 50) {
      suggestions.push(IMPROVEMENT_SUGGESTIONS.infrequentUse.text);
    }

    if (breakdown.recency < 60) {
      suggestions.push(IMPROVEMENT_SUGGESTIONS.outdatedContext.text);
    }

    if (!habit.feedback || habit.feedback.length === 0) {
      suggestions.push(IMPROVEMENT_SUGGESTIONS.noFeedback.text);
    }

    // Check for declining trend
    if (this.calculateTrend(habit) === 'declining') {
      suggestions.push(IMPROVEMENT_SUGGESTIONS.decliningTrend.text);
    }

    // Check for context issues
    if (habit.primaryPattern.context) {
      const contextAnalysis = this.analyzeContext(habit);
      if (!contextAnalysis.wouldMatchCurrentContext) {
        suggestions.push(IMPROVEMENT_SUGGESTIONS.contextTooBroad.text);
      }
    }

    // Check for missing variants
    if (!habit.variants || habit.variants.length === 0) {
      suggestions.push(IMPROVEMENT_SUGGESTIONS.missingVariants.text);
    }

    // Deduplicate and return
    return [...new Set(suggestions)];
  }

  /**
   * Perform comprehensive analysis of a habit.
   *
   * Combines all analytics capabilities into a single result object
   * for complete habit diagnostics.
   *
   * @param habit - The habit to analyze
   * @returns Complete analysis result with all components
   *
   * @example
   * const analysis = analytics.analyzeExecutionHistory(habit);
   * console.log(analysis.description);
   * console.log(analysis.confidenceExplanation);
   * console.log(analysis.improvementSuggestions);
   */
  public analyzeExecutionHistory(habit: Habit): HabitAnalyticsResult {
    const breakdown = this.calculateConfidenceBreakdown(habit);
    const executionSummary = this.calculateExecutionSummary(habit);
    const contextAnalysis = this.analyzeContext(habit);
    const variantAnalysis = this.analyzeVariants(habit);

    return {
      description: this.generateDescription(habit),
      confidenceExplanation: this.explainConfidence(habit),
      confidenceBreakdown: breakdown,
      trend: this.calculateTrend(habit),
      trendHistory: this.getTrendHistory(habit, 30),
      improvementSuggestions: this.suggestImprovements(habit),
      executionSummary,
      contextAnalysis,
      variantAnalysis: variantAnalysis || undefined,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Describe the habit's pattern in natural language.
   */
  private describePattern(pattern: HabitPattern): string {
    const parts: string[] = [];

    if (pattern.workflowId) {
      parts.push(`automates workflow #${pattern.workflowId}`);
    } else if (pattern.packId) {
      parts.push(`part of pack #${pattern.packId}`);
    }

    if (pattern.context) {
      if (pattern.context.url) {
        parts.push(`matches URL pattern: ${pattern.context.url}`);
      }
      if (pattern.context.title) {
        parts.push(`with title: ${pattern.context.title}`);
      }
    }

    if (pattern.frequency) {
      parts.push(`frequency: ${pattern.frequency}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'no specific pattern defined';
  }

  /**
   * Calculate confidence breakdown from habit data.
   */
  private calculateConfidenceBreakdown(habit: Habit): ConfidenceBreakdown {
    const scores = habit.confidence;
    
    // Handle zero scores correctly
    const overall = calculateOverallConfidence(scores);

    return {
      overall,
      success: scores.success,
      frequency: scores.frequency,
      recency: scores.recency,
      feedback: scores.feedback,
      weights: {
        success: 50,
        frequency: 20,
        recency: 20,
        feedback: 10,
      },
      lastCalculatedAt: scores.decayedAt || scores.lastDecayAt || new Date().toISOString(),
    };
  }

  /**
   * Analyze confidence components and generate insights.
   */
  private analyzeComponents(habit: Habit, breakdown: ConfidenceBreakdown): string[] {
    const insights: string[] = [];

    // Success rate analysis
    if (breakdown.success < 50) {
      insights.push('Success rate is below 50% - requires improvement');
    } else if (breakdown.success < 80) {
      insights.push('Success rate needs improvement for reliable automation');
    } else {
      insights.push('Success rate is healthy');
    }

    // Frequency analysis
    if (breakdown.frequency < 30) {
      insights.push('Usage frequency is low - needs more practice');
    } else if (breakdown.frequency < 70) {
      insights.push('Usage frequency is moderate');
    } else {
      insights.push('Usage frequency is strong');
    }

    // Recency analysis
    if (breakdown.recency < 40) {
      insights.push('Not used recently - may need re-testing');
    } else if (breakdown.recency < 80) {
      insights.push('Used with reasonable frequency');
    } else {
      insights.push('Actively used recently');
    }

    // Feedback analysis
    if (breakdown.feedback < 60) {
      insights.push('User feedback is limited - provide more explicit feedback');
    } else {
      insights.push('Good feedback history');
    }

    return insights;
  }

  /**
   * Calculate trend history for visualization.
   */
  private calculateTrendHistory(habit: Habit, windowDays: number): TrendHistory {
    const points: TrendPoint[] = [];
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

    // Start with initial confidence
    let currentConfidence = habit.confidence.overall;
    let currentExecutionCount = 0;

    // Create initial point at window start
    points.push({
      timestamp: windowStart.toISOString(),
      confidence: currentConfidence,
      executionCount: currentExecutionCount,
    });

    // Calculate confidence changes at regular intervals
    const intervalDays = Math.max(1, Math.floor(windowDays / 10)); // 10 points max
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;

    for (let daysAgo = intervalDays; daysAgo <= windowDays; daysAgo += intervalDays) {
      const pointDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      // Estimate confidence based on time and executions
      // In a real system, this would use actual historical execution records
      const daysSinceLastExec = habit.lastExecutedAt
        ? (now.getTime() - new Date(habit.lastExecutedAt).getTime()) / (24 * 60 * 60 * 1000)
        : daysAgo;

      // Apply decay to estimate past confidence
      const decayFactor = Math.pow(0.5, daysSinceLastExec / 30);
      currentConfidence = habit.confidence.overall * decayFactor;
      currentExecutionCount = Math.floor(habit.totalExecutions * (daysAgo / windowDays));

      points.push({
        timestamp: pointDate.toISOString(),
        confidence: Math.round(currentConfidence),
        executionCount: currentExecutionCount,
      });
    }

    // Add final point at current time
    points.push({
      timestamp: now.toISOString(),
      confidence: habit.confidence.overall,
      executionCount: habit.totalExecutions,
    });

    // Calculate trend direction
    const slope = this.calculateSlope(points);
    let direction: TrendHistory['direction'] = 'stable';
    if (slope > 0.5) {
      direction = 'improving';
    } else if (slope < -0.5) {
      direction = 'declining';
    }

    // Calculate moving averages for smoother trend lines
    for (let i = 2; i < points.length; i++) {
      const window = points.slice(i - 2, i + 1);
      const avg = window.reduce((sum, p) => sum + p.confidence, 0) / window.length;
      points[i].movingAverage = Math.round(avg);
    }

    return { points, direction, slope };
  }

  /**
   * Calculate slope of a trend line using least squares.
   */
  private calculateSlope(points: TrendPoint[]): number {
    if (points.length < 2) {
      return 0;
    }

    const n = points.length;
    const sumX = points.reduce((sum, _, i) => sum + i, 0);
    const sumY = points.reduce((sum, p) => sum + p.confidence, 0);
    const sumXY = points.reduce((sum, p, i) => sum + i * p.confidence, 0);
    const sumXX = points.reduce((sum, _, i) => sum + i * i, 0);

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) {
      return 0;
    }

    return (n * sumXY - sumX * sumY) / denominator;
  }

  /**
   * Calculate execution summary statistics.
   */
  private calculateExecutionSummary(habit: Habit): ExecutionSummary {
    const successRate = this.calculateSuccessRate(habit.successCount, habit.failureCount);
    const frequencyClass = this.classifyFrequency(habit.totalExecutions);

    return {
      totalExecutions: habit.totalExecutions,
      successCount: habit.successCount,
      failureCount: habit.failureCount,
      successRate,
      frequencyClass,
      lastExecutionAt: habit.lastExecutedAt,
      daysSinceLastExecution: habit.lastExecutedAt ? this.daysSince(new Date(habit.lastExecutedAt)) : undefined,
    };
  }

  /**
   * Analyze habit context requirements.
   */
  private analyzeContext(habit: Habit): ContextAnalysis {
    const context = habit.primaryPattern.context;
    const hasContext = !!context;

    const conditionTypes: ConditionType[] = [];
    if (context?.url) conditionTypes.push('context-match');
    if (context?.title) conditionTypes.push('context-match');

    return {
      hasContextRequirements: hasContext,
      conditionTypes,
      urlPatterns: context?.url ? [context.url] : undefined,
      titlePatterns: context?.title ? [context.title] : undefined,
      wouldMatchCurrentContext: true, // Would need actual current context to evaluate
    };
  }

  /**
   * Analyze habit variants.
   */
  private analyzeVariants(habit: Habit): VariantAnalysis | undefined {
    if (!habit.variants || habit.variants.length === 0) {
      return undefined;
    }

    const variants = habit.variants;
    const totalConfidence = variants.reduce((sum, v) => sum + v.confidence.overall, 0);
    const averageConfidence = totalConfidence / variants.length;

    // Find top variant
    let topVariant: VariantAnalysis['topVariant'];
    let mostTested: VariantAnalysis['mostTestedVariant'] | undefined;

    for (const variant of variants) {
      if (!topVariant || variant.confidence.overall > topVariant.confidence) {
        topVariant = {
          id: variant.id,
          name: variant.name,
          confidence: variant.confidence.overall,
          executionCount: variant.executionCount,
        };
      }

      if (!mostTested || variant.executionCount > mostTested.executionCount) {
        mostTested = {
          id: variant.id,
          name: variant.name,
          executionCount: variant.executionCount,
          successRate: this.calculateSuccessRate(variant.successCount, variant.failureCount),
        };
      }
    }

    return {
      count: variants.length,
      averageConfidence: Math.round(averageConfidence),
      topVariant,
      mostTestedVariant: mostTested,
    };
  }

  /**
   * Calculate success rate from counts.
   */
  private calculateSuccessRate(successCount: number, failureCount: number): number {
    if (successCount + failureCount === 0) {
      return 0;
    }
    return (successCount / (successCount + failureCount)) * 100;
  }

  /**
   * Classify execution frequency.
   */
  private classifyFrequency(executionCount: number): ExecutionSummary['frequencyClass'] {
    if (executionCount <= 2) return 'rare';
    if (executionCount <= 5) return 'occasional';
    if (executionCount <= 10) return 'frequent';
    return 'daily';
  }

  /**
   * Calculate days since a date.
   */
  private daysSince(date: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.round(diffMs / (24 * 60 * 60 * 1000));
  }
}

// ============================================================================
// EXPORTS FOR TESTING
// ============================================================================

export {
  IMPROVEMENT_SUGGESTIONS,
  IMPROVEMENT_SUGGESTIONS as DEFAULT_IMPROVEMENT_SUGGESTIONS,
};