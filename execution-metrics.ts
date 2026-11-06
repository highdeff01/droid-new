/**
 * Pack Execution Metrics Collection
 * Tracks workflow and pack deployment metrics including timing, success rates, and adaptations.
 * 
 * Requirements: 9.5, 25.5
 */

/** Unique identifier for an execution. */
export type ExecutionId = string & { readonly __brand: 'ExecutionId' };

/** Unique identifier for a workflow step. */
export type StepId = string & { readonly __brand: 'StepId' };

/** Unique identifier for a pack. */
export type PackId = string & { readonly __brand: 'PackId' };

/**
 * Status of a step execution.
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'adapted';

/**
 * Status of a workflow execution.
 */
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

/**
 * Status of a pack execution.
 */
export type PackStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial' | 'cancelled';

/**
 * Reason for step failure or issue.
 */
export type FailureReason =
  | 'element-not-found'
  | 'coordinate-out-of-bounds'
  | 'timeout'
  | 'action-failed'
  | 'context-mismatch'
  | 'adaptation-failed'
  | 'user-cancelled'
  | 'unknown';

/**
 * Metrics for a single step execution.
 */
export interface StepMetrics {
  id: StepId;
  index: number;
  name: string;
  action: string;
  status: StepStatus;
  
  // Timing
  startedAt: number;  // timestamp
  completedAt: number | null;
  durationMs: number;
  
  // Execution details
  targetElement?: string;
  targetCoordinates?: { x: number; y: number };
  
  // Adaptation tracking
  adapted: boolean;
  adaptationReason?: string;
  adaptationScaleFactor?: number;
  coordinateAdaptationDist?: number;  // distance adapted (normalized)
  
  // Errors
  error: FailureReason | null;
  errorDetail?: string;
  
  // Confidence and retries
  confidence: number;  // 0..1
  retryCount: number;
  retryLimitReached: boolean;
}

/**
 * Metrics for a workflow execution.
 */
export interface WorkflowMetrics {
  id: ExecutionId;
  workflowId: string;
  workflowName: string;
  status: WorkflowStatus;
  
  // Timing
  startedAt: number;
  completedAt: number | null;
  durationMs: number;
  
  // Step tracking
  steps: StepMetrics[];
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  adaptedSteps: number;
  
  // Context information
  sourceDisplay?: { width: number; height: number };
  targetDisplay?: { width: number; height: number };
  displayAdaptationRequired: boolean;
  
  // Overall success metrics
  successRate: number;  // 0..1
  averageStepDuration: number;
  averageConfidence: number;  // 0..1
  
  // Errors
  error: FailureReason | null;
  errorDetail?: string;
}

/**
 * Metrics for a pack execution (may contain multiple workflows).
 */
export interface PackMetrics {
  id: ExecutionId;
  packId: PackId;
  packName: string;
  packVersion: string;
  status: PackStatus;
  
  // Timing
  startedAt: number;
  completedAt: number | null;
  durationMs: number;
  
  // Workflow tracking
  workflows: WorkflowMetrics[];
  totalWorkflows: number;
  completedWorkflows: number;
  failedWorkflows: number;
  
  // Aggregated metrics
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  adaptedSteps: number;
  
  // Overall success metrics
  successRate: number;  // 0..1
  averageWorkflowDuration: number;
  averageStepDuration: number;
  averageConfidence: number;  // 0..1
  
  // Adaptation summary
  adaptationCount: number;
  averageAdaptationScaleFactor: number;
  
  // Errors
  error: FailureReason | null;
  errorDetail?: string;
  
  // Execution policy
  executionPolicy: 'sequential' | 'parallel' | 'conditional';
  
  // Data passed between workflows
  dataMapping?: Record<string, unknown>;
}

/**
 * Statistics aggregated over many executions.
 */
export interface ExecutionStatistics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  partialExecutions: number;
  cancelledExecutions: number;
  
  totalDurationMs: number;
  averageDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  adaptedSteps: number;
  
  overallSuccessRate: number;  // 0..1
  overallConfidence: number;   // 0..1
  
  failureReasons: Record<FailureReason, number>;
  
  // Adaptation statistics
  totalAdaptations: number;
  averageAdaptationScaleFactor: number;
  maxAdaptationScaleFactor: number;
  minAdaptationScaleFactor: number;
}

/**
 * Builder for step metrics.
 */
export class StepMetricsBuilder {
  private data: Partial<StepMetrics> = {
    status: 'pending',
    error: null,
    adapted: false,
    retryCount: 0,
    retryLimitReached: false,
    confidence: 0,
    durationMs: 0,
  };

  setId(id: StepId): this {
    this.data.id = id;
    return this;
  }

  setIndex(index: number): this {
    this.data.index = index;
    return this;
  }

  setName(name: string): this {
    this.data.name = name;
    return this;
  }

  setAction(action: string): this {
    this.data.action = action;
    return this;
  }

  setStatus(status: StepStatus): this {
    this.data.status = status;
    return this;
  }

  setStartedAt(time: number): this {
    this.data.startedAt = time;
    return this;
  }

  setCompletedAt(time: number | null): this {
    this.data.completedAt = time;
    if (this.data.startedAt && time) {
      this.data.durationMs = time - this.data.startedAt;
    }
    return this;
  }

  setTarget(element: string, coords?: { x: number; y: number }): this {
    this.data.targetElement = element;
    this.data.targetCoordinates = coords;
    return this;
  }

  setAdapted(adapted: boolean, reason?: string, scale?: number, dist?: number): this {
    this.data.adapted = adapted;
    this.data.adaptationReason = reason;
    this.data.adaptationScaleFactor = scale;
    this.data.coordinateAdaptationDist = dist;
    return this;
  }

  setError(error: FailureReason | null, detail?: string): this {
    this.data.error = error;
    this.data.errorDetail = detail;
    return this;
  }

  setConfidence(confidence: number): this {
    this.data.confidence = Math.max(0, Math.min(1, confidence));
    return this;
  }

  setRetries(count: number, limitReached: boolean): this {
    this.data.retryCount = count;
    this.data.retryLimitReached = limitReached;
    return this;
  }

  build(): StepMetrics {
    if (!this.data.id || !this.data.name || !this.data.action) {
      throw new Error('StepMetrics missing required fields: id, name, action');
    }
    if (this.data.startedAt === undefined) {
      throw new Error('StepMetrics missing required field: startedAt');
    }
    return this.data as StepMetrics;
  }
}

/**
 * Builder for workflow metrics.
 */
export class WorkflowMetricsBuilder {
  private data: Partial<WorkflowMetrics> = {
    steps: [],
    totalSteps: 0,
    completedSteps: 0,
    failedSteps: 0,
    skippedSteps: 0,
    adaptedSteps: 0,
    displayAdaptationRequired: false,
    successRate: 0,
    averageStepDuration: 0,
    averageConfidence: 0,
    error: null,
  };

  setId(id: ExecutionId): this {
    this.data.id = id;
    return this;
  }

  setWorkflowId(id: string): this {
    this.data.workflowId = id;
    return this;
  }

  setWorkflowName(name: string): this {
    this.data.workflowName = name;
    return this;
  }

  setStatus(status: WorkflowStatus): this {
    this.data.status = status;
    return this;
  }

  setStartedAt(time: number): this {
    this.data.startedAt = time;
    return this;
  }

  setCompletedAt(time: number | null): this {
    this.data.completedAt = time;
    if (this.data.startedAt && time) {
      this.data.durationMs = time - this.data.startedAt;
    }
    return this;
  }

  addStep(step: StepMetrics): this {
    if (!this.data.steps) {
      this.data.steps = [];
    }
    this.data.steps.push(step);
    this.updateAggregates();
    return this;
  }

  setDisplays(source?: { width: number; height: number }, target?: { width: number; height: number }): this {
    this.data.sourceDisplay = source;
    this.data.targetDisplay = target;
    this.data.displayAdaptationRequired = !!(source && target && (source.width !== target.width || source.height !== target.height));
    return this;
  }

  setError(error: FailureReason | null, detail?: string): this {
    this.data.error = error;
    this.data.errorDetail = detail;
    return this;
  }

  private updateAggregates(): void {
    if (!this.data.steps || this.data.steps.length === 0) {
      return;
    }

    const steps = this.data.steps;
    this.data.totalSteps = steps.length;
    this.data.completedSteps = steps.filter((s) => s.status === 'completed').length;
    this.data.failedSteps = steps.filter((s) => s.status === 'failed').length;
    this.data.skippedSteps = steps.filter((s) => s.status === 'skipped').length;
    this.data.adaptedSteps = steps.filter((s) => s.adapted).length;

    // Calculate success rate
    const successfulSteps = this.data.completedSteps + this.data.skippedSteps;
    this.data.successRate = this.data.totalSteps > 0 ? successfulSteps / this.data.totalSteps : 0;

    // Calculate average duration
    const completedSteps = steps.filter((s) => s.status === 'completed' || s.status === 'failed');
    this.data.averageStepDuration = completedSteps.length > 0 ? completedSteps.reduce((sum, s) => sum + s.durationMs, 0) / completedSteps.length : 0;

    // Calculate average confidence
    this.data.averageConfidence = steps.length > 0 ? steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length : 0;
  }

  build(): WorkflowMetrics {
    if (!this.data.id || !this.data.workflowId || !this.data.workflowName) {
      throw new Error('WorkflowMetrics missing required fields: id, workflowId, workflowName');
    }
    if (this.data.startedAt === undefined) {
      throw new Error('WorkflowMetrics missing required field: startedAt');
    }
    return this.data as WorkflowMetrics;
  }
}

/**
 * Builder for pack metrics.
 */
export class PackMetricsBuilder {
  private data: Partial<PackMetrics> = {
    workflows: [],
    totalWorkflows: 0,
    completedWorkflows: 0,
    failedWorkflows: 0,
    totalSteps: 0,
    completedSteps: 0,
    failedSteps: 0,
    adaptedSteps: 0,
    successRate: 0,
    averageWorkflowDuration: 0,
    averageStepDuration: 0,
    averageConfidence: 0,
    adaptationCount: 0,
    averageAdaptationScaleFactor: 1,
    error: null,
    executionPolicy: 'sequential',
  };

  setId(id: ExecutionId): this {
    this.data.id = id;
    return this;
  }

  setPackId(id: PackId): this {
    this.data.packId = id;
    return this;
  }

  setPackName(name: string): this {
    this.data.packName = name;
    return this;
  }

  setPackVersion(version: string): this {
    this.data.packVersion = version;
    return this;
  }

  setStatus(status: PackStatus): this {
    this.data.status = status;
    return this;
  }

  setStartedAt(time: number): this {
    this.data.startedAt = time;
    return this;
  }

  setCompletedAt(time: number | null): this {
    this.data.completedAt = time;
    if (this.data.startedAt && time) {
      this.data.durationMs = time - this.data.startedAt;
    }
    return this;
  }

  addWorkflow(workflow: WorkflowMetrics): this {
    if (!this.data.workflows) {
      this.data.workflows = [];
    }
    this.data.workflows.push(workflow);
    this.updateAggregates();
    return this;
  }

  setExecutionPolicy(policy: 'sequential' | 'parallel' | 'conditional'): this {
    this.data.executionPolicy = policy;
    return this;
  }

  setDataMapping(mapping: Record<string, unknown>): this {
    this.data.dataMapping = mapping;
    return this;
  }

  setError(error: FailureReason | null, detail?: string): this {
    this.data.error = error;
    this.data.errorDetail = detail;
    return this;
  }

  private updateAggregates(): void {
    if (!this.data.workflows || this.data.workflows.length === 0) {
      return;
    }

    const workflows = this.data.workflows;
    this.data.totalWorkflows = workflows.length;
    this.data.completedWorkflows = workflows.filter((w) => w.status === 'completed').length;
    this.data.failedWorkflows = workflows.filter((w) => w.status === 'failed').length;

    // Aggregate step metrics
    this.data.totalSteps = workflows.reduce((sum, w) => sum + w.totalSteps, 0);
    this.data.completedSteps = workflows.reduce((sum, w) => sum + w.completedSteps, 0);
    this.data.failedSteps = workflows.reduce((sum, w) => sum + w.failedSteps, 0);
    this.data.adaptedSteps = workflows.reduce((sum, w) => sum + w.adaptedSteps, 0);

    // Calculate overall success rate
    this.data.successRate = this.data.totalSteps > 0 ? this.data.completedSteps / this.data.totalSteps : 0;

    // Calculate average workflow duration
    this.data.averageWorkflowDuration = workflows.length > 0 ? workflows.reduce((sum, w) => sum + w.durationMs, 0) / workflows.length : 0;

    // Calculate average step duration
    const completedSteps = workflows.reduce((sum, w) => sum + (w.averageStepDuration * w.completedSteps), 0);
    this.data.averageStepDuration = this.data.completedSteps > 0 ? completedSteps / this.data.completedSteps : 0;

    // Calculate average confidence
    this.data.averageConfidence = workflows.length > 0 ? workflows.reduce((sum, w) => sum + w.averageConfidence, 0) / workflows.length : 0;

    // Calculate adaptation statistics
    this.data.adaptationCount = this.data.adaptedSteps;
    const adaptedSteps = workflows
      .flatMap((w) => w.steps)
      .filter((s) => s.adapted && s.adaptationScaleFactor)
      .map((s) => s.adaptationScaleFactor as number);

    this.data.averageAdaptationScaleFactor = adaptedSteps.length > 0 ? adaptedSteps.reduce((a, b) => a + b, 0) / adaptedSteps.length : 1;
  }

  build(): PackMetrics {
    if (!this.data.id || !this.data.packId || !this.data.packName) {
      throw new Error('PackMetrics missing required fields: id, packId, packName');
    }
    if (this.data.startedAt === undefined) {
      throw new Error('PackMetrics missing required field: startedAt');
    }
    return this.data as PackMetrics;
  }
}

/**
 * Metrics collector and analyzer.
 */
export class MetricsCollector {
  private executions: Map<ExecutionId, PackMetrics> = new Map();
  private workflowStats: Map<string, ExecutionStatistics> = new Map();
  private packStats: Map<PackId, ExecutionStatistics> = new Map();

  /**
   * Records a completed pack execution.
   */
  recordPackExecution(metrics: PackMetrics): void {
    this.executions.set(metrics.id, metrics);
    this.updatePackStatistics(metrics);
  }

  /**
   * Retrieves execution metrics by ID.
   */
  getExecution(id: ExecutionId): PackMetrics | null {
    return this.executions.get(id) ?? null;
  }

  /**
   * Gets statistics for a workflow.
   */
  getWorkflowStatistics(workflowId: string): ExecutionStatistics | null {
    return this.workflowStats.get(workflowId) ?? null;
  }

  /**
   * Gets statistics for a pack.
   */
  getPackStatistics(packId: PackId): ExecutionStatistics | null {
    return this.packStats.get(packId) ?? null;
  }

  /**
   * Gets all executions for a pack.
   */
  getPackExecutions(packId: PackId): PackMetrics[] {
    return Array.from(this.executions.values()).filter((e) => e.packId === packId);
  }

  /**
   * Gets all executions for a workflow.
   */
  getWorkflowExecutions(workflowId: string): WorkflowMetrics[] {
    const executions: WorkflowMetrics[] = [];
    this.executions.forEach((pack) => {
      pack.workflows.forEach((workflow) => {
        if (workflow.workflowId === workflowId) {
          executions.push(workflow);
        }
      });
    });
    return executions;
  }

  /**
   * Clears all recorded metrics (for testing or reset).
   */
  clear(): void {
    this.executions.clear();
    this.workflowStats.clear();
    this.packStats.clear();
  }

  /**
   * Updates statistics for a pack.
   */
  private updatePackStatistics(metrics: PackMetrics): void {
    const stats = this.packStats.get(metrics.packId) ?? createEmptyStatistics();

    stats.totalExecutions += 1;
    if (metrics.status === 'completed') {
      stats.successfulExecutions += 1;
    } else if (metrics.status === 'failed') {
      stats.failedExecutions += 1;
    } else if (metrics.status === 'partial') {
      stats.partialExecutions += 1;
    } else if (metrics.status === 'cancelled') {
      stats.cancelledExecutions += 1;
    }

    stats.totalDurationMs += metrics.durationMs;
    stats.minDurationMs = Math.min(stats.minDurationMs, metrics.durationMs);
    stats.maxDurationMs = Math.max(stats.maxDurationMs, metrics.durationMs);

    stats.totalSteps += metrics.totalSteps;
    stats.completedSteps += metrics.completedSteps;
    stats.failedSteps += metrics.failedSteps;
    stats.adaptedSteps += metrics.adaptedSteps;

    stats.totalAdaptations += metrics.adaptationCount;
    if (metrics.averageAdaptationScaleFactor > 0) {
      stats.maxAdaptationScaleFactor = Math.max(stats.maxAdaptationScaleFactor, metrics.averageAdaptationScaleFactor);
      stats.minAdaptationScaleFactor = Math.min(stats.minAdaptationScaleFactor, metrics.averageAdaptationScaleFactor);
    }

    // Update aggregated stats
    stats.averageDurationMs = stats.totalDurationMs / stats.totalExecutions;
    stats.overallSuccessRate = stats.totalSteps > 0 ? stats.completedSteps / stats.totalSteps : 0;
    stats.overallConfidence = metrics.averageConfidence;

    // Track failure reasons
    if (metrics.error) {
      stats.failureReasons[metrics.error] = (stats.failureReasons[metrics.error] ?? 0) + 1;
    }

    if (stats.totalAdaptations > 0) {
      stats.averageAdaptationScaleFactor = metrics.averageAdaptationScaleFactor;
    }

    this.packStats.set(metrics.packId, stats);

    // Update per-workflow statistics
    metrics.workflows.forEach((workflow) => {
      const workflowStats = this.workflowStats.get(workflow.workflowId) ?? createEmptyStatistics();
      workflowStats.totalExecutions += 1;
      workflowStats.totalSteps += workflow.totalSteps;
      workflowStats.completedSteps += workflow.completedSteps;
      workflowStats.failedSteps += workflow.failedSteps;
      workflowStats.adaptedSteps += workflow.adaptedSteps;
      workflowStats.overallSuccessRate = workflowStats.totalSteps > 0 ? workflowStats.completedSteps / workflowStats.totalSteps : 0;
      workflowStats.overallConfidence = workflow.averageConfidence;

      if (workflow.error) {
        workflowStats.failureReasons[workflow.error] = (workflowStats.failureReasons[workflow.error] ?? 0) + 1;
      }

      this.workflowStats.set(workflow.workflowId, workflowStats);
    });
  }
}

/**
 * Creates an empty statistics object.
 */
function createEmptyStatistics(): ExecutionStatistics {
  return {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    partialExecutions: 0,
    cancelledExecutions: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    minDurationMs: Infinity,
    maxDurationMs: 0,
    totalSteps: 0,
    completedSteps: 0,
    failedSteps: 0,
    adaptedSteps: 0,
    overallSuccessRate: 0,
    overallConfidence: 0,
    failureReasons: {},
    totalAdaptations: 0,
    averageAdaptationScaleFactor: 1,
    maxAdaptationScaleFactor: 1,
    minAdaptationScaleFactor: 1,
  };
}

/**
 * Helper to generate a unique execution ID.
 */
export function generateExecutionId(): ExecutionId {
  return `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as ExecutionId;
}

/**
 * Helper to generate a unique step ID.
 */
export function generateStepId(): StepId {
  return `step-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as StepId;
}
