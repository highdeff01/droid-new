/**
 * Tests for Pack System Type Definitions
 *
 * Comprehensive test suite validating:
 * - Deployment policy creation (sequential/parallel/conditional)
 * - Deployment conditions
 * - Workflow references with version constraints
 * - Pack manifest creation
 * - Pack version creation with semver validation
 * - Pack metadata and creation
 * - Pack dependencies (single, multiple, optional)
 * - Circular dependency detection
 * - Version constraint matching
 * - Platform compatibility validation
 * - JSON serialization/deserialization
 */

import { describe, it, expect } from 'vitest';
import {
  // Types
  DeploymentCondition,
  DeploymentPolicy,
  WorkflowReference,
  PackManifest,
  PackVersion,
  PackMetadata,
  PackDependency,
  Pack,

  // Condition and policy creators
  createDeploymentCondition,
  createSequentialPolicy,
  createParallelPolicy,
  createConditionalPolicy,

  // Reference and manifest creators
  createWorkflowReference,
  createPackManifest,

  // Version, metadata, and pack creators
  createPackVersion,
  createPackMetadata,
  createPackDependency,
  createPack,

  // Validators
  validateTimestamp,
  validateSemanticVersion,
  validateVersionRange,
  validateWorkflowReferences,
  validateDeploymentPolicy,
  validatePackManifest,
  validatePackVersion,
  validatePackMetadata,
  validatePackDependencies,
  validatePack,
  hasCircularDependency,
  isPackCompatible,
  versionSatisfies,

  // Serialization
  serializePack,
  deserializePack,
} from './pack-types';

describe('DeploymentCondition', () => {
  describe('createDeploymentCondition', () => {
    it('should create a deployment condition', () => {
      const condition = createDeploymentCondition(
        'windows-only',
        "platform === 'windows'",
        true,
      );

      expect(condition.name).toBe('windows-only');
      expect(condition.expression).toBe("platform === 'windows'");
      expect(condition.required).toBe(true);
    });

    it('should create an optional deployment condition', () => {
      const condition = createDeploymentCondition(
        'optional-check',
        'env === prod',
        false,
      );

      expect(condition.required).toBe(false);
    });
  });
});

describe('DeploymentPolicy', () => {
  describe('createSequentialPolicy', () => {
    it('should create a sequential deployment policy', () => {
      const policy = createSequentialPolicy(3, 1000, true, false, 60000);

      expect(policy.mode).toBe('sequential');
      expect(policy.maxRetries).toBe(3);
      expect(policy.retryDelayMs).toBe(1000);
      expect(policy.stopOnError).toBe(true);
      expect(policy.rollbackOnFailure).toBe(false);
      expect(policy.timeoutMs).toBe(60000);
    });

    it('should create a sequential policy with defaults', () => {
      const policy = createSequentialPolicy();

      expect(policy.mode).toBe('sequential');
      expect(policy.maxRetries).toBeUndefined();
      expect(policy.retryDelayMs).toBeUndefined();
    });
  });

  describe('createParallelPolicy', () => {
    it('should create a parallel deployment policy', () => {
      const policy = createParallelPolicy(5, true, 120000);

      expect(policy.mode).toBe('parallel');
      expect(policy.maxConcurrency).toBe(5);
      expect(policy.rollbackOnFailure).toBe(true);
      expect(policy.timeoutMs).toBe(120000);
    });

    it('should create a parallel policy with defaults', () => {
      const policy = createParallelPolicy();

      expect(policy.mode).toBe('parallel');
      expect(policy.maxConcurrency).toBeUndefined();
    });
  });

  describe('createConditionalPolicy', () => {
    it('should create a conditional deployment policy', () => {
      const conditions = [
        createDeploymentCondition('check1', 'env === prod', true),
        createDeploymentCondition('check2', 'version >= 1.5', false),
      ];

      const policy = createConditionalPolicy(conditions, true, 90000);

      expect(policy.mode).toBe('conditional');
      expect(policy.conditions).toHaveLength(2);
      expect(policy.rollbackOnFailure).toBe(true);
      expect(policy.timeoutMs).toBe(90000);
    });

    it('should create a conditional policy without conditions', () => {
      const policy = createConditionalPolicy();

      expect(policy.mode).toBe('conditional');
      expect(policy.conditions).toBeUndefined();
    });
  });

  describe('validateDeploymentPolicy', () => {
    it('should validate a sequential policy', () => {
      const policy = createSequentialPolicy(3, 1000, true);
      expect(() => validateDeploymentPolicy(policy)).not.toThrow();
    });

    it('should validate a parallel policy', () => {
      const policy = createParallelPolicy(5);
      expect(() => validateDeploymentPolicy(policy)).not.toThrow();
    });

    it('should throw on invalid mode', () => {
      const policy = { mode: 'invalid' } as unknown as DeploymentPolicy;
      expect(() => validateDeploymentPolicy(policy)).toThrow('mode must be');
    });

    it('should throw on negative maxRetries', () => {
      const policy = { mode: 'sequential' as const, maxRetries: -1 } as unknown as DeploymentPolicy;
      expect(() => validateDeploymentPolicy(policy)).toThrow('maxRetries');
    });

    it('should throw on negative maxConcurrency', () => {
      const policy = { mode: 'parallel' as const, maxConcurrency: 0 } as unknown as DeploymentPolicy;
      expect(() => validateDeploymentPolicy(policy)).toThrow('maxConcurrency must be at least 1');
    });

    it('should throw on negative timeoutMs', () => {
      const policy = { mode: 'sequential' as const, timeoutMs: -1 } as unknown as DeploymentPolicy;
      expect(() => validateDeploymentPolicy(policy)).toThrow('timeoutMs');
    });

    it('should throw on invalid condition without name', () => {
      const policy: DeploymentPolicy = {
        mode: 'conditional',
        conditions: [
          { name: '', expression: 'test', required: true },
        ],
      };
      expect(() => validateDeploymentPolicy(policy)).toThrow('name must be');
    });

    it('should throw on invalid condition without expression', () => {
      const policy: DeploymentPolicy = {
        mode: 'conditional',
        conditions: [
          { name: 'cond1', expression: '', required: true },
        ],
      };
      expect(() => validateDeploymentPolicy(policy)).toThrow('expression must be');
    });
  });
});

describe('WorkflowReference', () => {
  describe('createWorkflowReference', () => {
    it('should create a workflow reference with just ID', () => {
      const ref = createWorkflowReference('workflow-123');

      expect(ref.workflowId).toBe('workflow-123');
      expect(ref.version).toBeUndefined();
      expect(ref.optional).toBeUndefined();
    });

    it('should create a workflow reference with version constraint', () => {
      const ref = createWorkflowReference('workflow-456', '^1.0.0');

      expect(ref.workflowId).toBe('workflow-456');
      expect(ref.version).toBe('^1.0.0');
    });

    it('should create an optional workflow reference', () => {
      const ref = createWorkflowReference('workflow-789', '1.2.x', true);

      expect(ref.optional).toBe(true);
    });
  });

  describe('validateWorkflowReferences', () => {
    it('should validate valid workflow references', () => {
      const refs = [
        createWorkflowReference('wf1', '^1.0.0'),
        createWorkflowReference('wf2'),
        createWorkflowReference('wf3', '1.2.x', true),
      ];

      expect(() => validateWorkflowReferences(refs)).not.toThrow();
    });

    it('should throw on empty workflow ID', () => {
      const refs = [{ workflowId: '', version: '1.0.0' }];
      expect(() => validateWorkflowReferences(refs)).toThrow('workflowId must be');
    });

    it('should throw on invalid version range', () => {
      const refs = [{ workflowId: 'wf1', version: 'invalid-version' }];
      expect(() => validateWorkflowReferences(refs)).toThrow('version range');
    });
  });
});

describe('PackManifest', () => {
  describe('createPackManifest', () => {
    it('should create a pack manifest with workflows and policy', () => {
      const workflows = [
        createWorkflowReference('wf-1'),
        createWorkflowReference('wf-2', '^2.0.0'),
      ];
      const policy = createSequentialPolicy(3, 500);

      const manifest = createPackManifest(workflows, policy);

      expect(manifest.workflows).toHaveLength(2);
      expect(manifest.policy.mode).toBe('sequential');
      expect(manifest.environment).toBeUndefined();
    });

    it('should create a manifest with environment variables', () => {
      const workflows = [createWorkflowReference('wf-1')];
      const policy = createParallelPolicy();
      const environment = { DEBUG: true, LOG_LEVEL: 'info' };

      const manifest = createPackManifest(workflows, policy, environment);

      expect(manifest.environment).toEqual(environment);
    });
  });

  describe('validatePackManifest', () => {
    it('should validate a valid manifest', () => {
      const manifest = createPackManifest(
        [createWorkflowReference('wf-1')],
        createSequentialPolicy(),
      );

      expect(() => validatePackManifest(manifest)).not.toThrow();
    });

    it('should throw on empty workflows array', () => {
      const manifest: PackManifest = {
        workflows: [],
        policy: createSequentialPolicy(),
      };

      expect(() => validatePackManifest(manifest)).toThrow('cannot be empty');
    });

    it('should throw on missing workflows', () => {
      const manifest = { policy: createSequentialPolicy() } as PackManifest;
      expect(() => validatePackManifest(manifest)).toThrow('workflows must be');
    });

    it('should throw on invalid workflow references', () => {
      const manifest: PackManifest = {
        workflows: [{ workflowId: '' }],
        policy: createSequentialPolicy(),
      };

      expect(() => validatePackManifest(manifest)).toThrow('workflowId must be');
    });
  });
});

describe('PackVersion', () => {
  describe('createPackVersion', () => {
    it('should create a pack version', () => {
      const version = createPackVersion(
        '1.0.0',
        '2024-01-15T10:30:00Z',
        'Initial release',
        ['1.0.0', '1.1.0'],
        false,
        false,
      );

      expect(version.version).toBe('1.0.0');
      expect(version.releasedAt).toBe('2024-01-15T10:30:00Z');
      expect(version.changelog).toBe('Initial release');
      expect(version.compatibleWith).toEqual(['1.0.0', '1.1.0']);
      expect(version.deprecated).toBe(false);
      expect(version.prerelease).toBe(false);
    });

    it('should create a prerelease version', () => {
      const version = createPackVersion(
        '2.0.0-beta.1',
        '2024-01-10T00:00:00Z',
        undefined,
        undefined,
        false,
        true,
      );

      expect(version.version).toBe('2.0.0-beta.1');
      expect(version.prerelease).toBe(true);
    });

    it('should create a deprecated version', () => {
      const version = createPackVersion(
        '0.1.0',
        '2023-01-01T00:00:00Z',
        'Deprecated',
        undefined,
        true,
      );

      expect(version.deprecated).toBe(true);
    });
  });

  describe('validatePackVersion', () => {
    it('should validate a valid version', () => {
      const version = createPackVersion('1.2.3', '2024-01-15T10:30:00Z');
      expect(() => validatePackVersion(version)).not.toThrow();
    });

    it('should throw on invalid semver', () => {
      const version = { version: '1.2', releasedAt: '2024-01-15T10:30:00Z' };
      expect(() => validatePackVersion(version as PackVersion)).toThrow('semantic version');
    });

    it('should throw on invalid timestamp', () => {
      const version = { version: '1.0.0', releasedAt: 'invalid-date' };
      expect(() => validatePackVersion(version as PackVersion)).toThrow('timestamp');
    });

    it('should throw on invalid compatible version ranges', () => {
      const version = {
        version: '1.0.0',
        releasedAt: '2024-01-15T10:30:00Z',
        compatibleWith: ['invalid-range'],
      };

      expect(() => validatePackVersion(version as PackVersion)).toThrow();
    });
  });
});

describe('PackMetadata', () => {
  describe('createPackMetadata', () => {
    it('should create pack metadata with required fields', () => {
      const metadata = createPackMetadata(
        'John Doe',
        'A useful automation pack',
        'MIT',
        ['automation', 'workflow'],
      );

      expect(metadata.author).toBe('John Doe');
      expect(metadata.description).toBe('A useful automation pack');
      expect(metadata.license).toBe('MIT');
      expect(metadata.tags).toEqual(['automation', 'workflow']);
      expect(metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(metadata.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('validatePackMetadata', () => {
    it('should validate valid metadata', () => {
      const metadata = createPackMetadata('Author', 'Description');
      expect(() => validatePackMetadata(metadata)).not.toThrow();
    });

    it('should throw on empty author', () => {
      const metadata = { author: '', description: 'desc' };
      expect(() => validatePackMetadata(metadata as PackMetadata)).toThrow('author must be');
    });

    it('should throw on empty description', () => {
      const metadata = { author: 'Author', description: '' };
      expect(() => validatePackMetadata(metadata as PackMetadata)).toThrow('description must be');
    });

    it('should throw on rating out of range', () => {
      const metadata = createPackMetadata('Author', 'Desc');
      metadata.rating = 6;
      expect(() => validatePackMetadata(metadata)).toThrow('rating must be between');
    });

    it('should throw on negative download count', () => {
      const metadata = createPackMetadata('Author', 'Desc');
      metadata.downloadCount = -5;
      expect(() => validatePackMetadata(metadata)).toThrow('downloadCount must be non-negative');
    });

    it('should throw on invalid created timestamp', () => {
      const metadata = { author: 'A', description: 'D', createdAt: 'invalid', updatedAt: '2024-01-15T10:30:00Z' };
      expect(() => validatePackMetadata(metadata as PackMetadata)).toThrow('timestamp');
    });
  });
});

describe('PackDependency', () => {
  describe('createPackDependency', () => {
    it('should create a required dependency', () => {
      const dep = createPackDependency('pack-base', '^1.0.0', false);

      expect(dep.packId).toBe('pack-base');
      expect(dep.versionRange).toBe('^1.0.0');
      expect(dep.optional).toBe(false);
    });

    it('should create an optional dependency', () => {
      const dep = createPackDependency('pack-optional', '~2.1.0', true);

      expect(dep.optional).toBe(true);
    });

    it('should create a dependency without version constraint', () => {
      const dep = createPackDependency('pack-any');

      expect(dep.versionRange).toBeUndefined();
    });
  });

  describe('validatePackDependencies', () => {
    it('should validate valid dependencies', () => {
      const pack = createPack(
        'p1',
        'Pack 1',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
        [
          createPackDependency('p2', '^1.0.0'),
          createPackDependency('p3', undefined, true),
        ],
      );

      expect(() => validatePackDependencies(pack)).not.toThrow();
    });

    it('should throw on duplicate dependencies', () => {
      const pack = createPack(
        'p1',
        'Pack 1',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
        [
          createPackDependency('p2', '^1.0.0'),
          createPackDependency('p2', '1.0.0'),
        ],
      );

      expect(() => validatePackDependencies(pack)).toThrow('duplicate');
    });

    it('should throw on self-dependency', () => {
      const pack = createPack(
        'p1',
        'Pack 1',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
        [createPackDependency('p1')],
      );

      expect(() => validatePackDependencies(pack)).toThrow('cannot depend on itself');
    });

    it('should throw on invalid pack ID', () => {
      const pack = createPack(
        'p1',
        'Pack 1',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
        [{ packId: '', versionRange: '1.0.0' }],
      );

      expect(() => validatePackDependencies(pack)).toThrow('packId must be');
    });
  });
});

describe('Pack', () => {
  describe('createPack', () => {
    it('should create a complete pack', () => {
      const workflows = [
        createWorkflowReference('wf-1'),
        createWorkflowReference('wf-2', '^2.0.0'),
      ];
      const policy = createSequentialPolicy(2, 1000, true);
      const manifest = createPackManifest(workflows, policy);
      const version = createPackVersion('1.0.0', '2024-01-15T10:30:00Z');
      const metadata = createPackMetadata('Author', 'Desc', 'MIT');
      const deps = [createPackDependency('dep-pack', '^1.0.0')];

      const pack = createPack(
        'pack-123',
        'My Pack',
        manifest,
        version,
        metadata,
        deps,
      );

      expect(pack.id).toBe('pack-123');
      expect(pack.name).toBe('My Pack');
      expect(pack.manifest.workflows).toHaveLength(2);
      expect(pack.version.version).toBe('1.0.0');
      expect(pack.dependencies).toHaveLength(1);
    });

    it('should create a pack without dependencies', () => {
      const manifest = createPackManifest(
        [createWorkflowReference('wf-1')],
        createSequentialPolicy(),
      );
      const version = createPackVersion('1.0.0', '2024-01-15T10:30:00Z');
      const metadata = createPackMetadata('Author', 'Desc');

      const pack = createPack('p1', 'Pack', manifest, version, metadata);

      expect(pack.dependencies).toBeUndefined();
    });
  });

  describe('validatePack', () => {
    it('should validate a complete valid pack', () => {
      const pack = createPack(
        'pack-123',
        'My Pack',
        createPackManifest(
          [createWorkflowReference('wf-1')],
          createSequentialPolicy(),
        ),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Description'),
      );

      expect(() => validatePack(pack)).not.toThrow();
    });

    it('should throw on empty pack ID', () => {
      const pack = createPack(
        '',
        'My Pack',
        createPackManifest(
          [createWorkflowReference('wf-1')],
          createSequentialPolicy(),
        ),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
      );

      expect(() => validatePack(pack)).toThrow('id must be');
    });

    it('should throw on empty pack name', () => {
      const pack = createPack(
        'p1',
        '',
        createPackManifest(
          [createWorkflowReference('wf-1')],
          createSequentialPolicy(),
        ),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
      );

      expect(() => validatePack(pack)).toThrow('name must be');
    });

    it('should throw on invalid manifest', () => {
      const pack = createPack(
        'p1',
        'Pack',
        { workflows: [], policy: createSequentialPolicy() },
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
      );

      expect(() => validatePack(pack)).toThrow('workflows');
    });
  });
});

describe('Circular Dependencies', () => {
  describe('hasCircularDependency', () => {
    it('should detect no circular dependency in simple pack', () => {
      const pack = createPack(
        'p1',
        'Pack 1',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
        [createPackDependency('p2'), createPackDependency('p3')],
      );

      const allPacks = new Map<string, Pack>([
        ['p1', pack],
        ['p2', createPack('p2', 'P2', createPackManifest([createWorkflowReference('wf2')], createSequentialPolicy()), createPackVersion('1.0.0', '2024-01-15T10:30:00Z'), createPackMetadata('A', 'D'))],
        ['p3', createPack('p3', 'P3', createPackManifest([createWorkflowReference('wf3')], createSequentialPolicy()), createPackVersion('1.0.0', '2024-01-15T10:30:00Z'), createPackMetadata('A', 'D'))],
      ]);

      expect(hasCircularDependency(pack, allPacks)).toBe(false);
    });

    it('should detect direct circular dependency (A -> B -> A)', () => {
      const packA = createPack(
        'pA',
        'Pack A',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
        [createPackDependency('pB')],
      );

      const packB = createPack(
        'pB',
        'Pack B',
        createPackManifest([createWorkflowReference('wf2')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('Author', 'Desc'),
        [createPackDependency('pA')],
      );

      const allPacks = new Map<string, Pack>([
        ['pA', packA],
        ['pB', packB],
      ]);

      expect(hasCircularDependency(packA, allPacks)).toBe(true);
    });

    it('should detect transitive circular dependency (A -> B -> C -> A)', () => {
      const packA = createPack(
        'pA',
        'Pack A',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
        [createPackDependency('pB')],
      );

      const packB = createPack(
        'pB',
        'Pack B',
        createPackManifest([createWorkflowReference('wf2')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
        [createPackDependency('pC')],
      );

      const packC = createPack(
        'pC',
        'Pack C',
        createPackManifest([createWorkflowReference('wf3')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
        [createPackDependency('pA')],
      );

      const allPacks = new Map<string, Pack>([
        ['pA', packA],
        ['pB', packB],
        ['pC', packC],
      ]);

      expect(hasCircularDependency(packA, allPacks)).toBe(true);
    });

    it('should handle pack with optional dependencies', () => {
      const packA = createPack(
        'pA',
        'Pack A',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
        [createPackDependency('pB', undefined, true)],
      );

      const packB = createPack(
        'pB',
        'Pack B',
        createPackManifest([createWorkflowReference('wf2')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
      );

      const allPacks = new Map<string, Pack>([
        ['pA', packA],
        ['pB', packB],
      ]);

      expect(hasCircularDependency(packA, allPacks)).toBe(false);
    });
  });
});

describe('Version Constraint Matching', () => {
  describe('versionSatisfies', () => {
    it('should match exact versions', () => {
      expect(versionSatisfies('1.0.0', '1.0.0')).toBe(true);
      expect(versionSatisfies('1.2.3', '1.0.0')).toBe(false);
    });

    it('should match caret ranges (^)', () => {
      expect(versionSatisfies('1.2.3', '^1.0.0')).toBe(true);
      expect(versionSatisfies('1.5.0', '^1.0.0')).toBe(true);
      expect(versionSatisfies('2.0.0', '^1.0.0')).toBe(false);
      expect(versionSatisfies('0.9.0', '^1.0.0')).toBe(false);
    });

    it('should match caret ranges for 0.x versions', () => {
      expect(versionSatisfies('0.1.5', '^0.1.0')).toBe(true);
      expect(versionSatisfies('0.1.0', '^0.1.0')).toBe(true);
      expect(versionSatisfies('0.2.0', '^0.1.0')).toBe(false);
    });

    it('should match tilde ranges (~)', () => {
      expect(versionSatisfies('1.2.3', '~1.2.0')).toBe(true);
      expect(versionSatisfies('1.2.5', '~1.2.0')).toBe(true);
      expect(versionSatisfies('1.3.0', '~1.2.0')).toBe(false);
      expect(versionSatisfies('2.0.0', '~1.2.0')).toBe(false);
    });

    it('should match wildcard ranges (x)', () => {
      expect(versionSatisfies('1.2.0', '1.2.x')).toBe(true);
      expect(versionSatisfies('1.2.99', '1.2.x')).toBe(true);
      expect(versionSatisfies('1.3.0', '1.2.x')).toBe(false);
      expect(versionSatisfies('2.2.0', '1.2.x')).toBe(false);
    });

    it('should match >= operator', () => {
      expect(versionSatisfies('1.0.0', '>=1.0.0')).toBe(true);
      expect(versionSatisfies('1.5.0', '>=1.0.0')).toBe(true);
      expect(versionSatisfies('2.0.0', '>=1.0.0')).toBe(true);
      expect(versionSatisfies('0.9.9', '>=1.0.0')).toBe(false);
    });

    it('should match > operator', () => {
      expect(versionSatisfies('1.0.1', '>1.0.0')).toBe(true);
      expect(versionSatisfies('2.0.0', '>1.0.0')).toBe(true);
      expect(versionSatisfies('1.0.0', '>1.0.0')).toBe(false);
      expect(versionSatisfies('0.9.9', '>1.0.0')).toBe(false);
    });

    it('should match <= operator', () => {
      expect(versionSatisfies('1.0.0', '<=1.0.0')).toBe(true);
      expect(versionSatisfies('0.9.0', '<=1.0.0')).toBe(true);
      expect(versionSatisfies('1.0.1', '<=1.0.0')).toBe(false);
    });

    it('should match < operator', () => {
      expect(versionSatisfies('0.9.9', '<1.0.0')).toBe(true);
      expect(versionSatisfies('1.0.0', '<1.0.0')).toBe(false);
      expect(versionSatisfies('1.0.1', '<1.0.0')).toBe(false);
    });
  });
});

describe('Platform Compatibility', () => {
  describe('isPackCompatible', () => {
    it('should accept pack without platform restrictions', () => {
      const pack = createPack(
        'p1',
        'Pack',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
      );

      expect(isPackCompatible(pack, '1.0.0', 'windows')).toBe(true);
      expect(isPackCompatible(pack, '1.0.0', 'macos')).toBe(true);
      expect(isPackCompatible(pack, '1.0.0', 'linux')).toBe(true);
    });

    it('should enforce minimum platform version', () => {
      const pack = createPack(
        'p1',
        'Pack',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
      );
      pack.metadata.minimumPlatformVersion = '2.0.0';

      expect(isPackCompatible(pack, '2.0.0', 'windows')).toBe(true);
      expect(isPackCompatible(pack, '2.5.0', 'windows')).toBe(true);
      expect(isPackCompatible(pack, '1.9.9', 'windows')).toBe(false);
    });

    it('should enforce supported platforms', () => {
      const pack = createPack(
        'p1',
        'Pack',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
      );
      pack.metadata.supportedPlatforms = ['windows', 'macos'];

      expect(isPackCompatible(pack, '1.0.0', 'windows')).toBe(true);
      expect(isPackCompatible(pack, '1.0.0', 'macos')).toBe(true);
      expect(isPackCompatible(pack, '1.0.0', 'linux')).toBe(false);
    });

    it('should check both minimum version and supported platforms', () => {
      const pack = createPack(
        'p1',
        'Pack',
        createPackManifest([createWorkflowReference('wf1')], createSequentialPolicy()),
        createPackVersion('1.0.0', '2024-01-15T10:30:00Z'),
        createPackMetadata('A', 'D'),
      );
      pack.metadata.minimumPlatformVersion = '1.5.0';
      pack.metadata.supportedPlatforms = ['windows'];

      expect(isPackCompatible(pack, '2.0.0', 'windows')).toBe(true);
      expect(isPackCompatible(pack, '1.0.0', 'windows')).toBe(false);
      expect(isPackCompatible(pack, '2.0.0', 'linux')).toBe(false);
    });
  });
});

describe('Serialization', () => {
  describe('serializePack and deserializePack', () => {
    it('should serialize and deserialize a complete pack', () => {
      const original = createPack(
        'pack-123',
        'My Pack',
        createPackManifest(
          [
            createWorkflowReference('wf-1', '^1.0.0'),
            createWorkflowReference('wf-2', '~2.1.0', true),
          ],
          createSequentialPolicy(3, 500, true),
        ),
        createPackVersion('1.5.0', '2024-01-15T10:30:00Z', 'Bug fixes'),
        createPackMetadata('John Doe', 'A useful pack', 'MIT', ['test', 'automation']),
        [
          createPackDependency('dep-pack-1', '^1.0.0'),
          createPackDependency('dep-pack-2', undefined, true),
        ],
      );

      const json = serializePack(original);
      expect(json).toContain('pack-123');
      expect(json).toContain('John Doe');

      const deserialized = deserializePack(json);
      expect(deserialized.id).toBe(original.id);
      expect(deserialized.name).toBe(original.name);
      expect(deserialized.manifest.workflows).toHaveLength(2);
      expect(deserialized.version.version).toBe('1.5.0');
      expect(deserialized.metadata.author).toBe('John Doe');
      expect(deserialized.dependencies).toHaveLength(2);
    });

    it('should throw on invalid JSON during deserialization', () => {
      const invalidJson = 'not valid json';
      expect(() => deserializePack(invalidJson)).toThrow();
    });

    it('should throw on malformed pack during deserialization', () => {
      const malformedJson = JSON.stringify({ id: 'p1', name: 'Pack' });
      expect(() => deserializePack(malformedJson)).toThrow();
    });
  });
});

describe('Validation Integration', () => {
  describe('validateSemanticVersion', () => {
    it('should accept valid semver', () => {
      expect(() => validateSemanticVersion('1.0.0')).not.toThrow();
      expect(() => validateSemanticVersion('2.15.3')).not.toThrow();
      expect(() => validateSemanticVersion('0.0.1')).not.toThrow();
    });

    it('should accept prerelease versions', () => {
      expect(() => validateSemanticVersion('1.0.0-alpha')).not.toThrow();
      expect(() => validateSemanticVersion('1.0.0-beta.1')).not.toThrow();
      expect(() => validateSemanticVersion('1.0.0-rc.2')).not.toThrow();
    });

    it('should reject invalid versions', () => {
      expect(() => validateSemanticVersion('1.0')).toThrow();
      expect(() => validateSemanticVersion('1')).toThrow();
      expect(() => validateSemanticVersion('v1.0.0')).toThrow();
      expect(() => validateSemanticVersion('1.0.0.0')).toThrow();
    });
  });

  describe('validateVersionRange', () => {
    it('should accept valid version ranges', () => {
      expect(() => validateVersionRange('^1.0.0')).not.toThrow();
      expect(() => validateVersionRange('~1.2.0')).not.toThrow();
      expect(() => validateVersionRange('1.2.x')).not.toThrow();
      expect(() => validateVersionRange('>=1.0.0')).not.toThrow();
      expect(() => validateVersionRange('>1.0.0')).not.toThrow();
      expect(() => validateVersionRange('<=1.0.0')).not.toThrow();
      expect(() => validateVersionRange('<1.0.0')).not.toThrow();
      expect(() => validateVersionRange('1.0.0')).not.toThrow();
    });

    it('should reject invalid ranges', () => {
      expect(() => validateVersionRange('invalid')).toThrow();
      expect(() => validateVersionRange('1.x.x')).toThrow();
      expect(() => validateVersionRange('')).toThrow();
    });
  });

  describe('validateTimestamp', () => {
    it('should accept valid ISO 8601 timestamps', () => {
      expect(() => validateTimestamp('2024-01-15T10:30:00Z')).not.toThrow();
      expect(() => validateTimestamp('2024-01-15T10:30:00.123Z')).not.toThrow();
      expect(() => validateTimestamp('2024-01-15T10:30:00')).not.toThrow();
    });

    it('should reject invalid timestamps', () => {
      expect(() => validateTimestamp('2024-01-15')).toThrow();
      expect(() => validateTimestamp('invalid')).toThrow();
      expect(() => validateTimestamp('01/15/2024')).toThrow();
    });
  });
});
