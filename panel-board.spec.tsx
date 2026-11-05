import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { PanelBoard } from './panel-board.js';
import type { PanelId } from './panel-layout.js';

afterEach(cleanup);

/** A DataTransfer stand-in shared across one drag gesture (jsdom has none). */
function transfer() {
  const data = new Map<string, string>();
  return { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', dropEffect: 'none', effectAllowed: 'all' };
}

function drag(handle: Element, target: Element) {
  const dataTransfer = transfer();
  fireEvent.dragStart(handle, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

const ids: PanelId[] = ['workflow', 'ruler', 'goals'];
const renderBoard = (onMove = vi.fn()) => {
  const view = render(<PanelBoard area="side" ids={ids} className="side" renderPanel={(id) => <section aria-label={`panel ${id}`}>{id}</section>} onMove={onMove} />);
  return { ...view, onMove };
};

describe('PanelBoard', () => {
  it('renders every panel in order, each with a drag handle', () => {
    const { container } = renderBoard();
    expect([...container.querySelectorAll('[data-panel-id]')].map((el) => el.getAttribute('data-panel-id'))).toEqual(ids);
    expect(screen.getAllByRole('button', { name: /^Drag to move .* panel$/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Drag to move ruler panel' }).getAttribute('draggable')).toBe('true');
  });

  it('dropping a panel on another reports a move before that panel', () => {
    const { onMove } = renderBoard();
    drag(screen.getByRole('button', { name: 'Drag to move workflow panel' }), screen.getByLabelText('panel goals'));
    expect(onMove).toHaveBeenCalledWith('workflow', 'side', 'goals');
  });

  it('dropping on the empty area reports a move to the end', () => {
    const { container, onMove } = renderBoard();
    drag(screen.getByRole('button', { name: 'Drag to move workflow panel' }), container.querySelector('[data-panel-area="side"]')!);
    expect(onMove).toHaveBeenCalledWith('workflow', 'side', null);
  });

  it('moves panels with accessible controls for touch and keyboard users', () => {
    const { onMove } = renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Move ruler earlier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move ruler later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move ruler to bottom area' }));
    expect(onMove.mock.calls).toEqual([
      ['ruler', 'side', 'workflow'],
      ['ruler', 'side', null],
      ['ruler', 'bottom', null],
    ]);
  });

  it('disables reordering controls at the edges', () => {
    renderBoard();
    expect(screen.getByRole('button', { name: 'Move workflow earlier' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Move goals later' }).hasAttribute('disabled')).toBe(true);
  });

  it('ignores drops that carry no panel id and accepts drag-over', () => {
    const { onMove } = renderBoard();
    const target = screen.getByLabelText('panel ruler');
    const over = createEvent.dragOver(target, { dataTransfer: transfer() });
    fireEvent(target, over);
    expect(over.defaultPrevented).toBe(true);
    fireEvent.drop(target, { dataTransfer: transfer() });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('contains a crash to the one panel that threw, showing an inline error card', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = (): never => { throw new Error('boom'); };
    render(<PanelBoard area="side" ids={ids} className="side" renderPanel={(id) => (id === 'ruler' ? <Boom /> : <section aria-label={`panel ${id}`}>{id}</section>)} onMove={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('Panel crashed: boom — reload to retry');
    expect(screen.getByLabelText('panel workflow')).toBeTruthy();
    expect(screen.getByLabelText('panel goals')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Drag to move ruler panel' })).toBeTruthy();
    vi.restoreAllMocks();
  });
});
