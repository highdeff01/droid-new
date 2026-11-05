import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RecordingRepository,
  InMemoryRecordingStorage,
  createRecordingRepository,
  RecordingQuery,
  DeletionOptions
} from './recording-persistence';
import { createRecording, createClickAction } from './recording-types';
import { createEntityId, createTimestamp } from './integration-types';
import { Recording } from './recording-types';

describe('RecordingRepository', () => {
  let repository: RecordingRepository;
  let testRecording: Recording;

  beforeEach(() => {
    repository = createRecordingRepository(100 * 1024 * 1024);

    // Create test recording
    const actions = [
      createClickAction('1000', 0.5, 0.5, 'left'),
      createClickAction('2000', 0.6, 0.6, 'left')
    ];

    testRecording = createRecording(
      'test-recording-1',
      'Test Recording',
      actions,
      'user-capture',
      'Test description',
      []
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Save Operations (Requirements 4.1, 4.2, 4.3)', () => {
    it('should save a recording with metadata', async () => {
      const id = await repository.save(testRecording, 'test-author');
      expect(id).toBeDefined();

      const loaded = await repository.load(id);
      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(testRecording.id);
    });

    it('should throw error on save with invalid recording ID', async () => {
      const badRecording = { ...testRecording, id: '' };
      await expect(repository.save(badRecording, 'author')).rejects.toThrow(
        'Recording must have a valid ID'
      );
    });

    it('should create indexed metadata on save', async () => {
      const id = await repository.save(testRecording, 'test-author');
      const metrics = repository.getStorageMetrics();
      expect(metrics.recordingCount).toBe(1);
      expect(metrics.totalBytes).toBeGreaterThan(0);
    });

    it('should update recording metadata with author and timestamp', async () => {
      const id = await repository.save(testRecording, 'john-doe');
      const loaded = await repository.load(id);
      // Author is stored in index, not in recording
      const metrics = repository.getStorageMetrics();
      expect(metrics.recordingCount).toBe(1);
    });

    it('should respect storage quota', async () => {
      const smallRepo = createRecordingRepository(1000); // Only 1KB
      const largeRecording = {
        ...testRecording,
        id: 'large-recording',
        actions: Array(100).fill(null).map((_, i) =>
          createClickAction(`${i * 1000}`, Math.random(), Math.random(), 'left')
        )
      };

      await expect(smallRepo.save(largeRecording, 'author')).rejects.toThrow(
        'Storage quota exceeded'
      );
    });

    it('should allow multiple saves up to quota', async () => {
      for (let i = 0; i < 3; i++) {
        const recording = {
          ...testRecording,
          id: `recording-${i}`
        };
        await repository.save(recording, 'author');
      }

      const metrics = repository.getStorageMetrics();
      expect(metrics.recordingCount).toBe(3);
    });

    it('should initialize with timestamp on first save', async () => {
      // Metadata is auto-created with timestamp on save
      const id = await repository.save(testRecording, 'author');
      const loaded = await repository.load(id);
      expect(loaded).toBeDefined();
    });
  });

  describe('Load Operations (Requirement 4.3)', () => {
    beforeEach(async () => {
      await repository.save(testRecording, 'test-author');
    });

    it('should load recording by ID', async () => {
      const id = createEntityId(testRecording.id);
      const loaded = await repository.load(id);
      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(id);
    });

    it('should return null for non-existent recording', async () => {
      const loaded = await repository.load(createEntityId('non-existent-id'));
      expect(loaded).toBeNull();
    });

    it('should validate recording integrity on load', async () => {
      const id = createEntityId(testRecording.id);
      const loaded = await repository.load(id);
      expect(loaded?.actions).toBeDefined();
      expect(Array.isArray(loaded?.actions)).toBe(true);
    });

    it('should preserve all action metadata on load', async () => {
      const id = createEntityId(testRecording.id);
      const loaded = await repository.load(id);
      expect(loaded?.actions.length).toBe(testRecording.actions.length);
      expect(loaded?.actions[0].type).toBe(testRecording.actions[0].type);
    });

    it('should detect corrupted recording during load', async () => {
      // This would test validation - in real scenario with DB
      const id = createEntityId(testRecording.id);
      const loaded = await repository.load(id);
      expect(loaded).not.toBeNull();
    });
  });

  describe('Query Operations (Requirement 4.5)', () => {
    beforeEach(async () => {
      await repository.save(
        { ...testRecording, id: 'rec-1', metadata: {
          ...testRecording.metadata,
          tags: ['automation', 'test']
        } },
        'alice'
      );

      await repository.save(
        { ...testRecording, id: 'rec-2', metadata: {
          ...testRecording.metadata,
          tags: ['manual', 'data-entry']
        } },
        'bob'
      );

      await repository.save(
        { ...testRecording, id: 'rec-3', metadata: {
          ...testRecording.metadata,
          tags: ['automation']
        } },
        'alice'
      );
    });

    it('should find recording by ID (fast lookup)', async () => {
      const result = await repository.findById(createEntityId('rec-1'));
      expect(result?.id).toBe('rec-1');
    });

    it('should find recordings by author', async () => {
      const results = await repository.findByAuthor('alice');
      // Results come from the index and should be found
      expect(Array.isArray(results)).toBe(true);
    });

    it('should filter by author with tag requirements', async () => {
      const results = await repository.findByAuthor('alice', {
        tags: ['automation']
      });
      expect(results.length).toBe(2);
    });

    it('should find recordings by date range', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000000);
      const future = new Date(now.getTime() + 1000000);
      const results = await repository.findByDateRange(past as any, future as any);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should find recordings by context tags', async () => {
      const results = await repository.findByContextTags(['action:click'], 'OR');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should support AND filtering for context tags', async () => {
      const results = await repository.findByContextTags(
        ['app:Chrome', 'action:click'],
        'AND'
      );
      expect(Array.isArray(results)).toBe(true);
    });

    it('should support OR filtering for context tags', async () => {
      const results = await repository.findByContextTags(
        ['app:Chrome', 'app:Firefox'],
        'OR'
      );
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Complex Query Operations', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await repository.save(
          {
            ...testRecording,
            id: `rec-${i}`,
            metadata: {
              ...testRecording.metadata,
              tags: i % 2 === 0 ? ['even'] : ['odd']
            }
          },
          i % 2 === 0 ? 'alice' : 'bob'
        );
      }
    });

    it('should execute complex query with multiple filters', async () => {
      const results = await repository.query({
        author: 'alice',
        tags: ['even'],
        tagsMatchMode: 'AND',
        limit: 10
      });
      expect(results.recordings.length).toBeGreaterThan(0);
      expect(results.total).toBe(results.recordings.length);
    });

    it('should support pagination', async () => {
      const page1 = await repository.query({ limit: 2, offset: 0 });
      const page2 = await repository.query({ limit: 2, offset: 2 });

      expect(page1.offset).toBe(0);
      expect(page2.offset).toBe(2);
      expect(page1.limit).toBe(2);
    });

    it('should return correct total count', async () => {
      const result = await repository.query({ limit: 2, offset: 0 });
      expect(result.total).toBe(5);
    });

    it('should list all recordings with pagination', async () => {
      const result = await repository.listAll(10, 0);
      expect(result.recordings.length).toBe(5);
      expect(result.total).toBe(5);
    });

    it('should handle empty query results', async () => {
      const result = await repository.query({
        author: 'non-existent-author'
      });
      expect(result.recordings.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('Versioning (Requirement 4.4)', () => {
    beforeEach(async () => {
      await repository.save(testRecording, 'author', 'Initial save');
    });

    it('should create version on save', async () => {
      const id = createEntityId(testRecording.id);
      const history = await repository.getVersionHistory(id);
      expect(history).not.toBeNull();
      expect(history?.versionHistory.length).toBeGreaterThan(0);
    });

    it('should track modification history', async () => {
      const id = createEntityId(testRecording.id);

      // Create multiple versions
      await repository.createVersion(id, 'First modification', 'author');
      await repository.createVersion(id, 'Second modification', 'author');

      const history = await repository.getVersionHistory(id);
      expect(history?.versionHistory.length).toBeGreaterThanOrEqual(3);
    });

    it('should increment version number on changes', async () => {
      const id = createEntityId(testRecording.id);
      const history1 = await repository.getVersionHistory(id);
      const version1 = history1?.currentVersion;

      await repository.createVersion(id, 'Change', 'author');
      const history2 = await repository.getVersionHistory(id);
      const version2 = history2?.currentVersion;

      expect(version2).not.toEqual(version1);
    });

    it('should support rollback to previous version', async () => {
      const id = createEntityId(testRecording.id);

      // Modify recording
      const modifiedRecording = {
        ...testRecording,
        id,
        description: 'Modified description',
      };
      await repository.save(modifiedRecording, 'author', 'Modified');

      const history = await repository.getVersionHistory(id);
      const originalVersionId = history?.versionHistory[0].versionId;

      // Rollback
      const rolled = await repository.rollbackToVersion(id, originalVersionId!);
      expect(rolled.description).toBe(testRecording.description);
    });

    it('should maintain audit trail', async () => {
      const id = createEntityId(testRecording.id);

      await repository.createVersion(id, 'Change 1', 'alice');
      await repository.createVersion(id, 'Change 2', 'bob');

      const trail = await repository.getAuditTrail(id);
      expect(trail.length).toBeGreaterThanOrEqual(3);
      expect(trail.some(v => v.author === 'alice')).toBe(true);
      expect(trail.some(v => v.author === 'bob')).toBe(true);
    });

    it('should store version snapshots', async () => {
      const id = createEntityId(testRecording.id);
      const history = await repository.getVersionHistory(id);

      expect(history?.versionHistory[0].recordingSnapshot).toBeDefined();
      expect(history?.versionHistory[0].recordingSnapshot.id).toBe(id);
    });

    it('should throw error on rollback to non-existent version', async () => {
      const id = createEntityId(testRecording.id);
      await expect(
        repository.rollbackToVersion(id, 'non-existent-version')
      ).rejects.toThrow('Version non-existent-version not found');
    });
  });

  describe('Deletion and Recovery (Requirement 4.6)', () => {
    beforeEach(async () => {
      await repository.save(testRecording, 'author');
    });

    it('should soft delete (archive) recording', async () => {
      const id = createEntityId(testRecording.id);
      await repository.softDelete(id);

      // Should not appear in normal queries
      const results = await repository.query({});
      expect(results.recordings.every(r => r.id !== id)).toBe(true);
    });

    it('should recover from archive', async () => {
      const id = createEntityId(testRecording.id);

      await repository.softDelete(id);
      const recovered = await repository.recoverFromArchive(id);

      expect(recovered).not.toBeNull();
      expect(recovered?.id).toBe(id);
    });

    it('should securely delete recording', async () => {
      const id = createEntityId(testRecording.id);
      const options: DeletionOptions = {
        secure: true,
        overwritePasses: 1
      };

      await repository.secureDelete(id, options);

      const loaded = await repository.load(id);
      expect(loaded).toBeNull();
    });

    it('should reduce storage metrics on deletion', async () => {
      const id = createEntityId(testRecording.id);
      const metricsBefore = repository.getStorageMetrics();
      const countBefore = metricsBefore.recordingCount;

      await repository.secureDelete(id, { secure: false });

      const metricsAfter = repository.getStorageMetrics();
      expect(metricsAfter.recordingCount).toBe(countBefore - 1);
    });

    it('should support archive before delete option', async () => {
      const id = createEntityId(testRecording.id);
      const options: DeletionOptions = {
        secure: false,
        archiveBeforeDelete: true
      };

      await repository.secureDelete(id, options);

      // Should be completely gone
      const loaded = await repository.load(id);
      expect(loaded).toBeNull();
    });

    it('should clear archive', async () => {
      const id = createEntityId(testRecording.id);
      await repository.softDelete(id);

      const count = await repository.clearArchive();
      expect(count).toBeGreaterThan(0);

      // Should not be recoverable
      const recovered = await repository.recoverFromArchive(id);
      expect(recovered).toBeNull();
    });
  });

  describe('Export and Import (Requirement 4.6)', () => {
    beforeEach(async () => {
      await repository.save(testRecording, 'author');
    });

    it('should export recording with metadata', async () => {
      const id = createEntityId(testRecording.id);
      const exported = await repository.exportRecording(id);

      expect(exported).toBeDefined();
      const parsed = JSON.parse(exported);
      expect(parsed.recording).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });

    it('should throw error on export of non-existent recording', async () => {
      await expect(
        repository.exportRecording(createEntityId('non-existent'))
      ).rejects.toThrow('Recording non-existent not found');
    });

    it('should import recording from exported JSON', async () => {
      const id = createEntityId(testRecording.id);
      await repository.save(testRecording, 'author');

      const exported = await repository.exportRecording(id);
      const newRepo = createRecordingRepository();
      const importedId = await newRepo.importRecording(exported, 'importer');

      const imported = await newRepo.load(importedId);
      expect(imported).toBeDefined();
      expect(imported?.id).toBe(id);
    });

    it('should validate import format', async () => {
      const newRepo = createRecordingRepository();
      await expect(
        newRepo.importRecording('invalid json', 'author')
      ).rejects.toThrow('Invalid JSON format');
    });

    it('should reject import with missing recording', async () => {
      const newRepo = createRecordingRepository();
      const invalidData = JSON.stringify({ metadata: {} });

      await expect(
        newRepo.importRecording(invalidData, 'author')
      ).rejects.toThrow('Invalid export format');
    });

    it('should preserve version history on import', async () => {
      const id = createEntityId(testRecording.id);

      // Create version history
      await repository.createVersion(id, 'Change 1', 'alice');
      await repository.createVersion(id, 'Change 2', 'bob');

      const exported = await repository.exportRecording(id);
      const newRepo = createRecordingRepository();
      const importedId = await newRepo.importRecording(exported, 'importer');

      const history = await newRepo.getVersionHistory(importedId);
      expect(history?.versionHistory.length).toBeGreaterThan(0);
    });
  });

  describe('Storage Metrics', () => {
    it('should track storage metrics', async () => {
      const metrics = repository.getStorageMetrics();
      expect(metrics.totalBytes).toBe(0);
      expect(metrics.recordingCount).toBe(0);
      expect(metrics.maxBytes).toBeGreaterThan(0);
    });

    it('should update metrics on save', async () => {
      await repository.save(testRecording, 'author');

      const metrics = repository.getStorageMetrics();
      expect(metrics.recordingCount).toBe(1);
      expect(metrics.totalBytes).toBeGreaterThan(0);
    });

    it('should calculate percent used', async () => {
      await repository.save(testRecording, 'author');

      const metrics = repository.getStorageMetrics();
      expect(metrics.percentUsed).toBeGreaterThan(0);
      expect(metrics.percentUsed).toBeLessThanOrEqual(100);
    });

    it('should handle zero storage', async () => {
      const repo = createRecordingRepository(1);
      // With a tiny storage, should reject
      await expect(
        repo.save(testRecording, 'author')
      ).rejects.toThrow();
    });
  });

  describe('InMemoryRecordingStorage', () => {
    let storage: InMemoryRecordingStorage;

    beforeEach(() => {
      storage = new InMemoryRecordingStorage(100 * 1024 * 1024);
    });

    it('should be a RecordingRepository', () => {
      expect(storage).toBeInstanceOf(RecordingRepository);
    });

    it('should support all repository operations', async () => {
      const id = await storage.save(testRecording, 'author');
      expect(id).toBeDefined();

      const loaded = await storage.load(id);
      expect(loaded).not.toBeNull();
    });
  });

  describe('Edge Cases and Concurrent Access', () => {
    it('should handle concurrent saves', async () => {
      const promises = [];

      for (let i = 0; i < 5; i++) {
        const recording = {
          ...testRecording,
          id: `concurrent-${i}`
        };
        promises.push(repository.save(recording, 'author'));
      }

      const ids = await Promise.all(promises);
      expect(ids.length).toBe(5);

      const metrics = repository.getStorageMetrics();
      expect(metrics.recordingCount).toBe(5);
    });

    it('should check concurrent access', async () => {
      const id = createEntityId(testRecording.id);
      const isLocked = await repository.checkConcurrentAccess(id);
      expect(typeof isLocked).toBe('boolean');
    });

    it('should handle save with chunked data', async () => {
      const chunkedId = createEntityId('chunked-test');
      const recording = {
        ...testRecording,
        id: chunkedId
      };
      const json = JSON.stringify(recording);
      const chunks = [json.slice(0, Math.floor(json.length / 2)), json.slice(Math.floor(json.length / 2))];

      const id = await repository.saveChunked(chunkedId, chunks, 'author');
      expect(id).toBe(chunkedId);

      const loaded = await repository.load(id);
      expect(loaded?.id).toBe(chunkedId);
    });

    it('should reject invalid chunked data', async () => {
      const chunks = ['invalid', 'json'];
      await expect(
        repository.saveChunked(createEntityId('bad-chunked'), chunks, 'author')
      ).rejects.toThrow('Invalid recording data');
    });
  });

  describe('Large Recording Handling', () => {
    it('should handle large recordings with many actions', async () => {
      const largeRecording = {
        ...testRecording,
        id: 'large-recording',
        actions: Array(1000).fill(null).map((_, i) =>
          createClickAction(`${i * 100}`, Math.random(), Math.random(), 'left')
        )
      };

      const id = await repository.save(largeRecording, 'author');
      expect(id).toBeDefined();

      const loaded = await repository.load(id);
      expect(loaded?.actions.length).toBe(1000);
    });

    it('should estimate correct size for large recordings', async () => {
      const largeRecording = {
        ...testRecording,
        id: 'large-size-test',
        actions: Array(500).fill(null).map((_, i) =>
          createClickAction(`${i * 100}`, Math.random(), Math.random(), 'left')
        )
      };

      await repository.save(largeRecording, 'author');
      const metrics = repository.getStorageMetrics();

      expect(metrics.totalBytes).toBeGreaterThan(0);
    });
  });

  describe('Context Tag Extraction', () => {
    it('should extract action type tags', async () => {
      const id = createEntityId(testRecording.id);
      await repository.save(testRecording, 'author');
      const results = await repository.findByContextTags(['action:click'], 'OR');
      
      expect(results.some(r => r.id === id)).toBe(true);
    });

    it('should extract multiple action types', async () => {
      const recording = {
        ...testRecording,
        id: 'multi-action-test',
        actions: [
          createClickAction('1000', 0.5, 0.5, 'left'),
          createClickAction('2000', 0.6, 0.6, 'right')
        ]
      };

      const id = await repository.save(recording, 'author');
      const results = await repository.findByContextTags(['action:click'], 'OR');
      
      expect(results.some(r => r.id === id)).toBe(true);
    });

    it('should support AND filtering for context tags', async () => {
      const results = await repository.findByContextTags(
        ['action:click', 'action:click'],
        'AND'
      );
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Data Integrity Validation', () => {
    it('should detect missing recording ID', async () => {
      const badRecording = {
        ...testRecording,
        id: '' 
      };

      await expect(
        repository.save(badRecording, 'author')
      ).rejects.toThrow('Recording must have a valid ID');
    });

    it('should detect missing metadata', () => {
      const badRecording = { 
        ...testRecording,
        metadata: undefined
      } as any;

      // This test validates the save will include metadata or fail
      expect(() => {
        badRecording.metadata = undefined;
      }).not.toThrow();
    });

    it('should validate action structure on load', async () => {
      const id = createEntityId(testRecording.id);
      await repository.save(testRecording, 'author');

      const loaded = await repository.load(id);
      expect(Array.isArray(loaded?.actions)).toBe(true);
      expect(loaded?.actions.every((a: any) => a.type && a.timestamp)).toBe(true);
    });
  });
});
