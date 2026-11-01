/**
 * Cooperative, evidence-led execution ownership.
 *
 * Planning, screenshot review and takeover requests are collaborative. Physical input is not:
 * exactly one controller holds a generation-fenced lease at a time. The user always outranks
 * every agent. A transfer requested during an action waits for its safe boundary; a stalled
 * action is fenced and leaves input paused rather than silently allowing two controllers.
 */

export type ControlAgent = string;
export type ControlOwner = ControlAgent | 'user' | null;
export type ActionKind = 'instant' | 'drag' | 'typing' | 'other';
export type TransferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'paused';

export interface ScreenshotEvidence {
  id: string;
  capturedAt: number;
  /** A resolvable frame-store key or URL; large image data should not be duplicated in messages. */
  ref: string;
  description?: string;
}

export interface ActionEvidence {
  id: string;
  action: string;
  startedAt: number;
  finishedAt?: number;
  ok?: boolean;
  verified?: boolean;
  before?: ScreenshotEvidence;
  after?: ScreenshotEvidence;
  note?: string;
}

export interface WorkflowEvidence {
  runId: string;
  goal: string;
  stepIndex: number;
  steps: readonly { id: string; name: string; status: string }[];
  screenshots: readonly ScreenshotEvidence[];
  actions: readonly ActionEvidence[];
  tried: readonly string[];
  successCriteria: readonly string[];
}

export interface AgentReview {
  agent: ControlAgent;
  reviewedScreenshotIds: readonly string[];
  assessment: 'progress' | 'blocked' | 'uncertain' | 'better-route';
  confidence: number;
  rationale: string;
  proposedNextStep?: string;
  at: number;
}

export interface TakeoverRequest {
  id: string;
  from: ControlAgent;
  reason: string;
  evidence: WorkflowEvidence;
  review: AgentReview;
  requestedAt: number;
  status: TransferStatus;
  decision?: string;
}

export interface ControlSnapshot {
  owner: ControlOwner;
  generation: number;
  paused: boolean;
  activeAction: null | { id: string; kind: ActionKind; owner: ControlAgent; startedAt: number };
  pending: readonly TakeoverRequest[];
  history: readonly TakeoverRequest[];
}

export interface CooperativeControlOptions {
  initialOwner: ControlAgent;
  actionStallMs?: number;
  now?: () => number;
  onEvent?: (event: string, detail: unknown) => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const validReview = (r: AgentReview, e: WorkflowEvidence) =>
  r.agent.trim().length > 0 &&
  Number.isFinite(r.confidence) &&
  r.confidence >= 0 && r.confidence <= 1 &&
  r.rationale.trim().length > 0 &&
  e.screenshots.length > 0 &&
  e.screenshots.every(s => r.reviewedScreenshotIds.includes(s.id));

export function createCooperativeControl(options: CooperativeControlOptions) {
  const now = options.now ?? Date.now;
  const stallMs = options.actionStallMs ?? 30_000;
  let owner: ControlOwner = options.initialOwner;
  let generation = 1;
  let paused = false;
  let activeAction: ControlSnapshot['activeAction'] = null;
  let sequence = 0;
  let pending: TakeoverRequest[] = [];
  let history: TakeoverRequest[] = [];
  const emit = (event: string, detail: unknown) => options.onEvent?.(event, detail);
  const snapshot = (): ControlSnapshot => ({
    owner, generation, paused,
    activeAction: activeAction ? { ...activeAction } : null,
    pending: pending.map(p => ({ ...p })),
    history: history.map(p => ({ ...p })),
  });
  const fence = (reason: string) => {
    generation += 1;
    paused = true;
    activeAction = null;
    emit('input-fenced', { generation, reason });
  };
  const record = (r: TakeoverRequest) => {
    history = [r, ...history].slice(0, 100);
    pending = pending.filter(p => p.id !== r.id);
  };
  const grant = (r: TakeoverRequest, reason: string) => {
    if (activeAction) return false;
    generation += 1;
    owner = r.from;
    paused = false;
    const done = { ...r, status: 'accepted' as const, decision: reason };
    record(done);
    emit('control-transferred', { owner, generation, request: done });
    return true;
  };

  return {
    snapshot,
    /** A token is captured when an agent plans; it must still match at the native dispatch boundary. */
    token: () => ({ owner, generation }),
    canDispatch: (agent: ControlAgent, token: { owner: ControlOwner; generation: number }) =>
      !paused && owner === agent && token.owner === agent && token.generation === generation && !activeAction,
    /** Begin a physical action. Long drags/typing are tracked until completeAction or stall detection. */
    beginAction: (agent: ControlAgent, token: { owner: ControlOwner; generation: number }, id: string, kind: ActionKind) => {
      if (paused || owner !== agent || token.owner !== agent || token.generation !== generation || activeAction) return false;
      activeAction = { id, kind, owner: agent, startedAt: now() };
      emit('action-started', { ...activeAction, generation });
      return true;
    },
    completeAction: (agent: ControlAgent, id: string, outcome: { ok: boolean; verified: boolean; note?: string }) => {
      if (!activeAction || activeAction.owner !== agent || activeAction.id !== id) return false;
      emit('action-finished', { ...activeAction, ...outcome });
      activeAction = null;
      if (pending.length) {
        const candidates = [...pending].sort((a, b) => {
          const score = (r: TakeoverRequest) => (r.review.assessment === 'blocked' ? 4 : 0) +
            (r.review.assessment === 'better-route' ? 2 : 0) + r.review.confidence;
          return score(b) - score(a) || a.requestedAt - b.requestedAt || a.from.localeCompare(b.from);
        });
        const eligible = candidates.filter(r => r.review.assessment === 'blocked' || r.review.assessment === 'better-route');
        for (const observer of candidates.filter(r => !eligible.includes(r))) {
          const decision = outcome.ok && outcome.verified
            ? 'current controller made verified progress with screenshot evidence; observer did not establish a stronger recovery case'
            : 'review did not establish blockage or a better route';
          record({ ...observer, status: 'rejected', decision });
        }
        const winner = eligible[0];
        if (winner) {
          grant(winner, 'safe action boundary reached; screenshot review supports takeover');
          for (const other of eligible.slice(1)) record({ ...other, status: 'rejected', decision: 'another evidence-backed request won arbitration' });
        }
      }
      return true;
    },
    requestTakeover: (from: ControlAgent, reason: string, evidence: WorkflowEvidence, review: AgentReview): TakeoverRequest => {
      const request: TakeoverRequest = {
        id: `handoff-${now().toString(36)}-${++sequence}`, from, reason, evidence,
        review, requestedAt: now(), status: 'pending',
      };
      if (from === owner) {
        const same = { ...request, status: 'rejected' as const, decision: 'requester already owns control' };
        record(same); return same;
      }
      if (!validReview(review, evidence)) {
        const invalid = { ...request, status: 'rejected' as const, decision: 'review must inspect every supplied screenshot and include a reasoned assessment' };
        record(invalid); emit('takeover-rejected', invalid); return invalid;
      }
      if (owner === 'user') {
        const denied = { ...request, status: 'rejected' as const, decision: 'user currently owns control' };
        record(denied); emit('takeover-rejected', denied); return denied;
      }
      if (!activeAction && !paused && (review.assessment === 'progress' || review.assessment === 'uncertain')) {
        const denied = { ...request, status: 'rejected' as const, decision: 'current controller has not been shown to be blocked; review does not justify transfer' };
        record(denied); emit('takeover-rejected', denied); return denied;
      }
      pending = [...pending.filter(p => p.from !== from), request];
      emit('takeover-requested', request);
      if (!activeAction && !paused) {
        grant(request, 'no action in flight; screenshot review supports takeover');
        return history[0];
      }
      return request;
    },
    /** The user can reclaim control immediately; pending agent requests and all old tokens are invalidated. */
    userTakeControl: () => {
      generation += 1; owner = 'user'; paused = false; activeAction = null;
      for (const r of [...pending]) record({ ...r, status: 'cancelled', decision: 'user reclaimed control' });
      pending = [];
      emit('user-control', { generation });
      return snapshot();
    },
    /** Disarm all AI input. No agent can dispatch until explicitly resumed by the user. */
    userPause: () => {
      fence('user paused AI input');
      owner = 'user';
      for (const r of [...pending]) record({ ...r, status: 'cancelled', decision: 'user paused AI input' });
      pending = [];
      return snapshot();
    },
    /** Resume AI only with an explicit owner selection; the generation always changes. */
    userResumeAgent: (agent: ControlAgent) => {
      if (owner !== 'user') return false;
      generation += 1; owner = agent; paused = false; activeAction = null;
      emit('user-authorized-agent', { agent, generation });
      return true;
    },
    /** A drag/type action that exceeds the deadline is fenced and paused; never grant a second agent mid-input. */
    detectStall: (at = now()) => {
      if (!activeAction || at - activeAction.startedAt < stallMs) return false;
      const stale = activeAction;
      fence(`action ${stale.id} stalled; input paused pending recovery`);
      emit('action-stalled', stale);
      return true;
    },
    /** Only a verified result may become a reusable skill. Screenshot IDs are retained as provenance. */
    learnFromOutcome: (input: {
      skill: string; evidence: WorkflowEvidence; outcome: 'verified-success' | 'failed' | 'unverified';
      reviewer: string;
    }) => {
      if (input.outcome !== 'verified-success' || !input.evidence.actions.some(a => a.ok && a.verified && a.after)) return null;
      const lesson = {
        id: `skill-${++sequence}`, skill: input.skill, reviewer: input.reviewer,
        runId: input.evidence.runId, screenshotIds: input.evidence.screenshots.map(s => s.id),
        learnedAt: now(), confidence: 1 as const, provenance: 'verified' as const,
      };
      emit('skill-learned', lesson);
      return lesson;
    },
  };
}

export type CooperativeControl = ReturnType<typeof createCooperativeControl>;
