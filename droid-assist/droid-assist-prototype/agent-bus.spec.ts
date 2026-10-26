import { describe, expect, it } from 'vitest';
import { BUS_AGENT_IDS, BUS_LIMIT, elementLine, forward, inbox, markHandled, predefine, recipientsOf } from './agent-bus.js';

const files = { name: 'Files icon', x: 0.1, y: 0.9 };

describe('agent bus', () => {
  it('fans a forward out to every other participant, one message per inbox', () => {
    for (const from of ['screen', 'coords', 'supervisor'] as const) {
      const { bus, queued } = forward([], from, files);
      expect(queued).toHaveLength(BUS_AGENT_IDS.length - 1);
      expect(inbox(bus, from)).toHaveLength(0);
      recipientsOf(from).forEach((id) => expect(inbox(bus, id)).toHaveLength(1));
      expect(inbox(bus, 'habits')[0]).toMatchObject({ from, element: files, status: 'queued' });
    }
  });

  it('queues only to the named recipients and never back to the sender', () => {
    const { bus } = forward([], 'popup', files, ['coords', 'habits', 'popup'], 42);
    expect(bus.map((m) => m.to)).toEqual(['coords', 'habits']);
    expect(bus.every((m) => m.time === 42)).toBe(true);
  });

  it('keeps the newest messages first, capped', () => {
    let bus = forward([], 'drift', { ...files, name: 'old' }).bus;
    for (let i = 0; i < 40; i++) bus = forward(bus, 'goal', { ...files, name: `n${i}` }).bus;
    expect(bus).toHaveLength(BUS_LIMIT);
    expect(bus[0].element.name).toBe('n39');
  });

  it('marks one message handled with its note', () => {
    const { bus, queued } = forward([], 'screen', files, ['coords', 'habits']);
    const next = markHandled(bus, queued[0].id, 'Predefined');
    expect(next[0]).toMatchObject({ status: 'handled', note: 'Predefined' });
    expect(next[1].status).toBe('queued');
  });

  it('predefines elements, replacing one with the same name', () => {
    const known = predefine(predefine([], files), { name: 'files  ICON', x: 0.2, y: 0.8 });
    expect(known).toEqual([{ name: 'files  ICON', x: 0.2, y: 0.8 }]);
    expect(elementLine(known[0])).toBe('[Known element] "files  ICON" at x=0.200, y=0.800');
  });
});
