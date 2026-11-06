/**
 * Tests for PatternDetector
 *
 * Tests cover:
 * - Pattern detection using sliding window
 * - Sequence similarity calculation
 * - Pattern normalization for comparison
 * - Duplicate detection and removal
 * - LCS (Longest Common Subsequence) calculation
 * - Jaccard similarity
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatternDetector } from './pattern-detector.js';
import type { WorkflowStep } from './recording-types.js';

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

describe('PatternDetector', () => {
  let detector: PatternDetector;

  beforeEach(() => {
    detector = new PatternDetector();
  });

  describe('Pattern Detection', () => {
    it('should detect patterns in a workflow', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button1', success: true, timestamp: Date.now() - 3000 }),
        createMockStep({ action: 'click', target: '#button2', success: true, timestamp: Date.now() - 2000 }),
        createMockStep({ action: 'click', target: '#button3', success: true, timestamp: Date.now() - 1000 }),
        createMockStep({ action: 'click', target: '#button1', success: true, timestamp: Date.now() }),
      ];

      const patterns = detector.detectPatterns('workflow-001', steps);

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].steps.length).toBeGreaterThanOrEqual(2);
    });

    it('should group similar sequences', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button(100,200)', success: true, timestamp: Date.now() - 3000 }),
        createMockStep({ action: 'click', target: '#button(300,400)', success: true, timestamp: Date.now() - 2000 }),
      ];

      const patterns = detector.detectPatterns('workflow-001', steps);

      // Should group these as the same pattern (same target different coordinates)
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should calculate frequency for repeated patterns', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button', success: true, timestamp: Date.now() - 3000 }),
        createMockStep({ action: 'click', target: '#button', success: true, timestamp: Date.now() - 2000 }),
        createMockStep({ action: 'click', target: '#button', success: true, timestamp: Date.now() - 1000 }),
        createMockStep({ action: 'click', target: '#button', success: true, timestamp: Date.now() }),
      ];

      const patterns = detector.detectPatterns('workflow-001', steps);

      // Find pattern with multiple steps
      const multiStepPattern = patterns.find((p) => p.steps.length > 1);
      expect(multiStepPattern).toBeDefined();
      expect(multiStepPattern?.frequency).toBeGreaterThan(1);
    });
  });

  describe('Sequence Similarity', () => {
    it('should calculate action match percentage', () => {
      const seq1 = [createMockStep({ action: 'click' }), createMockStep({ action: 'keyboard' })];
      const seq2 = [createMockStep({ action: 'click' }), createMockStep({ action: 'keyboard' })];

      const similarity = (detector as any).calculateActionMatch(seq1, seq2);
      expect(similarity).toBe(1);
    });

    it('should calculate partial action match', () => {
      const seq1 = [createMockStep({ action: 'click' }), createMockStep({ action: 'keyboard' })];
      const seq2 = [createMockStep({ action: 'click' }), createMockStep({ action: 'drag' })];

      const similarity = (detector as any).calculateActionMatch(seq1, seq2);
      expect(similarity).toBe(0.5);
    });

    it('should normalize selectors for target matching', () => {
      const target1 = '#button[data-id="123"]';
      const target2 = '#button[data-id="456"]';

      const matches = (detector as any).targetsMatch(target1, target2);
      expect(matches).toBe(true);
    });
  });

  describe('Pattern Normalization', () => {
    it('should normalize a pattern for comparison', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button(100,200)', duration: 100 }),
        createMockStep({ action: 'click', target: '#button(300,400)', duration: 150 }),
      ];

      const normalized = detector.normalizePattern(steps);

      expect(normalized.sequence).toEqual(['click', 'click']);
      expect(normalized.context).toEqual(['#button(100,200)', '#button(300,400)']);
    });

    it('should calculate pattern similarity', () => {
      const pattern1 = {
        sequence: ['click', 'keyboard'],
        context: ['#button', '#input'],
        durationRange: [100, 200] as const,
        actionTypes: ['click', 'keyboard'],
      };

      const pattern2 = {
        sequence: ['click', 'keyboard'],
        context: ['#button', '#input'],
        durationRange: [100, 200] as const,
        actionTypes: ['click', 'keyboard'],
      };

      const similarity = detector.calculatePatternSimilarity(pattern1 as any, pattern2 as any);
      expect(similarity).toBeGreaterThan(0.8);
    });
  });

  describe('Longest Common Subsequence', () => {
    it('should calculate LCS for identical sequences', () => {
      const seq1 = [createMockStep({ action: 'click' }), createMockStep({ action: 'keyboard' })];
      const seq2 = [createMockStep({ action: 'click' }), createMockStep({ action: 'keyboard' })];

      const lcs = detector.longestCommonSubsequence(seq1, seq2);
      expect(lcs).toBe(2);
    });

    it('should calculate LCS for different sequences', () => {
      const seq1 = [createMockStep({ action: 'click' }), createMockStep({ action: 'keyboard' })];
      const seq2 = [createMockStep({ action: 'click' }), createMockStep({ action: 'drag' })];

      const lcs = detector.longestCommonSubsequence(seq1, seq2);
      expect(lcs).toBe(1);
    });
  });

  describe('Deduplication', () => {
    it('should deduplicate similar patterns', () => {
      const patterns = [
        {
          id: 'pattern-1',
          startIndex: 0,
          endIndex: 1,
          steps: [
            createMockStep({ action: 'click', target: '#button(100,200)', success: true, timestamp: Date.now() - 2000 }),
            createMockStep({ action: 'click', target: '#button(300,400)', success: true, timestamp: Date.now() - 1000 }),
          ],
          frequency: 1,
          successRate: 1,
          totalTime: 100,
          avgTime: 50,
        },
        {
          id: 'pattern-2',
          startIndex: 2,
          endIndex: 3,
          steps: [
            createMockStep({ action: 'click', target: '#button(500,600)', success: true, timestamp: Date.now() - 2000 }),
            createMockStep({ action: 'click', target: '#button(700,800)', success: true, timestamp: Date.now() - 1000 }),
          ],
          frequency: 1,
          successRate: 1,
          totalTime: 100,
          avgTime: 50,
        },
      ];

      const deduplicated = detector.deduplicatePatterns(patterns as any);
      expect(deduplicated.length).toBe(1);
    });
  });

  describe('Jaccard Similarity', () => {
    it('should calculate Jaccard similarity for sets', () => {
      const set1 = new Set([1, 2, 3]);
      const set2 = new Set([2, 3, 4]);

      const similarity = detector.jaccardSimilarity(set1, set2);
      expect(similarity).toBe(0.5); // {2,3} / {1,2,3,4}
    });

    it('should return 0 for disjoint sets', () => {
      const set1 = new Set([1, 2]);
      const set2 = new Set([3, 4]);

      const similarity = detector.jaccardSimilarity(set1, set2);
      expect(similarity).toBe(0);
    });

    it('should return 1 for identical sets', () => {
      const set1 = new Set([1, 2, 3]);
      const set2 = new Set([1, 2, 3]);

      const similarity = detector.jaccardSimilarity(set1, set2);
      expect(similarity).toBe(1);
    });
  });

  describe('Gap Detection', () => {
    it('should detect gaps between steps', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ timestamp: Date.now() - 3000, duration: 100 }),
        createMockStep({ timestamp: Date.now() - 500 }), // 2400ms gap
      ];

      const gaps = detector.findGaps(steps, 2000);

      expect(gaps.length).toBe(1);
      expect(gaps[0].gapMs).toBeGreaterThan(2000);
    });

    it('should not detect small gaps', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ timestamp: Date.now() - 1000, duration: 100 }),
        createMockStep({ timestamp: Date.now() - 200 }), // 700ms gap
      ];

      const gaps = detector.findGaps(steps, 2000);

      expect(gaps.length).toBe(0);
    });
  });

  describe('Branch Detection', () => {
    it('should detect conditional branches', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ target: '#button', action: 'click', timestamp: Date.now() }),
        createMockStep({ target: '#button', action: 'keyboard', timestamp: Date.now() + 100 }),
      ];

      const branches = detector.findBranches(steps);

      expect(branches.length).toBeGreaterThan(0);
      expect(branches[0].target).toBe('#button');
      expect(branches[0].branches.length).toBeGreaterThan(1);
    });
  });

  describe('Context Analysis', () => {
    it('should identify common action types', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', timestamp: Date.now() }),
        createMockStep({ action: 'click', timestamp: Date.now() + 100 }),
        createMockStep({ action: 'keyboard', timestamp: Date.now() + 200 }),
      ];

      const commonActions = detector.commonActionTypes(steps);

      expect(commonActions[0]).toBe('click');
    });

    it('should identify common selectors', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', target: '#button', timestamp: Date.now() }),
        createMockStep({ action: 'click', target: '#button', timestamp: Date.now() + 100 }),
        createMockStep({ action: 'click', target: '#other', timestamp: Date.now() + 200 }),
      ];

      const commonSelectors = detector.commonSelectors(steps);

      expect(commonSelectors[0]).toBe('#button');
    });

    it('should calculate average duration for action type', () => {
      const steps: WorkflowStep[] = [
        createMockStep({ action: 'click', duration: 100, timestamp: Date.now() }),
        createMockStep({ action: 'click', duration: 200, timestamp: Date.now() + 100 }),
        createMockStep({ action: 'keyboard', duration: 150, timestamp: Date.now() + 200 }),
      ];

      const avgDuration = detector.averageDurationForAction(steps, 'click');

      expect(avgDuration).toBe(150);
    });
  });
});
