import { describe, expect, it } from 'vitest';
import { connections, plotRoutes, profileFor, recordProfileResult, resolveHop, routeSteps, routeText, saveProfile, type RouteHop } from './route-plot.js';
import type { InventoryElement } from './screen-inventory.js';
import type { Box } from './assist-ai.js';

const el = (name: string, kind: InventoryElement['kind'], box: Box, state: InventoryElement['state'] = 'static'): InventoryElement => ({ id: name, name, known: true, kind, box, cell: 'A1', mapCells: '', state });

const MENU = el('File menu', 'button', { x: 0.0, y: 0.0, w: 0.08, h: 0.05 });
const PANEL = el('File panel', 'panel', { x: 0.0, y: 0.06, w: 0.3, h: 0.5 });
const EXPORT = el('Export settings', 'button', { x: 0.02, y: 0.3, w: 0.1, h: 0.05 });
const FAR = el('Help', 'button', { x: 0.9, y: 0.9, w: 0.05, h: 0.05 });
const INVENTORY = [MENU, PANEL, EXPORT, FAR];

describe('connections', () => {
  it('links an opener to the panel next to it, the panel to what it holds, and leaves distant elements unlinked', () => {
    const links = connections(INVENTORY);
    expect(links).toContainEqual({ from: 'File menu', to: 'File panel', kind: 'opens' });
    expect(links).toContainEqual({ from: 'File panel', to: 'Export settings', kind: 'contains' });
    expect(links.some((c) => c.from === 'Help' || c.to === 'Help')).toBe(false);
    expect(links.some((c) => c.from === 'Export settings' && c.to === 'File panel')).toBe(false);
  });
});

describe('plotRoutes', () => {
  it('ranks the opens → contains route and the direct route, shorter first when both reach the target', () => {
    const routes = plotRoutes('export settings', INVENTORY);
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.hops.map((h) => h.name))).toEqual([['Export settings'], ['File menu', 'File panel', 'Export settings']]);
    expect(routes[1].hops.map((h) => h.via)).toEqual(['start', 'opens', 'contains']);
    expect(routes[0].score).toBeGreaterThan(routes[1].score);
    expect(routes.every((r) => r.source === 'plotted')).toBe(true);
  });

  it('prefers settled elements over moving ones', () => {
    const a = el('Save draft', 'button', { x: 0.5, y: 0.5, w: 0.05, h: 0.05 }, 'in-motion');
    const b = el('Save draft #2', 'button', { x: 0.7, y: 0.7, w: 0.05, h: 0.05 });
    expect(plotRoutes('save draft', [a, b])[0].hops[0].name).toBe('Save draft #2');
  });

  it('puts a matching saved profile first and caps alternatives', () => {
    const hops: RouteHop[] = [{ name: 'File menu', x: 0.04, y: 0.02, via: 'start' }];
    const profiles = saveProfile([], 'Export settings', hops, 1);
    const routes = plotRoutes('export settings', INVENTORY, profiles);
    expect(routes[0]).toMatchObject({ source: 'profile', hops });
    expect(routes.length).toBeLessThanOrEqual(3);
  });

  it('returns no routes when nothing matches the goal', () => {
    expect(plotRoutes('print invoice', INVENTORY)).toEqual([]);
  });
});

describe('access-path profiles', () => {
  const hops: RouteHop[] = [{ name: 'File menu', x: 0.04, y: 0.02, via: 'start' }];
  it('replaces the same goal case-insensitively and keeps its record', () => {
    let p = saveProfile([], 'Open export', hops, 1);
    p = recordProfileResult(p, 'open EXPORT', true);
    p = saveProfile(p, 'OPEN export', [...hops, { name: 'File panel', x: 0.1, y: 0.3, via: 'opens' }], 2);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ uses: 1, successes: 1, savedAt: 2 });
    expect(p[0].hops).toHaveLength(2);
  });
  it('ignores blank goals and empty routes', () => {
    expect(saveProfile([], '  ', hops)).toEqual([]);
    expect(saveProfile([], 'goal', [])).toEqual([]);
  });
  it('matches by similarity', () => {
    const p = saveProfile([], 'open the export settings', hops);
    expect(profileFor(p, 'export settings')).not.toBeNull();
    expect(profileFor(p, 'print invoice')).toBeNull();
  });
});

describe('resolveHop', () => {
  it('uses the element current position, else falls back to fresh grounding', () => {
    const moved = el('File menu', 'button', { x: 0.2, y: 0.0, w: 0.08, h: 0.05 }, 'moved');
    const r = resolveHop({ name: 'File menu', x: 0.04, y: 0.02, via: 'start' }, [moved]);
    expect(r.kind).toBe('inventory');
    expect(r.kind === 'inventory' && r.x).toBeCloseTo(0.24);
    expect(r.kind === 'inventory' && r.y).toBeCloseTo(0.025);
    expect(resolveHop({ name: 'Gone', x: 0.5, y: 0.5, via: 'start' }, [moved])).toEqual({ kind: 'ground', target: 'Gone' });
  });
});

describe('routeSteps / routeText', () => {
  it('turns a route into targeted click steps', () => {
    const [route] = plotRoutes('export settings', INVENTORY).slice(1);
    const steps = routeSteps(route);
    expect(steps.map((s) => [s.action, s.target])).toEqual([['click', 'File menu'], ['click', 'File panel'], ['click', 'Export settings']]);
    expect(routeText(route)).toContain('opens "File panel"');
  });
});
