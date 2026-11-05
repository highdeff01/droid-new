import { describe, it, expect } from 'vitest';
import {
  createActionContext,
  createClickAction,
  createKeyboardAction,
  createDragAction,
  createScrollAction,
  createPauseAction,
  createRecordingMetadata,
  createRecording,
  validateNormalizedCoordinate,
  validateAction,
  validateTimestamp,
  calculateDuration,
  countActions,
  countElementContexts,
  type RecordingAction,
  type Recording,
} from './recording-types.js';

describe('recording-types', () => {
  describe('ActionContext', () => {
    it('should create an ActionContext with all properties', () => {
      const context = createActionContext('button.primary', 'html > body > button', 'Submit', 'btn-1');

      expect(context.selector).toBe('button.primary');
      expect(context.domPath).toBe('html > body > button');
      expect(context.accessibleName).toBe('Submit');
      expect(context.elementId).toBe('btn-1');
    });

    it('should create an ActionContext with partial properties', () => {
      const context = createActionContext('button.primary', undefined, 'Submit');

      expect(context.selector).toBe('button.primary');
      expect(context.domPath).toBeUndefined();
      expect(context.accessibleName).toBe('Submit');
      expect(context.elementId).toBeUndefined();
    });

    it('should create an empty ActionContext', () => {
      const context = createActionContext();

      expect(context.selector).toBeUndefined();
      expect(context.domPath).toBeUndefined();
      expect(context.accessibleName).toBeUndefined();
      expect(context.elementId).toBeUndefined();
    });
  });

  describe('ClickAction', () => {
    it('should create a left-click action with default values', () => {
      const action = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);

      expect(action.type).toBe('click');
      expect(action.timestamp).toBe('2024-01-15T10:30:00.000Z');
      expect(action.x).toBe(0.5);
      expect(action.y).toBe(0.5);
      expect(action.button).toBe('left');
      expect(action.clickCount).toBe(1);
      expect(action.context).toBeUndefined();
    });

    it('should create a right-click action with double-click', () => {
      const action = createClickAction('2024-01-15T10:30:00.000Z', 0.3, 0.7, 'right', 2);

      expect(action.button).toBe('right');
      expect(action.clickCount).toBe(2);
    });

    it('should create a middle-click action with triple-click', () => {
      const action = createClickAction('2024-01-15T10:30:00.000Z', 0.0, 1.0, 'middle', 3);

      expect(action.button).toBe('middle');
      expect(action.clickCount).toBe(3);
    });

    it('should create a click action with context', () => {
      const context = createActionContext('button.submit');
      const action = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, 'left', 1, context);

      expect(action.context).toBe(context);
      expect(action.context?.selector).toBe('button.submit');
    });

    it('should support coordinates at boundaries [0, 1]', () => {
      const clickTopLeft = createClickAction('2024-01-15T10:30:00.000Z', 0, 0);
      const clickBottomRight = createClickAction('2024-01-15T10:30:00.000Z', 1, 1);
      const clickCenter = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);

      expect(clickTopLeft.x).toBe(0);
      expect(clickTopLeft.y).toBe(0);
      expect(clickBottomRight.x).toBe(1);
      expect(clickBottomRight.y).toBe(1);
      expect(clickCenter.x).toBe(0.5);
      expect(clickCenter.y).toBe(0.5);
    });
  });

  describe('KeyboardAction', () => {
    it('should create a single key action', () => {
      const action = createKeyboardAction('2024-01-15T10:30:00.000Z', ['Enter']);

      expect(action.type).toBe('keyboard');
      expect(action.timestamp).toBe('2024-01-15T10:30:00.000Z');
      expect(action.keys).toEqual(['Enter']);
      expect(action.text).toBeUndefined();
      expect(action.context).toBeUndefined();
    });

    it('should create a key combination action', () => {
      const action = createKeyboardAction('2024-01-15T10:30:00.000Z', ['Control', 'c']);

      expect(action.keys).toEqual(['Control', 'c']);
    });

    it('should create a text input action', () => {
      const action = createKeyboardAction('2024-01-15T10:30:00.000Z', [], 'hello world');

      expect(action.keys).toEqual([]);
      expect(action.text).toBe('hello world');
    });

    it('should create an action with both keys and text', () => {
      const action = createKeyboardAction('2024-01-15T10:30:00.000Z', ['Control', 'a'], 'Select all');

      expect(action.keys).toEqual(['Control', 'a']);
      expect(action.text).toBe('Select all');
    });

    it('should create a keyboard action with context', () => {
      const context = createActionContext('#search-input');
      const action = createKeyboardAction('2024-01-15T10:30:00.000Z', ['Escape'], undefined, context);

      expect(action.context).toBe(context);
    });

    it('should support complex key combinations', () => {
      const action = createKeyboardAction('2024-01-15T10:30:00.000Z', ['Control', 'Shift', 'Escape']);

      expect(action.keys.length).toBe(3);
      expect(action.keys).toContain('Control');
      expect(action.keys).toContain('Shift');
      expect(action.keys).toContain('Escape');
    });
  });

  describe('DragAction', () => {
    it('should create a drag action with required fields', () => {
      const action = createDragAction('2024-01-15T10:30:00.000Z', 0.2, 0.2, 0.8, 0.8);

      expect(action.type).toBe('drag');
      expect(action.timestamp).toBe('2024-01-15T10:30:00.000Z');
      expect(action.startX).toBe(0.2);
      expect(action.startY).toBe(0.2);
      expect(action.endX).toBe(0.8);
      expect(action.endY).toBe(0.8);
      expect(action.duration).toBeUndefined();
    });

    it('should create a drag action with duration', () => {
      const action = createDragAction('2024-01-15T10:30:00.000Z', 0.2, 0.2, 0.8, 0.8, 500);

      expect(action.duration).toBe(500);
    });

    it('should create a drag action with context', () => {
      const context = createActionContext('div.draggable');
      const action = createDragAction('2024-01-15T10:30:00.000Z', 0.0, 0.0, 1.0, 1.0, 1000, context);

      expect(action.context).toBe(context);
    });

    it('should support drag at screen boundaries', () => {
      const action = createDragAction('2024-01-15T10:30:00.000Z', 0, 0, 1, 1);

      expect(action.startX).toBe(0);
      expect(action.startY).toBe(0);
      expect(action.endX).toBe(1);
      expect(action.endY).toBe(1);
    });

    it('should support horizontal drag', () => {
      const action = createDragAction('2024-01-15T10:30:00.000Z', 0.1, 0.5, 0.9, 0.5);

      expect(action.startY).toBe(action.endY);
    });

    it('should support vertical drag', () => {
      const action = createDragAction('2024-01-15T10:30:00.000Z', 0.5, 0.1, 0.5, 0.9);

      expect(action.startX).toBe(action.endX);
    });
  });

  describe('ScrollAction', () => {
    it('should create a scroll action with coordinates only', () => {
      const action = createScrollAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);

      expect(action.type).toBe('scroll');
      expect(action.timestamp).toBe('2024-01-15T10:30:00.000Z');
      expect(action.x).toBe(0.5);
      expect(action.y).toBe(0.5);
      expect(action.deltaX).toBeUndefined();
      expect(action.deltaY).toBeUndefined();
    });

    it('should create a vertical scroll action', () => {
      const action = createScrollAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, undefined, 100);

      expect(action.deltaY).toBe(100);
      expect(action.deltaX).toBeUndefined();
    });

    it('should create a horizontal scroll action', () => {
      const action = createScrollAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, -50, undefined);

      expect(action.deltaX).toBe(-50);
      expect(action.deltaY).toBeUndefined();
    });

    it('should create a diagonal scroll action', () => {
      const action = createScrollAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, 30, 60);

      expect(action.deltaX).toBe(30);
      expect(action.deltaY).toBe(60);
    });

    it('should create a scroll action with context', () => {
      const context = createActionContext('div.scrollable');
      const action = createScrollAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, undefined, -100, context);

      expect(action.context).toBe(context);
    });
  });

  describe('PauseAction', () => {
    it('should create a pause action with duration', () => {
      const action = createPauseAction('2024-01-15T10:30:00.000Z', 1000);

      expect(action.type).toBe('pause');
      expect(action.timestamp).toBe('2024-01-15T10:30:00.000Z');
      expect(action.duration).toBe(1000);
    });

    it('should support zero-duration pause', () => {
      const action = createPauseAction('2024-01-15T10:30:00.000Z', 0);

      expect(action.duration).toBe(0);
    });

    it('should support very long pause', () => {
      const action = createPauseAction('2024-01-15T10:30:00.000Z', 3600000); // 1 hour

      expect(action.duration).toBe(3600000);
    });
  });

  describe('validateNormalizedCoordinate', () => {
    it('should accept valid coordinates in [0, 1]', () => {
      expect(() => validateNormalizedCoordinate(0)).not.toThrow();
      expect(() => validateNormalizedCoordinate(0.5)).not.toThrow();
      expect(() => validateNormalizedCoordinate(1)).not.toThrow();
    });

    it('should reject coordinates below 0', () => {
      expect(() => validateNormalizedCoordinate(-0.1)).toThrow();
      expect(() => validateNormalizedCoordinate(-1)).toThrow();
    });

    it('should reject coordinates above 1', () => {
      expect(() => validateNormalizedCoordinate(1.1)).toThrow();
      expect(() => validateNormalizedCoordinate(2)).toThrow();
    });

    it('should reject non-number values', () => {
      expect(() => validateNormalizedCoordinate(NaN)).toThrow();
      expect(() => validateNormalizedCoordinate(Infinity)).toThrow();
    });

    it('should include coordinate name in error message', () => {
      expect(() => validateNormalizedCoordinate(1.5, 'testCoord')).toThrow(/testCoord/);
    });
  });

  describe('validateAction', () => {
    it('should validate click action coordinates', () => {
      const validAction = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);
      expect(() => validateAction(validAction)).not.toThrow();

      const invalidAction = {
        ...validAction,
        x: 1.5,
      };
      expect(() => validateAction(invalidAction as RecordingAction)).toThrow();
    });

    it('should validate drag action coordinates', () => {
      const validAction = createDragAction('2024-01-15T10:30:00.000Z', 0.0, 0.0, 1.0, 1.0);
      expect(() => validateAction(validAction)).not.toThrow();

      const invalidAction = {
        ...validAction,
        endX: 1.5,
      };
      expect(() => validateAction(invalidAction as RecordingAction)).toThrow();
    });

    it('should validate scroll action coordinates', () => {
      const validAction = createScrollAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);
      expect(() => validateAction(validAction)).not.toThrow();

      const invalidAction = {
        ...validAction,
        y: -0.1,
      };
      expect(() => validateAction(invalidAction as RecordingAction)).toThrow();
    });

    it('should not validate keyboard action coordinates', () => {
      const action = createKeyboardAction('2024-01-15T10:30:00.000Z', ['Enter']);
      expect(() => validateAction(action)).not.toThrow();
    });

    it('should not validate pause action coordinates', () => {
      const action = createPauseAction('2024-01-15T10:30:00.000Z', 1000);
      expect(() => validateAction(action)).not.toThrow();
    });
  });

  describe('validateTimestamp', () => {
    it('should accept valid ISO 8601 timestamps', () => {
      expect(() => validateTimestamp('2024-01-15T10:30:00.000Z')).not.toThrow();
      expect(() => validateTimestamp('2024-01-15T10:30:00Z')).not.toThrow();
      expect(() => validateTimestamp('2024-01-15T10:30:00.123Z')).not.toThrow();
    });

    it('should reject invalid timestamp formats', () => {
      expect(() => validateTimestamp('2024-01-15')).toThrow();
      expect(() => validateTimestamp('10:30:00')).toThrow();
      expect(() => validateTimestamp('not-a-timestamp')).toThrow();
    });
  });

  describe('calculateDuration', () => {
    it('should return 0 for empty action array', () => {
      expect(calculateDuration([])).toBe(0);
    });

    it('should calculate duration for single action', () => {
      const action = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);
      expect(calculateDuration([action])).toBe(0);
    });

    it('should calculate duration between two actions', () => {
      const action1 = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);
      const action2 = createClickAction('2024-01-15T10:30:01.000Z', 0.5, 0.5);

      expect(calculateDuration([action1, action2])).toBe(1000);
    });

    it('should include pause durations in total', () => {
      const action1 = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);
      const pause = createPauseAction('2024-01-15T10:30:01.000Z', 500);
      const action2 = createClickAction('2024-01-15T10:30:02.000Z', 0.5, 0.5);

      // Duration = (2000 - 0) + 500 = 2500ms
      expect(calculateDuration([action1, pause, action2])).toBe(2500);
    });

    it('should calculate duration regardless of action order in array', () => {
      const action1 = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);
      const action2 = createClickAction('2024-01-15T10:30:02.000Z', 0.5, 0.5);

      // Order in array shouldn't matter, uses min/max timestamps
      expect(calculateDuration([action2, action1])).toBe(2000);
      expect(calculateDuration([action1, action2])).toBe(2000);
    });

    it('should handle multiple pauses', () => {
      const action1 = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5);
      const pause1 = createPauseAction('2024-01-15T10:30:01.000Z', 300);
      const pause2 = createPauseAction('2024-01-15T10:30:02.000Z', 200);
      const action2 = createClickAction('2024-01-15T10:30:03.000Z', 0.5, 0.5);

      // Duration = (3000 - 0) + 300 + 200 = 3500ms
      expect(calculateDuration([action1, pause1, pause2, action2])).toBe(3500);
    });
  });

  describe('countActions', () => {
    it('should count clicks', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
        createClickAction('2024-01-15T10:30:01.000Z', 0.6, 0.6),
      ];

      const counts = countActions(actions);
      expect(counts.clicks).toBe(2);
      expect(counts.keyboard).toBe(0);
      expect(counts.drags).toBe(0);
      expect(counts.scrolls).toBe(0);
      expect(counts.pauses).toBe(0);
    });

    it('should count keyboard actions', () => {
      const actions: RecordingAction[] = [
        createKeyboardAction('2024-01-15T10:30:00.000Z', ['Enter']),
        createKeyboardAction('2024-01-15T10:30:01.000Z', ['Control', 'c']),
      ];

      const counts = countActions(actions);
      expect(counts.keyboard).toBe(2);
    });

    it('should count drag actions', () => {
      const actions: RecordingAction[] = [createDragAction('2024-01-15T10:30:00.000Z', 0.0, 0.0, 1.0, 1.0)];

      const counts = countActions(actions);
      expect(counts.drags).toBe(1);
    });

    it('should count scroll actions', () => {
      const actions: RecordingAction[] = [
        createScrollAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, undefined, 100),
        createScrollAction('2024-01-15T10:30:01.000Z', 0.5, 0.5, undefined, -100),
      ];

      const counts = countActions(actions);
      expect(counts.scrolls).toBe(2);
    });

    it('should count pause actions', () => {
      const actions: RecordingAction[] = [
        createPauseAction('2024-01-15T10:30:00.000Z', 1000),
        createPauseAction('2024-01-15T10:30:01.000Z', 500),
      ];

      const counts = countActions(actions);
      expect(counts.pauses).toBe(2);
    });

    it('should count mixed action types', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
        createKeyboardAction('2024-01-15T10:30:01.000Z', ['Enter']),
        createDragAction('2024-01-15T10:30:02.000Z', 0.0, 0.0, 1.0, 1.0),
        createScrollAction('2024-01-15T10:30:03.000Z', 0.5, 0.5),
        createPauseAction('2024-01-15T10:30:04.000Z', 1000),
        createClickAction('2024-01-15T10:30:05.000Z', 0.3, 0.3),
      ];

      const counts = countActions(actions);
      expect(counts.clicks).toBe(2);
      expect(counts.keyboard).toBe(1);
      expect(counts.drags).toBe(1);
      expect(counts.scrolls).toBe(1);
      expect(counts.pauses).toBe(1);
    });

    it('should return zero counts for empty actions', () => {
      const counts = countActions([]);

      expect(counts.clicks).toBe(0);
      expect(counts.keyboard).toBe(0);
      expect(counts.drags).toBe(0);
      expect(counts.scrolls).toBe(0);
      expect(counts.pauses).toBe(0);
    });
  });

  describe('countElementContexts', () => {
    it('should count unique element contexts', () => {
      const context1 = createActionContext('button.primary');
      const context2 = createActionContext('input#search');
      const context3 = createActionContext('div.modal');

      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, 'left', 1, context1),
        createClickAction('2024-01-15T10:30:01.000Z', 0.3, 0.3, 'left', 1, context2),
        createClickAction('2024-01-15T10:30:02.000Z', 0.7, 0.7, 'left', 1, context3),
      ];

      expect(countElementContexts(actions)).toBe(3);
    });

    it('should not count duplicate contexts', () => {
      const context = createActionContext('button.primary');

      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, 'left', 1, context),
        createClickAction('2024-01-15T10:30:01.000Z', 0.6, 0.6, 'left', 1, context),
        createClickAction('2024-01-15T10:30:02.000Z', 0.7, 0.7, 'left', 1, context),
      ];

      expect(countElementContexts(actions)).toBe(1);
    });

    it('should not count actions without context', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
        createClickAction('2024-01-15T10:30:01.000Z', 0.6, 0.6),
        createKeyboardAction('2024-01-15T10:30:02.000Z', ['Enter']),
      ];

      expect(countElementContexts(actions)).toBe(0);
    });

    it('should handle mixed actions with and without context', () => {
      const context1 = createActionContext('button.primary');
      const context2 = createActionContext('input#search');

      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, 'left', 1, context1),
        createClickAction('2024-01-15T10:30:01.000Z', 0.6, 0.6),
        createClickAction('2024-01-15T10:30:02.000Z', 0.7, 0.7, 'left', 1, context2),
        createKeyboardAction('2024-01-15T10:30:03.000Z', ['Enter']),
      ];

      expect(countElementContexts(actions)).toBe(2);
    });
  });

  describe('createRecordingMetadata', () => {
    it('should create metadata with correct defaults', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
        createClickAction('2024-01-15T10:30:01.000Z', 0.6, 0.6),
      ];

      const metadata = createRecordingMetadata(actions);

      expect(metadata.source).toBe('user-capture');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.tags).toBeUndefined();
      expect(metadata.actionCounts.clicks).toBe(2);
      expect(metadata.duration).toBe(1000);
      expect(metadata.createdAt).toBeDefined();
      expect(metadata.updatedAt).toBeDefined();
    });

    it('should create metadata with custom source', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
      ];

      const metadata = createRecordingMetadata(actions, 'ai-generation');

      expect(metadata.source).toBe('ai-generation');
    });

    it('should create metadata with tags', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
      ];

      const metadata = createRecordingMetadata(actions, 'user-capture', ['login', 'test']);

      expect(metadata.tags).toEqual(['login', 'test']);
    });

    it('should create metadata with custom version', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
      ];

      const metadata = createRecordingMetadata(actions, 'user-capture', undefined, '2.0.0');

      expect(metadata.version).toBe('2.0.0');
    });

    it('should set createdAt and updatedAt to same time', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
      ];

      const metadata = createRecordingMetadata(actions);

      expect(metadata.createdAt).toBe(metadata.updatedAt);
    });
  });

  describe('createRecording', () => {
    it('should create a complete recording', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
        createKeyboardAction('2024-01-15T10:30:01.000Z', ['Enter']),
      ];

      const recording = createRecording('rec-123', 'Login Flow', actions);

      expect(recording.id).toBe('rec-123');
      expect(recording.name).toBe('Login Flow');
      expect(recording.actions).toEqual(actions);
      expect(recording.metadata.actionCounts.clicks).toBe(1);
      expect(recording.metadata.actionCounts.keyboard).toBe(1);
    });

    it('should create recording with description', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
      ];

      const recording = createRecording('rec-123', 'Login Flow', actions, 'user-capture', 'Test login flow');

      expect(recording.description).toBe('Test login flow');
    });

    it('should create recording with custom source', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
      ];

      const recording = createRecording('rec-123', 'Generated Flow', actions, 'ai-generation');

      expect(recording.metadata.source).toBe('ai-generation');
    });

    it('should create recording with tags', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
      ];

      const recording = createRecording('rec-123', 'Checkout Flow', actions, 'user-capture', undefined, ['e2e', 'checkout']);

      expect(recording.metadata.tags).toEqual(['e2e', 'checkout']);
    });

    it('should handle empty recording', () => {
      const recording = createRecording('rec-empty', 'Empty Recording', []);

      expect(recording.actions).toEqual([]);
      expect(recording.metadata.actionCounts.clicks).toBe(0);
      expect(recording.metadata.duration).toBe(0);
    });

    it('should calculate metadata correctly for complex recording', () => {
      const context1 = createActionContext('button.primary');
      const context2 = createActionContext('input#email');

      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, 'left', 1, context1),
        createKeyboardAction('2024-01-15T10:30:01.000Z', [], 'user@example.com', context2),
        createPauseAction('2024-01-15T10:30:02.000Z', 1000),
        createClickAction('2024-01-15T10:30:03.000Z', 0.5, 0.7),
        createDragAction('2024-01-15T10:30:04.000Z', 0.0, 0.0, 1.0, 1.0, 500),
        createScrollAction('2024-01-15T10:30:05.000Z', 0.5, 0.5, undefined, 100),
      ];

      const recording = createRecording('rec-complex', 'Complex Flow', actions);

      expect(recording.metadata.actionCounts.clicks).toBe(2);
      expect(recording.metadata.actionCounts.keyboard).toBe(1);
      expect(recording.metadata.actionCounts.drags).toBe(1);
      expect(recording.metadata.actionCounts.scrolls).toBe(1);
      expect(recording.metadata.actionCounts.pauses).toBe(1);
      expect(recording.metadata.elementContexts).toBe(2);
      expect(recording.metadata.duration).toBe(6000); // (5000 - 0) + 1000
    });
  });

  describe('JSON Serialization', () => {
    it('should serialize and deserialize ClickAction', () => {
      const original = createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, 'left', 2, createActionContext('button'));
      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized) as typeof original;

      expect(deserialized.type).toBe(original.type);
      expect(deserialized.x).toBe(original.x);
      expect(deserialized.clickCount).toBe(original.clickCount);
      expect(deserialized.context?.selector).toBe('button');
    });

    it('should serialize and deserialize KeyboardAction', () => {
      const original = createKeyboardAction('2024-01-15T10:30:00.000Z', ['Control', 'c']);
      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized) as typeof original;

      expect(deserialized.type).toBe(original.type);
      expect(deserialized.keys).toEqual(original.keys);
    });

    it('should serialize and deserialize Recording', () => {
      const original = createRecording('rec-123', 'Test', [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
        createKeyboardAction('2024-01-15T10:30:01.000Z', ['Enter']),
      ]);

      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized) as Recording;

      expect(deserialized.id).toBe(original.id);
      expect(deserialized.name).toBe(original.name);
      expect(deserialized.actions.length).toBe(2);
      expect(deserialized.actions[0].type).toBe('click');
      expect(deserialized.actions[1].type).toBe('keyboard');
    });

    it('should preserve all metadata in serialization', () => {
      const original = createRecording(
        'rec-123',
        'Test',
        [createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5)],
        'user-capture',
        'Test description',
        ['tag1', 'tag2'],
      );

      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized) as Recording;

      expect(deserialized.metadata.source).toBe(original.metadata.source);
      expect(deserialized.metadata.tags).toEqual(original.metadata.tags);
      expect(deserialized.metadata.actionCounts).toEqual(original.metadata.actionCounts);
      expect(deserialized.metadata.version).toBe(original.metadata.version);
    });
  });

  describe('Timestamp Ordering', () => {
    it('should support monotonically increasing timestamps', () => {
      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5),
        createClickAction('2024-01-15T10:30:00.100Z', 0.5, 0.5),
        createClickAction('2024-01-15T10:30:00.200Z', 0.5, 0.5),
        createClickAction('2024-01-15T10:30:01.000Z', 0.5, 0.5),
      ];

      // Verify all timestamps are valid and can be parsed
      for (const action of actions) {
        expect(() => validateTimestamp(action.timestamp)).not.toThrow();
        expect(new Date(action.timestamp)).toBeInstanceOf(Date);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large recording', () => {
      const actions: RecordingAction[] = [];
      for (let i = 0; i < 1000; i++) {
        actions.push(createClickAction(`2024-01-15T10:30:${String(i).padStart(2, '0')}.000Z`, 0.5, 0.5));
      }

      const recording = createRecording('rec-large', 'Large Recording', actions);

      expect(recording.actions.length).toBe(1000);
      expect(recording.metadata.actionCounts.clicks).toBe(1000);
    });

    it('should handle recording with all action types', () => {
      const context = createActionContext('element');

      const actions: RecordingAction[] = [
        createClickAction('2024-01-15T10:30:00.000Z', 0.5, 0.5, 'left', 1, context),
        createClickAction('2024-01-15T10:30:01.000Z', 0.5, 0.5, 'right', 2),
        createClickAction('2024-01-15T10:30:02.000Z', 0.5, 0.5, 'middle', 3),
        createKeyboardAction('2024-01-15T10:30:03.000Z', ['Enter'], undefined, context),
        createKeyboardAction('2024-01-15T10:30:04.000Z', ['Control', 'c']),
        createDragAction('2024-01-15T10:30:05.000Z', 0.0, 0.0, 1.0, 1.0, 500, context),
        createScrollAction('2024-01-15T10:30:06.000Z', 0.5, 0.5, 10, 20),
        createPauseAction('2024-01-15T10:30:07.000Z', 1000),
      ];

      const recording = createRecording('rec-all', 'All Types', actions);

      expect(recording.metadata.actionCounts.clicks).toBe(3);
      expect(recording.metadata.actionCounts.keyboard).toBe(2);
      expect(recording.metadata.actionCounts.drags).toBe(1);
      expect(recording.metadata.actionCounts.scrolls).toBe(1);
      expect(recording.metadata.actionCounts.pauses).toBe(1);
    });
  });
});
