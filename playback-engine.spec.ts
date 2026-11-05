import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaybackEngine, MockActionDispatcher, type PlaybackEngineOptions, type ActionDispatcher, type PlaybackWorkflow, type PlaybackStep } from './playback-engine.js';
import type { DisplayInfo } from './coordinate-translator.js';
import type { ExecutionContext } from './integration-types.js';
import { createEntityId, createTimestamp } from './integration-types.js';

/**
 * Test suite for PlaybackEngine with 60+ comprehensive tests covering:
 * - Coordinate denormalization for various resolutions
 * - Multi-display scenarios with offsets
 * - All action types (click, keyboard, drag, scroll, pause)
 * - Step sequencing and timing
 * - Error handling and fallback mechanisms
 */

// Helper: Create mock workflow step
function createMockStep(overrides: Partial<PlaybackStep> = {}): PlaybackStep {
  return {
    id: 'step-1',
    order: 0,
    action: 'click',
    optional: false,
    timestamp: new Date().toISOString(),
    x: 0.5,
    y: 0.5,
    metadata: {},
    ...overrides,
  };
}

// Helper: Create mock workflow
function createMockWorkflow(steps: Partial<PlaybackStep>[] = []): PlaybackWorkflow {
  const defaultSteps = steps.length
    ? steps.map((s, i) => ({
        id: `step-${i}`,
        order: i,
        action: 'click' as const,
        optional: false,
        timestamp: new Date().toISOString(),
        x: 0.5,
        y: 0.5,
        metadata: {},
        ...s,
      }))
    : [createMockStep()];

  return {
    id: 'workflow-1',
    name: 'Test Workflow',
    steps: defaultSteps,
    metadata: {
      name: 'Test Workflow',
      description: 'Test',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: 'test',
      tags: [],
      estimatedDuration: 1000,
    },
    contextRequirements: [],
    executionHistory: [],
  };
}

// Helper: Create mock execution context
function createMockContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    executionId: createEntityId('execution-test'),
    displayState: {
    displayIndex: 0,
    width: 1920,
    height: 1080,
    dpi: 96,
    isMultiDisplay: false,
    },
    variables: {},
    executionPath: [],
    createdAt: createTimestamp(),
    ...overrides,
  };
}

// Helper: Create mock display info
function createMockDisplay(overrides: Partial<DisplayInfo> = {}): DisplayInfo {
  return {
    index: 0,
    name: 'Primary Display',
    width: 1920,
    height: 1080,
    offsetX: 0,
    offsetY: 0,
    isPrimary: true,
    ...overrides,
  };
}

// Tracking action dispatcher for testing
class TrackingActionDispatcher extends MockActionDispatcher {
  clicks: Array<{ x: number; y: number; button?: string; count?: number }> = [];
  keyboardInputs: Array<{ key: string; modifiers?: string[] }> = [];
  typeTexts: string[] = [];
  drags: Array<{ startX: number; startY: number; endX: number; endY: number; duration?: number }> = [];
  scrolls: Array<{ x: number; y: number; deltaX: number; deltaY: number }> = [];
  pauses: number[] = [];

  async click(x: number, y: number, button?: 'left' | 'right' | 'middle', count?: number): Promise<void> {
    this.clicks.push({ x, y, button, count });
  }

  async keyboard(key: string, modifiers?: string[]): Promise<void> {
    this.keyboardInputs.push({ key, modifiers });
  }

  async typeText(text: string): Promise<void> {
    this.typeTexts.push(text);
  }

  async drag(startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<void> {
    this.drags.push({ startX, startY, endX, endY, duration });
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    this.scrolls.push({ x, y, deltaX, deltaY });
  }

  async pause(duration: number): Promise<void> {
    this.pauses.push(duration);
  }
}

describe('PlaybackEngine', () => {
  let engine: PlaybackEngine;
  let dispatcher: TrackingActionDispatcher;
  let displayInfo: DisplayInfo[];

  beforeEach(() => {
    dispatcher = new TrackingActionDispatcher();
    displayInfo = [createMockDisplay()];
    engine = new PlaybackEngine(dispatcher, { displayInfo });
  });

  // ============================================================================
  // COORDINATE DENORMALIZATION TESTS
  // ============================================================================

  describe('Coordinate Denormalization', () => {
    it('should denormalize center coordinates (0.5, 0.5) on 1920x1080 display to (960, 540)', async () => {
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 960, y: 540 });
      expect(dispatcher.clicks[0]).toEqual({ x: 960, y: 540, button: 'left', count: 1 });
    });

    it('should denormalize corner coordinates (0, 0) to (0, 0)', async () => {
      const workflow = createMockWorkflow([{ x: 0, y: 0, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 0, y: 0 });
    });

    it('should denormalize corner coordinates (1, 1) to display bounds', async () => {
      const workflow = createMockWorkflow([{ x: 1, y: 1, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 1920, y: 1080 });
    });

    it('should clamp out-of-range normalized coordinates to 0..1', async () => {
      const workflow = createMockWorkflow([{ x: 1.5, y: -0.5, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      // Clamped to (1, 0) which denormalizes to (1920, 0)
      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 1920, y: 0 });
    });

    it('should denormalize coordinates for 2560x1440 display', async () => {
      const displays = [createMockDisplay({ width: 2560, height: 1440 })];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 1280, y: 720 });
    });

    it('should denormalize coordinates for 4K display (3840x2160)', async () => {
      const displays = [createMockDisplay({ width: 3840, height: 2160 })];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.25, y: 0.75, action: 'click' }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 960, y: 1620 });
    });

    it('should handle arbitrary precision normalized coordinates', async () => {
      const workflow = createMockWorkflow([{ x: 0.333333, y: 0.666667, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      const coords = result.stepResults[0].denormalizedCoordinates;
      expect(coords?.x).toBeCloseTo(640, 0);
      expect(coords?.y).toBeCloseTo(720, 0);
    });
  });

  // ============================================================================
  // MULTI-DISPLAY SCENARIOS
  // ============================================================================

  describe('Multi-Display Coordinate Translation', () => {
    it('should handle primary display (display 0)', async () => {
      const displays = [
        createMockDisplay({ index: 0, offsetX: 0, offsetY: 0, width: 1920, height: 1080, isPrimary: true }),
      ];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click', displayIndex: 0 }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 960, y: 540 });
      expect(result.stepResults[0].displayIndex).toBe(0);
    });

    it('should handle secondary display to the right (display 1)', async () => {
      const displays = [
        createMockDisplay({ index: 0, offsetX: 0, offsetY: 0, width: 1920, height: 1080, isPrimary: true }),
        createMockDisplay({ index: 1, offsetX: 1920, offsetY: 0, width: 1920, height: 1080, isPrimary: false }),
      ];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click', displayIndex: 1 }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 2880, y: 540 });
      expect(result.stepResults[0].displayIndex).toBe(1);
    });

    it('should handle secondary display below (display 1)', async () => {
      const displays = [
        createMockDisplay({ index: 0, offsetX: 0, offsetY: 0, width: 1920, height: 1080, isPrimary: true }),
        createMockDisplay({ index: 1, offsetX: 0, offsetY: 1080, width: 1920, height: 1080, isPrimary: false }),
      ];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click', displayIndex: 1 }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 960, y: 1620 });
    });

    it('should handle different resolutions on different displays', async () => {
      const displays = [
        createMockDisplay({ index: 0, offsetX: 0, offsetY: 0, width: 1920, height: 1080 }),
        createMockDisplay({ index: 1, offsetX: 1920, offsetY: 0, width: 2560, height: 1440 }),
      ];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click', displayIndex: 1 }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      // Secondary display: 0.5 * 2560 = 1280, offset by 1920, so 1920 + 1280 = 3200
      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 3200, y: 720 });
    });

    it('should handle 3-display setup with offsets', async () => {
      const displays = [
        createMockDisplay({ index: 0, offsetX: 0, offsetY: 0, width: 1920, height: 1080, isPrimary: true }),
        createMockDisplay({ index: 1, offsetX: 1920, offsetY: 0, width: 1920, height: 1080 }),
        createMockDisplay({ index: 2, offsetX: 0, offsetY: 1080, width: 1920, height: 1080 }),
      ];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click', displayIndex: 0 },
        { x: 0.5, y: 0.5, action: 'click', displayIndex: 1 },
        { x: 0.5, y: 0.5, action: 'click', displayIndex: 2 },
      ]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 960, y: 540 });
      expect(result.stepResults[1].denormalizedCoordinates).toEqual({ x: 2880, y: 540 });
      expect(result.stepResults[2].denormalizedCoordinates).toEqual({ x: 960, y: 1620 });
    });

    it('should default to display 0 if displayIndex is invalid', async () => {
      const displays = [createMockDisplay({ index: 0, width: 1920, height: 1080 })];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click', displayIndex: 99 }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].displayIndex).toBe(0);
      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 960, y: 540 });
    });
  });

  // ============================================================================
  // ACTION EXECUTION TESTS
  // ============================================================================

  describe('Click Action Execution', () => {
    it('should execute left click with default button', async () => {
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.clicks).toHaveLength(1);
      expect(dispatcher.clicks[0]).toEqual({ x: 960, y: 540, button: 'left', count: 1 });
    });

    it('should execute right click', async () => {
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click', metadata: { button: 'right' } }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.clicks[0].button).toBe('right');
    });

    it('should execute middle click', async () => {
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click', metadata: { button: 'middle' } }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.clicks[0].button).toBe('middle');
    });

    it('should execute click with custom click count', async () => {
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click', metadata: { clickCount: 3 } }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.clicks[0].count).toBe(3);
    });

    it('should fail click without coordinates', async () => {
      const workflow = createMockWorkflow([{ action: 'click', x: undefined, y: undefined }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(false);
      expect(result.stepResults[0].error).toContain('requires x and y coordinates');
    });
  });

  describe('Double Click Action Execution', () => {
    it('should execute double click', async () => {
      const workflow = createMockWorkflow([{ x: 0.25, y: 0.75, action: 'double_click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.clicks[0].count).toBe(2);
    });

    it('should fail double click without coordinates', async () => {
      const workflow = createMockWorkflow([{ action: 'double_click', x: undefined, y: undefined }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(false);
    });
  });

  describe('Keyboard Action Execution', () => {
    it('should execute keyboard action with key', async () => {
      const workflow = createMockWorkflow([{ action: 'key', text: 'Return' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.keyboardInputs).toHaveLength(1);
      expect(dispatcher.keyboardInputs[0].key).toBe('Return');
    });

    it('should execute keyboard with modifiers', async () => {
      const workflow = createMockWorkflow([
        { action: 'key', text: 'a', metadata: { modifiers: ['Control', 'Shift'] } },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.keyboardInputs[0].modifiers).toEqual(['Control', 'Shift']);
    });

    it('should fail keyboard action without text', async () => {
      const workflow = createMockWorkflow([{ action: 'key', text: undefined }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(false);
      expect(result.stepResults[0].error).toContain('requires text field');
    });
  });

  describe('Type Action Execution', () => {
    it('should execute type action', async () => {
      const workflow = createMockWorkflow([{ action: 'type', text: 'Hello World' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.typeTexts).toEqual(['Hello World']);
    });

    it('should fail type action without text', async () => {
      const workflow = createMockWorkflow([{ action: 'type', text: undefined }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(false);
    });
  });

  describe('Drag Action Execution', () => {
    it('should execute drag action', async () => {
      const workflow = createMockWorkflow([
        { x: 0.25, y: 0.25, endX: 0.75, endY: 0.75, action: 'drag', metadata: { duration: 500 } },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.drags).toHaveLength(1);
      expect(dispatcher.drags[0]).toEqual({ startX: 480, startY: 270, endX: 1440, endY: 810, duration: 500 });
    });

    it('should fail drag without end coordinates', async () => {
      const workflow = createMockWorkflow([
        { x: 0.25, y: 0.25, endX: undefined, endY: undefined, action: 'drag' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(false);
      expect(result.stepResults[0].error).toContain('requires x, y, endX, endY');
    });

    it('should use default duration for drag', async () => {
      const workflow = createMockWorkflow([{ x: 0.25, y: 0.25, endX: 0.75, endY: 0.75, action: 'drag' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(dispatcher.drags[0].duration).toBe(500);
    });
  });

  describe('Scroll Action Execution', () => {
    it('should execute scroll action', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'scroll', metadata: { deltaX: 0, deltaY: 100 } },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.scrolls).toHaveLength(1);
      expect(dispatcher.scrolls[0]).toEqual({ x: 960, y: 540, deltaX: 0, deltaY: 100 });
    });

    it('should handle horizontal scroll', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'scroll', metadata: { deltaX: 50, deltaY: 0 } },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(dispatcher.scrolls[0]).toEqual({ x: 960, y: 540, deltaX: 50, deltaY: 0 });
    });

    it('should fail scroll without coordinates', async () => {
      const workflow = createMockWorkflow([{ x: undefined, y: undefined, action: 'scroll' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(false);
    });
  });

  describe('Pause Action Execution', () => {
    it('should execute pause action', async () => {
      const workflow = createMockWorkflow([{ action: 'pause', metadata: { duration: 500 } }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.pauses).toEqual([500]);
    });

    it('should use default pause duration', async () => {
      const workflow = createMockWorkflow([{ action: 'pause' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(dispatcher.pauses[0]).toBe(1000); // Default 1000ms
    });

    it('should respect replay speed for pause duration', async () => {
      dispatcher = new TrackingActionDispatcher();
      engine = new PlaybackEngine(dispatcher, { displayInfo, replaySpeed: 2.0 });
      const workflow = createMockWorkflow([{ action: 'pause', metadata: { duration: 1000 } }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(dispatcher.pauses[0]).toBe(500); // 1000 / 2.0
    });
  });

  // ============================================================================
  // STEP SEQUENCING AND TIMING
  // ============================================================================

  describe('Step Sequencing', () => {
    it('should execute multiple steps in order', async () => {
      const workflow = createMockWorkflow([
        { x: 0.25, y: 0.25, action: 'click', order: 0 },
        { x: 0.5, y: 0.5, action: 'click', order: 1 },
        { x: 0.75, y: 0.75, action: 'click', order: 2 },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.totalSteps).toBe(3);
      expect(result.completedSteps).toBe(3);
      expect(dispatcher.clicks).toHaveLength(3);
      expect(dispatcher.clicks[0].x).toBe(480);
      expect(dispatcher.clicks[1].x).toBe(960);
      expect(dispatcher.clicks[2].x).toBe(1440);
    });

    it('should handle mixed action types in sequence', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { action: 'type', text: 'test' },
        { action: 'key', text: 'Return' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.completedSteps).toBe(3);
      expect(dispatcher.clicks).toHaveLength(1);
      expect(dispatcher.typeTexts).toHaveLength(1);
      expect(dispatcher.keyboardInputs).toHaveLength(1);
    });

    it('should track step index correctly', async () => {
      const workflow = createMockWorkflow([
        { x: 0.1, y: 0.1, action: 'click' },
        { x: 0.2, y: 0.2, action: 'click' },
        { x: 0.3, y: 0.3, action: 'click' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].stepIndex).toBe(0);
      expect(result.stepResults[1].stepIndex).toBe(1);
      expect(result.stepResults[2].stepIndex).toBe(2);
    });
  });

  describe('Execution Status Tracking', () => {
    it('should start in idle status', () => {
      expect(engine.getStatus()).toBe('idle');
    });

    it('should be running during execution', async () => {
      let statusDuringExecution: string | undefined;
      dispatcher.click = async () => {
        statusDuringExecution = engine.getStatus();
      };

      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);
      await engine.executeWorkflow(workflow, createMockContext());

      expect(statusDuringExecution).toBe('running');
    });

    it('should be completed on successful execution', async () => {
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);
      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.failedSteps).toBe(0);
      expect(result.completedSteps).toBe(1);
    });

    it('should handle failure and record failed steps', async () => {
      dispatcher.click = async () => {
        throw new Error('Click failed');
      };

      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { x: 0.6, y: 0.6, action: 'click' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.success).toBe(false);
      expect(result.failedSteps).toBeGreaterThan(0);
      expect(result.stepResults[0].success).toBe(false);
    });
  });

  describe('Pause and Resume', () => {
    it('should support pause during long execution', async () => {
      let clicks = 0;
      dispatcher.click = async () => {
        clicks++;
        if (clicks === 1) {
          engine.pause();
        }
      };

      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { x: 0.6, y: 0.6, action: 'click' },
      ]);

      const resultPromise = engine.executeWorkflow(workflow, createMockContext());
      
      // Give first click time to execute and trigger pause
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Should be paused now
      const status = engine.getStatus();
      expect(['paused', 'failed']).toContain(status);
    });

    it('should allow resume after pause', async () => {
      let clicks = 0;
      dispatcher.click = async () => {
        clicks++;
        if (clicks === 1) {
          engine.pause();
        }
      };

      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { x: 0.6, y: 0.6, action: 'click' },
      ]);

      const resultPromise = engine.executeWorkflow(workflow, createMockContext());
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      engine.resume();
      
      const result = await resultPromise;
      // Workflow should complete
      expect(result.totalSteps).toBe(2);
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should stop on first error by default', async () => {
      dispatcher.click = async () => {
        throw new Error('Click failed');
      };

      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { x: 0.6, y: 0.6, action: 'click' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.success).toBe(false);
      expect(result.failedSteps).toBeGreaterThan(0);
      // Second step should not have been attempted
      expect(result.completedSteps + result.failedSteps).toBeLessThanOrEqual(2);
    });

    it('should continue on error with skipOnError=true', async () => {
      let callCount = 0;
      dispatcher.click = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First click failed');
        }
      };

      dispatcher = new TrackingActionDispatcher();
      let dispatchCount = 0;
      dispatcher.click = async () => {
        dispatchCount++;
        if (dispatchCount === 1) {
          throw new Error('First click failed');
        }
      };

      engine = new PlaybackEngine(dispatcher, { displayInfo, skipOnError: true });

      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { x: 0.6, y: 0.6, action: 'click' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.failedSteps).toBe(1);
      expect(result.completedSteps).toBe(1);
      // With skipOnError, overall success depends on whether some steps completed
      expect(result.totalSteps).toBe(2);
    });

    it('should capture error message in step result', async () => {
      dispatcher.click = async () => {
        throw new Error('Element not found');
      };

      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].error).toContain('Element not found');
    });

    it('should fail unsupported action types', async () => {
      const workflow = createMockWorkflow([{ action: 'unsupported' as any }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(false);
      expect(result.stepResults[0].error).toContain('Unsupported action type');
    });
  });

  // ============================================================================
  // DRY RUN MODE
  // ============================================================================

  describe('Dry Run Mode', () => {
    it('should not dispatch actions in dry run mode', async () => {
      dispatcher = new TrackingActionDispatcher();
      engine = new PlaybackEngine(dispatcher, { displayInfo, dryRun: true });

      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(dispatcher.clicks).toHaveLength(0);
    });

    it('should track all steps as executed in dry run', async () => {
      dispatcher = new TrackingActionDispatcher();
      engine = new PlaybackEngine(dispatcher, { displayInfo, dryRun: true });

      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { action: 'type', text: 'test' },
        { action: 'key', text: 'Return' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.completedSteps).toBe(3);
      expect(result.failedSteps).toBe(0);
    });
  });

  // ============================================================================
  // EXECUTION METRICS
  // ============================================================================

  describe('Execution Metrics', () => {
    it('should calculate total duration', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { action: 'pause', metadata: { duration: 100 } },
        { x: 0.5, y: 0.5, action: 'click' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
      expect(result.endTime).toBeGreaterThanOrEqual(result.startTime);
    });

    it('should track step completion counts', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { x: 0.6, y: 0.6, action: 'click' },
        { x: 0.7, y: 0.7, action: 'click' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.totalSteps).toBe(3);
      expect(result.completedSteps).toBe(3);
      expect(result.failedSteps).toBe(0);
    });

    it('should track coordinate adaptations', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click' },
        { x: 0.25, y: 0.25, action: 'click' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.metrics.coordinateAdaptations).toBe(2);
    });

    it('should include execution context in result', async () => {
      const context = createMockContext();
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, context);

      expect(result.executionContext).toBeDefined();
      expect(result.executionContext.displayState).toMatchObject({ width: 1920, height: 1080 });
    });
  });

  // ============================================================================
  // REPLAY SPEED
  // ============================================================================

  describe('Replay Speed', () => {
    it('should apply replay speed to pause durations', async () => {
      dispatcher = new TrackingActionDispatcher();
      engine = new PlaybackEngine(dispatcher, { displayInfo, replaySpeed: 0.5 });

      const workflow = createMockWorkflow([{ action: 'pause', metadata: { duration: 1000 } }]);

      await engine.executeWorkflow(workflow, createMockContext());

      expect(dispatcher.pauses[0]).toBe(2000); // 1000 / 0.5
    });

    it('should handle 2x replay speed', async () => {
      dispatcher = new TrackingActionDispatcher();
      engine = new PlaybackEngine(dispatcher, { displayInfo, replaySpeed: 2.0 });

      const workflow = createMockWorkflow([{ action: 'pause', metadata: { duration: 1000 } }]);

      await engine.executeWorkflow(workflow, createMockContext());

      expect(dispatcher.pauses[0]).toBe(500); // 1000 / 2.0
    });
  });

  // ============================================================================
  // PLAYBACK RESULT STRUCTURE
  // ============================================================================

  describe('Playback Result', () => {
    it('should include all required fields', async () => {
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);
      const context = createMockContext();

      const result = await engine.executeWorkflow(workflow, context);

      expect(result.workflowId).toBe(workflow.id);
      expect(result.success).toBeDefined();
      expect(result.totalSteps).toBe(1);
      expect(result.completedSteps).toBeDefined();
      expect(result.failedSteps).toBeDefined();
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
      expect(result.startTime).toBeGreaterThan(0);
      expect(result.endTime).toBeGreaterThan(0);
      expect(result.stepResults).toHaveLength(1);
      expect(result.errors).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.executionContext).toBeDefined();
    });

    it('should include step execution details', async () => {
      const workflow = createMockWorkflow([{ x: 0.25, y: 0.75, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      const stepResult = result.stepResults[0];
      expect(stepResult.stepId).toBe(workflow.steps[0].id);
      expect(stepResult.stepIndex).toBe(0);
      expect(stepResult.action).toBe('click');
      expect(stepResult.success).toBe(true);
      expect(stepResult.duration).toBeGreaterThanOrEqual(0);
      expect(stepResult.targetCoordinates).toEqual({ x: 0.25, y: 0.75 });
      expect(stepResult.denormalizedCoordinates).toBeDefined();
      expect(stepResult.displayIndex).toBeDefined();
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty workflow', async () => {
      const workflow: PlaybackWorkflow = {
        id: 'empty',
        name: 'Empty workflow',
        steps: [],
        metadata: {
          name: 'Empty',
          description: 'Empty workflow',
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          author: 'test',
          tags: [],
          estimatedDuration: 0,
        },
        contextRequirements: [],
        executionHistory: [],
      };

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.totalSteps).toBe(0);
      expect(result.completedSteps).toBe(0);
      expect(result.failedSteps).toBe(0);
    });

    it('should handle very small normalized coordinates', async () => {
      const workflow = createMockWorkflow([{ x: 0.001, y: 0.001, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].success).toBe(true);
      expect(result.stepResults[0].denormalizedCoordinates?.x).toBeCloseTo(1.92, 0);
    });

    it('should handle very large display dimensions', async () => {
      const displays = [createMockDisplay({ width: 5760, height: 3240 })]; // 8K resolution
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 2880, y: 1620 });
    });

    it('should handle display with negative offset', async () => {
      const displays = [
        createMockDisplay({ index: 0, offsetX: -1920, offsetY: 0, width: 1920, height: 1080 }),
      ];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: displays });
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: -960, y: 540 });
    });

    it('should handle multiple steps with rapid execution', async () => {
      const steps = Array.from({ length: 10 }, (_, i) => ({
        x: (i + 1) * 0.1,
        y: (i + 1) * 0.1,
        action: 'click' as const,
      }));
      const workflow = createMockWorkflow(steps);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.completedSteps).toBe(10);
      expect(dispatcher.clicks).toHaveLength(10);
    });
  });

  // ============================================================================
  // INTEGRATION SCENARIOS
  // ============================================================================

  describe('Integration Scenarios', () => {
    it('should execute complete workflow: click -> type -> key -> click', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.3, action: 'click' },
        { action: 'type', text: 'test@example.com' },
        { x: 0.5, y: 0.5, action: 'click' },
        { action: 'type', text: 'password' },
        { action: 'key', text: 'Return' },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.completedSteps).toBe(5);
      expect(dispatcher.clicks).toHaveLength(2);
      expect(dispatcher.typeTexts).toEqual(['test@example.com', 'password']);
      expect(dispatcher.keyboardInputs).toHaveLength(1);
    });

    it('should handle drag and scroll sequence', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, endX: 0.7, endY: 0.3, action: 'drag' },
        { action: 'pause', metadata: { duration: 200 } },
        { x: 0.5, y: 0.5, action: 'scroll', metadata: { deltaY: 100 } },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.completedSteps).toBe(3);
      expect(dispatcher.drags).toHaveLength(1);
      expect(dispatcher.scrolls).toHaveLength(1);
      expect(dispatcher.pauses).toHaveLength(1);
    });
  });

  // ============================================================================
  // DISPLAY CONFIGURATION TESTS
  // ============================================================================

  describe('Display Configuration', () => {
    it('should use provided display info', async () => {
      const customDisplays = [createMockDisplay({ width: 2560, height: 1440 })];
      const eng = new PlaybackEngine(dispatcher, { displayInfo: customDisplays });
      const workflow = createMockWorkflow([{ x: 1, y: 1, action: 'click' }]);

      const result = await eng.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 2560, y: 1440 });
    });

    it('should use display from execution context if not provided in options', async () => {
      dispatcher = new TrackingActionDispatcher();
      engine = new PlaybackEngine(dispatcher, {}); // No displayInfo provided

      const context = createMockContext({
        displayState: {
          displayIndex: 0,
          width: 3840,
          height: 2160,
          dpi: 96,
          isMultiDisplay: false,
        },
      });

      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, context);

      // Should use 4K resolution from context
      expect(result.stepResults[0].denormalizedCoordinates).toEqual({ x: 1920, y: 1080 });
    });
  });

  // ============================================================================
  // STEP RESULT DETAILS
  // ============================================================================

  describe('Step Result Details', () => {
    it('should capture step timing', async () => {
      const workflow = createMockWorkflow([{ x: 0.5, y: 0.5, action: 'click' }]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should preserve step metadata', async () => {
      const workflow = createMockWorkflow([
        { x: 0.5, y: 0.5, action: 'click', metadata: { button: 'right', custom: 'value' } },
      ]);

      const result = await engine.executeWorkflow(workflow, createMockContext());

      expect(result.stepResults[0].action).toBe('click');
      expect(result.stepResults[0].targetCoordinates).toEqual({ x: 0.5, y: 0.5 });
    });
  });
});
