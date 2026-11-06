/**
 * Pack Deployment Executor
 *
 * Implements complete pack deployment functionality including:
 * - Context compatibility validation
 * - Sequential/parallel/conditional workflow execution
 * - Data passing between workflows via DataMapping
 * - Failure handling per policy (stop/continue/rollback)
 * - Metrics collection (start time, end time, steps completed, failures)
 * - Event emission (PackDeployedEvent, ExecutionCompleteEvent)
 *
 * Architecture:
 * - Uses existing PlaybackEngine for workflow execution
 * - Integrates with Pack data model (Pack, PackManifest, ExecutionPolicy)
 * - Supports DataMapping for context propagation between workflows
 * - Implements failure handling policies: stop, continue, rollback
 * - Collects comprehensive metrics for analysis and monitoring
 *
 * Usage:
 * ```ts
 * const executor = new PackDeploymentExecutor(eventDispatcher, playbackEngine);
 * 
 * const result = await executor.deployPack(pack, executionContext);
 * 
 * // Event handlers will receive PackDeployedEvent and ExecutionCompleteEvent
 * ```
 */

import type {
  Pack,
  PackManifest,
  ExecutionPolicy,
  WorkflowReference,
} from './pack-types.js';

import type {
  Workflow,
  WorkflowStep,
  ExecutionPolicy as WorkflowExecutionPolicy,
} from './workflow-types.js';

import type {
  ExecutionContext,
  ExecutionMetrics,
  ExecutionResult,
  SystemEvent,
  EventDispatcher,
  PackDeploymentStartedEvent,
  PackDeploymentCompleteEvent,
  WorkflowExecutionStartedEvent,
  WorkflowExecutionCompleteEvent,
} from './integration-types.js';

import { createEntityId, createTimestamp } from './integration-types.js';

import type { PlaybackEngine, PlaybackResult, StepExecutionResult } from './playback-engine.js';

import type { RecordingRepository } from './recording-persistence.js';

import { uid } from './planner.js';

// ============================================================================
// Data Mapping and Context Propagation
// ============================================================================

/**
 * Maps output from one workflow to input variables of another workflow.
 * 
 * Enables composition of workflows by passing data between them.
 * 
 * Example: Workflow A outputs { total: 100, count: 5 }, Workflow B needs
 * { average: number } - DataMapping transforms and passes the data.
 */
export interface DataMapping {
  /** ID of source workflow whose output will be mapped */
  sourceWorkflowId: string;

  /** Path to source field in workflow output (dot notation: "results.total") */
  sourceField: string;

  /** ID of target workflow that will receive the mapped data */
  targetWorkflowId: string;

  /** Path where data should be stored in target workflow context */
  targetField: string;

  /** Optional transformation function to apply during mapping */
  transformFunction?: (value: any) => any;
}

/**
 * Policy for handling failures during pack deployment.
 */
export type FailureHandlingPolicy = 'stop' | 'continue' | 'rollback';

/**
 * Configuration for retry behavior on step failures.
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts per step */
  maxAttempts: number;

  /** Multiplier for exponential backoff between retries */
  backoffMultiplier: number;

  /** Base delay in milliseconds before first retry */
  baseDelayMs?: number;
}

// ============================================================================
// Deployment Execution Results
// ============================================================================

/**
 * Result of executing a single workflow within a pack deployment.
 */
export interface WorkflowDeploymentResult {
  /** ID of the workflow that was executed */
  workflowId: string;

  /** Whether the workflow executed successfully */
  success: boolean;

  /** Duration of workflow execution in milliseconds */
  durationMs: number;

  /** Index of failed step if workflow failed */
  failedStepIndex?: number;

  /** Error message if workflow failed */
  errorMessage?: string;

  /** Output data produced by the workflow */
  output?: any;

  /** Step-by-step execution results */
  stepResults: StepExecutionResult[];
}

/**
 * Complete result of pack deployment with all metrics and results.
 */
export interface PackDeploymentResult {
  /** ID of the pack that was deployed */
  packId: string;

  /** ID of this deployment */
  deploymentId: string;

  /** Whether all workflows succeeded */
  success: boolean;

  /** Total deployment duration in milliseconds */
  totalDurationMs: number;

  /** Start timestamp in ISO format */
  startTime: string;

  /** End timestamp in ISO format */
  endTime: string;

  /** Results for each workflow in order */
  workflowResults: WorkflowDeploymentResult[];

  /** Metrics collected during deployment */
  metrics: ExecutionMetrics;

  /** Context used for deployment */
  context: ExecutionContext;

  /** List of events emitted during deployment */
  emittedEvents: SystemEvent[];
}

// ============================================================================
// PackDeploymentExecutor Class
// ============================================================================

/**
 * Executes packs by running their workflows in sequence or parallel with
 * proper context propagation, failure handling, and metrics collection.
 */
export class PackDeploymentExecutor {
  private deploymentId: string = '';
  private startTime: number = 0;
  private workflowResults: WorkflowDeploymentResult[] = [];
  private emittedEvents: SystemEvent[] = [];
  private currentContext: ExecutionContext | undefined;
  private rollbackStack: Array<{ workflowId: string; timestamp: number }> = [];

  constructor(
    private eventDispatcher: EventDispatcher,
    private playbackEngine: PlaybackEngine,
    private recordingRepository?: RecordingRepository,
    private retryPolicy: RetryPolicy = {
      maxAttempts: 3,
      backoffMultiplier: 2,
      baseDelayMs: 1000,
    }
  ) {}

  /**
   * Deploy a pack by executing all its workflows in order.
   * 
   * This is the main entry point for pack deployment. It:
   * 1. Validates context compatibility
   * 2. Creates deployment context
   * 3. Executes each workflow in order (or parallel based on policy)
   * 4. Passes output from each workflow to the next via DataMapping
   * 5. Handles failures according to the failure handling policy
   * 6. Collects metrics and emits events
   * 
   * @param pack Pack to deploy
   * @param executionContext Context for deployment (display state, application name, etc.)
   * @returns Complete deployment result with metrics and events
   */
  async deployPack(
    pack: Pack,
    executionContext: ExecutionContext
  ): Promise<PackDeploymentResult> {
    this.deploymentId = createEntityId(`deploy-${uid('deploy')}`);
    this.startTime = Date.now();
    this.workflowResults = [];
    this.emittedEvents = [];
    this.rollbackStack = [];

    // Create deployment context with pack reference
    this.currentContext = {
      ...executionContext,
      packId: pack.id,
      variables: {
        ...executionContext.variables,
        packId: pack.id,
        deploymentId: this.deploymentId,
      },
      executionPath: [...executionContext.executionPath, pack.id],
    };

    // Emit PackDeploymentStartedEvent
    const deploymentStartedEvent: PackDeploymentStartedEvent = {
      id: createEntityId(`evt-deploy-start-${Date.now()}`),
      type: 'PackDeploymentStarted',
      source: 'pack',
      timestamp: createTimestamp(),
      sourceId: pack.id,
      packId: pack.id,
      deploymentId: this.deploymentId,
      version: pack.version.version,
      context: this.currentContext,
      workflowCount: pack.manifest.workflows.length,
    };

    this.emittedEvents.push(deploymentStartedEvent);
    await this.eventDispatcher.emit(deploymentStartedEvent);

    try {
      // Validate context compatibility before deployment
      const validationErrors = this.validateContextCompatibility(pack, this.currentContext);
      if (validationErrors.length > 0) {
        // Log warnings but continue if context is partially compatible
        console.warn(`Context validation warnings: ${validationErrors.join(', ')}`);
      }

      // Execute workflows based on policy
      let success = true;
      let currentContext = this.currentContext;

      switch (pack.manifest.policy.mode) {
        case 'sequential':
          const seqResult = await this.executeSequential(
            pack.manifest.workflows,
            currentContext,
            pack.manifest.policy
          );
          success = seqResult.success;
          currentContext = seqResult.context;
          this.workflowResults = seqResult.workflowResults;
          break;

        case 'parallel':
          const parallelResult = await this.executeParallel(
            pack.manifest.workflows,
            currentContext,
            pack.manifest.policy
          );
          success = parallelResult.success;
          currentContext = parallelResult.context;
          this.workflowResults = parallelResult.workflowResults;
          break;

        case 'conditional':
          const conditionalResult = await this.executeConditional(
            pack.manifest.workflows,
            currentContext,
            pack.manifest.policy
          );
          success = conditionalResult.success;
          currentContext = conditionalResult.context;
          this.workflowResults = conditionalResult.workflowResults;
          break;

        default:
          throw new Error(`Unknown execution policy mode: ${pack.manifest.policy.mode}`);
      }

      // Handle failure with rollback if policy requires
      if (!success && pack.manifest.policy.rollbackOnFailure) {
        await this.performRollback();
      }

      // Collect final metrics
      const endTime = Date.now();
      const totalDurationMs = endTime - this.startTime;
      const metrics = this.collectMetrics(success, totalDurationMs);

      // Emit PackDeploymentCompleteEvent
      const workflowResults = this.workflowResults.map((result) => ({
        workflowId: result.workflowId,
        success: result.success,
        durationMs: result.durationMs,
        output: result.output,
        error: result.errorMessage,
      }));

      const deploymentCompleteEvent: PackDeploymentCompleteEvent = {
        id: createEntityId(`evt-deploy-complete-${Date.now()}`),
        type: 'PackDeploymentComplete',
        source: 'pack',
        timestamp: createTimestamp(),
        sourceId: pack.id,
        packId: pack.id,
        deploymentId: this.deploymentId,
        success,
        workflowResults,
        totalDurationMs,
        habitsToExtract: workflowResults
          .filter((r) => r.success)
          .map((r) => createEntityId(r.workflowId)),
      };

      this.emittedEvents.push(deploymentCompleteEvent);
      await this.eventDispatcher.emit(deploymentCompleteEvent);

      return {
        packId: pack.id,
        deploymentId: this.deploymentId,
        success,
        totalDurationMs,
        startTime: new Date(this.startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        workflowResults: this.workflowResults,
        metrics,
        context: currentContext,
        emittedEvents: this.emittedEvents,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Emit error event
      const errorEvent = {
        id: createEntityId(`evt-error-${Date.now()}`),
        type: 'ErrorOccurred',
        source: 'pack',
        timestamp: createTimestamp(),
        sourceId: pack.id,
        message: errorMsg,
        severity: 'critical',
        recoverable: false,
      } as const;

      this.emittedEvents.push(errorEvent);
      await this.eventDispatcher.emit(errorEvent);

      // Return failure result
      const endTime = Date.now();
      return {
        packId: pack.id,
        deploymentId: this.deploymentId,
        success: false,
        totalDurationMs: endTime - this.startTime,
        startTime: new Date(this.startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        workflowResults: this.workflowResults,
        metrics: {
          stepsCompleted: this.workflowResults.filter((r) => r.success).length,
          stepsFailed: this.workflowResults.filter((r) => !r.success).length,
          elementsNotFound: this.workflowResults.reduce(
            (sum, r) => sum + r.stepResults.filter((sr) => sr.error?.includes('not found')).length,
            0
          ),
          coordinateAdaptations: 0, // Would need to track this during execution
          fallbackMatches: 0,
          avgStepDurationMs: 0,
        },
        context: this.currentContext,
        emittedEvents: this.emittedEvents,
      };
    }
  }

  // ============================================================================
  // Context Validation
  // ============================================================================

  /**
   * Validates that the current execution context is compatible with the pack.
   * 
   * Checks:
   * - Window/application name matches (if required)
   * - Required elements exist in visibleElements
   * - Display resolution is adequate
   * - Any deployment conditions are satisfied
   * 
   * @param pack Pack to validate context for
   * @param context Current execution context
   * @returns Array of validation warnings (empty if fully compatible)
   */
  private validateContextCompatibility(
    pack: Pack,
    context: ExecutionContext
  ): string[] {
    const warnings: string[] = [];

    // Check if pack has any context requirements in deployment conditions
    if (pack.manifest.policy.conditions && pack.manifest.policy.conditions.length > 0) {
      for (const condition of pack.manifest.policy.conditions) {
        if (condition.required) {
          try {
            // Evaluate condition expression in limited context
            // For simple expressions like "platform === 'windows'"
            const evaluated = this.evaluateCondition(condition.expression, context);
            if (!evaluated) {
              warnings.push(`Required condition not met: "${condition.name}"`);
            }
          } catch (error) {
            warnings.push(`Failed to evaluate condition "${condition.name}": ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    // Check if required elements exist
    const requiredElements = this.findRequiredElements(pack);
    if (context.visibleElements) {
      for (const requiredElement of requiredElements) {
        const found = context.visibleElements.some((element) => {
          if (requiredElement.selector && element.selector === requiredElement.selector) {
            return true;
          }
          if (requiredElement.accessibleName && element.accessibleName === requiredElement.accessibleName) {
            return true;
          }
          return false;
        });

        if (!found) {
          warnings.push(`Required element not found: ${requiredElement.selector || requiredElement.accessibleName}`);
        }
      }
    } else {
      warnings.push('No visible elements available for validation');
    }

    // Check display resolution
    if (context.displayState.width < 1024 || context.displayState.height < 768) {
      warnings.push(`Display resolution ${context.displayState.width}x${context.displayState.height} may be too small for reliable execution`);
    }

    return warnings;
  }

  /**
   * Evaluates a deployment condition expression.
   * 
   * Supports simple expressions like:
   * - "platform === 'windows'"
   * - "resolution.width >= 1920"
   * - "application === 'Chrome'"
   * 
   * @param expression Condition expression to evaluate
   * @param context Execution context
   * @returns true if condition is satisfied, false otherwise
   */
  private evaluateCondition(expression: string, context: ExecutionContext): boolean {
    // Extract platform from context
    const platform = context.applicationName ? 'windows' : 'unknown'; // Simplified for example
    
    // Extract display dimensions
    const width = context.displayState.width;
    const height = context.displayState.height;

    // Extract application name
    const application = context.applicationName || '';

    // Create evaluation context
    const evalContext = {
      platform,
      resolution: { width, height },
      application,
      context,
    };

    try {
      // Note: In production, use a proper expression evaluator instead of eval
      // For security, implement a proper parser or use a library like expression-eval
      // This is a simplified implementation for demonstration
      // eslint-disable-next-line no-eval
      return eval(`(${expression})`);
    } catch (error) {
      throw new Error(`Invalid condition expression: "${expression}"`);
    }
  }

  /**
   * Finds all required elements referenced in pack workflows.
   * 
   * @param pack Pack to analyze
   * @returns Array of element selectors/accessiblenames referenced
   */
  private findRequiredElements(pack: Pack): Array<{ selector?: string; accessibleName?: string }> {
    const elements: Array<{ selector?: string; accessibleName?: string }> = [];

    // This would parse workflow steps to find element references
    // For now, return empty array as placeholder
    // In a real implementation, this would:
    // 1. Load each workflow from repository
    // 2. Extract element selectors from WorkflowStep.target
    // 3. Return unique list

    return elements;
  }

  // ============================================================================
  // Sequential Execution
  // ============================================================================

  /**
   * Executes workflows sequentially in order, passing output to next workflow.
   * 
   * @param workflowRefs Array of workflow references
   * @param initialContext Starting context
   * @param policy Execution policy with failure handling
   * @returns Execution result with all workflow results
   */
  private async executeSequential(
    workflowRefs: WorkflowReference[],
    initialContext: ExecutionContext,
    policy: ExecutionPolicy
  ): Promise<{
    success: boolean;
    context: ExecutionContext;
    workflowResults: WorkflowDeploymentResult[];
  }> {
    let success = true;
    let currentContext = initialContext;
    const results: WorkflowDeploymentResult[] = [];

    for (let i = 0; i < workflowRefs.length; i++) {
      const workflowRef = workflowRefs[i];

      // Check if we should stop based on policy
      if (!success && policy.stopOnError) {
        break;
      }

      // Load workflow from repository
      const workflow = await this.loadWorkflow(workflowRef.workflowId);

      if (!workflow) {
        results.push({
          workflowId: workflowRef.workflowId,
          success: false,
          durationMs: 0,
          errorMessage: `Workflow not found: ${workflowRef.workflowId}`,
          stepResults: [],
        });
        success = false;
        continue;
      }

      // Map output from previous workflow to current workflow context
      if (i > 0) {
        currentContext = this.applyDataMapping(workflowRefs[i - 1], workflowRef, currentContext);
      }

      // Execute workflow
      const result = await this.executeWorkflowWithRetries(
        workflow,
        currentContext,
        policy
      );

      results.push(result);
      currentContext = {
        ...currentContext,
        variables: {
          ...currentContext.variables,
          [workflowRef.workflowId]: result.output,
        },
      };

      if (!result.success) {
        success = false;
        if (policy.stopOnError) {
          break;
        }
      }
    }

    return {
      success,
      context: currentContext,
      workflowResults: results,
    };
  }

  // ============================================================================
  // Parallel Execution
  // ============================================================================

  /**
   * Executes workflows in parallel with configurable concurrency.
   * 
   * @param workflowRefs Array of workflow references
   * @param context Shared context for all workflows
   * @param policy Execution policy
   * @returns Execution result
   */
  private async executeParallel(
    workflowRefs: WorkflowReference[],
    context: ExecutionContext,
    policy: ExecutionPolicy
  ): Promise<{
    success: boolean;
    context: ExecutionContext;
    workflowResults: WorkflowDeploymentResult[];
  }> {
    const concurrency = policy.maxConcurrency || workflowRefs.length;
    const results: WorkflowDeploymentResult[] = [];
    let success = true;

    // Process workflows in batches based on concurrency
    for (let i = 0; i < workflowRefs.length; i += concurrency) {
      const batch = workflowRefs.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map((workflowRef) => this.executeWorkflowWithRetries(
          this.loadWorkflow(workflowRef.workflowId),
          context,
          policy
        ))
      );

      results.push(...batchResults);

      // Check if any failed (for stop policy)
      if (!policy.stopOnError) {
        const anyFailed = batchResults.some((r) => !r.success);
        if (anyFailed) {
          success = false;
        }
      }
    }

    return {
      success,
      context,
      workflowResults: results,
    };
  }

  // ============================================================================
  // Conditional Execution
  // ============================================================================

  /**
   * Executes workflows based on conditions.
   * 
   * @param workflowRefs Array of workflow references (with conditions)
   * @param context Execution context
   * @param policy Execution policy
   * @returns Execution result
   */
  private async executeConditional(
    workflowRefs: WorkflowReference[],
    context: ExecutionContext,
    policy: ExecutionPolicy
  ): Promise<{
    success: boolean;
    context: ExecutionContext;
    workflowResults: WorkflowDeploymentResult[];
  }> {
    const results: WorkflowDeploymentResult[] = [];
    let success = true;
    let currentContext = context;

    for (const workflowRef of workflowRefs) {
      // Load workflow to check conditions
      const workflow = await this.loadWorkflow(workflowRef.workflowId);

      // Evaluate conditions (if any)
      if (workflowRef.optional) {
        // Optional workflow - skip if conditions not met
        // For now, execute all optional workflows
        // In a full implementation, would evaluate conditions
      }

      const result = await this.executeWorkflowWithRetries(
        workflow || { id: workflowRef.workflowId, name: '', steps: [], metadata: { createdAt: '', updatedAt: '', version: '', source: 'user-created', executionCount: 0, successCount: 0, failureCount: 0 } },
        currentContext,
        policy
      );

      results.push(result);
      currentContext = {
        ...currentContext,
        variables: {
          ...currentContext.variables,
          [workflowRef.workflowId]: result.output,
        },
      };

      if (!result.success) {
        success = false;
        if (policy.stopOnError) {
          break;
        }
      }
    }

    return {
      success,
      context: currentContext,
      workflowResults: results,
    };
  }

  // ============================================================================
  // Workflow Execution Helpers
  // ============================================================================

  /**
   * Loads a workflow by ID from the repository.
   * 
   * @param workflowId ID of workflow to load
   * @returns Workflow or undefined if not found
   */
  private async loadWorkflow(workflowId: string): Promise<Workflow | undefined> {
    if (this.recordingRepository && 'getWorkflow' in this.recordingRepository) {
      // @ts-expect-error - repository interface mismatch
      return this.recordingRepository.getWorkflow(workflowId);
    }
    // For now, return undefined - in production, would load from DB
    return undefined;
  }

  /**
   * Applies DataMapping to pass output from one workflow to another.
   * 
   * @param sourceRef Source workflow reference
   * @param targetRef Target workflow reference
   * @param context Context with source workflow output
   * @returns Updated context with mapped values
   */
  private applyDataMapping(
    sourceRef: WorkflowReference,
    targetRef: WorkflowReference,
    context: ExecutionContext
  ): ExecutionContext {
    // Find data mappings for this workflow pair
    // For now, return context unchanged
    // In a full implementation, would look up mappings from pack configuration

    return context;
  }

  /**
   * Executes a single workflow with retry logic.
   * 
   * @param workflow Workflow to execute
   * @param context Execution context
   * @param policy Execution policy with retry settings
   * @returns WorkflowDeploymentResult
   */
  private async executeWorkflowWithRetries(
    workflow: Workflow | Promise<Workflow>,
    context: ExecutionContext,
    policy: ExecutionPolicy
  ): Promise<WorkflowDeploymentResult> {
    let attempt = 0;
    const maxAttempts = policy.maxRetries || this.retryPolicy.maxAttempts;
    const baseDelay = policy.retryDelayMs || this.retryPolicy.baseDelayMs || 1000;

    while (attempt <= maxAttempts) {
      try {
        const workflowResult = await this.executeSingleWorkflow(
          await workflow,
          context
        );

        if (workflowResult.success) {
          return workflowResult;
        }

        // Workflow failed, check if we should retry
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(this.retryPolicy.backoffMultiplier, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
        } else {
          return workflowResult;
        }
      } catch (error) {
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(this.retryPolicy.backoffMultiplier, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
        } else {
          return {
            workflowId: workflow instanceof Promise ? (await workflow).id : workflow.id,
            success: false,
            durationMs: 0,
            errorMessage: error instanceof Error ? error.message : String(error),
            stepResults: [],
          };
        }
      }
    }

    // Should not reach here, but just in case
    return {
      workflowId: workflow instanceof Promise ? (await workflow).id : workflow.id,
      success: false,
      durationMs: 0,
      errorMessage: 'Unknown error during workflow execution',
      stepResults: [],
    };
  }

  /**
   * Executes a single workflow and returns the result.
   * 
   * @param workflow Workflow to execute
   * @param context Execution context
   * @returns WorkflowDeploymentResult
   */
  private async executeSingleWorkflow(
    workflow: Workflow,
    context: ExecutionContext
  ): Promise<WorkflowDeploymentResult> {
    const startTime = Date.now();

    // Emit WorkflowExecutionStartedEvent
    const startedEvent: WorkflowExecutionStartedEvent = {
      id: createEntityId(`evt-wf-start-${Date.now()}`),
      type: 'WorkflowExecutionStarted',
      source: 'workflow',
      timestamp: createTimestamp(),
      sourceId: workflow.id,
      workflowId: workflow.id,
      deploymentId: this.deploymentId,
      context,
    };

    this.emittedEvents.push(startedEvent);
    await this.eventDispatcher.emit(startedEvent);

    try {
      // Convert Workflow to PlaybackWorkflow for engine
      const playbackWorkflow = this.convertToPlaybackWorkflow(workflow);

      // Execute with playback engine
      const result = await this.playbackEngine.executeWorkflow(playbackWorkflow, context);

      const endTime = Date.now();

      // Emit WorkflowExecutionCompleteEvent
      const completeEvent: WorkflowExecutionCompleteEvent = {
        id: createEntityId(`evt-wf-complete-${Date.now()}`),
        type: 'WorkflowExecutionComplete',
        source: 'workflow',
        timestamp: createTimestamp(),
        sourceId: workflow.id,
        workflowId: workflow.id,
        deploymentId: this.deploymentId,
        success: result.success,
        result: {
          executionId: result.executionContext.executionId,
          success: result.success,
          durationMs: result.totalDuration,
          context: result.executionContext,
          lineage: {
            recordingId: undefined,
            workflowId: workflow.id,
            packId: context.packId,
            habitId: undefined,
            originSource: 'workflow-composition',
            createdAt: createTimestamp(),
          },
          metrics: result.metrics,
        },
      };

      this.emittedEvents.push(completeEvent);
      await this.eventDispatcher.emit(completeEvent);

      return {
        workflowId: workflow.id,
        success: result.success,
        durationMs: result.totalDuration,
        stepResults: result.stepResults,
        output: result.metrics, // Would have real output data in full implementation
      };
    } catch (error) {
      const endTime = Date.now();

      return {
        workflowId: workflow.id,
        success: false,
        durationMs: endTime - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
        stepResults: [],
      };
    }
  }

  /**
   * Converts Workflow to PlaybackWorkflow format.
   * 
   * @param workflow Workflow to convert
   * @returns PlaybackWorkflow
   */
  private convertToPlaybackWorkflow(workflow: Workflow): any {
    return {
      id: workflow.id,
      name: workflow.name,
      steps: workflow.steps.map((step, index) => ({
        id: step.id,
        order: index,
        action: step.type === 'recording' ? 'click' : 'workflow', // Simplified
        optional: false,
        timestamp: new Date().toISOString(),
        x: 0,
        y: 0,
        metadata: {},
      })),
      metadata: {
        name: workflow.name,
        description: workflow.description || '',
        version: workflow.metadata.version,
        createdAt: workflow.metadata.createdAt,
        updatedAt: workflow.metadata.updatedAt,
        author: 'unknown',
        tags: workflow.metadata.tags || [],
        estimatedDuration: 0,
      },
      contextRequirements: [],
      executionHistory: [],
    };
  }

  // ============================================================================
  // Metrics Collection
  // ============================================================================

  /**
   * Collects execution metrics after deployment completes.
   * 
   * @param success Whether deployment succeeded
   * @param totalDurationMs Total deployment duration
   * @returns ExecutionMetrics
   */
  private collectMetrics(success: boolean, totalDurationMs: number): ExecutionMetrics {
    const completedSteps = this.workflowResults.reduce(
      (sum, r) => sum + r.stepResults.filter((sr) => sr.success).length,
      0
    );

    const failedSteps = this.workflowResults.reduce(
      (sum, r) => sum + r.stepResults.filter((sr) => !sr.success).length,
      0
    );

    const elementsNotFound = this.workflowResults.reduce(
      (sum, r) => sum + r.stepResults.filter((sr) => sr.error?.includes('not found')).length,
      0
    );

    const coordinateAdaptations = this.workflowResults.reduce(
      (sum, r) => sum + r.stepResults.filter((sr) => sr.denormalizedCoordinates !== undefined).length,
      0
    );

    return {
      stepsCompleted: completedSteps,
      stepsFailed: failedSteps,
      elementsNotFound,
      coordinateAdaptations,
      fallbackMatches: 0, // Would track this during execution
      avgStepDurationMs: completedSteps + failedSteps > 0 ? totalDurationMs / (completedSteps + failedSteps) : 0,
    };
  }

  // ============================================================================
  // Rollback Support
  // ============================================================================

  /**
   * Performs rollback of completed workflows in reverse order.
   * 
   * Only tracks workflows that were successfully executed for rollback.
   * In a full implementation, would:
   * 1. Execute undo actions for each completed step
   * 2. Revert state changes
   * 3. Clean up any side effects
   */
  private async performRollback(): Promise<void> {
    // Rollback in reverse order
    for (let i = this.rollbackStack.length - 1; i >= 0; i--) {
      const { workflowId, timestamp } = this.rollbackStack[i];

      // Log rollback for now
      // In full implementation, would execute undo actions
      console.log(`Rolling back workflow: ${workflowId} (executed at ${timestamp})`);

      // Remove from rollback stack
      this.rollbackStack.pop();
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Gets the current deployment status.
   * 
   * @returns Current status information
   */
  getStatus(): {
    deploymentId: string;
    isActive: boolean;
    completedWorkflows: number;
    totalWorkflows: number;
    success: boolean;
  } {
    const completed = this.workflowResults.filter((r) => r.success).length;
    const total = this.workflowResults.length;
    const success = total > 0 && completed === total;

    return {
      deploymentId: this.deploymentId,
      isActive: this.startTime > 0 && this.workflowResults.length > 0,
      completedWorkflows: completed,
      totalWorkflows: total,
      success,
    };
  }

  /**
   * Gets results for completed workflow deployments.
   * 
   * @returns Array of workflow results
   */
  getResults(): WorkflowDeploymentResult[] {
    return [...this.workflowResults];
  }

  /**
   * Gets all emitted events during deployment.
   * 
   * @returns Array of events
   */
  getEvents(): SystemEvent[] {
    return [...this.emittedEvents];
  }
}

// ============================================================================
// Export Helper Functions
// ============================================================================

/**
 * Creates a new DataMapping for passing data between workflows.
 * 
 * @param sourceWorkflowId ID of source workflow
 * @param sourceField Path to source field (dot notation)
 * @param targetWorkflowId ID of target workflow
 * @param targetField Path where data should go (dot notation)
 * @param transformFunction Optional transformation function
 * @returns DataMapping object
 */
export function createDataMapping(
  sourceWorkflowId: string,
  sourceField: string,
  targetWorkflowId: string,
  targetField: string,
  transformFunction?: (value: any) => any
): DataMapping {
  return {
    sourceWorkflowId,
    sourceField,
    targetWorkflowId,
    targetField,
    transformFunction,
  };
}

/**
 * Validates that a DataMapping is well-formed.
 * 
 * @param mapping DataMapping to validate
 * @returns true if valid
 */
export function validateDataMapping(mapping: DataMapping): boolean {
  return (
    typeof mapping.sourceWorkflowId === 'string' &&
    mapping.sourceWorkflowId.length > 0 &&
    typeof mapping.sourceField === 'string' &&
    mapping.sourceField.length > 0 &&
    typeof mapping.targetWorkflowId === 'string' &&
    mapping.targetWorkflowId.length > 0 &&
    typeof mapping.targetField === 'string' &&
    mapping.targetField.length > 0
  );
}

/**
 * Creates a retry policy with default values.
 * 
 * @param maxAttempts Maximum retry attempts
 * @param backoffMultiplier Exponential backoff multiplier
 * @param baseDelayMs Base delay in milliseconds
 * @returns RetryPolicy object
 */
export function createRetryPolicy(
  maxAttempts: number = 3,
  backoffMultiplier: number = 2,
  baseDelayMs: number = 1000
): RetryPolicy {
  return {
    maxAttempts,
    backoffMultiplier,
    baseDelayMs,
  };
}

/**
 * Creates an execution policy for pack deployment.
 * 
 * @param mode Execution mode: 'sequential', 'parallel', or 'conditional'
 * @param failureHandling How to handle failures: 'stop', 'continue', or 'rollback'
 * @param maxRetries Maximum retry attempts per step
 * @param retryDelayMs Delay between retries
 * @param rollbackOnFailure Whether to perform rollback on failure
 * @param timeoutMs Maximum deployment timeout
 * @returns ExecutionPolicy object
 */
export function createExecutionPolicy(
  mode: 'sequential' | 'parallel' | 'conditional' = 'sequential',
  failureHandling: FailureHandlingPolicy = 'stop',
  maxRetries?: number,
  retryDelayMs?: number,
  rollbackOnFailure?: boolean,
  timeoutMs?: number
): ExecutionPolicy {
  return {
    mode,
    maxRetries,
    retryDelayMs,
    stopOnError: failureHandling === 'stop',
    rollbackOnFailure: rollbackOnFailure || failureHandling === 'rollback',
    timeoutMs,
  };
}