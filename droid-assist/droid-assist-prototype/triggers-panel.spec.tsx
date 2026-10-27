import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TriggersPanel } from './triggers-panel.js';
import type { AssistEngine } from './use-assist.js';
import type { Trigger } from './triggers.js';

afterEach(cleanup);

const trigger: Trigger = { id: 't1', kind: 'schedule', name: 'Nightly', enabled: true, cooldownSec: 5, maxRuns: 3, runs: 1, at: Date.UTC(2030, 0, 1), everySec: 60, target: { kind: 'card', cardId: 'c1' } };

function engineWith(triggers: Trigger[]) {
  return {
    triggers, armed: false,
    elementMap: [{ id: 'e1', name: 'Play button', box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, mappedAt: 1 }],
    cards: [{ id: 'c1', name: 'Calc flow', description: '', savedAt: 1, steps: [] }],
    addTrigger: vi.fn(), deleteTrigger: vi.fn(), invoke: vi.fn(async () => ({ ok: true, result: '' })),
  } as unknown as AssistEngine & { addTrigger: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn>; deleteTrigger: ReturnType<typeof vi.fn> };
    operations: [{ id: 'o1', name: 'Open youtube', goal: 'go to chrome and open youtube', steps: [], screenshots: [], source: 'ai', savedAt: 1, runs: 0, successes: 0 }],
    addTrigger: vi.fn(), toggleTrigger: vi.fn(), deleteTrigger: vi.fn(), fireTrigger: vi.fn(async () => {}),
  } as unknown as AssistEngine & { addTrigger: ReturnType<typeof vi.fn>; toggleTrigger: ReturnType<typeof vi.fn>; fireTrigger: ReturnType<typeof vi.fn>; deleteTrigger: ReturnType<typeof vi.fn> };
}

describe('TriggersPanel', () => {
  it('submits an element trigger for the chosen element, event, target, cooldown and run limit', () => {
    const engine = engineWith([]);
    render(<TriggersPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Trigger name'), { target: { value: 'Ad gone' } });
    fireEvent.change(screen.getByLabelText('Element event'), { target: { value: 'disappear' } });
    fireEvent.change(screen.getByLabelText('Trigger runs'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Cooldown seconds'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Run limit'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('Add trigger'));
    expect(engine.addTrigger).toHaveBeenCalledWith({ kind: 'element', name: 'Ad gone', target: { kind: 'card', cardId: 'c1' }, cooldownSec: 12, maxRuns: 4, elementId: 'e1', event: 'disappear' });
  });

  it('submits a scheduled trigger with its time and interval', () => {
    const engine = engineWith([]);
    render(<TriggersPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Trigger kind'), { target: { value: 'schedule' } });
    fireEvent.change(screen.getByLabelText('Trigger name'), { target: { value: 'Hourly' } });
    fireEvent.change(screen.getByLabelText('Run at'), { target: { value: '2030-01-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Repeat every seconds'), { target: { value: '3600' } });
    fireEvent.click(screen.getByText('Add trigger'));
    expect(engine.addTrigger).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule', name: 'Hourly', target: { kind: 'draft' }, everySec: 3600, at: new Date('2030-01-01T10:00').getTime() }));
  });

  it('submits a trigger that runs a saved operation', () => {
    const engine = engineWith([]);
    render(<TriggersPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Trigger kind'), { target: { value: 'schedule' } });
    fireEvent.change(screen.getByLabelText('Trigger name'), { target: { value: 'Morning youtube' } });
    fireEvent.change(screen.getByLabelText('Trigger runs'), { target: { value: 'op:o1' } });
    fireEvent.click(screen.getByText('Add trigger'));
    expect(engine.addTrigger).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule', target: { kind: 'operation', operationId: 'o1' } }));
  });

  it('lists triggers with counts and wires enable, Run now and delete', () => {
    const engine = engineWith([trigger]);
    render(<TriggersPanel engine={engine} />);
    expect(screen.getByText(/runs 1\/3/)).toBeTruthy();
    expect(screen.getByText(/Calc flow/, { selector: 'small' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Enable Nightly'));
    fireEvent.click(screen.getByText('Run now'));
    fireEvent.click(screen.getByLabelText('Delete Nightly'));
    expect(engine.invoke).toHaveBeenCalledWith('trigger.toggle', { id: 't1' });
    expect(engine.invoke).toHaveBeenCalledWith('trigger.fire', { id: 't1' });
    expect(engine.deleteTrigger).toHaveBeenCalledWith('t1');
  });
});
