import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAssist, type AssistEngine } from './use-assist.js';
import type { AgentReport } from './agent-cadence.js';
import type { LogEntry } from './types.js';
import { CurrentOperationPanel, PopupPanel } from './attention-panels.js';
import { Hud } from './hud.js';

const report = (agent: string, name: string, text: string, time = 1000): AgentReport => ({ agent, name, stage: 'drift', time, text });
const entry = (id: string, source: string, message: string): LogEntry => ({ id, time: 1000, source, message, tone: 'info' });

afterEach(cleanup);

const engine = (over: Record<string, unknown> = {}) => ({
  attention: { focus: 'Plan: open the reports folder', source: 'AI', since: 1000 },
  aiAnswer: 'The Save button is at the top right',
  pointOutAuto: false,
  agentReports: [report('popup', 'Popup watcher', 'Popup flagged: "Sale ad"'), report('drift', 'Drift monitor', 'Sync green — on target'), report('drift', 'Drift monitor', 'stale reading', 500)],
  log: [entry('1', 'Popup watcher', 'Ad popup flagged'), entry('2', 'Replay', 'Step 1 done')],
  ...over,
}) as unknown as AssistEngine;

describe('CurrentOperationPanel', () => {
  it('shows the AI focus, its latest answer and each agent newest report without popup reports', () => {
    render(<CurrentOperationPanel engine={engine()} />);
    const panel = screen.getByRole('region', { name: 'AI activity' });
    expect(screen.getByLabelText('AI attention').textContent).toContain('Plan: open the reports folder');
    expect(panel.textContent).toContain('The Save button is at the top right');
    expect(panel.textContent).toContain('Sync green — on target');
    expect(panel.textContent).not.toContain('stale reading');
    expect(panel.textContent).not.toContain('Sale ad');
  });
});

describe('PopupPanel', () => {
  it('holds the popup watcher report and popup log entries only', () => {
    render(<PopupPanel engine={engine()} />);
    const panel = screen.getByRole('region', { name: 'Popups' });
    expect(panel.textContent).toContain('Sale ad');
    expect(panel.textContent).toContain('Ad popup flagged');
    expect(panel.textContent).not.toContain('Step 1 done');
    expect(panel.textContent).not.toContain('Sync green');
  });
});

describe('Point out toggle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function Harness() {
    const live = useAssist();
    return <><Hud engine={live} /><CurrentOperationPanel engine={live} /></>;
  }

  it('turns into a Stop control once clicked and back into Point out when stopped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: { role: 'assistant', content: 'OK' } }), { status: 200 })));
    render(<Harness />);
    const start = await screen.findByRole('button', { name: '👁 Point out' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    const stop = await screen.findByRole('button', { name: '■ Stop point out' });
    expect(screen.getByRole('region', { name: 'AI activity' }).textContent).toContain('Point out runs every 5 s');
    fireEvent.click(stop);
    expect(await screen.findByRole('button', { name: '👁 Point out' })).toBeTruthy();
  });
});
