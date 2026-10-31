// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFrame, pagePayload, startPhoneCompanion, statusPayload, type PhoneCompanion, type PhoneState } from './phone-companion.js';

const HOST = '127.0.0.1';
const randomPort = () => 40000 + Math.floor(Math.random() * 20000);

/** A JPEG data URL of `bytes` (only the header has to be real). */
const jpeg = (bytes = 8) => `data:image/jpeg;base64,${Buffer.alloc(bytes, 1).toString('base64')}`;

const state = (over: Partial<PhoneState> = {}): PhoneState => ({
  apps: [{ name: 'droid-new', status: 'connected', detail: 'AI endpoint up' }, { name: 'droid-main', status: 'offline', detail: 'waiting' }],
  approvals: [{ id: 'a1', title: 'Delete the folder', detail: 'Aggressive' }],
  workflows: [{ id: 'w1', name: 'Shopping run' }],
  driving: 'droid-new',
  frame: jpeg(),
  updatedAt: 1700000000000,
  ...over,
});

let running: PhoneCompanion | null = null;
afterEach(() => { running?.stop(); running = null; });

async function serve(over: Partial<PhoneState> = {}, token = '') {
  const actions = { approve: vi.fn(), reject: vi.fn(), runWorkflow: vi.fn() };
  const companion = startPhoneCompanion({ host: HOST, port: randomPort(), token }, () => state(over), actions);
  running = companion;
  await companion.ready;
  const port = new URL(companion.url()).port;
  const base = `http://${HOST}:${port}`;
  return { base, token, actions };
}

const get = (url: string) => fetch(url);
const post = (url: string) => fetch(url, { method: 'POST' });

describe('decodeFrame', () => {
  it('decodes a JPEG data URL and rejects anything else', () => {
    expect(decodeFrame(jpeg(4))?.length).toBe(4);
    expect(decodeFrame('data:image/png;base64,AAAA')).toBeNull();
    expect(decodeFrame('')).toBeNull();
  });
});

describe('statusPayload / pagePayload', () => {
  it('summarises the apps, driving app, counts and update time', () => {
    expect(statusPayload(state())).toEqual({ apps: state().apps, driving: 'droid-new', approvals: 1, workflows: 1, updatedAt: 1700000000000 });
  });

  it('lists approvals and workflows and reports frame availability', () => {
    const p = pagePayload(state());
    expect(p.approvalList).toHaveLength(1);
    expect(p.workflowList[0]).toEqual({ id: 'w1', name: 'Shopping run' });
    expect(p.hasFrame).toBe(true);
    expect(pagePayload(state({ frame: '' })).hasFrame).toBe(false);
  });
});

describe('startPhoneCompanion', () => {
  it('serves the mobile page', async () => {
    const { base } = await serve();
    const res = await get(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Droid Assist');
    expect(html).toContain('/api/state');
  });

  it('reports the live state without the frame bytes', async () => {
    const { base } = await serve();
    const body = await (await get(`${base}/api/state`)).json();
    expect(body.success).toBe(true);
    expect(body.apps).toHaveLength(2);
    expect(body.driving).toBe('droid-new');
    expect(body.hasFrame).toBe(true);
    expect(JSON.stringify(body)).not.toContain('base64');
  });

  it('serves the latest frame as image/jpeg', async () => {
    const { base } = await serve();
    const res = await get(`${base}/api/frame`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(8);
  });

  it('answers 404 for the frame when there is none', async () => {
    const { base } = await serve({ frame: '' });
    expect((await get(`${base}/api/frame`)).status).toBe(404);
  });

  it('approves and rejects queued approvals, refusing unknown ids', async () => {
    const { base, actions } = await serve();
    expect((await post(`${base}/api/approvals/a1/approve`)).status).toBe(200);
    expect(actions.approve).toHaveBeenCalledWith('a1');
    expect((await post(`${base}/api/approvals/a1/reject`)).status).toBe(200);
    expect(actions.reject).toHaveBeenCalledWith('a1');
    expect((await post(`${base}/api/approvals/nope/approve`)).status).toBe(404);
    expect(actions.approve).toHaveBeenCalledTimes(1);
  });

  it('triggers a saved workflow, refusing an unknown one', async () => {
    const { base, actions } = await serve();
    expect((await post(`${base}/api/workflows/w1/run`)).status).toBe(200);
    expect(actions.runWorkflow).toHaveBeenCalledWith('w1');
    expect((await post(`${base}/api/workflows/nope/run`)).status).toBe(404);
  });

  it('requires the token on every route when one is set', async () => {
    const { base } = await serve({}, 'secret');
    expect((await get(`${base}/api/state`)).status).toBe(401);
    expect((await get(`${base}/api/state?token=secret`)).status).toBe(200);
    expect((await post(`${base}/api/approvals/a1/approve?token=secret`)).status).toBe(200);
  });

  it('returns the phone URL carrying the token', async () => {
    const { base } = await serve({}, 'secret');
    expect(running?.url()).toContain('token=secret');
    expect(running?.url()).toContain(`:${new URL(base).port}`);
  });
});
