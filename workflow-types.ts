/**
 * Workflow System Type Definitions
 *
 * Defines the complete type model for workflows, which are composable collections
 * of steps that can reference recordings, have conditional execution, and support
 * dynamic ordering. This enables automation composition and reuse.
 *
 * Key concepts:
 * - Workflows organize recordings into sequences or parallel execution patterns
 * - Steps reference recordings by ID (not by value, recordings stored separately)
 * - Conditions enable branching and context-aware execution
 * - Execution policies control parallelization and error handling
 * - Workflows are versioned (semver) for reproducibility
 */

/**
 * Condition type for gating step execution.
 *
 * Supports three types of conditions:
 * - 'if': Variable comparison (e.g., context value equals something)
 * - 'environment': Environment checks (OS, browser, etc.)
 * - 'data-validation': JSON schema or custom validation rules
 *
 * Conditions can be inverted using the 'invert' flag.
 */
export interface StepCondition {
  /** Type of condition: variable comparison, environment check, or data validation */
  type: 'if' | 'environment' | 'data-validation';

  /** Whether to negate the condition result (NOT logic) */
  invert?: boolean;

  // For 'if' type conditions:
  /** Variable name to check (used with operator and value) */
  variable?: string;

  /** Comparison operator for variable evaluation */
  operator?: '===' | '!==' | '>' | '<' | '>=' | '<=' | 'in' | 'not-in';

  /** Value to compare against (type depends on operator) */
  value?: unknown;

  // For 'environment' type conditions:
  /** Operating system requirement */
  os?: 'windows' | 'macos' | 'linux';

  /** Browser requirement */
  browser?: string;

  // For 'data-validation' type conditions:
  /** JSON schema or validation rules for input data */
  schema?: Record<string, unknown>;
}

/**
 * Execution policy for controlling how a step or workflow executes.
 *
 * Policies define:
 * - Sequential vs. parallel execution
 * - Retry behavior on failure
 * - Concurrency limits for parallel execution
 * - Error handling strategy
 * - Timeout settings
 */
export interface ExecutionPolicy {
  /** Execution type: sequential, parallel, or conditional branching */
  type: 'sequential' | 'parallel' | 'conditional';

  /** Whether to retry the step on failure */
  retryOnFailure?: boolean;

  /** Maximum number of retries (default: 3) */
  maxRetries?: number;

  /** Delay between retries in milliseconds (default: 1000) */
  delayBetweenRetries?: number;

  /** Maximum concurrent steps when type is 'parallel' (default: unlimited) */
  maxConcurrency?: number;

  /** Error handling strategy: stop all, continue others, or skip this step */
  onError: 'stop' | 'continue' | 'skip-step';

  /** Execution timeout in milliseconds (optional) */
  timeout?: number;
}

/**
 * A single step in a workflow.
 *
 * Steps are the atomic units of workflow execution. Each step either:
 * - References a recording to be played back
 * - References a nested workflow to be executed
 *
 * Steps can have conditions that gate their execution and output mappings
 * that transform their results into context for subsequent steps.
 */
export interface WorkflowStep {
  /** Unique identifier for this step within the workflow */
  id: string;

  /** Human-readable name for this step */
  name: string;

  /** Optional detailed description of what the step does */
  description?: string;

  /** Step type: either a recording playback or nested workflow execution */
  type: 'recording' | 'workflow';

  /** ID of the recording to play (required when type === 'recording') */
  recordingId?: string;

  /** ID of the nested workflow to execute (required when type === 'workflow') */
  workflowId?: string;

  /** Array of conditions that must be met for step execution */
  conditions?: StepCondition[];

  /** Execution policy for this step */
  policy: ExecutionPolicy;

  /** Mapping of step output to workflow context (output_key -> path_in_step_output) */
  outputMapping?: Record<string, string>;

  /** ISO 8601 timestamp when step was created */
  createdAt: string;

  /** ISO 8601 timestamp when step was last updated */
  updatedAt: string;
}

/**
 * Workflow metadata containing versioning and execution statistics.
 *
 * Metadata tracks:
 * - When the workflow was created/updated
 * - Version information for reproducibility
 * - Execution history (counts and timing)
 * - Tags for organization and filtering
 */
export interface WorkflowMetadata {
  /** ISO 8601 timestamp when workflow was created */
  createdAt: string;

  /** ISO 8601 timestamp when workflow was last updated */
  updatedAt: string;

  /** Semantic version (semver) for the workflow */
  version: string;

  /** Source of the workflow: user-created, AI-generated, or imported */
  source: 'user-created' | 'ai-generated' | 'import';

  /** Optional tags for categorization and filtering */
  tags?: string[];

  /** Total number of times this workflow has been executed */
  executionCount: number;

  /** Number of successful executions */
  successCount: number;

  /** Number of failed executions */
  failureCount: number;

  /** Average execution duration in milliseconds (optional) */
  averageDuration?: number;
}

/**
 * A Workflow — named collection of steps with metadata.
 *
 * Workflows are:
 * - Composable: can contain nested workflows
 * - Reusable: can be executed multiple times
 * - Versionable: tracked with semantic versioning
 * - Observable: includes execution history
 */
export interface Workflow {
  /** Unique identifier for the workflow (UUID or nanoid) */
  id: string;

  /** Human-readable name for the workflow */
  name: string;

  /** Optional detailed description of what the workflow does */
  description?: string;

  /** Ordered array of workflow steps */
  steps: WorkflowStep[];

  /** Metadata about the workflow */
  metadata: WorkflowMetadata;
}

/**
 * Helper function to create a new StepCondition for variable comparison.
 *
 * @param variable - Variable name to check
 * @param operator - Comparison operator
 * @param value - Value to compare against
 * @param invert - Whether to negate the condition
 * @returns StepCondition object
 */
export function createIfCondition(
  variable: string,
  operator: '===' | '!==' | '>' | '<' | '>=' | '<=' | 'in' | 'not-in',
  value: unknown,
  invert?: boolean,
): StepCondition {
  return {
    type: 'if',
    variable,
    operator,
    value,
    invert,
  };
}

/**
 * Helper function to create a new StepCondition for environment checks.
 *
 * @param os - Operating system requirement
 * @param browser - Browser requirement
 * @param invert - Whether to negate the condition
 * @returns StepCondition object
 */
export function createEnvironmentCondition(
  os?: 'windows' | 'macos' | 'linux',
  browser?: string,
  invert?: boolean,
): StepCondition {
  return {
    type: 'environment',
    os,
    browser,
    invert,
  };
}

/**
 * Helper function to create a new StepCondition for data validation.
 *
 * @param schema - JSON schema or validation rules
 * @param invert - Whether to negate the condition
 * @returns StepCondition object
 */
export function createDataValidationCondition(
  schema: Record<string, unknown>,
  invert?: boolean,
): StepCondition {
  return {
    type: 'data-validation',
    schema,
    invert,
  };
}

/**
 * Helper function to create a new ExecutionPolicy.
 *
 * @param type - Execution type (sequential, parallel, or conditional)
 * @param onError - Error handling strategy
 * @param retryOnFailure - Whether to retry on failure
 * @param maxRetries - Maximum number of retries
 * @param delayBetweenRetries - Delay between retries in milliseconds
 * @param maxConcurrency - Maximum concurrent steps for parallel execution
 * @param timeout - Execution timeout in milliseconds
 * @returns ExecutionPolicy object
 */
export function createExecutionPolicy(
  type: 'sequential' | 'parallel' | 'conditional',
  onError: 'stop' | 'continue' | 'skip-step',
  retryOnFailure?: boolean,
  maxRetries?: number,
  delayBetweenRetries?: number,
  maxConcurrency?: number,
  timeout?: number,
): ExecutionPolicy {
  return {
    type,
    onError,
    retryOnFailure,
    maxRetries,
    delayBetweenRetries,
    maxConcurrency,
    timeout,
  };
}

/**
 * Helper function to create a new WorkflowStep with a recording reference.
 *
 * @param id - Unique step identifier
 * @param name - Step name
 * @param recordingId - ID of the recording to play
 * @param policy - Execution policy for the step
 * @param description - Optional description
 * @param conditions - Optional conditions for execution
 * @param outputMapping - Optional output mapping
 * @returns WorkflowStep object
 */
export function createRecordingStep(
  id: string,
  name: string,
  recordingId: string,
  policy: ExecutionPolicy,
  description?: string,
  conditions?: StepCondition[],
  outputMapping?: Record<string, string>,
): WorkflowStep {
  const now = new Date().toISOString();

  return {
    id,
    name,
    description,
    type: 'recording',
    recordingId,
    conditions,
    policy,
    outputMapping,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Helper function to create a new WorkflowStep with a nested workflow reference.
 *
 * @param id - Unique step identifier
 * @param name - Step name
 * @param workflowId - ID of the nested workflow to execute
 * @param policy - Execution policy for the step
 * @param description - Optional description
 * @param conditions - Optional conditions for execution
 * @param outputMapping - Optional output mapping
 * @returns WorkflowStep object
 */
export function createWorkflowStep(
  id: string,
  name: string,
  workflowId: string,
  policy: ExecutionPolicy,
  description?: string,
  conditions?: StepCondition[],
  outputMapping?: Record<string, string>,
): WorkflowStep {
  const now = new Date().toISOString();

  return {
    id,
    name,
    description,
    type: 'workflow',
    workflowId,
    conditions,
    policy,
    outputMapping,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Helper function to create WorkflowMetadata.
 *
 * @param version - Semantic version (e.g., "1.0.0")
 * @param source - Source of the workflow
 * @param tags - Optional tags for categorization
 * @returns WorkflowMetadata object
 */
export function createWorkflowMetadata(
  version: string,
  source: 'user-created' | 'ai-generated' | 'import' = 'user-created',
  tags?: string[],
): WorkflowMetadata {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    updatedAt: now,
    version,
    source,
    tags,
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
  };
}

/**
 * Helper function to create a new Workflow.
 *
 * @param id - Unique workflow identifier
 * @param name - Workflow name
 * @param steps - Array of workflow steps
 * @param metadata - Workflow metadata
 * @param description - Optional description
 * @returns Workflow object
 */
export function createWorkflow(
  id: string,
  name: string,
  steps: WorkflowStep[],
  metadata: WorkflowMetadata,
  description?: string,
): Workflow {
  return {
    id,
    name,
    description,
    steps,
    metadata,
  };
}

/**
 * Validates that a step reference is valid based on step type.
 *
 * - Recording steps must have recordingId
 * - Workflow steps must have workflowId
 *
 * @param step - WorkflowStep to validate
 * @throws Error if step reference is invalid
 */
export function validateStepReference(step: WorkflowStep): void {
  if (step.type === 'recording' && !step.recordingId) {
    throw new Error(
      `Invalid recording step "${step.id}": recording steps must have recordingId`,
    );
  }

  if (step.type === 'workflow' && !step.workflowId) {
    throw new Error(
      `Invalid workflow step "${step.id}": workflow steps must have workflowId`,
    );
  }
}

/**
 * Validates that timestamps are in ISO 8601 format.
 *
 * @param timestamp - Timestamp string to validate
 * @throws Error if timestamp is not valid ISO 8601
 */
export function validateTimestamp(timestamp: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/.test(timestamp)) {
    throw new Error(
      `Invalid timestamp: "${timestamp}" must be ISO 8601 format`,
    );
  }
}

/**
 * Validates that a semantic version string is valid.
 *
 * @param version - Version string to validate (e.g., "1.0.0")
 * @throws Error if version is not valid semver
 */
export function validateSemanticVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
    throw new Error(
      `Invalid semantic version: "${version}" must be in format MAJOR.MINOR.PATCH`,
    );
  }
}

/**
 * Validates all step references in a workflow.
 *
 * @param workflow - Workflow to validate
 * @throws Error if any step reference is invalid
 */
export function validateWorkflowSteps(workflow: Workflow): void {
  for (const step of workflow.steps) {
    validateStepReference(step);
  }
}

/**
 * Detects circular dependencies: checks if a workflow references itself.
 *
 * This is a shallow check that only detects direct self-references
 * (workflow referencing itself in one of its steps).
 *
 * @param workflow - Workflow to check
 * @returns true if a circular dependency is detected, false otherwise
 */
export function hasCircularDependency(workflow: Workflow): boolean {
  for (const step of workflow.steps) {
    if (step.type === 'workflow' && step.workflowId === workflow.id) {
      return true;
    }
  }
  return false;
}

/**
 * Validates that output mapping paths reference valid keys.
 *
 * This validates the structure of output mapping, ensuring keys are non-empty strings.
 *
 * @param step - WorkflowStep to validate
 * @throws Error if output mapping is invalid
 */
export function validateOutputMapping(step: WorkflowStep): void {
  if (!step.outputMapping) {
    return;
  }

  for (const [contextKey, pathInOutput] of Object.entries(step.outputMapping)) {
    if (!contextKey || typeof contextKey !== 'string') {
      throw new Error(
        `Invalid output mapping in step "${step.id}": context key must be a non-empty string`,
      );
    }

    if (!pathInOutput || typeof pathInOutput !== 'string') {
      throw new Error(
        `Invalid output mapping in step "${step.id}": path must be a non-empty string for key "${contextKey}"`,
      );
    }
  }
}

/**
 * Validates a complete Workflow object.
 *
 * Checks:
 * - All step references are valid
 * - No circular dependencies
 * - Timestamps are valid ISO 8601
 * - Version is valid semver
 * - Output mappings are valid
 *
 * @param workflow - Workflow to validate
 * @throws Error if any validation fails
 */
export function validateWorkflow(workflow: Workflow): void {
  // Validate metadata timestamps and version
  validateTimestamp(workflow.metadata.createdAt);
  validateTimestamp(workflow.metadata.updatedAt);
  validateSemanticVersion(workflow.metadata.version);

  // Validate step references
  validateWorkflowSteps(workflow);

  // Check for circular dependencies
  if (hasCircularDependency(workflow)) {
    throw new Error(
      `Circular dependency detected: workflow "${workflow.id}" references itself`,
    );
  }

  // Validate each step
  for (const step of workflow.steps) {
    validateTimestamp(step.createdAt);
    validateTimestamp(step.updatedAt);
    validateOutputMapping(step);
  }
}

/**
 * Serializes a Workflow to JSON.
 *
 * @param workflow - Workflow to serialize
 * @returns JSON string representation of the workflow
 */
export function serializeWorkflow(workflow: Workflow): string {
  return JSON.stringify(workflow, null, 2);
}

/**
 * Deserializes a Workflow from JSON.
 *
 * @param json - JSON string representation of a workflow
 * @returns Deserialized Workflow object
 * @throws Error if JSON is invalid or workflow is malformed
 */
export function deserializeWorkflow(json: string): Workflow {
  const workflow = JSON.parse(json) as Workflow;
  validateWorkflow(workflow);
  return workflow;
}
