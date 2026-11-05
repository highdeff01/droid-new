/**
 * Pack Workflow Manager Tests
 *
 * Comprehensive test suite for PackWorkflowManager including:
 * - Adding workflows with validation
 * - Removing workflows with integrity checks
 * - Reordering workflows
 * - Workflow reference resolution and caching
 * - Batch operations
 * - Edge cases and error scenarios
 * - Audit trail tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PackWorkflowManager,
  createPackWorkflowManager,
  type WorkflowAuditEntry,
  type BatchOperationResult,
} from './pack-workflow-manager';
import {
  Pack,
  WorkflowReference,
  createPack,
  createPackManifest,
  createWorkflowReference,
  createSequentialPolicy,
  createParallelPolicy,
  createPackVersion,
  createPackMetadata,
  DeploymentPolicy,
} from '../../../../pack-types';
import { Workflow, createWorkflow, createWorkflowMetadata } from '../../../../workflow-types';
import type { EntityId, Timestamp } from '../../../../integration-types';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestPack(
  id: EntityId,
  workflows: WorkflowReference[] = [],
  policy?: DeploymentPolicy,
): Pack {
  const now = new Date().toISOString() as Timestamp;
  const manifest = createPackManifest(
    workflows.length > 0 ? workflows : [createWorkflowReference('wf-default-1')],
    policy || createSequentialPolicy(),
  );

  return createPack(
    id,
    'Test Pack',
    manifest,
    createPackVersion('1.0.0', now),
    createPackMetadata('test-author', 'Test pack for testing'),
  );
}

function createTestWorkflow(id: string, name: string = 'Test Workflow'): Workflow {
  const now = new Date().toISOString();
  return createWorkflow(
    id,
    name,
    [],
    createWorkflowMetadata('1.0.0', 'user-created', ['test']),
  );
}

// ============================================================================
// Basic Workflow Addition Tests
// ============================================================================

describe('PackWorkflowManager - Add Workflows', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;
  let testPack: Pack;

  beforeEach(() => {
    packsStorage = new Map();
    testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage);
  });

  it('should add a single workflow to a pack', () => {
    const wfRef = createWorkflowReference('wf-2');
    const updated = manager.addWorkflow('pack-1' as EntityId, wfRef, 'test-user');

    expect(updated.manifest.workflows).toHaveLength(2);
    expect(updated.manifest.workflows[1].workflowId).toBe('wf-2');
    expect(updated.version.version).toBe('1.0.1');
  });

  it('should add multiple workflows sequentially', () => {
    manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-2'), 'test-user');
    manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-3'), 'test-user');

    const updated = manager.addWorkflow(
      'pack-1' as EntityId,
      createWorkflowReference('wf-4'),
      'test-user',
    );

    expect(updated.manifest.workflows).toHaveLength(4);
    expect(updated.version.version).toBe('1.0.3');
  });

  it('should accept workflow with version constraint', () => {
    const wfRef = createWorkflowReference('wf-2', '^1.0.0');
    const updated = manager.addWorkflow('pack-1' as EntityId, wfRef, 'test-user');

    expect(updated.manifest.workflows[1].version).toBe('^1.0.0');
  });

  it('should accept optional workflow', () => {
    const wfRef = createWorkflowReference('wf-2', undefined, true);
    const updated = manager.addWorkflow('pack-1' as EntityId, wfRef, 'test-user');

    expect(updated.manifest.workflows[1].optional).toBe(true);
  });

  it('should update pack modification timestamp', () => {
    const updated = manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-2'), 'test-user');

    // Verify that updatedAt is a valid ISO timestamp
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(updated.metadata.updatedAt)).toBe(true);
  });

  it('should create audit entry for add operation', () => {
    manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-2'), 'test-user');
    const auditLog = manager.getWorkflowAuditLog('pack-1' as EntityId);

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].operation).toBe('add');
    expect(auditLog[0].actor).toBe('test-user');
    expect(auditLog[0].workflowIds).toEqual(['wf-2']);
  });
});

// ============================================================================
// Workflow Addition Validation Tests
// ============================================================================

describe('PackWorkflowManager - Add Validation', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;

  beforeEach(() => {
    packsStorage = new Map();
    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage);
  });

  it('should reject duplicate workflow ID', () => {
    expect(() => {
      manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-1'), 'test-user');
    }).toThrow('Duplicate workflow ID');
  });

  it('should allow duplicate when checkDuplicates is false', () => {
    const wfRef = createWorkflowReference('wf-1');
    const updated = manager.addWorkflow('pack-1' as EntityId, wfRef, 'test-user', {
      checkDuplicates: false,
    });

    expect(updated.manifest.workflows).toHaveLength(2);
  });

  it('should reject invalid workflow reference with empty ID', () => {
    expect(() => {
      manager.addWorkflow(
        'pack-1' as EntityId,
        createWorkflowReference(''),
        'test-user',
      );
    }).toThrow();
  });

  it('should reject optional workflows with incompatible policies', () => {
    const optionalWf = createWorkflowReference('wf-2', undefined, true);
    const strictPolicy = createSequentialPolicy(3, 1000, true, false);

    const pack = createTestPack('pack-2' as EntityId, [createWorkflowReference('wf-1')], strictPolicy);
    packsStorage.set('pack-2' as EntityId, pack);

    expect(() => {
      manager.addWorkflow('pack-2' as EntityId, optionalWf, 'test-user');
    }).toThrow('incompatible');
  });

  it('should accept optional workflows with compatible policies', () => {
    const optionalWf = createWorkflowReference('wf-2', undefined, true);
    const lenientPolicy = createSequentialPolicy(3, 1000, false, false);

    const pack = createTestPack('pack-2' as EntityId, [createWorkflowReference('wf-1')], lenientPolicy);
    packsStorage.set('pack-2' as EntityId, pack);

    const updated = manager.addWorkflow('pack-2' as EntityId, optionalWf, 'test-user');
    expect(updated.manifest.workflows).toHaveLength(2);
  });

  it('should throw on non-existent pack', () => {
    expect(() => {
      manager.addWorkflow('pack-999' as EntityId, createWorkflowReference('wf-2'), 'test-user');
    }).toThrow('Pack not found');
  });
});

// ============================================================================
// Workflow Removal Tests
// ============================================================================

describe('PackWorkflowManager - Remove Workflows', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;

  beforeEach(() => {
    packsStorage = new Map();
    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-2'),
      createWorkflowReference('wf-3'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage);
  });

  it('should remove a workflow from a pack', () => {
    const updated = manager.removeWorkflow('pack-1' as EntityId, 'wf-2', 'test-user');

    expect(updated.manifest.workflows).toHaveLength(2);
    expect(updated.manifest.workflows.map((w) => w.workflowId)).toEqual(['wf-1', 'wf-3']);
    expect(updated.version.version).toBe('1.0.1');
  });

  it('should remove first workflow', () => {
    const updated = manager.removeWorkflow('pack-1' as EntityId, 'wf-1', 'test-user');

    expect(updated.manifest.workflows).toHaveLength(2);
    expect(updated.manifest.workflows[0].workflowId).toBe('wf-2');
  });

  it('should remove last workflow', () => {
    const updated = manager.removeWorkflow('pack-1' as EntityId, 'wf-3', 'test-user');

    expect(updated.manifest.workflows).toHaveLength(2);
    expect(updated.manifest.workflows[1].workflowId).toBe('wf-2');
  });

  it('should create audit entry for remove operation', () => {
    manager.removeWorkflow('pack-1' as EntityId, 'wf-2', 'test-user');
    const auditLog = manager.getWorkflowAuditLog('pack-1' as EntityId);

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].operation).toBe('remove');
    expect(auditLog[0].workflowIds).toEqual(['wf-2']);
    expect(auditLog[0].details.removedIndex).toBe(1);
  });

  it('should throw when removing last workflow', () => {
    const singleWfPack = createTestPack('pack-2' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-2' as EntityId, singleWfPack);

    expect(() => {
      manager.removeWorkflow('pack-2' as EntityId, 'wf-1', 'test-user');
    }).toThrow('Cannot remove last workflow');
  });

  it('should throw when removing non-existent workflow', () => {
    expect(() => {
      manager.removeWorkflow('pack-1' as EntityId, 'wf-999', 'test-user');
    }).toThrow('Workflow not found in pack');
  });

  it('should throw on non-existent pack', () => {
    expect(() => {
      manager.removeWorkflow('pack-999' as EntityId, 'wf-1', 'test-user');
    }).toThrow('Pack not found');
  });
});

// ============================================================================
// Workflow Reordering Tests
// ============================================================================

describe('PackWorkflowManager - Reorder Workflows', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;

  beforeEach(() => {
    packsStorage = new Map();
    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-2'),
      createWorkflowReference('wf-3'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage);
  });

  it('should reorder workflows', () => {
    const updated = manager.reorderWorkflows(
      'pack-1' as EntityId,
      ['wf-3', 'wf-1', 'wf-2'],
      'test-user',
    );

    expect(updated.manifest.workflows.map((w) => w.workflowId)).toEqual([
      'wf-3',
      'wf-1',
      'wf-2',
    ]);
    expect(updated.version.version).toBe('1.0.1');
  });

  it('should reorder to reverse order', () => {
    const updated = manager.reorderWorkflows(
      'pack-1' as EntityId,
      ['wf-3', 'wf-2', 'wf-1'],
      'test-user',
    );

    expect(updated.manifest.workflows.map((w) => w.workflowId)).toEqual([
      'wf-3',
      'wf-2',
      'wf-1',
    ]);
  });

  it('should create audit entry for reorder operation', () => {
    manager.reorderWorkflows('pack-1' as EntityId, ['wf-3', 'wf-1', 'wf-2'], 'test-user');
    const auditLog = manager.getWorkflowAuditLog('pack-1' as EntityId);

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].operation).toBe('reorder');
    expect(auditLog[0].details.newOrder).toEqual(['wf-3', 'wf-1', 'wf-2']);
  });

  it('should throw on workflow count mismatch', () => {
    expect(() => {
      manager.reorderWorkflows('pack-1' as EntityId, ['wf-1', 'wf-2'], 'test-user');
    }).toThrow('Workflow count mismatch');
  });

  it('should throw when workflow ID not in pack', () => {
    expect(() => {
      manager.reorderWorkflows('pack-1' as EntityId, ['wf-1', 'wf-2', 'wf-999'], 'test-user');
    }).toThrow('Workflow ID mismatch');
  });

  it('should throw when extra workflow ID provided', () => {
    expect(() => {
      manager.reorderWorkflows('pack-1' as EntityId, ['wf-1', 'wf-2', 'wf-3', 'wf-4'], 'test-user');
    }).toThrow('Workflow count mismatch');
  });

  it('should handle single workflow pack', () => {
    const singleWfPack = createTestPack('pack-2' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-2' as EntityId, singleWfPack);

    const updated = manager.reorderWorkflows('pack-2' as EntityId, ['wf-1'], 'test-user');
    expect(updated.manifest.workflows).toHaveLength(1);
  });
});

// ============================================================================
// Workflow Reference Resolution Tests
// ============================================================================

describe('PackWorkflowManager - Resolve Workflows', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;
  let workflowRepo: Map<string, Workflow>;

  beforeEach(() => {
    packsStorage = new Map();
    workflowRepo = new Map();

    // Create test workflows
    const wf1 = createTestWorkflow('wf-1', 'Workflow 1');
    const wf2 = createTestWorkflow('wf-2', 'Workflow 2');
    workflowRepo.set('wf-1', wf1);
    workflowRepo.set('wf-2', wf2);

    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-2'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage, workflowRepo);
  });

  it('should resolve a workflow reference', () => {
    const result = manager.resolveWorkflowReference(createWorkflowReference('wf-1'));

    expect(result.workflow.id).toBe('wf-1');
    expect(result.cached).toBe(false);
    expect(result.warnings).toBeUndefined();
  });

  it('should return cached workflow on second resolution', () => {
    manager.resolveWorkflowReference(createWorkflowReference('wf-1'));
    const result = manager.resolveWorkflowReference(createWorkflowReference('wf-1'));

    expect(result.cached).toBe(true);
  });

  it('should update cache with resolved workflows', () => {
    manager.resolveWorkflowReference(createWorkflowReference('wf-1'));
    const stats = manager.getCacheStats();

    expect(stats.cachedWorkflows).toBe(1);
    expect(stats.cacheKeys).toContain('wf-1');
  });

  it('should handle missing optional workflow gracefully', () => {
    const result = manager.resolveWorkflowReference(
      createWorkflowReference('wf-missing', undefined, true),
    );

    expect(result.workflow.id).toBe('wf-missing');
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.[0]).toContain('not found');
  });

  it('should throw for missing required workflow', () => {
    expect(() => {
      manager.resolveWorkflowReference(createWorkflowReference('wf-missing'));
    }).toThrow('Workflow not found');
  });

  it('should validate workflow version', () => {
    const wfOldVersion = createTestWorkflow('wf-old', 'Old Workflow');
    wfOldVersion.metadata.version = '0.5.0';
    workflowRepo.set('wf-old', wfOldVersion);

    expect(() => {
      manager.resolveWorkflowReference(createWorkflowReference('wf-old', '^1.0.0'));
    }).toThrow('version mismatch');
  });

  it('should accept version-compatible workflows', () => {
    const result = manager.resolveWorkflowReference(
      createWorkflowReference('wf-1', '^1.0.0'),
    );

    expect(result.workflow.id).toBe('wf-1');
  });

  it('should handle version mismatch for optional workflow with warning', () => {
    const wfOldVersion = createTestWorkflow('wf-old', 'Old Workflow');
    wfOldVersion.metadata.version = '0.5.0';
    workflowRepo.set('wf-old', wfOldVersion);

    const result = manager.resolveWorkflowReference(
      createWorkflowReference('wf-old', '^1.0.0', true),
    );

    expect(result.warnings).toBeDefined();
    expect(result.warnings?.[0]).toContain('version mismatch');
  });
});

// ============================================================================
// Batch Operations Tests
// ============================================================================

describe('PackWorkflowManager - Batch Operations', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;
  let workflowRepo: Map<string, Workflow>;

  beforeEach(() => {
    packsStorage = new Map();
    workflowRepo = new Map();

    // Create test workflows
    for (let i = 1; i <= 5; i++) {
      const wf = createTestWorkflow(`wf-${i}`, `Workflow ${i}`);
      workflowRepo.set(`wf-${i}`, wf);
    }

    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage, workflowRepo);
  });

  it('should resolve multiple workflows in batch', () => {
    const refs = [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-2'),
      createWorkflowReference('wf-3'),
    ];

    const result = manager.resolveWorkflowsBatch(refs);

    expect(result.successful).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.resolved).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle partial failures in batch', () => {
    const refs = [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-missing'),
      createWorkflowReference('wf-3'),
    ];

    const result = manager.resolveWorkflowsBatch(refs);

    expect(result.successful).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('wf-missing');
  });

  it('should handle all failures in batch', () => {
    const refs = [
      createWorkflowReference('wf-missing-1'),
      createWorkflowReference('wf-missing-2'),
      createWorkflowReference('wf-missing-3'),
    ];

    const result = manager.resolveWorkflowsBatch(refs);

    expect(result.successful).toBe(0);
    expect(result.failed).toBe(3);
    expect(result.errors).toHaveLength(3);
  });

  it('should handle optional workflows in batch', () => {
    const refs = [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-missing', undefined, true),
      createWorkflowReference('wf-3'),
    ];

    const result = manager.resolveWorkflowsBatch(refs);

    expect(result.successful).toBe(3);
    expect(result.failed).toBe(0);
  });
});

// ============================================================================
// Workflow Getter Tests
// ============================================================================

describe('PackWorkflowManager - Get Workflows', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;
  let workflowRepo: Map<string, Workflow>;

  beforeEach(() => {
    packsStorage = new Map();
    workflowRepo = new Map();

    // Create test workflows
    for (let i = 1; i <= 3; i++) {
      const wf = createTestWorkflow(`wf-${i}`, `Workflow ${i}`);
      workflowRepo.set(`wf-${i}`, wf);
    }

    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-2'),
      createWorkflowReference('wf-3'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage, workflowRepo);
  });

  it('should get all workflows in a pack with resolution', () => {
    const workflows = manager.getPackWorkflows('pack-1' as EntityId);

    expect(workflows).toHaveLength(3);
    expect(workflows.map((w) => w.id)).toEqual(['wf-1', 'wf-2', 'wf-3']);
  });

  it('should get workflow references without resolution', () => {
    const refs = manager.getPackWorkflowReferences('pack-1' as EntityId);

    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.workflowId)).toEqual(['wf-1', 'wf-2', 'wf-3']);
  });

  it('should throw on non-existent pack', () => {
    expect(() => {
      manager.getPackWorkflows('pack-999' as EntityId);
    }).toThrow('Pack not found');
  });

  it('should handle missing workflows in get operation', () => {
    const packWithMissing = createTestPack('pack-2' as EntityId, [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-missing', undefined, true),
      createWorkflowReference('wf-3'),
    ]);
    packsStorage.set('pack-2' as EntityId, packWithMissing);

    const workflows = manager.getPackWorkflows('pack-2' as EntityId);

    expect(workflows).toHaveLength(3);
    expect(workflows[1].id).toBe('wf-missing'); // Should get placeholder
  });
});

// ============================================================================
// Cache Management Tests
// ============================================================================

describe('PackWorkflowManager - Cache Management', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;
  let workflowRepo: Map<string, Workflow>;

  beforeEach(() => {
    packsStorage = new Map();
    workflowRepo = new Map();

    for (let i = 1; i <= 3; i++) {
      const wf = createTestWorkflow(`wf-${i}`, `Workflow ${i}`);
      workflowRepo.set(`wf-${i}`, wf);
    }

    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage, workflowRepo);
  });

  it('should get cache statistics', () => {
    manager.resolveWorkflowReference(createWorkflowReference('wf-1'));
    manager.resolveWorkflowReference(createWorkflowReference('wf-2'));

    const stats = manager.getCacheStats();

    expect(stats.cachedWorkflows).toBe(2);
    expect(stats.cacheKeys).toContain('wf-1');
    expect(stats.cacheKeys).toContain('wf-2');
  });

  it('should clear workflow cache', () => {
    manager.resolveWorkflowReference(createWorkflowReference('wf-1'));
    expect(manager.getCacheStats().cachedWorkflows).toBe(1);

    manager.clearWorkflowCache();
    expect(manager.getCacheStats().cachedWorkflows).toBe(0);
  });

  it('should rebuild cache after clearing', () => {
    manager.resolveWorkflowReference(createWorkflowReference('wf-1'));
    manager.clearWorkflowCache();
    manager.resolveWorkflowReference(createWorkflowReference('wf-1'));

    const stats = manager.getCacheStats();
    expect(stats.cachedWorkflows).toBe(1);
  });
});

// ============================================================================
// Audit Trail Tests
// ============================================================================

describe('PackWorkflowManager - Audit Trail', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;

  beforeEach(() => {
    packsStorage = new Map();
    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-2'),
      createWorkflowReference('wf-3'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);
    manager = createPackWorkflowManager(packsStorage);
  });

  it('should track workflow addition in audit log', () => {
    manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-4'), 'user-1');

    const log = manager.getWorkflowAuditLog('pack-1' as EntityId);
    expect(log).toHaveLength(1);
    expect(log[0].operation).toBe('add');
    expect(log[0].actor).toBe('user-1');
  });

  it('should track multiple operations in audit log', () => {
    manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-4'), 'user-1');
    manager.removeWorkflow('pack-1' as EntityId, 'wf-2', 'user-2');
    manager.reorderWorkflows('pack-1' as EntityId, ['wf-1', 'wf-3', 'wf-4'], 'user-3');

    const log = manager.getWorkflowAuditLog('pack-1' as EntityId);
    expect(log).toHaveLength(3);
    expect(log[0].operation).toBe('add');
    expect(log[1].operation).toBe('remove');
    expect(log[2].operation).toBe('reorder');
  });

  it('should include version changes in audit log', () => {
    manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-4'), 'user-1');

    const log = manager.getWorkflowAuditLog('pack-1' as EntityId);
    expect(log[0].previousVersion).toBe('1.0.0');
    expect(log[0].newVersion).toBe('1.0.1');
  });

  it('should get audit log for all packs when packId not specified', () => {
    manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-4'), 'user-1');

    const testPack2 = createTestPack('pack-2' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-2' as EntityId, testPack2);

    manager.addWorkflow('pack-2' as EntityId, createWorkflowReference('wf-5'), 'user-2');

    const fullLog = manager.getWorkflowAuditLog();
    expect(fullLog).toHaveLength(2);
    expect(fullLog.map((entry) => entry.packId)).toEqual([
      'pack-1' as EntityId,
      'pack-2' as EntityId,
    ]);
  });
});

// ============================================================================
// Edge Case and Integration Tests
// ============================================================================

describe('PackWorkflowManager - Edge Cases', () => {
  let manager: PackWorkflowManager;
  let packsStorage: Map<EntityId, Pack>;
  let workflowRepo: Map<string, Workflow>;

  beforeEach(() => {
    packsStorage = new Map();
    workflowRepo = new Map();
    manager = createPackWorkflowManager(packsStorage, workflowRepo);
  });

  it('should handle empty pack (only one workflow)', () => {
    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);

    const updated = manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-2'), 'user');
    expect(updated.manifest.workflows).toHaveLength(2);
  });

  it('should handle large pack with many workflows', () => {
    const workflows = Array.from({ length: 50 }, (_, i) =>
      createWorkflowReference(`wf-${i + 1}`),
    );
    const testPack = createTestPack('pack-1' as EntityId, workflows);
    packsStorage.set('pack-1' as EntityId, testPack);

    const updated = manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-51'), 'user');
    expect(updated.manifest.workflows).toHaveLength(51);

    const reordered = manager.reorderWorkflows(
      'pack-1' as EntityId,
      [
        'wf-51',
        ...Array.from({ length: 50 }, (_, i) => `wf-${i + 1}`),
      ],
      'user',
    );
    expect(reordered.manifest.workflows[0].workflowId).toBe('wf-51');
  });

  it('should handle workflow without version constraint', () => {
    const workflowRepo = new Map<string, Workflow>();
    const wf = createTestWorkflow('wf-1', 'Test');
    workflowRepo.set('wf-1', wf);

    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);

    const mgr = createPackWorkflowManager(packsStorage, workflowRepo);
    const result = mgr.resolveWorkflowReference(createWorkflowReference('wf-1'));

    expect(result.workflow.id).toBe('wf-1');
  });

  it('should handle multiple sequential add/remove/reorder operations', () => {
    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1'),
      createWorkflowReference('wf-2'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);

    let updated = manager.addWorkflow('pack-1' as EntityId, createWorkflowReference('wf-3'), 'user');
    expect(updated.version.version).toBe('1.0.1');

    updated = manager.removeWorkflow('pack-1' as EntityId, 'wf-1', 'user');
    expect(updated.version.version).toBe('1.0.2');

    updated = manager.reorderWorkflows('pack-1' as EntityId, ['wf-3', 'wf-2'], 'user');
    expect(updated.version.version).toBe('1.0.3');
    expect(updated.manifest.workflows.map((w) => w.workflowId)).toEqual(['wf-3', 'wf-2']);
  });

  it('should validate version ranges correctly', () => {
    const workflowRepo = new Map<string, Workflow>();

    // Create workflows with different versions
    const wf100 = createTestWorkflow('wf-1.0.0', 'v100');
    wf100.metadata.version = '1.0.0';
    workflowRepo.set('wf-1.0.0', wf100);

    const wf101 = createTestWorkflow('wf-1.0.1', 'v101');
    wf101.metadata.version = '1.0.1';
    workflowRepo.set('wf-1.0.1', wf101);

    const wf200 = createTestWorkflow('wf-2.0.0', 'v200');
    wf200.metadata.version = '2.0.0';
    workflowRepo.set('wf-2.0.0', wf200);

    const testPack = createTestPack('pack-1' as EntityId, [
      createWorkflowReference('wf-1.0.0'),
    ]);
    packsStorage.set('pack-1' as EntityId, testPack);

    const mgr = createPackWorkflowManager(packsStorage, workflowRepo);

    // Should accept matching version
    const result1 = mgr.resolveWorkflowReference(
      createWorkflowReference('wf-1.0.0', '1.0.0'),
    );
    expect(result1.warnings).toBeUndefined();

    // Should accept caret range
    const result2 = mgr.resolveWorkflowReference(
      createWorkflowReference('wf-1.0.1', '^1.0.0'),
    );
    expect(result2.warnings).toBeUndefined();

    // Should reject incompatible version
    expect(() => {
      mgr.resolveWorkflowReference(createWorkflowReference('wf-2.0.0', '^1.0.0'));
    }).toThrow();
  });
});

