import { BRIDGE_UNAUTHORIZED, checkBridge, insecureBridgeUrl, sendToBridge, type BridgeResult } from './bridge.js';
import type { WorkflowStep } from './types.js';

/** The port(s) the python bridge listens on (droid_bridge.py: DROID_BRIDGE_PORT, default 3000). */
export const BRIDGE_PORTS = [3000];

/** Per-host health-check timeout while sweeping; unanswered addresses must not stall the scan. */
export const PROBE_TIMEOUT_MS = 1500;

/** The honest result of a sweep that found nothing, with a hint on how to start the bridge. */
export const NOTHING_FOUND =
  'No desktop bridge answered on localhost or the local subnet — start the python-service (DROID_BRIDGE_TOKEN=… python bridge-service/droid_bridge.py; set DROID_BRIDGE_HOST=0.0.0.0 to reach it from another machine) and try again';

/** A host that answered the bridge health check: online, or present but refusing the current token. */
export interface BridgeCandidate {
  url: string;
  latencyMs: number;
  status: 'online' | 'needs-token';
  /** Plain http to a non-localhost host: the token and input would cross the LAN unencrypted. */
  insecure: boolean;
}

/** The outcome of one verification step of the connection wizard. */
export interface VerifyStep {
  step: 'health' | 'dry-run';
  ok: boolean;
  message: string;
}

type Check = (url: string, token: string, timeoutMs?: number) => Promise<BridgeResult>;
type Send = typeof sendToBridge;

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const FALLBACK_SUBNETS = ['192.168.1', '192.168.0'];
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Whether an address is a private (RFC 1918) IPv4 address — one on a local network. */
function privateIpv4(host: string): boolean {
  const m = IPV4.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The host of a hint that is a URL or a bare hostname; '' when it has none. */
function hostOf(hint: string): string {
  try {
    return new URL(/^[a-z]+:\/\//i.test(hint) ? hint : `http://${hint}`).hostname;
  } catch {
    return '';
  }
}

/**
 * The /24 subnets ("192.168.1") to sweep: those of the private IPv4 hosts among the hints
 * (the page's hostname, the configured bridge URL); the common home subnets when there are none.
 */
export function localSubnets(hints: string[]): string[] {
  const subnets = hints.map(hostOf).filter(privateIpv4).map((h) => h.split('.').slice(0, 3).join('.'));
  return subnets.length ? [...new Set(subnets)] : FALLBACK_SUBNETS;
}

/** Every bridge URL to probe: localhost first, then each host .1–.254 of the subnets, on each port. */
export function candidateUrls(hints: string[], ports: number[] = BRIDGE_PORTS): string[] {
  const subnetHosts = localSubnets(hints).flatMap((s) => Array.from({ length: 254 }, (_, i) => `${s}.${i + 1}`));
  const hosts = [...LOCAL_HOSTS, ...subnetHosts];
  return [...new Set(hosts.flatMap((h) => ports.map((p) => `http://${h}:${p}`)))];
}

/** Probes one URL with the bridge health check; a candidate when it answered, null when not. */
export async function probeCandidate(url: string, token: string, check: Check = checkBridge, now: () => number = () => performance.now()): Promise<BridgeCandidate | null> {
  const start = now();
  const health = await check(url, token, PROBE_TIMEOUT_MS);
  const latencyMs = Math.round(now() - start);
  const status = health.ok ? 'online' : health.message === BRIDGE_UNAUTHORIZED ? 'needs-token' : null;
  return status ? { url, latencyMs, status, insecure: insecureBridgeUrl(url) } : null;
}

/**
 * Probes every URL, at most `concurrency` at a time, and returns the responsive candidates
 * fastest first. `onProgress` gets the number of URLs probed so far.
 */
export async function discoverBridges(urls: string[], token: string, { check = checkBridge as Check, concurrency = 64, onProgress = (_done: number) => {} } = {}): Promise<BridgeCandidate[]> {
  const found: BridgeCandidate[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < urls.length) {
      const candidate = await probeCandidate(urls[next++], token, check);
      if (candidate) found.push(candidate);
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return found.sort((a, b) => a.latencyMs - b.latencyMs);
}

/** The settings with the picked candidate's URL auto-filled as the bridge URL; nothing else changes. */
export function applyCandidate<S extends { bridgeUrl: string }>(settings: S, candidate: BridgeCandidate): S {
  return { ...settings, bridgeUrl: candidate.url };
}

/** The harmless dry action: a single pyautogui-free "wait" — no mouse or keyboard input. */
const DRY_STEP: WorkflowStep = { id: 'bridge-wizard-check', name: 'Bridge connection check', action: 'wait', x: 0, y: 0, status: 'pending' };

/**
 * End-to-end verification: the health check, then (only if it passed) a dry "wait" run the PC
 * must complete. The bridge counts as connected only when every returned step is ok.
 */
export async function verifyBridge(url: string, token: string, { check = checkBridge as Check, send = sendToBridge as Send } = {}): Promise<VerifyStep[]> {
  const health = await check(url, token);
  const steps: VerifyStep[] = [{ step: 'health', ok: health.ok, message: health.message }];
  if (!health.ok) return steps;
  const dry = await send(url, DRY_STEP, 1, 1, { token, timeoutMs: 10000 });
  return [...steps, { step: 'dry-run', ok: dry.ok, message: dry.ok ? 'Dry run (wait) completed on the PC — no input performed' : dry.message }];
}
