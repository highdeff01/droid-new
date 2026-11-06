/**
 * Habit Condition Matchers
 * Implements individual matcher classes for each condition type:
 * - ElementStateMatcher: Selector-based element state matching
 * - ContextMatchMatcher: Context pattern matching
 * - TimePatternMatcher: Time-based matching (day/time patterns)
 * - SequenceHistoryMatcher: Action history pattern matching
 * 
 * Requirements: 14.1, 14.2, 14.3
 */

import type { HabitCondition, ConditionType } from './habit-types.js';

/**
 * Base interface for all matchers.
 * Each matcher validates and evaluates a specific condition type.
 */
export interface ConditionMatcher<T extends HabitCondition = HabitCondition> {
  /**
   * Validate that the condition has all required fields for this matcher type.
   * @param condition - The condition to validate
   * @returns true if valid, false otherwise
   */
  validateCondition(condition: T): boolean;
  
  /**
   * Evaluate the condition against the current context.
   * @param condition - The condition to evaluate
   * @param context - Current execution context
   * @returns MatchResult with confidence score and details
   */
  evaluate(condition: T, context: HabitMatchContext): HabitMatchResult;
}

/**
 * Context provided to matchers for condition evaluation.
 * Contains all information needed to evaluate habit conditions.
 */
export interface HabitMatchContext {
  /**
   * Current element information (for element-state matching).
   * Selector and current state of the element under consideration.
   */
  currentElement?: {
    selector: string;
    state: string;  // e.g., 'visible', 'enabled', 'focused', 'hidden', 'disabled'
  };
  
  /**
   * Application context information.
   * Can include URL, window title, current view name, etc.
   */
  applicationContext?: {
    url?: string;
    title?: string;
    viewName?: string;
    environment?: Record<string, string>;
  };
  
  /**
   * Recent action history for sequence matching.
   * Array of recent action types or descriptions.
   */
  recentActions?: string[];
  
  /**
   * Current time for time-pattern matching.
   * Uses system time if not provided.
   */
  currentTime?: Date;
  
  /**
   * User context information (role, permissions, preferences).
   */
  userContext?: {
    role?: string;
    permissions?: string[];
    preferences?: Record<string, string>;
  };
}

/**
 * Result of a condition match evaluation.
 * Includes confidence score and detailed information about the match.
 */
export interface HabitMatchResult {
  /**
   * Whether the condition matched (true/false).
   */
  matched: boolean;
  
  /**
   * Confidence score (0..1) indicating how confident we are in this match.
   * Higher confidence indicates more reliable matching.
   */
  confidence: number;
  
  /**
   * Type of condition that was evaluated.
   */
  conditionType: ConditionType;
  
  /**
   * Optional reason explaining why the condition matched or didn't match.
   * Useful for debugging and providing explanations to users.
   */
  reason?: string;
  
  /**
   * Optional metadata about the match (e.g., which elements matched, which time slots were found).
   */
  metadata?: Record<string, unknown>;
  
  /**
   * Weight of this condition (0..1) as specified in the habit condition.
   * Used for scoring combined conditions.
   */
  weight?: number;
}

/**
 * Element state matcher.
 * Checks if a specific DOM element is in the expected state using selectors.
 */
export class ElementStateMatcher implements ConditionMatcher {
  private readonly selectorMatcher: SelectorMatcher;
  
  constructor() {
    this.selectorMatcher = new SelectorMatcher();
  }
  
  /**
   * Validates that an element-state condition has all required fields.
   * @param condition - The condition to validate
   * @returns true if condition has selector and state, false otherwise
   */
  validateCondition(condition: HabitCondition): boolean {
    return (
      condition.type === 'element-state' &&
      typeof condition.selector === 'string' &&
      condition.selector.length > 0 &&
      typeof condition.state === 'string' &&
      condition.state.length > 0
    );
  }
  
  /**
   * Evaluates element-state condition against current context.
   * @param condition - Element-state condition with selector and expected state
   * @param context - Current context with element information
   * @returns MatchResult with confidence score
   */
  evaluate(condition: HabitCondition, context: HabitMatchContext): HabitMatchResult {
    const conditionId = `element-state-${condition.selector}-${condition.state}`;
    
    // Validate condition
    if (!this.validateCondition(condition)) {
      return {
        matched: false,
        confidence: 0,
        conditionType: 'element-state',
        reason: `Invalid element-state condition: selector and state are required`,
      };
    }
    
    // Check if element information is available
    if (!context.currentElement) {
      return {
        matched: false,
        confidence: 0,
        conditionType: 'element-state',
        reason: 'No element information available in context',
      };
    }
    
    // Check if selector matches (using flexible matching)
    const selectorMatched = this.selectorMatcher.matches(
      condition.selector,
      context.currentElement.selector
    );
    
    if (!selectorMatched) {
      return {
        matched: false,
        confidence: 0,
        conditionType: 'element-state',
        reason: `Selector mismatch: expected "${condition.selector}", got "${context.currentElement.selector}"`,
        metadata: { expectedSelector: condition.selector, actualSelector: context.currentElement.selector },
      };
    }
    
    // Check if state matches
    const stateMatched = context.currentElement.state === condition.state;
    
    return {
      matched: stateMatched,
      confidence: stateMatched ? 1.0 : 0.0,
      conditionType: 'element-state',
      reason: stateMatched
        ? `Element "${condition.selector}" is in "${condition.state}" state`
        : `Element "${condition.selector}" is in "${context.currentElement.state}" state, not "${condition.state}"`,
      weight: condition.weight,
      metadata: {
        expectedState: condition.state,
        actualState: context.currentElement.state,
      },
    };
  }
}

/**
 * Context match matcher.
 * Checks if current application context matches expected context patterns.
 */
export class ContextMatchMatcher implements ConditionMatcher {
  private readonly patternMatcher: PatternMatcher;
  
  constructor() {
    this.patternMatcher = new PatternMatcher();
  }
  
  /**
   * Validates that a context-match condition has required context information.
   * @param condition - The condition to validate
   * @returns true if condition has context information, false otherwise
   */
  validateCondition(condition: HabitCondition): boolean {
    if (condition.type !== 'context-match') {
      return false;
    }
    
    // Must have at least one way to match context
    return (
      typeof condition.context === 'string' && condition.context.length > 0 ||
      typeof condition.urlPattern === 'string' ||
      typeof condition.titlePattern === 'string' ||
      typeof condition.viewName === 'string' ||
      (condition.environment !== undefined && Object.keys(condition.environment).length > 0)
    );
  }
  
  /**
   * Evaluates context-match condition against current context.
   * @param condition - Context-match condition with expected context
   * @param context - Current context with application information
   * @returns MatchResult with confidence score
   */
  evaluate(condition: HabitCondition, context: HabitMatchContext): HabitMatchResult {
    const conditionId = `context-match-${condition.context}`;
    
    // Validate condition
    if (!this.validateCondition(condition)) {
      return {
        matched: false,
        confidence: 0,
        conditionType: 'context-match',
        reason: `Invalid context-match condition: context string is required`,
      };
    }
    
    // Check if application context is available
    if (!context.applicationContext) {
      return {
        matched: false,
        confidence: 0,
        conditionType: 'context-match',
        reason: 'No application context available in context',
      };
    }
    
    // Check all context conditions
    const contextInfo = context.applicationContext;
    const conditions: string[] = [];
    const reasons: string[] = [];
    let allMatched = true;
    let lowestConfidence = 1.0;
    
    // Check URL pattern if specified
    if (condition.urlPattern && contextInfo.url) {
      const urlMatched = this.patternMatcher.matchesPattern(condition.urlPattern, contextInfo.url);
      if (urlMatched) {
        conditions.push(`URL matches ${condition.urlPattern}`);
        reasons.push(`URL "${contextInfo.url}" matches pattern "${condition.urlPattern}"`);
      } else {
        allMatched = false;
        reasons.push(`URL "${contextInfo.url}" does not match pattern "${condition.urlPattern}"`);
      }
      lowestConfidence = Math.min(lowestConfidence, urlMatched ? 0.95 : 0);
    }
    
    // Check title pattern if specified
    if (condition.titlePattern && contextInfo.title) {
      const titleMatched = this.patternMatcher.matchesPattern(condition.titlePattern, contextInfo.title);
      if (titleMatched) {
        conditions.push(`Title matches ${condition.titlePattern}`);
        reasons.push(`Title "${contextInfo.title}" matches pattern "${condition.titlePattern}"`);
      } else {
        allMatched = false;
        reasons.push(`Title "${contextInfo.title}" does not match pattern "${condition.titlePattern}"`);
      }
      lowestConfidence = Math.min(lowestConfidence, titleMatched ? 0.9 : 0);
    }
    
    // Check view name if specified
    if (condition.viewName && contextInfo.viewName) {
      const viewMatched = contextInfo.viewName === condition.viewName;
      if (viewMatched) {
        conditions.push(`View matches ${condition.viewName}`);
        reasons.push(`View "${contextInfo.viewName}" matches "${condition.viewName}"`);
      } else {
        allMatched = false;
        reasons.push(`View "${contextInfo.viewName}" does not match "${condition.viewName}"`);
      }
      lowestConfidence = Math.min(lowestConfidence, viewMatched ? 0.85 : 0);
    }
    
    // Check environment variables if specified
    if (condition.environment && contextInfo.environment) {
      const envMatched = this.patternMatcher.matchesEnvironment(condition.environment, contextInfo.environment);
      if (envMatched) {
        conditions.push(`Environment matches`);
        reasons.push(`Environment variables match expected values`);
      } else {
        allMatched = false;
        reasons.push(`Environment variables do not match expected values`);
      }
      lowestConfidence = Math.min(lowestConfidence, envMatched ? 0.9 : 0);
    }
    
    // If no specific patterns were checked, check basic context string match
    if (conditions.length === 0 && typeof condition.context === 'string') {
      // Check if any context field contains the expected string
      const contextString = condition.context;
      const contextFields = [
        contextInfo.url,
        contextInfo.title,
        contextInfo.viewName,
        ...Object.values(contextInfo.environment || {}),
      ].filter((v): v is string => typeof v === 'string');
      
      const contextContains = contextFields.some((field) => field.toLowerCase().includes(contextString.toLowerCase()));
      
      if (contextContains) {
        conditions.push(`Context contains "${contextString}"`);
        reasons.push(`Context information contains "${contextString}"`);
        lowestConfidence = 0.85;
      } else {
        allMatched = false;
        reasons.push(`Context does not contain "${contextString}"`);
        lowestConfidence = 0;
      }
    }
    
    return {
      matched: allMatched,
      confidence: allMatched ? lowestConfidence : 0,
      conditionType: 'context-match',
      reason: allMatched
        ? `Context matched: ${conditions.join(', ')}`
        : `Context not matched: ${reasons.join('; ')}`,
      weight: condition.weight,
      metadata: {
        conditions: conditions,
      },
    };
  }
}

/**
 * Time pattern matcher.
 * Checks if current time matches day-of-week and time-range patterns.
 */
export class TimePatternMatcher implements ConditionMatcher {
  /**
   * Validates that a time-pattern condition has valid time specifications.
   * @param condition - The condition to validate
   * @returns true if condition has valid time information, false otherwise
   */
  validateCondition(condition: HabitCondition): boolean {
    return condition.type === 'time-pattern';
  }
  
  /**
   * Evaluates time-pattern condition against current time.
   * @param condition - Time-pattern condition with dayOfWeek and/or timeRange
   * @param context - Current context (provides currentTime if available)
   * @returns MatchResult with confidence score
   */
  evaluate(condition: HabitCondition, context: HabitMatchContext): HabitMatchResult {
    const currentTime = context.currentTime || new Date();
    const conditionId = `time-pattern-${condition.dayOfWeek?.join('-') || 'any'}-${condition.timeRange?.start || 'any'}-${condition.timeRange?.end || 'any'}`;
    
    // Validate condition
    if (!this.validateCondition(condition)) {
      return {
        matched: false,
        confidence: 0,
        conditionType: 'time-pattern',
        reason: `Invalid time-pattern condition`,
      };
    }
    
    const reasons: string[] = [];
    let allMatched = true;
    let lowestConfidence = 1.0;
    
    // Check day of week if specified
    if (condition.dayOfWeek && condition.dayOfWeek.length > 0) {
      const currentDay = currentTime.getDay();  // 0=Sunday, 6=Saturday
      const dayMatches = condition.dayOfWeek.includes(currentDay);
      
      if (dayMatches) {
        reasons.push(`Day matches (${this.getDayName(currentDay)})`);
      } else {
        allMatched = false;
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        reasons.push(`Day mismatch: expected ${condition.dayOfWeek.map((d) => dayNames[d]).join('|')}, got ${dayNames[currentDay]}`);
      }
      lowestConfidence = Math.min(lowestConfidence, dayMatches ? 0.95 : 0);
    }
    
    // Check time range if specified
    if (condition.timeRange) {
      const [startHour, startMin] = this.parseTime(condition.timeRange.start);
      const [endHour, endMin] = this.parseTime(condition.timeRange.end);
      
      const currentHour = currentTime.getHours();
      const currentMin = currentTime.getMinutes();
      const currentTimeNum = currentHour * 60 + currentMin;
      const startTimeNum = startHour * 60 + startMin;
      const endTimeNum = endHour * 60 + endMin;
      
      const timeMatches = currentTimeNum >= startTimeNum && currentTimeNum <= endTimeNum;
      
      if (timeMatches) {
        reasons.push(`Time within range (${condition.timeRange.start}-${condition.timeRange.end})`);
      } else {
        allMatched = false;
        reasons.push(`Time outside range: expected ${condition.timeRange.start}-${condition.timeRange.end}, got ${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`);
      }
      lowestConfidence = Math.min(lowestConfidence, timeMatches ? 0.95 : 0);
    }
    
    // If no time conditions specified, match by default (always true)
    if (condition.dayOfWeek === undefined && condition.timeRange === undefined) {
      allMatched = true;
      lowestConfidence = 0.5;  // Lower confidence as no specific time conditions
    }
    
    return {
      matched: allMatched,
      confidence: allMatched ? lowestConfidence : 0,
      conditionType: 'time-pattern',
      reason: allMatched
        ? `Time conditions matched: ${reasons.join(', ')}`
        : `Time conditions not matched: ${reasons.join('; ')}`,
      weight: condition.weight,
      metadata: {
        currentTime: currentTime.toISOString(),
        dayOfWeek: condition.dayOfWeek,
        timeRange: condition.timeRange,
      },
    };
  }
  
  /**
   * Parses time string in HH:MM format to hours and minutes.
   * @param timeStr - Time string in HH:MM format
   * @returns Tuple of [hours, minutes]
   */
  private parseTime(timeStr: string): [number, number] {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return [hours, minutes];
  }
  
  /**
   * Gets the name of a day of the week.
   * @param day - Day index (0=Sunday, 6=Saturday)
   * @returns Day name
   */
  private getDayName(day: number): string {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return dayNames[day] || 'Unknown';
  }
}

/**
 * Sequence history matcher.
 * Checks if recent actions match the expected sequence pattern.
 */
export class SequenceHistoryMatcher implements ConditionMatcher {
  /**
   * Validates that a sequence-history condition has valid sequence information.
   * @param condition - The condition to validate
   * @returns true if condition has sequence information, false otherwise
   */
  validateCondition(condition: HabitCondition): boolean {
    return (
      condition.type === 'sequence-history' &&
      Array.isArray(condition.sequence) &&
      condition.sequence.length > 0
    );
  }
  
  /**
   * Evaluates sequence-history condition against recent action history.
   * @param condition - Sequence-history condition with expected action sequence
   * @param context - Current context with recentActions
   * @returns MatchResult with confidence score
   */
  evaluate(condition: HabitCondition, context: HabitMatchContext): HabitMatchResult {
    const conditionId = `sequence-history-${condition.sequence?.join('-')}`;
    
    // Validate condition
    if (!this.validateCondition(condition)) {
      return {
        matched: false,
        confidence: 0,
        conditionType: 'sequence-history',
        reason: `Invalid sequence-history condition: sequence array with at least one action is required`,
      };
    }
    
    // Check if recent actions are available
    if (!context.recentActions || context.recentActions.length === 0) {
      return {
        matched: false,
        confidence: 0,
        conditionType: 'sequence-history',
        reason: 'No recent action history available in context',
      };
    }
    
    const sequence = condition.sequence!;
    
    // Check for sequence match - look for the sequence in recent actions
    // The sequence doesn't have to be at the end, just present anywhere
    const recentActionsStr = context.recentActions.join(',');
    const sequenceStr = sequence.join(',');
    
    // Try exact match first
    let sequenceFound = recentActionsStr.includes(sequenceStr);
    
    // If exact match not found, try fuzzy matching
    if (!sequenceFound && condition.fuzzyMatch !== false) {
      sequenceFound = this.fuzzySequenceMatch(sequence, context.recentActions);
    }
    
    if (sequenceFound) {
      return {
        matched: true,
        confidence: 0.85,  // Slightly less than perfect confidence as sequences can evolve
        conditionType: 'sequence-history',
        reason: `Recent actions contain sequence: ${sequence.join(' → ')}`,
        weight: condition.weight,
        metadata: {
          foundSequence: sequence,
          recentActions: context.recentActions,
          matchType: 'exact',
        },
      };
    }
    
    // Try partial match (last N actions match first N of sequence)
    for (let n = sequence.length; n > 0; n--) {
      const partialSequence = sequence.slice(0, n);
      const recentSlice = context.recentActions.slice(-n);
      
      if (partialSequence.join(',') === recentSlice.join(',')) {
        return {
          matched: true,
          confidence: 0.75 + (n / sequence.length) * 0.1,  // Confidence based on how much matched
          conditionType: 'sequence-history',
          reason: `Recent actions partially match sequence: ${partialSequence.join(' → ')} (partial: ${n}/${sequence.length})`,
          weight: condition.weight,
          metadata: {
            foundSequence: partialSequence,
            recentActions: context.recentActions,
            matchType: 'partial',
            matchLength: n,
          },
        };
      }
    }
    
    return {
      matched: false,
      confidence: 0,
      conditionType: 'sequence-history',
      reason: `Recent actions do not contain sequence: ${sequence.join(' → ')}. Got: ${context.recentActions.join(' → ')}`,
      weight: condition.weight,
      metadata: {
        expectedSequence: sequence,
        recentActions: context.recentActions,
        matchType: 'none',
      },
    };
  }
  
  /**
   * Fuzzy sequence matching - allows for small variations in the sequence.
   * @param expected - Expected sequence of actions
   * @param actual - Actual recent actions
   * @returns true if sequence roughly matches (with some tolerance for variation)
   */
  private fuzzySequenceMatch(expected: string[], actual: string[]): boolean {
    if (expected.length === 0 || actual.length === 0) {
      return false;
    }
    
    // Simple fuzzy matching: check if expected actions appear in order (with possible gaps)
    let expectedIndex = 0;
    
    for (const actualAction of actual) {
      if (expectedIndex < expected.length && actualAction === expected[expectedIndex]) {
        expectedIndex++;
      }
    }
    
    // Consider it a match if we found most of the expected sequence
    return expectedIndex >= Math.ceil(expected.length * 0.8);  // Need at least 80%
  }
}

/**
 * Selector matcher for flexible element selector matching.
 * Supports exact match, partial match, and pattern-based matching.
 */
export class SelectorMatcher {
  /**
   * Matches element selectors with flexible matching.
   * @param expected - Expected selector
   * @param actual - Actual selector from context
   * @returns true if selectors match (with flexibility)
   */
  matches(expected: string, actual: string): boolean {
    // Exact match first
    if (expected === actual) {
      return true;
    }
    
    // Partial match (expected is a substring of actual)
    if (actual.includes(expected)) {
      return true;
    }
    
    // CSS selector matching (expected is a more specific version)
    if (this.cssSelectorMatches(expected, actual)) {
      return true;
    }
    
    // Fuzzy match (similar selectors with small differences)
    if (this.fuzzySelectorMatch(expected, actual)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * CSS selector matching - checks if expected is a valid CSS selector for actual.
   * @param expected - Expected CSS selector
   * @param actual - Actual selector
   * @returns true if expected selector could match actual
   */
  private cssSelectorMatches(expected: string, actual: string): boolean {
    // Simple check: expected selector is a prefix or suffix of actual
    return (
      actual.startsWith(expected) ||
      actual.endsWith(expected) ||
      expected.split(' ').some((part) => actual.includes(part))
    );
  }
  
  /**
   * Fuzzy selector matching - allows for small differences.
   * @param expected - Expected selector
   * @param actual - Actual selector
   * @returns true if selectors are similar enough
   */
  private fuzzySelectorMatch(expected: string, actual: string): boolean {
    // Simple similarity check
    const expectedParts = expected.split(/[#.]/).filter(Boolean);
    const actualParts = actual.split(/[#.]/).filter(Boolean);
    
    const commonParts = expectedParts.filter((part) => actualParts.includes(part));
    
    // If there's at least one common part, consider it a match
    if (commonParts.length > 0) {
      return true;
    }
    
    // Check if one is a substring of the other (for fuzzy match)
    return expected.includes(actual) || actual.includes(expected);
  }
}

/**
 * Pattern matcher for context pattern matching.
 * Supports regex patterns, partial matches, and environment variable matching.
 */
export class PatternMatcher {
  /**
   * Matches a pattern against a string value.
   * @param pattern - Pattern to match (string or regex string)
   * @param value - Value to match against
   * @returns true if pattern matches value
   */
  matchesPattern(pattern: string, value: string): boolean {
    try {
      // Try as regex first
      const regex = new RegExp(pattern, 'i');  // Add case-insensitive flag
      return regex.test(value);
    } catch {
      // If not a valid regex, do case-insensitive substring match
      return value.toLowerCase().includes(pattern.toLowerCase());
    }
  }
  
  /**
   * Matches environment variables against expected values.
   * @param expected - Expected environment variables { key: value }
   * @param actual - Actual environment variables { key: value }
   * @returns true if all expected variables match
   */
  matchesEnvironment(expected: Record<string, string>, actual: Record<string, string>): boolean {
    for (const [key, expectedValue] of Object.entries(expected)) {
      const actualValue = actual[key];
      
      if (actualValue === undefined) {
        return false;  // Missing expected variable
      }
      
      // Check exact match or regex match
      if (actualValue !== expectedValue) {
        try {
          const regex = new RegExp(expectedValue);
          if (!regex.test(actualValue)) {
            return false;
          }
        } catch {
          return false;  // No match
        }
      }
    }
    
    return true;  // All variables matched
  }
}

/**
 * Factory function to create a matcher for a specific condition type.
 * @param conditionType - Type of condition to match
 * @returns ConditionMatcher instance
 */
export function createMatcher(conditionType: ConditionType): ConditionMatcher {
  switch (conditionType) {
    case 'element-state':
      return new ElementStateMatcher();
    case 'context-match':
      return new ContextMatchMatcher();
    case 'time-pattern':
      return new TimePatternMatcher();
    case 'sequence-history':
      return new SequenceHistoryMatcher();
    default:
      throw new Error(`Unknown condition type: ${conditionType}`);
  }
}
