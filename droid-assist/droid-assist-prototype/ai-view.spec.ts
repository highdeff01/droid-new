import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_VIEWS, DEFAULT_AI_VIEW, SAMPLE_VIEW, createAiSession, viewPoint, type AiReply, type AskFn, type RenderFn } from './ai.js';
import { gridPrompt, replyPoint } from './grid.js';
import { parsePlan, relocateTarget, planFromGoal } from './planner.js';
import { decidePopup, describeScreen, toAnnotation } from './assist-ai.js';
import { proposeStep } from './proposal.js';
import { observeScreen } from './watcher.js';
import { parseReview, reviewRun } from './supervisor.js';
import { identifyRequest, parseIdentification } from './identify.js';
import { loadSettings } from './storage.js';
import { DEFAULT_SETTINGS } from './use-assist.js';
import type { Frame, WorkflowStep } from './types.js';

const HD = AI_VIEWS['1280x720'];
const MID = AI_VIEWS['960x540'];
const frame = { id: 1, url: 'data:image/jpeg;base64,U01BTEw=', full: 'data:image/jpeg;base64,RlVMTA==', srcW: 1920, srcH: 1080, source: 'screen' } as Frame;
const step: WorkflowStep = { id: 's', name: 'Open Files', action: 'click', target: 'Files', x: 0.5, y: 0.5, status: 'pending' };
/** An asker whose reply says its screenshots were sent at `view`. */
const askIn = (content: string, view = HD) => vi.fn<AskFn>(async (): Promise<AiReply> => ({ content, thinking: null, view }));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AI view resolutions', () => {
  it('offers 480x270, 960x540 and 1280x720 and defaults to 960x540', () => {
    expect(Object.keys(AI_VIEWS)).toEqual(['480x270', '960x540', '1280x720']);
    expect(DEFAULT_AI_VIEW).toBe('960x540');
    expect(DEFAULT_SETTINGS.aiView).toBe('960x540');
  });

  it('persists a chosen view and ignores an unknown one', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ aiView: '1280x720' }));
    expect(loadSettings(DEFAULT_SETTINGS).aiView).toBe('1280x720');
    localStorage.setItem('droid-assist.settings', JSON.stringify({ aiView: '4000x3000' }));
    expect(loadSettings(DEFAULT_SETTINGS).aiView).toBe('960x540');
  });

  it('describes the grid in pixels of the chosen view', () => {
    expect(gridPrompt(HD)).toContain('the 1280x720 screenshot');
    expect(gridPrompt(HD)).toContain('12=0.917..1.000 (1173-1280px)');
    expect(gridPrompt(MID)).toContain('H=0.875..1.000 (473-540px)');
  });
});

describe('scaling model pixels back to the 480x270 sample space', () => {
  it('reads pixel coordinates in the view the model saw', () => {
    expect(viewPoint(640, 360, HD)).toEqual({ x: 0.5, y: 0.5 });
    expect(viewPoint(240, 135, MID)).toEqual({ x: 0.25, y: 0.25 });
    expect(viewPoint(240, 135)).toEqual({ x: 0.5, y: 0.5 });
    expect(viewPoint(0.3, 0.6, HD)).toEqual({ x: 0.3, y: 0.6 });
  });

  it('replyPoint scales global x,y by the view and leaves grid cells resolution independent', () => {
    expect(replyPoint({ x: 960, y: 540 }, undefined, HD)).toEqual({ x: 0.75, y: 0.75 });
    expect(replyPoint({ cell: 'A1', cx: 0.5, cy: 0.5 }, undefined, HD)).toEqual(replyPoint({ cell: 'A1', cx: 0.5, cy: 0.5 }));
  });

  it('planner steps and drag drop points use the reply view', async () => {
    const [s] = parsePlan('{"steps":[{"name":"d","action":"drag","target":"a","x":320,"y":180,"endX":960,"endY":540}]}', null, HD);
    expect(s).toMatchObject({ x: 0.25, y: 0.25, endX: 0.75, endY: 0.75 });
    const plan = await planFromGoal('open files', [], frame, askIn('{"steps":[{"name":"c","action":"click","target":"Files","x":480,"y":270}]}', MID));
    expect(plan.steps[0]).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('grounding relocation scales and sends the full frame plus a zoomed crop', async () => {
    const crop = { ...frame, url: 'data:image/jpeg;base64,Q1JPUA==', full: undefined };
    const ask = askIn('{"steps":[{"action":"click","target":"Files","x":1280,"y":0}]}');
    expect(await relocateTarget(ask, frame, step, 'wrong', [], crop)).toMatchObject({ x: 1, y: 0 });
    expect(ask.mock.calls[0][0]).toMatchObject({ frame, crops: [crop] });
  });

  it('popup, screen help, proposal, watcher, supervisor and identification scale by the reply view', async () => {
    const popup = await decidePopup(askIn('{"close":true,"x":640,"y":180,"reason":"ad"}'), frame, { x: 0, y: 0, w: 1, h: 1 });
    expect(popup).toMatchObject({ close: true, x: 0.5, y: 0.25 });
    const help = await describeScreen(askIn('{"answer":"a","items":[{"label":"b","x":320,"y":180,"w":128,"h":72}]}'), frame, 'q', '');
    expect(help.annotations[0]).toMatchObject({ x: 0.25, y: 0.25, w: 0.1, h: 0.1 });
    expect(toAnnotation({ x: 240, y: 135, w: 48, h: 27 })).toMatchObject({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
    const p = await proposeStep(askIn('{"ready":true,"x":320,"y":540,"why":"w"}'), frame, step, { goal: 'g', change: null, patterns: [] });
    expect(p).toMatchObject({ x: 0.25, y: 0.75 });
    const o = await observeScreen(askIn('{"notes":[],"proposals":[{"kind":"familiar","text":"t","target":"Files","x":1280,"y":720}]}'), frame, [], [], '');
    expect(o.proposals[0]).toMatchObject({ x: 1, y: 1 });
    expect(parseReview('{"assessment":"a","step_fixes":[{"step":1,"x":640,"y":360}]}', null, [step], 0, HD).stepFixes[0]).toMatchObject({ x: 0.5, y: 0.5 });
    const id = parseIdentification({ content: '{"found":true,"name":"n","x":960,"y":180,"reason":"r"}', thinking: null, view: HD }, 'x');
    expect(id).toMatchObject({ found: true, x: 0.75, y: 0.25 });
  });

  it('supervisor review resolves its prompt for the view and scales its fixes', async () => {
    const ask = askIn('{"assessment":"ok","step_fixes":[{"step":1,"x":320,"y":180}]}', HD);
    const r = await reviewRun(ask, { goal: 'g', steps: [step], log: [], timeline: [], frames: [frame], sync: { level: 'green', detail: 'ok' }, progress: { done: 0, manual: 0 } });
    expect(r.stepFixes[0]).toMatchObject({ x: 0.25, y: 0.25 });
    const system = ask.mock.calls[0][0].system;
    expect(typeof system === 'function' ? system(HD) : system).toContain('(1280x720)');
  });

  it('identification sends the full frame first and the full-resolution crop after it', () => {
    const crop = { ...frame, url: 'data:image/jpeg;base64,Q1JPUA==' };
    const data = { data: new Uint8ClampedArray(320 * 180 * 4), width: 320, height: 180 } as ImageData;
    const req = identifyRequest({ reason: 'new_element', box: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, frame: { ...frame, data }, crop, mapped: [] });
    expect(req.frame?.url).toBe(frame.url);
    expect(req.crops).toEqual([crop]);
  });
});

describe('createAiSession at an AI view', () => {
  const reply = (content: string) => new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status: 200 });

  it('renders frames at the view, sends crops unchanged, resolves the system prompt and stamps the view', async () => {
    const fetchFn = vi.fn(async () => reply('{}'));
    vi.stubGlobal('fetch', fetchFn);
    const render = vi.fn<RenderFn>(async (_f, v) => `data:image/jpeg;base64,${v.w}`);
    const crop = { ...frame, url: 'data:image/jpeg;base64,Q1JPUA==' };
    const session = createAiSession(null, render);
    const out = await session.ask({ url: 'http://m.test', model: 'm', view: HD }, { system: (v) => `sys ${v.w}x${v.h}`, prompt: 'p', frame, crops: [crop] });
    expect(out.view).toEqual(HD);
    expect(render).toHaveBeenCalledWith(frame, HD);
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content).toBe('sys 1280x720');
    expect(body.messages[1].images).toEqual(['1280', 'Q1JPUA==']);
  });

  it('falls back to the sample-space JPEG and view when rendering fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('{}')));
    const session = createAiSession(null, async () => { throw new Error('no canvas'); });
    const out = await session.ask({ url: 'http://m.test', model: 'm', view: HD }, { system: 's', prompt: 'p', frame });
    expect(out.view).toEqual(SAMPLE_VIEW);
  });
});
