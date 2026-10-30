import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwarmView } from './swarm-view.js';
import type { AssistEngine } from './use-assist.js';
import type { SwarmRound } from './project-swarm.js';

afterEach(cleanup);

const ROUND: SwarmRound = {
  round: 1,
  tasks: [{ agentId: 'agent-1', area: { id: 'R1C1', x0: 0, y0: 0, x1: 1, y1: 1 } }],
  findings: [{ agentId: 'agent-1', source: 'assist', element: { name: 'Save button', x: 0.5, y: 0.5 } }],
  consensus: [
    { element: { name: 'Save button', x: 0.5, y: 0.5 }, agents: ['agent-1'], sources: ['assist', 'main'], spread: 0.001, status: 'consensus' },
    { element: { name: 'Menu', x: 0.1, y: 0.1 }, agents: ['agent-1'], sources: ['assist', 'main'], spread: 0.5, status: 'conflict' },
  ],
};

/** The minimal fake AssistEngine SwarmView reads: crew size and the v2 bridge's swarm round. */
function fakeEngine(round: SwarmRound | null): AssistEngine {
  return {
    settings: { crewSize: 10 },
    bridgeV2: {
      swarmRound: round,
      runSwarm: vi.fn(),
      dispatchSwarm: vi.fn(),
    },
  } as unknown as AssistEngine;
}

describe('SwarmView', () => {
  it('shows the empty state and running a round calls runSwarm', () => {
    const engine = fakeEngine(null);
    const { getByText } = render(<SwarmView engine={engine} />);
    expect(getByText('No swarm round yet')).toBeTruthy();
    fireEvent.click(getByText('Run swarm round'));
    expect(engine.bridgeV2.runSwarm).toHaveBeenCalledWith(true);
  });

  it('shows the consensus elements and clicking Dispatch calls dispatchSwarm with that element', () => {
    const engine = fakeEngine(ROUND);
    const { getByRole } = render(<SwarmView engine={engine} />);
    fireEvent.click(getByRole('button', { name: 'Dispatch Save button' }));
    expect(engine.bridgeV2.dispatchSwarm).toHaveBeenCalledWith({ name: 'Save button', x: 0.5, y: 0.5 });
  });

  it('lists the conflicting elements as sent to resolution', () => {
    const engine = fakeEngine(ROUND);
    const { getByLabelText } = render(<SwarmView engine={engine} />);
    expect(getByLabelText('Swarm conflicts').textContent).toContain('Menu');
  });
});
