/**
 * Recording to Workflow Converter Tests
 *
 * Comprehensive tests for RecordingToWorkflowConverter including:
 * - Simple recordings with clicks, keyboard, drag, scroll
 * - Coordinate preservation (0..1 range)
 * - Metadata preservation (author, timestamp, tags)
 * - Pause grouping and timing
 * - Edge cases: empty, only pauses, mixed types
 * - Description generation for all action types
 * - Workflow validation
 * - Context condition creation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecordingToWorkflowConverter,
  recordingToWorkflow,
  validateConvertedWorkflow,
  type ConversionOptions,
  type ValidationResult,
} from './recording-to-workflow-converter.js';
import {
  createRecording,
  createClickAction,
  createKeyboardAction,
  createDragAction,
  createScrollAction,
  createPauseAction,
  createActionContext,
  type Recording,
} from './recording-types.js';
import {
  createExecutionPolicy,
  type Workflow,
} from './workflow-types.js';

describe('RecordingToWorkflowConverter', () => {
  let converter: RecordingToWorkflowConverter;

  const now = new Date('2024-01-15T10:30:00.000Z');
  const timestamp = (offsetMs: number): string =>
    new Date(now.getTime() + offsetMs).toISOString();

  beforeEach(() => {
    converter = new RecordingToWorkflowConverter();
  });

  describe('Basic Conversion', () => {
    it('should convert a simple click recording', () => {
      const recording = createRecording(
        'rec-1',
        'Click Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording);

      expect(workflow.id).toBeDefined();
      expect(workflow.name).toBe('Click Test');
      expect(workflow.steps).toHaveLength(1);
      expect(workflow.metadata.version).toBe('1.0.0');
      expect(workflow.metadata.source).toBe('user-created');
    });

    it('should convert recording with multiple actions', () => {
      const recording = createRecording(
        'rec-2',
        'Multi-Action Recording',
        [
          createClickAction(timestamp(0), 0.5, 0.5),
          createKeyboardAction(timestamp(100), ['a']),
          createClickAction(timestamp(200), 0.6, 0.6),
        ],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(3);
      expect(workflow.steps[0].name).toContain('click');
      expect(workflow.steps[1].name).toContain('Press');
      expect(workflow.steps[2].name).toContain('click');
    });

    it('should preserve recording metadata', () => {
      const recording = createRecording(
        'rec-3',
        'Test Recording',
        [createClickAction(timestamp(0), 0.5, 0.5)],
        'user-capture',
        'Test Description',
        ['automation', 'test'],
      );

      const workflow = converter.convert(recording, {
        tags: ['custom-tag'],
      });

      expect(workflow.description).toBe('Test Description');
      expect(workflow.metadata.tags).toContain('automation');
      expect(workflow.metadata.tags).toContain('test');
      expect(workflow.metadata.tags).toContain('custom-tag');
    });

    it('should handle custom version', () => {
      const recording = createRecording(
        'rec-4',
        'Version Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording, {
        version: '2.5.3',
      });

      expect(workflow.metadata.version).toBe('2.5.3');
    });

    it('should use custom execution policy', () => {
      const recording = createRecording(
        'rec-5',
        'Policy Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const customPolicy = createExecutionPolicy(
        'parallel',
        'stop',
        true,
        5,
        2000,
      );

      const workflow = converter.convert(recording, {
        executionPolicy: customPolicy,
      });

      expect(workflow.steps[0].policy.type).toBe('parallel');
      expect(workflow.steps[0].policy.onError).toBe('stop');
      expect(workflow.steps[0].policy.maxRetries).toBe(5);
    });

    it('should generate descriptions when enabled', () => {
      const recording = createRecording(
        'rec-6',
        'Descriptions Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording, {
        generateDescriptions: true,
      });

      expect(workflow.steps[0].description).toContain('click');
      expect(workflow.steps[0].description).toContain('0.50');
    });

    it('should skip descriptions when disabled', () => {
      const recording = createRecording(
        'rec-7',
        'No Descriptions Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording, {
        generateDescriptions: false,
      });

      expect(workflow.steps[0].name).toBe('Step 1');
      expect(workflow.steps[0].description).toBeUndefined();
    });
  });

  describe('Action Type Conversion', () => {
    it('should convert click actions with correct coordinates', () => {
      const recording = createRecording(
        'rec-8',
        'Click Conversion',
        [
          createClickAction(timestamp(0), 0.25, 0.75, 'left', 1),
          createClickAction(timestamp(100), 0.5, 0.5, 'right', 2),
        ],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps[0].description).toContain('0.25');
      expect(workflow.steps[0].description).toContain('0.75');
      expect(workflow.steps[1].description).toContain('right button');
      expect(workflow.steps[1].description).toContain('double-click');
    });

    it('should convert keyboard actions with text input', () => {
      const recording = createRecording(
        'rec-9',
        'Keyboard Text',
        [createKeyboardAction(timestamp(0), ['a', 'b', 'c'], 'abc')],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps[0].description).toContain('Type');
      expect(workflow.steps[0].description).toContain('abc');
    });

    it('should convert keyboard actions with key combinations', () => {
      const recording = createRecording(
        'rec-10',
        'Keyboard Keys',
        [createKeyboardAction(timestamp(0), ['Control', 'c'])],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps[0].description).toContain('Control+c');
    });

    it('should convert drag actions with start and end coordinates', () => {
      const recording = createRecording(
        'rec-11',
        'Drag Conversion',
        [createDragAction(timestamp(0), 0.2, 0.3, 0.8, 0.9, 500)],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps[0].description).toContain('Drag');
      expect(workflow.steps[0].description).toContain('0.20');
      expect(workflow.steps[0].description).toContain('0.30');
      expect(workflow.steps[0].description).toContain('0.80');
      expect(workflow.steps[0].description).toContain('0.90');
      expect(workflow.steps[0].description).toContain('500ms');
    });

    it('should convert scroll actions with delta information', () => {
      const recording = createRecording(
        'rec-12',
        'Scroll Conversion',
        [
          createScrollAction(timestamp(0), 0.5, 0.5, 0, 200),
          createScrollAction(timestamp(100), 0.5, 0.5, -100, 0),
        ],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps[0].description).toContain('Scroll down');
      expect(workflow.steps[1].description).toContain('Scroll left');
    });

    it('should convert pause actions', () => {
      const recording = createRecording(
        'rec-13',
        'Pause Conversion',
        [
          createClickAction(timestamp(0), 0.5, 0.5),
          createPauseAction(timestamp(100), 500),
          createClickAction(timestamp(600), 0.6, 0.6),
        ],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(3);
      expect(workflow.steps[1].description).toContain('Wait');
      expect(workflow.steps[1].description).toContain('500ms');
    });
  });

  describe('Coordinate Preservation', () => {
    it('should preserve coordinates within 0..1 range', () => {
      const coords = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
      const actions = coords.map((x, idx) =>
        createClickAction(timestamp(idx * 100), x, x),
      );

      const recording = createRecording('rec-14', 'Coord Preservation', actions);
      const workflow = converter.convert(recording);

      for (let i = 0; i < coords.length; i++) {
        const description = workflow.steps[i].description || '';
        const formattedCoord = coords[i].toFixed(2);
        expect(description).toContain(formattedCoord);
      }
    });

    it('should reject recordings with invalid coordinates', () => {
      const invalidRecording = createRecording(
        'rec-invalid',
        'Invalid Coords',
        [createClickAction(timestamp(0), 1.5, 0.5)], // x > 1
      );

      expect(() => {
        converter.convert(invalidRecording);
      }).toThrow();
    });

    it('should validate coordinate boundaries', () => {
      const recording = createRecording(
        'rec-15',
        'Boundary Test',
        [
          createClickAction(timestamp(0), 0, 0), // Bottom-left
          createClickAction(timestamp(100), 1, 1), // Top-right
        ],
      );

      const workflow = converter.convert(recording);
      expect(workflow.steps).toHaveLength(2);
    });
  });

  describe('Pause Grouping', () => {
    it('should group consecutive pauses by default', () => {
      const recording = createRecording(
        'rec-16',
        'Pause Grouping',
        [
          createClickAction(timestamp(0), 0.5, 0.5),
          createPauseAction(timestamp(100), 100),
          createPauseAction(timestamp(200), 150),
          createPauseAction(timestamp(350), 200),
          createClickAction(timestamp(550), 0.6, 0.6),
        ],
      );

      const workflow = converter.convert(recording, { groupPauses: true });

      expect(workflow.steps).toHaveLength(3);
      expect(workflow.steps[1].description).toContain('450ms'); // 100 + 150 + 200
    });

    it('should not group pauses when disabled', () => {
      const recording = createRecording(
        'rec-17',
        'No Pause Grouping',
        [
          createClickAction(timestamp(0), 0.5, 0.5),
          createPauseAction(timestamp(100), 100),
          createPauseAction(timestamp(200), 150),
          createClickAction(timestamp(350), 0.6, 0.6),
        ],
      );

      const workflow = converter.convert(recording, { groupPauses: false });

      expect(workflow.steps).toHaveLength(4);
    });

    it('should handle leading pauses', () => {
      const recording = createRecording(
        'rec-18',
        'Leading Pauses',
        [
          createPauseAction(timestamp(0), 100),
          createPauseAction(timestamp(100), 200),
          createClickAction(timestamp(300), 0.5, 0.5),
        ],
      );

      const workflow = converter.convert(recording, { groupPauses: true });

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps[0].description).toContain('300ms'); // 100 + 200
    });

    it('should handle trailing pauses', () => {
      const recording = createRecording(
        'rec-19',
        'Trailing Pauses',
        [
          createClickAction(timestamp(0), 0.5, 0.5),
          createPauseAction(timestamp(100), 150),
          createPauseAction(timestamp(250), 250),
        ],
      );

      const workflow = converter.convert(recording, { groupPauses: true });

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps[1].description).toContain('400ms'); // 150 + 250
    });

    it('should handle mixed pauses and actions', () => {
      const recording = createRecording(
        'rec-20',
        'Mixed Pauses',
        [
          createClickAction(timestamp(0), 0.5, 0.5),
          createPauseAction(timestamp(100), 100),
          createKeyboardAction(timestamp(200), ['a']),
          createPauseAction(timestamp(300), 200),
          createPauseAction(timestamp(500), 100),
          createClickAction(timestamp(600), 0.6, 0.6),
        ],
      );

      const workflow = converter.convert(recording, { groupPauses: true });

      expect(workflow.steps).toHaveLength(5);
    });
  });

  describe('Context and Conditions', () => {
    it('should create conditions from element context', () => {
      const context = createActionContext(
        '.submit-button',
        'html > body > form > button',
        'Submit',
        'btn-123',
      );

      const recording = createRecording(
        'rec-21',
        'Context Test',
        [createClickAction(timestamp(0), 0.5, 0.5, 'left', 1, context)],
      );

      const workflow = converter.convert(recording, {
        includeContextConditions: true,
      });

      expect(workflow.steps[0].conditions).toBeDefined();
      expect(workflow.steps[0].conditions!.length).toBeGreaterThan(0);
    });

    it('should include selector in conditions', () => {
      const context = createActionContext('.button', undefined, undefined);
      const recording = createRecording(
        'rec-22',
        'Selector Condition',
        [createClickAction(timestamp(0), 0.5, 0.5, 'left', 1, context)],
      );

      const workflow = converter.convert(recording);

      const conditions = workflow.steps[0].conditions || [];
      const selectorCondition = conditions.find((c) =>
        (c as any).variable?.includes('Selector'),
      );
      expect(selectorCondition).toBeDefined();
    });

    it('should include accessible name in conditions', () => {
      const context = createActionContext(
        undefined,
        undefined,
        'Submit Button',
        undefined,
      );
      const recording = createRecording(
        'rec-23',
        'Accessible Name Condition',
        [createClickAction(timestamp(0), 0.5, 0.5, 'left', 1, context)],
      );

      const workflow = converter.convert(recording);

      const conditions = workflow.steps[0].conditions || [];
      expect(conditions.length).toBeGreaterThan(0);
    });

    it('should handle actions without context', () => {
      const recording = createRecording(
        'rec-24',
        'No Context',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps[0].conditions).toBeUndefined();
    });
  });

  describe('Metadata Preservation', () => {
    it('should preserve creation timestamp', () => {
      const recording = createRecording(
        'rec-25',
        'Timestamp Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording);

      expect(workflow.metadata.createdAt).toBeDefined();
      expect(workflow.metadata.updatedAt).toBeDefined();
    });

    it('should preserve tags from recording and add new ones', () => {
      const recording = createRecording(
        'rec-26',
        'Tags Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
        'user-capture',
        undefined,
        ['tag1', 'tag2'],
      );

      const workflow = converter.convert(recording, {
        tags: ['tag3', 'tag1'], // tag1 duplicate
      });

      expect(workflow.metadata.tags).toContain('tag1');
      expect(workflow.metadata.tags).toContain('tag2');
      expect(workflow.metadata.tags).toContain('tag3');
      // Should not have duplicates
      const tag1Count = workflow.metadata.tags!.filter((t) => t === 'tag1')
        .length;
      expect(tag1Count).toBe(1);
    });

    it('should set source to user-created', () => {
      const recording = createRecording(
        'rec-27',
        'Source Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording);

      expect(workflow.metadata.source).toBe('user-created');
    });
  });

  describe('Description Generation', () => {
    it('should generate click descriptions with coordinates', () => {
      const description = converter.generateDescription(
        createClickAction(timestamp(0), 0.123, 0.456),
      );

      expect(description).toContain('click');
      expect(description).toContain('0.12');
      expect(description).toContain('0.46');
    });

    it('should distinguish click types', () => {
      const single = converter.generateDescription(
        createClickAction(timestamp(0), 0.5, 0.5, 'left', 1),
      );
      const double = converter.generateDescription(
        createClickAction(timestamp(0), 0.5, 0.5, 'left', 2),
      );
      const triple = converter.generateDescription(
        createClickAction(timestamp(0), 0.5, 0.5, 'left', 3),
      );

      expect(single).toContain('click');
      expect(double).toContain('double-click');
      expect(triple).toContain('triple-click');
    });

    it('should show button type for non-left clicks', () => {
      const right = converter.generateDescription(
        createClickAction(timestamp(0), 0.5, 0.5, 'right', 1),
      );
      const middle = converter.generateDescription(
        createClickAction(timestamp(0), 0.5, 0.5, 'middle', 1),
      );

      expect(right).toContain('right button');
      expect(middle).toContain('middle button');
    });

    it('should generate keyboard descriptions with text', () => {
      const description = converter.generateDescription(
        createKeyboardAction(timestamp(0), ['a'], 'hello'),
      );

      expect(description).toContain('Type');
      expect(description).toContain('hello');
    });

    it('should generate keyboard descriptions with key combos', () => {
      const description = converter.generateDescription(
        createKeyboardAction(timestamp(0), ['Control', 'Shift', 'a']),
      );

      expect(description).toContain('Press');
      expect(description).toContain('Control+Shift+a');
    });

    it('should generate drag descriptions', () => {
      const description = converter.generateDescription(
        createDragAction(timestamp(0), 0.1, 0.2, 0.9, 0.8, 300),
      );

      expect(description).toContain('Drag');
      expect(description).toContain('0.10');
      expect(description).toContain('0.20');
      expect(description).toContain('0.90');
      expect(description).toContain('0.80');
      expect(description).toContain('300ms');
    });

    it('should generate scroll descriptions', () => {
      const down = converter.generateDescription(
        createScrollAction(timestamp(0), 0.5, 0.5, 0, 500),
      );
      const up = converter.generateDescription(
        createScrollAction(timestamp(0), 0.5, 0.5, 0, -300),
      );
      const right = converter.generateDescription(
        createScrollAction(timestamp(0), 0.5, 0.5, 200, 0),
      );
      const left = converter.generateDescription(
        createScrollAction(timestamp(0), 0.5, 0.5, -100, 0),
      );

      expect(down).toContain('Scroll down');
      expect(up).toContain('Scroll up');
      expect(right).toContain('Scroll right');
      expect(left).toContain('Scroll left');
    });

    it('should generate pause descriptions', () => {
      const description = converter.generateDescription(
        createPauseAction(timestamp(0), 2500),
      );

      expect(description).toContain('Wait');
      expect(description).toContain('2500ms');
    });

    it('should include context in descriptions', () => {
      const context = createActionContext(
        '.submit',
        undefined,
        'Submit Form',
        undefined,
      );

      const description = converter.generateDescription(
        createClickAction(timestamp(0), 0.5, 0.5, 'left', 1, context),
      );

      expect(description).toContain('Submit Form');
    });

    it('should escape text in descriptions', () => {
      const description = converter.generateDescription(
        createKeyboardAction(timestamp(0), [], "can't\"do"),
      );

      expect(description).toContain('Type');
      expect(description).toContain('can');
    });
  });

  describe('Workflow Validation', () => {
    it('should validate a simple workflow', () => {
      const recording = createRecording(
        'rec-28',
        'Validation Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording);
      const result = converter.validate(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing step IDs', () => {
      const recording = createRecording(
        'rec-29',
        'Bad Step',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording);

      // Manually corrupt a step (for testing)
      if (workflow.steps[0]) {
        delete (workflow.steps[0] as any).policy;
      }

      const result = converter.validate(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should provide validation statistics', () => {
      const recording = createRecording(
        'rec-30',
        'Stats Test',
        [
          createClickAction(timestamp(0), 0.5, 0.5),
          createClickAction(timestamp(100), 0.6, 0.6),
          createKeyboardAction(timestamp(200), ['a']),
        ],
      );

      const workflow = converter.convert(recording);
      const result = converter.validate(workflow);

      expect(result.statistics.stepCount).toBe(3);
      expect(result.statistics.coordinateCount).toBeGreaterThan(0);
    });

    it('should detect duplicate step IDs', () => {
      const recording = createRecording(
        'rec-31',
        'Duplicate IDs',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      let workflow = converter.convert(recording);

      // Manually set duplicate IDs (for testing)
      if (workflow.steps.length > 1) {
        workflow.steps[1].id = workflow.steps[0].id;
        const result = converter.validate(workflow);
        expect(result.valid).toBe(false);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should throw on empty recording', () => {
      const recording: Recording = {
        id: 'rec-empty',
        name: 'Empty Recording',
        actions: [],
        metadata: {
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          duration: 0,
          actionCounts: {
            clicks: 0,
            keyboard: 0,
            drags: 0,
            scrolls: 0,
            pauses: 0,
          },
          elementContexts: 0,
          source: 'user-capture',
          version: '1.0.0',
        },
      };

      expect(() => {
        converter.convert(recording);
      }).toThrow();
    });

    it('should handle recording with only pauses', () => {
      const recording = createRecording(
        'rec-32',
        'Only Pauses',
        [
          createPauseAction(timestamp(0), 100),
          createPauseAction(timestamp(100), 200),
        ],
      );

      const workflow = converter.convert(recording, { groupPauses: true });

      expect(workflow.steps).toHaveLength(1);
      expect(workflow.steps[0].description).toContain('300ms');
    });

    it('should handle single action recording', () => {
      const recording = createRecording(
        'rec-33',
        'Single Action',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(1);
    });

    it('should handle very long text input', () => {
      const longText = 'a'.repeat(200);
      const description = converter.generateDescription(
        createKeyboardAction(timestamp(0), [], longText),
      );

      // Should truncate to 50 chars max
      expect(description.length).toBeLessThan(100);
    });

    it('should handle special characters in text', () => {
      const description = converter.generateDescription(
        createKeyboardAction(timestamp(0), [], "test'with\\special\nnewline"),
      );

      expect(description).toContain('Type');
    });

    it('should handle drag without duration', () => {
      const description = converter.generateDescription(
        createDragAction(timestamp(0), 0.2, 0.3, 0.8, 0.9),
      );

      expect(description).toContain('Drag');
      expect(description).not.toContain('undefined');
    });

    it('should handle scroll with zero deltas', () => {
      const description = converter.generateDescription(
        createScrollAction(timestamp(0), 0.5, 0.5, 0, 0),
      );

      expect(description).toContain('Scroll');
    });
  });

  describe('Integration Functions', () => {
    it('should use recordingToWorkflow convenience function', () => {
      const recording = createRecording(
        'rec-34',
        'Convenience Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = recordingToWorkflow(recording, {
        version: '2.0.0',
      });

      expect(workflow.metadata.version).toBe('2.0.0');
      expect(workflow.steps).toHaveLength(1);
    });

    it('should use validateConvertedWorkflow convenience function', () => {
      const recording = createRecording(
        'rec-35',
        'Validate Convenience',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = recordingToWorkflow(recording);
      const result = validateConvertedWorkflow(workflow);

      expect(result.valid).toBe(true);
    });
  });

  describe('Complex Workflows', () => {
    it('should convert recording with multiple action types', () => {
      const recording = createRecording(
        'rec-36',
        'Complex Recording',
        [
          createClickAction(timestamp(0), 0.2, 0.3),
          createPauseAction(timestamp(50), 100),
          createKeyboardAction(timestamp(150), ['a', 'b', 'c']),
          createDragAction(timestamp(250), 0.1, 0.1, 0.9, 0.9, 200),
          createScrollAction(timestamp(450), 0.5, 0.5, 0, 300),
          createClickAction(timestamp(550), 0.7, 0.8),
        ],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps.length).toBeGreaterThanOrEqual(5); // May be grouped
      expect(workflow.metadata.createdAt).toBeDefined();
      expect(workflow.metadata.version).toBe('1.0.0');
    });

    it('should handle recording with all click button types', () => {
      const recording = createRecording(
        'rec-37',
        'All Buttons',
        [
          createClickAction(timestamp(0), 0.5, 0.5, 'left', 1),
          createClickAction(timestamp(100), 0.5, 0.5, 'right', 1),
          createClickAction(timestamp(200), 0.5, 0.5, 'middle', 1),
        ],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(3);
      expect(workflow.steps[0].description).not.toContain('button');
      expect(workflow.steps[1].description).toContain('right button');
      expect(workflow.steps[2].description).toContain('middle button');
    });

    it('should convert recording with context on multiple actions', () => {
      const context1 = createActionContext('.button', undefined, 'Click Me');
      const context2 = createActionContext('.input', undefined, 'Search Box');

      const recording = createRecording(
        'rec-38',
        'Multi Context',
        [
          createClickAction(timestamp(0), 0.5, 0.5, 'left', 1, context1),
          createKeyboardAction(timestamp(100), ['hello'], 'hello', context2),
        ],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps[0].conditions).toBeDefined();
      expect(workflow.steps[1].conditions).toBeDefined();
    });
  });

  describe('Timestamp Handling', () => {
    it('should preserve action ordering by timestamp', () => {
      const recording = createRecording(
        'rec-39',
        'Timestamp Order',
        [
          createClickAction(timestamp(100), 0.5, 0.5),
          createClickAction(timestamp(50), 0.6, 0.6),
          createClickAction(timestamp(200), 0.7, 0.7),
        ],
      );

      const workflow = converter.convert(recording);

      // Should maintain order as provided, not sort by timestamp
      expect(workflow.steps).toHaveLength(3);
    });

    it('should handle same timestamp actions', () => {
      const sameTime = timestamp(100);
      const recording = createRecording(
        'rec-40',
        'Same Timestamp',
        [
          createClickAction(sameTime, 0.5, 0.5),
          createClickAction(sameTime, 0.6, 0.6),
        ],
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(2);
    });
  });

  describe('Large Recordings', () => {
    it('should handle large number of actions', () => {
      const actions = [];
      for (let i = 0; i < 100; i++) {
        actions.push(createClickAction(timestamp(i * 100), 0.5, 0.5));
      }

      const recording = createRecording('rec-41', 'Large Recording', actions);
      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(100);
    });

    it('should handle alternating action types', () => {
      const actions = [];
      for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) {
          actions.push(createClickAction(timestamp(i * 100), 0.5, 0.5));
        } else {
          actions.push(createKeyboardAction(timestamp(i * 100), ['a']));
        }
      }

      const recording = createRecording(
        'rec-42',
        'Alternating Actions',
        actions,
      );

      const workflow = converter.convert(recording);

      expect(workflow.steps).toHaveLength(50);
    });
  });

  describe('Output Mapping', () => {
    it('should create workflow steps with empty output mapping', () => {
      const recording = createRecording(
        'rec-43',
        'Output Mapping Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = converter.convert(recording);

      // Steps should not have output mapping by default
      expect(workflow.steps[0].outputMapping).toBeUndefined();
    });
  });

  describe('Source Metadata', () => {
    it('should set workflow source to user-created', () => {
      const recording = createRecording(
        'rec-44',
        'Source Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
        'user-capture',
      );

      const workflow = converter.convert(recording);

      expect(workflow.metadata.source).toBe('user-created');
    });

    it('should maintain consistency across conversions', () => {
      const recording = createRecording(
        'rec-45',
        'Consistency Test',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow1 = converter.convert(recording);
      const workflow2 = converter.convert(recording);

      // Both should have same structure (though IDs will differ)
      expect(workflow1.steps).toHaveLength(workflow2.steps.length);
      expect(workflow1.name).toBe(workflow2.name);
      expect(workflow1.metadata.version).toBe(workflow2.metadata.version);
    });
  });

  describe('Convenience Functions', () => {
    it('recordingToWorkflow should handle all options', () => {
      const recording = createRecording(
        'rec-46',
        'Full Options',
        [createClickAction(timestamp(0), 0.5, 0.5)],
        'user-capture',
        'Test Description',
        ['tag1'],
      );

      const options: ConversionOptions = {
        groupPauses: true,
        generateDescriptions: true,
        version: '3.0.0',
        tags: ['tag2'],
      };

      const workflow = recordingToWorkflow(recording, options);

      expect(workflow.metadata.version).toBe('3.0.0');
      expect(workflow.description).toBe('Test Description');
      expect(workflow.metadata.tags).toContain('tag1');
      expect(workflow.metadata.tags).toContain('tag2');
    });

    it('validateConvertedWorkflow should return proper result', () => {
      const recording = createRecording(
        'rec-47',
        'Validate Result',
        [createClickAction(timestamp(0), 0.5, 0.5)],
      );

      const workflow = recordingToWorkflow(recording);
      const result: ValidationResult = validateConvertedWorkflow(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.statistics.stepCount).toBe(1);
    });
  });
});
