/**
 * Habit Condition Matching
 * Determines when habits should be suggested based on current context and conditions.
 * 
 * Requirements: 13.5
 */

import type { HabitCondition, ConditionType, WorkflowStep } from './habit-extraction.js';

/**
 * Context information for evaluating habit conditions.
 */
export interface MatchContext {
  currentElement?: {
    selector: string;
    state: string;  // visible, enabled, focused, etc.
  };
  contextInfo?: string;  // User context (e.g., "Dashboard", "Settings")
  recentActions?: string[];  // Recent action history
  currentTime?: Date;
  userRole?: string;  // For role-based conditions
}

/**
 * Result of a condition match evaluation.
 */
export interface ConditionMatchResult {
  conditionId: string;
  conditionType: ConditionType;
  matched: boolean;
  confidence: number;  // 0..1, how confident we are in this match
  reason?: string;  // Why it matched/didn't match
}

/**
 * Matcher function type.
 */
type ConditionMatcher = (
  condition: HabitCondition,
  context: MatchContext
) => ConditionMatchResult;

/**
 * Matches element-state conditions.
 * Checks if a specific DOM element is in the expected state.
 * 
 * @param condition - The element-state condition
 * @param context - Current context
 * @returns Match result
 */
export function matchElementState(
  condition: HabitCondition,
  context: MatchContext
): ConditionMatchResult {
  const conditionId = `state-${condition.selector}-${condition.state}`;
  
  if (!context.currentElement || !condition.selector || !condition.state) {
    return {
      conditionId,
      conditionType: 'element-state',
      matched: false,
      confidence: 0,
      reason: 'Missing element or state information',
    };
  }

  // Check if selector matches
  if (context.currentElement.selector !== condition.selector) {
    return {
      conditionId,
      conditionType: 'element-state',
      matched: false,
      confidence: 0,
      reason: `Selector mismatch: expected "${condition.selector}", got "${context.currentElement.selector}"`,
    };
  }

  // Check if state matches
  const stateMatches = context.currentElement.state === condition.state;
  
  return {
    conditionId,
    conditionType: 'element-state',
    matched: stateMatches,
    confidence: stateMatches ? 1.0 : 0.0,
    reason: stateMatches
      ? `Element "${condition.selector}" is in "${condition.state}" state`
      : `Element "${condition.selector}" is in "${context.currentElement.state}" state, not "${condition.state}"`,
  };
}

/**
 * Matches context-match conditions.
 * Checks if the current user context matches expected context.
 * 
 * @param condition - The context-match condition
 * @param context - Current context
 * @returns Match result
 */
export function matchContext(
  condition: HabitCondition,
  context: MatchContext
): ConditionMatchResult {
  const conditionId = `ctx-${condition.context}`;
  
  if (!condition.context) {
    return {
      conditionId,
      conditionType: 'context-match',
      matched: false,
      confidence: 0,
      reason: 'No context specified in condition',
    };
  }

  const contextMatches = context.contextInfo?.includes(condition.context) || false;
  
  return {
    conditionId,
    conditionType: 'context-match',
    matched: contextMatches,
    confidence: contextMatches ? 0.9 : 0.0,  // Slightly less than 1 as context matching can be fuzzy
    reason: contextMatches
      ? `Current context "${context.contextInfo}" includes "${condition.context}"`
      : `Current context "${context.contextInfo}" does not include "${condition.context}"`,
  };
}

/**
 * Matches time-pattern conditions.
 * Checks if current time matches day-of-week and time range patterns.
 * 
 * @param condition - The time-pattern condition
 * @param context - Current context
 * @returns Match result
 */
export function matchTimePattern(
  condition: HabitCondition,
  context: MatchContext
): ConditionMatchResult {
  const conditionId = `time-${condition.dayOfWeek?.join('-')}-${condition.timeRange?.start}-${condition.timeRange?.end}`;
  const currentTime = context.currentTime || new Date();
  
  // Check day of week if specified
  if (condition.dayOfWeek && condition.dayOfWeek.length > 0) {
    const currentDay = currentTime.getDay();
    const dayMatches = condition.dayOfWeek.includes(currentDay);
    
    if (!dayMatches) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return {
        conditionId,
        conditionType: 'time-pattern',
        matched: false,
        confidence: 0,
        reason: `Day mismatch: expected ${condition.dayOfWeek.map((d) => dayNames[d]).join('|')}, got ${dayNames[currentDay]}`,
      };
    }
  }

  // Check time range if specified
  if (condition.timeRange) {
    const [startHour, startMin] = condition.timeRange.start.split(':').map(Number);
    const [endHour, endMin] = condition.timeRange.end.split(':').map(Number);
    
    const currentHour = currentTime.getHours();
    const currentMin = currentTime.getMinutes();
    const currentTimeNum = currentHour * 60 + currentMin;
    const startTimeNum = startHour * 60 + startMin;
    const endTimeNum = endHour * 60 + endMin;
    
    const timeMatches = currentTimeNum >= startTimeNum && currentTimeNum <= endTimeNum;
    
    if (!timeMatches) {
      return {
        conditionId,
        conditionType: 'time-pattern',
        matched: false,
        confidence: 0,
        reason: `Time outside range: expected ${condition.timeRange.start}-${condition.timeRange.end}, got ${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`,
      };
    }
  }

  // If we got here, all time conditions matched
  return {
    conditionId,
    conditionType: 'time-pattern',
    matched: true,
    confidence: 0.95,  // Time patterns are very reliable
    reason: 'Time pattern matched',
  };
}

/**
 * Matches sequence-history conditions.
 * Checks if recent actions match the expected sequence pattern.
 * 
 * @param condition - The sequence-history condition
 * @param context - Current context
 * @returns Match result
 */
export function matchSequenceHistory(
  condition: HabitCondition,
  context: MatchContext
): ConditionMatchResult {
  const conditionId = `seq-${condition.sequence?.join('-')}`;
  
  if (!condition.sequence || condition.sequence.length === 0) {
    return {
      conditionId,
      conditionType: 'sequence-history',
      matched: false,
      confidence: 0,
      reason: 'No sequence specified in condition',
    };
  }

  if (!context.recentActions || context.recentActions.length === 0) {
    return {
      conditionId,
      conditionType: 'sequence-history',
      matched: false,
      confidence: 0,
      reason: 'No recent actions available',
    };
  }

  // Check if recent actions match the sequence
  // Look for the sequence in the recent actions
  const recentStr = context.recentActions.join('-');
  const conditionSeqStr = condition.sequence.join('-');
  
  const sequenceMatches = recentStr.includes(conditionSeqStr);
  
  return {
    conditionId,
    conditionType: 'sequence-history',
    matched: sequenceMatches,
    confidence: sequenceMatches ? 0.85 : 0.0,  // Slightly less confident as sequences can evolve
    reason: sequenceMatches
      ? `Recent actions match sequence: ${condition.sequence.join(' → ')}`
      : `Recent actions do not contain sequence: ${condition.sequence.join(' → ')}. Got: ${context.recentActions.join(' → ')}`,
  };
}

/**
 * Matches a condition against current context.
 * Delegates to type-specific matchers.
 * 
 * @param condition - The condition to match
 * @param context - Current context
 * @returns Match result
 */
export function matchCondition(
  condition: HabitCondition,
  context: MatchContext
): ConditionMatchResult {
  switch (condition.type) {
    case 'element-state':
      return matchElementState(condition, context);
    case 'context-match':
      return matchContext(condition, context);
    case 'time-pattern':
      return matchTimePattern(condition, context);
    case 'sequence-history':
      return matchSequenceHistory(condition, context);
    default:
      return {
        conditionId: 'unknown',
        conditionType: condition.type as ConditionType,
        matched: false,
        confidence: 0,
        reason: `Unknown condition type: ${condition.type}`,
      };
  }
}

/**
 * Matches multiple conditions with AND logic.
 * All conditions must match for the overall result to be true.
 * 
 * @param conditions - Array of conditions to match
 * @param context - Current context
 * @returns Match results and overall match status
 */
export function matchAllConditions(
  conditions: HabitCondition[],
  context: MatchContext
): {
  results: ConditionMatchResult[];
  allMatched: boolean;
  overallConfidence: number;
} {
  if (conditions.length === 0) {
    return {
      results: [],
      allMatched: true,  // No conditions = always true
      overallConfidence: 1.0,
    };
  }

  const results = conditions.map((condition) => matchCondition(condition, context));
  const allMatched = results.every((r) => r.matched);
  
  // Overall confidence is the minimum of all individual confidences (AND logic)
  // But only count matched conditions
  const matchedResults = results.filter((r) => r.matched);
  const overallConfidence =
    matchedResults.length === 0 ? 0 : Math.min(...matchedResults.map((r) => r.confidence));

  return { results, allMatched, overallConfidence };
}

/**
 * Matches conditions with OR logic.
 * At least one condition must match for the overall result to be true.
 * 
 * @param conditions - Array of conditions to match
 * @param context - Current context
 * @returns Match results and overall match status
 */
export function matchAnyCondition(
  conditions: HabitCondition[],
  context: MatchContext
): {
  results: ConditionMatchResult[];
  anyMatched: boolean;
  overallConfidence: number;
} {
  if (conditions.length === 0) {
    return {
      results: [],
      anyMatched: true,  // No conditions = always true
      overallConfidence: 1.0,
    };
  }

  const results = conditions.map((condition) => matchCondition(condition, context));
  const anyMatched = results.some((r) => r.matched);
  
  // Overall confidence is the maximum of all matched conditions
  const matchedResults = results.filter((r) => r.matched);
  const overallConfidence =
    matchedResults.length === 0 ? 0 : Math.max(...matchedResults.map((r) => r.confidence));

  return { results, anyMatched, overallConfidence };
}

/**
 * Explains why a set of conditions matched or didn't match.
 * 
 * @param conditions - Conditions that were evaluated
 * @param context - The context used
 * @param logic - AND or OR logic
 * @returns Human-readable explanation
 */
export function explainConditionMatch(
  conditions: HabitCondition[],
  context: MatchContext,
  logic: 'AND' | 'OR' = 'AND'
): string {
  if (conditions.length === 0) {
    return 'No conditions to evaluate';
  }

  const results =
    logic === 'AND'
      ? matchAllConditions(conditions, context).results
      : matchAnyCondition(conditions, context).results;

  const explanations = results.map((r) => r.reason || 'No reason provided').join('; ');
  const outcome = results.every((r) => r.matched) ? 'All conditions matched' : 'Not all conditions matched';

  return `${outcome}: ${explanations}`;
}
