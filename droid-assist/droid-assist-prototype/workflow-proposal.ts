import type { SavedCard, WorkflowStep } from './types.js';
import { findSimilar, uid } from './planner.js';
import { flowCard } from './flow-memory.js';
import { storableStep, type InitiativeProposal, type WorkflowPack } from './initiative.js';

/** How alike a run must be to a saved card or pending pack to count as already known. */
const KNOWN = 0.6;

/**
 * A finished run whose every step succeeded (the caller's count, dry or real) as a new workflow
 * candidate; null when a saved card or a pending pack is already similar.
 */
export function workflowCandidate(goal: string, steps: WorkflowStep[], cards: SavedCard[], proposals: InitiativeProposal[]): Omit<WorkflowPack, 'checks'> | null {
  if (!steps.length) return null;
  const card = flowCard(goal, steps);
  const text = `${goal} ${card.name} ${steps.map((s) => s.name).join(' ')}`;
  const pending = proposals.flatMap((p) => (p.category === 'workflow' && p.status === 'pending' && p.pack ? [{ id: p.id, name: p.pack.name, description: p.pack.description, steps: p.pack.steps, savedAt: p.time }] : []));
  if (findSimilar(text, [...cards, ...pending], KNOWN)) return null;
  return { name: card.name, description: card.description, steps: card.steps.map(storableStep) };
}

/** One step's agent check: verified or not, and what happened. */
export type StepCheck = (step: WorkflowStep) => Promise<{ ok: boolean; message: string }>;

/** The pack verified step by step by `check`, stopping at the first failure; `verified` only when every step passed. */
export async function verifyPack(pack: Omit<WorkflowPack, 'checks'>, check: StepCheck): Promise<{ verified: boolean; pack: WorkflowPack }> {
  const checks: string[] = [];
  for (const step of pack.steps) {
    const r = await check(step);
    checks.push(`${r.ok ? 'PASS' : 'FAIL'} "${step.name}" — ${r.message}`);
    if (!r.ok) return { verified: false, pack: { ...pack, checks } };
  }
  return { verified: true, pack: { ...pack, checks } };
}

/** The proposal of a verified pack. */
export const packProposal = (pack: WorkflowPack): Omit<InitiativeProposal, 'id' | 'time' | 'status'> => ({ category: 'workflow', text: `New workflow "${pack.name}" (${pack.steps.length} step(s), agent-verified)`, pack });

/** An accepted pack as a saved card. */
export const packCard = (pack: WorkflowPack, savedAt = Date.now()): SavedCard => ({ id: uid('card'), name: pack.name, description: pack.description, savedAt, steps: pack.steps.map((s) => ({ ...s, status: 'pending' })) });
