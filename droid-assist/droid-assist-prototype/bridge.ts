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
  action: 'click' | 'type_text' | 'press_key' | 'hotkey' | 'wait';
  x: number;
  y: number;
  text?: string;
  keyPayload?: string;
  delayMs: number;
}

type Point = { x: number; y: number };

const at = (p: Point, action: NativeAction['action'], extra: Partial<NativeAction> = {}): NativeAction => ({ action, x: p.x, y: p.y, delayMs: 200, ...extra });
const keys = (p: Point, combo: string) => at(p, combo.includes('+') ? 'hotkey' : 'press_key', { keyPayload: combo.toLowerCase() });
const write = (p: Point, text: string) => at(p, 'type_text', { text });
const appName = (step: WorkflowStep) => step.text ?? step.name.replace(/^open\s+/i, '');

/** Every step action as the real mouse/keyboard input it performs on the PC. */
const NATIVE: Record<StepAction, (step: WorkflowStep, p: Point) => NativeAction[]> = {
  click: (_s, p) => [at(p, 'click')],
  double_click: (_s, p) => [at(p, 'click', { delayMs: 60 }), at(p, 'click')],
  scroll: (s, p) => [at(p, 'click'), keys(p, s.text === 'up' ? 'pageup' : 'pagedown')],
  type: (s, p) => [write(p, s.text ?? '')],
  key: (s, p) => [keys(p, s.text ?? 'enter')],
  open_app: (s, p) => [keys(p, 'win'), at(p, 'wait', { delayMs: 600 }), write(p, appName(s)), keys(p, 'enter')],
  search: (s, p) => [keys(p, 'ctrl+l'), write(p, s.text ?? ''), keys(p, 'enter')],
  calc: (s, p) => [keys(p, 'win'), at(p, 'wait', { delayMs: 600 }), write(p, 'calculator'), keys(p, 'enter'), at(p, 'wait', { delayMs: 1200 }), write(p, s.text ?? ''), keys(p, 'enter')],
  media: (_s, p) => [keys(p, 'playpause')],
  wait: (_s, p) => [at(p, 'wait', { delayMs: 800 })],
};

/** The native actions a step performs at its (drift-corrected) position on a srcW×srcH screen. */
export function nativeActions(step: WorkflowStep, srcW: number, srcH: number): NativeAction[] {
  const p = {
    x: Math.min(srcW - 1, Math.max(0, Math.round((step.correctedX ?? step.x) * srcW))),
    y: Math.min(srcH - 1, Math.max(0, Math.round((step.correctedY ?? step.y) * srcH))),
  };
  return NATIVE[step.action](step, p);
}

const base = (url: string) => url.replace(/\/$/, '');
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** Polls a replay run until the PC reports it finished; only "completed" means the input happened. */
async function waitForRun(bridgeUrl: string, id: string, pollMs: number, timeoutMs: number): Promise<{ status: string; error?: string }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await fetch(`${base(bridgeUrl)}/api/replay/${id}`, { signal: AbortSignal.timeout(4000) });
    const body = await res.json().catch(() => null);
    if (body?.run && TERMINAL.has(body.run.status)) return body.run;
    if (!res.ok) return { status: 'failed', error: body?.error ?? `Bridge HTTP ${res.status}` };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { status: 'failed', error: 'Timed out waiting for the PC to finish the step; its effect is uncertain' };
}

/**
 * Performs one step as real mouse/keyboard input through the Droid desktop bridge
 * (POST /api/replay, then polls the run). Succeeds only when the PC completed it.
 * @param srcW native screen width the step's normalized coordinates map onto
 */
export async function sendToBridge(bridgeUrl: string, step: WorkflowStep, srcW: number, srcH: number, { pollMs = 250, timeoutMs = 60000 } = {}): Promise<BridgeResult> {
  if (!bridgeUrl) return { ok: false, message: BRIDGE_REQUIRED };
  const actions = nativeActions(step, srcW, srcH);
  const { x, y } = actions[0];
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetDevice: 'desktop',
        iterations: 1,
        confirmation: true,
        steps: actions.map((a, i) => ({ id: `${step.id}-${i}`, name: `${step.name} (${a.action})`, ...a })),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success !== true || !body.run?.id) return { ok: false, message: body?.error ?? `Bridge HTTP ${res.status}` };
    const run = await waitForRun(bridgeUrl, body.run.id, pollMs, timeoutMs);
    if (run.status !== 'completed') return { ok: false, message: `PC ${run.status}: ${run.error ?? 'no reason given'}` };
    return { ok: true, message: `Performed ${actions.map((a) => a.action).join(' → ')} on the PC at (${x}, ${y})px, run ${body.run.id}` };
  } catch (error) {
    return { ok: false, message: `${BRIDGE_REQUIRED} (unreachable: ${errorText(error)})` };
  }
}

/** Takes a real desktop screenshot through the bridge (POST /api/replay/capture). */
export async function captureDesktop(bridgeUrl: string): Promise<{ ok: true; frame: BridgeFrame } | { ok: false; message: string }> {
  if (!bridgeUrl) return { ok: false, message: BRIDGE_REQUIRED };
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/replay/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDevice: 'desktop' }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => null);
    const frame = body?.frame;
    if (!res.ok || body?.success !== true || !frame?.image) return { ok: false, message: body?.error ?? `Bridge HTTP ${res.status}` };
    return { ok: true, frame: { image: frame.image, width: frame.width, height: frame.height } };
  } catch (error) {
    return { ok: false, message: `${BRIDGE_REQUIRED} (unreachable: ${errorText(error)})` };
  }
}

/** Pings the bridge health endpoint. */
export async function checkBridge(bridgeUrl: string): Promise<BridgeResult> {
  if (!bridgeUrl) return { ok: false, message: BRIDGE_REQUIRED };
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok ? { ok: true, message: 'Desktop bridge online' } : { ok: false, message: `${BRIDGE_REQUIRED} (health HTTP ${res.status})` };
  } catch (error) {
    return { ok: false, message: `${BRIDGE_REQUIRED} (offline: ${errorText(error)})` };
  }
}
