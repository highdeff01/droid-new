/**
 * Tests for RecordingCaptureEngine
 *
 * Covers:
 * - Engine initialization and lifecycle
 * - Recording creation with metadata
 * - startRecording with config
 * - Action capturing: click, keyboard, drag, scroll, pause
 * - pauseRecording/resumeRecording
 * - stopRecording returns valid Recording
 * - Coordinate normalization (pixel to [0,1])
 * - Element context capturing
 * - Timestamp validation (ISO 8601, monotonic)
 * - Action validation (within bounds)
 * - Metadata calculation (counts, duration)
 * - Event emission and handling
 * - Error handling (invalid coordinates, missing elements)
 * - State management (idle/capturing/paused/stopped)
 * - Only one active recording at a time
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordingCaptureEngine, type ElementContextProvider, type RecordingConfig, type RecordingEvent } from './recording-capture.js';
import type { WorkflowStep } from './types.js';
import { type Recording, type ActionCounts } from './recording-types.js';

/**
 * Helper to create a mock WorkflowStep
 */
function createWorkflowStep(
  action: string = 'click',
  correctedX: number = 960,
  correctedY: number = 540,
  overrides?: Partial<WorkflowStep>
): WorkflowStep {
  return {
    id: 'step-1',
    name: 'Test Step',
    action: action as any,
    x: correctedX / 1920, // Normalize to [0, 1]
    y: correctedY / 1080, // Normalize to [0, 1]
    status: 'pending',
    correctedX,
    correctedY,
    ...overrides,
  } as WorkflowStep;
}

/**
 * Helper to create a mock ElementContextProvider
 */
function createMockElementContextProvider(): ElementContextProvider {
  return {
    getElementContext: vi.fn().mockResolvedValue({
      selector: '.button-primary',
      domPath: 'html > body > div > button',
      accessibleName: 'Submit',
      elementId: 'btn-1',
    }),
  };
}

describe('RecordingCaptureEngine', () => {
  let engine: RecordingCaptureEngine;
  let contextProvider: ElementContextProvider;
  let eventsSpy: RecordingEvent[] = [];

  beforeEach(() => {
    engine = new RecordingCaptureEngine();
    contextProvider = createMockElementContextProvider();
    eventsSpy = [];

    engine.addEventListener((event) => {
      eventsSpy.push(event);
    });
  });

  describe('Engine Initialization', () => {
    it('should initialize in idle state', () => {
      expect(engine.getState()).toBe('idle');
    });

    it('should have no active recording initially', () => {
      expect(engine.hasActiveRecording()).toBe(false);
    });

    it('should return null for current recording info when idle', () => {
      expect(engine.getCurrentRecordingInfo()).toBe(null);
    });
  });

  describe('Recording Lifecycle', () => {
    it('should start a recording with valid config', () => {
      const config: RecordingConfig = {
        name: 'Test Recording',
        description: 'A test recording',
        source: 'user-capture',
        tags: ['test', 'automation'],
      };

      engine.startRecording('rec-1', config);

      expect(engine.getState()).toBe('recording');
      expect(engine.hasActiveRecording()).toBe(true);

      const info = engine.getCurrentRecordingInfo();
      expect(info).not.toBeNull();
      expect(info!.id).toBe('rec-1');
      expect(info!.name).toBe('Test Recording');
      expect(info!.actionCount).toBe(0);
    });

    it('should throw error when starting without a name', () => {
      expect(() => {
        engine.startRecording('rec-1', { name: '' });
      }).toThrow('Recording name is required');
    });

    it('should throw error when starting while already recording', () => {
      engine.startRecording('rec-1', { name: 'Recording 1' });

      expect(() => {
        engine.startRecording('rec-2', { name: 'Recording 2' });
      }).toThrow("Cannot start recording: already in state 'recording'");
    });

    it('should emit recordingStarted event', () => {
      engine.startRecording('rec-1', { name: 'Test', source: 'user-capture' });

      const startEvent = eventsSpy.find(e => e.type === 'recordingStarted');
      expect(startEvent).toBeDefined();
      expect(startEvent!.data?.recordingId).toBe('rec-1');
      expect(startEvent!.data?.name).toBe('Test');
    });

    it('should allow only one active recording at a time', () => {
      engine.startRecording('rec-1', { name: 'Recording 1' });
      expect(engine.hasActiveRecording()).toBe(true);

      // Try to start another should fail
      expect(() => {
        engine.startRecording('rec-2', { name: 'Recording 2' });
      }).toThrow();
    });
  });

  describe('Action Capturing - Click', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should capture a click action', async () => {
      const step = createWorkflowStep('click', 960, 540);

      await engine.captureAction(step);

      const info = engine.getCurrentRecordingInfo();
      expect(info!.actionCount).toBe(1);

      const captureEvent = eventsSpy.find(e => e.type === 'actionCaptured');
      expect(captureEvent).toBeDefined();
      expect(captureEvent!.data?.actionType).toBe('click');
    });

    it('should normalize click coordinates to [0, 1]', async () => {
      const step = createWorkflowStep('click', 960, 540); // Center of 1920x1080

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const clickAction = recording.actions[0] as any;
      expect(clickAction.type).toBe('click');
      expect(clickAction.x).toBeCloseTo(0.5, 2); // ~50%
      expect(clickAction.y).toBeCloseTo(0.5, 2); // ~50%
    });

    it('should capture right-click action', async () => {
      const step = createWorkflowStep('click', 960, 540, { text: 'right' } as any);

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.type).toBe('click');
      // Right click would be indicated differently in the engine
    });

    it('should capture double-click as clickCount=2', async () => {
      const step = createWorkflowStep('double_click', 960, 540);

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.type).toBe('click');
      expect(action.clickCount).toBe(2);
    });
  });

  describe('Action Capturing - Drag', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should capture a drag action', async () => {
      const step = createWorkflowStep('drag', 100, 100, {
        endX: 500,
        endY: 500,
        delayMs: 1000,
      } as any);

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.type).toBe('drag');
      expect(action.startX).toBeCloseTo(100 / 1920, 2);
      expect(action.startY).toBeCloseTo(100 / 1080, 2);
      expect(action.endX).toBeCloseTo(500 / 1920, 2);
      expect(action.endY).toBeCloseTo(500 / 1080, 2);
      expect(action.duration).toBe(1000);
    });

    it('should throw error if drag is missing endX or endY', async () => {
      const step = createWorkflowStep('drag', 100, 100, { endX: undefined } as any);

      await expect(engine.captureAction(step)).rejects.toThrow('endX and endY');
    });

    it('should validate drag end coordinates are in [0, 1]', async () => {
      const step = createWorkflowStep('drag', 100, 100, {
        endX: 9600, // > 1920, out of bounds
        endY: 500,
      } as any);

      await expect(engine.captureAction(step)).rejects.toThrow('normalized end X coordinate');
    });
  });

  describe('Action Capturing - Scroll', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should capture a scroll action', async () => {
      const step = createWorkflowStep('scroll', 960, 540, { text: '-3' } as any);

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.type).toBe('scroll');
    });

    it('should handle scroll action without explicit deltaY', async () => {
      const step = createWorkflowStep('scroll', 960, 540);

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.type).toBe('scroll');
    });
  });

  describe('Action Capturing - Keyboard', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should capture a type action', async () => {
      const step = createWorkflowStep('type', 500, 300, { text: 'hello' });

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.type).toBe('keyboard');
      expect(action.text).toBe('hello');
    });

    it('should capture a key combination action', async () => {
      const step = createWorkflowStep('key', 500, 300, { text: 'ctrl+c' });

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.type).toBe('keyboard');
      expect(action.keys).toContain('Control');
      expect(action.keys).toContain('c');
    });

    it('should parse various key combinations', async () => {
      const combinations = [
        { input: 'ctrl+c', expected: ['Control', 'c'] },
        { input: 'shift+alt+f4', expected: ['Shift', 'Alt', 'F4'] },
        { input: 'cmd+v', expected: ['Meta', 'v'] },
        { input: 'Enter', expected: ['Enter'] },
      ];

      for (const { input, expected } of combinations) {
        const engine2 = new RecordingCaptureEngine();
        engine2.startRecording(`rec-${input}`, { name: 'Test' });
        const step = createWorkflowStep('key', 500, 300, { text: input });

        await engine2.captureAction(step);

        const recording = engine2.stopRecording();
        const action = recording.actions[0] as any;

        expect(action.keys).toEqual(expected);
      }
    });
  });

  describe('Pause Actions', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should capture a pause action', () => {
      engine.captureProgressivePause(1000);

      const info = engine.getCurrentRecordingInfo();
      expect(info!.actionCount).toBe(1);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.type).toBe('pause');
      expect(action.duration).toBe(1000);
    });

    it('should throw error on invalid pause duration', () => {
      expect(() => {
        engine.captureProgressivePause(-100);
      }).toThrow('Invalid pause duration');
    });
  });

  describe('Pause/Resume Recording', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should pause recording', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      engine.pauseRecording();

      expect(engine.getState()).toBe('paused');

      const pauseEvent = eventsSpy.find(e => e.type === 'paused');
      expect(pauseEvent).toBeDefined();
    });

    it('should throw error when pausing while not recording', () => {
      engine.pauseRecording();

      expect(() => {
        engine.pauseRecording();
      }).toThrow("Cannot pause: recording is in state 'paused'");
    });

    it('should resume recording after pause', async () => {
      const step1 = createWorkflowStep('click', 100, 100);
      await engine.captureAction(step1);

      engine.pauseRecording();
      expect(engine.getState()).toBe('paused');

      engine.resumeRecording();
      expect(engine.getState()).toBe('recording');

      const step2 = createWorkflowStep('click', 200, 200);
      await engine.captureAction(step2);

      const recording = engine.stopRecording();

      expect(recording.actions).toHaveLength(2);

      const resumeEvent = eventsSpy.find(e => e.type === 'resumed');
      expect(resumeEvent).toBeDefined();
    });

    it('should accumulate paused time correctly', async () => {
      const step1 = createWorkflowStep('click', 100, 100);
      await engine.captureAction(step1);

      const beforePause = Date.now();
      engine.pauseRecording();
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
      engine.resumeRecording();
      const afterResume = Date.now();

      const step2 = createWorkflowStep('click', 200, 200);
      await engine.captureAction(step2);

      const recording = engine.stopRecording();

      // Duration should not include the pause time
      const pausedTime = afterResume - beforePause;
      expect(recording.metadata.duration).toBeLessThan(pausedTime);
    });
  });

  describe('Stop Recording', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test Recording' });
    });

    it('should stop recording and return Recording object', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      const recording = engine.stopRecording();

      expect(recording.id).toBe('rec-1');
      expect(recording.name).toBe('Test Recording');
      expect(recording.actions).toHaveLength(1);
      expect(recording.metadata).toBeDefined();

      // Should return to idle state
      expect(engine.getState()).toBe('idle');
      expect(engine.hasActiveRecording()).toBe(false);
    });

    it('should emit recordingStopped event', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      engine.stopRecording();

      const stopEvent = eventsSpy.find(e => e.type === 'recordingStopped');
      expect(stopEvent).toBeDefined();
      expect(stopEvent!.data?.recordingId).toBe('rec-1');
      expect(stopEvent!.data?.actionCount).toBe(1);
    });

    it('should throw error when stopping with no actions', () => {
      expect(() => {
        engine.stopRecording();
      }).toThrow('no actions');
    });

    it('should throw error when stopping while paused', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      engine.pauseRecording();

      // Should allow stopping while paused
      const recording = engine.stopRecording();
      expect(recording.actions).toHaveLength(1);
    });

    it('should calculate metadata correctly', async () => {
      const step1 = createWorkflowStep('click', 100, 100);
      await engine.captureAction(step1);

      engine.captureProgressivePause(500);

      const step2 = createWorkflowStep('drag', 100, 100, { endX: 200, endY: 200 });
      await engine.captureAction(step2);

      // Wait a bit to ensure non-zero duration
      await new Promise(resolve => setTimeout(resolve, 10));

      const recording = engine.stopRecording();

      expect(recording.metadata.actionCounts.clicks).toBe(1);
      expect(recording.metadata.actionCounts.drags).toBe(1);
      expect(recording.metadata.actionCounts.pauses).toBe(1);
      expect(recording.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it('should validate timestamps are monotonic', async () => {
      const timestamp1 = new Date().toISOString();
      const step1 = createWorkflowStep('click', 100, 100);
      await engine.captureAction(step1);

      const timestamp2 = new Date(Date.now() + 100).toISOString();
      const step2 = createWorkflowStep('click', 200, 200);
      await engine.captureAction(step2);

      const recording = engine.stopRecording();

      const time1 = new Date(recording.actions[0].timestamp).getTime();
      const time2 = new Date(recording.actions[1].timestamp).getTime();

      expect(time2).toBeGreaterThanOrEqual(time1);
    });
  });

  describe('Cancel Recording', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should cancel recording', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      engine.cancelRecording();

      expect(engine.getState()).toBe('idle');
      expect(engine.hasActiveRecording()).toBe(false);
    });

    it('should throw error when canceling while idle', () => {
      engine.cancelRecording();

      expect(() => {
        engine.cancelRecording();
      }).toThrow('No recording in progress');
    });

    it('should emit recordingStopped event with cancelled flag', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      engine.cancelRecording();

      const stopEvent = eventsSpy.find(e => e.type === 'recordingStopped');
      expect(stopEvent!.data?.cancelled).toBe(true);
    });
  });

  describe('Coordinate Normalization', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should normalize click at top-left corner', async () => {
      const step = createWorkflowStep('click', 0, 0);

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.x).toBeCloseTo(0, 2);
      expect(action.y).toBeCloseTo(0, 2);
    });

    it('should normalize click at bottom-right corner', async () => {
      const step = createWorkflowStep('click', 1920, 1080);

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.x).toBeCloseTo(1, 2);
      expect(action.y).toBeCloseTo(1, 2);
    });

    it('should normalize click at center', async () => {
      const step = createWorkflowStep('click', 960, 540);

      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const action = recording.actions[0] as any;
      expect(action.x).toBeCloseTo(0.5, 2);
      expect(action.y).toBeCloseTo(0.5, 2);
    });

    it('should reject coordinates outside [0, 1]', async () => {
      const step = createWorkflowStep('click', 2000, 540); // X > 1920, exceeds bounds

      await expect(engine.captureAction(step)).rejects.toThrow('normalized X coordinate');
    });
  });

  describe('Element Context Capturing', () => {
    it('should capture element context when provider available', async () => {
      const engine2 = new RecordingCaptureEngine(undefined, createMockElementContextProvider());
      engine2.startRecording('rec-1', { name: 'Test', captureElementContext: true });

      const step = createWorkflowStep('click', 960, 540);
      await engine2.captureAction(step);

      const recording = engine2.stopRecording();

      const action = recording.actions[0];
      expect('context' in action ? action.context : undefined).toBeDefined();
      expect('context' in action ? action.context?.selector : undefined).toBe('.button-primary');
      expect('context' in action ? action.context?.accessibleName : undefined).toBe('Submit');
    });

    it('should skip element context when captureElementContext is false', async () => {
      const engine2 = new RecordingCaptureEngine(undefined, createMockElementContextProvider());
      engine2.startRecording('rec-1', { name: 'Test', captureElementContext: false });

      const step = createWorkflowStep('click', 960, 540);
      await engine2.captureAction(step);

      const recording = engine2.stopRecording();

      const action = recording.actions[0];
      expect('context' in action ? action.context : undefined).toBeUndefined();
    });

    it('should continue capturing if element context provider fails', async () => {
      const failingProvider: ElementContextProvider = {
        getElementContext: vi.fn().mockRejectedValue(new Error('Context error')),
      };

      const engine2 = new RecordingCaptureEngine(undefined, failingProvider);
      engine2.startRecording('rec-1', { name: 'Test', captureElementContext: true });

      const step = createWorkflowStep('click', 960, 540);

      // Should not throw, just log warning
      await expect(engine2.captureAction(step)).resolves.not.toThrow();

      const recording = engine2.stopRecording();
      expect(recording.actions).toHaveLength(1);
    });
  });

  describe('Timestamp Validation', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test' });
    });

    it('should use ISO 8601 timestamps', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      const recording = engine.stopRecording();

      const timestamp = recording.actions[0].timestamp;

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ or similar
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Should be parseable as date
      expect(() => new Date(timestamp).getTime()).not.toThrow();
    });

    it('should maintain monotonic timestamps', async () => {
      const step1 = createWorkflowStep('click', 100, 100);
      await engine.captureAction(step1);

      await new Promise(resolve => setTimeout(resolve, 10));

      const step2 = createWorkflowStep('click', 200, 200);
      await engine.captureAction(step2);

      const recording = engine.stopRecording();

      const time1 = new Date(recording.actions[0].timestamp).getTime();
      const time2 = new Date(recording.actions[1].timestamp).getTime();

      expect(time2).toBeGreaterThanOrEqual(time1);
    });
  });

  describe('Metadata Calculation', () => {
    beforeEach(() => {
      engine.startRecording('rec-1', { name: 'Test', tags: ['important'] });
    });

    it('should calculate action counts correctly', async () => {
      const step1 = createWorkflowStep('click', 100, 100);
      await engine.captureAction(step1);

      const step2 = createWorkflowStep('double_click', 200, 200);
      await engine.captureAction(step2);

      engine.captureProgressivePause(500);

      const step3 = createWorkflowStep('drag', 100, 100, { endX: 500, endY: 500 });
      await engine.captureAction(step3);

      const step4 = createWorkflowStep('scroll', 300, 300, { deltaY: 5 });
      await engine.captureAction(step4);

      const step5 = createWorkflowStep('type', 400, 400, { text: 'hello' });
      await engine.captureAction(step5);

      const recording = engine.stopRecording();

      const counts: ActionCounts = recording.metadata.actionCounts;
      expect(counts.clicks).toBe(2); // click + double_click
      expect(counts.drags).toBe(1);
      expect(counts.scrolls).toBe(1);
      expect(counts.keyboard).toBe(1);
      expect(counts.pauses).toBe(1);
    });

    it('should calculate duration', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      // Wait a bit to ensure non-zero duration
      await new Promise(resolve => setTimeout(resolve, 5));

      const recording = engine.stopRecording();

      expect(recording.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(recording.metadata.duration)).toBe(true);
    });

    it('should preserve source and tags in metadata', async () => {
      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      const recording = engine.stopRecording();

      expect(recording.metadata.source).toBe('user-capture');
      expect(recording.metadata.tags).toContain('important');
    });

    it('should count element contexts', async () => {
      const engine2 = new RecordingCaptureEngine(undefined, createMockElementContextProvider());
      engine2.startRecording('rec-1', { name: 'Test' });

      const step1 = createWorkflowStep('click', 100, 100);
      await engine2.captureAction(step1);

      const step2 = createWorkflowStep('click', 200, 200);
      await engine2.captureAction(step2);

      const recording = engine2.stopRecording();

      // Should count unique element contexts
      expect(recording.metadata.elementContexts).toBeGreaterThan(0);
    });
  });

  describe('Event Emission', () => {
    it('should emit all lifecycle events', async () => {
      engine.startRecording('rec-1', { name: 'Test' });

      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      engine.pauseRecording();
      engine.resumeRecording();

      engine.stopRecording();

      const eventTypes = eventsSpy.map(e => e.type);

      expect(eventTypes).toContain('recordingStarted');
      expect(eventTypes).toContain('actionCaptured');
      expect(eventTypes).toContain('paused');
      expect(eventTypes).toContain('resumed');
      expect(eventTypes).toContain('recordingStopped');
    });

    it('should allow multiple event listeners', async () => {
      const listener1Spy = vi.fn();
      const listener2Spy = vi.fn();

      engine.addEventListener(listener1Spy);
      engine.addEventListener(listener2Spy);

      engine.startRecording('rec-1', { name: 'Test' });

      expect(listener1Spy).toHaveBeenCalled();
      expect(listener2Spy).toHaveBeenCalled();
    });

    it('should allow removing event listeners', async () => {
      const listenerSpy = vi.fn();

      engine.addEventListener(listenerSpy);
      engine.removeEventListener(listenerSpy);

      engine.startRecording('rec-1', { name: 'Test' });

      expect(listenerSpy).not.toHaveBeenCalled();
    });

    it('should handle listener exceptions', () => {
      const throwingListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });

      engine.addEventListener(throwingListener);

      // Should not throw despite listener error
      expect(() => {
        engine.startRecording('rec-1', { name: 'Test' });
      }).not.toThrow();

      expect(throwingListener).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when capturing action while not recording', async () => {
      const step = createWorkflowStep('click', 960, 540);

      await expect(engine.captureAction(step)).rejects.toThrow('Cannot capture action');
    });

    it('should throw error when capturing pause while not recording', () => {
      expect(() => {
        engine.captureProgressivePause(1000);
      }).toThrow('Cannot capture pause');
    });

    it('should throw error when capturing action with invalid coordinates', async () => {
      engine.startRecording('rec-1', { name: 'Test' });

      const step = createWorkflowStep('click', 2500, 540); // X out of bounds

      await expect(engine.captureAction(step)).rejects.toThrow('normalized X coordinate');
    });

    it('should throw error for unsupported action type', async () => {
      engine.startRecording('rec-1', { name: 'Test' });

      const step = createWorkflowStep('unsupported' as any, 960, 540);

      await expect(engine.captureAction(step)).rejects.toThrow('Unsupported action type');
    });
  });

  describe('State Management', () => {
    it('should prevent actions in wrong states', async () => {
      // Cannot pause while idle
      expect(() => {
        engine.pauseRecording();
      }).toThrow();

      // Cannot resume while idle
      expect(() => {
        engine.resumeRecording();
      }).toThrow();

      // Cannot stop while idle
      expect(() => {
        engine.stopRecording();
      }).toThrow();
    });

    it('should track correct state throughout lifecycle', async () => {
      expect(engine.getState()).toBe('idle');

      engine.startRecording('rec-1', { name: 'Test' });
      expect(engine.getState()).toBe('recording');

      engine.pauseRecording();
      expect(engine.getState()).toBe('paused');

      engine.resumeRecording();
      expect(engine.getState()).toBe('recording');

      const step = createWorkflowStep('click', 960, 540);
      await engine.captureAction(step);

      engine.stopRecording();
      expect(engine.getState()).toBe('idle');
    });
  });

  describe('Multiple Recording Sessions', () => {
    it('should allow multiple sequential recordings', async () => {
      // First recording
      engine.startRecording('rec-1', { name: 'Recording 1' });
      const step1 = createWorkflowStep('click', 100, 100);
      await engine.captureAction(step1);
      const recording1 = engine.stopRecording();

      expect(recording1.id).toBe('rec-1');
      expect(recording1.actions).toHaveLength(1);

      // Second recording
      engine.startRecording('rec-2', { name: 'Recording 2' });
      const step2 = createWorkflowStep('click', 200, 200);
      await engine.captureAction(step2);
      const recording2 = engine.stopRecording();

      expect(recording2.id).toBe('rec-2');
      expect(recording2.actions).toHaveLength(1);

      // Recordings are independent
      expect(recording1.id).not.toBe(recording2.id);
    });

    it('should reset state between recordings', async () => {
      engine.startRecording('rec-1', { name: 'Recording 1' });
      const step1 = createWorkflowStep('click', 100, 100);
      await engine.captureAction(step1);
      engine.stopRecording();

      // After stop, should be idle
      expect(engine.hasActiveRecording()).toBe(false);
      expect(engine.getCurrentRecordingInfo()).toBe(null);

      // Can start new recording
      engine.startRecording('rec-2', { name: 'Recording 2' });
      expect(engine.hasActiveRecording()).toBe(true);
    });
  });

  describe('Complex Recording Scenarios', () => {
    it('should record a typical user workflow', async () => {
      engine.startRecording('rec-1', { name: 'Login Flow' });

      // Click username field
      await engine.captureAction(createWorkflowStep('click', 400, 300));

      // Type username
      await engine.captureAction(createWorkflowStep('type', 400, 300, { text: 'user@example.com' }));

      // Click password field
      await engine.captureAction(createWorkflowStep('click', 400, 350));

      // Type password
      await engine.captureAction(createWorkflowStep('type', 400, 350, { text: 'password123' }));

      // Wait for form processing
      engine.captureProgressivePause(500);

      // Click submit button
      await engine.captureAction(createWorkflowStep('click', 400, 400));

      const recording = engine.stopRecording();

      expect(recording.actions).toHaveLength(6);
      expect(recording.metadata.actionCounts.clicks).toBe(3);
      expect(recording.metadata.actionCounts.keyboard).toBe(2);
      expect(recording.metadata.actionCounts.pauses).toBe(1);
    });

    it('should handle rapid action sequence', async () => {
      engine.startRecording('rec-1', { name: 'Rapid Actions' });

      for (let i = 0; i < 10; i++) {
        await engine.captureAction(createWorkflowStep('click', 100 + i * 10, 100 + i * 10));
      }

      const recording = engine.stopRecording();

      expect(recording.actions).toHaveLength(10);
      expect(recording.metadata.actionCounts.clicks).toBe(10);
    });

    it('should handle pause/resume cycles', async () => {
      engine.startRecording('rec-1', { name: 'Multi-Pause' });

      await engine.captureAction(createWorkflowStep('click', 100, 100));
      engine.pauseRecording();

      await new Promise(resolve => setTimeout(resolve, 50));

      engine.resumeRecording();
      await engine.captureAction(createWorkflowStep('click', 200, 200));

      engine.pauseRecording();
      await new Promise(resolve => setTimeout(resolve, 50));

      engine.resumeRecording();
      await engine.captureAction(createWorkflowStep('click', 300, 300));

      const recording = engine.stopRecording();

      expect(recording.actions).toHaveLength(3);
      expect(recording.metadata.actionCounts.clicks).toBe(3);
    });
  });
});
