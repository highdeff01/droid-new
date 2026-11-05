/**
 * Tests for Pack Export/Import Service
 *
 * Validates export to JSON, import with validation, format verification,
 * compatibility checking, conflict detection, and round-trip conversion.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PackExportImportService,
  PackExportData,
  PackImportResult,
  createPackExportImportService,
  ExportOptions,
  ImportOptions,
} from './pack-export-import';
import {
  createPack,
  createPackManifest,
  createPackVersion,
  createPackMetadata,
  createSequentialPolicy,
  createWorkflowReference,
  createPackDependency,
} from '../../../../pack-types';
import { createWorkflow, createWorkflowMetadata, createRecordingStep } from '../../../../workflow-types';

describe('PackExportImportService', () => {
  let service: PackExportImportService;

  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    service = createPackExportImportService('1.0.0', 'windows');
  });

  describe('Export Operations', () => {
    it('should export a basic pack to JSON format', () => {
      // Create test pack
      const pack = createPack(
        'pack-123',
        'Test Pack',
        createPackManifest(
          [createWorkflowReference('workflow-1')],
          createSequentialPolicy(3, 100, true),
        ),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Test Author', 'Test Description'),
      );

      // Create test workflow
      const workflow = createWorkflow(
        'workflow-1',
        createRecordingStep('step-1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('Test Workflow', 'Test Description', '1.0.0'),
      );

      const workflows = new Map([['workflow-1', workflow]]);
      const versionHistory = [pack.version];

      // Export
      const json = service.exportPack(pack, workflows, versionHistory);

      // Verify JSON is valid
      expect(json).toBeTruthy();
      const data = JSON.parse(json) as PackExportData;

      expect(data.formatVersion).toBe('1.0.0');
      expect(data.pack.id).toBe('pack-123');
      expect(data.pack.name).toBe('Test Pack');
      expect(data.workflows['workflow-1']).toBeDefined();
      expect(data.hash).toBeDefined();
      expect(data.exportedAt).toBeDefined();
    });

    it('should include complete metadata in export', () => {
      const metadata = createPackMetadata('Author', 'Description', 'MIT', ['automation', 'testing']);
      const pack = createPack(
        'pack-meta',
        'Metadata Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        metadata,
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.1, y: 0.2 }, 0),
        createWorkflowMetadata('Workflow', 'Desc', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const data = JSON.parse(json) as PackExportData;

      expect(data.pack.metadata.author).toBe('Author');
      expect(data.pack.metadata.license).toBe('MIT');
      expect(data.pack.metadata.tags).toContain('automation');
    });

    it('should include version history in export', () => {
      const pack = createPack(
        'pack-versions',
        'Versioned Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('2.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const v1 = createPackVersion('1.0.0', new Date(Date.now() - 86400000).toISOString());
      const v2 = pack.version;

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [v1, v2]);
      const data = JSON.parse(json) as PackExportData;

      expect(data.versionHistory).toHaveLength(2);
      expect(data.versionHistory[0].version).toBe('1.0.0');
      expect(data.versionHistory[1].version).toBe('2.0.0');
    });

    it('should bundle all referenced workflows', () => {
      const workflows = [
        createWorkflow(
          'w1',
          createRecordingStep('s1', 'click', { x: 0.1, y: 0.2 }, 0),
          createWorkflowMetadata('W1', 'D1', '1.0.0'),
        ),
        createWorkflow(
          'w2',
          createRecordingStep('s2', 'keyboard', { key: 'Enter' }, 100),
          createWorkflowMetadata('W2', 'D2', '1.0.0'),
        ),
        createWorkflow(
          'w3',
          createRecordingStep('s3', 'scroll', { direction: 'down', amount: 5 }, 200),
          createWorkflowMetadata('W3', 'D3', '1.0.0'),
        ),
      ];

      const pack = createPack(
        'pack-multi-wf',
        'Multi-Workflow Pack',
        createPackManifest(
          [
            createWorkflowReference('w1'),
            createWorkflowReference('w2'),
            createWorkflowReference('w3'),
          ],
          createSequentialPolicy(),
        ),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflowMap = new Map(workflows.map((w) => [w.id, w]));
      const json = service.exportPack(pack, workflowMap, [pack.version]);
      const data = JSON.parse(json) as PackExportData;

      expect(Object.keys(data.workflows)).toHaveLength(3);
      expect(data.workflows['w1']).toBeDefined();
      expect(data.workflows['w2']).toBeDefined();
      expect(data.workflows['w3']).toBeDefined();
    });

    it('should generate integrity hash', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

      const pack = createPack(
        'pack-hash',
        'Hash Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const data = JSON.parse(json) as PackExportData;

      // Hash should be present and non-empty
      expect(data.hash).toBeDefined();
      expect(data.hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex

      // Hash should be consistent
      const json2 = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const data2 = JSON.parse(json2) as PackExportData;
      expect(data2.hash).toBe(data.hash);
    });

    it('should detect missing workflow in export', () => {
      const pack = createPack(
        'pack-missing-wf',
        'Test Pack',
        createPackManifest([createWorkflowReference('w1'), createWorkflowReference('w2')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      // Only provide w1, not w2
      expect(() => {
        service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      }).toThrow('Missing workflow "w2"');
    });

    it('should validate pack before export', () => {
      const invalidPack = {
        id: '',
        name: 'Invalid',
        manifest: { workflows: [], policy: { mode: 'sequential' as const } },
        version: createPackVersion('1.0.0', new Date().toISOString()),
        metadata: createPackMetadata('Author', 'Desc'),
      };

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      expect(() => {
        service.exportPack(invalidPack as any, new Map([['w1', workflow]]), [invalidPack.version]);
      }).toThrow();
    });

    it('should optionally skip hash generation', () => {
      const pack = createPack(
        'pack-no-hash',
        'No Hash Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version], {
        includeHash: false,
      });
      const data = JSON.parse(json) as PackExportData;

      expect(data.hash).toBeUndefined();
    });
  });

  describe('Import Operations', () => {
    it('should import a valid exported pack', () => {
      // Create and export a pack
      const pack = createPack(
        'pack-import',
        'Import Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);

      // Import
      const result = service.importPack(json, { allowConflicts: true });

      expect(result.success).toBe(true);
      expect(result.pack).toBeDefined();
      expect(result.pack!.id).toBe('pack-import');
      expect(result.pack!.name).toBe('Import Pack');
      expect(result.workflows).toBeDefined();
      expect(result.workflows!['w1']).toBeDefined();
      expect(result.versionHistory).toHaveLength(1);
    });

    it('should preserve metadata during import', () => {
      const metadata = createPackMetadata('TestAuthor', 'TestDesc', 'Apache-2.0', ['tag1', 'tag2']);
      const pack = createPack(
        'pack-metadata',
        'Metadata Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        metadata,
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const result = service.importPack(json, { allowConflicts: true });

      expect(result.pack!.metadata.author).toBe('TestAuthor');
      expect(result.pack!.metadata.license).toBe('Apache-2.0');
      expect(result.pack!.metadata.tags).toContain('tag1');
    });

    it('should restore version history on import', () => {
      const v1 = createPackVersion('1.0.0', new Date(Date.now() - 172800000).toISOString());
      const v2 = createPackVersion('1.1.0', new Date(Date.now() - 86400000).toISOString());
      const v3 = createPackVersion('2.0.0', new Date().toISOString());

      const pack = createPack(
        'pack-history',
        'History Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        v3,
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [v1, v2, v3]);
      const result = service.importPack(json, { allowConflicts: true });

      expect(result.versionHistory).toHaveLength(3);
      expect(result.versionHistory![0].version).toBe('1.0.0');
      expect(result.versionHistory![1].version).toBe('1.1.0');
      expect(result.versionHistory![2].version).toBe('2.0.0');
    });

    it('should detect invalid JSON during import', () => {
      const result = service.importPack('not valid json');

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'INVALID_JSON' }),
      );
    });

    it('should detect missing pack in export data', () => {
      const invalidData = {
        formatVersion: '1.0.0',
        versionHistory: [{ version: '1.0.0', releasedAt: new Date().toISOString() }],
        workflows: {},
        exportedAt: new Date().toISOString(),
      };

      const result = service.importPack(JSON.stringify(invalidData));

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'MISSING_PACK' }),
      );
    });

    it('should detect missing workflows in export', () => {
      const pack = createPack(
        'pack-incomplete',
        'Incomplete Pack',
        createPackManifest(
          [createWorkflowReference('w1'), createWorkflowReference('w2')],
          createSequentialPolicy(),
        ),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      // Manually create export with missing workflow
      const exportData: PackExportData = {
        formatVersion: '1.0.0',
        pack,
        versionHistory: [pack.version],
        workflows: { w1: workflow },
        exportedAt: new Date().toISOString(),
      };

      const result = service.importPack(JSON.stringify(exportData));

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'MISSING_WORKFLOWS' }),
      );
    });

    it('should detect format version mismatch', () => {
      const pack = createPack(
        'pack-version',
        'Version Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const exportData: PackExportData = {
        formatVersion: '99.0.0',
        pack,
        versionHistory: [pack.version],
        workflows: { w1: workflow },
        exportedAt: new Date().toISOString(),
      };

      const result = service.importPack(JSON.stringify(exportData));

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'UNSUPPORTED_FORMAT_VERSION' }),
      );
    });

    it('should warn about hash mismatch', () => {
      const pack = createPack(
        'pack-hash-warn',
        'Hash Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const data = JSON.parse(json) as PackExportData;

      // Modify hash to be wrong
      data.hash = 'incorrect_hash_value';

      const result = service.importPack(JSON.stringify(data), { allowConflicts: true });

      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'HASH_MISMATCH' }),
      );
    });
  });

  describe('Format Validation', () => {
    it('should validate required fields', () => {
      const invalidExports = [
        { formatVersion: '1.0.0' }, // Missing pack
        { pack: { id: 'p1', name: 'Test' } }, // Missing formatVersion
        {
          formatVersion: '1.0.0',
          pack: { id: '', name: 'Invalid' }, // Empty id
        },
      ];

      for (const invalidData of invalidExports) {
        const result = service.importPack(JSON.stringify(invalidData));
        expect(result.success).toBe(false);
      }
    });

    it('should validate pack structure', () => {
      const exportData: Partial<PackExportData> = {
        formatVersion: '1.0.0',
        pack: {
          id: 'pack-1',
          name: 'Test',
          // Missing manifest, version, metadata
        } as any,
        versionHistory: [],
        workflows: {},
        exportedAt: new Date().toISOString(),
      };

      const result = service.importPack(JSON.stringify(exportData));

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate deployment policy', () => {
      const pack = createPack(
        'pack-bad-policy',
        'Bad Policy Pack',
        {
          workflows: [createWorkflowReference('w1')],
          policy: { mode: 'invalid' as any },
        },
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const exportData: PackExportData = {
        formatVersion: '1.0.0',
        pack,
        versionHistory: [pack.version],
        workflows: { w1: workflow },
        exportedAt: new Date().toISOString(),
      };

      const result = service.importPack(JSON.stringify(exportData));

      expect(result.success).toBe(false);
    });
  });

  describe('Compatibility Checking', () => {
    it('should check minimum platform version', () => {
      const metadata = createPackMetadata('Author', 'Desc');
      metadata.minimumPlatformVersion = '2.0.0';

      const pack = createPack(
        'pack-platform',
        'Platform Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        metadata,
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      // Current platform is 1.0.0
      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const result = service.importPack(json);

      expect(result.success).toBe(false);
      expect(result.compatibility?.isCompatible).toBe(false);
      expect(result.compatibility?.issues).toContainEqual(
        expect.objectContaining({ type: 'version-mismatch' }),
      );
    });

    it('should check platform support', () => {
      const metadata = createPackMetadata('Author', 'Desc');
      metadata.supportedPlatforms = ['macos', 'linux'];

      const pack = createPack(
        'pack-platform-support',
        'Platform Support Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        metadata,
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      // Current platform is windows
      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const result = service.importPack(json);

      expect(result.success).toBe(false);
      expect(result.compatibility?.isCompatible).toBe(false);
      expect(result.compatibility?.issues).toContainEqual(
        expect.objectContaining({ type: 'platform-unsupported' }),
      );
    });

    it('should warn about deprecated versions', () => {
      const version = createPackVersion('1.0.0', new Date().toISOString());
      version.deprecated = true;

      const pack = createPack(
        'pack-deprecated',
        'Deprecated Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        version,
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const result = service.importPack(json, { allowConflicts: true });

      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'COMPATIBILITY_WARNING' }),
      );
    });

    it('should allow import with incompatibility flag', () => {
      const metadata = createPackMetadata('Author', 'Desc');
      metadata.supportedPlatforms = ['macos'];

      const pack = createPack(
        'pack-incompatible',
        'Incompatible Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        metadata,
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const result = service.importPack(json, {
        allowConflicts: true,
        allowIncompatible: true,
      });

      expect(result.success).toBe(true);
      expect(result.compatibility?.isCompatible).toBe(false);
    });
  });

  describe('Conflict Detection', () => {
    it('should detect duplicate pack ID', () => {
      const pack = createPack(
        'pack-duplicate',
        'Duplicate Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const existingPack = createPack(
        'pack-duplicate',
        'Existing Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Existing Author', 'Existing Desc'),
      );

      service.setExistingPacks([existingPack]);

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const result = service.importPack(json);

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'CONFLICT_DETECTED' }),
      );
    });

    it('should allow conflicts with flag', () => {
      const pack = createPack(
        'pack-dup-allowed',
        'Duplicate Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const existingPack = createPack(
        'pack-dup-allowed',
        'Existing Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      service.setExistingPacks([existingPack]);

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), [pack.version]);
      const result = service.importPack(json, { allowConflicts: true });

      expect(result.success).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'CONFLICT_ALLOWED' }),
      );
    });
  });

  describe('Round-Trip Testing', () => {
    it('should preserve data through export-import cycle', () => {
      const pack = createPack(
        'pack-roundtrip',
        'Round-Trip Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Description'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const success = service.testRoundTrip(pack, new Map([['w1', workflow]]), [pack.version]);

      expect(success).toBe(true);
    });

    it('should handle complex pack in round-trip', () => {
      const workflows = [
        createWorkflow(
          'w1',
          createRecordingStep('s1', 'click', { x: 0.1, y: 0.2 }, 0),
          createWorkflowMetadata('W1', 'D1', '1.0.0'),
        ),
        createWorkflow(
          'w2',
          createRecordingStep('s2', 'keyboard', { key: 'Tab' }, 100),
          createWorkflowMetadata('W2', 'D2', '1.0.0'),
        ),
      ];

      const pack = createPack(
        'pack-complex',
        'Complex Pack',
        createPackManifest(
          [createWorkflowReference('w1'), createWorkflowReference('w2')],
          createSequentialPolicy(3, 100, true),
        ),
        createPackVersion('1.5.0', new Date().toISOString()),
        createPackMetadata('Complex Author', 'Complex Description', 'MIT'),
        [createPackDependency('other-pack', '^1.0.0')],
      );

      const v1 = createPackVersion('1.0.0', new Date(Date.now() - 86400000).toISOString());
      const v2 = pack.version;

      const workflowMap = new Map(workflows.map((w) => [w.id, w]));
      const success = service.testRoundTrip(pack, workflowMap, [v1, v2]);

      expect(success).toBe(true);
    });
  });

  describe('Large Pack Handling', () => {
    it('should handle pack with many workflows', () => {
      const workflows: [string, typeof workflows[0] & any][] = [];
      const references: ReturnType<typeof createWorkflowReference>[] = [];

      for (let i = 0; i < 50; i++) {
        const wf = createWorkflow(
          `w${i}`,
          createRecordingStep(`s${i}`, 'click', { x: 0.5, y: 0.5 }, i * 100),
          createWorkflowMetadata(`W${i}`, `D${i}`, '1.0.0'),
        );
        workflows.push([`w${i}`, wf]);
        references.push(createWorkflowReference(`w${i}`));
      }

      const pack = createPack(
        'pack-large',
        'Large Pack',
        createPackManifest(references, createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const json = service.exportPack(pack, new Map(workflows), [pack.version]);
      const result = service.importPack(json, { allowConflicts: true });

      expect(result.success).toBe(true);
      expect(Object.keys(result.workflows!)).toHaveLength(50);
    });

    it('should handle large version history', () => {
      const versions: typeof pack.version[] = [];
      let baseTime = Date.now();

      for (let i = 1; i <= 100; i++) {
        const v = createPackVersion(
          `${Math.floor(i / 100)}.${Math.floor((i % 100) / 10)}.${i % 10}`,
          new Date(baseTime).toISOString(),
        );
        versions.push(v);
        baseTime += 86400000; // Add one day
      }

      const pack = createPack(
        'pack-history-large',
        'History Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        versions[versions.length - 1],
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const json = service.exportPack(pack, new Map([['w1', workflow]]), versions);
      const result = service.importPack(json, { allowConflicts: true });

      expect(result.success).toBe(true);
      expect(result.versionHistory).toHaveLength(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle export with invalid pack', () => {
      const invalidPack = {
        id: 'pack',
        name: 'Test',
        manifest: { workflows: [], policy: { mode: 'sequential' as const } }, // Empty workflows
        version: createPackVersion('1.0.0', new Date().toISOString()),
        metadata: createPackMetadata('Author', 'Desc'),
      };

      expect(() => {
        service.exportPack(invalidPack as any, new Map(), [invalidPack.version]);
      }).toThrow();
    });

    it('should handle import of corrupted data', () => {
      const result = service.importPack('{"corrupted": true, "format": invalid}');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should gracefully handle empty export', () => {
      const result = service.importPack('{}');

      expect(result.success).toBe(false);
    });
  });

  describe('Pack Hash Generation', () => {
    it('should generate consistent hash for same data', () => {
      const pack = createPack(
        'pack-hash-consistent',
        'Hash Pack',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const workflows = new Map([['w1', workflow]]);

      const hash1 = service.generatePackHash(pack, { w1: workflow });
      const hash2 = service.generatePackHash(pack, { w1: workflow });

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different pack', () => {
      const pack1 = createPack(
        'pack-1',
        'Pack 1',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const pack2 = createPack(
        'pack-2',
        'Pack 2',
        createPackManifest([createWorkflowReference('w1')], createSequentialPolicy()),
        createPackVersion('1.0.0', new Date().toISOString()),
        createPackMetadata('Author', 'Desc'),
      );

      const workflow = createWorkflow(
        'w1',
        createRecordingStep('s1', 'click', { x: 0.5, y: 0.5 }, 0),
        createWorkflowMetadata('W', 'D', '1.0.0'),
      );

      const hash1 = service.generatePackHash(pack1, { w1: workflow });
      const hash2 = service.generatePackHash(pack2, { w1: workflow });

      expect(hash1).not.toBe(hash2);
    });
  });
});
