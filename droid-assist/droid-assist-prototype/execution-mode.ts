/** How the assistant paces and grounds its work. The first three are the user's; the rest the AI picks contextually. */
export type ExecutionMode = 'parallel' | 'thoughtful' | 'aggressive' | 'watching' | 'reacting' | 'tracking';

/** Who changed the mode. */
export type ModeActor = 'user' | 'ai';

/** What a mode changes: Auto-Act pacing, capture cadence, subagent crew, grounding and the planner's brief. */
export interface ModeProfile {
  label: string;
  description: string;
  /** Least time between two Auto-Act steps, ms. */
  stepGapMs: number;
  /** Link/route subagents run at once. */
  crew: number;
  /** Multiplier of the app monitor's capture interval (clamped to the capture slider range). */
  captureFactor: number;
  /** 'immediate' acts on the best known grounding before any AI proposal; 'plan' proposes first. */
  grounding: 'plan' | 'immediate';
  /** Element proposals of the screen watcher are saved to the familiar memory without asking. */
  trackElements: boolean;
  /** Whether the AI may switch to this mode by itself. */
  aiSettable: boolean;
  /** Context line sent with every plan. */
  hint: string;
}

/** Every execution mode and what it changes; 'thoughtful' is the behaviour before modes existed. */
export const EXECUTION_MODES: Record<ExecutionMode, ModeProfile> = {
  parallel: {
    label: 'Parallel / fast',
    description: 'Fast operations; link/route work is split across the agent crew, 3 subagents at a time',
    stepGapMs: 500, crew: 3, captureFactor: 1, grounding: 'plan', trackElements: false, aiSettable: true,
    hint: 'Execution mode: parallel/fast — prefer the fewest, most direct steps; independent work may be split across agents.',
  },
  thoughtful: {
    label: 'Thoughtful',
    description: 'Deliberate planning with a full proposal and briefing before each step, still efficient',
    stepGapMs: 1500, crew: 1, captureFactor: 1, grounding: 'plan', trackElements: false, aiSettable: true,
    hint: 'Execution mode: thoughtful — plan deliberately, verify each target, but do not add needless steps.',
  },
  aggressive: {
    label: 'Aggressive',
    description: 'Acts on the best known grounding at once, then the AI judges it; auto-applies only within your bounds',
    stepGapMs: 300, crew: 1, captureFactor: 1, grounding: 'immediate', trackElements: false, aiSettable: false,
    hint: 'Execution mode: aggressive — known elements are acted on immediately; plan only what is not already known.',
  },
  watching: {
    label: 'Watching (low cadence, notes)',
    description: 'Movie-watching: slow capture and pacing; the watcher keeps taking notes',
    stepGapMs: 3000, crew: 1, captureFactor: 4, grounding: 'plan', trackElements: false, aiSettable: true,
    hint: 'Execution mode: watching — the user is watching; act rarely and only when asked, keep notes.',
  },
  reacting: {
    label: 'Reacting to workflow',
    description: 'Fast capture and pacing to react to the user\'s workflow as it changes',
    stepGapMs: 800, crew: 1, captureFactor: 0.5, grounding: 'plan', trackElements: false, aiSettable: true,
    hint: 'Execution mode: reacting — respond to what just changed on screen with short, quick steps.',
  },
  tracking: {
    label: 'Tracking elements',
    description: 'Tracks elements into the project while working: the watcher\'s element proposals are saved at once',
    stepGapMs: 1500, crew: 1, captureFactor: 1, grounding: 'plan', trackElements: true, aiSettable: true,
    hint: 'Execution mode: tracking — name and remember the elements you work with.',
  },
};

/** The mode a fresh install and an unreadable setting start in. */
export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'thoughtful';

/** Every mode, in selector order. */
export const MODE_IDS = Object.keys(EXECUTION_MODES) as ExecutionMode[];

/** The modes the AI may switch to. */
export const AI_MODES = MODE_IDS.filter((m) => EXECUTION_MODES[m].aiSettable);

/** Range of the app monitor's capture slider; a mode's cadence stays inside it. */
export const CAPTURE_MS_RANGE: [number, number] = [250, 2000];

/** Whether `v` names an execution mode. */
export const isExecutionMode = (v: unknown): v is ExecutionMode => typeof v === 'string' && Object.hasOwn(EXECUTION_MODES, v);

/** A stored mode, or the default when it is missing or unknown. */
export const sanitizeMode = (v: unknown): ExecutionMode => (isExecutionMode(v) ? v : DEFAULT_EXECUTION_MODE);

/** The app monitor's capture interval in `mode`: captureMs × the mode's factor, inside the slider range. */
export function modeCaptureMs(mode: ExecutionMode, captureMs: number): number {
  const [min, max] = CAPTURE_MS_RANGE;
  return Math.round(Math.min(max, Math.max(min, captureMs * EXECUTION_MODES[mode].captureFactor)));
}

/** Log and briefing text of a mode change. */
export function modeChangeText(from: ExecutionMode, to: ExecutionMode, reason: string, by: ModeActor): string {
  const who = by === 'ai' ? 'AI' : 'User';
  return `${who} switched execution mode ${EXECUTION_MODES[from].label} → ${EXECUTION_MODES[to].label}${reason ? ` — ${reason}` : ''}`;
}

/** The mode line of a briefing: the current mode and the last change, when there was one. */
export const modeStatus = (mode: ExecutionMode, lastChange: string | null) => `${EXECUTION_MODES[mode].label}${lastChange ? ` (last change: ${lastChange})` : ''}`;

/** A mode the AI asked for, as it replied. */
export interface ModeDirective {
  mode: string;
  reason: string;
}

/** What becomes of an AI mode directive: switch, nothing to do, or refused with why. */
export type DirectiveResult =
  | { kind: 'accepted'; mode: ExecutionMode; reason: string }
  | { kind: 'same' }
  | { kind: 'rejected'; text: string };

/**
 * Resolves the AI's mode directive against the current mode: an unknown mode or one the AI may not
 * set (aggressive — auto-apply is the user's) is rejected; the current mode is a no-op.
 */
export function resolveAiDirective(current: ExecutionMode, d: ModeDirective): DirectiveResult {
  if (!isExecutionMode(d.mode)) return { kind: 'rejected', text: `AI asked for unknown execution mode "${d.mode}" — rejected, staying ${EXECUTION_MODES[current].label}` };
  if (!EXECUTION_MODES[d.mode].aiSettable) return { kind: 'rejected', text: `AI asked for ${EXECUTION_MODES[d.mode].label} mode — rejected: only the user can select it; staying ${EXECUTION_MODES[current].label}` };
  if (d.mode === current) return { kind: 'same' };
  return { kind: 'accepted', mode: d.mode, reason: d.reason };
}
