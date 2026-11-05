import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BriefingPanel } from './panels.js';
import { chainReport, type ChainObjective, type ChainRun } from './chain.js';
import type { AssistEngine } from './use-assist.js';

afterEach(cleanup);

const objective = (name: string, status: ChainObjective['status'], reason?: string): ChainObjective => ({
  id: name, name, what: `click ${name}`, why: `${name} moves the goal on`, path: [], discover: null, status, reason,
  step: { id: name, name, action: 'click', x: 0.5, y: 0.5, target: name, status: 'pending' },
});

const panel = (chain: ChainRun | null) => render(<BriefingPanel engine={{ briefings: [], replicas: [], settings: { stages: { briefing: true } }, chain } as unknown as AssistEngine} />);

describe('BriefingPanel chain breakdown', () => {
  it('lists every objective with its what, why and status', () => {
    const objectives = [objective('Games', 'done'), objective('Custom Game', 'running')];
    panel({ goal: 'click Games, go to Custom Game', objectives, report: null });
    expect(screen.getByText('click Custom Game')).toBeTruthy();
    expect(screen.getByText('Games moves the goal on')).toBeTruthy();
    expect(screen.getByText('· running')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a red incomplete message naming the failed objective and why', () => {
    const objectives = [objective('Games', 'done'), objective('Talk', 'failed', 'target not found'), objective('Type hi', 'not run')];
    panel({ goal: 'g', objectives, report: chainReport(objectives) });
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-tone')).toBe('error');
    expect(alert.textContent).toMatch(/Chain INCOMPLETE — objective 2 "Talk" failed: target not found/);
  });

  it('shows nothing of a chain when none ran', () => {
    panel(null);
    expect(screen.queryByLabelText('Chain objectives')).toBeNull();
  });
});
