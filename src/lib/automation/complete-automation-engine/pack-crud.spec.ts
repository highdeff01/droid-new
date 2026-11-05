/**
 * Pack CRUD Operations Tests
 *
 * Comprehensive test suite for PackManager covering:
 * - Create operations (new packs with metadata)
 * - Read operations (single, batch, and search)
 * - Update operations (metadata, workflows, policies)
 * - Delete operations (soft and hard delete)
 * - Version control and history
 * - Audit trail
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PackManager } from './pack-crud';
import {
  createWorkflowReference,
  createSequentialPolicy,
} from '../../../../pack-types';

describe('PackManager - CRUD Operations', () => {
  let manager: PackManager;

  beforeEach(() => {
    manager = new PackManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('Create Operations', () => {
    it('should create a new pack with name, description, and author', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack(
        'Test Pack',
        'A test automation pack',
        'author@example.com',
        workflows,
      );

      expect(pack).toBeDefined();
      expect(pack.name).toBe('Test Pack');
      expect(pack.metadata.description).toBe('A test automation pack');
      expect(pack.metadata.author).toBe('author@example.com');
    });

    it('should initialize version to 1.0.0 on creation', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Test Pack', 'Description', 'author', workflows);

      expect(pack.version.version).toBe('1.0.0');
    });

    it('should set creation timestamp', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const beforeCreate = new Date().toISOString();
      const pack = manager.createPack('Test Pack', 'Description', 'author', workflows);
      const afterCreate = new Date().toISOString();

      expect(pack.metadata.createdAt <= afterCreate).toBe(true);
      expect(pack.metadata.createdAt >= beforeCreate).toBe(true);
    });

    it('should generate unique pack IDs', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack1 = manager.createPack('Pack 1', 'Desc 1', 'author', workflows);
      const pack2 = manager.createPack('Pack 2', 'Desc 2', 'author', workflows);

      expect(pack1.id).not.toBe(pack2.id);
    });

    it('should include workflow references in manifest', () => {
      const workflows = [
        createWorkflowReference('workflow_1'),
        createWorkflowReference('workflow_2'),
      ];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      expect(pack.manifest.workflows).toHaveLength(2);
      expect(pack.manifest.workflows[0].workflowId).toBe('workflow_1');
      expect(pack.manifest.workflows[1].workflowId).toBe('workflow_2');
    });

    it('should support tags on creation', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const tags = ['automation', 'workflow', 'production'];
      const pack = manager.createPack(
        'Pack',
        'Description',
        'author',
        workflows,
        undefined,
        tags,
      );

      expect(pack.metadata.tags).toEqual(tags);
    });

    it('should create default sequential deployment policy', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      expect(pack.manifest.policy.mode).toBe('sequential');
      expect(pack.manifest.policy.maxRetries).toBe(3);
    });

    it('should support custom deployment policy on creation', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const customPolicy = createSequentialPolicy(5, 2000, true);
      const pack = manager.createPack('Pack', 'Description', 'author', workflows, customPolicy);

      expect(pack.manifest.policy.maxRetries).toBe(5);
      expect(pack.manifest.policy.retryDelayMs).toBe(2000);
    });

    it('should create audit entry on pack creation', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author@example.com', workflows);

      const audit = manager.getAuditLog(pack.id);
      expect(audit).toHaveLength(1);
      expect(audit[0].operation).toBe('create');
      expect(audit[0].actor).toBe('author@example.com');
    });

    it('should validate pack structure on creation', () => {
      const workflows = [createWorkflowReference('')]; // Invalid workflow ID
      expect(() => {
        manager.createPack('Pack', 'Description', 'author', workflows);
      }).toThrow();
    });
  });

  describe('Read Operations', () => {
    it('should retrieve pack by ID', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const created = manager.createPack('Pack', 'Description', 'author', workflows);

      const retrieved = manager.readPack(created.id);
      expect(retrieved).toEqual(created);
    });

    it('should throw error when reading non-existent pack', () => {
      expect(() => {
        // @ts-ignore
        manager.readPack('non_existent_pack_id_xyz');
      }).toThrow('Pack not found');
    });

    it('should retrieve multiple packs by ID array', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack1 = manager.createPack('Pack 1', 'Desc 1', 'author', workflows);
      const pack2 = manager.createPack('Pack 2', 'Desc 2', 'author', workflows);
      const pack3 = manager.createPack('Pack 3', 'Desc 3', 'author', workflows);

      const retrieved = manager.readPacksBatch([pack1.id, pack2.id, pack3.id]);
      expect(retrieved).toHaveLength(3);
    });

    it('should skip non-existent packs in batch retrieval', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack1 = manager.createPack('Pack 1', 'Desc 1', 'author', workflows);
      const pack2 = manager.createPack('Pack 2', 'Desc 2', 'author', workflows);

      // @ts-ignore - Using string for test purposes
      const retrieved = manager.readPacksBatch([pack1.id, 'fake_id', pack2.id]);
      expect(retrieved).toHaveLength(2);
    });

    it('should retrieve all packs', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      manager.createPack('Pack 1', 'Desc 1', 'author', workflows);
      manager.createPack('Pack 2', 'Desc 2', 'author', workflows);
      manager.createPack('Pack 3', 'Desc 3', 'author', workflows);

      const all = manager.readAllPacks();
      expect(all).toHaveLength(3);
    });

    it('should search packs by name', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      manager.createPack('Email Automation', 'Desc', 'author', workflows);
      manager.createPack('File Processing', 'Desc', 'author', workflows);

      const results = manager.searchPacks({ name: 'Email' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Email Automation');
    });

    it('should search packs by author', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      manager.createPack('Pack 1', 'Desc', 'alice@example.com', workflows);
      manager.createPack('Pack 2', 'Desc', 'bob@example.com', workflows);
      manager.createPack('Pack 3', 'Desc', 'alice@example.com', workflows);

      const results = manager.searchPacks({ author: 'alice@example.com' });
      expect(results).toHaveLength(2);
    });

    it('should search packs by tags', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      manager.createPack('Pack 1', 'Desc', 'author', workflows, undefined, ['automation']);
      manager.createPack('Pack 2', 'Desc', 'author', workflows, undefined, ['database']);
      manager.createPack('Pack 3', 'Desc', 'author', workflows, undefined, ['automation', 'database']);

      const results = manager.searchPacks({ tags: ['automation'] });
      expect(results).toHaveLength(2);
    });
  });

  describe('Update Operations', () => {
    it('should update pack name', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Original', 'Description', 'author', workflows);

      const updated = manager.updatePackMetadata(pack.id, { name: 'Updated' }, 'updater');
      expect(updated.name).toBe('Updated');
    });

    it('should update pack description', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Original desc', 'author', workflows);

      const updated = manager.updatePackMetadata(
        pack.id,
        { description: 'New description' },
        'updater',
      );
      expect(updated.metadata.description).toBe('New description');
    });

    it('should bump patch version on metadata update', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      const updated = manager.updatePackMetadata(pack.id, { name: 'Updated' }, 'updater');
      expect(updated.version.version).toBe('1.0.1');
    });

    it('should update pack workflows', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      const newWorkflows = [
        createWorkflowReference('workflow_2'),
        createWorkflowReference('workflow_3'),
      ];
      const updated = manager.updatePackWorkflows(pack.id, newWorkflows, 'updater');

      expect(updated.manifest.workflows).toHaveLength(2);
      expect(updated.manifest.workflows[0].workflowId).toBe('workflow_2');
    });

    it('should add workflow to pack', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      const newWorkflow = createWorkflowReference('workflow_2');
      const updated = manager.addWorkflowToPack(pack.id, newWorkflow, 'updater');

      expect(updated.manifest.workflows).toHaveLength(2);
    });

    it('should remove workflow from pack', () => {
      const workflows = [
        createWorkflowReference('workflow_1'),
        createWorkflowReference('workflow_2'),
      ];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      const updated = manager.removeWorkflowFromPack(pack.id, 'workflow_1', 'updater');
      expect(updated.manifest.workflows).toHaveLength(1);
    });

    it('should throw error when removing last workflow', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      expect(() => {
        manager.removeWorkflowFromPack(pack.id, 'workflow_1', 'updater');
      }).toThrow('Cannot remove last workflow from pack');
    });

    it('should reorder workflows in pack', () => {
      const workflows = [
        createWorkflowReference('workflow_1'),
        createWorkflowReference('workflow_2'),
        createWorkflowReference('workflow_3'),
      ];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      const updated = manager.reorderWorkflows(
        pack.id,
        ['workflow_3', 'workflow_1', 'workflow_2'],
        'updater',
      );

      expect(updated.manifest.workflows[0].workflowId).toBe('workflow_3');
      expect(updated.manifest.workflows[1].workflowId).toBe('workflow_1');
    });

    it('should update deployment policy', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      const newPolicy = createSequentialPolicy(5, 2000, true);
      const updated = manager.updateDeploymentPolicy(pack.id, newPolicy, 'updater');

      expect(updated.manifest.policy.maxRetries).toBe(5);
    });
  });

  describe('Delete Operations', () => {
    it('should soft delete a pack', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.softDeletePack(pack.id, 'deleter', 'Test reason');

      expect(() => {
        manager.readPack(pack.id);
      }).toThrow('Pack not found');
    });

    it('should maintain archived pack after soft delete', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.softDeletePack(pack.id, 'deleter');

      const archived = manager.listArchivedPacks();
      expect(archived).toHaveLength(1);
      expect(archived[0].pack.id).toBe(pack.id);
      expect(archived[0].soft).toBe(true);
    });

    it('should restore soft-deleted pack', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.softDeletePack(pack.id, 'deleter');
      const restored = manager.restorePack(pack.id, 'restorer');

      expect(restored.id).toBe(pack.id);
    });

    it('should hard delete a pack', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.hardDeletePack(pack.id, 'deleter', 'Permanent removal');

      expect(() => {
        manager.readPack(pack.id);
      }).toThrow('Pack not found');
    });

    it('should throw error restoring hard-deleted pack', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.hardDeletePack(pack.id, 'deleter');

      expect(() => {
        manager.restorePack(pack.id, 'restorer');
      }).toThrow('Cannot restore hard-deleted pack');
    });
  });

  describe('Version Control', () => {
    it('should retrieve version history', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.updatePackMetadata(pack.id, { name: 'Update 1' }, 'updater');
      manager.updatePackMetadata(pack.id, { name: 'Update 2' }, 'updater');

      const history = manager.getVersionHistory(pack.id);
      expect(history).toHaveLength(3);
      expect(history[0].version).toBe('1.0.0');
      expect(history[1].version).toBe('1.0.1');
      expect(history[2].version).toBe('1.0.2');
    });

    it('should retrieve specific version', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.updatePackMetadata(pack.id, { name: 'Updated' }, 'updater');

      const version = manager.getPackVersion(pack.id, '1.0.1');
      expect(version.version).toBe('1.0.1');
    });

    it('should throw error on non-existent version', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      expect(() => {
        manager.getPackVersion(pack.id, '2.0.0');
      }).toThrow('Version not found');
    });
  });

  describe('Audit Trail', () => {
    it('should record audit entries for all operations', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.updatePackMetadata(pack.id, { name: 'Updated' }, 'updater');
      manager.softDeletePack(pack.id, 'deleter');

      const audit = manager.getAuditLog(pack.id);
      expect(audit).toHaveLength(3);
      expect(audit[0].operation).toBe('create');
      expect(audit[1].operation).toBe('metadata_change');
      expect(audit[2].operation).toBe('delete');
    });

    it('should retrieve audit log for specific pack', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack1 = manager.createPack('Pack 1', 'Description', 'author', workflows);
      const pack2 = manager.createPack('Pack 2', 'Description', 'author', workflows);

      manager.updatePackMetadata(pack1.id, { name: 'Updated' }, 'updater');

      const audit1 = manager.getAuditLog(pack1.id);
      const audit2 = manager.getAuditLog(pack2.id);

      expect(audit1).toHaveLength(2);
      expect(audit2).toHaveLength(1);
    });

    it('should retrieve full audit log', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      manager.createPack('Pack 1', 'Description', 'author', workflows);
      manager.createPack('Pack 2', 'Description', 'author', workflows);

      const fullAudit = manager.getAuditLog();
      expect(fullAudit).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty pack list', () => {
      const all = manager.readAllPacks();
      expect(all).toEqual([]);
    });

    it('should handle batch retrieval with empty array', () => {
      const retrieved = manager.readPacksBatch([]);
      expect(retrieved).toEqual([]);
    });

    it('should support large metadata', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const longDescription = 'A'.repeat(1000);
      const pack = manager.createPack('Pack', longDescription, 'author', workflows);

      expect(pack.metadata.description).toHaveLength(1000);
    });

    it('should support many workflows in a pack', () => {
      const workflows = Array.from({ length: 50 }, (_, i) =>
        createWorkflowReference(`workflow_${i + 1}`),
      );
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      expect(pack.manifest.workflows).toHaveLength(50);
    });

    it('should support concurrent operations', () => {
      const workflows = [createWorkflowReference('workflow_1')];

      const packs = Array.from({ length: 10 }, (_, i) =>
        manager.createPack(`Pack ${i}`, `Description ${i}`, `author${i}`, workflows),
      );

      expect(manager.getPackCount()).toBe(10);
      expect(packs.every((p) => p.id)).toBe(true);
    });

    it('should track archived pack count', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack1 = manager.createPack('Pack 1', 'Description', 'author', workflows);
      const pack2 = manager.createPack('Pack 2', 'Description', 'author', workflows);

      expect(manager.getArchivedPackCount()).toBe(0);

      manager.softDeletePack(pack1.id, 'deleter');
      expect(manager.getArchivedPackCount()).toBe(1);

      manager.hardDeletePack(pack2.id, 'deleter');
      expect(manager.getArchivedPackCount()).toBe(2);
    });

    it('should list all archived packs', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack1 = manager.createPack('Pack 1', 'Description', 'author', workflows);
      const pack2 = manager.createPack('Pack 2', 'Description', 'author', workflows);

      manager.softDeletePack(pack1.id, 'deleter');
      manager.hardDeletePack(pack2.id, 'deleter');

      const archived = manager.listArchivedPacks();
      expect(archived).toHaveLength(2);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete pack lifecycle', () => {
      const workflows = [
        createWorkflowReference('workflow_1'),
        createWorkflowReference('workflow_2'),
      ];
      const pack = manager.createPack('Pack', 'Initial description', 'author', workflows);

      let updated = manager.updatePackMetadata(
        pack.id,
        { description: 'Updated description', tags: ['v1'] },
        'updater',
      );
      expect(updated.version.version).toBe('1.0.1');

      updated = manager.addWorkflowToPack(pack.id, createWorkflowReference('workflow_3'), 'updater');
      expect(updated.manifest.workflows).toHaveLength(3);

      updated = manager.removeWorkflowFromPack(pack.id, 'workflow_2', 'updater');
      expect(updated.manifest.workflows).toHaveLength(2);

      const history = manager.getVersionHistory(pack.id);
      expect(history).toHaveLength(4);
    });

    it('should maintain audit trail through lifecycle', () => {
      const workflows = [createWorkflowReference('workflow_1')];
      const pack = manager.createPack('Pack', 'Description', 'author', workflows);

      manager.updatePackMetadata(pack.id, { name: 'Updated' }, 'updater1');
      manager.addWorkflowToPack(pack.id, createWorkflowReference('workflow_2'), 'updater2');
      manager.softDeletePack(pack.id, 'deleter');
      manager.restorePack(pack.id, 'restorer');

      const audit = manager.getAuditLog(pack.id);
      expect(audit).toHaveLength(5);
      expect(audit.map((a) => a.operation)).toEqual([
        'create',
        'metadata_change',
        'workflow_change',
        'delete',
        'restore',
      ]);
    });
  });
});
