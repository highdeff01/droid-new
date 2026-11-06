/**
 * Event Dispatcher and Message Bus
 *
 * Central hub for event-driven messaging between automation engine systems.
 * Implements all 10+ event types with discriminated unions for type safety.
 *
 * Event Types:
 * - RecordingCapturedEvent
 * - WorkflowCreatedEvent
 * - WorkflowUpdatedEvent
 * - PackCreatedEvent
 * - PackModifiedEvent
 * - PackDeployedEvent
 * - PackUpdatedEvent
 * - HabitExtractedEvent
 * - HabitUpdatedEvent
 * - ExecutionCompleteEvent
 * - ExecutionFailedEvent
 * - ContextChangedEvent
 */

import type { Recording } from './recording-types';
import type { Workflow } from './workflow-types';
import type { Pack } from './pack-types';
import type { Habit } from './habit-types';

/**
 * Unique identifier for events
 */
export type EventId = string & { readonly __brand: 'EventId' };

/**
 * ISO 8601 timestamp
 */
export type Timestamp = string & { readonly __brand: 'Timestamp' };

/**
 * Base event interface
 */
export interface BaseEvent {
  readonly id: EventId;
  readonly type: string;
  readonly timestamp: Timestamp;
  readonly source: string;
}

/**
 * Event types for the automation engine
 */
export type AutomationEvent =
  | RecordingCapturedEvent
  | WorkflowCreatedEvent
  | WorkflowUpdatedEvent
  | PackCreatedEvent
  | PackModifiedEvent
  | PackDeployedEvent
  | PackUpdatedEvent
  | HabitExtractedEvent
  | HabitUpdatedEvent
  | ExecutionCompleteEvent
  | ExecutionFailedEvent
  | ContextChangedEvent;

/**
 * Recording captured event
 */
export interface RecordingCapturedEvent extends BaseEvent {
  readonly type: 'RecordingCaptured';
  readonly recording: Recording;
}

/**
 * Workflow created event
 */
export interface WorkflowCreatedEvent extends BaseEvent {
  readonly type: 'WorkflowCreated';
  readonly workflow: Workflow;
  readonly sourceRecording?: string;
}

/**
 * Workflow updated event
 */
export interface WorkflowUpdatedEvent extends BaseEvent {
  readonly type: 'WorkflowUpdated';
  readonly workflow: Workflow;
  readonly changes: unknown;
}

/**
 * Pack created event
 */
export interface PackCreatedEvent extends BaseEvent {
  readonly type: 'PackCreated';
  readonly pack: Pack;
}

/**
 * Pack modified event
 */
export interface PackModifiedEvent extends BaseEvent {
  readonly type: 'PackModified';
  readonly packId: string;
  readonly changes: unknown;
}

/**
 * Pack deployed event
 */
export interface PackDeployedEvent extends BaseEvent {
  readonly type: 'PackDeployed';
  readonly packId: string;
  readonly results: unknown;
}

/**
 * Pack updated event
 */
export interface PackUpdatedEvent extends BaseEvent {
  readonly type: 'PackUpdated';
  readonly pack: Pack;
}

/**
 * Habit extracted event
 */
export interface HabitExtractedEvent extends BaseEvent {
  readonly type: 'HabitExtracted';
  readonly habit: Habit;
  readonly sourceWorkflow?: string;
}

/**
 * Habit updated event
 */
export interface HabitUpdatedEvent extends BaseEvent {
  readonly type: 'HabitUpdated';
  readonly habit: Habit;
  readonly changes: unknown;
}

/**
 * Execution complete event
 */
export interface ExecutionCompleteEvent extends BaseEvent {
  readonly type: 'ExecutionComplete';
  readonly executionId: string;
  readonly results: unknown;
  readonly failedSteps?: number;
}

/**
 * Execution failed event
 */
export interface ExecutionFailedEvent extends BaseEvent {
  readonly type: 'ExecutionFailed';
  readonly executionId: string;
  readonly error: string;
  readonly failedStep?: string;
}

/**
 * Context changed event
 */
export interface ContextChangedEvent extends BaseEvent {
  readonly type: 'ContextChanged';
  readonly oldContext: string;
  readonly newContext: string;
}

/**
 * Event subscription interface
 */
export interface EventSubscription<T extends AutomationEvent = AutomationEvent> {
  readonly id: string;
  readonly handler: (event: T) => void;
  readonly eventType?: string;
  readonly filter?: (event: T) => boolean;
}

/**
 * Event dispatcher class
 */
export class EventDispatcher {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private auditTrail: BaseEvent[] = [];
  private auditLimit = 1000;

  /**
   * Subscribe to events
   */
  subscribe<T extends AutomationEvent>(
    handler: (event: T) => void,
    options?: {
      eventType?: string;
      filter?: (event: T) => boolean;
    }
  ): string {
    const id = this.generateId();
    const subscription: EventSubscription<T> = {
      id,
      handler,
      eventType: options?.eventType,
      filter: options?.filter,
    };

    const eventType = options?.eventType || 'all';
    const subs = this.subscriptions.get(eventType) || [];
    subs.push(subscription as EventSubscription);
    this.subscriptions.set(eventType, subs);

    return id;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): boolean {
    let removed = false;
    for (const [eventType, subs] of this.subscriptions.entries()) {
      const filtered = subs.filter(s => s.id !== subscriptionId);
      if (filtered.length !== subs.length) {
        this.subscriptions.set(eventType, filtered);
        removed = true;
      }
    }
    return removed;
  }

  /**
   * Emit an event
   */
  emit<T extends AutomationEvent>(event: T): void {
    const timestamp = new Date().toISOString();
    const typedEvent = { ...event, timestamp, id: this.generateId() } as T & {
      readonly timestamp: Timestamp;
      readonly id: EventId;
    };

    // Add to audit trail
    this.auditTrail.push(typedEvent);
    if (this.auditTrail.length > this.auditLimit) {
      this.auditTrail.shift();
    }

    // Notify all subscribers
    const eventType = typedEvent.type;
    const allSubs = this.subscriptions.get('all') || [];
    const typeSubs = this.subscriptions.get(eventType) || [];

    for (const sub of allSubs.concat(typeSubs)) {
      if (!sub.filter || sub.filter(typedEvent as never)) {
        sub.handler(typedEvent);
      }
    }
  }

  /**
   * Get audit trail
   */
  getAuditTrail(): BaseEvent[] {
    return [...this.auditTrail];
  }

  /**
   * Clear audit trail
   */
  clearAuditTrail(): void {
    this.auditTrail = [];
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return 'evt_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

/**
 * Global event dispatcher instance
 */
export const globalEventDispatcher = new EventDispatcher();
