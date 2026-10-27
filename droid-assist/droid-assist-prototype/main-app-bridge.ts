/**
 * The assist app's side of the mailbox with the main Droid app, carried over the existing
 * python bridge (bridge-service/droid_bridge.py: /api/assist/status, /api/assist/requests).
 * The assist app publishes its status, claims queued requests, invokes them through the
 * capability registry (as a 'main-app' requester, so permission checks apply the same way),
 * and reports each result back.
 */
import { bridgeHeaders } from './bridge.js';
import type { InvocationRecord, Params, Registry } from './capabilities.js';

/** How often the assist app should run one mailbox round against the bridge. */
export const MAIN_APP_POLL_MS = 3000;

/** The assist app's status snapshot, as the main Droid app may query it over the bridge. */
export interface AssistStatus {
  time: number;
  armed: boolean;
  aborted: boolean;
  running: boolean;
  goal: string;
  steps: number;
  settings: Record<string, unknown>;
  capabilities: string[];
}

/** One capability request the main app queued, as the bridge delivers it to the assist app. */
export interface MainAppRequest {
  requestId: string;
  id: string;
  params: Params;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
}

const base = (url: string) => url.replace(/\/$/, '');

/** Publishes the assist app's current status snapshot to the bridge; never throws. */
export async function publishStatus(bridgeUrl: string, token: string, status: AssistStatus): Promise<boolean> {
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/assist/status`, {
      method: 'POST',
      headers: bridgeHeaders(token, true),
      body: JSON.stringify(status),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Whether a claimed entry has the shape of a real request (string requestId and id). */
const isRequest = (v: unknown): v is { requestId: unknown; id: unknown; params: unknown } =>
  typeof v === 'object' && v !== null;

/** The pending requests the main app queued, claimed (and marked running) in one call; never throws. */
export async function claimRequests(bridgeUrl: string, token: string): Promise<MainAppRequest[]> {
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/assist/requests`, { headers: bridgeHeaders(token), signal: AbortSignal.timeout(4000) });
    const body = await res.json().catch(() => null);
    const requests = body?.requests;
    if (!res.ok || !Array.isArray(requests)) return [];
    return requests.filter(isRequest).filter((r) => typeof r.requestId === 'string' && typeof r.id === 'string').map((r) => ({
      requestId: r.requestId as string,
      id: r.id as string,
      params: typeof r.params === 'object' && r.params !== null ? (r.params as Params) : {},
      status: 'running' as const,
    }));
  } catch {
    return [];
  }
}

/** Reports one request's outcome back to the main app over the bridge; never throws. */
export async function reportResult(bridgeUrl: string, token: string, requestId: string, record: InvocationRecord): Promise<boolean> {
  try {
    const res = await fetch(`${base(bridgeUrl)}/api/assist/requests/${requestId}/result`, {
      method: 'POST',
      headers: bridgeHeaders(token, true),
      body: JSON.stringify({ ok: record.ok, result: record.result }),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * One mailbox round with the main app: publish the current status, claim whatever requests
 * it queued, invoke each (in order) through the registry as a 'main-app' requester — the
 * registry applies the same permission checks and logging as any other caller — and report
 * each result back. Returns the invocation records; [] at once when no bridge is configured.
 */
export async function serveMainApp(bridgeUrl: string, token: string, status: AssistStatus, registry: Pick<Registry, 'invoke'>): Promise<InvocationRecord[]> {
  if (!bridgeUrl) return [];
  await publishStatus(bridgeUrl, token, status);
  const requests = await claimRequests(bridgeUrl, token);
  const records: InvocationRecord[] = [];
  for (const request of requests) {
    const record = await registry.invoke(request.id, request.params, { kind: 'main-app' });
    await reportResult(bridgeUrl, token, request.requestId, record);
    records.push(record);
  }
  return records;
}
