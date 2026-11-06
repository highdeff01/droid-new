/**
 * Habit User Feedback Handling
 * Records and processes user feedback about habit suggestions,
 * updating confidence scores based on real-world acceptance and corrections.
 * 
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import type { Habit, HabitId } from './habit-extraction.js';

/**
 * Types of user feedback about habit suggestions.
 */
export type FeedbackType = 'accepted' | 'dismissed' | 'corrected' | 'failed' | 'reported_issue';

/**
 * Severity of an issue reported about a habit.
 */
export type IssueSeverity = 'minor' | 'major' | 'critical';

/**
 * User feedback about a habit suggestion or execution.
 */
export interface HabitFeedback {
  id: string;
  habitId: HabitId;
  type: FeedbackType;
  timestamp: number;
  
  // For all types
  userId?: string;  // Optional user identifier
  context?: string;  // Where/when this happened
  notes?: string;  // User comments
  
  // For accepted/dismissed
  confidence?: number;  // User's estimate of habit reliability (0..1)
  
  // For corrected
  correctionDetails?: {
    stepIndex?: number;  // Which step was corrected
    what?: string;  // What needed correction
    correction?: string;  // What was corrected to
  };
  
  // For failed
  failureReason?: string;  // Why execution failed
  
  // For reported_issue
  issueSeverity?: IssueSeverity;
  issueTitle?: string;
  issueDescription?: string;
  stepsToReproduce?: string[];
}

/**
 * Aggregated feedback statistics for a habit.
 */
export interface HabitFeedbackStats {
  habitId: HabitId;
  totalFeedback: number;
  acceptedCount: number;
  dismissedCount: number;
  correctedCount: number;
  failedCount: number;
  issuesReportedCount: number;
  
  // Percentages
  acceptanceRate: number;  // accepted / (accepted + dismissed)
  correctionRate: number;  // corrected / (accepted + dismissed + corrected)
  failureRate: number;  // failed / total executable attempts
  
  // Time-based
  averageAcceptanceTime?: number;  // ms from suggestion to acceptance
  lastFeedbackTime: number;
  
  // Quality metrics
  avgUserConfidenceRating: number;  // 0..1, from confident users
}

/**
 * Feedback collection for a habit.
 */
export interface HabitFeedbackHistory {
  habitId: HabitId;
  feedbackList: HabitFeedback[];
  stats: HabitFeedbackStats;
  lastUpdated: number;
}

/**
 * Feedback event for real-time processing.
 */
export interface FeedbackEvent {
  habitId: HabitId;
  type: FeedbackType;
  timestamp: number;
  impact: 'positive' | 'negative' | 'neutral';  // Expected impact on confidence
}

/**
 * Records user acceptance of a habit suggestion.
 * 
 * @param habitId - Habit that was accepted
 * @param userId - User who accepted
 * @param context - Where suggestion was accepted
 * @param userConfidence - User's confidence estimate (0..1)
 * @returns Feedback record
 */
export function recordAcceptance(
  habitId: HabitId,
  userId?: string,
  context?: string,
  userConfidence: number = 0.5
): HabitFeedback {
  return {
    id: `fb-${habitId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    habitId,
    type: 'accepted',
    timestamp: Date.now(),
    userId,
    context,
    confidence: Math.max(0, Math.min(1, userConfidence)),
  };
}

/**
 * Records user dismissal of a habit suggestion.
 * 
 * @param habitId - Habit that was dismissed
 * @param userId - User who dismissed
 * @param reason - Why it was dismissed
 * @returns Feedback record
 */
export function recordDismissal(
  habitId: HabitId,
  userId?: string,
  reason?: string
): HabitFeedback {
  return {
    id: `fb-${habitId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    habitId,
    type: 'dismissed',
    timestamp: Date.now(),
    userId,
    notes: reason,
  };
}

/**
 * Records user correction to a habit's actions.
 * 
 * @param habitId - Habit that was corrected
 * @param stepIndex - Which step was corrected
 * @param what - What was wrong
 * @param correction - What it should be
 * @param userId - User who made correction
 * @returns Feedback record
 */
export function recordCorrection(
  habitId: HabitId,
  stepIndex: number,
  what: string,
  correction: string,
  userId?: string
): HabitFeedback {
  return {
    id: `fb-${habitId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    habitId,
    type: 'corrected',
    timestamp: Date.now(),
    userId,
    correctionDetails: {
      stepIndex,
      what,
      correction,
    },
  };
}

/**
 * Records habit execution failure.
 * 
 * @param habitId - Habit that failed
 * @param reason - Why it failed
 * @param userId - User affected
 * @returns Feedback record
 */
export function recordFailure(
  habitId: HabitId,
  reason: string,
  userId?: string
): HabitFeedback {
  return {
    id: `fb-${habitId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    habitId,
    type: 'failed',
    timestamp: Date.now(),
    userId,
    failureReason: reason,
  };
}

/**
 * Records user-reported issue with a habit.
 * 
 * @param habitId - Habit with issue
 * @param title - Issue title
 * @param description - Detailed description
 * @param severity - Issue severity
 * @param userId - User reporting
 * @returns Feedback record
 */
export function recordIssue(
  habitId: HabitId,
  title: string,
  description: string,
  severity: IssueSeverity = 'major',
  userId?: string
): HabitFeedback {
  return {
    id: `fb-${habitId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    habitId,
    type: 'reported_issue',
    timestamp: Date.now(),
    userId,
    issueSeverity: severity,
    issueTitle: title,
    issueDescription: description,
  };
}

/**
 * Calculates aggregated feedback statistics.
 * 
 * @param feedbackList - List of feedback entries
 * @param habitId - Habit ID
 * @returns Aggregated statistics
 */
export function calculateFeedbackStats(
  feedbackList: HabitFeedback[],
  habitId: HabitId
): HabitFeedbackStats {
  if (feedbackList.length === 0) {
    return {
      habitId,
      totalFeedback: 0,
      acceptedCount: 0,
      dismissedCount: 0,
      correctedCount: 0,
      failedCount: 0,
      issuesReportedCount: 0,
      acceptanceRate: 0,
      correctionRate: 0,
      failureRate: 0,
      lastFeedbackTime: 0,
      avgUserConfidenceRating: 0.5,
    };
  }

  // Count by type
  const accepted = feedbackList.filter((f) => f.type === 'accepted').length;
  const dismissed = feedbackList.filter((f) => f.type === 'dismissed').length;
  const corrected = feedbackList.filter((f) => f.type === 'corrected').length;
  const failed = feedbackList.filter((f) => f.type === 'failed').length;
  const issues = feedbackList.filter((f) => f.type === 'reported_issue').length;

  // Calculate rates
  const suggestable = accepted + dismissed + corrected;
  const acceptanceRate = suggestable > 0 ? accepted / suggestable : 0;
  const correctionRate = suggestable > 0 ? corrected / suggestable : 0;
  const executable = accepted + failed;
  const failureRate = executable > 0 ? failed / executable : 0;

  // Calculate average user confidence from confident users
  const confidenceRatings = feedbackList
    .filter((f) => f.confidence !== undefined)
    .map((f) => f.confidence!);
  const avgUserConfidence = confidenceRatings.length > 0
    ? confidenceRatings.reduce((a, b) => a + b, 0) / confidenceRatings.length
    : 0.5;

  return {
    habitId,
    totalFeedback: feedbackList.length,
    acceptedCount: accepted,
    dismissedCount: dismissed,
    correctedCount: corrected,
    failedCount: failed,
    issuesReportedCount: issues,
    acceptanceRate,
    correctionRate,
    failureRate,
    lastFeedbackTime: Math.max(...feedbackList.map((f) => f.timestamp)),
    avgUserConfidenceRating: avgUserConfidence,
  };
}

/**
 * Updates habit confidence based on feedback.
 * Applies a delta based on feedback type and accumulation.
 * 
 * @param habit - Habit to update
 * @param stats - Feedback statistics
 * @returns Updated habit
 */
export function updateHabitFromFeedback(habit: Habit, stats: HabitFeedbackStats): Habit {
  // Calculate feedback impact on confidence
  let feedbackDelta = 0;

  // Positive impact: acceptances and user confidence ratings
  if (stats.acceptanceRate > 0.7) {
    feedbackDelta += 0.1;  // Strong positive signal
  } else if (stats.acceptanceRate > 0.5) {
    feedbackDelta += 0.05;  // Slight positive
  }

  // Negative impact: dismissals, corrections, failures
  if (stats.correctionRate > 0.3) {
    feedbackDelta -= 0.15;  // Users had to fix it often
  }
  if (stats.failureRate > 0.2) {
    feedbackDelta -= 0.1;  // Habit fails often during execution
  }

  // User confidence influence
  if (stats.avgUserConfidenceRating > 0.7) {
    feedbackDelta += 0.05;
  }

  // Apply delta with damping
  const newFeedbackScore = Math.max(0, Math.min(1, habit.feedbackScore + feedbackDelta * 0.1));

  return {
    ...habit,
    feedbackScore: newFeedbackScore,
    timesSuggested: (habit.timesSuggested || 0) + stats.acceptedCount + stats.dismissedCount,
    timesAccepted: (habit.timesAccepted || 0) + stats.acceptedCount,
    timesDismissed: (habit.timesDismissed || 0) + stats.dismissedCount,
    timesCorrectRd: (habit.timesCorrectRd || 0) + stats.correctedCount,
  };
}

/**
 * Detects problems in feedback patterns.
 * Flags habits that may need attention.
 * 
 * @param stats - Feedback statistics
 * @returns Array of detected problems
 */
export function detectFeedbackProblems(stats: HabitFeedbackStats): string[] {
  const problems: string[] = [];

  if (stats.totalFeedback < 3) {
    return problems;  // Not enough data
  }

  if (stats.acceptanceRate < 0.3 && stats.acceptedCount >= 5) {
    problems.push('Low acceptance rate - users dismiss this habit frequently');
  }

  if (stats.correctionRate > 0.4) {
    problems.push('High correction rate - users often have to fix this habit');
  }

  if (stats.failureRate > 0.5) {
    problems.push('High failure rate - this habit fails during execution');
  }

  if (stats.issuesReportedCount > 0) {
    problems.push(`${stats.issuesReportedCount} issues reported by users`);
  }

  return problems;
}

/**
 * Suggests improvements for a habit based on feedback.
 * 
 * @param stats - Feedback statistics
 * @param feedbackList - Raw feedback
 * @returns Suggestions for improvement
 */
export function suggestImprovements(
  stats: HabitFeedbackStats,
  feedbackList: HabitFeedback[]
): string[] {
  const suggestions: string[] = [];

  // Analyze corrections
  const corrections = feedbackList.filter((f) => f.type === 'corrected');
  if (corrections.length >= 2) {
    const correctionsByStep = corrections
      .filter((f) => f.correctionDetails?.stepIndex !== undefined)
      .reduce(
        (acc, f) => {
          const step = f.correctionDetails!.stepIndex!;
          acc[step] = (acc[step] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>
      );

    Object.entries(correctionsByStep).forEach(([step, count]) => {
      if (count >= 2) {
        suggestions.push(`Step ${step} is frequently corrected - consider adjusting it`);
      }
    });
  }

  // Analyze dismissals
  if (stats.dismissedCount >= 3 && stats.acceptanceRate < 0.4) {
    suggestions.push('High dismissal rate - consider when this habit is suggested');
  }

  // Analyze failures
  if (stats.failureRate > 0.3) {
    suggestions.push('Habit fails often - may need more specific context conditions');
  }

  // Low user confidence
  if (stats.avgUserConfidenceRating < 0.5) {
    suggestions.push('Users have low confidence in this habit - review and improve');
  }

  return suggestions;
}

/**
 * Generates feedback report for a habit.
 * 
 * @param stats - Feedback statistics
 * @param feedbackList - Raw feedback
 * @returns Human-readable report
 */
export function generateFeedbackReport(
  stats: HabitFeedbackStats,
  feedbackList: HabitFeedback[]
): string {
  const parts: string[] = [
    `Habit Feedback Report for ${stats.habitId}`,
    `Total Feedback: ${stats.totalFeedback}`,
    `Last Updated: ${new Date(stats.lastFeedbackTime).toLocaleString()}`,
    '',
    'Acceptance:',
    `  Accepted: ${stats.acceptedCount} (${(stats.acceptanceRate * 100).toFixed(0)}%)`,
    `  Dismissed: ${stats.dismissedCount}`,
    `  Corrected: ${stats.correctedCount} (${(stats.correctionRate * 100).toFixed(0)}%)`,
    '',
    'Execution:',
    `  Failed: ${stats.failedCount} (${(stats.failureRate * 100).toFixed(0)}%)`,
    `  Issues Reported: ${stats.issuesReportedCount}`,
    '',
    `User Confidence: ${(stats.avgUserConfidenceRating * 100).toFixed(0)}%`,
  ];

  // Add problems
  const problems = detectFeedbackProblems(stats);
  if (problems.length > 0) {
    parts.push('');
    parts.push('Issues:');
    problems.forEach((p) => parts.push(`  - ${p}`));
  }

  // Add suggestions
  const suggestions = suggestImprovements(stats, feedbackList);
  if (suggestions.length > 0) {
    parts.push('');
    parts.push('Suggestions:');
    suggestions.forEach((s) => parts.push(`  - ${s}`));
  }

  return parts.join('\n');
}

/**
 * Manages habit feedback collection and analysis.
 */
export class HabitFeedbackManager {
  private feedbackByHabit: Map<HabitId, HabitFeedbackHistory> = new Map();

  /**
   * Records feedback for a habit.
   * 
   * @param feedback - Feedback to record
   */
  public recordFeedback(feedback: HabitFeedback): void {
    const habitId = feedback.habitId;
    let history = this.feedbackByHabit.get(habitId);

    if (!history) {
      history = {
        habitId,
        feedbackList: [],
        stats: calculateFeedbackStats([], habitId),
        lastUpdated: Date.now(),
      };
      this.feedbackByHabit.set(habitId, history);
    }

    history.feedbackList.push(feedback);
    history.stats = calculateFeedbackStats(history.feedbackList, habitId);
    history.lastUpdated = Date.now();
  }

  /**
   * Gets feedback history for a habit.
   * 
   * @param habitId - Habit to retrieve
   * @returns Feedback history or undefined
   */
  public getHistory(habitId: HabitId): HabitFeedbackHistory | undefined {
    return this.feedbackByHabit.get(habitId);
  }

  /**
   * Gets statistics for a habit.
   * 
   * @param habitId - Habit to query
   * @returns Statistics or default
   */
  public getStats(habitId: HabitId): HabitFeedbackStats {
    const history = this.feedbackByHabit.get(habitId);
    if (!history) {
      return calculateFeedbackStats([], habitId);
    }
    return history.stats;
  }

  /**
   * Gets recent feedback (within time window).
   * 
   * @param habitId - Habit to query
   * @param windowMs - Time window (default: 7 days)
   * @returns Recent feedback entries
   */
  public getRecentFeedback(habitId: HabitId, windowMs: number = 7 * 24 * 60 * 60 * 1000): HabitFeedback[] {
    const history = this.feedbackByHabit.get(habitId);
    if (!history) return [];

    const cutoff = Date.now() - windowMs;
    return history.feedbackList.filter((f) => f.timestamp >= cutoff);
  }

  /**
   * Generates report for a habit.
   * 
   * @param habitId - Habit to report on
   * @returns Human-readable report
   */
  public generateReport(habitId: HabitId): string {
    const history = this.feedbackByHabit.get(habitId);
    if (!history || history.feedbackList.length === 0) {
      return `No feedback available for ${habitId}`;
    }
    return generateFeedbackReport(history.stats, history.feedbackList);
  }

  /**
   * Gets all habits with problems.
   * 
   * @returns Array of habit IDs with problems
   */
  public getProblematicHabits(): HabitId[] {
    const problematic: HabitId[] = [];
    this.feedbackByHabit.forEach((history) => {
      const problems = detectFeedbackProblems(history.stats);
      if (problems.length > 0) {
        problematic.push(history.habitId);
      }
    });
    return problematic;
  }

  /**
   * Clears feedback for a habit.
   * 
   * @param habitId - Habit to clear
   */
  public clearFeedback(habitId: HabitId): void {
    this.feedbackByHabit.delete(habitId);
  }
}
