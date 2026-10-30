import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FloatingLayer } from './floating-panels.js';
import type { FloatingPanels } from './panel-layout.js';

afterEach(cleanup);

/** jsdom's pointer events carry no coordinates, so a pointer step is a MouseEvent of the pointer type. */
const pointer = (target: EventTarget, type: string, clientX: number, clientY: number) =>
  fireEvent(target as Element, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }));

const floating: FloatingPanels = { log: { x: 100, y: 50, width: 320, z: 2 }, goals: { x: 10, y: 20, width: 300, z: 1 } };

function renderLayer() {
  const handlers = { onPlace: vi.fn(), onRaise: vi.fn(), onDock: vi.fn() };
  const view = render(<FloatingLayer floating={floating} renderPanel={(id) => <section aria-label={`panel ${id}`}>{id}</section>} {...handlers} />);
  const win = (id: string) => view.container.querySelector<HTMLElement>(`[data-floating-id="${id}"]`)!;
  return { ...handlers, win };
}

describe('FloatingLayer', () => {
  it('renders each floating panel at its stored position and stacking order', () => {
    const { win } = renderLayer();
    expect(win('log').style.left).toBe('100px');
    expect(win('log').style.top).toBe('50px');
    expect(win('log').style.width).toBe('320px');
    expect(win('log').style.zIndex).toBe('2');
    expect(screen.getByLabelText('panel goals')).toBeTruthy();
  });

  it('dragging the handle moves the window and commits the new position on release', () => {
    const { onPlace, onRaise, win } = renderLayer();
    pointer(screen.getByRole('button', { name: 'Drag log window' }), 'pointerdown', 10, 10);
    expect(onRaise).toHaveBeenCalledWith('log');
    pointer(window, 'pointermove', 40, 70);
    expect(win('log').style.left).toBe('130px');
    pointer(window, 'pointerup', 60, 90);
    expect(onPlace).toHaveBeenCalledWith('log', { x: 150, y: 130, width: 320 });
  });

  it('the resize grip changes only the width', () => {
    const { onPlace } = renderLayer();
    pointer(screen.getByRole('button', { name: 'Resize goals window' }), 'pointerdown', 0, 0);
    pointer(window, 'pointerup', 80, 500);
    expect(onPlace).toHaveBeenCalledWith('goals', { x: 10, y: 20, width: 380 });
  });

  it('clicking a window brings it to the front and the dock control docks it', () => {
    const { onRaise, onDock } = renderLayer();
    fireEvent.pointerDown(screen.getByLabelText('panel goals'));
    expect(onRaise).toHaveBeenCalledWith('goals');
    fireEvent.click(screen.getByRole('button', { name: 'Dock goals panel' }));
    expect(onDock).toHaveBeenCalledWith('goals');
  });
});
