import http from 'node:http';
import os from 'node:os';
import { phonePage } from './phone-page.js';

/** One app's live status as the phone shows it. */
export interface PhoneAppStatus {
  name: string;
  /** 'connected' | 'offline' | 'unknown' … whatever the engine reports. */
  status: string;
  detail: string;
}

/** One queued approval the phone can answer. */
export interface PhoneApproval {
  id: string;
  title: string;
  detail: string;
}

/** One saved workflow the phone can trigger. */
export interface PhoneWorkflow {
  id: string;
  name: string;
}

/** The snapshot the renderer pushes to the companion; the phone reads it. */
export interface PhoneState {
  apps: PhoneAppStatus[];
  approvals: PhoneApproval[];
  workflows: PhoneWorkflow[];
  /** Which app currently owns execution ("droid-new", "droid-main" or "neither"). */
  driving: string;
  /** The latest screen frame as a JPEG data URL, or empty when there is none. */
  frame: string;
  /** When the snapshot was taken. */
  updatedAt: number;
}

/** What the phone asks the engine to do. */
export interface PhoneActions {
  approve(id: string): void;
  reject(id: string): void;
  runWorkflow(id: string): void;
}

/** Where the companion listens and the token the phone must present. */
export interface PhoneOptions {
  host: string;
  port: number;
  /** Required as `?token=` or `Authorization: Bearer` when non-empty. */
  token: string;
}

export interface PhoneCompanion {
  /** Resolves once the port is bound; rejects with the reason otherwise. */
  ready: Promise<void>;
  /** The URL a phone on the same network opens (with the token when one is set). */
  url(): string;
  stop(): void;
}

/** Whether a request carries the token (bearer header or `?token=`); anything goes when no token is set. */
function authorized(req: http.IncomingMessage, url: URL, token: string): boolean {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}` || url.searchParams.get('token') === token;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

/** The JPEG bytes of a `data:image/jpeg;base64,…` URL, or null when `frame` is not one. */
export function decodeFrame(frame: string): Buffer | null {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(frame);
  return m ? Buffer.from(m[1], 'base64') : null;
}

/** The status the phone shows: the apps, driving app, counts and when it was last updated. */
export function statusPayload(state: PhoneState) {
  return {
    apps: state.apps,
    driving: state.driving,
    approvals: state.approvals.length,
    workflows: state.workflows.length,
    updatedAt: state.updatedAt,
  };
}

/** The page's data: the full snapshot without the frame, plus whether a frame is available. */
export function pagePayload(state: PhoneState) {
  return { ...statusPayload(state), approvalList: state.approvals, workflowList: state.workflows, hasFrame: !!decodeFrame(state.frame) };
}

/** The first non-internal IPv4 address this machine has, or `fallback` when there is none. */
export function lanAddress(fallback = 'localhost'): string {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return fallback;
}

/** The URL a phone on the same network opens: the machine's LAN address, the port and the token. */
export function phoneUrl(port: number, token: string): string {
  return `http://${lanAddress()}:${port}/${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/**
 * Serves the phone companion: a small mobile page, the live status of both apps, the queued approvals
 * (answerable from the phone), the saved workflows (triggerable), and the live screen. Read-only over
 * the engine's own state — it never holds a second copy.
 */
export function startPhoneCompanion(options: PhoneOptions, getState: () => PhoneState, actions: PhoneActions): PhoneCompanion {
  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://phone');
    if (!authorized(req, url, options.token)) return json(res, 401, { success: false, error: 'unauthorized' });
    const state = getState();

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(phonePage(options.token));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { success: true, ...pagePayload(state) });
    if (req.method === 'GET' && url.pathname === '/api/frame') {
      const jpeg = decodeFrame(state.frame);
      if (!jpeg) return json(res, 404, { success: false, error: 'no frame yet' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      return res.end(jpeg);
    }

    const decision = /^\/api\/approvals\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
    if (req.method === 'POST' && decision) {
      const id = decodeURIComponent(decision[1]);
      if (!state.approvals.some((a) => a.id === id)) return json(res, 404, { success: false, error: `no queued approval "${id}"` });
      if (decision[2] === 'approve') actions.approve(id);
      else actions.reject(id);
      return json(res, 200, { success: true });
    }

    const run = /^\/api\/workflows\/([^/]+)\/run$/.exec(url.pathname);
    if (req.method === 'POST' && run) {
      const id = decodeURIComponent(run[1]);
      if (!state.workflows.some((w) => w.id === id)) return json(res, 404, { success: false, error: `no saved workflow "${id}"` });
      actions.runWorkflow(id);
      return json(res, 200, { success: true });
    }

    return json(res, 404, { success: false, error: 'not found' });
  };

  const server = http.createServer((req, res) => { void handler(req, res).catch((error: Error) => json(res, 500, { success: false, error: error.message })); });

  const ready = new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });

  return {
    ready,
    url: () => phoneUrl(options.port, options.token),
    stop: () => server.close(),
  };
}
