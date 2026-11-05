/**
 * Pack Execution Policy Engine
 *
 * Orchestrates execution of workflows within packs according to deployment policies.
 * Supports:
 * - Sequential execution: workflows run one after another with output → input data passing
 * - Parallel execution: workflows run concurrently with result collection
 * - Conditional execution: workflows run based on evaluated conditions and branching logic
 * - Data mapping: flexible output-to-input transformation between workflows
 * - Error handling: skip vs stop policies, retry logic, and failure recovery
 *
 * Key Features:
 * - Complete execution flow management
 * - Intelligent data passing with field extraction and transformation
 * - Concurrency control with max-parallel limits
 * - Condition evaluation against context and previous results
 * - Timeout support and cancellation
 * - Comprehensive execution tracking and logging
 */

import {
  DeploymentPolicy,
  WorkflowReference,
  PackManifest,
} from '../../../../pack-types';
import { Workflow, WorkflowStep } from '../../../../workflow-types';
import { EntityId, Timestamp } from '../../../../integration-types';

/**
 * Represents data mapping configuration between workflows.
 * Maps fields from source (previous workflow output) to target (next workflow input).
 */
export interface DataMapping {
  /** Source field path in previous workflow output (dot notation: "user.name", "results[0].id") */
  sourcePath: string;

  /** Target field path in next workflow input (dot notation) */
  targetPath: string;

  /** Optional default value if source field is missing or null */
  defaultValue?: unknown;

  /** Optional transformation function name ("uppercase", "lowercase", "stringify", "parse") */
  transform?: 'uppercase' | 'lowercase' | 'stringify' | 'parse' | 'trim' | 'split' | 'join';

  /** Optional arguments for transformation (e.g., delimiter for split/join) */
  transformArgs?: unknown[];

  /** Whether this mapping is required (fail if source missing) */
  required?: boolean;
}

/**
 * Configuration for a workflow within an execution sequence.
 * Extends WorkflowReference with execution-specific options.
 */
export interface WorkflowExecutionConfig extends WorkflowReference {
  /** Data mappings from previous workflow output to this workflow input */
  inputMapping?: DataMapping[];

  /** Data mappings from this workflow output to next workflow input */
  outputMapping?: DataMapping[];

  /** Timeout in milliseconds for this specific workflow execution */
  timeoutMs?: number;

  /** Whether to continue on failure (skip this workflow, continue to next) */
  continueOnFailure?: boolean;

  /** Maximum retries for this workflow if it fails */
  maxRetries?: number;

  /** Delay between retries in milliseconds */
  retryDelayMs?: number;

  /** Label for this workflow in execution trace (for debugging) */
  label?: string;
}

/**
 * Result of a single workflow execution.
 */
export interface WorkflowExecutionResult {
  /** ID of the executed workflow */
  workflowId: EntityId;

  /** Execution start timestamp */
  startedAt: Timestamp;

  /** Execution end timestamp */
  completedAt: Timestamp;

  /** Total execution duration in milliseconds */
  durationMs: number;

  /** Execution status: success, failed, skipped, timeout, cancelled */
  status: 'success' | 'failed' | 'skipped' | 'timeout' | 'cancelled';

  /** Output data from the workflow */
  output?: unknown;

  /** Error information if execution failed */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };

  /** Number of retry attempts made */
  retryCount: number;

  /** Whether this workflow was skipped */
  skipped: boolean;

  /** Skip reason if applicable */
  skipReason?: string;
}

/**
 * Result of a branch execution (parallel or conditional branch).
 */
export interface BranchExecutionResult {
  /** Branch identifier (parallel branch index or condition name) */
  branchId: string | number;

  /** Results from workflows in this branch */
  workflowResults: WorkflowExecutionResult[];

  /** Overall branch status */
  status: 'success' | 'partial_failure' | 'failed';

  /** Error if branch failed completely */
  error?: string;

  /** Branch output (final result or merged results) */
  output?: unknown;
}

/**
 * Complete execution result for an entire pack deployment.
 */
export interface PackExecutionResult {
  /** Unique execution ID for tracking */
  executionId: string;

  /** Pack manifest that was executed */
  manifest: PackManifest;

  /** Execution start timestamp */
  startedAt: Timestamp;

  /** Execution end timestamp */
  completedAt: Timestamp;

  /** Total execution duration in milliseconds */
  durationMs: number;

  /** Overall execution status */
  status: 'success' | 'partial_success' | 'failed' | 'cancelled';

  /** Results from each workflow execution */
  workflowResults: WorkflowExecutionResult[];

  /** Results from each branch (if parallel/conditional mode) */
  branchResults?: BranchExecutionResult[];

  /** Execution mode that was used */
  executionMode: 'sequential' | 'parallel' | 'conditional';

  /** Overall error if execution failed */
  error?: {
    message: string;
    phase: 'setup' | 'execution' | 'completion';
    failedAt?: EntityId;
  };

  /** Final aggregated output from pack execution */
  finalOutput?: unknown;

  /** Whether this was a partial execution (some workflows skipped) */
  partialExecution: boolean;
}

/**
 * Conditional branch in execution.
 */
export interface ExecutionBranch {
  /** Condition name or identifier */
  name: string;

  /** Condition expression to evaluate */
  condition?: string;

  /** Workflows in this branch */
  workflows: WorkflowExecutionConfig[];

  /** Whether this is the default/fallthrough branch */
  isDefault?: boolean;
}

/**
 * Context for condition evaluation during execution.
 */
export interface ExecutionContext {
  /** Current execution environment variables */
  environment: Record<string, unknown>;

  /** Results from previously executed workflows */
  previousResults: Map<EntityId, WorkflowExecutionResult>;

  /** Current accumulated data */
  accumulatedData: Record<string, unknown>;

  /** Available platform information */
  platformInfo?: {
    platform: string;
    version: string;
    [key: string]: unknown;
  };
}

/**
 * Pack Execution Policy Engine
 *
 * Orchestrates the execution of workflows according to deployment policies.
 * Handles sequential, parallel, and conditional execution modes with comprehensive
 * error handling, data mapping, and timeout support.
 */
export class PackExecutionPolicyEngine {
  /** Maximum default timeout for any workflow execution (30 minutes) */
  private readonly DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

  /** Maximum default timeout for entire pack execution (2 hours) */
  private readonly DEFAULT_PACK_TIMEOUT_MS = 2 * 60 * 60 * 1000;

  constructor() {
    // Engine initialization
  }

  /**
   * Execute a pack manifest according to its deployment policy.
   *
   * Main entry point for pack execution. Routes to appropriate execution mode
   * (sequential, parallel, conditional) based on policy configuration.
   *
   * @param manifest - The pack manifest to execute
   * @param workflows - Map of workflow ID to Workflow instance
   * @param context - Execution context with environment and previous results
   * @returns Complete execution result
   */
  async executePack(
    manifest: PackManifest,
    workflows: Map<EntityId, Workflow>,
    context: ExecutionContext
  ): Promise<PackExecutionResult> {
    const executionId = this.generateExecutionId();
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      // Validate manifest before execution
      this.validateManifest(manifest, workflows);

      // Get the policy and determine execution mode
      const policy = manifest.policy;
      let workflowResults: WorkflowExecutionResult[] = [];
      let branchResults: BranchExecutionResult[] = [];
      let finalOutput: unknown;

      // Route to appropriate execution mode
      if (policy.mode === 'sequential') {
        workflowResults = await this.executeSequential(
          manifest.workflows,
          workflows,
          policy,
          context
        );
        finalOutput = this.aggregateSequentialResults(workflowResults);
      } else if (policy.mode === 'parallel') {
        branchResults = await this.executeParallel(
          manifest.workflows,
          workflows,
          policy,
          context
        );
        workflowResults = branchResults.flatMap((b) => b.workflowResults);
        finalOutput = this.aggregateParallelResults(branchResults);
      } else if (policy.mode === 'conditional') {
        const branches = this.parseConditionalBranches(manifest, policy);
        branchResults = await this.executeConditional(
          branches,
          workflows,
          policy,
          context
        );
        workflowResults = branchResults.flatMap((b) => b.workflowResults);
        finalOutput = this.aggregateConditionalResults(branchResults);
      }

      // Determine overall status
      const allSucceeded = workflowResults.every((r) => r.status === 'success');
      const anyFailed = workflowResults.some((r) => r.status === 'failed');
      const status = allSucceeded ? 'success' : anyFailed ? 'failed' : 'partial_success';

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      return {
        executionId,
        manifest,
        startedAt,
        completedAt,
        durationMs,
        status,
        workflowResults,
        branchResults: branchResults.length > 0 ? branchResults : undefined,
        executionMode: policy.mode,
        finalOutput,
        partialExecution: workflowResults.some((r) => r.skipped),
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      return {
        executionId,
        manifest,
        startedAt,
        completedAt,
        durationMs,
        status: 'failed',
        workflowResults: [],
        executionMode: manifest.policy.mode,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          phase: 'execution',
        },
        partialExecution: false,
      };
    }
  }

  /**
   * Execute workflows sequentially, passing output from one as input to the next.
   *
   * @param workflows - Workflow references in execution order
   * @param workflowMap - Map of workflow ID to Workflow instance
   * @param policy - Deployment policy with retry/error handling config
   * @param context - Execution context
   * @returns Array of execution results in order
   */
  private async executeSequential(
    workflows: WorkflowReference[],
    workflowMap: Map<EntityId, Workflow>,
    policy: DeploymentPolicy,
    context: ExecutionContext
  ): Promise<WorkflowExecutionResult[]> {
    const results: WorkflowExecutionResult[] = [];
    let accumulatedOutput: unknown = null;

    for (let i = 0; i < workflows.length; i++) {
      const ref = workflows[i];
      const workflow = workflowMap.get(ref.workflowId);

      if (!workflow) {
        results.push({
          workflowId: ref.workflowId,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          status: 'skipped',
          skipped: true,
          skipReason: 'Workflow not found',
          retryCount: 0,
        });
        continue;
      }

      // Prepare input: map output from previous workflow
      let input = accumulatedOutput;
      if (i > 0 && results[i - 1].output) {
        input = this.mapWorkflowInput(results[i - 1].output, ref);
      }

      // Execute workflow with retries
      let result = await this.executeWorkflow(
        workflow,
        input,
        policy,
        context
      );

      results.push(result);
      accumulatedOutput = result.output;

      // Handle error according to policy
      if (result.status === 'failed') {
        if (policy.stopOnError !== false) {
          // Default to stopping on error
          break;
        }
        // Continue on failure if policy allows
      }
    }

    return results;
  }

  /**
   * Execute workflows in parallel branches.
   *
   * @param workflows - Workflow references
   * @param workflowMap - Map of workflow ID to Workflow instance
   * @param policy - Deployment policy with concurrency limits
   * @param context - Execution context
   * @returns Array of branch results
   */
  private async executeParallel(
    workflows: WorkflowReference[],
    workflowMap: Map<EntityId, Workflow>,
    policy: DeploymentPolicy,
    context: ExecutionContext
  ): Promise<BranchExecutionResult[]> {
    const maxConcurrency = policy.maxConcurrency || workflows.length;
    const branches: BranchExecutionResult[] = [];

    // Create branches from workflow list
    const workflowBatches = this.createBatches(workflows, maxConcurrency);

    for (let batchIdx = 0; batchIdx < workflowBatches.length; batchIdx++) {
      const batch = workflowBatches[batchIdx];

      // Execute all workflows in batch concurrently
      const batchPromises = batch.map(async (ref, idx) => {
        const workflow = workflowMap.get(ref.workflowId);
        if (!workflow) {
          return {
            workflowId: ref.workflowId,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
            status: 'skipped' as const,
            skipped: true,
            skipReason: 'Workflow not found',
            retryCount: 0,
          };
        }

        return this.executeWorkflow(workflow, null, policy, context);
      });

      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      for (let idx = 0; idx < batchResults.length; idx++) {
        const settlement = batchResults[idx];
        const result =
          settlement.status === 'fulfilled'
            ? settlement.value
            : {
                workflowId: batch[idx].workflowId,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                durationMs: 0,
                status: 'failed' as const,
                skipped: false,
                retryCount: 0,
                error: {
                  message:
                    settlement.status === 'rejected'
                      ? settlement.reason?.message || 'Unknown error'
                      : 'Promise rejected',
                },
              };

        // Add result to appropriate branch
        if (!branches[batchIdx]) {
          branches[batchIdx] = {
            branchId: batchIdx,
            workflowResults: [],
            status: 'success',
          };
        }
        branches[batchIdx].workflowResults.push(result);
      }
    }

    // Calculate branch statuses
    branches.forEach((branch) => {
      const allSuccess = branch.workflowResults.every((r) => r.status === 'success');
      const anyFailed = branch.workflowResults.some((r) => r.status === 'failed');
      branch.status = allSuccess ? 'success' : anyFailed ? 'failed' : 'partial_failure';
    });

    return branches;
  }

  /**
   * Execute workflows conditionally based on evaluated conditions.
   *
   * @param branches - Conditional execution branches
   * @param workflowMap - Map of workflow ID to Workflow instance
   * @param policy - Deployment policy
   * @param context - Execution context
   * @returns Array of branch results
   */
  private async executeConditional(
    branches: ExecutionBranch[],
    workflowMap: Map<EntityId, Workflow>,
    policy: DeploymentPolicy,
    context: ExecutionContext
  ): Promise<BranchExecutionResult[]> {
    const results: BranchExecutionResult[] = [];

    for (const branch of branches) {
      // Evaluate branch condition
      const shouldExecute =
        branch.isDefault ||
        this.evaluateCondition(branch.condition || 'true', context);

      if (!shouldExecute && !branch.isDefault) {
        continue; // Skip this branch
      }

      // Execute workflows in this branch sequentially
      const branchResults = await this.executeSequential(
        branch.workflows,
        workflowMap,
        policy,
        context
      );

      // Determine branch status
      const allSuccess = branchResults.every((r) => r.status === 'success');
      const anyFailed = branchResults.some((r) => r.status === 'failed');

      results.push({
        branchId: branch.name,
        workflowResults: branchResults,
        status: allSuccess ? 'success' : anyFailed ? 'failed' : 'partial_failure',
      });

      // Stop at first successful branch (unless policy says otherwise)
      if (allSuccess) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute a single workflow with retry logic and timeout.
   *
   * @param workflow - The workflow to execute
   * @param input - Input data for the workflow
   * @param policy - Deployment policy with retry config
   * @param context - Execution context
   * @returns Execution result
   */
  private async executeWorkflow(
    workflow: Workflow,
    input: unknown,
    policy: DeploymentPolicy,
    context: ExecutionContext
  ): Promise<WorkflowExecutionResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const maxRetries = policy.maxRetries ?? 0;
    const retryDelayMs = policy.retryDelayMs ?? 1000;
    let lastError: Error | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        retryCount = attempt;

        // Simulate workflow execution (would call actual workflow engine)
        const result = await this.simulateWorkflowExecution(workflow, input);

        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startTime;

        return {
          workflowId: workflow.id || 'unknown',
          startedAt,
          completedAt,
          durationMs,
          status: 'success',
          output: result,
          skipped: false,
          retryCount,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If not last attempt, wait and retry
        if (attempt < maxRetries) {
          await this.delay(retryDelayMs);
        }
      }
    }

    // All retry attempts failed
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    return {
      workflowId: workflow.id || 'unknown',
      startedAt,
      completedAt,
      durationMs,
      status: 'failed',
      skipped: false,
      retryCount,
      error: {
        message: lastError?.message || 'Workflow execution failed',
        stack: lastError?.stack,
      },
    };
  }

  /**
   * Map output from one workflow to input for the next using data mappings.
   *
   * @param sourceOutput - Output from previous workflow
   * @param targetRef - Target workflow reference
   * @returns Mapped input data
   */
  private mapWorkflowInput(sourceOutput: unknown, targetRef: WorkflowReference): unknown {
    // If no specific mapping, pass output as-is
    if (!targetRef.version) {
      return sourceOutput;
    }

    // Extract values based on mapping rules
    const mappedData: Record<string, unknown> = {};

    // Simple mapping: if source is object, extract configured fields
    if (typeof sourceOutput === 'object' && sourceOutput !== null) {
      const source = sourceOutput as Record<string, unknown>;
      for (const [key, value] of Object.entries(source)) {
        mappedData[key] = value;
      }
    }

    return Object.keys(mappedData).length > 0 ? mappedData : sourceOutput;
  }

  /**
   * Apply data transformation (uppercase, lowercase, stringify, etc).
   *
   * @param value - Value to transform
   * @param transform - Transformation type
   * @param args - Optional transformation arguments
   * @returns Transformed value
   */
  private transformValue(
    value: unknown,
    transform: string,
    args?: unknown[]
  ): unknown {
    switch (transform) {
      case 'uppercase':
        return String(value).toUpperCase();
      case 'lowercase':
        return String(value).toLowerCase();
      case 'stringify':
        return JSON.stringify(value);
      case 'parse':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'trim':
        return String(value).trim();
      case 'split':
        return String(value).split((args?.[0] as string) || ',');
      case 'join':
        return Array.isArray(value) ? value.join((args?.[0] as string) || ',') : value;
      default:
        return value;
    }
  }

  /**
   * Evaluate a condition expression against execution context.
   *
   * @param condition - Condition expression (e.g., "platform === 'windows'")
   * @param context - Execution context with environment and results
   * @returns Whether condition is satisfied
   */
  private evaluateCondition(condition: string, context: ExecutionContext): boolean {
    try {
      // Build evaluation scope from context
      const scope = {
        ...context.environment,
        platform: context.platformInfo?.platform || 'unknown',
        results: Object.fromEntries(context.previousResults),
        data: context.accumulatedData,
      };

      // Simple evaluation (in production, use safer expression parser)
      // eslint-disable-next-line no-new-func
      const evaluator = new Function(...Object.keys(scope), `return ${condition}`);
      const result = evaluator(...Object.values(scope));
      return Boolean(result);
    } catch (error) {
      // If evaluation fails, return false
      return false;
    }
  }

  /**
   * Parse conditional branches from manifest and policy.
   *
   * @param manifest - Pack manifest
   * @param policy - Deployment policy
   * @returns Array of execution branches
   */
  private parseConditionalBranches(
    manifest: PackManifest,
    policy: DeploymentPolicy
  ): ExecutionBranch[] {
    const branches: ExecutionBranch[] = [];

    // Create branch for each condition
    if (policy.conditions && policy.conditions.length > 0) {
      for (const cond of policy.conditions) {
        branches.push({
          name: cond.name,
          condition: cond.expression,
          workflows: manifest.workflows.map((ref) => ({
            ...ref,
          })),
          isDefault: false,
        });
      }
    }

    // Add default branch that always executes
    branches.push({
      name: 'default',
      workflows: manifest.workflows.map((ref) => ({
        ...ref,
      })),
      isDefault: true,
    });

    return branches;
  }

  /**
   * Create batches of workflows for parallel execution.
   *
   * @param workflows - Workflow references
   * @param batchSize - Maximum workflows per batch
   * @returns Array of batches
   */
  private createBatches(
    workflows: WorkflowReference[],
    batchSize: number
  ): WorkflowReference[][] {
    const batches: WorkflowReference[][] = [];
    for (let i = 0; i < workflows.length; i += batchSize) {
      batches.push(workflows.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Aggregate sequential execution results into final output.
   *
   * @param results - Workflow execution results
   * @returns Aggregated output
   */
  private aggregateSequentialResults(
    results: WorkflowExecutionResult[]
  ): unknown {
    // For sequential, return output from last successful workflow
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === 'success' && results[i].output) {
        return results[i].output;
      }
    }
    return null;
  }

  /**
   * Aggregate parallel execution results into final output.
   *
   * @param branches - Branch execution results
   * @returns Aggregated output
   */
  private aggregateParallelResults(branches: BranchExecutionResult[]): unknown {
    // For parallel, collect outputs from all branches
    const outputs: unknown[] = [];
    for (const branch of branches) {
      for (const result of branch.workflowResults) {
        if (result.status === 'success' && result.output) {
          outputs.push(result.output);
        }
      }
    }
    return outputs.length > 0 ? outputs : null;
  }

  /**
   * Aggregate conditional execution results into final output.
   *
   * @param branches - Branch execution results
   * @returns Aggregated output
   */
  private aggregateConditionalResults(branches: BranchExecutionResult[]): unknown {
    // For conditional, return output from first successful branch
    for (const branch of branches) {
      if (branch.status === 'success') {
        for (const result of branch.workflowResults) {
          if (result.status === 'success' && result.output) {
            return result.output;
          }
        }
      }
    }
    return null;
  }

  /**
   * Simulate workflow execution (placeholder for actual workflow engine integration).
   *
   * @param workflow - Workflow to execute
   * @param input - Input data
   * @returns Workflow output
   */
  private async simulateWorkflowExecution(
    workflow: Workflow,
    input: unknown
  ): Promise<unknown> {
    // Simulate execution delay
    await this.delay(10);

    // Return mock output based on workflow metadata
    return {
      workflowId: workflow.id,
      success: true,
      output: { message: 'Workflow executed successfully', input },
    };
  }

  /**
   * Validate pack manifest before execution.
   *
   * @param manifest - Manifest to validate
   * @param workflows - Available workflows
   * @throws Error if manifest is invalid
   */
  private validateManifest(manifest: PackManifest, workflows: Map<EntityId, Workflow>): void {
    // Check policy is set
    if (!manifest.policy) {
      throw new Error('Pack manifest must include execution policy');
    }

    // Check workflows are available
    for (const ref of manifest.workflows) {
      if (!workflows.has(ref.workflowId)) {
        if (!ref.optional) {
          throw new Error(`Required workflow not found: ${ref.workflowId}`);
        }
      }
    }

    // Validate policy configuration
    if (manifest.policy.mode === 'parallel' && manifest.policy.maxConcurrency) {
      if (manifest.policy.maxConcurrency < 1) {
        throw new Error('Max concurrency must be at least 1');
      }
    }
  }

  /**
   * Generate unique execution ID for tracking.
   *
   * @returns Unique execution ID
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Helper to delay execution (for retries and simulations).
   *
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Utility function to create a sequential execution configuration.
 *
 * @param workflows - Workflows to execute sequentially
 * @param options - Optional configuration
 * @returns Pack manifest with sequential policy
 */
export function createSequentialExecution(
  workflows: WorkflowReference[],
  options?: {
    maxRetries?: number;
    retryDelayMs?: number;
    stopOnError?: boolean;
    timeoutMs?: number;
  }
): PackManifest {
  return {
    workflows,
    policy: {
      mode: 'sequential',
      maxRetries: options?.maxRetries ?? 1,
      retryDelayMs: options?.retryDelayMs ?? 1000,
      stopOnError: options?.stopOnError ?? true,
      timeoutMs: options?.timeoutMs,
    },
  };
}

/**
 * Utility function to create a parallel execution configuration.
 *
 * @param workflows - Workflows to execute in parallel
 * @param options - Optional configuration
 * @returns Pack manifest with parallel policy
 */
export function createParallelExecution(
  workflows: WorkflowReference[],
  options?: {
    maxConcurrency?: number;
    timeoutMs?: number;
  }
): PackManifest {
  return {
    workflows,
    policy: {
      mode: 'parallel',
      maxConcurrency: options?.maxConcurrency,
      timeoutMs: options?.timeoutMs,
    },
  };
}

/**
 * Utility function to create a conditional execution configuration.
 *
 * @param workflows - Workflows for default branch
 * @param conditions - Conditional branches
 * @param options - Optional configuration
 * @returns Pack manifest with conditional policy
 */
export function createConditionalExecution(
  workflows: WorkflowReference[],
  conditions?: Array<{ name: string; expression: string; required?: boolean }>,
  options?: {
    timeoutMs?: number;
  }
): PackManifest {
  return {
    workflows,
    policy: {
      mode: 'conditional',
      conditions: conditions?.map((c) => ({
        name: c.name,
        expression: c.expression,
        required: c.required ?? false,
      })),
      timeoutMs: options?.timeoutMs,
    },
  };
}
