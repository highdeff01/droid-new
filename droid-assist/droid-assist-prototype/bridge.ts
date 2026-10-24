import type { WorkflowStep } from './types.js';

/** What the desktop bridge reported for a dispatched action. Never assumed successful. */
export interface BridgeResult {
  ok: boolean;
  message: string;
}

const ACTION_MAP: Record<string, string> = { click: 'click', type: 'type_text', key: 'press_key' };

/**
 * Sends one step to the Droid desktop bridge (Express + python-service/replay.py via
 * pyautogui/subprocess) as native screen pixels. Rejects nothing: failures are returned.
 * @param srcW native screen width the step's normalized coordinates map onto
 */
export async function sendToBridge(bridgeUrl: string, step: WorkflowStep, srcW: number, srcH: number): Promise<BridgeResult> {
  const action = ACTION_MAP[step.action];
  if (!action) return { ok: false, message: `"${step.action}" has no native bridge action` };
  const x = Math.round((step.correctedX ?? step.x) * srcW);
  const y = Math.round((step.correctedY ?? step.y) * srcH);
  try {
    const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/api/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetDevice: 'desktop',
        iterations: 1,
        confirmation: true,
        steps: [{ id: step.id, name: step.name, action, x, y, text: step.text, keyPayload: step.text, delayMs: 200 }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success !== true) return { ok: false, message: body?.error ?? `Bridge HTTP ${res.status}` };
    return { ok: true, message: `Dispatched to PC at (${x}, ${y}), run ${body.run?.id ?? ''}` };
  } catch (error) {
    return { ok: false, message: `Bridge unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Pings the bridge health endpoint. */
export async function checkBridge(bridgeUrl: string): Promise<BridgeResult> {
  try {
    const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok ? { ok: true, message: 'Desktop bridge online' } : { ok: false, message: `Bridge HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, message: `Bridge offline: ${error instanceof Error ? error.message : String(error)}` };
  }
}
