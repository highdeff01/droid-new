import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL_LAYOUT, FLOAT_HANDLE_HEIGHT, MIN_FLOAT_WIDTH, clampFloatRect, dockPanel, floatPanel, movePanel, raisePanel, sanitizePanelLayout,
  type PanelLayout,
} from './panel-layout.js';

const all = (l: PanelLayout) => [...l.top, ...l.side, ...l.bottom];
const VIEW = { width: 1280, height: 800 };

describe('sanitizePanelLayout', () => {
  it('falls back to the default layout for non-objects', () => {
    for (const raw of [undefined, null, 42, 'side', [], true]) expect(sanitizePanelLayout(raw, VIEW)).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it('puts the AI thinking and responses panels at the top by default', () => {
    expect(DEFAULT_PANEL_LAYOUT.top).toEqual(['qwenThinking', 'aiResponses']);
    expect([...DEFAULT_PANEL_LAYOUT.side, ...DEFAULT_PANEL_LAYOUT.bottom]).not.toContain('qwenThinking');
  });

  it('keeps a valid stored order, including panels moved across areas', () => {
    const stored = {
      top: ['aiResponses', 'log', 'qwenThinking'],
      side: [...DEFAULT_PANEL_LAYOUT.side].reverse(),
      bottom: DEFAULT_PANEL_LAYOUT.bottom.filter((id) => id !== 'log'),
      floating: {},
    };
    expect(sanitizePanelLayout(stored, VIEW)).toEqual(stored);
  });

  it('respects a stored top area the user moved the AI panels out of', () => {
    const out = sanitizePanelLayout({ top: [], side: ['qwenThinking'], bottom: [] }, VIEW);
    expect(out.top).toEqual(['aiResponses']);
    expect(out.side[0]).toBe('qwenThinking');
  });

  it('migrates a layout saved before the top area existed: the AI panels surface at the top', () => {
    const legacy = { side: ['goals', 'aiResponses'], bottom: ['log', 'qwenThinking', 'errors'] };
    const out = sanitizePanelLayout(legacy, VIEW);
    expect(out.top).toEqual(['qwenThinking', 'aiResponses']);
    expect(out.side.slice(0, 1)).toEqual(['goals']);
    expect(out.bottom.slice(0, 2)).toEqual(['log', 'errors']);
    expect(new Set(all(out)).size).toBe(all(DEFAULT_PANEL_LAYOUT).length);
  });

  it('drops unknown and repeated ids and appends missing panels to their default area in default order', () => {
    const out = sanitizePanelLayout({ top: [], side: ['goals', 'nope', 7, 'goals', 'log'], bottom: 'x' }, VIEW);
    expect(out.side.slice(0, 2)).toEqual(['goals', 'log']);
    expect(out.side.slice(2)).toEqual(DEFAULT_PANEL_LAYOUT.side.filter((id) => id !== 'goals'));
    expect(out.bottom).toEqual(DEFAULT_PANEL_LAYOUT.bottom.filter((id) => id !== 'log'));
    expect(out.top).toEqual(DEFAULT_PANEL_LAYOUT.top);
    expect(new Set(all(out)).size).toBe(all(DEFAULT_PANEL_LAYOUT).length);
    expect(all(out)).toHaveLength(all(DEFAULT_PANEL_LAYOUT).length);
  });

  it('restores persisted floating positions that fit the viewport unchanged', () => {
    const floating = { log: { x: 100, y: 50, width: 400, z: 1 }, goals: { x: 600, y: 300, width: 320, z: 2 } };
    expect(sanitizePanelLayout({ ...DEFAULT_PANEL_LAYOUT, floating }, VIEW).floating).toEqual(floating);
  });

  it('clamps off-screen floating windows back onto the viewport so they cannot be lost', () => {
    const floating = { log: { x: 5000, y: -300, width: 5000, z: 3 }, goals: { x: -90, y: 9000, width: 10, z: 1 } };
    const out = sanitizePanelLayout({ ...DEFAULT_PANEL_LAYOUT, floating }, VIEW).floating;
    expect(out.log).toEqual({ x: 0, y: 0, width: VIEW.width, z: 2 });
    expect(out.goals).toEqual({ x: 0, y: VIEW.height - FLOAT_HANDLE_HEIGHT, width: MIN_FLOAT_WIDTH, z: 1 });
  });

  it('falls back to docked for invalid stored floating state', () => {
    for (const floating of [42, 'x', [], null]) expect(sanitizePanelLayout({ ...DEFAULT_PANEL_LAYOUT, floating }, VIEW).floating).toEqual({});
    const out = sanitizePanelLayout({
      ...DEFAULT_PANEL_LAYOUT,
      floating: { bogus: { x: 1, y: 1, width: 300, z: 1 }, log: { x: 'a', y: 1, width: 300, z: 1 }, goals: null, errors: { x: 1, y: 1, width: Infinity, z: 1 }, ruler: { x: 10, y: 10, width: 300, z: 9 } },
    }, VIEW);
    expect(out.floating).toEqual({ ruler: { x: 10, y: 10, width: 300, z: 1 } });
    expect(out.bottom).toContain('log');
  });
});

describe('movePanel', () => {
  const layout: PanelLayout = { top: ['qwenThinking'], side: ['workflow', 'ruler', 'goals', 'stats'], bottom: ['log', 'errors'], floating: {} };

  it('moves a panel before the drop target in the same area', () => {
    expect(movePanel(layout, 'workflow', 'side', 'stats').side).toEqual(['ruler', 'goals', 'workflow', 'stats']);
    expect(movePanel(layout, 'stats', 'side', 'workflow').side).toEqual(['stats', 'workflow', 'ruler', 'goals']);
  });

  it('appends when there is no drop target', () => {
    expect(movePanel(layout, 'ruler', 'side', null).side).toEqual(['workflow', 'goals', 'stats', 'ruler']);
  });

  it('moves a panel across areas so it appears exactly once', () => {
    const out = movePanel(layout, 'goals', 'bottom', 'errors');
    expect(out).toEqual({ top: ['qwenThinking'], side: ['workflow', 'ruler', 'stats'], bottom: ['log', 'goals', 'errors'], floating: {} });
    expect(movePanel(layout, 'qwenThinking', 'side', 'workflow')).toEqual({ ...layout, top: [], side: ['qwenThinking', ...layout.side] });
  });

  it('is a no-op when dropped on itself', () => {
    expect(movePanel(layout, 'ruler', 'side', 'ruler')).toBe(layout);
  });

  it('docks a floating panel dropped into an area', () => {
    const floated = floatPanel(layout, 'log', { x: 10, y: 10, width: 300 }, VIEW);
    const out = movePanel(floated, 'log', 'side', 'goals');
    expect(out.floating).toEqual({});
    expect(out.side).toEqual(['workflow', 'ruler', 'log', 'goals', 'stats']);
  });
});

describe('float / dock / raise', () => {
  const layout: PanelLayout = { top: ['qwenThinking'], side: ['workflow', 'ruler'], bottom: ['log'], floating: {} };

  it('undocks a panel into a floating window and docks it back to the same slot', () => {
    const floated = floatPanel(layout, 'ruler', { x: 200, y: 120, width: 360 }, VIEW);
    expect(floated.floating).toEqual({ ruler: { x: 200, y: 120, width: 360, z: 1 } });
    expect(floated.side).toEqual(['workflow', 'ruler']);
    expect(dockPanel(floated, 'ruler')).toEqual(layout);
    expect(dockPanel(layout, 'ruler')).toBe(layout);
  });

  it('stacks newly undocked windows in front and keeps z when a floating window moves', () => {
    const a = floatPanel(layout, 'ruler', { x: 0, y: 0, width: 300 }, VIEW);
    const b = floatPanel(a, 'log', { x: 50, y: 50, width: 300 }, VIEW);
    expect(b.floating.log!.z).toBe(2);
    const moved = floatPanel(b, 'ruler', { x: 400, y: 400, width: 500 }, VIEW);
    expect(moved.floating.ruler).toEqual({ x: 400, y: 400, width: 500, z: 1 });
  });

  it('clamps a placed window to the viewport', () => {
    const out = floatPanel(layout, 'log', { x: 2000, y: 2000, width: 100 }, VIEW);
    expect(out.floating.log).toEqual({ x: VIEW.width - MIN_FLOAT_WIDTH, y: VIEW.height - FLOAT_HANDLE_HEIGHT, width: MIN_FLOAT_WIDTH, z: 1 });
    expect(clampFloatRect({ x: 10, y: 10, width: 300 }, VIEW)).toEqual({ x: 10, y: 10, width: 300 });
  });

  it('brings a clicked window to the front; raising the front window or a docked panel is a no-op', () => {
    const two = floatPanel(floatPanel(layout, 'ruler', { x: 0, y: 0, width: 300 }, VIEW), 'log', { x: 0, y: 0, width: 300 }, VIEW);
    const raised = raisePanel(two, 'ruler');
    expect(raised.floating.ruler!.z).toBeGreaterThan(raised.floating.log!.z);
    expect(raisePanel(raised, 'ruler')).toBe(raised);
    expect(raisePanel(raised, 'workflow')).toBe(raised);
  });
});
