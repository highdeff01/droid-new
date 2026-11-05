import { describe, expect, it } from 'vitest';
import { DEFAULT_PANEL_LAYOUT, movePanel, sanitizePanelLayout, type PanelLayout } from './panel-layout.js';

const all = (l: PanelLayout) => [...l.side, ...l.bottom];

describe('sanitizePanelLayout', () => {
  it('falls back to the default layout for non-objects', () => {
    for (const raw of [undefined, null, 42, 'side', [], true]) expect(sanitizePanelLayout(raw)).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it('keeps a valid stored order, including panels moved across areas', () => {
    const stored = { side: ['log', ...DEFAULT_PANEL_LAYOUT.side].reverse(), bottom: DEFAULT_PANEL_LAYOUT.bottom.filter((id) => id !== 'log') };
    expect(sanitizePanelLayout(stored)).toEqual(stored);
  });

  it('drops unknown and repeated ids and appends missing panels to their default area in default order', () => {
    const out = sanitizePanelLayout({ side: ['goals', 'nope', 7, 'goals', 'log'], bottom: 'x' });
    expect(out.side.slice(0, 2)).toEqual(['goals', 'log']);
    expect(out.side.slice(2)).toEqual(DEFAULT_PANEL_LAYOUT.side.filter((id) => id !== 'goals'));
    expect(out.bottom).toEqual(DEFAULT_PANEL_LAYOUT.bottom.filter((id) => id !== 'log'));
    expect(new Set(all(out)).size).toBe(all(DEFAULT_PANEL_LAYOUT).length);
    expect(all(out)).toHaveLength(all(DEFAULT_PANEL_LAYOUT).length);
  });
});

describe('movePanel', () => {
  const layout: PanelLayout = { side: ['workflow', 'ruler', 'goals', 'stats'], bottom: ['log', 'errors'] };

  it('moves a panel before the drop target in the same area', () => {
    expect(movePanel(layout, 'workflow', 'side', 'stats').side).toEqual(['ruler', 'goals', 'workflow', 'stats']);
    expect(movePanel(layout, 'stats', 'side', 'workflow').side).toEqual(['stats', 'workflow', 'ruler', 'goals']);
  });

  it('appends when there is no drop target', () => {
    expect(movePanel(layout, 'ruler', 'side', null).side).toEqual(['workflow', 'goals', 'stats', 'ruler']);
  });

  it('moves a panel across areas so it appears exactly once', () => {
    const out = movePanel(layout, 'goals', 'bottom', 'errors');
    expect(out).toEqual({ side: ['workflow', 'ruler', 'stats'], bottom: ['log', 'goals', 'errors'] });
  });

  it('is a no-op when dropped on itself', () => {
    expect(movePanel(layout, 'ruler', 'side', 'ruler')).toBe(layout);
  });
});
