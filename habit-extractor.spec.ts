/**
 * Tests for HabitExtractor
 *
 * Tests cover:
 * - Habit extraction from workflow executions
 * - Context extraction from steps
 * - Pattern filtering and confidence calculation
 * - Habit merging and deduplication
 * - Habit variant creation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HabitExtractor, DEFAULT_CONFIG } from './habit-extractor.js';
import { PatternDetector } from './pattern-detector.js';
import type { WorkflowStep } from './recording-types.js';
import type { Habit, HabitVariant } from './habit-types.js';
import type { DetectedPattern } from './pattern-detector.js';

// Mock types
interface MockPatternDetector {
  detectPatterns: vi.ViFn<[string, WorkflowStep[]], DetectedPattern[]>;
  analyzeAcrossExecutions: vi.ViFn<[string, WorkflowStep[][]], DetectedPattern[]>;
}

// Helper functions for creating test data
function createMockStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  const timestamp = overrides.timestamp || Date.now();
  return {
    id: overrides.id || `step-${Date.now()}`,
    index: overrides.index || 0,
    action: overrides.action || 'click',
    target: overrides.target || '#button',
    x: overrides.x || 0.5,
    y: overrides.y || 0.5,
    duration: overrides.duration || 100,
    success: overrides.success !== false,
    timestamp,
    metadata: overrides.metadata || { type: 'user', timestamp },
  };
}

function createMockPattern(overrides: Partial<DetectedPattern> = {}): DetectedPattern {
  return {
    id: overrides.id || 'pattern-001',
    startIndex: overrides.startIndex || 0,
    endIndex: overrides.endIndex || 2,
    steps: overrides.steps || [createMockStep(), createMockStep(), createMockStep()],
    frequency: overrides.frequency || 5,
    successRate: overrides.successRate || 0.8,
    totalTime: overrides.totalTime || 300,
    avgTime: overrides.avgTime || 100,
  };
}

describe('HabitExtractor', () => {
  let extractor: HabitExtractor;
  let patternDetector: PatternDetector;

  beforeEach(() => {
    patternDetector = new PatternDetector({
      minSequenceLength: 2,
      minSuccessRate: 0.0,
      minFrequency: 1,
    });
    extractor = new HabitExtractor({}, patternDetector);
  });

  describe('Habit Extraction from Workflow', () => {
    it('should extract habits from a successful workflow', async () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#login-button', success: true, timestamp: Date.now() - 1000 }),
        createMockStep({ action: 'keyboard', target: '#username-field', success: true, timestamp: Date.now() - 800 }),
        createMockStep({ action: 'keyboard', target: '#password-field', success: true, timestamp: Date.now() - 600 }),
        createMockStep({ action: 'click', target: '#submit-button', success: true, timestamp: Date.now() - 400 }),
      ];

      const habits = await extractor.extractHabitsFromWorkflow('workflow-001', steps);

      expect(habits).toBeDefined();
      expect(habits.length).toBeGreaterThan(0);
      expect(habits[0].id).toBeDefined();
      expect(habits[0].name).toBeDefined();
    });

    it('should filter patterns below success rate threshold', async () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button', success: false, timestamp: Date.now() - 1000 }),
        createMockStep({ action: 'click', target: '#button', success: false, timestamp: Date.now() - 800 }),
      ];

      const habits = await extractor.extractHabitsFromWorkflow('workflow-001', steps);

      // Should have no habits since success rate is 0%
      expect(habits.length).toBe(0);
    });

    it('should extract context from workflow steps', async () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button1', success: true, timestamp: Date.now() - 1000 }),
        createMockStep({ action: 'click', target: '#button2', success: true, timestamp: Date.now() - 800 }),
        createMockStep({ action: 'click', target: '#button1', success: true, timestamp: Date.now() - 600 }),
      ];

      const context = (extractor as any).extractContextFromSteps(steps);

      expect(context.elementSelectors).toContain('#button1');
      expect(context.elementSelectors.length).toBeGreaterThan(0);
    });
  });

  describe('Confidence Calculation', () => {
    it('should calculate confidence from pattern statistics', async () => {
      const pattern = createMockPattern({ successRate: 0.9, frequency: 10 });

      const context = {
        elementSelectors: ['#button'],
        optionalSelectors: [],
        appState: {},
        windowMatches: [],
      };

      const confidence = (extractor as any).calculateConfidence(pattern, context);

      expect(confidence.overall).toBeGreaterThan(0);
      expect(confidence.success).toBeGreaterThan(0);
      expect(confidence.frequency).toBeGreaterThan(0);
    });

    it('should decrease confidence for low success rate', async () => {
      const pattern = createMockPattern({ successRate: 0.3, frequency: 10 });

      const context = {
        elementSelectors: ['#button'],
        optionalSelectors: [],
        appState: {},
        windowMatches: [],
      };

      const confidence = (extractor as any).calculateConfidence(pattern, context);

      expect(confidence.success).toBeLessThan(50);
    });
  });

  describe('Pattern Filtering', () => {
    it('should filter patterns below frequency threshold', () => {
      const patterns: DetectedPattern[] = [
        createMockPattern({ frequency: 2 }),
        createMockPattern({ frequency: 1 }),
      ];

      const extractorWithConfig = new HabitExtractor({ minFrequency: 2 });
      const filtered = (extractorWithConfig as any).filterPatterns(patterns);

      expect(filtered.length).toBe(1);
      expect(filtered[0].frequency).toBe(2);
    });

    it('should filter patterns below minimum sequence length', () => {
      const patterns: DetectedPattern[] = [
        createMockPattern({
          steps: [createMockStep(), createMockStep()],
          frequency: 10,
          successRate: 1,
        }),
        createMockPattern({
          steps: [createMockStep()],
          frequency: 10,
          successRate: 1,
        }),
      ];

      const extractorWithConfig = new HabitExtractor({ minSequenceLength: 2 });
      const filtered = (extractorWithConfig as any).filterPatterns(patterns);

      expect(filtered.length).toBe(1);
    });
  });

  describe('Habit Merging', () => {
    it('should merge similar habits', async () => {
      const habit1: Habit = {
        id: 'habit-001',
        name: 'Login Habit',
        description: 'Login to app',
        pattern: {
          actionSequence: [
            { type: 'click', timestamp: Date.now(), data: {}, metadata: {} },
            { type: 'keyboard', timestamp: Date.now() + 100, data: {}, metadata: {} },
          ],
          contextRequirements: ['#username', '#password'],
        },
        confidence: {
          success: 90,
          frequency: 50,
          recency: 70,
          feedback: 80,
          overall: 0,
          lastDecayAt: new Date().toISOString(),
        },
        metadata: {
          name: 'Login Habit',
          description: 'Login to app',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceType: 'extracted-from-workflow',
          lifecycle: 'learning',
          tags: [],
        },
        executionHistory: [],
        variants: [],
      };

      const habit2: Habit = {
        id: 'habit-002',
        name: 'Login Habit Variant',
        description: 'Login to app variant',
        pattern: {
          actionSequence: [
            { type: 'click', timestamp: Date.now(), data: {}, metadata: {} },
            { type: 'keyboard', timestamp: Date.now() + 100, data: {}, metadata: {} },
          ],
          contextRequirements: ['#username', '#password'],
        },
        confidence: {
          success: 85,
          frequency: 40,
          recency: 60,
          feedback: 70,
          overall: 0,
          lastDecayAt: new Date().toISOString(),
        },
        metadata: {
          name: 'Login Habit Variant',
          description: 'Login to app variant',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceType: 'extracted-from-workflow',
          lifecycle: 'learning',
          tags: [],
        },
        executionHistory: [],
        variants: [],
      };

      const merged = (extractor as any).mergeSimilarHabits([habit1, habit2]);

      expect(merged.length).toBe(1);
      expect(merged[0].id).toBe('habit-001');
    });

    it('should not merge dissimilar habits', async () => {
      const habit1: Habit = {
        id: 'habit-001',
        name: 'Login Habit',
        description: 'Login to app',
        pattern: {
          actionSequence: [
            { type: 'click', timestamp: Date.now(), data: {}, metadata: {} },
            { type: 'keyboard', timestamp: Date.now() + 100, data: {}, metadata: {} },
          ],
          contextRequirements: ['#username', '#password'],
        },
        confidence: {
          success: 90,
          frequency: 50,
          recency: 70,
          feedback: 80,
          overall: 0,
          lastDecayAt: new Date().toISOString(),
        },
        metadata: {
          name: 'Login Habit',
          description: 'Login to app',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceType: 'extracted-from-workflow',
          lifecycle: 'learning',
          tags: [],
        },
        executionHistory: [],
        variants: [],
      };

      const habit2: Habit = {
        id: 'habit-002',
        name: 'Logout Habit',
        description: 'Logout from app',
        pattern: {
          actionSequence: [
            { type: 'click', timestamp: Date.now(), data: {}, metadata: {} },
          ],
          contextRequirements: ['#logout-button'],
        },
        confidence: {
          success: 95,
          frequency: 60,
          recency: 80,
          feedback: 90,
          overall: 0,
          lastDecayAt: new Date().toISOString(),
        },
        metadata: {
          name: 'Logout Habit',
          description: 'Logout from app',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceType: 'extracted-from-workflow',
          lifecycle: 'learning',
          tags: [],
        },
        executionHistory: [],
        variants: [],
      };

      const merged = (extractor as any).mergeSimilarHabits([habit1, habit2]);

      expect(merged.length).toBe(2);
    });
  });

  describe('Habit Variant Creation', () => {
    it('should create habit variants for different contexts', async () => {
      const baseHabit: Habit = {
        id: 'habit-001',
        name: 'Login Habit',
        description: 'Login to app',
        pattern: {
          actionSequence: [
            { type: 'click', timestamp: Date.now(), data: {}, metadata: {} },
            { type: 'keyboard', timestamp: Date.now() + 100, data: {}, metadata: {} },
          ],
          contextRequirements: ['#username', '#password'],
        },
        confidence: {
          success: 90,
          frequency: 50,
          recency: 70,
          feedback: 80,
          overall: 0,
          lastDecayAt: new Date().toISOString(),
        },
        metadata: {
          name: 'Login Habit',
          description: 'Login to app',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceType: 'extracted-from-workflow',
          lifecycle: 'learning',
          tags: [],
        },
        executionHistory: [],
        variants: [],
      };

      const context = {
        elementSelectors: ['#username', '#password', '#mfa-field'],
        optionalSelectors: [],
        appState: {},
        windowMatches: [],
      };

      const variant = extractor.createHabitVariant(baseHabit, context, 'Multi-factor login');

      expect(variant).toBeDefined();
      expect(variant.context).toBe('Multi-factor login');
      expect(variant.id).toContain('habit-001');
    });
  });

  describe('Multiple Execution Analysis', () => {
    it('should extract patterns across multiple executions', async () => {
      const execution1: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button', success: true, timestamp: Date.now() - 1000 }),
        createMockStep({ action: 'click', target: '#button', success: true, timestamp: Date.now() - 800 }),
      ];

      const execution2: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button', success: true, timestamp: Date.now() - 600 }),
        createMockStep({ action: 'click', target: '#button', success: true, timestamp: Date.now() - 400 }),
      ];

      const patterns = (extractor as any).patternDetector.analyzeAcrossExecutions(
        'workflow-001',
        [execution1, execution2]
      );

      expect(patterns.length).toBeGreaterThan(0);
    });
  });
});
