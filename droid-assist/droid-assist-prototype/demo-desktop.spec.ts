import { describe, expect, it, vi } from 'vitest';
import { DEMO_ARCHIVE, DEMO_ICON, demoFileAt, drawDemoDesktop, findIcon, iconAt, initialDemoFile, initialDemoIcons, moveIcon } from './demo-desktop.js';

/** A mocked CanvasRenderingContext2D sufficient for drawDemoDesktop: vi.fn methods, gradient stub. */
function mockContext(): CanvasRenderingContext2D {
  return {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: '',
    font: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('demo desktop icons', () => {
  it('starts with Files, Notes, Game, Calc top to bottom, each a distinct color', () => {
    const icons = initialDemoIcons();
    expect(icons.map((i) => i.label)).toEqual(['Files', 'Notes', 'Game', 'Calc']);
    icons.forEach((icon, i) => {
      expect(icon.x).toBeCloseTo(0.055);
      expect(icon.y).toBeCloseTo(0.105 + i * 0.16);
    });
    expect(new Set(icons.map((i) => i.color)).size).toBe(4);
  });

  it('iconAt finds the icon whose box contains the point', () => {
    const icons = initialDemoIcons();
    expect(iconAt(icons, { x: 0.055, y: 0.105 })?.label).toBe('Files');
  });

  it('iconAt returns null when no icon box contains the point', () => {
    const icons = initialDemoIcons();
    expect(iconAt(icons, { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('findIcon matches a label mentioned case-insensitively inside a phrase', () => {
    const icons = initialDemoIcons();
    expect(findIcon(icons, 'files icon')?.label).toBe('Files');
    expect(findIcon(icons, 'the Game')?.label).toBe('Game');
  });

  it('findIcon returns null when no icon is named', () => {
    const icons = initialDemoIcons();
    expect(findIcon(icons, 'Report')).toBeNull();
  });

  it('moveIcon moves the grabbed icon to the drop point, leaving the others and the input array unchanged', () => {
    const icons = initialDemoIcons();
    const [files, notes, game, calc] = icons;
    const { icons: result, moved } = moveIcon(icons, { x: files.x, y: files.y }, { x: 0.055, y: 0.6 });
    expect(moved).toMatchObject({ label: 'Files', x: 0.055, y: 0.6 });
    expect(result[0]).toMatchObject({ label: 'Files', x: 0.055, y: 0.6 });
    expect(result[1]).toBe(notes);
    expect(result[2]).toBe(game);
    expect(result[3]).toBe(calc);
    expect(icons).toEqual(initialDemoIcons());
    expect(icons[0]).toBe(files);
  });

  it('moveIcon grabbing empty space moves nothing and returns the same icons', () => {
    const icons = initialDemoIcons();
    const { icons: result, moved } = moveIcon(icons, { x: 0.5, y: 0.5 }, { x: 0.3, y: 0.3 });
    expect(moved).toBeNull();
    expect(result).toBe(icons);
  });

  it('clamps a drop point below the taskbar up to the desktop', () => {
    const icons = initialDemoIcons();
    const { moved } = moveIcon(icons, { x: icons[0].x, y: icons[0].y }, { x: icons[0].x, y: 0.99 });
    expect(moved?.y).toBeCloseTo(0.93 - DEMO_ICON.hh);
  });

  it('clamps a drop point off the left edge onto the desktop', () => {
    const icons = initialDemoIcons();
    const { moved } = moveIcon(icons, { x: icons[0].x, y: icons[0].y }, { x: 0, y: icons[0].y });
    expect(moved?.x).toBeCloseTo(DEMO_ICON.hw);
  });

  it('shows the Report file at its home position', () => {
    expect(demoFileAt(initialDemoFile())).toEqual({ x: 0.9, y: 0.2 });
  });

  it('shows an archived file at the Archive folder center', () => {
    const archived = { ...initialDemoFile(), archived: true };
    expect(demoFileAt(archived)).toEqual({ x: DEMO_ARCHIVE.x + DEMO_ARCHIVE.w / 2, y: DEMO_ARCHIVE.y + DEMO_ARCHIVE.h / 2 });
  });

  it('draws icons from the layout, at their moved position', () => {
    const ctx = mockContext();
    const icons = initialDemoIcons();
    const { icons: moved } = moveIcon(icons, { x: icons[0].x, y: icons[0].y }, { x: 0.5, y: 0.5 });
    drawDemoDesktop(ctx, 960, 540, 0, false, initialDemoFile(), moved);
    const call = (ctx.fillRect as unknown as { mock: { calls: number[][] } }).mock.calls.find(
      (c) => Math.abs(c[0] - (0.5 - DEMO_ICON.hw) * 960) < 1 && Math.abs(c[1] - (0.5 - DEMO_ICON.hh) * 540) < 1,
    );
    expect(call).toBeDefined();
    expect(call![0]).toBeCloseTo((0.5 - DEMO_ICON.hw) * 960);
    expect(call![1]).toBeCloseTo((0.5 - DEMO_ICON.hh) * 540);
    expect(call![2]).toBeCloseTo(DEMO_ICON.hw * 2 * 960);
    expect(call![3]).toBeCloseTo(DEMO_ICON.hh * 2 * 540);
  });
});
