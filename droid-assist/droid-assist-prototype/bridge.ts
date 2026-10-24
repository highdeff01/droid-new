import type { WorkflowStep } from './types.js';

/** What the desktop bridge reported for a dispatched action. Never assumed successful. */
export interface BridgeResult {
  ok: boolean;
  message: string;
}

/** A real desktop screenshot returned by the bridge. */
export interface BridgeCapture extends BridgeResult {
  /** PNG/JPEG data URL of the full desktop, when ok. */
  image?: string;
}

/** Workflow actions → the bridge's replay actions (python-service/replay.py). */
const ACTION_MAP: Record<string, string> = { click: 'click', double_click: 'double_click', scroll: 'scroll', type: 'type_text', key: 'press_key' };

const base = (bridgeUrl: string) => bridgeUrl.replace(/\/$/, '');
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** POSTs JSON to the bridge and reports `success: true` replies only as ok. */
async function postBridge(bridgeUrl: string, path: string, payload: unknown): Promise<BridgeResult & { body?: { run?: { id?: string } } }> {
  try {
    const res = await fetch(`${base(bridgeUrl)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success !== true) return { ok: false, message: body?.error ?? `Bridge HTTP ${res.status}` };
    return { ok: true, message: body?.message ?? 'ok', body };
  } catch (error) {
    return { ok: false, message: `Bridge unreachable: ${errorText(error)}` };
  }
}

/** Native pixel position of a step on a screen of srcW × srcH. */
export function stepPixels(step: WorkflowStep, srcW: number, srcH: number) {
  return { x: Math.round((step.correctedX ?? step.x) * srcW), y: Math.round((step.correctedY ?? step.y) * srcH) };
}

/**
 * Sends one step to the Droid desktop bridge (Express + python-service/replay.py via
 * pyautogui/subprocess) as native screen pixels. Rejects nothing: failures are returned.
 * @param srcW native screen width the step's normalized coordinates map onto
 */
export async function sendToBridge(bridgeUrl: string, step: WorkflowStep, srcW: number, srcH: number): Promise<BridgeResult> {
  const action = ACTION_MAP[step.action];
  if (!action) return { ok: false, message: `"${step.action}" has no native bridge action` };
  const { x, y } = stepPixels(step, srcW, srcH);
  const keyPayload = step.action === 'scroll' ? step.text ?? 'down' : step.text;
  const r = await postBridge(bridgeUrl, '/api/replay', {
    targetDevice: 'desktop',
    iterations: 1,
    confirmation: true,
    steps: [{ id: step.id, name: step.name, action, x, y, text: step.text, keyPayload, delayMs: 200 }],
  });
  return r.ok ? { ok: true, message: `Dispatched to PC at (${x}, ${y}), run ${r.body?.run?.id ?? ''}` } : r;
}

/** Moves the real mouse pointer to native pixels (x, y). */
export async function moveOnBridge(bridgeUrl: string, x: number, y: number): Promise<BridgeResult> {
  const r = await postBridge(bridgeUrl, '/api/pyautogui/execute', { action: 'move', x, y });
  return r.ok ? { ok: true, message: `Moved pointer to (${x}, ${y})` } : r;
}

/** Launches or focuses an application on the desktop by name/command. */
export async function launchOnBridge(bridgeUrl: string, target: string): Promise<BridgeResult> {
  // A no-op wait keeps the bridge from running its default click alongside the launch.
  const r = await postBridge(bridgeUrl, '/api/pyautogui/bridge', { launchApp: target, actions: [{ type: 'wait', delayMs: 0 }] });
  return r.ok ? { ok: true, message: `Launched "${target}" on the PC` } : r;
}

/** Takes a real screenshot of the desktop through the bridge. */
export async function captureBridgeScreen(bridgeUrl: string): Promise<BridgeCapture> {
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/capture-screen`, { signal: AbortSignal.timeout(6000) });
    const body = await res.json().catch(() => null);
    const image: unknown = body?.imageData ?? body?.image;
    if (!res.ok || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return { ok: false, message: body?.error ?? `Bridge capture HTTP ${res.status}` };
    }
    return { ok: true, message: 'Captured desktop', image };
  } catch (error) {
    return { ok: false, message: `Bridge capture failed: ${errorText(error)}` };
  }
}

/** Pings the bridge health endpoint. */
export async function checkBridge(bridgeUrl: string): Promise<BridgeResult> {
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok ? { ok: true, message: 'Desktop bridge online' } : { ok: false, message: `Bridge HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, message: `Bridge offline: ${errorText(error)}` };
  }
}
