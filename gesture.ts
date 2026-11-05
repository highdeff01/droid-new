/** A point on the stage, normalized 0..1. */
export type StagePoint = { x: number; y: number };

/** Stage pixels the pointer must travel between press and release for the gesture to be a drag. */
export const DRAG_THRESHOLD_PX = 6;

/**
 * What a press at `down` and release at `up` was on a stage of `w`×`h` pixels: a click when the
 * pointer barely moved, otherwise a drag from `down` to `up`.
 */
export function classifyGesture(down: StagePoint, up: StagePoint, w: number, h: number): 'click' | 'drag' {
  return Math.hypot((up.x - down.x) * w, (up.y - down.y) * h) < DRAG_THRESHOLD_PX ? 'click' : 'drag';
}
