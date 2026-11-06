/**
 * Habit Condition Engine
 * Evaluates habit conditions and calculates match scores.
 * 
 * Features:
 * - Combined conditions (AND/OR logic)
 * - Match scoring with confidence, weight, and quality metrics
 * - Context requirement validation
 * - Support for condition negation
 * 
 * Requirements: 14.1, 14.2, 14.3
 */

import type { HabitCondition, ConditionType } from './habit-types.js';
import {
  ElementStateMatcher,
  ContextMatchMatcher,
  TimePatternMatcher,
  SequenceHistoryMatcher,
  HabitMatchContext,
  HabitMatchResult,
} from './habit-matchers.js';

/**
 * Result of evaluating all conditions for a habit.
 * Includes individual condition results and overall match score.
 */
export interface HabitConditionEvaluation {
  /**
   * Whether all required conditions matched.
   * Based on the logical operator (AND/OR) and negation settings.
   */
  matched: boolean;
  
  /**
   * Overall confidence score (0..1) for the match.
   * Combines individual condition confidences and weights.
   */
  confidence: number;
  
  /**
   * Weighted confidence score (0..1) based on condition weights.
   * Higher-weighted conditions have more influence.
   */
  weightedConfidence: number;
  
  /**
   * Match quality score (0..1) based on match details.
   * Considers confidence levels, number of matched conditions, etc.
   */
  matchQuality: HabitMatchQuality;
  
  /**
   * Individual results for each condition.
   */
  conditionResults: HabitConditionResult[];
  
  /**
   * Human-readable explanation of the match result.
   */
  explanation?: string;
}

/**
 * Individual condition result with metadata.
 */
export interface HabitConditionResult {
  /**
   * Condition that was evaluated.
   */
  condition: HabitCondition;
  
  /**
   * Result of matching this condition.
   */
  result: HabitMatchResult;
  
  /**
   * Whether this condition passed (after negation).
   */
  passed: boolean;
  
  /**
   * Weight applied to this condition (if specified).
   */
  weight?: number;
}

/**
 * Match quality metrics.
 * Provides detailed information about match quality beyond just confidence.
 */
export interface HabitMatchQuality {
  /**
   * Overall quality score (0..1).
   */
  score: number;
  
  /**
   * Number of conditions that matched.
   */
  matchedCount: number;
  
  /**
   * Total number of conditions evaluated.
   */
  totalConditions: number;
  
  /**
   * Average confidence of matched conditions.
   */
  averageConfidence: number;
  
  /**
   * Number of high-confidence matches (confidence >= 0.8).
   */
  highConfidenceCount: number;
  
  /**
   * Number of low-confidence matches (confidence < 0.5).
   */
  lowConfidenceCount: number;
  
  /**
   * Whether all conditions were successfully validated.
   */
  allValid: boolean;
  
  /**
   * List of validation errors (if any).
   */
  validationErrors?: string[];
}

/**
 * Logic operator for combining conditions.
 */
export type ConditionLogic = 'AND' | 'OR';

/**
 * Configuration for habit condition evaluation.
 */
export interface HabitConditionEvaluationConfig {
  /**
   * Logic operator for combining conditions (default: AND).
   */
  logic?: ConditionLogic;
  
  /**
   * Minimum required confidence for a match (default: 0.5).
   */
  minimumConfidence?: number;
  
  /**
   * Whether to require all conditions to be validated successfully (default: true).
   */
  requireValidation?: boolean;
}

/**
 * Habit condition engine for evaluating habits against current context.
 */
export class HabitConditionEngine {
  private matchers: Map<ConditionType, any>;
  private defaultConfig: HabitConditionEvaluationConfig;
  
  constructor(config?: HabitConditionEvaluationConfig) {
    this.matchers = new Map<ConditionType, any>([
      ['element-state', new ElementStateMatcher()],
      ['context-match', new ContextMatchMatcher()],
      ['time-pattern', new TimePatternMatcher()],
      ['sequence-history', new SequenceHistoryMatcher()],
    ]);
    
    this.defaultConfig = {
      logic: 'AND',
      minimumConfidence: 0.5,
      requireValidation: true,
      ...config,
    };
  }
  
  /**
   * Evaluates all conditions for a habit against the current context.
   * @param conditions - Habit conditions to evaluate
   * @param context - Current execution context
   * @param config - Optional evaluation configuration
   * @returns HabitConditionEvaluation with match results
   */
  evaluate(
    conditions: HabitCondition[],
    context: HabitMatchContext,
    config?: HabitConditionEvaluationConfig
  ): HabitConditionEvaluation {
    if (conditions.length === 0) {
      return {
        matched: true,
        confidence: 1.0,
        weightedConfidence: 1.0,
        matchQuality: {
          score: 1.0,
          matchedCount: 0,
          totalConditions: 0,
          averageConfidence: 1.0,
          highConfidenceCount: 0,
          lowConfidenceCount: 0,
          allValid: true,
        },
        conditionResults: [],
        explanation: 'No conditions to evaluate - match by default',
      };
    }
    
    const evaluationConfig = { ...this.defaultConfig, ...config };
    const results: HabitConditionResult[] = [];
    const validationErrors: string[] = [];
    
    // Evaluate each condition
    for (const condition of conditions) {
      const result = this.evaluateCondition(condition, context);
      
      if (!result.result.matched && result.condition.negate) {
        // Negation: if condition doesn't match, it passes
        result.passed = true;
      } else if (result.condition.negate) {
        // Negation: if condition matches, it fails
        result.passed = false;
      } else {
        // Normal: match means pass
        result.passed = result.result.matched;
      }
      
      // Validate condition
      if (!this.validateCondition(condition)) {
        validationErrors.push(`Condition validation failed: ${condition.type}`);
        result.passed = false;
      }
      
      results.push(result);
    }
    
    // Calculate match based on logic operator
    const matched = this.calculateMatch(results, evaluationConfig.logic || 'AND');
    
    // Calculate confidence scores
    const { confidence, weightedConfidence } = this.calculateConfidence(results, matched);
    
    // Calculate match quality
    const matchQuality = this.calculateMatchQuality(results, matched, validationErrors);
    
    // Generate explanation
    const explanation = this.generateExplanation(results, matched, evaluationConfig.logic || 'AND');
    
    return {
      matched,
      confidence,
      weightedConfidence,
      matchQuality,
      conditionResults: results,
      explanation,
    };
  }
  
  /**
   * Evaluates a single condition against the current context.
   * @param condition - Condition to evaluate
   * @param context - Current execution context
   * @returns HabitConditionResult with evaluation details
   */
  private evaluateCondition(
    condition: HabitCondition,
    context: HabitMatchContext
  ): HabitConditionResult {
    const matcher = this.matchers.get(condition.type);
    
    if (!matcher) {
      return {
        condition,
        result: {
          matched: false,
          confidence: 0,
          conditionType: condition.type,
          reason: `Unknown condition type: ${condition.type}`,
        },
        passed: false,
      };
    }
    
    const result = matcher.evaluate(condition, context);
    
    // Apply negation logic: negated conditions pass when they don't match
    const passed = condition.negate ? !result.matched : result.matched;
    
    return {
      condition,
      result,
      passed,
    };
  }
  
  /**
   * Validates that a condition is properly formatted.
   * @param condition - Condition to validate
   * @returns true if condition is valid, false otherwise
   */
  private validateCondition(condition: HabitCondition): boolean {
    const matcher = this.matchers.get(condition.type);
    
    if (!matcher) {
      return false;
    }
    
    // Use the matcher's validate method if available
    if (typeof (matcher as any).validateCondition === 'function') {
      return (matcher as any).validateCondition(condition);
    }
    
    // Default validation: condition must have type and weight in valid range
    return (
      condition.type !== undefined &&
      (condition.weight === undefined || (condition.weight >= 0 && condition.weight <= 1))
    );
  }
  
  /**
   * Calculates whether all conditions match based on logic operator.
   * @param results - Individual condition results
   * @param logic - Logic operator (AND/OR)
   * @returns true if all conditions pass based on logic
   */
  private calculateMatch(results: HabitConditionResult[], logic: ConditionLogic): boolean {
    const passedResults = results.filter((r) => r.passed);
    const failedResults = results.filter((r) => !r.passed);
    
    if (logic === 'AND') {
      // All conditions must pass
      return failedResults.length === 0 && passedResults.length > 0;
    } else {
      // At least one condition must pass
      return passedResults.length > 0;
    }
  }
  
  /**
   * Calculates confidence scores from condition results.
   * @param results - Individual condition results
   * @param matched - Whether the overall match succeeded
   * @returns Object with confidence and weightedConfidence scores
   */
  private calculateConfidence(
    results: HabitConditionResult[],
    matched: boolean
  ): { confidence: number; weightedConfidence: number } {
    if (results.length === 0) {
      return { confidence: 1.0, weightedConfidence: 1.0 };
    }
    
    const matchedResults = results.filter((r) => r.result.matched);
    
    // Base confidence: proportion of conditions that matched
    const baseConfidence = matchedResults.length / results.length;
    
    // Weighted confidence: weighted average of matched conditions
    let weightedConfidence = 0;
    let totalWeight = 0;
    
    for (const result of matchedResults) {
      const weight = result.condition.weight ?? 1.0;
      weightedConfidence += result.result.confidence * weight;
      totalWeight += weight;
    }
    
    weightedConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;
    
    // Adjust confidence based on whether overall match succeeded
    const finalConfidence = matched ? baseConfidence : 0;
    
    // Boost confidence if all conditions matched with high confidence
    // Only apply the cap when there are multiple conditions to ensure consistency
    if (matched && matchedResults.length === results.length && results.length > 1) {
      const averageConfidence = matchedResults.reduce(
        (sum, r) => sum + r.result.confidence,
        0
      ) / matchedResults.length;
      
      if (averageConfidence > 0.8) {
        return { confidence: 0.95, weightedConfidence: Math.min(0.95, weightedConfidence) };
      }
    }
    
    return {
      confidence: finalConfidence,
      weightedConfidence: weightedConfidence,
    };
  }
  
  /**
   * Calculates match quality metrics.
   * @param results - Individual condition results
   * @param matched - Whether the overall match succeeded
   * @param validationErrors - Any validation errors encountered
   * @returns HabitMatchQuality with detailed metrics
   */
  private calculateMatchQuality(
    results: HabitConditionResult[],
    matched: boolean,
    validationErrors: string[]
  ): HabitMatchQuality {
    const totalConditions = results.length;
    const matchedCount = results.filter((r) => r.passed).length;
    const highConfidenceCount = results.filter((r) => r.result.confidence >= 0.8).length;
    const lowConfidenceCount = results.filter((r) => r.result.confidence < 0.5).length;
    const allValid = validationErrors.length === 0;
    
    // Calculate average confidence of matched conditions
    const matchedResults = results.filter((r) => r.passed);
    const averageConfidence =
      matchedResults.length > 0
        ? matchedResults.reduce((sum, r) => sum + r.result.confidence, 0) / matchedResults.length
        : 0;
    
    // Calculate overall quality score
    let score = 0;
    
    if (totalConditions === 0) {
      score = 1.0;
    } else {
      // Base score from match proportion
      const matchProportion = matchedCount / totalConditions;
      score = matchProportion * 0.4;
      
      // Add confidence component
      if (matchedResults.length > 0) {
        const avgConfidence = averageConfidence;
        score += avgConfidence * 0.4;
      }
      
      // Penalty for low confidence matches
      score -= lowConfidenceCount * 0.05;
      
      // Penalty for validation errors
      score -= validationErrors.length * 0.1;
      
      // Bonus for high confidence matches
      score += highConfidenceCount * 0.05;
      
      // Ensure score is in valid range
      score = Math.max(0, Math.min(1, score));
    }
    
    return {
      score,
      matchedCount,
      totalConditions,
      averageConfidence,
      highConfidenceCount,
      lowConfidenceCount,
      allValid,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    };
  }
  
  /**
   * Generates human-readable explanation of match result.
   * @param results - Individual condition results
   * @param matched - Whether the overall match succeeded
   * @param logic - Logic operator used
   * @returns Explanation string
   */
  private generateExplanation(
    results: HabitConditionResult[],
    matched: boolean,
    logic: ConditionLogic
  ): string {
    if (results.length === 0) {
      return 'No conditions to evaluate';
    }
    
    const passedConditions = results.filter((r) => r.passed);
    const failedConditions = results.filter((r) => !r.passed);
    const negatedConditions = results.filter((r) => r.condition.negate);
    
    const logicText = logic === 'AND' ? 'all' : 'at least one';
    
    // Build explanation for passed conditions
    const passedExplanations = passedConditions.map((r) => {
      const conditionText = this.getConditionDescription(r.condition);
      const confidenceText = r.result.confidence >= 0.8 ? 'high confidence' : r.result.confidence >= 0.5 ? 'medium confidence' : 'low confidence';
      return `${conditionText} (${confidenceText})`;
    });
    
    // Build explanation for failed conditions
    const failedExplanations = failedConditions.map((r) => {
      const conditionText = this.getConditionDescription(r.condition);
      const reason = r.result.reason || 'no reason provided';
      return `${conditionText} - ${reason}`;
    });
    
    let explanation = '';
    
    if (logic === 'AND') {
      if (passedConditions.length > 0) {
        explanation += `All ${logicText} conditions passed: ${passedExplanations.join('; ')}`;
      }
      
      if (failedConditions.length > 0) {
        if (explanation) {
          explanation += '. ';
        }
        explanation += `Failed conditions: ${failedExplanations.join('; ')}`;
      }
    } else {
      if (passedConditions.length > 0) {
        explanation += `At least one condition passed: ${passedExplanations.join('; ')}`;
      }
      
      if (failedConditions.length > 0) {
        if (explanation) {
          explanation += '. ';
        }
        explanation += `Other conditions: ${failedExplanations.join('; ')}`;
      }
    }
    
    // Add negation details if any
    if (negatedConditions.length > 0) {
      const negationDetails = negatedConditions.map((r) => {
        const conditionText = this.getConditionDescription(r.condition);
        return `${conditionText} (negated)`;
      });
      
      if (explanation) {
        explanation += '. ';
      }
      explanation += `Negated conditions: ${negationDetails.join('; ')}`;
    }
    
    if (explanation) {
      explanation += `. Overall: ${matched ? 'MATCHED' : 'NOT MATCHED'}`;
    }
    
    return explanation;
  }
  
  /**
   * Gets a human-readable description of a condition.
   * @param condition - Condition to describe
   * @returns Human-readable condition description
   */
  private getConditionDescription(condition: HabitCondition): string {
    switch (condition.type) {
      case 'element-state':
        return `element "${condition.selector}" in state "${condition.state}"`;
      case 'context-match':
        return `context "${condition.context}"`;
      case 'time-pattern':
        const dayStr = condition.dayOfWeek?.map((d) => this.getDayName(d)).join(', ') || 'any';
        const timeStr = condition.timeRange
          ? `${condition.timeRange.start}-${condition.timeRange.end}`
          : 'any';
        return `time (${dayStr}, ${timeStr})`;
      case 'sequence-history':
        return `sequence ${condition.sequence?.join(' → ') || 'any'}`;
      default:
        return `condition of type "${condition.type}"`;
    }
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
  
  /**
   * Validates context requirements against current context.
   * @param contextRequirements - Array of context requirements
   * @param context - Current execution context
   * @returns Validation result with any errors
   */
  validateContextRequirements(
    contextRequirements: HabitContextRequirement[],
    context: HabitMatchContext
  ): HabitContextValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    for (const requirement of contextRequirements) {
      const result = this.validateContextRequirement(requirement, context);
      
      if (!result.valid) {
        errors.push(result.error);
      } else if (result.warning) {
        warnings.push(result.warning);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Validates a single context requirement.
   * @param requirement - Context requirement to validate
   * @param context - Current execution context
   * @returns Validation result
   */
  private validateContextRequirement(
    requirement: HabitContextRequirement,
    context: HabitMatchContext
  ): { valid: boolean; error?: string; warning?: string } {
    switch (requirement.type) {
      case 'url':
        if (!context.applicationContext?.url) {
          return {
            valid: false,
            error: `URL requirement: no URL in context`,
          };
        }
        
        if (requirement.pattern) {
          try {
            const regex = new RegExp(requirement.pattern);
            if (!regex.test(context.applicationContext.url)) {
              return {
                valid: false,
                error: `URL requirement: "${context.applicationContext.url}" does not match pattern "${requirement.pattern}"`,
              };
            }
          } catch {
            return {
              valid: false,
              error: `URL requirement: invalid pattern "${requirement.pattern}"`,
            };
          }
        }
        
        return { valid: true };
        
      case 'title':
        if (!context.applicationContext?.title) {
          return {
            valid: false,
            error: `Title requirement: no title in context`,
          };
        }
        
        if (requirement.pattern) {
          try {
            const regex = new RegExp(requirement.pattern);
            if (!regex.test(context.applicationContext.title)) {
              return {
                valid: false,
                error: `Title requirement: "${context.applicationContext.title}" does not match pattern "${requirement.pattern}"`,
              };
            }
          } catch {
            return {
              valid: false,
              error: `Title requirement: invalid pattern "${requirement.pattern}"`,
            };
          }
        }
        
        return { valid: true };
        
      case 'environment':
        if (!context.applicationContext?.environment) {
          return {
            valid: false,
            error: `Environment requirement: no environment in context`,
          };
        }
        
        for (const [key, expectedValue] of Object.entries(requirement.values || {})) {
          const actualValue = context.applicationContext.environment[key];
          
          if (actualValue === undefined) {
            return {
              valid: false,
              error: `Environment requirement: missing key "${key}"`,
            };
          }
          
          if (expectedValue && actualValue !== expectedValue) {
            return {
              valid: false,
              error: `Environment requirement: "${key}" expected "${expectedValue}", got "${actualValue}"`,
            };
          }
        }
        
        return { valid: true };
        
      default:
        return {
          valid: true,
          warning: `Unknown context requirement type: ${requirement.type}`,
        };
    }
  }
}

/**
 * Context requirement for habit execution.
 */
export interface HabitContextRequirement {
  type: 'url' | 'title' | 'environment';
  pattern?: string;  // For url/title: regex pattern
  values?: Record<string, string>;  // For environment: key-value pairs
  required?: boolean;  // If false, just a preference
}

/**
 * Result of context requirement validation.
 */
export interface HabitContextValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Factory function to create a habit condition engine.
 * @param config - Optional evaluation configuration
 * @returns HabitConditionEngine instance
 */
export function createConditionEngine(config?: HabitConditionEvaluationConfig): HabitConditionEngine {
  return new HabitConditionEngine(config);
}
