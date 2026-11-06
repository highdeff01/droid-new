/**
 * Metrics Collector Implementation
 *
 * Implements comprehensive metrics collection, aggregation, and reporting for
 * Pack deployments with full support for:
 * - Real-time metrics collection during pack execution
 * - Step, workflow, and pack level metrics tracking
 * - Element not-found error tracking with detailed categorization
 * - Coordinate adaptation tracking with scale factor analysis
 * - Success rate calculation and trend analysis
 * - Metrics aggregation for historical analysis
 * - Export/import for reporting and analytics
 * - Metrics persistence interface with multiple storage backends
 *
 * Requirements: 9.5, 25.5
 */

import type {
  ExecutionId,
  EntityId,
  DisplayState,
  ExecutionContext,
  BaseEvent,
  SystemEvent,
  EventDispatcher,
  WorkflowExecutionStartedEvent,
  WorkflowExecutionCompleteEvent,
  PackDeploymentStartedEvent,
  PackDeploymentCompleteEvent,
} from './integration-types.js';

import type {
  DetailedPackMetrics,
  DetailedWorkflowMetrics,
  DetailedStepMetrics,
  PackMetrics,
  WorkflowMetrics,
  StepMetrics,
  FailureReason,
  StepStatus,
  WorkflowStatus,
  PackStatus,
  ElementMatchMetrics,
  CoordinateAdaptationMetrics,
  MetricsCollectionOptions,
  MetricsEvent,
  MetricsStorage,
  InMemoryMetricsStorage,
  PackExecutionSummary,
  PackTrendData,
  AggregatedPackMetrics,
  PackMetricsCollector,
  generateExecutionId,
  generateStepId,
  createPackMetricsCollector,
} from './pack-execution-metrics.js';

// ============================================================================
// Metrics Collection State
// ============================================================================

/**
 * Current state of metrics collection.
 */
export interface MetricsCollectionState {
  /** Whether metrics collection is currently active */
  isActive: boolean;
  
  /** Current pack execution context */
  packContext?: PackExecutionContext;
  
  /** Current workflow execution context */
  workflowContext?: WorkflowExecutionContext;
  
  /** Current step execution context */
  stepContext?: StepExecutionContext;
  
  /** Metrics collector instance */
  collector: PackMetricsCollector;
}

/**
 * Context for a pack execution.
 */
export interface PackExecutionContext {
  packId: string;
  packName: string;
  packVersion: string;
  executionId: string;
  deploymentId: string;
  context: ExecutionContext;
}

/**
 * Context for a workflow execution.
 */
export interface WorkflowExecutionContext {
  workflowId: string;
  workflowName: string;
  stepCount: number;
  sourceDisplay?: DisplayState;
  targetDisplay?: DisplayState;
}

/**
 * Context for a step execution.
 */
export interface StepExecutionContext {
  stepIndex: number;
  stepName: string;
  action: string;
}

// ============================================================================
// Metrics Collection Manager
// ============================================================================

/**
 * Manages metrics collection across the entire automation system.
 * Coordinates collection at pack, workflow, and step levels.
 */
export class MetricsCollectionManager {
  private state: MetricsCollectionState = {
    isActive: false,
    collector: new PackMetricsCollector(),
  };

  constructor(
    private eventDispatcher?: EventDispatcher,
    private storage?: MetricsStorage,
    private collectionOptions: MetricsCollectionOptions = {}
  ) {
    this.state.collector = new PackMetricsCollector(
      storage || new InMemoryMetricsStorage(),
      collectionOptions
    );
  }

  /**
   * Start metrics collection for a pack deployment.
   */
  async startPackDeployment(
    packId: string,
    packName: string,
    packVersion: string,
    context: ExecutionContext
  ): Promise<void> {
    this.state.packContext = {
      packId,
      packName,
      packVersion,
      executionId: context.executionId,
      deploymentId: context.executionId,
      context,
    };

    this.state.collector.startPackMetrics(
      packId,
      packName,
      packVersion,
      context.executionId,
      context.executionId,
      {
        displayState: {
          width: context.displayState.width,
          height: context.displayState.height,
        },
        applicationName: context.applicationName,
      }
    );

    this.state.isActive = true;

    // Emit metrics started event if event dispatcher is available
    if (this.eventDispatcher) {
      const event: BaseEvent = {
        id: context.executionId,
        type: 'PackMetricsStarted',
        timestamp: new Date().toISOString(),
        source: 'pack',
        sourceId: packId,
        context: {
          packId,
          deploymentId: context.executionId,
        },
      };
      await this.eventDispatcher.emit(event as SystemEvent);
    }
  }

  /**
   * Start metrics collection for a workflow execution.
   */
  async startWorkflowExecution(
    workflowId: string,
    workflowName: string,
    stepCount: number,
    sourceDisplay?: DisplayState,
    targetDisplay?: DisplayState
  ): Promise<void> {
    if (!this.state.packContext) {
      throw new Error('Pack metrics collection not started');
    }

    this.state.workflowContext = {
      workflowId,
      workflowName,
      stepCount,
      sourceDisplay,
      targetDisplay,
    };

    this.state.collector.startWorkflowMetrics(
      workflowId,
      workflowName,
      stepCount,
      sourceDisplay,
      targetDisplay
    );
  }

  /**
   * Record a step execution update.
   */
  async recordStepUpdate(
    stepIndex: number,
    stepName: string,
    action: string,
    status: StepStatus,
    targetElement?: string,
    targetCoordinates?: { x: number; y: number }
  ): Promise<void> {
    if (!this.state.workflowContext) {
      throw new Error('Workflow metrics collection not started');
    }

    this.state.stepContext = {
      stepIndex,
      stepName,
      action,
    };

    this.state.collector.recordStepUpdate(
      stepIndex,
      stepName,
      action,
      status,
      targetElement,
      targetCoordinates
    );
  }

  /**
   * Record an element matching operation.
   */
  async recordElementMatch(
    stepIndex: number,
    strategy: 'selector' | 'accessibleName' | 'domPath' | 'fuzzy' | 'fallback',
    found: boolean,
    confidence: number,
    durationMs: number,
    originalSelector?: string,
    originalAccessibleName?: string,
    originalDomPath?: string[]
  ): Promise<void> {
    this.state.collector.recordElementMatch(
      stepIndex,
      strategy,
      found,
      confidence,
      durationMs,
      originalSelector,
      originalAccessibleName,
      originalDomPath
    );
  }

  /**
   * Record a coordinate adaptation operation.
   */
  async recordCoordinateAdaptation(
    stepIndex: number,
    sourceCoordinates: { x: number; y: number },
    sourceDisplay: DisplayState,
    targetCoordinates: { x: number; y: number },
    targetDisplay: DisplayState,
    adaptationType: 'none' | 'resolutionChange' | 'dpiChange' | 'multiDisplay' | 'perspective',
    confidence: number,
    durationMs: number
  ): Promise<void> {
    this.state.collector.recordCoordinateAdaptation(
      stepIndex,
      sourceCoordinates,
      sourceDisplay,
      targetCoordinates,
      targetDisplay,
      adaptationType,
      confidence,
      durationMs
    );
  }

  /**
   * Record an error during execution.
   */
  async recordError(
    stepIndex: number,
    errorType: FailureReason,
    message: string,
    recoverable: boolean = true
  ): Promise<void> {
    this.state.collector.recordError(stepIndex, errorType, message, recoverable);
  }

  /**
   * Complete workflow execution.
   */
  async completeWorkflowExecution(
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    if (!this.state.workflowContext) {
      throw new Error('Workflow metrics collection not started');
    }

    this.state.collector.completeWorkflowMetrics(success, errorMessage);

    // Emit workflow completed event if event dispatcher is available
    if (this.eventDispatcher && this.state.packContext) {
      const event: WorkflowExecutionCompleteEvent = {
        id: this.state.packContext.executionId as EntityId,
        type: 'WorkflowExecutionComplete',
        source: 'workflow',
        timestamp: new Date().toISOString(),
        sourceId: this.state.workflowContext.workflowId as EntityId,
        workflowId: this.state.workflowContext.workflowId as EntityId,
        deploymentId: this.state.packContext.deploymentId as EntityId,
        success,
        result: {
          executionId: this.state.packContext.executionId as EntityId,
          success,
          durationMs: this.state.collector.getWorkflowMetrics()?.durationMs || 0,
          context: this.state.packContext.context,
          lineage: {
            recordingId: undefined,
            workflowId: this.state.workflowContext.workflowId as EntityId,
            packId: this.state.packContext.packId as EntityId,
            habitId: undefined,
            originSource: 'workflow-composition',
            createdAt: new Date().toISOString(),
          },
        },
      };
      await this.eventDispatcher.emit(event);
    }

    this.state.workflowContext = undefined;
  }

  /**
   * Complete pack deployment.
   */
  async completePackDeployment(
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    if (!this.state.packContext) {
      throw new Error('Pack metrics collection not started');
    }

    this.state.collector.completePackMetrics(success, errorMessage);

    // Persist metrics to storage
    await this.state.collector.persist();

    // Emit pack completed event if event dispatcher is available
    if (this.eventDispatcher) {
      const metrics = this.state.collector.getPackMetrics();
      if (metrics) {
        const event: PackDeploymentCompleteEvent = {
          id: this.state.packContext.executionId as EntityId,
          type: 'PackDeploymentComplete',
          source: 'pack',
          timestamp: new Date().toISOString(),
          sourceId: this.state.packContext.packId as EntityId,
          packId: this.state.packContext.packId as EntityId,
          deploymentId: this.state.packContext.deploymentId as EntityId,
          success,
          workflowResults: metrics.workflowDetails.map((w) => ({
            workflowId: w.workflowId as EntityId,
            success: w.status === 'completed',
            durationMs: w.durationMs,
            output: undefined,
            error: w.status === 'failed' ? 'Execution failed' : undefined,
          })),
          totalDurationMs: metrics.durationMs,
          habitsToExtract: undefined,
        };
        await this.eventDispatcher.emit(event);
      }
    }

    this.state.packContext = undefined;
    this.state.isActive = false;
  }

  /**
   * Stop metrics collection without completing.
   */
  async stopCollection(): Promise<void> {
    this.state.collector.stopCollection();
    this.state.packContext = undefined;
    this.state.workflowContext = undefined;
    this.state.stepContext = undefined;
    this.state.isActive = false;
  }

  /**
   * Get current pack metrics.
   */
  getPackMetrics(): DetailedPackMetrics | null {
    return this.state.collector.getPackMetrics();
  }

  /**
   * Get current workflow metrics.
   */
  getWorkflowMetrics(): DetailedWorkflowMetrics | null {
    return this.state.collector.getWorkflowMetrics();
  }

  /**
   * Export metrics to JSON format.
   */
  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    return this.state.collector.exportMetrics(format);
  }

  /**
   * Generate an execution summary for reporting.
   */
  generateSummary(): PackExecutionSummary {
    return this.state.collector.generateSummary();
  }

  /**
   * Generate trend data for a pack.
   */
  static async generateTrendData(
    storage: MetricsStorage,
    packId: string
  ): Promise<PackTrendData> {
    return PackMetricsCollector.generateTrendData(storage, packId);
  }

  /**
   * Compare two pack executions.
   */
  static compareExecutions(
    baseline: DetailedPackMetrics,
    comparison: DetailedPackMetrics
  ): PackExecutionComparison {
    return PackMetricsCollector.compareExecutions(baseline, comparison);
  }

  /**
   * Aggregate metrics across multiple executions.
   */
  static aggregate(
    executions: DetailedPackMetrics[]
  ): AggregatedPackMetrics {
    const aggregator = new PackMetricsAggregator();
    aggregator.addExecutions(executions);
    return aggregator.aggregate();
  }

  /**
   * Clear all collected metrics.
   */
  clear(): void {
    this.state.collector.clear();
    this.state.packContext = undefined;
    this.state.workflowContext = undefined;
    this.state.stepContext = undefined;
    this.state.isActive = false;
  }

  /**
   * Check if metrics collection is active.
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Get current metrics state.
   */
  getState(): MetricsCollectionState {
    return this.state;
  }
}

// ============================================================================
// Metrics Aggregation Service
// ============================================================================

/**
 * Service for aggregating and analyzing metrics across multiple executions.
 */
export class MetricsAggregationService {
  constructor(private storage: MetricsStorage) {}

  /**
   * Get aggregated metrics for a pack.
   */
  async getPackAggregates(packId: string): Promise<AggregatedPackMetrics> {
    const executions = await this.storage.loadPackMetricsByPackId(packId);
    if (executions.length === 0) {
      throw new Error(`No executions found for pack: ${packId}`);
    }
    return PackMetricsAggregator.aggregate(executions);
  }

  /**
   * Get trend data for a pack.
   */
  async getPackTrends(packId: string): Promise<PackTrendData> {
    return PackMetricsCollector.generateTrendData(this.storage, packId);
  }

  /**
   * Compare two pack executions.
   */
  async compareExecutions(
    executionId1: string,
    executionId2: string
  ): Promise<PackExecutionComparison> {
    const execution1 = await this.storage.loadPackMetrics(executionId1);
    const execution2 = await this.storage.loadPackMetrics(executionId2);

    if (!execution1 || !execution2) {
      throw new Error('Executions not found');
    }

    return PackMetricsCollector.compareExecutions(execution1, execution2);
  }

  /**
   * Get success rate trends over time.
   */
  async getSuccessRateTrends(
    packId: string,
    timeRange: { start: Date; end: Date }
  ): Promise<Array<{ date: string; successRate: number; totalExecutions: number }>> {
    const executions = await this.storage.queryMetrics({
      packId,
      startTime: timeRange.start.getTime(),
      endTime: timeRange.end.getTime(),
    });

    const dailyStats = new Map<string, {
      total: number;
      successes: number;
    }>();

    executions.forEach((e) => {
      const date = new Date(e.startedAt).toISOString().split('T')[0];
      const dayData = dailyStats.get(date) || { total: 0, successes: 0 };

      dayData.total++;
      if (e.status === 'completed') {
        dayData.successes++;
      }

      dailyStats.set(date, dayData);
    });

    return Array.from(dailyStats.entries()).map(([date, data]) => ({
      date,
      successRate: data.total > 0 ? data.successes / data.total : 0,
      totalExecutions: data.total,
    }));
  }

  /**
   * Get element matching reliability metrics.
   */
  async getElementMatchingMetrics(
    packId: string
  ): Promise<{
    totalElements: number;
    elementsFound: number;
    elementNotFoundErrors: number;
    successRate: number;
    avgConfidence: number;
    bestMatchStrategy: string;
  }> {
    const executions = await this.storage.loadPackMetricsByPackId(packId);

    let totalElements = 0;
    let elementsFound = 0;
    let elementNotFoundErrors = 0;
    let totalConfidence = 0;
    const strategyCounts: Record<string, number> = {};

    executions.forEach((e) => {
      e.workflowDetails.forEach((w) => {
        w.stepDetails.forEach((s) => {
          if (s.elementMatch) {
            totalElements++;
            totalConfidence += s.elementMatch.confidence;

            if (s.elementMatch.found) {
              elementsFound++;
            }

            strategyCounts[s.elementMatch.matchStrategy] = 
              (strategyCounts[s.elementMatch.matchStrategy] || 0) + 1;
          }

          if (s.error === 'element-not-found') {
            elementNotFoundErrors++;
          }
        });
      });
    });

    return {
      totalElements,
      elementsFound,
      elementNotFoundErrors,
      successRate: totalElements > 0 ? elementsFound / totalElements : 0,
      avgConfidence: elementsFound > 0 ? totalConfidence / elementsFound : 0,
      bestMatchStrategy: Object.entries(strategyCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
    };
  }

  /**
   * Get coordinate adaptation metrics.
   */
  async getCoordinateAdaptationMetrics(
    packId: string
  ): Promise<{
    totalAdaptations: number;
    avgScaleX: number;
    avgScaleY: number;
    adaptationTypes: Record<string, number>;
    avgConfidence: number;
  }> {
    const executions = await this.storage.loadPackMetricsByPackId(packId);

    let totalAdaptations = 0;
    let totalScaleX = 0;
    let totalScaleY = 0;
    const adaptationTypes: Record<string, number> = {};
    let totalConfidence = 0;

    executions.forEach((e) => {
      e.workflowDetails.forEach((w) => {
        w.coordinateAdaptations.forEach((a) => {
          totalAdaptations++;
          totalScaleX += a.scaleX;
          totalScaleY += a.scaleY;
          totalConfidence += a.confidence;

          adaptationTypes[a.adaptationType] = 
            (adaptationTypes[a.adaptationType] || 0) + 1;
        });
      });
    });

    return {
      totalAdaptations,
      avgScaleX: totalAdaptations > 0 ? totalScaleX / totalAdaptations : 0,
      avgScaleY: totalAdaptations > 0 ? totalScaleY / totalAdaptations : 0,
      adaptationTypes,
      avgConfidence: totalAdaptations > 0 ? totalConfidence / totalAdaptations : 0,
    };
  }

  /**
   * Get timing breakdown metrics.
   */
  async getTimingBreakdownMetrics(
    packId: string
  ): Promise<{
    avgContextVerificationMs: number;
    avgElementMatchingMs: number;
    avgCoordinateAdaptationMs: number;
    avgActionExecutionMs: number;
    avgResultVerificationMs: number;
  }> {
    const executions = await this.storage.loadPackMetricsByPackId(packId);

    let totalContextVerification = 0;
    let totalElementMatching = 0;
    let totalCoordinateAdaptation = 0;
    let totalActionExecution = 0;
    let totalResultVerification = 0;
    let totalSteps = 0;

    executions.forEach((e) => {
      e.workflowDetails.forEach((w) => {
        w.stepDetails.forEach((s) => {
          totalContextVerification += s.timingBreakdown.contextVerificationMs;
          totalElementMatching += s.timingBreakdown.elementMatchingMs;
          totalCoordinateAdaptation += s.timingBreakdown.coordinateAdaptationMs;
          totalActionExecution += s.timingBreakdown.actionExecutionMs;
          totalResultVerification += s.timingBreakdown.resultVerificationMs;
          totalSteps++;
        });
      });
    });

    return {
      avgContextVerificationMs: totalSteps > 0 ? totalContextVerification / totalSteps : 0,
      avgElementMatchingMs: totalSteps > 0 ? totalElementMatching / totalSteps : 0,
      avgCoordinateAdaptationMs: totalSteps > 0 ? totalCoordinateAdaptation / totalSteps : 0,
      avgActionExecutionMs: totalSteps > 0 ? totalActionExecution / totalSteps : 0,
      avgResultVerificationMs: totalSteps > 0 ? totalResultVerification / totalSteps : 0,
    };
  }
}

// ============================================================================
// Metrics Export Service
// ============================================================================

/**
 * Service for exporting metrics to various formats.
 */
export class MetricsExportService {
  constructor(private storage: MetricsStorage) {}

  /**
   * Export metrics to JSON format.
   */
  async exportToJson(
    executionId: string
  ): Promise<string> {
    const metrics = await this.storage.loadPackMetrics(executionId);
    if (!metrics) {
      throw new Error(`Metrics not found for execution: ${executionId}`);
    }
    return JSON.stringify(metrics, null, 2);
  }

  /**
   * Export metrics to CSV format.
   */
  async exportToCsv(executionId: string): Promise<string> {
    const metrics = await this.storage.loadPackMetrics(executionId);
    if (!metrics) {
      throw new Error(`Metrics not found for execution: ${executionId}`);
    }

    const rows: string[] = [];

    // Pack summary
    rows.push('Pack Metrics Summary');
    rows.push(`Pack ID,${metrics.packId}`);
    rows.push(`Pack Name,${metrics.packName}`);
    rows.push(`Pack Version,${metrics.packVersion}`);
    rows.push(`Execution ID,${metrics.id}`);
    rows.push(`Status,${metrics.status}`);
    rows.push(`Success,${metrics.status === 'completed'}`);
    rows.push(`Duration (ms),${metrics.durationMs}`);
    rows.push(`Total Steps,${metrics.totalSteps}`);
    rows.push(`Completed Steps,${metrics.completedSteps}`);
    rows.push(`Failed Steps,${metrics.failedSteps}`);
    rows.push(`Adapted Steps,${metrics.adaptedSteps}`);
    rows.push(`Success Rate,${metrics.successRate}`);
    rows.push(`Element Not Found Errors,${metrics.totalElementNotFoundErrors}`);
    rows.push(`Coordinate Adaptations,${metrics.totalCoordinateAdaptations}`);
    rows.push('');
    
    // Workflow breakdown
    rows.push('Workflow Breakdown');
    rows.push('Workflow ID,Name,Status,Success,Duration (ms),Steps Completed,Total Steps,Success Rate');
    metrics.workflowDetails.forEach((w) => {
      rows.push(`${w.workflowId},${w.workflowName},${w.status},${w.status === 'completed'},${w.durationMs},${w.completedSteps},${w.totalSteps},${w.successRate}`);
    });

    return rows.join('\n');
  }

  /**
   * Export metrics to Markdown format.
   */
  async exportToMarkdown(executionId: string): Promise<string> {
    const metrics = await this.storage.loadPackMetrics(executionId);
    if (!metrics) {
      throw new Error(`Metrics not found for execution: ${executionId}`);
    }

    const lines: string[] = [];

    lines.push(`# Pack Execution Metrics: ${metrics.packName}`);
    lines.push('');
    lines.push('## Summary');
    lines.push(`- **Pack ID**: ${metrics.packId}`);
    lines.push(`- **Version**: ${metrics.packVersion}`);
    lines.push(`- **Status**: ${metrics.status}`);
    lines.push(`- **Success**: ${metrics.status === 'completed'}`);
    lines.push(`- **Duration**: ${metrics.durationMs} ms`);
    lines.push(`- **Success Rate**: ${(metrics.successRate * 100).toFixed(1)}%`);
    lines.push('');

    lines.push('## Step Statistics');
    lines.push(`- **Total Steps**: ${metrics.totalSteps}`);
    lines.push(`- **Completed**: ${metrics.completedSteps}`);
    lines.push(`- **Failed**: ${metrics.failedSteps}`);
    lines.push(`- **Adapted**: ${metrics.adaptedSteps}`);
    lines.push('');

    lines.push('## Element Matching');
    lines.push(`- **Element Not Found Errors**: ${metrics.totalElementNotFoundErrors}`);
    lines.push('');

    lines.push('## Coordinate Adaptation');
    lines.push(`- **Total Adaptations**: ${metrics.totalCoordinateAdaptations}`);
    lines.push(`- **Average Scale Factor**: ${metrics.averageAdaptationScaleFactor.toFixed(2)}`);
    lines.push('');

    lines.push('## Workflow Breakdown');
    lines.push('| Workflow | Status | Success Rate | Duration (ms) |');
    lines.push('|----------|--------|--------------|---------------|');
    metrics.workflowDetails.forEach((w) => {
      lines.push(`| ${w.workflowName} | ${w.status} | ${(w.successRate * 100).toFixed(1)}% | ${w.durationMs} |`);
    });

    return lines.join('\n');
  }
}

// ============================================================================
// Metrics Persistence Implementations
// ============================================================================

/**
 * Local storage implementation for metrics persistence.
 * Uses browser's localStorage for persistence.
 */
export class LocalStorageMetricsStorage implements MetricsStorage {
  private readonly STORAGE_KEY = 'automation_metrics';

  async savePackMetrics(metrics: DetailedPackMetrics): Promise<void> {
    const data = await this.loadAll();
    data.push(metrics);
    await this.saveAll(data);
  }

  async loadPackMetrics(executionId: string): Promise<DetailedPackMetrics | null> {
    const data = await this.loadAll();
    return data.find((m) => m.id === executionId) ?? null;
  }

  async loadPackMetricsByPackId(packId: string): Promise<DetailedPackMetrics[]> {
    const data = await this.loadAll();
    return data.filter((m) => m.packId === packId);
  }

  async loadAllPackMetrics(): Promise<DetailedPackMetrics[]> {
    return this.loadAll();
  }

  async deletePackMetrics(executionId: string): Promise<void> {
    const data = await this.loadAll();
    const filtered = data.filter((m) => m.id !== executionId);
    await this.saveAll(filtered);
  }

  async saveWorkflowMetrics(metrics: DetailedWorkflowMetrics): Promise<void> {
    const data = await this.loadAll();
    data.forEach((m) => {
      if (m.id === metrics.id) {
        m.workflowDetails = [metrics, ...m.workflowDetails.filter((w) => w.id !== metrics.id)];
      }
    });
    await this.saveAll(data);
  }

  async loadWorkflowMetrics(executionId: string): Promise<DetailedWorkflowMetrics | null> {
    const data = await this.loadAll();
    for (const metrics of data) {
      const workflow = metrics.workflowDetails.find((w) => w.id === executionId);
      if (workflow) {
        return workflow;
      }
    }
    return null;
  }

  async loadWorkflowMetricsByWorkflowId(workflowId: string): Promise<DetailedWorkflowMetrics[]> {
    const data = await this.loadAll();
    const results: DetailedWorkflowMetrics[] = [];
    data.forEach((m) => {
      m.workflowDetails.forEach((w) => {
        if (w.workflowId === workflowId) {
          results.push(w);
        }
      });
    });
    return results;
  }

  async deleteWorkflowMetrics(executionId: string): Promise<void> {
    const data = await this.loadAll();
    const filtered = data.map((m) => ({
      ...m,
      workflowDetails: m.workflowDetails.filter((w) => w.id !== executionId),
    }));
    await this.saveAll(filtered);
  }

  async saveStepMetrics(metrics: DetailedStepMetrics): Promise<void> {
    const data = await this.loadAll();
    data.forEach((m) => {
      if (m.id === metrics.id) {
        m.workflowDetails.forEach((w) => {
          if (w.id === metrics.id) {
            w.stepDetails = [metrics, ...w.stepDetails.filter((s) => s.id !== metrics.id)];
          }
        });
      }
    });
    await this.saveAll(data);
  }

  async loadStepMetrics(stepId: string): Promise<DetailedStepMetrics | null> {
    const data = await this.loadAll();
    for (const m of data) {
      for (const w of m.workflowDetails) {
        const step = w.stepDetails.find((s) => s.id === stepId);
        if (step) {
          return step;
        }
      }
    }
    return null;
  }

  async deleteStepMetrics(stepId: string): Promise<void> {
    const data = await this.loadAll();
    const filtered = data.map((m) => ({
      ...m,
      workflowDetails: m.workflowDetails.map((w) => ({
        ...w,
        stepDetails: w.stepDetails.filter((s) => s.id !== stepId),
      })),
    }));
    await this.saveAll(filtered);
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
    let results = await this.loadAll();

    if (options.packId) {
      results = results.filter((m) => m.packId === options.packId);
    }

    if (options.workflowId) {
      results = results.filter((m) =>
        m.workflowDetails.some((w) => w.workflowId === options.workflowId)
      );
    }

    if (options.startTime) {
      results = results.filter((m) => m.startedAt >= options.startTime);
    }

    if (options.endTime) {
      results = results.filter((m) => 
        m.completedAt && m.completedAt <= options.endTime
      );
    }

    if (options.success !== undefined) {
      results = results.filter((m) => 
        (options.success === true) === (m.status === 'completed')
      );
    }

    const offset = options.offset || 0;
    const limit = options.limit || results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  private async loadAll(): Promise<DetailedPackMetrics[]> {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (!data) {
        return [];
      }
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load metrics from localStorage:', error);
      return [];
    }
  }

  private async saveAll(data: DetailedPackMetrics[]): Promise<void> {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save metrics to localStorage:', error);
    }
  }
}

/**
 * Session storage implementation for metrics persistence.
 * Uses browser's sessionStorage for temporary persistence.
 */
export class SessionStorageMetricsStorage implements MetricsStorage {
  private readonly STORAGE_KEY = 'automation_metrics_session';

  async savePackMetrics(metrics: DetailedPackMetrics): Promise<void> {
    const data = await this.loadAll();
    data.push(metrics);
    await this.saveAll(data);
  }

  async loadPackMetrics(executionId: string): Promise<DetailedPackMetrics | null> {
    const data = await this.loadAll();
    return data.find((m) => m.id === executionId) ?? null;
  }

  async loadPackMetricsByPackId(packId: string): Promise<DetailedPackMetrics[]> {
    const data = await this.loadAll();
    return data.filter((m) => m.packId === packId);
  }

  async loadAllPackMetrics(): Promise<DetailedPackMetrics[]> {
    return this.loadAll();
  }

  async deletePackMetrics(executionId: string): Promise<void> {
    const data = await this.loadAll();
    const filtered = data.filter((m) => m.id !== executionId);
    await this.saveAll(filtered);
  }

  async saveWorkflowMetrics(metrics: DetailedWorkflowMetrics): Promise<void> {
    const data = await this.loadAll();
    data.forEach((m) => {
      if (m.id === metrics.id) {
        m.workflowDetails = [metrics, ...m.workflowDetails.filter((w) => w.id !== metrics.id)];
      }
    });
    await this.saveAll(data);
  }

  async loadWorkflowMetrics(executionId: string): Promise<DetailedWorkflowMetrics | null> {
    const data = await this.loadAll();
    for (const metrics of data) {
      const workflow = metrics.workflowDetails.find((w) => w.id === executionId);
      if (workflow) {
        return workflow;
      }
    }
    return null;
  }

  async loadWorkflowMetricsByWorkflowId(workflowId: string): Promise<DetailedWorkflowMetrics[]> {
    const data = await this.loadAll();
    const results: DetailedWorkflowMetrics[] = [];
    data.forEach((m) => {
      m.workflowDetails.forEach((w) => {
        if (w.workflowId === workflowId) {
          results.push(w);
        }
      });
    });
    return results;
  }

  async deleteWorkflowMetrics(executionId: string): Promise<void> {
    const data = await this.loadAll();
    const filtered = data.map((m) => ({
      ...m,
      workflowDetails: m.workflowDetails.filter((w) => w.id !== executionId),
    }));
    await this.saveAll(filtered);
  }

  async saveStepMetrics(metrics: DetailedStepMetrics): Promise<void> {
    const data = await this.loadAll();
    data.forEach((m) => {
      if (m.id === metrics.id) {
        m.workflowDetails.forEach((w) => {
          if (w.id === metrics.id) {
            w.stepDetails = [metrics, ...w.stepDetails.filter((s) => s.id !== metrics.id)];
          }
        });
      }
    });
    await this.saveAll(data);
  }

  async loadStepMetrics(stepId: string): Promise<DetailedStepMetrics | null> {
    const data = await this.loadAll();
    for (const m of data) {
      for (const w of m.workflowDetails) {
        const step = w.stepDetails.find((s) => s.id === stepId);
        if (step) {
          return step;
        }
      }
    }
    return null;
  }

  async deleteStepMetrics(stepId: string): Promise<void> {
    const data = await this.loadAll();
    const filtered = data.map((m) => ({
      ...m,
      workflowDetails: m.workflowDetails.map((w) => ({
        ...w,
        stepDetails: w.stepDetails.filter((s) => s.id !== stepId),
      })),
    }));
    await this.saveAll(filtered);
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
    let results = await this.loadAll();

    if (options.packId) {
      results = results.filter((m) => m.packId === options.packId);
    }

    if (options.workflowId) {
      results = results.filter((m) =>
        m.workflowDetails.some((w) => w.workflowId === options.workflowId)
      );
    }

    if (options.startTime) {
      results = results.filter((m) => m.startedAt >= options.startTime);
    }

    if (options.endTime) {
      results = results.filter((m) => 
        m.completedAt && m.completedAt <= options.endTime
      );
    }

    if (options.success !== undefined) {
      results = results.filter((m) => 
        (options.success === true) === (m.status === 'completed')
      );
    }

    const offset = options.offset || 0;
    const limit = options.limit || results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  private async loadAll(): Promise<DetailedPackMetrics[]> {
    try {
      const data = sessionStorage.getItem(this.STORAGE_KEY);
      if (!data) {
        return [];
      }
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load metrics from sessionStorage:', error);
      return [];
    }
  }

  private async saveAll(data: DetailedPackMetrics[]): Promise<void> {
    try {
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save metrics to sessionStorage:', error);
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a new metrics collection manager.
 */
export function createMetricsCollectionManager(
  eventDispatcher?: EventDispatcher,
  storage?: MetricsStorage,
  options?: MetricsCollectionOptions
): MetricsCollectionManager {
  return new MetricsCollectionManager(eventDispatcher, storage, options);
}

/**
 * Create a new metrics aggregation service.
 */
export function createMetricsAggregationService(storage: MetricsStorage): MetricsAggregationService {
  return new MetricsAggregationService(storage);
}

/**
 * Create a new metrics export service.
 */
export function createMetricsExportService(storage: MetricsStorage): MetricsExportService {
  return new MetricsExportService(storage);
}

/**
 * Create a new metrics storage instance.
 */
export function createMetricsStorage(
  type: 'memory' | 'local' | 'session' = 'memory'
): MetricsStorage {
  switch (type) {
    case 'local':
      return new LocalStorageMetricsStorage();
    case 'session':
      return new SessionStorageMetricsStorage();
    case 'memory':
    default:
      return new InMemoryMetricsStorage();
  }
}