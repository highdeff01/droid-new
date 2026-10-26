import { humanMoveMs } from './bridge.js';
import type { StagePoint } from './gesture.js';
import type { StepAction, TrailPoint } from './types.js';

/** Frames each humanized cursor movement is interpolated over. */
export const PATH_FRAMES = 12;

/** Where the AI cursor starts when it has not moved yet: the screen centre. */
export const CURSOR_HOME: StagePoint = { x: 0.5, y: 0.5 };

/** Movements shorter than this (normalized) are not animated: the cursor is already there. */
const SAME_POINT = 0.002;

/** The trail marker each action leaves where it lands; actions not listed leave only their path. */
export const MARKER_OF: Partial<Record<StepAction, 'click' | 'typed'>> = { click: 'click', double_click: 'click', type: 'typed' };

const ease = (s: number) => s * s * (3 - 2 * s);

/**
 * A humanized movement from `from` to `to`: PATH_FRAMES points with eased speed and a slight
 * sideways bow (its size and side from `random`), ending exactly on `to`.
 */
export function humanPath(from: StagePoint, to: StagePoint, random: () => number = Math.random): StagePoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bow = (random() - 0.5) * 0.3;
  const points = Array.from({ length: PATH_FRAMES - 1 }, (_, i) => {
    const s = ease((i + 1) / PATH_FRAMES);
    const side = bow * Math.sin(Math.PI * s);
    return { x: from.x + dx * s - dy * side, y: from.y + dy * s + dx * side };
  });
  return [...points, { ...to }];
}

/** A trail marker of `kind` at `p`. */
export const markAt = (p: StagePoint, kind: 'click' | 'typed'): TrailPoint => ({ x: p.x, y: p.y, t: Date.now(), [kind]: true });

/** What the animator draws through: each path frame (cursor + trail point), and each marker. */
export interface AnimatorDeps {
  frame: (p: StagePoint) => void;
  mark: (p: TrailPoint) => void;
  random?: () => number;
}

/** A queue of cursor movements and markers, played in order so every attempt is seen. */
export interface CursorAnimator {
  /** Queues a humanized move from where the cursor will be to `to` (skipped when already there). */
  aim: (to: StagePoint) => void;
  /** Queues a marker of `kind` where the cursor will be once the queued moves have played. */
  mark: (kind: 'click' | 'typed') => void;
  /** Where the cursor will be once the queue has played; null before the first move. */
  where: () => StagePoint | null;
  /** Resolves once everything queued so far has played. */
  idle: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The AI cursor animator: each aim plays a humanMoveMs (250–550 ms) movement over PATH_FRAMES
 * frames. Movements never block the caller; they queue behind the ones before them.
 */
export function createCursorAnimator(deps: AnimatorDeps): CursorAnimator {
  const random = deps.random ?? Math.random;
  let at: StagePoint | null = null;
  let chain: Promise<void> = Promise.resolve();
  const play = async (path: StagePoint[], ms: number) => {
    for (const p of path) {
      await sleep(ms / path.length);
      deps.frame(p);
    }
  };
  return {
    aim(to) {
      const from = at ?? CURSOR_HOME;
      if (at && Math.hypot(to.x - from.x, to.y - from.y) < SAME_POINT) return;
      at = { ...to };
      const path = humanPath(from, to, random);
      const ms = humanMoveMs(random);
      chain = chain.then(() => play(path, ms));
    },
    mark(kind) {
      const p = at ?? CURSOR_HOME;
      chain = chain.then(() => deps.mark(markAt(p, kind)));
    },
    where: () => at,
    idle: () => chain,
  };
}
