import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame, WorkflowStep } from './types.js';
import { createBudget } from './safety.js';
import { createRegistry, invokeCapability, type Caller } from './capability-registry.js';
import { askResearch, compositionBriefing, findOutput, notifyAction, parseAction, presentationCaps, type CompositionApproval, type PresentationDeps, type PresentationStores } from './presentation-caps.js';
import { usePresentations, type UsePresentationDeps } from './use-presentations.js';
import type { NotifyInput } from './rich-notifications.js';
import type { Slideshow } from './slideshow.js';
import type { Movie } from './movie.js';
import type { PresentationProject, WorldEmbed } from './presentation-project.js';
import type { StepRun } from './use-capabilities.js';

const IMG = `data:image/jpeg;base64,${'B'.repeat(40)}`;
const pixels = () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) as unknown as ImageData;
const frame = (id: number, url = IMG, source: Frame['source'] = 'desktop'): Frame => ({ id, time: id * 1000, url, data: pixels(), srcW: 1920, srcH: 1080, source });

function setup(over: Partial<PresentationDeps> = {}) {
  const notes: NotifyInput[] = [];
  const ran: Array<{ step: WorkflowStep; dryRun: boolean }> = [];
  const saved = { slideshows: [] as Slideshow[], movies: [] as Movie[], projects: [] as PresentationProject[], embed: null as WorldEmbed | null, queue: [] as CompositionApproval[] };
  const deps: PresentationDeps = {
    runBriefed: vi.fn(async (_a: string, step: WorkflowStep, _b: unknown, dryRun: boolean): Promise<StepRun> => {
      ran.push({ step, dryRun });
      return { ok: true, executed: !dryRun, message: dryRun ? 'dry run' : 'sent' };
    }),
    newBudget: () => createBudget(5),
    armed: () => false,
    dispatch: () => ({ real: false, label: 'Dry run', reason: 'disarmed — not dispatched' }),
    sources: {
      app: async () => ({ ok: true, value: frame(50, IMG) }),
      web: async (topic) => ({ ok: true, value: [`${topic} fact one`, `${topic} fact two`] }),
      pc: async () => ({ ok: false, reason: 'bridge not connected' }),
      demo: async () => ({ ok: true, value: frame(60, IMG, 'demo') }),
    },
    frames: () => [frame(3), frame(2), frame(1)],
    ask: () => null,
    log: vi.fn(),
    notify: (n) => notes.push(n),
    ...over,
  };
  const stores: PresentationStores = {
    slideshows: () => saved.slideshows,
    saveSlideshow: (s) => { saved.slideshows = [s, ...saved.slideshows.filter((x) => x.id !== s.id)]; },
    movies: () => saved.movies,
    saveMovie: (m) => { saved.movies = [m, ...saved.movies]; },
    projects: () => saved.projects,
    saveProjects: (l) => { saved.projects = l; },
    embed: (e) => { saved.embed = e; },
    queue: (a) => saved.queue.push(a),
  };
  const reg = createRegistry(presentationCaps(deps, stores));
  const call = (id: string, params: Record<string, unknown>, caller: Caller = { kind: 'user' }) => invokeCapability(reg, caller, id, params, () => true);
  return { deps, stores, saved, notes, ran, call };
}

describe('slideshow.build', () => {
  it('mixes app, web and demo sources with given slides; skips an offline PC source with its reason', async () => {
    const t = setup();
    const r = await t.call('slideshow.build', {
      name: 'Quarterly',
      transition: 'zoom',
      slides: [{ title: 'Preferred', notes: ['why'], frame: 2 }],
      sources: [{ kind: 'app', subject: 'Excel' }, { kind: 'web', subject: 'sales' }, { kind: 'pc' }, { kind: 'demo' }],
    });
    expect(r.ok).toBe(true);
    const show = t.saved.slideshows[0];
    expect(show.status).toBe('verified');
    expect(show.slides.map((s) => s.title)).toEqual(['Preferred', 'Excel (connected app)', 'Research: sales', 'In the demo world']);
    expect(show.slides.every((s) => s.transition === 'zoom')).toBe(true);
    expect(show.slides[0].imageFrom).toBe('frame');
    expect(show.slides[2].research.map((f) => f.text)).toEqual(['sales fact one', 'sales fact two']);
    expect(r.message).toContain('pc source skipped — bridge not connected');
  });

  it('raises an assembled and a follow-up notification with play/export/embed and an open-app input action', async () => {
    const t = setup();
    await t.call('slideshow.build', { name: 'Deck', sources: [{ kind: 'app', subject: 'Excel' }] });
    expect(t.notes.map((n) => n.topic)).toEqual(['slideshow', 'slideshow']);
    const done = t.notes[1];
    expect(done.severity).toBe('success');
    expect(done.image).toBe(IMG);
    const id = t.saved.slideshows[0].id;
    expect(done.actions?.map((a) => a.id)).toEqual([`play:${id}`, `export:${id}`, `embed:${id}`, 'open-app:Excel']);
    expect(done.actions?.find((a) => a.id === 'open-app:Excel')?.input).toBe(true);
  });

  it('marks the slideshow incomplete when a slide keeps failing its follow-up check', async () => {
    const t = setup({ frames: () => [frame(9, 'data:image/jpeg;base64,short')] });
    const r = await t.call('slideshow.build', { name: 'Bad', slides: [{ title: 'Broken image', screenshot: true }] });
    expect(r.ok).toBe(false);
    expect(t.saved.slideshows[0].status).toBe('incomplete');
    expect(r.message).toContain('verified in 3 pass(es)');
    expect(t.notes[1].severity).toBe('warning');
  });

  it('refuses when no source yields anything', async () => {
    const t = setup();
    const r = await t.call('slideshow.build', { name: 'Empty', sources: [{ kind: 'pc' }] });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('nothing to show');
    expect(t.saved.slideshows).toEqual([]);
  });
});

describe('approval flow', () => {
  it.each<Caller>([{ kind: 'main' }, { kind: 'agent', stage: 'supervisor' }])('queues a %o composition with a briefing and runs nothing', async (caller) => {
    const t = setup();
    const r = await t.call('slideshow.build', { name: 'AI deck', sources: [{ kind: 'web', subject: 'rust' }] }, caller);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Awaiting your approval');
    expect(t.saved.slideshows).toEqual([]);
    expect(t.saved.queue[0].capability).toBe('slideshow.build');
    expect(t.saved.queue[0].briefing).toContain('web "rust"');
    expect(t.notes[0].topic).toBe('approval');
    expect(t.notes[0].actions?.map((a) => a.id)).toEqual([`approve:${t.saved.queue[0].id}`, `reject:${t.saved.queue[0].id}`]);
  });

  it('briefing names the caller, the output and the project', () => {
    expect(compositionBriefing('presentation.add-to-project', { presentation: 'Deck', project: 'Launch' }, { kind: 'main' })).toBe('Main AI asks for presentation.add-to-project: "Deck" into project "Launch" · sources: gallery / given slides');
  });
});

describe('movie.render', () => {
  it('renders the gallery as a run replay, oldest frame first', async () => {
    const t = setup({ frames: () => [frame(3, `data:image/png;base64,${'C'.repeat(40)}`), frame(2), frame(1)] });
    const r = await t.call('movie.render', { name: 'Replay', holdMs: 500 });
    expect(r.ok).toBe(true);
    const m = t.saved.movies[0];
    expect(m.status).toBe('verified');
    expect(m.shots).toHaveLength(3);
    expect(m.shots[2].image).toContain('image/png');
    expect(m.shots.every((s) => s.holdMs === 500)).toBe(true);
    expect(t.notes[0]).toMatchObject({ topic: 'movie', title: 'Movie "Replay" rendered', image: m.shots[0].image });
  });

  it('renders a saved slideshow story by name', async () => {
    const t = setup();
    await t.call('slideshow.build', { name: 'Story', sources: [{ kind: 'demo' }, { kind: 'web', subject: 'x' }] });
    const r = await t.call('movie.render', { name: 'Story movie', slideshow: 'story' });
    expect(r.ok).toBe(true);
    expect(t.saved.movies[0].shots.map((s) => s.caption)).toEqual(['In the demo world']);
  });

  it('refuses without any frame', async () => {
    const t = setup({ frames: () => [] });
    const r = await t.call('movie.render', { name: 'None' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('no frames or screenshots');
  });
});

describe('project and world embed', () => {
  it('adds a saved presentation to an existing project without replacing it, and notifies', async () => {
    const t = setup();
    t.saved.projects = [{ id: 'p1', name: 'Launch', created: 0, presentations: [{ id: 'old', kind: 'movie', name: 'Old', added: 0 }] }];
    await t.call('slideshow.build', { name: 'Deck', sources: [{ kind: 'demo' }] });
    const r = await t.call('presentation.add-to-project', { presentation: 'Deck', project: 'launch' });
    expect(r.ok).toBe(true);
    expect(t.saved.projects[0].presentations.map((p) => p.name)).toEqual(['Old', 'Deck']);
    expect(t.notes.at(-1)?.topic).toBe('project');
  });

  it('embeds a saved slideshow on the in-world screen', async () => {
    const t = setup();
    await t.call('slideshow.build', { name: 'Deck', sources: [{ kind: 'demo' }] });
    const r = await t.call('presentation.embed', { presentation: 'Deck' });
    expect(r.ok).toBe(true);
    expect(t.saved.embed).toMatchObject({ kind: 'slideshow', title: 'Deck', images: [IMG] });
    expect(t.notes.at(-1)?.topic).toBe('embed');
  });

  it('refuses an unknown presentation', async () => {
    const t = setup();
    expect((await t.call('presentation.embed', { presentation: 'nope' })).ok).toBe(false);
    expect((await t.call('presentation.add-to-project', { presentation: 'nope', project: 'X' })).ok).toBe(false);
    expect(findOutput(t.stores, 'nope')).toBeNull();
  });
});

describe('notification actions and research', () => {
  it('round-trips action ids and rejects unknown kinds', () => {
    expect(parseAction(notifyAction('approve', 'a:1', 'Approve').id)).toEqual({ kind: 'approve', ref: 'a:1' });
    expect(parseAction('launch:x')).toBeNull();
  });

  it('web research is offline without the AI and parses findings with it', async () => {
    expect(await askResearch(null)('x')).toEqual({ ok: false, reason: 'AI offline — no side research' });
    const ask = vi.fn(async () => ({ content: '{"findings":["a","  ","b"]}', thinking: null }));
    expect(await askResearch(ask)('x')).toEqual({ ok: true, value: ['a', 'b'] });
  });
});

describe('usePresentations', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const hookDeps = (over: Partial<UsePresentationDeps> = {}) => {
    const { deps } = setup();
    const { notify: _n, ...rest } = deps;
    return { ...rest, ...over } as UsePresentationDeps;
  };

  it('runs an approved AI composition, persists it and clears the approval', async () => {
    const { result } = renderHook(() => usePresentations(hookDeps()));
    const reg = createRegistry(result.current.capabilities);
    await act(() => invokeCapability(reg, { kind: 'main' }, 'slideshow.build', { name: 'AI deck', sources: [{ kind: 'demo' }] }, () => true));
    expect(result.current.slideshows).toEqual([]);
    expect(result.current.approvals).toHaveLength(1);
    expect(result.current.notifications[0].topic).toBe('approval');
    const r = await act(() => result.current.approve(result.current.approvals[0].id));
    expect(r?.ok).toBe(true);
    expect(result.current.approvals).toEqual([]);
    expect(result.current.slideshows[0].name).toBe('AI deck');
    expect(JSON.parse(localStorage.getItem('droid-assist.slideshows') ?? '[]')).toHaveLength(1);
  });

  it('a rejected approval runs nothing', async () => {
    const { result } = renderHook(() => usePresentations(hookDeps()));
    const reg = createRegistry(result.current.capabilities);
    await act(() => invokeCapability(reg, { kind: 'agent', stage: 'supervisor' }, 'movie.render', { name: 'M' }, () => true));
    act(() => result.current.reject(result.current.approvals[0].id));
    expect(result.current.approvals).toEqual([]);
    expect(result.current.movies).toEqual([]);
  });

  it('an open-app notification action goes through the briefed real-input path as a dry run when disarmed', async () => {
    const runBriefed = vi.fn(async (): Promise<StepRun> => ({ ok: true, executed: false, message: 'dry run' }));
    const { result } = renderHook(() => usePresentations(hookDeps({ runBriefed })));
    await act(async () => {
      result.current.act('n1', 'open-app:Excel');
      await Promise.resolve();
    });
    expect(runBriefed).toHaveBeenCalledWith('Notification: open Excel', expect.objectContaining({ action: 'open_app', text: 'Excel' }), expect.anything(), true);
  });

  it('an embed action shows the presentation on the in-world screen', async () => {
    const { result } = renderHook(() => usePresentations(hookDeps()));
    const reg = createRegistry(result.current.capabilities);
    await act(() => invokeCapability(reg, { kind: 'user' }, 'slideshow.build', { name: 'Deck', sources: [{ kind: 'demo' }] }, () => true));
    act(() => result.current.act('n', `embed:${result.current.slideshows[0].id}`));
    expect(result.current.embed?.title).toBe('Deck');
    expect(result.current.currentEmbed()?.title).toBe('Deck');
  });
});
