/**
 * Tests for Workflow System Type Definitions
 *
 * Comprehensive test suite validating:
 * - Condition creation and inversion
 * - Execution policies
 * - Workflow steps (recording and nested)
 * - Workflow metadata and creation
 * - Validation (step references, circular dependencies, timestamps, versions)
 * - JSON serialization/deserialization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Types
  StepCondition,
  ExecutionPolicy,
  WorkflowStep,
  WorkflowMetadata,
  Workflow,

  // Condition creators
  createIfCondition,
  createEnvironmentCondition,
  createDataValidationCondition,

  // Policy creators
  createExecutionPolicy,

  // Step creators
  createRecordingStep,
  createWorkflowStep,

  // Metadata and workflow creators
  createWorkflowMetadata,
  createWorkflow,

  // Validators
  validateStepReference,
  validateTimestamp,
  validateSemanticVersion,
  validateWorkflowSteps,
  hasCircularDependency,
  validateOutputMapping,
  validateWorkflow,

  // Serialization
  serializeWorkflow,
  deserializeWorkflow,
} from './workflow-types';

describe('StepCondition', () => {
  describe('createIfCondition', () => {
    it('should create an if condition for equality check', () => {
      const condition = createIfCondition('status', '===', 'ready');

      expect(condition.type).toBe('if');
      expect(condition.variable).toBe('status');
      expect(condition.operator).toBe('===');
      expect(condition.value).toBe('ready');
      expect(condition.invert).toBeUndefined();
    });

    it('should create an if condition with inequality operator', () => {
      const condition = createIfCondition('retryCount', '!==', 0);

      expect(condition.type).toBe('if');
      expect(condition.operator).toBe('!==');
      expect(condition.value).toBe(0);
    });

    it('should create an if condition with comparison operators', () => {
      const gtCondition = createIfCondition('timeout', '>', 5000);
      expect(gtCondition.operator).toBe('>');

      const ltCondition = createIfCondition('attempts', '<', 3);
      expect(ltCondition.operator).toBe('<');

      const gteCondition = createIfCondition('score', '>=', 100);
      expect(gteCondition.operator).toBe('>=');

      const lteCondition = createIfCondition('errors', '<=', 5);
      expect(lteCondition.operator).toBe('<=');
    });

    it('should create an if condition with in/not-in operators', () => {
      const inCondition = createIfCondition('environment', 'in', ['prod', 'staging']);
      expect(inCondition.operator).toBe('in');
      expect(inCondition.value).toEqual(['prod', 'staging']);

      const notInCondition = createIfCondition('browserType', 'not-in', ['IE', 'Edge']);
      expect(notInCondition.operator).toBe('not-in');
    });

    it('should create an inverted if condition', () => {
      const condition = createIfCondition('isEnabled', '===', false, true);

      expect(condition.type).toBe('if');
      expect(condition.invert).toBe(true);
    });

    it('should support various value types', () => {
      const stringCondition = createIfCondition('name', '===', 'test');
      expect(stringCondition.value).toBe('test');

      const numberCondition = createIfCondition('count', '>', 42);
      expect(numberCondition.value).toBe(42);

      const booleanCondition = createIfCondition('enabled', '===', true);
      expect(booleanCondition.value).toBe(true);

      const objectCondition = createIfCondition('data', '===', { key: 'value' });
      expect(objectCondition.value).toEqual({ key: 'value' });
    });
  });

  describe('createEnvironmentCondition', () => {
    it('should create an environment condition for OS check', () => {
      const condition = createEnvironmentCondition('windows');

      expect(condition.type).toBe('environment');
      expect(condition.os).toBe('windows');
      expect(condition.browser).toBeUndefined();
    });

    it('should create an environment condition for browser check', () => {
      const condition = createEnvironmentCondition(undefined, 'Chrome');

      expect(condition.type).toBe('environment');
      expect(condition.os).toBeUndefined();
      expect(condition.browser).toBe('Chrome');
    });

    it('should create an environment condition for both OS and browser', () => {
      const condition = createEnvironmentCondition('macos', 'Safari');

      expect(condition.os).toBe('macos');
      expect(condition.browser).toBe('Safari');
    });

    it('should support all OS types', () => {
      expect(createEnvironmentCondition('windows').os).toBe('windows');
      expect(createEnvironmentCondition('macos').os).toBe('macos');
      expect(createEnvironmentCondition('linux').os).toBe('linux');
    });

    it('should create an inverted environment condition', () => {
      const condition = createEnvironmentCondition('windows', 'Chrome', true);

      expect(condition.invert).toBe(true);
    });
  });

  describe('createDataValidationCondition', () => {
    it('should create a data validation condition with schema', () => {
      const schema = { type: 'object', properties: { id: { type: 'string' } } };
      const condition = createDataValidationCondition(schema);

      expect(condition.type).toBe('data-validation');
      expect(condition.schema).toEqual(schema);
    });

    it('should create an inverted data validation condition', () => {
      const schema = { type: 'object' };
      const condition = createDataValidationCondition(schema, true);

      expect(condition.invert).toBe(true);
    });

    it('should support complex schema structures', () => {
      const complexSchema = {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9]+$' },
          name: { type: 'string', minLength: 1 },
          tags: { type: 'array', items: { type: 'string' } },
        },
      };
      const condition = createDataValidationCondition(complexSchema);

      expect(condition.schema).toEqual(complexSchema);
    });
  });
});

describe('ExecutionPolicy', () => {
  describe('createExecutionPolicy', () => {
    it('should create a sequential execution policy', () => {
      const policy = createExecutionPolicy('sequential', 'stop');

      expect(policy.type).toBe('sequential');
      expect(policy.onError).toBe('stop');
    });

    it('should create a parallel execution policy', () => {
      const policy = createExecutionPolicy('parallel', 'continue', true, 3, 1000, 5);

      expect(policy.type).toBe('parallel');
      expect(policy.maxConcurrency).toBe(5);
      expect(policy.retryOnFailure).toBe(true);
      expect(policy.maxRetries).toBe(3);
      expect(policy.delayBetweenRetries).toBe(1000);
    });

    it('should create a conditional execution policy', () => {
      const policy = createExecutionPolicy('conditional', 'skip-step');

      expect(policy.type).toBe('conditional');
      expect(policy.onError).toBe('skip-step');
    });

    it('should support all error handling strategies', () => {
      const stopPolicy = createExecutionPolicy('sequential', 'stop');
      expect(stopPolicy.onError).toBe('stop');

      const continuePolicy = createExecutionPolicy('sequential', 'continue');
      expect(continuePolicy.onError).toBe('continue');

      const skipPolicy = createExecutionPolicy('sequential', 'skip-step');
      expect(skipPolicy.onError).toBe('skip-step');
    });

    it('should include retry configuration', () => {
      const policy = createExecutionPolicy(
        'sequential',
        'continue',
        true,
        5,
        2000,
        undefined,
        30000,
      );

      expect(policy.retryOnFailure).toBe(true);
      expect(policy.maxRetries).toBe(5);
      expect(policy.delayBetweenRetries).toBe(2000);
      expect(policy.timeout).toBe(30000);
    });

    it('should include timeout setting', () => {
      const policy = createExecutionPolicy('sequential', 'stop', undefined, undefined, undefined, undefined, 60000);

      expect(policy.timeout).toBe(60000);
    });
  });
});

describe('WorkflowStep', () => {
  let policy: ExecutionPolicy;

  beforeEach(() => {
    policy = createExecutionPolicy('sequential', 'stop');
  });

  describe('createRecordingStep', () => {
    it('should create a recording step with required fields', () => {
      const step = createRecordingStep('step-1', 'Play Login Recording', 'rec-123', policy);

      expect(step.id).toBe('step-1');
      expect(step.name).toBe('Play Login Recording');
      expect(step.type).toBe('recording');
      expect(step.recordingId).toBe('rec-123');
      expect(step.policy).toEqual(policy);
      expect(step.conditions).toBeUndefined();
      expect(step.outputMapping).toBeUndefined();
    });

    it('should create a recording step with description', () => {
      const step = createRecordingStep(
        'step-1',
        'Play Login',
        'rec-123',
        policy,
        'Logs into the application',
      );

      expect(step.description).toBe('Logs into the application');
    });

    it('should create a recording step with conditions', () => {
      const condition = createIfCondition('isProduction', '===', true);
      const step = createRecordingStep(
        'step-1',
        'Play Login',
        'rec-123',
        policy,
        undefined,
        [condition],
      );

      expect(step.conditions).toHaveLength(1);
      expect(step.conditions?.[0]).toEqual(condition);
    });

    it('should create a recording step with output mapping', () => {
      const outputMapping = { userId: 'response.user.id', token: 'response.auth.token' };
      const step = createRecordingStep(
        'step-1',
        'Play Login',
        'rec-123',
        policy,
        undefined,
        undefined,
        outputMapping,
      );

      expect(step.outputMapping).toEqual(outputMapping);
    });

    it('should set timestamps to ISO 8601 format', () => {
      const step = createRecordingStep('step-1', 'Play Login', 'rec-123', policy);

      expect(step.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(step.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should have equal created and updated timestamps initially', () => {
      const step = createRecordingStep('step-1', 'Play Login', 'rec-123', policy);

      expect(step.createdAt).toBe(step.updatedAt);
    });

    it('should not have workflowId set', () => {
      const step = createRecordingStep('step-1', 'Play Login', 'rec-123', policy);

      expect(step.workflowId).toBeUndefined();
    });
  });

  describe('createWorkflowStep', () => {
    it('should create a workflow step with required fields', () => {
      const step = createWorkflowStep('step-1', 'Run Nested Workflow', 'wf-456', policy);

      expect(step.id).toBe('step-1');
      expect(step.name).toBe('Run Nested Workflow');
      expect(step.type).toBe('workflow');
      expect(step.workflowId).toBe('wf-456');
      expect(step.policy).toEqual(policy);
    });

    it('should create a workflow step with description', () => {
      const step = createWorkflowStep(
        'step-1',
        'Run Checkout',
        'wf-456',
        policy,
        'Completes the checkout process',
      );

      expect(step.description).toBe('Completes the checkout process');
    });

    it('should create a workflow step with conditions and output mapping', () => {
      const condition = createEnvironmentCondition('windows');
      const outputMapping = { checkoutId: 'response.id' };
      const step = createWorkflowStep(
        'step-1',
        'Run Checkout',
        'wf-456',
        policy,
        undefined,
        [condition],
        outputMapping,
      );

      expect(step.conditions).toHaveLength(1);
      expect(step.outputMapping).toEqual(outputMapping);
    });

    it('should not have recordingId set', () => {
      const step = createWorkflowStep('step-1', 'Run Workflow', 'wf-456', policy);

      expect(step.recordingId).toBeUndefined();
    });
  });

  describe('Multiple conditions', () => {
    it('should support multiple conditions on a step', () => {
      const condition1 = createIfCondition('status', '===', 'ready');
      const condition2 = createEnvironmentCondition('windows');
      const condition3 = createDataValidationCondition({ type: 'object' });

      const step = createRecordingStep(
        'step-1',
        'Play Recording',
        'rec-123',
        policy,
        undefined,
        [condition1, condition2, condition3],
      );

      expect(step.conditions).toHaveLength(3);
      expect(step.conditions?.[0].type).toBe('if');
      expect(step.conditions?.[1].type).toBe('environment');
      expect(step.conditions?.[2].type).toBe('data-validation');
    });
  });
});

describe('WorkflowMetadata', () => {
  describe('createWorkflowMetadata', () => {
    it('should create metadata with user-created source', () => {
      const metadata = createWorkflowMetadata('1.0.0', 'user-created');

      expect(metadata.version).toBe('1.0.0');
      expect(metadata.source).toBe('user-created');
      expect(metadata.executionCount).toBe(0);
      expect(metadata.successCount).toBe(0);
      expect(metadata.failureCount).toBe(0);
    });

    it('should create metadata with ai-generated source', () => {
      const metadata = createWorkflowMetadata('2.1.0', 'ai-generated');

      expect(metadata.source).toBe('ai-generated');
    });

    it('should create metadata with import source', () => {
      const metadata = createWorkflowMetadata('1.5.0', 'import');

      expect(metadata.source).toBe('import');
    });

    it('should create metadata with tags', () => {
      const tags = ['login', 'authentication', 'critical'];
      const metadata = createWorkflowMetadata('1.0.0', 'user-created', tags);

      expect(metadata.tags).toEqual(tags);
    });

    it('should set timestamps to ISO 8601 format', () => {
      const metadata = createWorkflowMetadata('1.0.0');

      expect(metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(metadata.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should have equal created and updated timestamps initially', () => {
      const metadata = createWorkflowMetadata('1.0.0');

      expect(metadata.createdAt).toBe(metadata.updatedAt);
    });

    it('should initialize execution counters to zero', () => {
      const metadata = createWorkflowMetadata('1.0.0');

      expect(metadata.executionCount).toBe(0);
      expect(metadata.successCount).toBe(0);
      expect(metadata.failureCount).toBe(0);
      expect(metadata.averageDuration).toBeUndefined();
    });
  });
});

describe('Workflow', () => {
  let policy: ExecutionPolicy;
  let metadata: WorkflowMetadata;

  beforeEach(() => {
    policy = createExecutionPolicy('sequential', 'stop');
    metadata = createWorkflowMetadata('1.0.0', 'user-created');
  });

  describe('createWorkflow', () => {
    it('should create a workflow with required fields', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const workflow = createWorkflow('wf-1', 'Login Workflow', [step], metadata);

      expect(workflow.id).toBe('wf-1');
      expect(workflow.name).toBe('Login Workflow');
      expect(workflow.steps).toHaveLength(1);
      expect(workflow.metadata).toEqual(metadata);
    });

    it('should create a workflow with description', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const workflow = createWorkflow(
        'wf-1',
        'Login Workflow',
        [step],
        metadata,
        'Automates the login process',
      );

      expect(workflow.description).toBe('Automates the login process');
    });

    it('should create a workflow with multiple steps', () => {
      const step1 = createRecordingStep('step-1', 'Navigate to Login', 'rec-1', policy);
      const step2 = createRecordingStep('step-2', 'Enter Credentials', 'rec-2', policy);
      const step3 = createRecordingStep('step-3', 'Click Submit', 'rec-3', policy);

      const workflow = createWorkflow(
        'wf-1',
        'Login Workflow',
        [step1, step2, step3],
        metadata,
      );

      expect(workflow.steps).toHaveLength(3);
      expect(workflow.steps[0].id).toBe('step-1');
      expect(workflow.steps[1].id).toBe('step-2');
      expect(workflow.steps[2].id).toBe('step-3');
    });

    it('should create a workflow with mixed step types', () => {
      const recordingStep = createRecordingStep('step-1', 'Play Login', 'rec-123', policy);
      const workflowStep = createWorkflowStep('step-2', 'Run Checkout', 'wf-456', policy);

      const workflow = createWorkflow(
        'wf-1',
        'Complete Purchase',
        [recordingStep, workflowStep],
        metadata,
      );

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps[0].type).toBe('recording');
      expect(workflow.steps[1].type).toBe('workflow');
    });

    it('should create a workflow with empty steps', () => {
      const workflow = createWorkflow('wf-1', 'Empty Workflow', [], metadata);

      expect(workflow.steps).toHaveLength(0);
    });
  });
});

describe('Validation', () => {
  let policy: ExecutionPolicy;
  let metadata: WorkflowMetadata;

  beforeEach(() => {
    policy = createExecutionPolicy('sequential', 'stop');
    metadata = createWorkflowMetadata('1.0.0', 'user-created');
  });

  describe('validateStepReference', () => {
    it('should pass validation for valid recording step', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);

      expect(() => validateStepReference(step)).not.toThrow();
    });

    it('should pass validation for valid workflow step', () => {
      const step = createWorkflowStep('step-1', 'Run Workflow', 'wf-456', policy);

      expect(() => validateStepReference(step)).not.toThrow();
    });

    it('should fail validation for recording step without recordingId', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      step.recordingId = undefined;

      expect(() => validateStepReference(step)).toThrow(
        'Invalid recording step "step-1": recording steps must have recordingId',
      );
    });

    it('should fail validation for workflow step without workflowId', () => {
      const step = createWorkflowStep('step-1', 'Run Workflow', 'wf-456', policy);
      step.workflowId = undefined;

      expect(() => validateStepReference(step)).toThrow(
        'Invalid workflow step "step-1": workflow steps must have workflowId',
      );
    });
  });

  describe('validateTimestamp', () => {
    it('should validate correct ISO 8601 timestamps', () => {
      expect(() => validateTimestamp('2024-01-15T10:30:45.123Z')).not.toThrow();
      expect(() => validateTimestamp('2024-12-31T23:59:59Z')).not.toThrow();
      expect(() => validateTimestamp('2024-01-01T00:00:00.000Z')).not.toThrow();
    });

    it('should reject invalid timestamp formats', () => {
      expect(() => validateTimestamp('2024-01-15')).toThrow();
      expect(() => validateTimestamp('10:30:45')).toThrow();
      expect(() => validateTimestamp('invalid')).toThrow();
      expect(() => validateTimestamp('')).toThrow();
    });
  });

  describe('validateSemanticVersion', () => {
    it('should validate correct semver strings', () => {
      expect(() => validateSemanticVersion('1.0.0')).not.toThrow();
      expect(() => validateSemanticVersion('2.15.3')).not.toThrow();
      expect(() => validateSemanticVersion('0.0.1')).not.toThrow();
    });

    it('should validate semver with pre-release identifier', () => {
      expect(() => validateSemanticVersion('1.0.0-alpha')).not.toThrow();
      expect(() => validateSemanticVersion('2.1.0-beta.1')).not.toThrow();
    });

    it('should reject invalid version formats', () => {
      expect(() => validateSemanticVersion('1.0')).toThrow();
      expect(() => validateSemanticVersion('1')).toThrow();
      expect(() => validateSemanticVersion('v1.0.0')).toThrow();
      expect(() => validateSemanticVersion('1.0.0.0')).toThrow();
      expect(() => validateSemanticVersion('invalid')).toThrow();
    });
  });

  describe('validateWorkflowSteps', () => {
    it('should validate workflow with valid steps', () => {
      const step1 = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const step2 = createWorkflowStep('step-2', 'Run Workflow', 'wf-456', policy);
      const workflow = createWorkflow('wf-1', 'Test Workflow', [step1, step2], metadata);

      expect(() => validateWorkflowSteps(workflow)).not.toThrow();
    });

    it('should fail validation for workflow with invalid step reference', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      step.recordingId = undefined;
      const workflow = createWorkflow('wf-1', 'Test Workflow', [step], metadata);

      expect(() => validateWorkflowSteps(workflow)).toThrow();
    });
  });

  describe('hasCircularDependency', () => {
    it('should detect direct self-reference', () => {
      const step = createWorkflowStep('step-1', 'Run Self', 'wf-1', policy);
      const workflow = createWorkflow('wf-1', 'Self-Referencing', [step], metadata);

      expect(hasCircularDependency(workflow)).toBe(true);
    });

    it('should not detect circular dependency when no self-reference', () => {
      const step1 = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const step2 = createWorkflowStep('step-2', 'Run Other Workflow', 'wf-other', policy);
      const workflow = createWorkflow('wf-1', 'Valid Workflow', [step1, step2], metadata);

      expect(hasCircularDependency(workflow)).toBe(false);
    });

    it('should not detect circular dependency with recording steps only', () => {
      const step1 = createRecordingStep('step-1', 'Play Recording 1', 'rec-1', policy);
      const step2 = createRecordingStep('step-2', 'Play Recording 2', 'rec-2', policy);
      const workflow = createWorkflow('wf-1', 'Recording Workflow', [step1, step2], metadata);

      expect(hasCircularDependency(workflow)).toBe(false);
    });

    it('should detect circular dependency among multiple steps', () => {
      const step1 = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const step2 = createWorkflowStep('step-2', 'Run Self', 'wf-1', policy);
      const workflow = createWorkflow('wf-1', 'Problematic', [step1, step2], metadata);

      expect(hasCircularDependency(workflow)).toBe(true);
    });
  });

  describe('validateOutputMapping', () => {
    it('should validate valid output mapping', () => {
      const step = createRecordingStep(
        'step-1',
        'Play Recording',
        'rec-123',
        policy,
        undefined,
        undefined,
        { userId: 'response.user.id' },
      );

      expect(() => validateOutputMapping(step)).not.toThrow();
    });

    it('should validate step without output mapping', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);

      expect(() => validateOutputMapping(step)).not.toThrow();
    });

    it('should fail validation for empty context key', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      step.outputMapping = { '': 'response.value' };

      expect(() => validateOutputMapping(step)).toThrow(
        'Invalid output mapping in step "step-1": context key must be a non-empty string',
      );
    });

    it('should fail validation for empty path value', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      step.outputMapping = { userId: '' };

      expect(() => validateOutputMapping(step)).toThrow(
        'Invalid output mapping in step "step-1": path must be a non-empty string for key "userId"',
      );
    });

    it('should validate multiple output mappings', () => {
      const step = createRecordingStep(
        'step-1',
        'Play Recording',
        'rec-123',
        policy,
        undefined,
        undefined,
        {
          userId: 'response.user.id',
          token: 'response.auth.token',
          expiresAt: 'response.auth.expiresAt',
        },
      );

      expect(() => validateOutputMapping(step)).not.toThrow();
    });
  });

  describe('validateWorkflow', () => {
    it('should validate a complete valid workflow', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const workflow = createWorkflow('wf-1', 'Valid Workflow', [step], metadata);

      expect(() => validateWorkflow(workflow)).not.toThrow();
    });

    it('should fail validation for workflow with invalid step reference', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      step.recordingId = undefined;
      const workflow = createWorkflow('wf-1', 'Invalid Workflow', [step], metadata);

      expect(() => validateWorkflow(workflow)).toThrow();
    });

    it('should fail validation for circular dependency', () => {
      const step = createWorkflowStep('step-1', 'Run Self', 'wf-1', policy);
      const workflow = createWorkflow('wf-1', 'Circular', [step], metadata);

      expect(() => validateWorkflow(workflow)).toThrow('Circular dependency detected');
    });

    it('should fail validation for invalid metadata version', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const invalidMetadata = createWorkflowMetadata('invalid-version');
      const workflow = createWorkflow('wf-1', 'Invalid Workflow', [step], invalidMetadata);

      expect(() => validateWorkflow(workflow)).toThrow();
    });

    it('should validate complex workflow with multiple steps and conditions', () => {
      const condition = createIfCondition('isProduction', '===', true);
      const step1 = createRecordingStep('step-1', 'Login', 'rec-1', policy, undefined, [
        condition,
      ]);
      const step2 = createWorkflowStep('step-2', 'Checkout', 'wf-2', policy, undefined, undefined, {
        orderId: 'response.order.id',
      });
      const workflow = createWorkflow(
        'wf-1',
        'Complex Workflow',
        [step1, step2],
        metadata,
        'A complex workflow',
      );

      expect(() => validateWorkflow(workflow)).not.toThrow();
    });
  });
});

describe('Serialization', () => {
  let policy: ExecutionPolicy;
  let metadata: WorkflowMetadata;

  beforeEach(() => {
    policy = createExecutionPolicy('sequential', 'stop');
    metadata = createWorkflowMetadata('1.0.0', 'user-created', ['test', 'automation']);
  });

  describe('serializeWorkflow', () => {
    it('should serialize a simple workflow to JSON string', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const workflow = createWorkflow('wf-1', 'Test Workflow', [step], metadata);

      const json = serializeWorkflow(workflow);

      expect(typeof json).toBe('string');
      expect(json).toContain('wf-1');
      expect(json).toContain('Test Workflow');
      expect(json).toContain('rec-123');
    });

    it('should produce valid JSON that can be parsed', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const workflow = createWorkflow('wf-1', 'Test Workflow', [step], metadata);

      const json = serializeWorkflow(workflow);
      const parsed = JSON.parse(json);

      expect(parsed.id).toBe('wf-1');
      expect(parsed.name).toBe('Test Workflow');
    });

    it('should serialize workflow with all fields', () => {
      const condition = createIfCondition('status', '===', 'ready');
      const step = createRecordingStep(
        'step-1',
        'Play Recording',
        'rec-123',
        policy,
        'Login recording',
        [condition],
        { userId: 'response.id' },
      );
      const workflow = createWorkflow('wf-1', 'Full Workflow', [step], metadata, 'Description');

      const json = serializeWorkflow(workflow);
      const parsed = JSON.parse(json);

      expect(parsed.description).toBe('Description');
      expect(parsed.steps[0].conditions).toHaveLength(1);
      expect(parsed.steps[0].outputMapping).toEqual({ userId: 'response.id' });
    });
  });

  describe('deserializeWorkflow', () => {
    it('should deserialize valid workflow JSON', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const workflow = createWorkflow('wf-1', 'Test Workflow', [step], metadata);
      const json = serializeWorkflow(workflow);

      const deserialized = deserializeWorkflow(json);

      expect(deserialized.id).toBe('wf-1');
      expect(deserialized.name).toBe('Test Workflow');
      expect(deserialized.steps).toHaveLength(1);
    });

    it('should throw for invalid JSON', () => {
      expect(() => deserializeWorkflow('invalid json')).toThrow();
    });

    it('should validate deserialized workflow', () => {
      const step = createRecordingStep('step-1', 'Play Recording', 'rec-123', policy);
      const workflow = createWorkflow('wf-1', 'Test Workflow', [step], metadata);
      const json = serializeWorkflow(workflow);

      // Manually corrupt the JSON before deserializing
      const corrupted = json.replace('1.0.0', 'invalid');

      expect(() => deserializeWorkflow(corrupted)).toThrow();
    });

    it('should round-trip workflow through serialization', () => {
      const condition = createIfCondition('env', '===', 'prod');
      const outputMapping = { result: 'response.data' };
      const step1 = createRecordingStep(
        'step-1',
        'Step 1',
        'rec-1',
        policy,
        'First step',
        [condition],
        outputMapping,
      );
      const step2 = createWorkflowStep('step-2', 'Step 2', 'wf-2', policy);

      const original = createWorkflow(
        'wf-1',
        'Original Workflow',
        [step1, step2],
        metadata,
        'Original description',
      );

      const json = serializeWorkflow(original);
      const deserialized = deserializeWorkflow(json);

      // Verify structure is preserved
      expect(deserialized.id).toBe(original.id);
      expect(deserialized.name).toBe(original.name);
      expect(deserialized.description).toBe(original.description);
      expect(deserialized.steps).toHaveLength(2);
      expect(deserialized.steps[0].type).toBe('recording');
      expect(deserialized.steps[1].type).toBe('workflow');
      expect(deserialized.steps[0].conditions).toHaveLength(1);
      expect(deserialized.steps[0].outputMapping).toEqual(outputMapping);
    });
  });
});

describe('Integration Tests', () => {
  describe('Complete workflow creation workflow', () => {
    it('should create a realistic e-commerce workflow', () => {
      const policy = createExecutionPolicy('sequential', 'stop');
      const metadata = createWorkflowMetadata('1.0.0', 'user-created', [
        'ecommerce',
        'purchase',
      ]);

      // Create steps
      const loginCondition = createEnvironmentCondition('windows');
      const loginStep = createRecordingStep(
        'step-1',
        'Navigate to Store',
        'rec-navigate',
        policy,
        'Navigate to the online store',
        [loginCondition],
        { sessionId: 'response.session.id' },
      );

      const searchPolicy = createExecutionPolicy('sequential', 'continue', true, 2, 1000);
      const searchStep = createRecordingStep(
        'step-2',
        'Search for Product',
        'rec-search',
        searchPolicy,
        'Search for a product',
      );

      const dataValidation = createDataValidationCondition({
        properties: { productId: { type: 'string' } },
      });
      const checkoutStep = createWorkflowStep(
        'step-3',
        'Checkout Process',
        'wf-checkout',
        policy,
        'Run nested checkout workflow',
        [dataValidation],
        { orderId: 'response.order.id', total: 'response.total' },
      );

      const workflow = createWorkflow(
        'wf-ecommerce',
        'E-commerce Purchase Flow',
        [loginStep, searchStep, checkoutStep],
        metadata,
        'Complete purchase flow from browsing to checkout',
      );

      // Validate
      validateWorkflow(workflow);

      // Serialize and deserialize
      const json = serializeWorkflow(workflow);
      const restored = deserializeWorkflow(json);

      // Verify
      expect(restored.id).toBe('wf-ecommerce');
      expect(restored.steps).toHaveLength(3);
      expect(restored.steps[0].outputMapping).toEqual({ sessionId: 'response.session.id' });
      expect(restored.steps[2].outputMapping).toEqual({
        orderId: 'response.order.id',
        total: 'response.total',
      });
      expect(restored.metadata.tags).toContain('ecommerce');
      expect(restored.metadata.tags).toContain('purchase');
    });

    it('should handle multiple conditions on a single step', () => {
      const policy = createExecutionPolicy('sequential', 'continue');
      const metadata = createWorkflowMetadata('1.0.0');

      const condition1 = createIfCondition('environment', 'in', ['staging', 'production']);
      const condition2 = createEnvironmentCondition('windows');
      const condition3 = createDataValidationCondition({ type: 'object' }, true); // Inverted

      const step = createRecordingStep(
        'step-1',
        'Conditional Recording',
        'rec-123',
        policy,
        undefined,
        [condition1, condition2, condition3],
      );

      const workflow = createWorkflow('wf-1', 'Multi-Condition Workflow', [step], metadata);

      validateWorkflow(workflow);
      expect(workflow.steps[0].conditions).toHaveLength(3);

      // Verify all conditions are preserved through serialization
      const restored = deserializeWorkflow(serializeWorkflow(workflow));
      expect(restored.steps[0].conditions).toHaveLength(3);
    });
  });
});
