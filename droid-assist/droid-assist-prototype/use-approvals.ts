import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AssistSettings, LearnedPattern, LogEntry, WorkflowStep } from './types.js';
import { CLASS_LABEL, approvalTree, classifyStep, conditionsBlock, enqueue, filterPoint, needsApproval, noteItem, resolve, runCheck, type ApprovalDraft, type ApprovalItem, type ApprovalStatus, type CheckContext, type Route } from './approvals.js';
import { loadApprovals, saveApprovals } from './storage.js';

/** Log source of every approvals line. */
const SOURCE = 'Approvals';

type AddLog = (from: string, message: string, tone?: LogEntry['tone']) => void;

/** What the engine knows when a point or an operation reaches the gate. */
export interface GateContext {
  goal: string;
  /** The step is part of the current plan. */
  planned: boolean;
}

/** A strong point the AI makes, as one notification. */
export interface Point {
  text: string;
  requestedBy: string;
  proposalId?: string;
}

/**
 * The approval system: the persisted queue, the gate every real dispatch passes (conditions,
 * then admin-class operations held until approved), the point filter and the run-check.
 */
export function useApprovals(settings: AssistSettings, patterns: () => LearnedPattern[], addLog: AddLog) {
  const [items, setItems] = useState<ApprovalItem[]>(loadApprovals);
  const itemsRef = useRef(items);
  const settingsRef = useRef(settings);
  const patternsRef = useRef(patterns);
  /** Step ids the user approved for exactly one dispatch. */
  const releasedRef = useRef(new Set<string>());
  useLayoutEffect(() => {
    settingsRef.current = settings;
    patternsRef.current = patterns;
  });

  useEffect(() => saveApprovals(items), [items]);

  const update = useCallback((fn: (list: ApprovalItem[]) => ApprovalItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  /** Queues a request and logs it once; returns the queued (or already pending) item. */
  const queue = useCallback((draft: ApprovalDraft) => {
    const r = enqueue(itemsRef.current, draft);
    if (r.added) {
      update(() => r.items);
      addLog(SOURCE, `Queued for approval (${CLASS_LABEL[draft.cls]}) from ${draft.requestedBy}: ${draft.summary} — ${draft.context}`, 'warn');
    }
    return r.item;
  }, [addLog, update]);

  /**
   * The gate before a real dispatch: why `step` must not run now, or null. Outside the user's
   * conditions it is refused; an admin-class operation not approved by the user is queued.
   */
  const gate = useCallback((step: WorkflowStep, actor: string, ctx: GateContext): string | null => {
    const cls = classifyStep(step);
    const block = conditionsBlock(settingsRef.current.operationPolicy, cls, new Date());
    if (block) return `Operation conditions — ${block}; not executed`;
    if (!needsApproval(cls) || releasedRef.current.delete(step.id)) return null;
    queue({ requestedBy: actor, kind: 'operation', cls, summary: `${step.action} "${step.target ?? step.name}"${step.text ? ` with "${step.text}"` : ''}`, context: `${CLASS_LABEL[cls]} never auto-runs — held until approved${ctx.goal ? ` (goal: ${ctx.goal})` : ''}`, goal: ctx.goal, step, planned: ctx.planned });
    return `${CLASS_LABEL[cls]} queued for approval — not executed`;
  }, [queue]);

  /** Filters one point: auto, queued for approval, or blocked by the user's conditions (logged). */
  const route = useCallback((point: Point, goal: string): Route => {
    const { operationPolicy, autoAct } = settingsRef.current;
    const r = filterPoint(point.text, { policy: operationPolicy, goal, patterns: patternsRef.current(), autoAct, now: new Date() });
    if (r.route === 'approval') queue({ requestedBy: point.requestedBy, kind: 'point', cls: r.cls, summary: point.text, context: r.reason, goal, ...(point.proposalId ? { proposalId: point.proposalId } : {}) });
    if (r.route === 'blocked') addLog(SOURCE, `Not acted on "${point.text}" — ${r.reason}`, 'warn');
    return r.route;
  }, [addLog, queue]);

  /** Lets an approved step through the gate for its next dispatch; `on` false revokes an unused release. */
  const release = useCallback((stepId: string, on = true) => {
    if (on) releasedRef.current.add(stepId);
    else releasedRef.current.delete(stepId);
  }, []);

  /** Records a decision; returns the decided item, or null when it is not pending. */
  const decide = useCallback((id: string, status: Exclude<ApprovalStatus, 'pending'>, edit?: string): ApprovalItem | null => {
    if (!itemsRef.current.some((i) => i.id === id && i.status === 'pending')) return null;
    update((list) => resolve(list, id, status, edit));
    return itemsRef.current.find((i) => i.id === id) ?? null;
  }, [update]);

  /** Notes an outcome on an item (e.g. why an approved operation did not run). */
  const note = useCallback((id: string, text: string) => update((list) => noteItem(list, id, text)), [update]);

  /** Re-evaluates the pending items and logs how many are stale. */
  const check = useCallback((ctx: CheckContext) => {
    const r = runCheck(itemsRef.current, ctx);
    update(() => r.items);
    const pending = r.items.filter((i) => i.status === 'pending').length;
    addLog(SOURCE, `Run-check: ${pending} pending, ${r.flagged.length} stale${r.flagged.length ? ` — ${r.flagged.map((i) => `"${i.summary}": ${i.stale}`).join('; ')}` : ''}`, r.flagged.length ? 'warn' : 'ok');
    return r.flagged;
  }, [addLog, update]);

  const current = useCallback((id: string) => itemsRef.current.find((i) => i.id === id) ?? null, []);

  return { items, tree: approvalTree(items), gate, route, queue, release, decide, note, check, current };
}
