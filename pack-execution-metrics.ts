/**
 * Pack Execution Metrics Collection
 *
 * Implements comprehensive metrics collection for Pack deployments with support for:
 * - Pack-level, workflow-level, and step-level metrics tracking
 * - Start/end time and duration tracking
 * - Step completion and failure counts
 * - Element not-found error tracking
 * - Coordinate adaptation count and details
 * - Success rate calculation
 * - Metrics aggregation for historical analysis
 * - Export/import for reporting and analytics
 * - Persistence interface for storage
 *
 * Requirements: 9.5, 25.5
 */

import type { ExecutionId, EntityId, Timestamp } from './integration-types.js';
import type { PackId } from './execution-metrics.js';
import type {
  FailureReason,
  StepStatus,
  WorkflowStatus,
  PackStatus,
} from './execution-metrics.js';

// ============================================================================
// Detailed Metrics Types
// ============================================================================

/**
 * Complete metrics for an element matching operation.
 * Captures all details about how an element was found.
 */
export interface ElementMatchMetrics {
  /** Original selector from workflow step */
  originalSelector?: string;
  
  /** Original accessible name from workflow step */
  originalAccessibleName?: string;
  
  /** DOM path from workflow step */
  originalDomPath?: string[];
  
  /** Matching strategy used (selector, accessibleName, domPath, fuzzy, fallback) */
  matchStrategy: 'exact' | 'selector' | 'accessibleName' | 'domPath' | 'fuzzy' | 'fallback';
  
  /** Whether element was found */
  found: boolean;
  
  /** Element coordinates if found */
  foundCoordinates?: { x: number; y: number };
  
  /** Confidence score for match [0..1] */
  confidence: number;
  
  /** Time taken for matching in milliseconds */
  matchDurationMs: number;
}

/**
 * Detailed metrics for a coordinate adaptation operation.
 */
export interface CoordinateAdaptationMetrics {
  /** Original normalized coordinates [0..1] */
  sourceCoordinates: { x: number; y: number };
  
  /** Original display resolution */
  sourceDisplay: { width: number; height: number };
  
  /** Target screen coordinates */
  targetCoordinates: { x: number; y: number };
  
  /** Target display resolution */
  targetDisplay: { width: number; height: number };
  
  /** Adaptation scale factors */
  scaleX: number;
  scaleY: number;
  
  /** Whether scaling was applied */
  scaleApplied: boolean;
  
  /** Adaptation type: resolutionChange, dpiChange, multiDisplay, perspective */
  adaptationType: 'none' | 'resolutionChange' | 'dpiChange' | 'multiDisplay' | 'perspective';
  
  /** Confidence in adapted coordinates [0..1] */
  confidence: number;
  
  /** Time taken for adaptation in milliseconds */
  adaptationDurationMs: number;
}

/**
 * Complete metrics for a step execution including element matching and adaptation.
 */
export interface DetailedStepMetrics extends StepMetrics {
  /** Element matching details */
  elementMatch?: ElementMatchMetrics;
  
  /** Coordinate adaptation details */
  coordinateAdaptation?: CoordinateAdaptationMetrics;
  
  /** Retry attempts with timing */
  retryAttempts: Array<{
    attemptNumber: number;
    timestamp: number;
    durationMs: number;
    error?: FailureReason;
  }>;
  
  /** Timing breakdown by phase */
  timingBreakdown: {
    /** Time spent waiting for context verification */
    contextVerificationMs: number;
    
    /** Time spent matching element */
    elementMatchingMs: number;
    
    /** Time spent adapting coordinates */
    coordinateAdaptationMs: number;
    
    /** Time spent executing action */
    actionExecutionMs: number;
    
    /** Time spent verifying result */
    resultVerificationMs: number;
  };
  
  /** Quality metrics */
  qualityMetrics: {
    /** Whether element was stable during execution */
    elementStable: boolean;
    
    /** Whether action was executed at expected time */
    timingAccurate: boolean;
    
    /** Confidence in action result */
    resultConfidence: number;
  };
}

/**
 * Complete metrics for a workflow execution.
 */
export interface DetailedWorkflowMetrics extends WorkflowMetrics {
  /** Step-level metrics with detailed execution info */
  stepDetails: DetailedStepMetrics[];
  
  /** Element not-found errors with details */
  elementNotFoundErrors: Array<{
    stepIndex: number;
    stepName: string;
    targetElement?: string;
    attemptedStrategies: string[];
    errorTimestamp: number;
  }>;
  
  /** Coordinate adaptation count and details */
  coordinateAdaptations: CoordinateAdaptationMetrics[];
  
  /** Context mismatch warnings */
  contextWarnings: Array<{
    type: 'resolution' | 'application' | 'element' | 'window';
    message: string;
    timestamp: number;
    severity: 'low' | 'medium' | 'high';
  }>;
  
  /** Average timing breakdown across all steps */
  averageTimingBreakdown: {
    contextVerificationMs: number;
    elementMatchingMs: number;
    coordinateAdaptationMs: number;
    actionExecutionMs: number;
    resultVerificationMs: number;
  };
  
  /** Quality summary */
  qualitySummary: {
    averageElementStability: number;
    averageTimingAccuracy: number;
    averageResultConfidence: number;
  };
}

/**
 * Complete metrics for a pack execution.
 */
export interface DetailedPackMetrics extends PackMetrics {
  /** Workflow-level metrics with full details */
  workflowDetails: DetailedWorkflowMetrics[];
  
  /** Aggregate element not-found count across all workflows */
  totalElementNotFoundErrors: number;
  
  /** Aggregate coordinate adaptation count across all workflows */
  totalCoordinateAdaptations: number;
  
  /** Summary of adaptation types used */
  adaptationSummary: {
    resolutionChange: number;
    dpiChange: number;
    multiDisplay: number;
    perspective: number;
  };
  
  /** Success rate per workflow */
  successRateByWorkflow: Array<{
    workflowId: string;
    workflowName: string;
    successRate: number;
    stepsCompleted: number;
    totalSteps: number;
  }>;
  
  /** Timing summary */
  timingSummary: {
    /** Total time spent on context verification */
    totalContextVerificationMs: number;
    
    /** Total time spent on element matching */
    totalElementMatchingMs: number;
    
    /** Total time spent on coordinate adaptation */
    totalCoordinateAdaptationMs: number;
    
    /** Total time spent on action execution */
    totalActionExecutionMs: number;
    
    /** Total time spent on result verification */
    totalResultVerificationMs: number;
  };
  
  /** Quality summary */
  qualitySummary: {
    /** Average element stability across all steps */
    averageElementStability: number;
    
    /** Average timing accuracy across all steps */
    averageTimingAccuracy: number;
    
    /** Average result confidence across all steps */
    averageResultConfidence: number;
  };
}

// ============================================================================
// Metrics Summary Types for Reporting
// ============================================================================

/**
 * Summary statistics for a pack execution.
 * Used for reporting and analytics dashboards.
 */
export interface PackExecutionSummary {
  /** Pack identification */
  packId: string;
  packName: string;
  packVersion: string;
  
  /** Execution identification */
  executionId: string;
  deploymentId: string;
  
  /** Timing */
  startTime: string;
  endTime: string;
  durationMs: number;
  
  /** Success metrics */
  success: boolean;
  successRate: number;
  successRateByWorkflow: Array<{ workflowId: string; successRate: number }>;
  
  /** Step metrics */
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  adaptedSteps: number;
  
  /** Error metrics */
  elementNotFoundErrors: number;
  fallbackMatches: number;
  contextWarnings: number;
  
  /** Adaptation metrics */
  totalCoordinateAdaptations: number;
  avgAdaptationScaleX: number;
  avgAdaptationScaleY: number;
  
  /** Quality metrics */
  avgStepDurationMs: number;
  avgElementStability: number;
  avgTimingAccuracy: number;
  avgResultConfidence: number;
  
  /** Workflow breakdown */
  workflowBreakdown: Array<{
    workflowId: string;
    name: string;
    success: boolean;
    durationMs: number;
    stepsCompleted: number;
    totalSteps: number;
  }>;
}

/**
 * Historical trend data for a pack over time.
 */
export interface PackTrendData {
  /** Pack identification */
  packId: string;
  packName: string;
  
  /** Time range covered */
  startDate: string;
  endDate: string;
  
  /** Summary statistics */
  totalExecutions: number;
  successRate: number;
  avgDurationMs: number;
  
  /** Daily/weekly/monthly aggregates */
  dailyStats: Array<{
    date: string;
    executions: number;
    successRate: number;
    avgDurationMs: number;
    totalSteps: number;
    adaptedSteps: number;
  }>;
  
  /** Success rate trend (last N executions) */
  successTrend: Array<{ executionId: string; success: boolean; timestamp: string }>;
  
  /** Adaptation pattern analysis */
  adaptationAnalysis: {
    avgAdaptationsPerExecution: number;
    mostCommonAdaptationType: 'resolutionChange' | 'dpiChange' | 'multiDisplay' | 'perspective';
    avgScaleFactor: number;
  };
}

/**
 * Comparison between two pack executions.
 */
export interface PackExecutionComparison {
  /** First execution (baseline) */
  baseline: PackExecutionSummary;
  
  /** Second execution (comparison) */
  comparison: PackExecutionSummary;
  
  /** Changes between executions */
  changes: {
    durationChangeMs: number;
    durationChangePercent: number;
    stepsCompletedChange: number;
    successRateChange: number;
    adaptedStepsChange: number;
    elementNotFoundChange: number;
  };
  
  /** Improvements and regressions */
  analysis: {
    improved: string[];
    regressed: string[];
    unchanged: string[];
  };
}

// ============================================================================
// Metrics Collection Types
// ============================================================================

/**
 * Options for configuring metrics collection.
 */
export interface MetricsCollectionOptions {
  /** Whether to collect detailed metrics (element matching, adaptation) */
  collectDetailed?: boolean;
  
  /** Whether to collect timing breakdown for each phase */
  collectTimingBreakdown?: boolean;
  
  /** Whether to collect element matching details */
  collectElementMatching?: boolean;
  
  /** Whether to collect coordinate adaptation details */
  collectCoordinateAdaptation?: boolean;
  
  /** Whether to collect retry attempt details */
  collectRetryAttempts?: boolean;
  
  /** Sample rate for detailed collection (1.0 = all, 0.1 = 10%) */
  sampleRate?: number;
}

/**
 * Event types emitted during metrics collection.
 */
export type MetricsEvent =
  | PackMetricsStartedEvent
  | PackMetricsCompletedEvent
  | WorkflowMetricsStartedEvent
  | WorkflowMetricsCompletedEvent
  | StepMetricsUpdatedEvent
  | ElementMatchEvent
  | CoordinateAdaptationEvent
  | ErrorRecordedEvent;

/**
 * Emitted when pack metrics collection starts.
 */
export interface PackMetricsStartedEvent {
  type: 'PackMetricsStarted';
  timestamp: number;
  packId: string;
  deploymentId: string;
  executionId: string;
}

/**
 * Emitted when pack metrics collection completes.
 */
export interface PackMetricsCompletedEvent {
  type: 'PackMetricsCompleted';
  timestamp: number;
  packId: string;
  deploymentId: string;
  executionId: string;
  success: boolean;
  durationMs: number;
}

/**
 * Emitted when workflow metrics collection starts.
 */
export interface WorkflowMetricsStartedEvent {
  type: 'WorkflowMetricsStarted';
  timestamp: number;
  workflowId: string;
  executionId: string;
  deploymentId: string;
}

/**
 * Emitted when workflow metrics collection completes.
 */
export interface WorkflowMetricsCompletedEvent {
  type: 'WorkflowMetricsCompleted';
  timestamp: number;
  workflowId: string;
  executionId: string;
  deploymentId: string;
  success: boolean;
  durationMs: number;
  stepsCompleted: number;
  failedSteps: number;
}

/**
 * Emitted when step metrics are updated.
 */
export interface StepMetricsUpdatedEvent {
  type: 'StepMetricsUpdated';
  timestamp: number;
  stepIndex: number;
  stepName: string;
  status: StepStatus;
  durationMs: number;
}

/**
 * Emitted when element matching occurs.
 */
export interface ElementMatchEvent {
  type: 'ElementMatch';
  timestamp: number;
  stepIndex: number;
  strategy: 'selector' | 'accessibleName' | 'domPath' | 'fuzzy' | 'fallback';
  found: boolean;
  confidence: number;
  durationMs: number;
}

/**
 * Emitted when coordinate adaptation occurs.
 */
export interface CoordinateAdaptationEvent {
  type: 'CoordinateAdaptation';
  timestamp: number;
  stepIndex: number;
  sourceDisplay: { width: number; height: number };
  targetDisplay: { width: number; height: number };
  scaleX: number;
  scaleY: number;
  adaptationType: 'resolutionChange' | 'dpiChange' | 'multiDisplay' | 'perspective';
  confidence: number;
  durationMs: number;
}

/**
 * Emitted when an error is recorded.
 */
export interface ErrorRecordedEvent {
  type: 'ErrorRecorded';
  timestamp: number;
  stepIndex: number;
  errorType: FailureReason;
  message: string;
  recoverable: boolean;
}

// ============================================================================
// Metrics Persistence Interface
// ============================================================================

/**
 * Storage interface for metrics data.
 * Supports both in-memory and persistent storage implementations.
 */
export interface MetricsStorage {
  /** Save a pack execution metrics record */
  savePackMetrics(metrics: DetailedPackMetrics): Promise<void>;
  
  /** Load pack execution metrics by ID */
  loadPackMetrics(executionId: string): Promise<DetailedPackMetrics | null>;
  
  /** Load pack execution metrics by pack ID */
  loadPackMetricsByPackId(packId: string): Promise<DetailedPackMetrics[]>;
  
  /** Load all pack execution metrics */
  loadAllPackMetrics(): Promise<DetailedPackMetrics[]>;
  
  /** Delete pack execution metrics */
  deletePackMetrics(executionId: string): Promise<void>;
  
  /** Save workflow execution metrics */
  saveWorkflowMetrics(metrics: DetailedWorkflowMetrics): Promise<void>;
  
  /** Load workflow execution metrics by ID */
  loadWorkflowMetrics(executionId: string): Promise<DetailedWorkflowMetrics | null>;
  
  /** Load workflow execution metrics by workflow ID */
  loadWorkflowMetricsByWorkflowId(workflowId: string): Promise<DetailedWorkflowMetrics[]>;
  
  /** Delete workflow execution metrics */
  deleteWorkflowMetrics(executionId: string): Promise<void>;
  
  /** Save step execution metrics */
  saveStepMetrics(metrics: DetailedStepMetrics): Promise<void>;
  
  /** Load step execution metrics by ID */
  loadStepMetrics(stepId: string): Promise<DetailedStepMetrics | null>;
  
  /** Delete step execution metrics */
  deleteStepMetrics(stepId: string): Promise<void>;
  
  /** Query metrics with filters */
  queryMetrics(options: {
    packId?: string;
    workflowId?: string;
    startTime?: number;
    endTime?: number;
    success?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<DetailedPackMetrics[]>;
}

/**
 * In-memory metrics storage implementation.
 * Used for testing and temporary storage.
 */
export class InMemoryMetricsStorage implements MetricsStorage {
  private packMetrics: Map<string, DetailedPackMetrics> = new Map();
  private workflowMetrics: Map<string, DetailedWorkflowMetrics> = new Map();
  private stepMetrics: Map<string, DetailedStepMetrics> = new Map();

  async savePackMetrics(metrics: DetailedPackMetrics): Promise<void> {
    this.packMetrics.set(metrics.id, metrics);
  }

  async loadPackMetrics(executionId: string): Promise<DetailedPackMetrics | null> {
    return this.packMetrics.get(executionId) ?? null;
  }

  async loadPackMetricsByPackId(packId: string): Promise<DetailedPackMetrics[]> {
    const results: DetailedPackMetrics[] = [];
    this.packMetrics.forEach((metrics) => {
      if (metrics.packId === packId) {
        results.push(metrics);
      }
    });
    return results;
  }

  async loadAllPackMetrics(): Promise<DetailedPackMetrics[]> {
    return Array.from(this.packMetrics.values());
  }

  async deletePackMetrics(executionId: string): Promise<void> {
    this.packMetrics.delete(executionId);
  }

  async saveWorkflowMetrics(metrics: DetailedWorkflowMetrics): Promise<void> {
    this.workflowMetrics.set(metrics.id, metrics);
  }

  async loadWorkflowMetrics(executionId: string): Promise<DetailedWorkflowMetrics | null> {
    return this.workflowMetrics.get(executionId) ?? null;
  }

  async loadWorkflowMetricsByWorkflowId(workflowId: string): Promise<DetailedWorkflowMetrics[]> {
    const results: DetailedWorkflowMetrics[] = [];
    this.workflowMetrics.forEach((metrics) => {
      if (metrics.workflowId === workflowId) {
        results.push(metrics);
      }
    });
    return results;
  }

  async deleteWorkflowMetrics(executionId: string): Promise<void> {
    this.workflowMetrics.delete(executionId);
  }

  async saveStepMetrics(metrics: DetailedStepMetrics): Promise<void> {
    this.stepMetrics.set(metrics.id, metrics);
  }

  async loadStepMetrics(stepId: string): Promise<DetailedStepMetrics | null> {
    return this.stepMetrics.get(stepId) ?? null;
  }

  async deleteStepMetrics(stepId: string): Promise<void> {
    this.stepMetrics.delete(stepId);
  }

  async queryMetrics(options: {
    packId?: string;
    workflowId?: string;
    startTime?: number;
    endTime?: number;
    success?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<DetailedPackMetrics[]> {
    let results = Array.from(this.packMetrics.values());
    
    if (options.packId) {
      results = results.filter((m) => m.packId === options.packId);
    }
    
    if (options.workflowId) {
      results = results.filter((m) => 
        m.workflows.some((w) => w.workflowId === options.workflowId)
      );
    }
    
    if (options.startTime) {
      results = results.filter((m) => m.startedAt >= options.startTime);
    }
    
    if (options.endTime) {
      results = results.filter((m) => m.completedAt && m.completedAt <= options.endTime);
    }
    
    if (options.success !== undefined) {
      results = results.filter((m) => (options.success === true) === m.success);
    }
    
    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || results.length;
    results = results.slice(offset, offset + limit);
    
    return results;
  }
}

// ============================================================================
// Metrics Collector with Aggregation and Export
// ============================================================================

/**
 * Comprehensive metrics collector for Pack execution.
 * Handles collection, aggregation, export, and persistence of metrics.
 */
export class PackMetricsCollector {
  private packMetrics: DetailedPackMetrics | null = null;
  private workflowMetrics: DetailedWorkflowMetrics | null = null;
  private stepMetrics: DetailedStepMetrics[] = [];
  
  private collectionStarted: boolean = false;
  private collectionOptions: MetricsCollectionOptions = {};
  
  constructor(
    private storage: MetricsStorage = new InMemoryMetricsStorage(),
    options: MetricsCollectionOptions = {}
  ) {
    this.collectionOptions = {
      collectDetailed: true,
      collectTimingBreakdown: true,
      collectElementMatching: true,
      collectCoordinateAdaptation: true,
      collectRetryAttempts: true,
      sampleRate: 1.0,
      ...options,
    };
  }

  /**
   * Start collecting metrics for a pack deployment.
   */
  startPackMetrics(
    packId: string,
    packName: string,
    packVersion: string,
    executionId: string,
    deploymentId: string,
    context: {
      displayState: {
        width: number;
        height: number;
      };
      applicationName?: string;
    }
  ): void {
    if (this.collectionStarted) {
      throw new Error('Pack metrics collection already started');
    }

    this.packMetrics = {
      id: executionId as ExecutionId,
      packId: packId as PackId,
      packName,
      packVersion,
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
      durationMs: 0,
      workflows: [],
      workflowDetails: [],
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
      totalElementNotFoundErrors: 0,
      totalCoordinateAdaptations: 0,
      adaptationSummary: {
        resolutionChange: 0,
        dpiChange: 0,
        multiDisplay: 0,
        perspective: 0,
      },
      successRateByWorkflow: [],
      timingSummary: {
        totalContextVerificationMs: 0,
        totalElementMatchingMs: 0,
        totalCoordinateAdaptationMs: 0,
        totalActionExecutionMs: 0,
        totalResultVerificationMs: 0,
      },
      qualitySummary: {
        averageElementStability: 0,
        averageTimingAccuracy: 0,
        averageResultConfidence: 0,
      },
      error: null,
      executionPolicy: 'sequential',
    };

    this.workflowMetrics = null;
    this.stepMetrics = [];
    this.collectionStarted = true;

    // Emit metrics started event
    this.emitEvent({
      type: 'PackMetricsStarted',
      timestamp: Date.now(),
      packId,
      deploymentId,
      executionId,
    });
  }

  /**
   * Start collecting metrics for a workflow execution.
   */
  startWorkflowMetrics(
    workflowId: string,
    workflowName: string,
    stepCount: number,
    sourceDisplay?: { width: number; height: number },
    targetDisplay?: { width: number; height: number }
  ): void {
    if (!this.packMetrics) {
      throw new Error('Pack metrics collection not started');
    }

    this.workflowMetrics = {
      id: this.packMetrics.id,
      workflowId,
      workflowName,
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
      durationMs: 0,
      steps: [],
      stepDetails: [],
      totalSteps: stepCount,
      completedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0,
      adaptedSteps: 0,
      successRate: 0,
      averageStepDuration: 0,
      averageConfidence: 0,
      sourceDisplay,
      targetDisplay,
      displayAdaptationRequired: !!(sourceDisplay && targetDisplay && 
        (sourceDisplay.width !== targetDisplay.width || 
         sourceDisplay.height !== targetDisplay.height)),
      error: null,
      elementNotFoundErrors: [],
      coordinateAdaptations: [],
      contextWarnings: [],
      averageTimingBreakdown: {
        contextVerificationMs: 0,
        elementMatchingMs: 0,
        coordinateAdaptationMs: 0,
        actionExecutionMs: 0,
        resultVerificationMs: 0,
      },
      qualitySummary: {
        averageElementStability: 0,
        averageTimingAccuracy: 0,
        averageResultConfidence: 0,
      },
    };

    // Emit metrics started event
    this.emitEvent({
      type: 'WorkflowMetricsStarted',
      timestamp: Date.now(),
      workflowId,
      executionId: this.packMetrics.id,
      deploymentId: this.packMetrics.deploymentId,
    });
  }

  /**
   * Record a step execution update.
   */
  recordStepUpdate(
    stepIndex: number,
    stepName: string,
    action: string,
    status: StepStatus,
    targetElement?: string,
    targetCoordinates?: { x: number; y: number }
  ): void {
    if (!this.workflowMetrics) {
      throw new Error('Workflow metrics collection not started');
    }

    const stepMetrics: DetailedStepMetrics = {
      id: `step-${stepIndex}-${this.packMetrics?.id}` as ExecutionId,
      index: stepIndex,
      name: stepName,
      action,
      status,
      startedAt: Date.now(),
      completedAt: status === 'running' ? null : Date.now(),
      durationMs: 0,
      targetElement,
      targetCoordinates,
      adapted: false,
      error: null,
      confidence: 0,
      retryCount: 0,
      retryLimitReached: false,
      elementMatch: undefined,
      coordinateAdaptation: undefined,
      retryAttempts: [],
      timingBreakdown: {
        contextVerificationMs: 0,
        elementMatchingMs: 0,
        coordinateAdaptationMs: 0,
        actionExecutionMs: 0,
        resultVerificationMs: 0,
      },
      qualityMetrics: {
        elementStable: true,
        timingAccurate: true,
        resultConfidence: 0,
      },
    };

    // Update step timing if already completed
    if (stepMetrics.completedAt && stepMetrics.startedAt) {
      stepMetrics.durationMs = stepMetrics.completedAt - stepMetrics.startedAt;
    }

    this.stepMetrics.push(stepMetrics);
    this.workflowMetrics.steps.push(stepMetrics as StepMetrics);
    this.workflowMetrics.stepDetails.push(stepMetrics);

    // Emit metrics updated event
    this.emitEvent({
      type: 'StepMetricsUpdated',
      timestamp: Date.now(),
      stepIndex,
      stepName,
      status,
      durationMs: stepMetrics.durationMs,
    });
  }

  /**
   * Record an element matching operation.
   */
  recordElementMatch(
    stepIndex: number,
    strategy: 'selector' | 'accessibleName' | 'domPath' | 'fuzzy' | 'fallback',
    found: boolean,
    confidence: number,
    durationMs: number,
    originalSelector?: string,
    originalAccessibleName?: string,
    originalDomPath?: string[]
  ): void {
    if (!this.collectionOptions.collectElementMatching) {
      return;
    }

    const stepMetrics = this.stepMetrics[stepIndex];
    if (!stepMetrics) {
      return;
    }

    stepMetrics.elementMatch = {
      originalSelector,
      originalAccessibleName,
      originalDomPath,
      matchStrategy: strategy,
      found,
      confidence,
      matchDurationMs: durationMs,
    };

    // Emit element match event
    this.emitEvent({
      type: 'ElementMatch',
      timestamp: Date.now(),
      stepIndex,
      strategy,
      found,
      confidence,
      durationMs,
    });
  }

  /**
   * Record a coordinate adaptation operation.
   */
  recordCoordinateAdaptation(
    stepIndex: number,
    sourceCoordinates: { x: number; y: number },
    sourceDisplay: { width: number; height: number },
    targetCoordinates: { x: number; y: number },
    targetDisplay: { width: number; height: number },
    adaptationType: 'none' | 'resolutionChange' | 'dpiChange' | 'multiDisplay' | 'perspective',
    confidence: number,
    durationMs: number
  ): void {
    if (!this.collectionOptions.collectCoordinateAdaptation) {
      return;
    }

    const stepMetrics = this.stepMetrics[stepIndex];
    if (!stepMetrics) {
      return;
    }

    const scaleX = targetDisplay.width / sourceDisplay.width;
    const scaleY = targetDisplay.height / sourceDisplay.height;

    stepMetrics.coordinateAdaptation = {
      sourceCoordinates,
      sourceDisplay,
      targetCoordinates,
      targetDisplay,
      scaleX,
      scaleY,
      scaleApplied: adaptationType !== 'none',
      adaptationType,
      confidence,
      adaptationDurationMs: durationMs,
    };

    // Update workflow adaptation tracking
    if (this.workflowMetrics) {
      this.workflowMetrics.adaptedSteps++;
      this.workflowMetrics.coordinateAdaptations.push({
        sourceCoordinates,
        sourceDisplay,
        targetCoordinates,
        targetDisplay,
        scaleX,
        scaleY,
        scaleApplied: adaptationType !== 'none',
        adaptationType,
        confidence,
        adaptationDurationMs: durationMs,
      });
    }

    // Emit coordinate adaptation event
    this.emitEvent({
      type: 'CoordinateAdaptation',
      timestamp: Date.now(),
      stepIndex,
      sourceDisplay,
      targetDisplay,
      scaleX,
      scaleY,
      adaptationType,
      confidence,
      durationMs,
    });
  }

  /**
   * Record an error during execution.
   */
  recordError(
    stepIndex: number,
    errorType: FailureReason,
    message: string,
    recoverable: boolean = true
  ): void {
    const stepMetrics = this.stepMetrics[stepIndex];
    if (!stepMetrics) {
      return;
    }

    stepMetrics.status = errorType === 'timeout' ? 'failed' : stepMetrics.status;
    stepMetrics.error = errorType;
    stepMetrics.retryLimitReached = !recoverable;

    // If step has element matching info, update element not-found tracking
    if (errorType === 'element-not-found' && stepMetrics.elementMatch) {
      if (this.workflowMetrics) {
        this.workflowMetrics.elementNotFoundErrors.push({
          stepIndex,
          stepName: stepMetrics.name,
          targetElement: stepMetrics.elementMatch.originalSelector,
          attemptedStrategies: [stepMetrics.elementMatch.matchStrategy],
          errorTimestamp: Date.now(),
        });
        this.workflowMetrics.totalElementNotFoundErrors = 
          this.workflowMetrics.elementNotFoundErrors.length;
      }
    }

    // Emit error recorded event
    this.emitEvent({
      type: 'ErrorRecorded',
      timestamp: Date.now(),
      stepIndex,
      errorType,
      message,
      recoverable,
    });
  }

  /**
   * Record retry attempt for a step.
   */
  recordRetryAttempt(
    stepIndex: number,
    attemptNumber: number,
    durationMs: number,
    error?: FailureReason
  ): void {
    if (!this.collectionOptions.collectRetryAttempts) {
      return;
    }

    const stepMetrics = this.stepMetrics[stepIndex];
    if (!stepMetrics) {
      return;
    }

    stepMetrics.retryAttempts.push({
      attemptNumber,
      timestamp: Date.now(),
      durationMs,
      error,
    });
    stepMetrics.retryCount = attemptNumber;
  }

  /**
   * Record timing breakdown for a step.
   */
  recordTimingBreakdown(
    stepIndex: number,
    breakdown: DetailedStepMetrics['timingBreakdown']
  ): void {
    if (!this.collectionOptions.collectTimingBreakdown) {
      return;
    }

    const stepMetrics = this.stepMetrics[stepIndex];
    if (!stepMetrics) {
      return;
    }

    stepMetrics.timingBreakdown = {
      ...stepMetrics.timingBreakdown,
      ...breakdown,
    };

    // Update workflow timing summary
    if (this.workflowMetrics) {
      this.workflowMetrics.timingSummary = {
        totalContextVerificationMs: 
          (this.workflowMetrics.timingSummary.totalContextVerificationMs || 0) + breakdown.contextVerificationMs,
        totalElementMatchingMs: 
          (this.workflowMetrics.timingSummary.totalElementMatchingMs || 0) + breakdown.elementMatchingMs,
        totalCoordinateAdaptationMs: 
          (this.workflowMetrics.timingSummary.totalCoordinateAdaptationMs || 0) + breakdown.coordinateAdaptationMs,
        totalActionExecutionMs: 
          (this.workflowMetrics.timingSummary.totalActionExecutionMs || 0) + breakdown.actionExecutionMs,
        totalResultVerificationMs: 
          (this.workflowMetrics.timingSummary.totalResultVerificationMs || 0) + breakdown.resultVerificationMs,
      };
    }
  }

  /**
   * Complete workflow metrics collection.
   */
  completeWorkflowMetrics(success: boolean, errorMessage?: string): void {
    if (!this.workflowMetrics) {
      throw new Error('Workflow metrics collection not started');
    }

    const endTime = Date.now();
    this.workflowMetrics.completedAt = endTime;
    this.workflowMetrics.durationMs = endTime - this.workflowMetrics.startedAt;
    this.workflowMetrics.status = success ? 'completed' : 'failed';
    this.workflowMetrics.error = success ? null : (errorMessage as FailureReason);

    // Update step aggregates
    this.workflowMetrics.completedSteps = 
      this.workflowMetrics.stepDetails.filter((s) => s.status === 'completed').length;
    this.workflowMetrics.failedSteps = 
      this.workflowMetrics.stepDetails.filter((s) => s.status === 'failed').length;
    this.workflowMetrics.skippedSteps = 
      this.workflowMetrics.stepDetails.filter((s) => s.status === 'skipped').length;
    this.workflowMetrics.adaptedSteps = 
      this.workflowMetrics.stepDetails.filter((s) => s.adapted).length;

    // Update step success rate
    const totalSteps = this.workflowMetrics.totalSteps;
    const successfulSteps = this.workflowMetrics.completedSteps + this.workflowMetrics.skippedSteps;
    this.workflowMetrics.successRate = 
      totalSteps > 0 ? successfulSteps / totalSteps : 0;

    // Update average step duration
    const completedSteps = this.workflowMetrics.stepDetails.filter((s) => 
      s.status === 'completed' || s.status === 'failed'
    );
    if (completedSteps.length > 0) {
      this.workflowMetrics.averageStepDuration = 
        completedSteps.reduce((sum, s) => sum + s.durationMs, 0) / completedSteps.length;
    }

    // Update average confidence
    this.workflowMetrics.averageConfidence = 
      this.workflowMetrics.stepDetails.length > 0 ? 
        this.workflowMetrics.stepDetails.reduce((sum, s) => sum + s.confidence, 0) / 
        this.workflowMetrics.stepDetails.length : 0;

    // Update element not-found count
    this.workflowMetrics.totalElementNotFoundErrors = 
      this.workflowMetrics.elementNotFoundErrors.length;

    // Update total coordinate adaptations
    this.workflowMetrics.totalCoordinateAdaptations = 
      this.workflowMetrics.coordinateAdaptations.length;

    // Update adaptation summary
    this.workflowMetrics.coordinateAdaptations.forEach((a) => {
      this.workflowMetrics!.adaptationSummary[a.adaptationType] = 
        (this.workflowMetrics!.adaptationSummary[a.adaptationType] || 0) + 1;
    });

    // Update average timing breakdown
    const stepCount = this.workflowMetrics.stepDetails.length;
    if (stepCount > 0) {
      this.workflowMetrics.averageTimingBreakdown = {
        contextVerificationMs: 
          this.workflowMetrics.timingSummary.totalContextVerificationMs / stepCount,
        elementMatchingMs: 
          this.workflowMetrics.timingSummary.totalElementMatchingMs / stepCount,
        coordinateAdaptationMs: 
          this.workflowMetrics.timingSummary.totalCoordinateAdaptationMs / stepCount,
        actionExecutionMs: 
          this.workflowMetrics.timingSummary.totalActionExecutionMs / stepCount,
        resultVerificationMs: 
          this.workflowMetrics.timingSummary.totalResultVerificationMs / stepCount,
      };
    }

    // Update quality summary
    const stableSteps = this.workflowMetrics.stepDetails.filter((s) => s.qualityMetrics.elementStable).length;
    const accurateSteps = this.workflowMetrics.stepDetails.filter((s) => s.qualityMetrics.timingAccurate).length;
    const this.workflowMetrics.stepDetails.filter((s) => s.qualityMetrics.resultConfidence > 0);
    
    this.workflowMetrics.qualitySummary = {
      averageElementStability: stepCount > 0 ? stableSteps / stepCount : 0,
      averageTimingAccuracy: stepCount > 0 ? accurateSteps / stepCount : 0,
      averageResultConfidence: 
        stepCount > 0 ? 
          this.workflowMetrics.stepDetails.reduce((sum, s) => sum + s.qualityMetrics.resultConfidence, 0) / stepCount : 0,
    };

    // Add workflow to pack metrics
    if (this.packMetrics) {
      this.packMetrics.workflows.push(this.workflowMetrics as WorkflowMetrics);
      this.packMetrics.workflowDetails.push(this.workflowMetrics);

      this.packMetrics.totalWorkflows++;
      if (success) {
        this.packMetrics.completedWorkflows++;
      } else {
        this.packMetrics.failedWorkflows++;
      }

      this.packMetrics.totalSteps += this.workflowMetrics.totalSteps;
      this.packMetrics.completedSteps += this.workflowMetrics.completedSteps;
      this.packMetrics.failedSteps += this.workflowMetrics.failedSteps;
      this.packMetrics.adaptedSteps += this.workflowMetrics.adaptedSteps;
      this.packMetrics.totalElementNotFoundErrors += 
        this.workflowMetrics.totalElementNotFoundErrors;
      this.packMetrics.totalCoordinateAdaptations += 
        this.workflowMetrics.totalCoordinateAdaptations;

      // Update pack success rate
      this.packMetrics.successRate = 
        this.packMetrics.totalSteps > 0 ? 
          this.packMetrics.completedSteps / this.packMetrics.totalSteps : 0;

      // Update average workflow duration
      this.packMetrics.averageWorkflowDuration = 
        this.packMetrics.workflows.length > 0 ? 
          this.packMetrics.workflows.reduce((sum, w) => sum + w.durationMs, 0) / 
          this.packMetrics.workflows.length : 0;

      // Update average step duration
      this.packMetrics.averageStepDuration = 
        this.packMetrics.completedSteps > 0 ? 
          (this.packMetrics.workflows.reduce((sum, w) => 
            sum + w.averageStepDuration * w.completedSteps, 0)) / 
          this.packMetrics.completedSteps : 0;

      // Update average confidence
      this.packMetrics.averageConfidence = 
        this.packMetrics.workflows.length > 0 ? 
          this.packMetrics.workflows.reduce((sum, w) => sum + w.averageConfidence, 0) / 
          this.packMetrics.workflows.length : 0;

      // Update adaptation statistics
      this.packMetrics.adaptationCount = this.packMetrics.totalCoordinateAdaptations;
      const adaptedSteps = this.packMetrics.workflowDetails
        .flatMap((w) => w.stepDetails)
        .filter((s) => s.adapted && s.coordinateAdaptation?.scaleX)
        .map((s) => s.coordinateAdaptation!.scaleX);
      this.packMetrics.averageAdaptationScaleFactor = 
        adaptedSteps.length > 0 ? 
          adaptedSteps.reduce((a, b) => a + b, 0) / adaptedSteps.length : 1;

      // Update success rate by workflow
      this.packMetrics.successRateByWorkflow = this.packMetrics.workflowDetails.map((w) => ({
        workflowId: w.workflowId,
        workflowName: w.workflowName,
        successRate: w.successRate,
        stepsCompleted: w.completedSteps,
        totalSteps: w.totalSteps,
      }));
    }

    // Emit workflow completed event
    this.emitEvent({
      type: 'WorkflowMetricsCompleted',
      timestamp: Date.now(),
      workflowId: this.workflowMetrics.workflowId,
      executionId: this.packMetrics?.id || '',
      deploymentId: this.packMetrics?.deploymentId || '',
      success,
      durationMs: this.workflowMetrics.durationMs,
      stepsCompleted: this.workflowMetrics.completedSteps,
      failedSteps: this.workflowMetrics.failedSteps,
    });

    this.workflowMetrics = null;
    this.stepMetrics = [];
  }

  /**
   * Complete pack metrics collection.
   */
  completePackMetrics(success: boolean, errorMessage?: string): void {
    if (!this.packMetrics) {
      throw new Error('Pack metrics collection not started');
    }

    const endTime = Date.now();
    this.packMetrics.completedAt = endTime;
    this.packMetrics.durationMs = endTime - this.packMetrics.startedAt;
    this.packMetrics.status = success ? 'completed' : 'failed';
    this.packMetrics.error = success ? null : (errorMessage as FailureReason);

    // Update pack timing summary from workflows
    this.packMetrics.timingSummary = this.packMetrics.workflowDetails.reduce((sum, w) => ({
      totalContextVerificationMs: sum.totalContextVerificationMs + w.timingSummary.totalContextVerificationMs,
      totalElementMatchingMs: sum.totalElementMatchingMs + w.timingSummary.totalElementMatchingMs,
      totalCoordinateAdaptationMs: sum.totalCoordinateAdaptationMs + w.timingSummary.totalCoordinateAdaptationMs,
      totalActionExecutionMs: sum.totalActionExecutionMs + w.timingSummary.totalActionExecutionMs,
      totalResultVerificationMs: sum.totalResultVerificationMs + w.timingSummary.totalResultVerificationMs,
    }), {
      totalContextVerificationMs: 0,
      totalElementMatchingMs: 0,
      totalCoordinateAdaptationMs: 0,
      totalActionExecutionMs: 0,
      totalResultVerificationMs: 0,
    });

    // Update pack quality summary from workflows
    const totalSteps = this.packMetrics.workflowDetails.reduce((sum, w) => 
      sum + w.stepDetails.length, 0
    );
    if (totalSteps > 0) {
      this.packMetrics.qualitySummary = {
        averageElementStability: 
          this.packMetrics.workflowDetails.reduce((sum, w) => 
            sum + w.qualitySummary.averageElementStability * w.stepDetails.length, 0
          ) / totalSteps,
        averageTimingAccuracy: 
          this.packMetrics.workflowDetails.reduce((sum, w) => 
            sum + w.qualitySummary.averageTimingAccuracy * w.stepDetails.length, 0
          ) / totalSteps,
        averageResultConfidence: 
          this.packMetrics.workflowDetails.reduce((sum, w) => 
            sum + w.qualitySummary.averageResultConfidence * w.stepDetails.length, 0
          ) / totalSteps,
      };
    }

    // Save to storage
    void this.storage.savePackMetrics(this.packMetrics);

    // Emit pack completed event
    this.emitEvent({
      type: 'PackMetricsCompleted',
      timestamp: Date.now(),
      packId: this.packMetrics.packId,
      deploymentId: this.packMetrics.id,
      executionId: this.packMetrics.id,
      success,
      durationMs: this.packMetrics.durationMs,
    });

    this.packMetrics = null;
    this.collectionStarted = false;
  }

  /**
   * Stop metrics collection (without completing).
   */
  stopCollection(): void {
    if (this.packMetrics) {
      this.packMetrics.status = 'cancelled';
      this.packMetrics.completedAt = Date.now();
    }

    if (this.workflowMetrics) {
      this.workflowMetrics.status = 'cancelled';
      this.workflowMetrics.completedAt = Date.now();
    }

    this.packMetrics = null;
    this.workflowMetrics = null;
    this.stepMetrics = [];
    this.collectionStarted = false;
  }

  /**
   * Get current pack metrics.
   */
  getPackMetrics(): DetailedPackMetrics | null {
    return this.packMetrics;
  }

  /**
   * Get current workflow metrics.
   */
  getWorkflowMetrics(): DetailedWorkflowMetrics | null {
    return this.workflowMetrics;
  }

  /**
   * Export metrics to JSON format for reporting.
   */
  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    if (!this.packMetrics) {
      throw new Error('No pack metrics available for export');
    }

    if (format === 'json') {
      return JSON.stringify(this.packMetrics, null, 2);
    } else if (format === 'csv') {
      // CSV export implementation
      const rows: string[] = [];
      
      // Pack summary
      rows.push('Pack Metrics Summary');
      rows.push(`Pack ID,${this.packMetrics.packId}`);
      rows.push(`Pack Name,${this.packMetrics.packName}`);
      rows.push(`Pack Version,${this.packMetrics.packVersion}`);
      rows.push(`Execution ID,${this.packMetrics.id}`);
      rows.push(`Status,${this.packMetrics.status}`);
      rows.push(`Success,${this.packMetrics.success}`);
      rows.push(`Duration (ms),${this.packMetrics.durationMs}`);
      rows.push(`Total Steps,${this.packMetrics.totalSteps}`);
      rows.push(`Completed Steps,${this.packMetrics.completedSteps}`);
      rows.push(`Failed Steps,${this.packMetrics.failedSteps}`);
      rows.push(`Adapted Steps,${this.packMetrics.adaptedSteps}`);
      rows.push(`Success Rate,${this.packMetrics.successRate}`);
      rows.push(`Element Not Found Errors,${this.packMetrics.totalElementNotFoundErrors}`);
      rows.push(`Coordinate Adaptations,${this.packMetrics.totalCoordinateAdaptations}`);
      rows.push('');
      
      // Workflow breakdown
      rows.push('Workflow Breakdown');
      rows.push('Workflow ID,Name,Status,Success,Duration (ms),Steps Completed,Total Steps,Success Rate');
      this.packMetrics.workflowDetails.forEach((w) => {
        rows.push(`${w.workflowId},${w.workflowName},${w.status},${w.success},${w.durationMs},${w.completedSteps},${w.totalSteps},${w.successRate}`);
      });
      
      return rows.join('\n');
    }

    throw new Error(`Unsupported export format: ${format}`);
  }

  /**
   * Import metrics from JSON format.
   */
  static importMetrics(json: string): DetailedPackMetrics {
    const metrics = JSON.parse(json);
    
    if (!metrics.id || !metrics.packId || !metrics.packName) {
      throw new Error('Invalid pack metrics JSON: missing required fields');
    }
    
    return metrics as DetailedPackMetrics;
  }

  /**
   * Generate an execution summary for reporting.
   */
  generateSummary(): PackExecutionSummary {
    if (!this.packMetrics) {
      throw new Error('No pack metrics available');
    }

    return {
      packId: this.packMetrics.packId,
      packName: this.packMetrics.packName,
      packVersion: this.packMetrics.packVersion,
      executionId: this.packMetrics.id,
      deploymentId: this.packMetrics.id,
      startTime: new Date(this.packMetrics.startedAt).toISOString(),
      endTime: this.packMetrics.completedAt ? new Date(this.packMetrics.completedAt).toISOString() : '',
      durationMs: this.packMetrics.durationMs,
      success: this.packMetrics.status === 'completed',
      successRate: this.packMetrics.successRate,
      successRateByWorkflow: this.packMetrics.successRateByWorkflow.map((w) => ({
        workflowId: w.workflowId,
        successRate: w.successRate,
      })),
      totalSteps: this.packMetrics.totalSteps,
      completedSteps: this.packMetrics.completedSteps,
      failedSteps: this.packMetrics.failedSteps,
      skippedSteps: this.packMetrics.skippedSteps,
      adaptedSteps: this.packMetrics.adaptedSteps,
      elementNotFoundErrors: this.packMetrics.totalElementNotFoundErrors,
      fallbackMatches: 0, // Would need to track this separately
      contextWarnings: 0, // Would need to track this separately
      totalCoordinateAdaptations: this.packMetrics.totalCoordinateAdaptations,
      avgAdaptationScaleX: this.packMetrics.adaptationCount > 0 ? 
        this.packMetrics.workflowDetails.flatMap((w) => w.coordinateAdaptations)
          .reduce((sum, a) => sum + a.scaleX, 0) / this.packMetrics.adaptationCount : 0,
      avgAdaptationScaleY: this.packMetrics.adaptationCount > 0 ? 
        this.packMetrics.workflowDetails.flatMap((w) => w.coordinateAdaptations)
          .reduce((sum, a) => sum + a.scaleY, 0) / this.packMetrics.adaptationCount : 0,
      avgStepDurationMs: this.packMetrics.averageStepDuration,
      avgElementStability: this.packMetrics.qualitySummary.averageElementStability,
      avgTimingAccuracy: this.packMetrics.qualitySummary.averageTimingAccuracy,
      avgResultConfidence: this.packMetrics.qualitySummary.averageResultConfidence,
      workflowBreakdown: this.packMetrics.workflowDetails.map((w) => ({
        workflowId: w.workflowId,
        name: w.workflowName,
        success: w.status === 'completed',
        durationMs: w.durationMs,
        stepsCompleted: w.completedSteps,
        totalSteps: w.totalSteps,
      })),
    };
  }

  /**
   * Generate trend data for a pack over multiple executions.
   */
  static async generateTrendData(
    storage: MetricsStorage,
    packId: string
  ): Promise<PackTrendData> {
    const executions = await storage.loadPackMetricsByPackId(packId);
    
    if (executions.length === 0) {
      throw new Error(`No executions found for pack: ${packId}`);
    }

    executions.sort((a, b) => a.startedAt - b.startedAt);

    const packName = executions[0].packName;
    const startDate = new Date(executions[0].startedAt).toISOString();
    const endDate = executions[executions.length - 1].completedAt ? 
      new Date(executions[executions.length - 1].completedAt).toISOString() : 
      new Date().toISOString();

    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter((e) => e.status === 'completed').length;
    const successRate = totalExecutions > 0 ? successfulExecutions / totalExecutions : 0;
    const avgDurationMs = totalExecutions > 0 ? 
      executions.reduce((sum, e) => sum + e.durationMs, 0) / totalExecutions : 0;

    // Generate daily statistics
    const dailyStats: PackTrendData['dailyStats'] = [];
    const dailyMap = new Map<string, {
      executions: number;
      successCount: number;
      durationSum: number;
      totalSteps: number;
      adaptedSteps: number;
    }>();

    executions.forEach((e) => {
      const date = new Date(e.startedAt).toISOString().split('T')[0];
      const dayData = dailyMap.get(date) || {
        executions: 0,
        successCount: 0,
        durationSum: 0,
        totalSteps: 0,
        adaptedSteps: 0,
      };

      dayData.executions++;
      if (e.status === 'completed') {
        dayData.successCount++;
      }
      dayData.durationSum += e.durationMs;
      dayData.totalSteps += e.totalSteps;
      dayData.adaptedSteps += e.adaptedSteps;

      dailyMap.set(date, dayData);
    });

    dailyMap.forEach((data, date) => {
      dailyStats.push({
        date,
        executions: data.executions,
        successRate: data.executions > 0 ? data.successCount / data.executions : 0,
        avgDurationMs: data.executions > 0 ? data.durationSum / data.executions : 0,
        totalSteps: data.totalSteps,
        adaptedSteps: data.adaptedSteps,
      });
    });

    // Success trend
    const successTrend = executions.map((e) => ({
      executionId: e.id,
      success: e.status === 'completed',
      timestamp: new Date(e.startedAt).toISOString(),
    }));

    // Adaptation analysis
    const totalAdaptations = executions.reduce((sum, e) => sum + e.totalCoordinateAdaptations, 0);
    const avgAdaptationsPerExecution = totalExecutions > 0 ? totalAdaptations / totalExecutions : 0;

    const adaptationCounts = {
      resolutionChange: 0,
      dpiChange: 0,
      multiDisplay: 0,
      perspective: 0,
    };

    executions.forEach((e) => {
      adaptationCounts.resolutionChange += e.adaptationSummary.resolutionChange;
      adaptationCounts.dpiChange += e.adaptationSummary.dpiChange;
      adaptationCounts.multiDisplay += e.adaptationSummary.multiDisplay;
      adaptationCounts.perspective += e.adaptationSummary.perspective;
    });

    const mostCommonAdaptationType = Object.entries(adaptationCounts)
      .sort((a, b) => b[1] - a[1])[0][0] as PackTrendData['adaptationAnalysis']['mostCommonAdaptationType'];

    const allScaleFactors = executions.flatMap((e) => 
      e.workflowDetails.flatMap((w) => w.coordinateAdaptations.map((a) => (a.scaleX + a.scaleY) / 2))
    );
    const avgScaleFactor = allScaleFactors.length > 0 ? 
      allScaleFactors.reduce((sum, s) => sum + s, 0) / allScaleFactors.length : 0;

    return {
      packId,
      packName,
      startDate,
      endDate,
      totalExecutions,
      successRate,
      avgDurationMs,
      dailyStats,
      successTrend,
      adaptationAnalysis: {
        avgAdaptationsPerExecution,
        mostCommonAdaptationType,
        avgScaleFactor,
      },
    };
  }

  /**
   * Compare two pack executions.
   */
  static compareExecutions(
    baseline: DetailedPackMetrics,
    comparison: DetailedPackMetrics
  ): PackExecutionComparison {
    const generateSummary = (metrics: DetailedPackMetrics): PackExecutionSummary => ({
      packId: metrics.packId,
      packName: metrics.packName,
      packVersion: metrics.packVersion,
      executionId: metrics.id,
      deploymentId: metrics.id,
      startTime: new Date(metrics.startedAt).toISOString(),
      endTime: metrics.completedAt ? new Date(metrics.completedAt).toISOString() : '',
      durationMs: metrics.durationMs,
      success: metrics.status === 'completed',
      successRate: metrics.successRate,
      successRateByWorkflow: metrics.successRateByWorkflow.map((w) => ({
        workflowId: w.workflowId,
        successRate: w.successRate,
      })),
      totalSteps: metrics.totalSteps,
      completedSteps: metrics.completedSteps,
      failedSteps: metrics.failedSteps,
      skippedSteps: metrics.skippedSteps,
      adaptedSteps: metrics.adaptedSteps,
      elementNotFoundErrors: metrics.totalElementNotFoundErrors,
      fallbackMatches: 0,
      contextWarnings: 0,
      totalCoordinateAdaptations: metrics.totalCoordinateAdaptations,
      avgAdaptationScaleX: 0,
      avgAdaptationScaleY: 0,
      avgStepDurationMs: metrics.averageStepDuration,
      avgElementStability: metrics.qualitySummary.averageElementStability,
      avgTimingAccuracy: metrics.qualitySummary.averageTimingAccuracy,
      avgResultConfidence: metrics.qualitySummary.averageResultConfidence,
      workflowBreakdown: metrics.workflowDetails.map((w) => ({
        workflowId: w.workflowId,
        name: w.workflowName,
        success: w.status === 'completed',
        durationMs: w.durationMs,
        stepsCompleted: w.completedSteps,
        totalSteps: w.totalSteps,
      })),
    });

    const baselineSummary = generateSummary(baseline);
    const comparisonSummary = generateSummary(comparison);

    const changes = {
      durationChangeMs: comparisonSummary.durationMs - baselineSummary.durationMs,
      durationChangePercent: baselineSummary.durationMs > 0 ? 
        ((comparisonSummary.durationMs - baselineSummary.durationMs) / baselineSummary.durationMs) * 100 : 0,
      stepsCompletedChange: comparisonSummary.completedSteps - baselineSummary.completedSteps,
      successRateChange: comparisonSummary.successRate - baselineSummary.successRate,
      adaptedStepsChange: comparisonSummary.adaptedSteps - baselineSummary.adaptedSteps,
      elementNotFoundChange: comparisonSummary.elementNotFoundErrors - baselineSummary.elementNotFoundErrors,
    };

    const analysis = {
      improved: [] as string[],
      regressed: [] as string[],
      unchanged: [] as string[],
    };

    if (changes.durationChangeMs < 0) {
      analysis.improved.push('execution time');
    } else if (changes.durationChangeMs > 0) {
      analysis.regressed.push('execution time');
    }

    if (changes.successRateChange > 0) {
      analysis.improved.push('success rate');
    } else if (changes.successRateChange < 0) {
      analysis.regressed.push('success rate');
    }

    if (changes.stepsCompletedChange > 0) {
      analysis.improved.push('steps completed');
    } else if (changes.stepsCompletedChange < 0) {
      analysis.regressed.push('steps completed');
    }

    if (changes.elementNotFoundChange < 0) {
      analysis.improved.push('element matching reliability');
    } else if (changes.elementNotFoundChange > 0) {
      analysis.regressed.push('element matching reliability');
    }

    analysis.unchanged = Object.keys(changes).filter(
      (key) => changes[key as keyof typeof changes] === 0
    );

    return {
      baseline: baselineSummary,
      comparison: comparisonSummary,
      changes,
      analysis,
    };
  }

  /**
   * Clear all collected metrics.
   */
  clear(): void {
    this.packMetrics = null;
    this.workflowMetrics = null;
    this.stepMetrics = [];
    this.collectionStarted = false;
  }

  /**
   * Persist current metrics to storage.
   */
  async persist(): Promise<void> {
    if (this.packMetrics) {
      await this.storage.savePackMetrics(this.packMetrics);
    }
  }

  /**
   * Emit a metrics event.
   */
  private emitEvent(event: MetricsEvent): void {
    // In a full implementation, this would emit to an event bus
    // For now, we just log the event
    console.debug('Metrics event:', event.type, event);
  }
}

// ============================================================================
// Metrics Aggregation for Historical Analysis
// ============================================================================

/**
 * Aggregated metrics across multiple pack executions.
 */
export interface AggregatedPackMetrics {
  /** Pack identification */
  packId: string;
  packName: string;
  
  /** Time range covered */
  startDate: string;
  endDate: string;
  
  /** Aggregated statistics */
  totalExecutions: number;
  totalSuccesses: number;
  totalFailures: number;
  
  /** Success rate across all executions */
  successRate: number;
  
  /** Duration statistics */
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  
  /** Step statistics */
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  adaptedSteps: number;
  
  /** Element matching statistics */
  totalElementNotFoundErrors: number;
  totalFallbackMatches: number;
  
  /** Adaptation statistics */
  totalCoordinateAdaptations: number;
  avgAdaptationScaleX: number;
  avgAdaptationScaleY: number;
  
  /** Quality metrics */
  avgElementStability: number;
  avgTimingAccuracy: number;
  avgResultConfidence: number;
}

/**
 * Aggregator for pack metrics across multiple executions.
 */
export class PackMetricsAggregator {
  private executions: DetailedPackMetrics[] = [];

  /**
   * Add executions to aggregate.
   */
  addExecutions(executions: DetailedPackMetrics[]): void {
    this.executions.push(...executions);
  }

  /**
   * Aggregate all executions.
   */
  aggregate(): AggregatedPackMetrics {
    if (this.executions.length === 0) {
      throw new Error('No executions to aggregate');
    }

    const packId = this.executions[0].packId;
    const packName = this.executions[0].packName;

    const startDate = new Date(
      Math.min(...this.executions.map((e) => e.startedAt))
    ).toISOString();

    const endDate = new Date(
      Math.max(...this.executions.map((e) => 
        e.completedAt !== null ? e.completedAt : e.startedAt
      ))
    ).toISOString();

    const totalExecutions = this.executions.length;
    const totalSuccesses = this.executions.filter((e) => e.status === 'completed').length;
    const totalFailures = this.executions.filter((e) => e.status === 'failed').length;
    const successRate = totalExecutions > 0 ? totalSuccesses / totalExecutions : 0;

    const totalDurationMs = this.executions.reduce((sum, e) => sum + e.durationMs, 0);
    const avgDurationMs = totalExecutions > 0 ? totalDurationMs / totalExecutions : 0;
    const minDurationMs = Math.min(...this.executions.map((e) => e.durationMs));
    const maxDurationMs = Math.max(...this.executions.map((e) => e.durationMs));

    const totalSteps = this.executions.reduce((sum, e) => sum + e.totalSteps, 0);
    const completedSteps = this.executions.reduce((sum, e) => sum + e.completedSteps, 0);
    const failedSteps = this.executions.reduce((sum, e) => sum + e.failedSteps, 0);
    const adaptedSteps = this.executions.reduce((sum, e) => sum + e.adaptedSteps, 0);

    const totalElementNotFoundErrors = this.executions.reduce(
      (sum, e) => sum + e.totalElementNotFoundErrors, 0
    );
    const totalFallbackMatches = 0; // Would need to track this

    const totalCoordinateAdaptations = this.executions.reduce(
      (sum, e) => sum + e.totalCoordinateAdaptations, 0
    );

    const allScaleFactorsX = this.executions.flatMap((e) => 
      e.workflowDetails.flatMap((w) => w.coordinateAdaptations.map((a) => a.scaleX))
    );
    const allScaleFactorsY = this.executions.flatMap((e) => 
      e.workflowDetails.flatMap((w) => w.coordinateAdaptations.map((a) => a.scaleY))
    );

    const avgAdaptationScaleX = allScaleFactorsX.length > 0 ? 
      allScaleFactorsX.reduce((sum, s) => sum + s, 0) / allScaleFactorsX.length : 0;
    const avgAdaptationScaleY = allScaleFactorsY.length > 0 ? 
      allScaleFactorsY.reduce((sum, s) => sum + s, 0) / allScaleFactorsY.length : 0;

    const totalStepsCount = this.executions.reduce((sum, e) => 
      sum + e.workflowDetails.reduce((wSum, w) => wSum + w.stepDetails.length, 0), 0
    );

    const avgElementStability = totalStepsCount > 0 ? 
      this.executions.reduce((sum, e) => 
        sum + e.workflowDetails.reduce((wSum, w) => 
          wSum + w.qualitySummary.averageElementStability * w.stepDetails.length, 0
        ), 0
      ) / totalStepsCount : 0;

    const avgTimingAccuracy = totalStepsCount > 0 ? 
      this.executions.reduce((sum, e) => 
        sum + e.workflowDetails.reduce((wSum, w) => 
          wSum + w.qualitySummary.averageTimingAccuracy * w.stepDetails.length, 0
        ), 0
      ) / totalStepsCount : 0;

    const avgResultConfidence = totalStepsCount > 0 ? 
      this.executions.reduce((sum, e) => 
        sum + e.workflowDetails.reduce((wSum, w) => 
          wSum + w.qualitySummary.averageResultConfidence * w.stepDetails.length, 0
        ), 0
      ) / totalStepsCount : 0;

    return {
      packId,
      packName,
      startDate,
      endDate,
      totalExecutions,
      totalSuccesses,
      totalFailures,
      successRate,
      totalDurationMs,
      avgDurationMs,
      minDurationMs,
      maxDurationMs,
      totalSteps,
      completedSteps,
      failedSteps,
      adaptedSteps,
      totalElementNotFoundErrors,
      totalFallbackMatches,
      totalCoordinateAdaptations,
      avgAdaptationScaleX,
      avgAdaptationScaleY,
      avgElementStability,
      avgTimingAccuracy,
      avgResultConfidence,
    };
  }

  /**
   * Clear all aggregated executions.
   */
  clear(): void {
    this.executions = [];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique execution ID.
 */
export function generateExecutionId(): ExecutionId {
  return `pack-exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as ExecutionId;
}

/**
 * Generate a unique step ID.
 */
export function generateStepId(): ExecutionId {
  return `pack-step-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as ExecutionId;
}

/**
 * Create a new PackMetricsCollector with default options.
 */
export function createPackMetricsCollector(storage?: MetricsStorage): PackMetricsCollector {
  return new PackMetricsCollector(storage);
}