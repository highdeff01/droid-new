import type { WorkflowStep } from './types.js';

/**
 * Portable, bounded workflow state for controller handoff.
 *
 * Screenshots are deliberately represented by IDs, not serialized data URLs/ImageData.
 * A receiving controller may preserve a completed step only when its action fingerprint
 * still matches AND its post-action evidence frame is still available in the local gallery.
 * Every other step is reset to pending so a handoff never treats an unverified action as done.
 */
export const WORKFLOW_HANDOFF_VERSION = 1;

export interface WorkflowStepHandoff {
  id: string;
  fingerprint: string;
  verifiedAt?: number;
  evidenceFrameId?: number;
  evidenceFrameTime?: number;
  /** Execution outcome is diagnostic only; it never makes an unverified step complete. */
  previousStatus: WorkflowStep['status'];
  lastDrift?: number;
  lastDriftPx?: number;
}

export interface WorkflowHandoffSnapshot {
  version: typeof WORKFLOW_HANDOFF_VERSION;
  workflowId: string;
  goal: string;
  createdAt: number;
  fromController: string;
  currentIndex: number;
  steps: WorkflowStepHandoff[];
}

export interface WorkflowHandoffResult {
  steps: WorkflowStep[];
  resumedIndex: number;
  preservedVerified: number;
  resetUnverified: number;
  rejected: boolean;
  reason: string;
}

const cleanText = (value: unknown, max = 2_000): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

/** Fingerprint only fields that change what the step will execute. */
export function workflowStepFingerprint(step: WorkflowStep): string {
  return JSON.stringify({
    id: step.id,
    name: step.name,
    action: step.action,
    x: step.x,
    y: step.y,
    text: step.text ?? '',
    target: step.target ?? '',
    endX: step.endX ?? null,
    endY: step.endY ?? null,
    endTarget: step.endTarget ?? '',
    mappedId: step.mappedId ?? '',
    repeat: step.repeat ?? 1,
    expectedOutcome: step.expectedOutcome ?? '',
  });
}

/** Create a compact handoff record. No screenshot bytes, credentials, or arbitrary context are copied. */
export function createWorkflowHandoff(
  workflowId: string,
  goal: string,
  steps: WorkflowStep[],
  fromController: string,
  now = Date.now(),
): WorkflowHandoffSnapshot {
  const safeId = cleanText(workflowId, 160).trim();
  if (!safeId) throw new Error('A workflow ID is required for handoff');
  if (!Array.isArray(steps) || steps.length > 500) throw new Error('Workflow handoff supports at most 500 steps');
  const safeController = cleanText(fromController, 80).trim() || 'unknown';
  const currentIndex = Math.max(0, steps.findIndex((step) => step.verifiedAt === undefined));
  return {
    version: WORKFLOW_HANDOFF_VERSION,
    workflowId: safeId,
    goal: cleanText(goal, 2_000),
    createdAt: Number.isFinite(now) ? now : Date.now(),
    fromController: safeController,
    currentIndex: currentIndex < 0 ? steps.length : currentIndex,
    steps: steps.map((step) => {
      const evidence = step.afterFrame ?? step.shot;
      return {
        id: cleanText(step.id, 160),
        fingerprint: workflowStepFingerprint(step),
        ...(Number.isFinite(step.verifiedAt) ? { verifiedAt: step.verifiedAt } : {}),
        ...(evidence && Number.isFinite(evidence.id) ? { evidenceFrameId: evidence.id, evidenceFrameTime: evidence.time } : {}),
        previousStatus: step.status,
        ...(Number.isFinite(step.drift) ? { lastDrift: step.drift } : {}),
        ...(Number.isFinite(step.driftPx) ? { lastDriftPx: step.driftPx } : {}),
      };
    }),
  };
}

/**
 * Restore progress onto the receiving controller's current workflow definition.
 * Identity/order/goal mismatches reject the whole snapshot. Individual changed steps
 * lose their completion marker. A completion survives only with a still-available
 * post-action frame; otherwise it is pending and must be re-verified.
 */
export function restoreWorkflowHandoff(
  snapshot: WorkflowHandoffSnapshot,
  workflowId: string,
  goal: string,
  currentSteps: WorkflowStep[],
  availableFrameIds: ReadonlySet<number>,
): WorkflowHandoffResult {
  const rejected = (reason: string): WorkflowHandoffResult => ({
    steps: currentSteps.map((step) => ({ ...step, status: 'pending', verifiedAt: undefined })),
    resumedIndex: 0,
    preservedVerified: 0,
    resetUnverified: currentSteps.length,
    rejected: true,
    reason,
  });

  if (!snapshot || snapshot.version !== WORKFLOW_HANDOFF_VERSION) return rejected('Unsupported or missing workflow handoff version');
  if (snapshot.workflowId !== workflowId) return rejected('Workflow ID does not match; handoff was not applied');
  if (snapshot.goal !== cleanText(goal, 2_000)) return rejected('Workflow goal changed; handoff was not applied');
  if (!Array.isArray(snapshot.steps) || snapshot.steps.length !== currentSteps.length || snapshot.steps.length > 500) {
    return rejected('Workflow step count changed; handoff was not applied');
  }

  let preservedVerified = 0;
  let resetUnverified = 0;
  const steps = currentSteps.map((step, index) => {
    const prior = snapshot.steps[index];
    const sameStep = !!prior && prior.id === step.id && prior.fingerprint === workflowStepFingerprint(step);
    const evidenceAvailable = prior?.evidenceFrameId !== undefined && availableFrameIds.has(prior.evidenceFrameId);
    const canPreserve = sameStep && Number.isFinite(prior?.verifiedAt) && evidenceAvailable;

    if (canPreserve) {
      preservedVerified++;
      return {
        ...step,
        status: 'done' as const,
        verifiedAt: prior!.verifiedAt,
        drift: prior!.lastDrift,
        driftPx: prior!.lastDriftPx,
      };
    }

    resetUnverified++;
    return {
      ...step,
      status: 'pending' as const,
      verifiedAt: undefined,
      correctedX: undefined,
      correctedY: undefined,
      drift: undefined,
      driftPx: undefined,
      shot: undefined,
      beforeFrame: undefined,
      afterFrame: undefined,
    };
  });

  const firstPending = steps.findIndex((step) => step.verifiedAt === undefined);
  return {
    steps,
    resumedIndex: firstPending < 0 ? steps.length : firstPending,
    preservedVerified,
    resetUnverified,
    rejected: false,
    reason: preservedVerified
      ? `Inherited ${preservedVerified} verified step(s); ${resetUnverified} step(s) require fresh execution or verification`
      : 'No verified step had matching, available post-action evidence; workflow will resume from the beginning',
  };
}
