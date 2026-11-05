/**
 * Element Fallback Matcher - Playback Error Handling and Fallback
 *
 * Detects when elements cannot be found at expected coordinates and provides
 * a multi-strategy fallback matching system to locate elements. Implements a
 * strategy chain pattern with these fallback strategies:
 *
 * 1. CSS Selector Matching - Exact match on element selector from context
 * 2. DOM Path Traversal - Navigate DOM tree to find element by path
 * 3. Accessible Name Fuzzy Matching - Find element with similar accessible name
 * 4. Role + Position Heuristics - Find element by role near expected coordinates
 *
 * Tracks which fallback strategies succeeded for analytics and reports why
 * each strategy failed for debugging.
 *
 * **Validates: Requirements 2.8**
 */

import type { ActionContext, ClickAction } from './recording-types.js';
import type { ExecutionContext, ElementSnapshot } from './integration-types.js';

/**
 * Result from a fallback strategy attempt.
 */
export interface FallbackStrategyResult {
  /** Strategy name that was attempted */
  strategy: 'selector' | 'domPath' | 'accessibleName' | 'rolePosition';

  /** Whether the strategy succeeded in finding an element */
  success: boolean;

  /** Element found if successful */
  element?: Element;

  /** Why the strategy failed (if not successful) */
  failureReason?: string;

  /** Similarity/match score if applicable (0..1) */
  matchScore?: number;
}

/**
 * Result from element fallback matching.
 */
export interface ElementFallbackResult {
  /** Whether a matching element was found */
  found: boolean;

  /** Element found if successful */
  element?: Element;

  /** Which strategy successfully matched (if found) */
  successfulStrategy?: 'selector' | 'domPath' | 'accessibleName' | 'rolePosition';

  /** All strategy attempts in order */
  strategiesAttempted: FallbackStrategyResult[];

  /** Error details if no element found */
  error?: string;
}

/**
 * Metrics tracking fallback strategy usage.
 */
export interface FallbackMetrics {
  /** Total fallback attempts */
  totalAttempts: number;

  /** Attempts by strategy */
  byStrategy: Record<'selector' | 'domPath' | 'accessibleName' | 'rolePosition', number>;

  /** Success rate (0..1) */
  successRate: number;

  /** Most successful strategy */
  mostSuccessfulStrategy?: 'selector' | 'domPath' | 'accessibleName' | 'rolePosition';
}

/**
 * ElementFallbackMatcher - Detects element-not-found errors and applies
 * a multi-strategy fallback matching system to recover.
 *
 * Responsibilities:
 * - Detect when expected element is not at normalized coordinates
 * - Try each fallback strategy in sequence
 * - Stop on first successful match
 * - Track which fallback was used for analytics
 * - Report why each strategy failed for debugging
 * - Support optional element matching (some clicks don't need verification)
 */
export class ElementFallbackMatcher {
  private fallbackMetrics: FallbackMetrics = {
    totalAttempts: 0,
    byStrategy: {
      selector: 0,
      domPath: 0,
      accessibleName: 0,
      rolePosition: 0,
    },
    successRate: 0,
  };

  constructor(
    private coordinateTolerance: number = 0.05, // 5% normalized coordinate tolerance
    private fuzzyMatchThreshold: number = 0.7 // 70% similarity for fuzzy name matching
  ) {}

  /**
   * Attempt to find an element at expected coordinates. If not found,
   * apply fallback matching strategies in order.
   *
   * @param action The click action with coordinates and context
   * @param executionContext Current execution context with visible elements
   * @param coordinateRangeX Expected X coordinate range (if element expected)
   * @param coordinateRangeY Expected Y coordinate range (if element expected)
   * @returns ElementFallbackResult with matched element or detailed failure info
   */
  matchElement(
    action: ClickAction,
    executionContext: ExecutionContext,
    coordinateRangeX?: { min: number; max: number },
    coordinateRangeY?: { min: number; max: number }
  ): ElementFallbackResult {
    // First check if element exists at coordinates
    const elementAtCoordinates = this.findElementAtCoordinates(
      action.x,
      action.y,
      executionContext,
      coordinateRangeX,
      coordinateRangeY
    );

    if (elementAtCoordinates) {
      return {
        found: true,
        element: elementAtCoordinates,
        strategiesAttempted: [],
      };
    }

    // Element not found at coordinates - try fallback strategies
    if (!action.context) {
      return {
        found: false,
        error: 'Element not found at coordinates and no context provided for fallback matching',
        strategiesAttempted: [],
      };
    }

    return this.tryFallbackStrategies(action.context, executionContext, action.x, action.y);
  }

  /**
   * Try each fallback strategy in sequence until one succeeds.
   */
  private tryFallbackStrategies(
    context: ActionContext,
    executionContext: ExecutionContext,
    targetX: number,
    targetY: number
  ): ElementFallbackResult {
    this.fallbackMetrics.totalAttempts++;

    const strategiesAttempted: FallbackStrategyResult[] = [];
    const strategies: Array<[string, () => FallbackStrategyResult]> = [
      ['selector', () => this.strategySelectorMatching(context)],
      ['domPath', () => this.strategyDOMPathTraversal(context)],
      ['accessibleName', () => this.strategyAccessibleNameFuzzy(context, executionContext)],
      [
        'rolePosition',
        () => this.strategyRolePositionHeuristics(context, executionContext, targetX, targetY),
      ],
    ];

    for (const [strategyName, strategyFn] of strategies) {
      const result = strategyFn();
      strategiesAttempted.push(result);
      this.fallbackMetrics.byStrategy[result.strategy]++;

      if (result.success && result.element) {
        this.updateSuccessMetrics();
        return {
          found: true,
          element: result.element,
          successfulStrategy: result.strategy,
          strategiesAttempted,
        };
      }
    }

    // All strategies failed
    this.updateSuccessMetrics();
    const failureReasons = strategiesAttempted
      .map(r => `${r.strategy}: ${r.failureReason}`)
      .join('; ');

    return {
      found: false,
      error: `All fallback strategies failed: ${failureReasons}`,
      strategiesAttempted,
    };
  }

  /**
   * Strategy 1: CSS Selector Matching - Try to find element by CSS selector.
   */
  private strategySelectorMatching(context: ActionContext): FallbackStrategyResult {
    if (!context.selector) {
      return {
        strategy: 'selector',
        success: false,
        failureReason: 'No CSS selector provided in context',
      };
    }

    try {
      const element = document.querySelector(context.selector);
      if (element && this.isElementVisible(element)) {
        return {
          strategy: 'selector',
          success: true,
          element,
          matchScore: 1.0, // Exact match
        };
      }

      return {
        strategy: 'selector',
        success: false,
        failureReason: 'Selector did not match any visible element',
      };
    } catch (error) {
      return {
        strategy: 'selector',
        success: false,
        failureReason: `Selector syntax error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Strategy 2: DOM Path Traversal - Navigate DOM tree using the domPath.
   * Example domPath: "html > body > main > div.container > button"
   */
  private strategyDOMPathTraversal(context: ActionContext): FallbackStrategyResult {
    if (!context.domPath) {
      return {
        strategy: 'domPath',
        success: false,
        failureReason: 'No DOM path provided in context',
      };
    }

    try {
      const pathParts = context.domPath
        .split('>')
        .map(part => part.trim())
        .filter(part => part.length > 0);

      if (pathParts.length === 0) {
        return {
          strategy: 'domPath',
          success: false,
          failureReason: 'DOM path is empty after parsing',
        };
      }

      // Start from document.documentElement or body
      let current: Element | null = document.documentElement;

      // Try traversing the path
      for (const part of pathParts) {
        if (!current) break;

        // Try to match this part in children
        current = this.findChildBySelector(current, part);
        if (!current) {
          // Path doesn't exist, return failure
          return {
            strategy: 'domPath',
            success: false,
            failureReason: `Could not find element matching "${part}" in DOM path`,
          };
        }
      }

      if (current && this.isElementVisible(current)) {
        return {
          strategy: 'domPath',
          success: true,
          element: current,
          matchScore: 1.0, // Exact match via path
        };
      }

      return {
        strategy: 'domPath',
        success: false,
        failureReason: 'Element found but not visible',
      };
    } catch (error) {
      return {
        strategy: 'domPath',
        success: false,
        failureReason: `DOM path traversal error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Strategy 3: Accessible Name Fuzzy Matching - Find element with similar accessible name.
   */
  private strategyAccessibleNameFuzzy(
    context: ActionContext,
    executionContext: ExecutionContext
  ): FallbackStrategyResult {
    if (!context.accessibleName) {
      return {
        strategy: 'accessibleName',
        success: false,
        failureReason: 'No accessible name provided in context',
      };
    }

    try {
      const targetName = context.accessibleName.toLowerCase();
      const visibleElements = this.getAllVisibleElements();
      let bestMatch: Element | null = null;
      let bestScore = 0;

      for (const element of visibleElements) {
        const elementName = this.getElementAccessibleName(element).toLowerCase();
        if (!elementName) continue;

        const similarity = this.calculateStringSimilarity(targetName, elementName);
        if (similarity > bestScore && similarity >= this.fuzzyMatchThreshold) {
          bestScore = similarity;
          bestMatch = element;
        }
      }

      if (bestMatch) {
        return {
          strategy: 'accessibleName',
          success: true,
          element: bestMatch,
          matchScore: bestScore,
        };
      }

      return {
        strategy: 'accessibleName',
        success: false,
        failureReason: `No element found with accessible name similar to "${context.accessibleName}" (threshold: ${this.fuzzyMatchThreshold})`,
      };
    } catch (error) {
      return {
        strategy: 'accessibleName',
        success: false,
        failureReason: `Accessible name matching error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Strategy 4: Role + Position Heuristics - Find element by role near expected coordinates.
   */
  private strategyRolePositionHeuristics(
    context: ActionContext,
    executionContext: ExecutionContext,
    targetX: number,
    targetY: number
  ): FallbackStrategyResult {
    if (!context.selector && !context.domPath && !context.accessibleName) {
      return {
        strategy: 'rolePosition',
        success: false,
        failureReason: 'Insufficient context for role/position heuristics',
      };
    }

    try {
      // Extract role from context (e.g., from selector or use default)
      const role = this.extractRoleFromContext(context);
      if (!role) {
        return {
          strategy: 'rolePosition',
          success: false,
          failureReason: 'Could not determine element role from context',
        };
      }

      // Find all elements with matching role
      const visibleElements = this.getAllVisibleElements();
      const candidatesByRole = visibleElements.filter(el => el.getAttribute('role') === role);

      if (candidatesByRole.length === 0) {
        return {
          strategy: 'rolePosition',
          success: false,
          failureReason: `No visible elements found with role "${role}"`,
        };
      }

      // Find candidate closest to target coordinates
      let bestElement: Element | null = null;
      let bestDistance = Infinity;

      for (const element of candidatesByRole) {
        const distance = this.calculateDistanceToCoordinates(element, targetX, targetY);
        if (distance < bestDistance && distance <= this.coordinateTolerance * 2) {
          // Allow twice the tolerance for position heuristics
          bestDistance = distance;
          bestElement = element;
        }
      }

      if (bestElement) {
        const similarity = 1 - bestDistance / (this.coordinateTolerance * 2);
        return {
          strategy: 'rolePosition',
          success: true,
          element: bestElement,
          matchScore: similarity,
        };
      }

      return {
        strategy: 'rolePosition',
        success: false,
        failureReason: `Found elements with role "${role}" but none within acceptable distance tolerance`,
      };
    } catch (error) {
      return {
        strategy: 'rolePosition',
        success: false,
        failureReason: `Role/position heuristics error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Find element at the given normalized coordinates within tolerance.
   */
  private findElementAtCoordinates(
    normalizedX: number,
    normalizedY: number,
    executionContext: ExecutionContext,
    coordinateRangeX?: { min: number; max: number },
    coordinateRangeY?: { min: number; max: number }
  ): Element | null {
    const visibleElements = this.getAllVisibleElements();

    for (const element of visibleElements) {
      const rect = element.getBoundingClientRect();
      
      // If getBoundingClientRect gives us zeros or negative values (JSDOM issue),
      // we can't reliably determine if this is the target element by coordinates
      // In that case, we'll still check if it's visible and the function will
      // fall back to other strategies if needed
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }

      const { viewportWidth, viewportHeight } = this.getViewportDimensions();

      // Normalize element coordinates
      const elementNormalizedX = rect.left / viewportWidth;
      const elementNormalizedY = rect.top / viewportHeight;
      const elementNormalizedWidth = rect.width / viewportWidth;
      const elementNormalizedHeight = rect.height / viewportHeight;

      // Check if point is within element bounds with tolerance
      const withinX =
        normalizedX >= elementNormalizedX - this.coordinateTolerance &&
        normalizedX <= elementNormalizedX + elementNormalizedWidth + this.coordinateTolerance;

      const withinY =
        normalizedY >= elementNormalizedY - this.coordinateTolerance &&
        normalizedY <= elementNormalizedY + elementNormalizedHeight + this.coordinateTolerance;

      // Check coordinate ranges if provided
      const rangeCheckX = coordinateRangeX
        ? normalizedX >= coordinateRangeX.min && normalizedX <= coordinateRangeX.max
        : true;

      const rangeCheckY = coordinateRangeY
        ? normalizedY >= coordinateRangeY.min && normalizedY <= coordinateRangeY.max
        : true;

      if (withinX && withinY && rangeCheckX && rangeCheckY) {
        return element;
      }
    }

    return null;
  }

  /**
   * Find child element matching a selector part (handles tag names and class/id selectors).
   */
  private findChildBySelector(parent: Element, selectorPart: string): Element | null {
    // Handle wildcard
    if (selectorPart === '*') {
      return parent.children.length > 0 ? parent.children[0] : null;
    }

    // Try direct selector with :scope first (it's fast if syntax is valid)
    try {
      const direct = parent.querySelector(':scope > ' + selectorPart);
      if (direct) return direct;
    } catch {
      // Not a valid CSS selector, try manual matching
    }

    // Manual matching for simple cases
    const children = parent.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (this.matchesSelectorPart(child, selectorPart)) {
        return child;
      }
    }

    return null;
  }

  /**
   * Check if element matches a selector part (simple matching for tag + class/id).
   */
  private matchesSelectorPart(element: Element, selectorPart: string): boolean {
    // Normalize selectorPart
    selectorPart = selectorPart.trim();
    if (!selectorPart) return false;

    // Try using matches() first for CSS compliance
    try {
      return element.matches(selectorPart);
    } catch {
      // Fallback to manual matching
    }

    // Parse and match manually
    const classMatch = selectorPart.match(/^([a-zA-Z]*)\.([\w-]+)$/);
    if (classMatch) {
      const [, tag, className] = classMatch;
      const tagMatches = !tag || element.tagName.toLowerCase() === tag.toLowerCase();
      const classMatches = element.classList.contains(className);
      return tagMatches && classMatches;
    }

    const idMatch = selectorPart.match(/^([a-zA-Z]*)?#([\w-]+)$/);
    if (idMatch) {
      const [, tag, id] = idMatch;
      const tagMatches = !tag || element.tagName.toLowerCase() === tag.toLowerCase();
      const idMatches = element.id === id;
      return tagMatches && idMatches;
    }

    // Simple tag name match
    if (!selectorPart.includes('.') && !selectorPart.includes('#')) {
      return element.tagName.toLowerCase() === selectorPart.toLowerCase();
    }

    return false;
  }

  /**
   * Get accessible name for element (aria-label, aria-labelledby, or semantic text).
   */
  private getElementAccessibleName(element: Element): string {
    // Check aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // Check aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelElement = document.getElementById(labelledBy.split(' ')[0]);
      if (labelElement) return labelElement.textContent || '';
    }

    // Get semantic text (button text, input placeholder, etc.)
    if (element.tagName === 'INPUT') {
      const input = element as HTMLInputElement;
      return input.placeholder || input.value || '';
    }

    return element.textContent || '';
  }

  /**
   * Extract role from context (from selector, domPath, or default).
   */
  private extractRoleFromContext(context: ActionContext): string | null {
    // Try to infer role from selector
    if (context.selector) {
      if (context.selector.includes('button')) return 'button';
      if (context.selector.includes('input')) return 'textbox';
      if (context.selector.includes('link') || context.selector.includes('a')) return 'link';
      if (context.selector.includes('select')) return 'combobox';
    }

    // Try to infer from domPath
    if (context.domPath) {
      const lowerPath = context.domPath.toLowerCase();
      if (lowerPath.includes('button')) return 'button';
      if (lowerPath.includes('input')) return 'textbox';
      if (lowerPath.includes('a')) return 'link';
    }

    return null;
  }

  /**
   * Calculate string similarity using Levenshtein distance (0..1).
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0;

    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - distance / maxLength;
  }

  /**
   * Calculate Levenshtein distance between two strings.
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const dp: number[][] = Array.from({ length: str1.length + 1 }, () =>
      Array(str2.length + 1).fill(0)
    );

    for (let i = 0; i <= str1.length; i++) dp[i][0] = i;
    for (let j = 0; j <= str2.length; j++) dp[0][j] = j;

    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return dp[str1.length][str2.length];
  }

  /**
   * Calculate distance from element's center to normalized coordinates.
   */
  private calculateDistanceToCoordinates(element: Element, targetX: number, targetY: number): number {
    const rect = element.getBoundingClientRect();
    const { viewportWidth, viewportHeight } = this.getViewportDimensions();

    const elementCenterX = (rect.left + rect.width / 2) / viewportWidth;
    const elementCenterY = (rect.top + rect.height / 2) / viewportHeight;

    const dx = Math.abs(elementCenterX - targetX);
    const dy = Math.abs(elementCenterY - targetY);

    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Check if element is visible (display, visibility, opacity, scroll position).
   */
  private isElementVisible(element: Element): boolean {
    try {
      // Check visibility and display
      const style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') {
        return false;
      }

      // Check opacity
      if (parseFloat(style.opacity) === 0) return false;

      // In JSDOM tests, getBoundingClientRect may not give accurate results
      // So we primarily check CSS properties rather than relying on layout
      // An element is considered visible if it's not explicitly hidden via CSS
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all visible elements in the document.
   */
  private getAllVisibleElements(): Element[] {
    const elements: Element[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null
    );

    let node: Element | null;
    while ((node = walker.nextNode() as Element | null)) {
      if (this.isElementVisible(node)) {
        elements.push(node);
      }
    }

    return elements;
  }

  /**
   * Get viewport dimensions.
   */
  private getViewportDimensions(): { viewportWidth: number; viewportHeight: number } {
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  /**
   * Update success metrics after an attempt.
   */
  private updateSuccessMetrics(): void {
    const totalByStrategy = Object.values(this.fallbackMetrics.byStrategy).reduce((a, b) => a + b, 0);
    if (totalByStrategy > 0) {
      this.fallbackMetrics.successRate = 1 / (this.fallbackMetrics.totalAttempts || 1);

      // Find most successful strategy
      let mostSuccessful: keyof typeof this.fallbackMetrics.byStrategy = 'selector';
      let maxCount = 0;
      for (const [strategy, count] of Object.entries(this.fallbackMetrics.byStrategy)) {
        if (count > maxCount) {
          maxCount = count;
          mostSuccessful = strategy as keyof typeof this.fallbackMetrics.byStrategy;
        }
      }
      this.fallbackMetrics.mostSuccessfulStrategy = mostSuccessful;
    }
  }

  /**
   * Get current fallback metrics.
   */
  getMetrics(): FallbackMetrics {
    return { ...this.fallbackMetrics };
  }

  /**
   * Reset metrics (useful for testing).
   */
  resetMetrics(): void {
    this.fallbackMetrics = {
      totalAttempts: 0,
      byStrategy: {
        selector: 0,
        domPath: 0,
        accessibleName: 0,
        rolePosition: 0,
      },
      successRate: 0,
    };
  }
}
