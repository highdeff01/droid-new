import type { ActionRecord, Frame, WorkflowStep } from './types.js';
import type { InventoryElement } from './screen-inventory.js';
import type { Box } from './assist-ai.js';

export type PageTransition = 'same-page' | 'content-shift' | 'navigation-likely' | 'unknown';
export type RelationKind = 'contains' | 'overlaps' | 'near' | 'aligned-x' | 'aligned-y';

export interface ElementRelation {
  from: string;
  to: string;
  kind: RelationKind;
  distance: number;
  /** Geometry-only relationship; semantics still require visual/AI validation. */
  evidence: string;
}

export interface ElementOutcomeRate {
  target: string;
  attempts: number;
  verifiedSuccesses: number;
  verifiedFailures: number;
  successPercent: number | null;
  confidence: 'low' | 'medium' | 'high';
}

export interface CommandAudit {
  stepId: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'drift' | 'failed';
  issue: 'not-started' | 'possibly-missed' | 'unverified' | 'failed' | 'clear';
  detail: string;
}

export interface ProspectPoint {
  priority: 'high' | 'normal' | 'low';
  point: { x: number; y: number };
  reason: string;
  evidence: string;
}

export interface PerceptionSnapshot {
  frameId: number;
  capturedAt: number;
  elements: InventoryElement[];
  relations: ElementRelation[];
  pageTransition: PageTransition;
  changeRatio: number;
  notes: string[];
  effects: ElementEffect[];
}

export interface ElementIdentityAssessment {
  name: string;
  confidence: number;
  stability: 'stable' | 'changed' | 'ambiguous';
  reasons: string[];
}

/**
 * Advisory identity stability: confidence is lowered when the element moves materially or
 * its visual descriptor no longer resembles the verified prototype. It never dispatches actions.
 */
export function assessElementIdentity(input: {
  element: InventoryElement;
  frame: Frame;
  prototypes: readonly VisualPrototype[];
  previous?: InventoryElement;
}): ElementIdentityAssessment {
  const { element, frame, prototypes, previous } = input;
  const reasons: string[] = [];
  let confidence = element.known ? 0.72 : 0.35;
  let stability: ElementIdentityAssessment['stability'] = 'stable';
  const prior = previous && key(previous.name) === key(element.name) ? previous : undefined;
  if (prior) {
    const movement = Math.hypot(center(prior.box).x - center(element.box).x, center(prior.box).y - center(element.box).y);
    if (movement > 0.035) { confidence -= Math.min(0.35, movement * 2); stability = 'changed'; reasons.push(`element moved ${movement.toFixed(3)} normalized units`); }
  } else {
    confidence -= 0.08;
    reasons.push('no same-name element in the previous inventory');
  }
  const match = matchVisualPrototype(prototypes.filter(p => p.samples >= 2), element.kind, visualDescriptor(frame, element.box));
  if (match) {
    confidence = Math.max(confidence, 1 - match.distance / 0.16);
    reasons.push(`visual prototype distance ${match.distance.toFixed(3)} from ${match.prototype.name}`);
  } else {
    confidence -= 0.12;
    reasons.push('no sufficiently close verified visual prototype');
  }
  if (element.state === 'moved' || element.state === 'in-motion') { confidence -= 0.15; stability = 'changed'; reasons.push(`inventory state is ${element.state}`); }
  if (confidence < 0.5) stability = stability === 'changed' ? 'changed' : 'ambiguous';
  return { name: element.name, confidence: clamp(confidence, 0, 1), stability, reasons };
}

export interface VisualPrototype {
  key: string;
  name: string;
  kind: InventoryElement['kind'];
  descriptor: number[];
  samples: number;
  verifiedSuccesses: number;
  lastVerifiedAt: number;
  lastFrameId: number;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (a: Box, b: Box) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

/** Build a compact 4x4 grayscale appearance descriptor for one normalized screen region. */
export function visualDescriptor(frame: Frame, box: Box, grid = 4): number[] {
  const img = frame.data;
  const out: number[] = [];
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    const x0 = clamp(Math.floor((box.x + box.w * gx / grid) * img.width), 0, img.width - 1);
    const x1 = clamp(Math.ceil((box.x + box.w * (gx + 1) / grid) * img.width), x0 + 1, img.width);
    const y0 = clamp(Math.floor((box.y + box.h * gy / grid) * img.height), 0, img.height - 1);
    const y1 = clamp(Math.ceil((box.y + box.h * (gy + 1) / grid) * img.height), y0 + 1, img.height);
    let sum = 0, count = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      sum += (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114) / 255;
      count++;
    }
    out.push(count ? sum / count : 0);
  }
  return out;
}

export function descriptorDistance(a: readonly number[], b: readonly number[]): number {
  if (!a.length || a.length !== b.length) return 1;
  return a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
}

/**
 * Tiny online visual prototype learner, not a pretrained neural network. It updates an element
 * template only when the caller supplies explicit screenshot-verified success evidence.
 */
export function learnVisualPrototype(
  prototypes: readonly VisualPrototype[],
  input: { name: string; kind: InventoryElement['kind']; descriptor: number[]; frameId: number; verifiedSuccess: boolean; at: number },
): VisualPrototype[] {
  if (!input.verifiedSuccess || !input.descriptor.length || input.descriptor.some(v => !Number.isFinite(v))) return [...prototypes];
  const k = key(input.name);
  const index = prototypes.findIndex(p => p.key === k && p.kind === input.kind);
  if (index < 0) return [{ key: k, name: input.name, kind: input.kind, descriptor: [...input.descriptor], samples: 1, verifiedSuccesses: 1, lastVerifiedAt: input.at, lastFrameId: input.frameId }, ...prototypes].slice(0, 300);
  const old = prototypes[index];
  if (old.descriptor.length !== input.descriptor.length) return [...prototypes];
  const alpha = 1 / Math.min(old.samples + 1, 12);
  const next = { ...old, descriptor: old.descriptor.map((v, i) => v * (1 - alpha) + input.descriptor[i] * alpha), samples: old.samples + 1, verifiedSuccesses: old.verifiedSuccesses + 1, lastVerifiedAt: input.at, lastFrameId: input.frameId };
  return prototypes.map((p, i) => i === index ? next : p);
}

/** Recognize only repeatably verified prototypes; one accidental match cannot rename a live target. */
export function recognizeElements(elements: readonly InventoryElement[], frame: Frame, prototypes: readonly VisualPrototype[]): InventoryElement[] {
  return elements.map(element => {
    if (element.known) return element;
    const match = matchVisualPrototype(prototypes.filter(p => p.samples >= 2), element.kind, visualDescriptor(frame, element.box), 0.08);
    return match ? { ...element, name: match.prototype.name, known: true } : element;
  });
}

export const VISUAL_PROTOTYPES_KEY = 'droid-assist.visual-prototypes';

/** Persist compact verified descriptors, never screenshots or raw user text. */
export function loadVisualPrototypes(storage: Pick<Storage, 'getItem'> = localStorage): VisualPrototype[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(VISUAL_PROTOTYPES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is VisualPrototype => !!p && typeof p === 'object'
      && typeof (p as VisualPrototype).key === 'string'
      && Array.isArray((p as VisualPrototype).descriptor)
      && (p as VisualPrototype).descriptor.every(Number.isFinite)
      && Number.isInteger((p as VisualPrototype).samples)
      && (p as VisualPrototype).samples >= 1).slice(0, 300);
  } catch { return []; }
}

export function saveVisualPrototypes(prototypes: readonly VisualPrototype[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(VISUAL_PROTOTYPES_KEY, JSON.stringify(prototypes.slice(0, 300))); } catch { /* keep the in-memory learner */ }
}

export function matchVisualPrototype(prototypes: readonly VisualPrototype[], kind: InventoryElement['kind'], descriptor: readonly number[], threshold = 0.16): { prototype: VisualPrototype; distance: number } | null {
  let best: { prototype: VisualPrototype; distance: number } | null = null;
  for (const prototype of prototypes) {
    if (prototype.kind !== kind) continue;
    const distance = descriptorDistance(prototype.descriptor, descriptor);
    if (distance <= threshold && (!best || distance < best.distance)) best = { prototype, distance };
  }
  return best;
}

/** Geometry-based relationships between detected elements; labels alone never imply semantics. */
export function relateElements(elements: readonly InventoryElement[]): ElementRelation[] {
  const out: ElementRelation[] = [];
  for (let i = 0; i < elements.length; i++) for (let j = i + 1; j < elements.length; j++) {
    const a = elements[i], b = elements[j], ca = center(a.box), cb = center(b.box);
    const d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
    let kind: RelationKind | null = null;
    if (contains(a.box, b.box)) kind = 'contains';
    else if (contains(b.box, a.box)) kind = 'contains';
    else if (overlap(a.box, b.box)) kind = 'overlaps';
    else if (Math.abs(ca.y - cb.y) < 0.018) kind = 'aligned-y';
    else if (Math.abs(ca.x - cb.x) < 0.018) kind = 'aligned-x';
    else if (d < 0.09) kind = 'near';
    if (kind) out.push({ from: a.name, to: b.name, kind, distance: d, evidence: `frame geometry: ${kind}, center distance ${d.toFixed(3)}` });
  }
  return out;
}

/** Fraction of sampled RGB pixels whose luminance changed beyond tolerance. */
export function frameChangeRatio(prev: Frame | null, next: Frame, tolerance = 18): number {
  if (!prev || prev.data.width !== next.data.width || prev.data.height !== next.data.height) return 1;
  let changed = 0, total = 0;
  for (let i = 0; i < next.data.data.length; i += 16) {
    const a = prev.data.data[i], b = next.data.data[i];
    const ag = prev.data.data[i + 1], bg = next.data.data[i + 1];
    const ab = prev.data.data[i + 2], bb = next.data.data[i + 2];
    if (Math.abs(a - b) + Math.abs(ag - bg) + Math.abs(ab - bb) > tolerance * 3) changed++;
    total++;
  }
  return total ? changed / total : 0;
}

/** Compare two captures to estimate whether the app navigated or merely changed content in place. */
export function classifyPageTransition(prev: readonly InventoryElement[], next: readonly InventoryElement[], changeRatio: number): PageTransition {
  if (!prev.length || !next.length || !Number.isFinite(changeRatio)) return 'unknown';
  const names = (xs: readonly InventoryElement[]) => new Set(xs.filter(e => e.known).map(e => key(e.name)));
  const a = names(prev), b = names(next);
  const union = new Set([...a, ...b]);
  const shared = [...a].filter(x => b.has(x)).length;
  const similarity = union.size ? shared / union.size : 0;
  if (similarity < 0.25 && changeRatio > 0.18) return 'navigation-likely';
  if (similarity >= 0.65 && changeRatio > 0.025) return 'content-shift';
  return 'same-page';
}

/** Outcome rates only count actions with explicit after-frame verification; dispatched is not success. */
export function outcomeRates(history: readonly ActionRecord[], steps: readonly WorkflowStep[] = []): ElementOutcomeRate[] {
  const verifiedStepIds = new Set(steps.filter(s => !!s.verifiedAt && !!s.afterFrame).map(s => s.id));
  const byTarget = new Map<string, { target: string; attempts: number; ok: number; failed: number }>();
  for (const action of history) {
    if (action.dryRun || !action.ok || !action.dispatched) continue;
    const target = action.action === 'type' ? 'typing' : action.action;
    const item = byTarget.get(key(target)) ?? { target, attempts: 0, ok: 0, failed: 0 };
    item.attempts++;
    // A successful bridge dispatch alone is not a verified UI outcome.
    byTarget.set(key(target), item);
  }
  for (const step of steps) {
    if (!step.afterFrame || !step.verifiedAt) continue;
    const target = step.target ?? step.name;
    const item = byTarget.get(key(target)) ?? { target, attempts: 0, ok: 0, failed: 0 };
    item.attempts++;
    if (step.status === 'done') item.ok++; else item.failed++;
    byTarget.set(key(target), item);
  }
  return [...byTarget.values()].map(v => ({
    target: v.target, attempts: v.attempts, verifiedSuccesses: v.ok, verifiedFailures: v.failed,
    successPercent: v.ok + v.failed ? Math.round(100 * v.ok / (v.ok + v.failed)) : null,
    confidence: v.ok + v.failed >= 10 ? 'high' : v.ok + v.failed >= 3 ? 'medium' : 'low',
  }));
}

/** Detect planned commands that appear skipped, unfinished or unverified against the recorded step state. */
export function auditCommands(steps: readonly WorkflowStep[], now = Date.now(), staleAfterMs = 10_000): CommandAudit[] {
  return steps.map(step => {
    const age = now - (step.refFrame?.time ?? now);
    if (step.status === 'failed') return { stepId: step.id, name: step.name, status: step.status, issue: 'failed', detail: 'Step is marked failed; inspect its after-frame and error log' };
    if (step.status === 'pending' && age > staleAfterMs) return { stepId: step.id, name: step.name, status: step.status, issue: 'possibly-missed', detail: 'Still pending beyond the expected step window; check whether a command was never dispatched' };
    if (step.status === 'running') return { stepId: step.id, name: step.name, status: step.status, issue: 'unverified', detail: 'Running state needs a fresh result and screenshot verdict' };
    if (step.status === 'done' && !step.afterFrame) return { stepId: step.id, name: step.name, status: step.status, issue: 'unverified', detail: 'Marked done without a retained after-frame' };
    return { stepId: step.id, name: step.name, status: step.status, issue: 'clear', detail: 'No obvious missing command/result marker' };
  });
}

export interface ElementEffect {
  actionId: string;
  actor: string;
  action: string;
  target: string;
  nearbyBefore: string[];
  appeared: string[];
  disappeared: string[];
  moved: string[];
  evidence: string;
}

/** Attribute an input to the nearest observed element and compare the surrounding UI before/after. */
export function compareElementEffect(
  action: ActionRecord,
  before: readonly InventoryElement[],
  after: readonly InventoryElement[],
): ElementEffect {
  const srcW = action.srcW || 1, srcH = action.srcH || 1;
  const point = { x: action.x / srcW, y: action.y / srcH };
  const nearest = [...before].sort((a, b) => {
    const ca = center(a.box), cb = center(b.box);
    return Math.hypot(ca.x - point.x, ca.y - point.y) - Math.hypot(cb.x - point.x, cb.y - point.y);
  })[0];
  const target = nearest && Math.hypot(center(nearest.box).x - point.x, center(nearest.box).y - point.y) < 0.12 ? nearest.name : '(unmatched coordinate)';
  const beforeByName = new Map(before.map(e => [key(e.name), e]));
  const afterByName = new Map(after.map(e => [key(e.name), e]));
  const appeared = after.filter(e => !beforeByName.has(key(e.name))).map(e => e.name);
  const disappeared = before.filter(e => !afterByName.has(key(e.name))).map(e => e.name);
  const moved = after.filter(e => {
    const old = beforeByName.get(key(e.name));
    return !!old && Math.hypot(center(old.box).x - center(e.box).x, center(old.box).y - center(e.box).y) > 0.02;
  }).map(e => e.name);
  const nearbyBefore = before.filter(e => {
    const c = center(e.box);
    return Math.hypot(c.x - point.x, c.y - point.y) < 0.18;
  }).map(e => e.name);
  return {
    actionId: action.id, actor: action.source, action: action.action, target, nearbyBefore,
    appeared, disappeared, moved,
    evidence: `input coordinate ${(point.x * 100).toFixed(1)}%,${(point.y * 100).toFixed(1)}%; after-frame element inventory comparison`,
  };
}

/** Potential next-step checks that help the main AI reason between operations. */
export function prospectPoints(elements: readonly InventoryElement[], relations: readonly ElementRelation[], audits: readonly CommandAudit[]): ProspectPoint[] {
  const points: ProspectPoint[] = [];
  for (const audit of audits.filter(a => a.issue === 'failed' || a.issue === 'possibly-missed' || a.issue === 'unverified')) {
    const e = elements.find(x => key(x.name) === key(audit.name));
    if (e) points.push({ priority: 'high', point: center(e.box), reason: `Review ${audit.issue} step: ${audit.name}`, evidence: audit.detail });
  }
  for (const e of elements.filter(x => x.state === 'moved' || x.state === 'in-motion')) {
    points.push({ priority: 'normal', point: center(e.box), reason: `Reconfirm ${e.name} after visual movement`, evidence: `inventory state: ${e.state}; cell ${e.cell}` });
  }
  for (const relation of relations.filter(r => r.kind === 'overlaps')) {
    points.push({ priority: 'low', point: { x: 0.5, y: 0.5 }, reason: `Check overlapping elements ${relation.from} / ${relation.to}`, evidence: relation.evidence });
  }
  return points.slice(0, 12);
}


export interface PerceptionQuestion {
  id: string;
  priority: 'high' | 'normal' | 'low';
  question: string;
  why: string;
  evidence: string[];
  /** Suggested crop/region for AI inspection; advisory metadata, never an input command. */
  region?: Box;
}

/** Convert uncertainty in observer evidence into questions for the main AI. */
export function derivePerceptionQuestions(snapshot: PerceptionSnapshot): PerceptionQuestion[] {
  const questions: PerceptionQuestion[] = [];
  const add = (q: PerceptionQuestion) => { if (!questions.some(x => x.id === q.id)) questions.push(q); };
  if (snapshot.pageTransition === 'navigation-likely') add({
    id: 'page-transition', priority: 'high',
    question: 'Does this frame show a new page, dialog, application, or navigation state? Identify the page and next stable visual landmark.',
    why: 'Known-element overlap fell while a substantial visual change occurred.',
    evidence: ['frame #' + snapshot.frameId, 'pixel change ratio ' + snapshot.changeRatio.toFixed(3), ...snapshot.notes.slice(0, 2)],
  });
  for (const element of snapshot.elements.filter(e => !e.known).slice(0, 5)) add({
    id: 'identify:' + key(element.id || element.name), priority: 'normal',
    question: 'Identify the foreground element in this region, its likely role, visible label, and neighboring elements that disambiguate it.',
    why: 'The inventory has a region but no trusted semantic identity.',
    evidence: ['candidate: ' + element.name, 'kind: ' + element.kind, 'state: ' + element.state, 'box: ' + JSON.stringify(element.box)],
    region: element.box,
  });
  for (const effect of snapshot.effects.slice(0, 4)) {
    if (effect.target === '(unmatched coordinate)' || effect.appeared.length || effect.disappeared.length || effect.moved.length) add({
      id: 'effect:' + effect.actionId, priority: effect.target === '(unmatched coordinate)' ? 'high' : 'normal',
      question: 'Explain the likely UI changes after ' + effect.actor + "'s " + effect.action + '. Distinguish correlation from proven causation and identify any next element needing inspection.',
      why: 'The action and resulting screen changes are associated in time, but the semantic effect may be uncertain.',
      evidence: ['target: ' + effect.target, 'appeared: ' + (effect.appeared.join(', ') || 'none'), 'disappeared: ' + (effect.disappeared.join(', ') || 'none'), 'moved: ' + (effect.moved.join(', ') || 'none'), effect.evidence],
    });
  }
  for (const note of snapshot.notes.filter(n => /needs review|navigation|unknown|unmatched|uncertain/i.test(n)).slice(0, 4)) add({
    id: 'review:' + key(note).slice(0, 80), priority: 'normal',
    question: 'Review this observation against the current screenshot, prior notes, and recent agent/user evidence. What additional information would resolve the uncertainty?',
    why: 'A cross-reference note indicates incomplete or conflicting evidence.', evidence: [note],
  });
  const rank = { high: 0, normal: 1, low: 2 };
  return questions.sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 10);
}

/** Compact context block shared with planners, supervisors and specialist reviewers. */
export function perceptionContext(snapshot: PerceptionSnapshot, rates: readonly ElementOutcomeRate[], prospects: readonly ProspectPoint[]): string[] {
  const questions = derivePerceptionQuestions(snapshot);
  return [
    `[Perception frame #${snapshot.frameId}] page=${snapshot.pageTransition}; changed pixels≈${(snapshot.changeRatio * 100).toFixed(1)}%; elements=${snapshot.elements.length}; relations=${snapshot.relations.length}`,
    ...snapshot.notes.slice(0, 8).map(n => `[Perception note] ${n}`),
    ...rates.slice(0, 8).map(r => `[Verified outcome] ${r.target}: ${r.successPercent === null ? 'not enough screenshot-verified outcomes' : `${r.successPercent}% (${r.verifiedSuccesses}/${r.verifiedSuccesses + r.verifiedFailures})`} confidence=${r.confidence}`),
    ...prospects.slice(0, 8).map(p => `[Prospect ${p.priority}] ${p.reason} at ${(p.point.x * 100).toFixed(1)}%, ${(p.point.y * 100).toFixed(1)}% — ${p.evidence}`),
    ...questions.map(q => `[AI review request ${q.priority}] ${q.question} Why: ${q.why} Evidence: ${q.evidence.join('; ')}`),
  ];
}


export interface DecisionHistoryRecord {
  id: string;
  at: number;
  frameId: number;
  actor: string;
  action: string;
  expected: string;
  actual: string;
  evidence: string[];
  status: 'verified' | 'contradicted' | 'uncertain';
  confidence: number;
}

/**
 * Build an evidence-conservative decision record from an action/effect pair.
 * This records correlation only; it never controls or delays execution.
 */
export function recordDecisionOutcome(input: {
  effect: ElementEffect;
  frameId: number;
  expected?: string;
  at?: number;
}): DecisionHistoryRecord {
  const expected = (input.expected ?? '').trim();
  const effect = input.effect;
  const changes = [
    ...effect.appeared.map(name => `appeared: ${name}`),
    ...effect.disappeared.map(name => `disappeared: ${name}`),
    ...effect.moved.map(name => `moved: ${name}`),
  ];
  const actual = changes.length ? changes.join('; ') : 'No inventory change detected in the compared regions';
  return {
    id: effect.actionId + ':' + input.frameId,
    at: input.at ?? Date.now(),
    frameId: input.frameId,
    actor: effect.actor,
    action: effect.action,
    expected: expected || 'No explicit expected outcome recorded',
    actual,
    evidence: [effect.evidence, `target: ${effect.target}`, `inventory changes: ${changes.length}`],
    status: 'uncertain',
    confidence: 0.2,
  };
}

/** Bound decision history and avoid retaining screenshots or raw page text. */
export function appendDecisionHistory(
  history: readonly DecisionHistoryRecord[],
  record: DecisionHistoryRecord,
  limit = 100,
): DecisionHistoryRecord[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return [record, ...history.filter(item => item.id !== record.id)].slice(0, boundedLimit);
}

/** Render compact, bounded decision evidence for advisory AI context. */
export function decisionHistoryContext(history: readonly DecisionHistoryRecord[], limit = 8): string[] {
  return history.slice(0, Math.max(0, Math.min(20, Math.floor(limit)))).map(record =>
    `[Decision history ${record.status} · confidence ${Math.round(record.confidence * 100)}%] ${record.actor} ${record.action}; expected: ${record.expected}; observed: ${record.actual}; evidence: ${record.evidence.slice(0, 3).join('; ')}`,
  );
}


/**
 * Re-evaluate an uncertain decision against a later element inventory.
 * Only explicit visibility/appearance expectations are evaluated; vague actions stay uncertain.
 */
export function reconcileDecisionHistory(
  history: readonly DecisionHistoryRecord[],
  elements: readonly InventoryElement[],
  frameId: number,
): DecisionHistoryRecord[] {
  return history.map(record => {
    if (record.status !== 'uncertain' || frameId <= record.frameId || record.expected === 'No explicit expected outcome recorded') return record;
    const expected = record.expected.toLowerCase();
    const mode = /\b(disappear|disappears|disappeared|disappearing|close|closes|closed|closing|hidden|hide|hides|no longer visible)\b/.test(expected)
      ? 'absent'
      : /\b(appear|appears|appeared|appearing|open|opens|opened|opening|visible|shown|show|shows|present)\b/.test(expected)
        ? 'present'
        : null;
    if (!mode) return record;
    const ignored = new Set(['appear', 'appears', 'appeared', 'open', 'opens', 'opened', 'visible', 'shown', 'show', 'present', 'disappear', 'disappears', 'disappeared', 'close', 'closes', 'closed', 'hidden', 'no', 'longer', 'is', 'the', 'a', 'an', 'on', 'in', 'to']);
    const tokens = expected.split(/[^a-z0-9]+/).filter(token => token.length > 2 && !ignored.has(token));
    if (!tokens.length) return record;
    const match = elements.some(element => {
      const label = element.name.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2);
      return label.length > 0 && label.every(token => tokens.includes(token));
    });
    const satisfied = mode === 'present' ? match : !match;
    return {
      ...record,
      status: satisfied ? 'verified' : 'contradicted',
      confidence: 0.7,
      reviewedFrameId: frameId,
      actual: satisfied
        ? (mode === 'present' ? 'Expected element visible in later inventory' : 'Expected element absent from later inventory')
        : (mode === 'present' ? 'Expected element not found in later inventory' : 'Expected element still present in later inventory'),
      evidence: [...record.evidence.slice(0, 2), `rechecked against inventory in frame #${frameId}`],
    };
  });
}
