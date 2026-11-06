/**
 * Recording Export/Import Tests
 *
 * Tests for JSON serialization and deserialization of Recording objects
 * with format validation, redaction, and version compatibility.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Recording } from './recording-types';
import {
  exportRecording,
  importRecording,
  validateImport,
  exportRedactedRecording,
  importRedactedRecording,
  type ExportedRecording,
  type RedactedRecording,
  type ExportedAction,
} from './recording-export-import';
import { createRecording, createClickAction, createKeyboardAction, createPauseAction } from './recording-types';

/**
 * Helper to create a sample Recording for testing
 */
function createTestRecording(id: string = 'test-recording-1'): Recording {
  return createRecording(
    id,
    'Test Recording',
    [
      createClickAction('2024-01-15T10:00:00.000Z', 0.5, 0.3, 'left', 1),
      createKeyboardAction('2024-01-15T10:00:01.000Z', ['Enter']),
      createClickAction('2024-01-15T10:00:02.000Z', 0.7, 0.4, 'left', 1),
      createPauseAction('2024-01-15T10:00:03.000Z', 1000),
      createKeyboardAction('2024-01-15T10:00:04.000Z', ['Escape']),
    ],
    'user-capture',
    'A test recording with various actions',
    ['test', 'sample'],
  );
}

describe('Recording Export/Import', () => {
  let recording: Recording;

  beforeEach(() => {
    recording = createTestRecording();
  });

  describe('exportRecording', () => {
    it('should export a recording with full metadata', () => {
      const exported = exportRecording(recording);

      expect(exported).toBeDefined();
      expect(exported.version).toBe('1.0.0');
      expect(exported.id).toBe(recording.id);
      expect(exported.name).toBe(recording.name);
      expect(exported.description).toBe(recording.description);
      expect(exported.actions).toHaveLength(recording.actions.length);
      expect(exported.metadata).toEqual(recording.metadata);
    });

    it('should include integrity hash by default', () => {
      const exported = exportRecording(recording);

      expect(exported.integrityHash).toBeDefined();
      expect(typeof exported.integrityHash).toBe('string');
    });

    it('should exclude integrity hash when requested', () => {
      const exported = exportRecording(recording, { includeIntegrityHash: false });

      expect(exported.integrityHash).toBeUndefined();
    });

    it('should export all action types correctly', () => {
      const exported = exportRecording(recording);
      const actions = exported.actions as ExportedAction[];

      expect(actions[0].type).toBe('click');
      expect(actions[0].data).toEqual({
        x: 0.5,
        y: 0.3,
        button: 'left',
        clickCount: 1,
      });

      expect(actions[1].type).toBe('keyboard');
      expect(actions[1].data).toEqual({
        keys: ['Enter'],
      });

      expect(actions[3].type).toBe('pause');
      expect(actions[3].data).toEqual({
        duration: 1000,
      });
    });

    it('should export action context when present', () => {
      const recordingWithContext = createRecording(
        'test-2',
        'Context Test',
        [
          createClickAction('2024-01-15T10:00:00.000Z', 0.5, 0.3, 'left', 1, {
            selector: '#submit-btn',
            accessibleName: 'Submit',
            elementId: 'submit-1',
          }),
        ],
      );

      const exported = exportRecording(recordingWithContext);
      const action = exported.actions[0] as ExportedAction;

      expect(action.context).toBeDefined();
      expect(action.context?.selector).toBe('#submit-btn');
      expect(action.context?.accessibleName).toBe('Submit');
      expect(action.context?.elementId).toBe('submit-1');
    });

    it('should export redacted recording when requested', () => {
      const exported = exportRecording(recording, { redact: true });

      expect(exported).toBeDefined();
      expect((exported as RedactedRecording).metadata.redacted).toBe(true);
    });
  });

  describe('exportRedactedRecording', () => {
    it('should redact sensitive metadata', () => {
      const exported = exportRedactedRecording(recording, { redactFields: ['timestamps'] });

      expect(exported).toBeDefined();
      expect(exported.metadata.redacted).toBe(true);
      expect(exported.metadata.createdAt).toBeUndefined();
    });

    it('should preserve action data', () => {
      const exported = exportRedactedRecording(recording);

      expect(exported.actions).toHaveLength(recording.actions.length);
      expect(exported.actions[0].type).toBe('click');
      expect(exported.actions[0].data).toEqual({
        x: 0.5,
        y: 0.3,
        button: 'left',
        clickCount: 1,
      });
    });

    it('should generate integrity hash', () => {
      const exported = exportRedactedRecording(recording);

      expect(exported.integrityHash).toBeDefined();
      expect(typeof exported.integrityHash).toBe('string');
    });
  });

  describe('importRecording', () => {
    it('should import a valid exported recording', () => {
      const exported = exportRecording(recording);
      const jsonString = JSON.stringify(exported);

      const result = importRecording(jsonString);

      expect(result.success).toBe(true);
      expect(result.recording).toBeDefined();
      expect(result.recording?.id).toBe(recording.id);
      expect(result.recording?.name).toBe(recording.name);
    });

    it('should preserve action data during import', () => {
      const exported = exportRecording(recording);
      const jsonString = JSON.stringify(exported);

      const result = importRecording(jsonString);

      expect(result.success).toBe(true);
      expect(result.recording?.actions).toHaveLength(recording.actions.length);

      // Verify first action
      const importedAction = result.recording?.actions[0];
      const originalAction = recording.actions[0];

      if (importedAction?.type === 'click' && originalAction?.type === 'click') {
        expect(importedAction.x).toBe(originalAction.x);
        expect(importedAction.y).toBe(originalAction.y);
        expect(importedAction.button).toBe(originalAction.button);
      }
    });

    it('should return error for invalid JSON', () => {
      const result = importRecording('invalid json{[');

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should return error for missing required fields', () => {
      const invalidData = {
        version: '1.0.0',
        // Missing exportTimestamp and actions
      };
      const jsonString = JSON.stringify(invalidData);

      const result = importRecording(jsonString);

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Missing required field'),
      );
    });

    it('should auto-upgrade older formats by default', () => {
      const exported = exportRecording(recording);
      // @ts-expect-error - testing older version
      exported.version = '0.9.0'; // Older version

      const result = importRecording(JSON.stringify(exported));

      // Should succeed with auto-upgrade
      expect(result.success).toBe(true);
    });

    it('should fail on newer format version with strict validation', () => {
      const exported = exportRecording(recording);
      // @ts-expect-error - testing newer version
      exported.version = '2.0.0'; // Newer version

      const result = importRecording(JSON.stringify(exported), { strictValidation: true });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe('importRedactedRecording', () => {
    it('should import a redacted recording', () => {
      const exported = exportRedactedRecording(recording);
      const jsonString = JSON.stringify(exported);

      const result = importRedactedRecording(jsonString);

      expect(result.success).toBe(true);
      expect(result.recording).toBeDefined();
    });

    it('should have redacted metadata', () => {
      const exported = exportRedactedRecording(recording);
      const jsonString = JSON.stringify(exported);

      const result = importRedactedRecording(jsonString);

      expect(result.success).toBe(true);
      expect(result.recording?.metadata.version).toBe('1.0.0');
    });
  });

  describe('validateImport', () => {
    it('should validate a correct format', () => {
      const exported = exportRecording(recording);
      const result = validateImport(exported);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing version field', () => {
      const data = {
        exportTimestamp: '2024-01-15T12:00:00.000Z',
        actions: [],
      };
      const result = validateImport(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Missing required field: version'),
      );
    });

    it('should detect invalid action type', () => {
      const exported = exportRecording(recording);
      (exported.actions[0] as ExportedAction).type = 'invalid-type' as any;

      const result = validateImport(exported);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('invalid'),
      );
    });

    it('should detect missing action timestamp', () => {
      const exported = exportRecording(recording);
      (exported.actions[0] as ExportedAction).timestamp = null as any;

      const result = validateImport(exported);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('timestamp'),
      );
    });

    it('should detect missing action data', () => {
      const exported = exportRecording(recording);
      (exported.actions[0] as ExportedAction).data = null as any;

      const result = validateImport(exported);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('data'),
      );
    });

    it('should check version compatibility', () => {
      const exported = exportRecording(recording);
      // @ts-expect-error - testing older version
      exported.version = '0.8.0';

      const result = validateImport(exported);

      expect(result.compatibility).toBeDefined();
      expect(result.compatibility?.versionStatus).toBe('older');
    });

    it('should return unknown version status for invalid version', () => {
      const exported = exportRecording(recording);
      // @ts-expect-error - testing invalid version
      exported.version = 'invalid-version';

      const result = validateImport(exported);

      expect(result.compatibility?.versionStatus).toBe('unknown');
    });

    it('should return warnings for unknown version', () => {
      const exported = exportRecording(recording);
      // @ts-expect-error - testing very old version
      exported.version = '0.0.1';

      const result = validateImport(exported);

      // Should have warnings for version mismatch
      expect(result.warnings).toBeDefined();
    });
  });

  describe('integrity hash', () => {
    it('should have deterministic hash for same data', () => {
      const exported1 = exportRecording(recording, { includeIntegrityHash: true });
      const exported2 = exportRecording(recording, { includeIntegrityHash: true });

      expect(exported1.integrityHash).toBe(exported2.integrityHash);
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve all data through export/import cycle', () => {
      const original = createTestRecording('roundtrip-1');

      // Export
      const exported = exportRecording(original);
      const jsonString = JSON.stringify(exported);

      // Import
      const result = importRecording(jsonString);

      expect(result.success).toBe(true);
      expect(result.recording).toBeDefined();

      // Compare key fields
      expect(result.recording?.id).toBe(original.id);
      expect(result.recording?.name).toBe(original.name);
      expect(result.recording?.actions).toHaveLength(original.actions.length);
      expect(result.recording?.metadata.duration).toBe(original.metadata.duration);
    });

    it('should preserve redacted data through export/import cycle', () => {
      const original = createTestRecording('roundtrip-redacted-1');

      // Export redacted
      const exported = exportRedactedRecording(original);
      const jsonString = JSON.stringify(exported);

      // Import
      const result = importRecording(jsonString);

      expect(result.success).toBe(true);
      expect(result.recording?.metadata.version).toBe('1.0.0');
    });
  });

  describe('edge cases', () => {
    it('should handle empty recording', () => {
      const emptyRecording = createRecording(
        'empty-1',
        'Empty Recording',
        [],
        'user-capture',
      );

      const exported = exportRecording(emptyRecording);
      expect(exported.actions).toHaveLength(0);

      const result = importRecording(JSON.stringify(exported));
      expect(result.success).toBe(true);
      expect(result.recording?.actions).toHaveLength(0);
    });

    it('should handle recording with only pause actions', () => {
      const pauseRecording = createRecording(
        'pause-only-1',
        'Pause Recording',
        [
          createPauseAction('2024-01-15T10:00:00.000Z', 1000),
          createPauseAction('2024-01-15T10:00:02.000Z', 2000),
        ],
        'user-capture',
      );

      const exported = exportRecording(pauseRecording);
      expect(exported.actions).toHaveLength(2);
      expect(exported.actions[0].type).toBe('pause');

      const result = importRecording(JSON.stringify(exported));
      expect(result.success).toBe(true);
    });

    it('should handle missing optional fields', () => {
      const recordingWithoutDescription = createRecording(
        'no-desc-1',
        'Recording Without Description',
        [createClickAction('2024-01-15T10:00:00.000Z', 0.5, 0.3)],
        'user-capture',
      );

      const exported = exportRecording(recordingWithoutDescription);
      expect(exported.description).toBeUndefined();

      const result = importRecording(JSON.stringify(exported));
      expect(result.success).toBe(true);
    });
  });
});
