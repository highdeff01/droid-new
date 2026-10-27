import type { StepAction, WorkflowStep } from './types.js';

/** What the desktop bridge reported for a dispatched action. Never assumed successful. */
export interface BridgeResult {
  ok: boolean;
  message: string;
}

/** A real desktop screenshot taken by the bridge, in native screen pixels. */
export interface BridgeFrame {
  image: string;
  width: number;
  height: number;
}

/** The error every real-input path reports when there is no reachable bridge. */
export const BRIDGE_REQUIRED = 'Desktop bridge not connected — connect the bridge (start the Droid server and set its URL in Settings) to perform real input';

/** One native action as the Droid replay engine (python-service/replay.py, pyautogui) accepts it. */
export interface NativeAction {
  action: 'click' | 'double_click' | 'move' | 'drag' | 'scroll' | 'type_text' | 'press_key' | 'hotkey' | 'wait';
  x: number;
  y: number;
  /** A `drag`'s release point (pyautogui mouseDown at x,y → moveTo(endX, endY, duration) → mouseUp). */
  endX?: number;
  endY?: number;
  text?: string;
  keyPayload?: string;
  /** pyautogui.moveTo duration for a `move` or `drag` travel, in ms (humanized, never instant). */
  durationMs?: number;
  delayMs: number;
}

type Point = { x: number; y: number };

/** A human-looking cursor travel time for pyautogui.moveTo: 250–550 ms. */
export const humanMoveMs = (random: () => number = Math.random) => Math.round(250 + random() * 300);

/** A normalized coordinate as a native pixel on a `size`-pixel axis, kept on screen. */
const toPx = (v: number, size: number) => Math.min(size - 1, Math.max(0, Math.round(v * size)));

/** A drag's release point on a srcW×srcH screen; null when the step has no end point. */
export function dragEnd(step: WorkflowStep, srcW: number, srcH: number): Point | null {
  if (typeof step.endX !== 'number' || typeof step.endY !== 'number') return null;
  return { x: toPx(step.endX, srcW), y: toPx(step.endY, srcH) };
}

const at = (p: Point, action: NativeAction['action'], extra: Partial<NativeAction> = {}): NativeAction => ({ action, x: p.x, y: p.y, delayMs: 200, ...extra });
const keys = (p: Point, combo: string) => at(p, combo.includes('+') ? 'hotkey' : 'press_key', { keyPayload: combo.toLowerCase() });
const write = (p: Point, text: string) => at(p, 'type_text', { text });
const appName = (step: WorkflowStep) => step.text ?? step.name.replace(/^open\s+/i, '');
const scrollDir = (step: WorkflowStep) => (/^\s*up\s*$/i.test(step.text ?? '') ? 'up' : 'down');

/** One pyautogui-style drag: press at the start, humanized travel to the end, release there. */
const drag = (p: Point, end: Point): NativeAction => at(p, 'drag', { endX: end.x, endY: end.y, durationMs: humanMoveMs() });

/** Every step action as the real mouse/keyboard input it performs on the PC. */
const NATIVE: Record<StepAction, (step: WorkflowStep, p: Point, end: Point | null) => NativeAction[]> = {
  click: (_s, p) => [at(p, 'click')],
  double_click: (_s, p) => [at(p, 'double_click')],
  move: (_s, p) => [at(p, 'move', { durationMs: humanMoveMs() })],
  drag: (_s, p, end) => (end ? [drag(p, end)] : []),
  scroll: (s, p) => [at(p, 'scroll', { keyPayload: scrollDir(s) })],
  type: (s, p) => [write(p, s.text ?? '')],
  key: (s, p) => Array.from({ length: Math.max(1, s.repeat ?? 1) }, () => keys(p, s.text ?? 'enter')),
  open_app: (s, p) => [keys(p, 'win'), at(p, 'wait', { delayMs: 600 }), write(p, appName(s)), keys(p, 'enter')],
  search: (s, p) => [keys(p, 'ctrl+l'), write(p, s.text ?? ''), keys(p, 'enter')],
  calc: (s, p) => [keys(p, 'win'), at(p, 'wait', { delayMs: 600 }), write(p, 'calculator'), keys(p, 'enter'), at(p, 'wait', { delayMs: 1200 }), write(p, s.text ?? ''), keys(p, 'enter')],
  media: (_s, p) => [keys(p, 'playpause')],
  wait: (_s, p) => [at(p, 'wait', { delayMs: 800 })],
  measure: () => [],
};

/**
 * The native actions a step performs at its (drift-corrected) position on a srcW×srcH screen.
 * A recorded step's measured human pause (`delayMs`) replaces the default delay of its first action.
 */
export function nativeActions(step: WorkflowStep, srcW: number, srcH: number): NativeAction[] {
  const p = { x: toPx(step.correctedX ?? step.x, srcW), y: toPx(step.correctedY ?? step.y, srcH) };
  const [first, ...rest] = NATIVE[step.action](step, p, dragEnd(step, srcW, srcH));
  if (!first) return [];
  return typeof step.delayMs === 'number' ? [{ ...first, delayMs: step.delayMs }, ...rest] : [first, ...rest];
}

const base = (url: string) => url.replace(/\/$/, '');
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** The log message for a bridge call the bridge refused for a missing or wrong token. */
export const BRIDGE_UNAUTHORIZED = 'Desktop bridge unauthorized — check bridge token in Settings';

/** Request headers for a bridge call: JSON plus the bearer token when one is set. */
export function bridgeHeaders(token: string, json = false): Record<string, string> {
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** Whether a bridge reply is an auth refusal (401 missing/wrong token, 403 forbidden). */
const unauthorized = (res: Response) => res.status === 401 || res.status === 403;

/** The failure message of a bridge reply that was not a success. */
const failure = (res: Response, body: { error?: string } | null) => (unauthorized(res) ? BRIDGE_UNAUTHORIZED : body?.error ?? `Bridge HTTP ${res.status}`);

const LOOPBACK = /^(localhost|.+\.localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Whether the bridge URL is plain http to a non-localhost host, so the token and every
 * input command cross the network unencrypted. Relative (same-origin proxy) URLs are not.
 */
export function insecureBridgeUrl(bridgeUrl: string): boolean {
  const trimmed = bridgeUrl.trim();
  if (!/^http:\/\//i.test(trimmed)) return false;
  try {
    return !LOOPBACK.test(new URL(trimmed).hostname);
  } catch {
    return true;
  }
}

/** Polls a replay run until the PC reports it finished; only "completed" means the input happened. */
async function waitForRun(bridgeUrl: string, token: string, id: string, pollMs: number, timeoutMs: number): Promise<{ status: string; error?: string }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await fetch(`${base(bridgeUrl)}/api/replay/${id}`, { headers: bridgeHeaders(token), signal: AbortSignal.timeout(4000) });
    const body = await res.json().catch(() => null);
    if (body?.run && TERMINAL.has(body.run.status)) return body.run;
    if (!res.ok) return { status: 'failed', error: failure(res, body) };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { status: 'failed', error: 'Timed out waiting for the PC to finish the step; its effect is uncertain' };
}

/**
 * Performs one step as real mouse/keyboard input through the Droid desktop bridge
 * (POST /api/replay, then polls the run). Succeeds only when the PC completed it.
 * @param srcW native screen width the step's normalized coordinates map onto
 * @param token bridge auth token, sent as a bearer token on every call
 */
export async function sendToBridge(bridgeUrl: string, step: WorkflowStep, srcW: number, srcH: number, { token = '', pollMs = 250, timeoutMs = 60000 } = {}): Promise<BridgeResult> {
  if (!bridgeUrl) return { ok: false, message: BRIDGE_REQUIRED };
  const actions = nativeActions(step, srcW, srcH);
  if (!actions.length) return { ok: false, message: `"${step.name}" has no end point — a drag needs both a start and an end; not sent` };
  const { x, y } = actions[0];
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/replay`, {
      method: 'POST',
      headers: bridgeHeaders(token, true),
      body: JSON.stringify({
        targetDevice: 'desktop',
        iterations: 1,
        confirmation: true,
        steps: actions.map((a, i) => ({ id: `${step.id}-${i}`, name: `${step.name} (${a.action})`, ...a })),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success !== true || !body.run?.id) return { ok: false, message: failure(res, body) };
    const run = await waitForRun(bridgeUrl, token, body.run.id, pollMs, timeoutMs);
    if (run.status !== 'completed') return { ok: false, message: `PC ${run.status}: ${run.error ?? 'no reason given'}` };
    const to = actions[0].endX !== undefined ? ` → (${actions[0].endX}, ${actions[0].endY})px` : '';
    return { ok: true, message: `Performed ${actions.map((a) => a.action).join(' → ')} on the PC at (${x}, ${y})px${to}, run ${body.run.id}` };
  } catch (error) {
    return { ok: false, message: `${BRIDGE_REQUIRED} (unreachable: ${errorText(error)})` };
  }
}

/** Takes a real desktop screenshot through the bridge (POST /api/replay/capture). */
export async function captureDesktop(bridgeUrl: string, token: string): Promise<{ ok: true; frame: BridgeFrame } | { ok: false; message: string }> {
  if (!bridgeUrl) return { ok: false, message: BRIDGE_REQUIRED };
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/replay/capture`, {
      method: 'POST',
      headers: bridgeHeaders(token, true),
      body: JSON.stringify({ targetDevice: 'desktop' }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => null);
    const frame = body?.frame;
    if (!res.ok || body?.success !== true || !frame?.image) return { ok: false, message: failure(res, body) };
    return { ok: true, frame: { image: frame.image, width: frame.width, height: frame.height } };
  } catch (error) {
    return { ok: false, message: `${BRIDGE_REQUIRED} (unreachable: ${errorText(error)})` };
  }
}

/** Pings the bridge health endpoint. */
export async function checkBridge(bridgeUrl: string, token: string): Promise<BridgeResult> {
  if (!bridgeUrl) return { ok: false, message: BRIDGE_REQUIRED };
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/health`, { headers: bridgeHeaders(token), signal: AbortSignal.timeout(4000) });
    if (res.ok) return { ok: true, message: 'Desktop bridge online' };
    return { ok: false, message: unauthorized(res) ? BRIDGE_UNAUTHORIZED : `${BRIDGE_REQUIRED} (health HTTP ${res.status})` };
  } catch (error) {
    return { ok: false, message: `${BRIDGE_REQUIRED} (offline: ${errorText(error)})` };
  }
}
