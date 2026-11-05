/**
 * Playback Context Verifier
 *
 * Verifies that the current execution context matches workflow requirements
 * before playback begins. This pre-flight check ensures:
 * - Application context matches (window title, active app)
 * - Required elements exist by selector
 * - Accessible names match expectations
 * - DOM paths are available
 * - Optional context requirements are handled gracefully
 *
 * Implements both strict mode (fail on mismatch) and lenient mode (warn only).
 */

import type { Workflow } from './workflow-types.js';
import type { ExecutionContext, ElementSnapshot } from './integration-types.js';

/**
 * Context requirement specification from workflow.
 * Defines what must be true about the environment before playback.
 */
export interface ContextRequirement {
  /** Type of requirement being checked */
  type:
    | 'window-title'
    | 'application'
    | 'url-pattern'
    | 'element-selector'
    | 'accessible-name'
    | 'dom-path';

  /** The value or pattern to match against current context */
  value: string | RegExp;

  /** Whether this requirement is optional (warn vs error) */
  required: boolean;

  /** Human-readable description of the requirement */
  description?: string;
}

/**
 * Result of a context verification check.
 */
export interface ContextVerificationResult {
  /** Whether verification passed (all required checks met) */
  success: boolean;

  /** Whether verification passed with warnings (optional checks failed) */
  hasWarnings: boolean;

  /** List of failed required checks */
  failedRequirements: VerificationCheckResult[];

  /** List of failed optional checks */
  warnings: VerificationCheckResult[];

  /** List of passed checks */
  passedRequirements: VerificationCheckResult[];

  /** Overall summary message */
  summary: string;

  /** Detailed message for each check */
  details: string[];

  /** Verification mode used (strict = fail on any mismatch, lenient = warn only) */
  mode: 'strict' | 'lenient';

  /** Total checks performed */
  checksPerformed: number;

  /** Number of checks that passed */
  checksPassed: number;
}

/**
 * Result of a single verification check.
 */
export interface VerificationCheckResult {
  requirement: ContextRequirement;
  passed: boolean;
  message: string;
  expectedValue?: string;
  actualValue?: string;
}

/**
 * Options for context verification.
 */
export interface ContextVerifierOptions {
  /** Strict mode: fail on any mismatch. Lenient mode: warn only. */
  mode?: 'strict' | 'lenient';

  /** Fuzzy matching tolerance for strings (0..1 ratio of matching chars) */
  fuzzyMatchTolerance?: number;

  /** Whether to provide detailed error messages */
  verbose?: boolean;

  /** Timeout in ms for element lookup operations */
  elementLookupTimeoutMs?: number;

  /** Logger for diagnostic information */
  logger?: {
    debug: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

/**
 * ContextVerifier validates that current execution context matches workflow requirements.
 *
 * This service performs pre-flight checks before playback begins, ensuring:
 * - The workflow can execute on the current system
 * - Required elements exist and are accessible
 * - Context conditions are met or properly handled
 * - Warnings are issued for optional context mismatches
 *
 * Responsibilities:
 * - Check application/window context (title, name, URL)
 * - Verify required elements exist by selector, accessible name, or DOM path
 * - Validate context requirements from workflow definition
 * - Support both strict (fail) and lenient (warn) modes
 * - Provide detailed verification results with actionable information
 */
export class ContextVerifier {
  private readonly options: Required<ContextVerifierOptions>;
  private readonly noop = { debug: () => {}, warn: () => {}, error: () => {} };

  constructor(options: ContextVerifierOptions = {}) {
    this.options = {
      mode: options.mode ?? 'strict',
      fuzzyMatchTolerance: options.fuzzyMatchTolerance ?? 0.8,
      verbose: options.verbose ?? false,
      elementLookupTimeoutMs: options.elementLookupTimeoutMs ?? 5000,
      logger: options.logger ?? this.noop,
    };
  }

  /**
   * Verify that current context matches workflow requirements.
   *
   * @param workflow Workflow to check requirements for
   * @param executionContext Current execution context
   * @returns ContextVerificationResult with detailed verification information
   */
  verifyWorkflowContext(workflow: Workflow, executionContext: ExecutionContext): ContextVerificationResult {
    const checkResults: VerificationCheckResult[] = [];
    const passedChecks: VerificationCheckResult[] = [];
    const failedRequired: VerificationCheckResult[] = [];
    const failedOptional: VerificationCheckResult[] = [];

    // Get context requirements from workflow (if it has them)
    const requirements = (workflow as any).contextRequirements as ContextRequirement[] | undefined;

    if (!requirements || requirements.length === 0) {
      return {
        success: true,
        hasWarnings: false,
        failedRequirements: [],
        warnings: [],
        passedRequirements: [],
        summary: 'No context requirements to verify',
        details: [],
        mode: this.options.mode,
        checksPerformed: 0,
        checksPassed: 0,
      };
    }

    // Verify each requirement
    for (const requirement of requirements) {
      const result = this.checkRequirement(requirement, executionContext);
      checkResults.push(result);

      if (result.passed) {
        passedChecks.push(result);
      } else if (requirement.required) {
        failedRequired.push(result);
      } else {
        failedOptional.push(result);
      }
    }

    const success = failedRequired.length === 0;
    const hasWarnings = failedOptional.length > 0;

    // Build result
    const result: ContextVerificationResult = {
      success: this.options.mode === 'strict' ? success && !hasWarnings : success,
      hasWarnings,
      failedRequirements: failedRequired,
      warnings: failedOptional,
      passedRequirements: passedChecks,
      summary: this.buildSummary(success, hasWarnings, failedRequired, failedOptional),
      details: this.buildDetails(checkResults),
      mode: this.options.mode,
      checksPerformed: requirements.length,
      checksPassed: passedChecks.length,
    };

    this.options.logger.debug(result.summary);

    return result;
  }

  /**
   * Check a single requirement against current execution context.
   *
   * @param requirement Requirement to check
   * @param executionContext Current execution context
   * @returns VerificationCheckResult
   */
  private checkRequirement(
    requirement: ContextRequirement,
    executionContext: ExecutionContext,
  ): VerificationCheckResult {
    switch (requirement.type) {
      case 'window-title':
        return this.checkWindowTitle(requirement, executionContext);
      case 'application':
        return this.checkApplication(requirement, executionContext);
      case 'url-pattern':
        return this.checkUrlPattern(requirement, executionContext);
      case 'element-selector':
        return this.checkElementSelector(requirement, executionContext);
      case 'accessible-name':
        return this.checkAccessibleName(requirement, executionContext);
      case 'dom-path':
        return this.checkDomPath(requirement, executionContext);
      default:
        return {
          requirement,
          passed: false,
          message: `Unknown requirement type: ${(requirement as any).type}`,
        };
    }
  }

  /**
   * Check if window title matches requirement.
   */
  private checkWindowTitle(
    requirement: ContextRequirement,
    executionContext: ExecutionContext,
  ): VerificationCheckResult {
    const currentTitle = executionContext.applicationName ?? '';
    const matches = this.matchesPattern(currentTitle, requirement.value);

    return {
      requirement,
      passed: matches,
      message: matches
        ? `Window title matches: "${currentTitle}"`
        : `Window title does not match. Expected: ${requirement.value}, Got: "${currentTitle}"`,
      expectedValue: String(requirement.value),
      actualValue: currentTitle,
    };
  }

  /**
   * Check if application name matches requirement.
   */
  private checkApplication(
    requirement: ContextRequirement,
    executionContext: ExecutionContext,
  ): VerificationCheckResult {
    const currentApp = executionContext.applicationName ?? '';
    const matches = this.matchesPattern(currentApp, requirement.value);

    return {
      requirement,
      passed: matches,
      message: matches
        ? `Application matches: "${currentApp}"`
        : `Application does not match. Expected: ${requirement.value}, Got: "${currentApp}"`,
      expectedValue: String(requirement.value),
      actualValue: currentApp,
    };
  }

  /**
   * Check if URL matches pattern.
   */
  private checkUrlPattern(
    requirement: ContextRequirement,
    executionContext: ExecutionContext,
  ): VerificationCheckResult {
    const currentUrl = executionContext.currentUrl ?? '';

    // If no URL is available, this is a failure
    if (!currentUrl && requirement.value) {
      return {
        requirement,
        passed: false,
        message: `URL pattern not matched. Expected: ${requirement.value}, but no URL is available`,
        expectedValue: String(requirement.value),
        actualValue: currentUrl,
      };
    }

    const matches = this.matchesPattern(currentUrl, requirement.value);

    return {
      requirement,
      passed: matches,
      message: matches
        ? `URL matches pattern: "${currentUrl}"`
        : `URL does not match pattern. Expected: ${requirement.value}, Got: "${currentUrl}"`,
      expectedValue: String(requirement.value),
      actualValue: currentUrl,
    };
  }

  /**
   * Check if element with selector exists in visible elements.
   */
  private checkElementSelector(
    requirement: ContextRequirement,
    executionContext: ExecutionContext,
  ): VerificationCheckResult {
    const selector = String(requirement.value);
    const visibleElements = executionContext.visibleElements ?? [];

    const elementExists = visibleElements.some((el) => this.matchesSelector(el, selector));

    return {
      requirement,
      passed: elementExists,
      message: elementExists
        ? `Element with selector "${selector}" exists`
        : `Element with selector "${selector}" not found in visible elements`,
      expectedValue: selector,
      actualValue: elementExists ? 'found' : 'not found',
    };
  }

  /**
   * Check if element with accessible name exists.
   */
  private checkAccessibleName(
    requirement: ContextRequirement,
    executionContext: ExecutionContext,
  ): VerificationCheckResult {
    const accessibleName = String(requirement.value);
    const visibleElements = executionContext.visibleElements ?? [];

    const elementExists = visibleElements.some(
      (el) => el.accessibleName && this.matchesPattern(el.accessibleName, requirement.value),
    );

    return {
      requirement,
      passed: elementExists,
      message: elementExists
        ? `Element with accessible name "${accessibleName}" exists`
        : `Element with accessible name "${accessibleName}" not found`,
      expectedValue: accessibleName,
      actualValue: elementExists ? 'found' : 'not found',
    };
  }

  /**
   * Check if DOM path is available.
   */
  private checkDomPath(
    requirement: ContextRequirement,
    executionContext: ExecutionContext,
  ): VerificationCheckResult {
    const domPath = String(requirement.value);
    const visibleElements = executionContext.visibleElements ?? [];

    // For now, we check if the path structure could theoretically exist
    // In a real implementation, this would traverse the DOM
    const pathExists = visibleElements.some((el) => {
      const elSelector = el.selector ?? '';
      return domPath.includes(elSelector) || elSelector.includes(domPath);
    });

    return {
      requirement,
      passed: pathExists,
      message: pathExists ? `DOM path is available: "${domPath}"` : `DOM path not available: "${domPath}"`,
      expectedValue: domPath,
      actualValue: pathExists ? 'available' : 'unavailable',
    };
  }

  /**
   * Check if a value matches a pattern (string or regex).
   */
  private matchesPattern(value: string, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      // Exact match or fuzzy match
      if (value === pattern) {
        return true;
      }

      // Fuzzy string matching
      return this.fuzzyMatch(value, pattern, this.options.fuzzyMatchTolerance);
    }

    // RegExp match
    return pattern.test(value);
  }

  /**
   * Fuzzy string matching using Levenshtein-like approach.
   */
  private fuzzyMatch(str1: string, str2: string, tolerance: number): boolean {
    const shorter = str1.length < str2.length ? str1 : str2;
    const longer = str1.length >= str2.length ? str1 : str2;

    // If strings are very different in length, fail
    if (longer.length / shorter.length > 2) {
      return false;
    }

    // Simple substring check with tolerance
    if (longer.includes(shorter)) {
      return true;
    }

    // Calculate similarity
    const similarity = this.calculateStringSimilarity(str1, str2);
    return similarity >= tolerance;
  }

  /**
   * Calculate similarity between two strings (0..1).
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings.
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Check if element selector matches.
   */
  private matchesSelector(element: ElementSnapshot, selector: string): boolean {
    if (!element.selector) {
      return false;
    }

    // Exact match
    if (element.selector === selector) {
      return true;
    }

    // Partial match (e.g., class selector matches if element has that class)
    if (selector.startsWith('.')) {
      const className = selector.substring(1);
      return element.selector.includes(className);
    }

    // ID selector match
    if (selector.startsWith('#')) {
      const id = selector.substring(1);
      return element.selector.includes(id);
    }

    // Fuzzy selector matching
    return this.fuzzyMatch(element.selector, selector, this.options.fuzzyMatchTolerance);
  }

  /**
   * Build summary message for verification result.
   */
  private buildSummary(
    success: boolean,
    hasWarnings: boolean,
    failedRequired: VerificationCheckResult[],
    failedOptional: VerificationCheckResult[],
  ): string {
    if (success && !hasWarnings) {
      return 'Context verification passed: all requirements met';
    }

    if (success && hasWarnings) {
      return `Context verification passed with ${failedOptional.length} warning(s): optional requirements not met`;
    }

    return `Context verification failed: ${failedRequired.length} required requirement(s) not met`;
  }

  /**
   * Build detailed messages for all checks.
   */
  private buildDetails(results: VerificationCheckResult[]): string[] {
    return results.map((result) => {
      const status = result.passed ? '✓' : '✗';
      return `${status} ${result.requirement.type}: ${result.message}`;
    });
  }

  /**
   * Get human-readable report of verification result.
   */
  getVerificationReport(result: ContextVerificationResult): string {
    const lines: string[] = [];

    lines.push(`\n=== Context Verification Report (${result.mode} mode) ===`);
    lines.push(`Status: ${result.success ? 'PASSED' : 'FAILED'}`);

    if (result.hasWarnings) {
      lines.push(`Warnings: ${result.warnings.length}`);
    }

    lines.push(`\nSummary: ${result.summary}`);
    lines.push(`Checks: ${result.checksPassed}/${result.checksPerformed} passed`);

    if (result.passedRequirements.length > 0) {
      lines.push('\nPassed Checks:');
      for (const check of result.passedRequirements) {
        lines.push(`  ✓ ${check.message}`);
      }
    }

    if (result.failedRequirements.length > 0) {
      lines.push('\nFailed Required Checks:');
      for (const check of result.failedRequirements) {
        lines.push(`  ✗ ${check.message}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push('\nWarnings (Optional Checks):');
      for (const check of result.warnings) {
        lines.push(`  ⚠ ${check.message}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }
}

/**
 * Create a context verifier with default options.
 */
export function createContextVerifier(options?: ContextVerifierOptions): ContextVerifier {
  return new ContextVerifier(options);
}
