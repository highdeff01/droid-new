/**
 * Playback Context Verifier Tests
 *
 * Comprehensive test suite for context verification functionality including:
 * - Matching contexts (all requirements met)
 * - Context mismatches (required and optional requirements)
 * - Missing elements (with warnings)
 * - DOM path validation
 * - Accessible name checking
 * - Fuzzy matching tolerance
 * - Strict vs lenient modes
 * - Edge cases and error handling
 *
 * Target: 50+ tests covering all verification scenarios
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContextVerifier,
  createContextVerifier,
  type ContextRequirement,
  type ContextVerificationResult,
} from './playback-context-verifier.js';
import type { Workflow, WorkflowMetadata } from './workflow-types.js';
import type { ExecutionContext, ElementSnapshot } from './integration-types.js';

/**
 * Helper: Create a test workflow with context requirements
 */
function createTestWorkflow(requirements: ContextRequirement[] = []): Workflow {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    steps: [],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0',
      source: 'user-created',
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
    } as WorkflowMetadata,
    contextRequirements: requirements,
  } as any as Workflow;
}

/**
 * Helper: Create a test execution context
 */
function createTestContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    executionId: 'test-exec' as any,
    displayState: {
      width: 1920,
      height: 1080,
      dpi: 1.0,
      isMultiDisplay: false,
      displayIndex: 0,
    },
    applicationName: 'Test Application',
    currentUrl: 'https://example.com',
    variables: {},
    executionPath: [],
    createdAt: new Date().toISOString() as any,
    visibleElements: [],
    ...overrides,
  };
}

/**
 * Helper: Create element snapshots
 */
function createElementSnapshot(overrides: Partial<ElementSnapshot> = {}): ElementSnapshot {
  return {
    selector: 'button.submit',
    accessibleName: 'Submit Button',
    boundingBox: { x: 0.1, y: 0.5, width: 0.2, height: 0.1 },
    isVisible: true,
    ...overrides,
  };
}

describe('ContextVerifier', () => {
  let verifier: ContextVerifier;

  beforeEach(() => {
    verifier = createContextVerifier();
  });

  describe('Initialization', () => {
    it('1. Should create verifier with default options', () => {
      expect(verifier).toBeDefined();
    });

    it('2. Should create verifier with custom mode', () => {
      const strictVerifier = createContextVerifier({ mode: 'strict' });
      expect(strictVerifier).toBeDefined();
    });

    it('3. Should create verifier with lenient mode', () => {
      const lenientVerifier = createContextVerifier({ mode: 'lenient' });
      expect(lenientVerifier).toBeDefined();
    });

    it('4. Should create verifier with custom fuzzy tolerance', () => {
      const customVerifier = createContextVerifier({ fuzzyMatchTolerance: 0.7 });
      expect(customVerifier).toBeDefined();
    });

    it('5. Should create verifier with custom logger', () => {
      const logger = { debug: () => {}, warn: () => {}, error: () => {} };
      const loggerVerifier = createContextVerifier({ logger });
      expect(loggerVerifier).toBeDefined();
    });
  });

  describe('No Requirements', () => {
    it('6. Should pass when workflow has no requirements', () => {
      const workflow = createTestWorkflow([]);
      const context = createTestContext();

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
      expect(result.hasWarnings).toBe(false);
      expect(result.checksPerformed).toBe(0);
    });

    it('7. Should pass when workflow has no contextRequirements field', () => {
      const workflow = createTestWorkflow();
      delete (workflow as any).contextRequirements;
      const context = createTestContext();

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });
  });

  describe('Window Title Verification', () => {
    it('8. Should pass when window title matches exactly', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Application',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Test Application' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
      expect(result.checksPassed).toBe(1);
    });

    it('9. Should fail when window title does not match', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Expected Title',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Different Title' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
      expect(result.failedRequirements.length).toBe(1);
    });

    it('10. Should match window title using regex', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: /Test.*/,
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Test Application' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('11. Should support fuzzy window title matching', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Aplication',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Test Application' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('12. Should handle empty window title', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Expected Title',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: '' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('13. Should handle missing window title field', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Expected Title',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: undefined });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });
  });

  describe('Application Verification', () => {
    it('14. Should pass when application matches', () => {
      const workflow = createTestWorkflow([
        {
          type: 'application',
          value: 'Chrome',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Chrome' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('15. Should fail when application does not match', () => {
      const workflow = createTestWorkflow([
        {
          type: 'application',
          value: 'Firefox',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Chrome' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('16. Should match application using regex', () => {
      const workflow = createTestWorkflow([
        {
          type: 'application',
          value: /Chrome|Chromium/,
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Chromium' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });
  });

  describe('URL Pattern Verification', () => {
    it('17. Should pass when URL matches exactly', () => {
      const workflow = createTestWorkflow([
        {
          type: 'url-pattern',
          value: 'https://example.com',
          required: true,
        },
      ]);
      const context = createTestContext({ currentUrl: 'https://example.com' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('18. Should match URL using regex pattern', () => {
      const workflow = createTestWorkflow([
        {
          type: 'url-pattern',
          value: /https:\/\/.*\.example\.com/,
          required: true,
        },
      ]);
      const context = createTestContext({ currentUrl: 'https://app.example.com/dashboard' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('19. Should fail when URL does not match regex', () => {
      const workflow = createTestWorkflow([
        {
          type: 'url-pattern',
          value: /example\.com/,
          required: true,
        },
      ]);
      const context = createTestContext({ currentUrl: 'https://different.com' });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('20. Should fail when no URL is available but required', () => {
      const workflow = createTestWorkflow([
        {
          type: 'url-pattern',
          value: 'https://example.com',
          required: true,
        },
      ]);
      const context = createTestContext({ currentUrl: undefined });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('21. Should warn when URL missing but not required', () => {
      const lenientVerifier = createContextVerifier({ mode: 'lenient' });
      const workflow = createTestWorkflow([
        {
          type: 'url-pattern',
          value: 'https://example.com',
          required: false,
        },
      ]);
      const context = createTestContext({ currentUrl: undefined });

      const result = lenientVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
      expect(result.hasWarnings).toBe(true);
    });
  });

  describe('Element Selector Verification', () => {
    it('22. Should pass when element selector exists', () => {
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ selector: 'button.submit' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('23. Should fail when element selector does not exist', () => {
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ selector: 'button.cancel' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('24. Should find element with class selector', () => {
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: '.submit',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ selector: 'button.submit' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('25. Should find element with ID selector', () => {
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: '#submit-btn',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ selector: '#submit-btn' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('26. Should handle empty visible elements', () => {
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({ visibleElements: [] });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('27. Should handle missing visibleElements field', () => {
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({ visibleElements: undefined });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('28. Should warn when required element selector missing (optional)', () => {
      const lenientVerifier = createContextVerifier({ mode: 'lenient' });
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: false,
        },
      ]);
      const context = createTestContext({ visibleElements: [] });

      const result = lenientVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
      expect(result.hasWarnings).toBe(true);
      expect(result.warnings.length).toBe(1);
    });
  });

  describe('Accessible Name Verification', () => {
    it('29. Should pass when accessible name matches', () => {
      const workflow = createTestWorkflow([
        {
          type: 'accessible-name',
          value: 'Submit Button',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ accessibleName: 'Submit Button' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('30. Should fail when accessible name does not match', () => {
      const workflow = createTestWorkflow([
        {
          type: 'accessible-name',
          value: 'Cancel Button',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ accessibleName: 'Submit Button' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('31. Should match accessible name using regex', () => {
      const workflow = createTestWorkflow([
        {
          type: 'accessible-name',
          value: /.*Button/,
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ accessibleName: 'Submit Button' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('32. Should support fuzzy accessible name matching', () => {
      const workflow = createTestWorkflow([
        {
          type: 'accessible-name',
          value: 'Sbmit Buton',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ accessibleName: 'Submit Button' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('33. Should handle element without accessible name', () => {
      const workflow = createTestWorkflow([
        {
          type: 'accessible-name',
          value: 'Submit Button',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ accessibleName: undefined })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });
  });

  describe('DOM Path Verification', () => {
    it('34. Should pass when DOM path matches element selector', () => {
      const workflow = createTestWorkflow([
        {
          type: 'dom-path',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ selector: 'button.submit' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('35. Should fail when DOM path does not exist', () => {
      const workflow = createTestWorkflow([
        {
          type: 'dom-path',
          value: 'div.container > button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({ visibleElements: [] });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('36. Should find partial DOM path matches', () => {
      const workflow = createTestWorkflow([
        {
          type: 'dom-path',
          value: 'button',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ selector: 'div.form > button.submit' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('37. Should warn when DOM path missing (optional)', () => {
      const lenientVerifier = createContextVerifier({ mode: 'lenient' });
      const workflow = createTestWorkflow([
        {
          type: 'dom-path',
          value: 'button.submit',
          required: false,
        },
      ]);
      const context = createTestContext({ visibleElements: [] });

      const result = lenientVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
      expect(result.hasWarnings).toBe(true);
    });
  });

  describe('Multiple Requirements', () => {
    it('38. Should pass when all requirements are met', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Application',
          required: true,
        },
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
        {
          type: 'url-pattern',
          value: /example\.com/,
          required: true,
        },
      ]);
      const context = createTestContext({
        applicationName: 'Test Application',
        currentUrl: 'https://example.com',
        visibleElements: [createElementSnapshot({ selector: 'button.submit' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
      expect(result.checksPassed).toBe(3);
    });

    it('39. Should fail when one required requirement fails', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Application',
          required: true,
        },
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({
        applicationName: 'Test Application',
        visibleElements: [],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
      expect(result.failedRequirements.length).toBe(1);
    });

    it('40. Should distinguish required vs optional failures', () => {
      const lenientVerifier = createContextVerifier({ mode: 'lenient' });
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Application',
          required: true,
        },
        {
          type: 'element-selector',
          value: 'button.submit',
          required: false,
        },
      ]);
      const context = createTestContext({
        applicationName: 'Test Application',
        visibleElements: [],
      });

      const result = lenientVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
      expect(result.hasWarnings).toBe(true);
      expect(result.failedRequirements.length).toBe(0);
      expect(result.warnings.length).toBe(1);
    });

    it('41. Should report all passed requirements', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Application',
          required: true,
        },
        {
          type: 'application',
          value: 'Test Application',
          required: true,
        },
      ]);
      const context = createTestContext({
        applicationName: 'Test Application',
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.passedRequirements.length).toBe(2);
    });
  });

  describe('Strict vs Lenient Modes', () => {
    it('42. Should fail in strict mode with warnings', () => {
      const strictVerifier = createContextVerifier({ mode: 'strict' });
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: false,
        },
      ]);
      const context = createTestContext({ visibleElements: [] });

      const result = strictVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });

    it('43. Should pass in lenient mode with warnings', () => {
      const lenientVerifier = createContextVerifier({ mode: 'lenient' });
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: false,
        },
      ]);
      const context = createTestContext({ visibleElements: [] });

      const result = lenientVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
      expect(result.hasWarnings).toBe(true);
    });

    it('44. Should always fail with required failures regardless of mode', () => {
      const lenientVerifier = createContextVerifier({ mode: 'lenient' });
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({ visibleElements: [] });

      const result = lenientVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });
  });

  describe('Fuzzy Matching', () => {
    it('45. Should use fuzzy tolerance setting', () => {
      const strictMatchVerifier = createContextVerifier({ fuzzyMatchTolerance: 0.85 });
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Aplication',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Test Application' });

      const result = strictMatchVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('46. Should fail fuzzy match below tolerance threshold', () => {
      const strictMatchVerifier = createContextVerifier({ fuzzyMatchTolerance: 0.99 });
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Aplication',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Test Application' });

      const result = strictMatchVerifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('47. Should handle unknown requirement type', () => {
      const workflow = createTestWorkflow();
      (workflow as any).contextRequirements = [
        {
          type: 'unknown-type',
          value: 'test',
          required: true,
        },
      ];
      const context = createTestContext();

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(false);
      expect(result.failedRequirements.length).toBe(1);
    });

    it('48. Should handle special characters in requirements', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test!@#$%^&*()',
          required: true,
        },
      ]);
      const context = createTestContext({
        applicationName: 'Test!@#$%^&*()',
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('49. Should handle very long strings', () => {
      const longString = 'A'.repeat(1000);
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: longString,
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: longString });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('50. Should handle multiple elements matching', () => {
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [
          createElementSnapshot({ selector: 'button.submit' }),
          createElementSnapshot({ selector: 'button.submit' }),
          createElementSnapshot({ selector: 'button.cancel' }),
        ],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.success).toBe(true);
    });

    it('51. Should generate report for verification result', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test Application',
          required: true,
        },
      ]);
      const context = createTestContext();

      const result = verifier.verifyWorkflowContext(workflow, context);
      const report = verifier.getVerificationReport(result);

      expect(report).toContain('Context Verification Report');
      expect(report).toContain('PASSED');
    });

    it('52. Should generate report showing failed checks', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Expected Title',
          required: true,
        },
      ]);
      const context = createTestContext({ applicationName: 'Different Title' });

      const result = verifier.verifyWorkflowContext(workflow, context);
      const report = verifier.getVerificationReport(result);

      expect(report).toContain('FAILED');
      expect(report).toContain('Failed Required Checks');
    });
  });

  describe('Result Structure', () => {
    it('53. Should include correct metadata in result', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test',
          required: true,
        },
      ]);
      const context = createTestContext();

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.mode).toBe('strict');
      expect(result.checksPerformed).toBe(1);
      expect(result.summary).toBeDefined();
      expect(result.details).toBeDefined();
      expect(Array.isArray(result.details)).toBe(true);
    });

    it('54. Should include detailed check information', () => {
      const workflow = createTestWorkflow([
        {
          type: 'element-selector',
          value: 'button.submit',
          required: true,
        },
      ]);
      const context = createTestContext({
        visibleElements: [createElementSnapshot({ selector: 'button.submit' })],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.passedRequirements[0].expectedValue).toBe('button.submit');
      expect(result.passedRequirements[0].actualValue).toBe('found');
      expect(result.passedRequirements[0].message).toBeDefined();
    });
  });

  describe('Integration', () => {
    it('55. Should work with all requirement types in one verification', () => {
      const workflow = createTestWorkflow([
        {
          type: 'window-title',
          value: 'Test App',
          required: true,
        },
        {
          type: 'application',
          value: 'Test App',
          required: true,
        },
        {
          type: 'url-pattern',
          value: /test.com/,
          required: true,
        },
        {
          type: 'element-selector',
          value: 'button.action',
          required: false,
        },
        {
          type: 'accessible-name',
          value: 'Action Button',
          required: false,
        },
        {
          type: 'dom-path',
          value: 'button.action',
          required: false,
        },
      ]);
      const context = createTestContext({
        applicationName: 'Test App',
        currentUrl: 'https://test.com',
        visibleElements: [
          createElementSnapshot({
            selector: 'button.action',
            accessibleName: 'Action Button',
          }),
        ],
      });

      const result = verifier.verifyWorkflowContext(workflow, context);

      expect(result.checksPerformed).toBe(6);
      expect(result.checksPassed).toBe(6);
      expect(result.success).toBe(true);
    });
  });
});
