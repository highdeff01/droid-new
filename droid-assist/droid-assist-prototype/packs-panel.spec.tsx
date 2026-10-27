import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { WorkflowStep } from './types.js';
import type { WorkflowPack } from './packs.js';
import type { PacksEngine } from './use-packs.js';
import { PacksPanel } from './packs-panel.js';

const step = (id: string): WorkflowStep => ({ id, name: id, action: 'click', x: 0.2, y: 0.4, status: 'pending' });
const pack = (id: string, over: Partial<WorkflowPack> = {}): WorkflowPack => ({ id, name: id, kind: 'recorded', goal: '', goalSource: null, steps: [step(`${id}1`)], tests: [], savedAt: 0, ...over });

const packsEngine = (over: Partial<PacksEngine> = {}): PacksEngine => ({
  packs: [pack('A', { goal: 'Open files', goalSource: 'ai' }), pack('B')],
  recordingPackId: null,
  selection: { packIds: [], stepIds: [] },
  running: null,
  report: null,
  background: true,
  setBackground: vi.fn(),
  createPack: vi.fn(),
  deletePack: vi.fn(),
  setGoal: vi.fn(),
  toggleRecord: vi.fn(),
  capture: vi.fn(),
  selectPack: vi.fn(),
  selectStep: vi.fn(),
  clearSelection: vi.fn(),
  combine: vi.fn(),
  move: vi.fn(),
  runPack: vi.fn(),
  crossRun: vi.fn(),
  performSimilar: vi.fn(),
  testPacks: vi.fn(),
  ...over,
}) as PacksEngine;

const engine = (packs: PacksEngine) => ({ packs, replaying: false, recording: false, armed: false }) as unknown as AssistEngine;

afterEach(cleanup);

describe('PacksPanel', () => {
  it('shows a goal bar above each pack and sends edits, records, moves and selections to the engine', () => {
    const packs = packsEngine();
    render(<PacksPanel engine={engine(packs)} />);
    const a = screen.getByRole('article', { name: 'Pack A' });
    const goal = within(a).getByLabelText('Goal of A') as HTMLInputElement;
    expect(goal.value).toBe('Open files');
    expect(a.textContent).toContain('AI-generated — edit it');
    expect(a.firstElementChild?.contains(goal)).toBe(true);
    fireEvent.change(goal, { target: { value: 'Open the files app' } });
    expect(packs.setGoal).toHaveBeenCalledWith('A', 'Open the files app');
    fireEvent.click(within(a).getByText('● Record'));
    expect(packs.toggleRecord).toHaveBeenCalledWith('A');
    fireEvent.change(within(a).getByLabelText('Move A1 to'), { target: { value: 'B' } });
    expect(packs.move).toHaveBeenCalledWith('A1', 'B');
    fireEvent.click(within(a).getByLabelText('Select step A1'));
    expect(packs.selectStep).toHaveBeenCalledWith('A1');
    expect(a.textContent).toContain('1/5 moves');
  });

  it('creates a pack from the name and goal input', () => {
    const packs = packsEngine();
    render(<PacksPanel engine={engine(packs)} />);
    fireEvent.change(screen.getByLabelText('Pack name'), { target: { value: 'Mail' } });
    fireEvent.change(screen.getByLabelText('Pack goal input'), { target: { value: 'open the inbox' } });
    fireEvent.click(screen.getByText('+ New pack'));
    expect(packs.createPack).toHaveBeenCalledWith('Mail', 'open the inbox');
  });

  it('enables combine, cross-run and perform similar for a selection', () => {
    const packs = packsEngine({ selection: { packIds: ['A', 'B'], stepIds: [] } });
    render(<PacksPanel engine={engine(packs)} />);
    fireEvent.click(screen.getByText('Combine selected packs'));
    fireEvent.click(screen.getByText('▶ Cross-run selection'));
    fireEvent.click(screen.getByText('✨ Perform similar action'));
    expect(packs.combine).toHaveBeenCalled();
    expect(packs.crossRun).toHaveBeenCalled();
    expect(packs.performSimilar).toHaveBeenCalled();
  });

  it('shows an incomplete perform-similar report as a red alert naming the failing step', () => {
    const message = 'Incomplete at step 2/2 "Pick export" — click "Export" at (50.0%, 25.0%): Target "Export" not located';
    render(<PacksPanel engine={engine(packsEngine({ report: { complete: false, message, failing: null } }))} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(alert.className).toMatch(/incomplete/);
  });

  it('shows a complete report as a status and each pack its test log', () => {
    const tests = [{ id: 't', time: 0, status: 'fail' as const, message: 'Step 1 "B1": not found', dry: true }];
    render(<PacksPanel engine={engine(packsEngine({ report: { complete: true, message: 'Complete — 1 step(s) performed' }, packs: [pack('B', { tests })] }))} />);
    expect(screen.getByRole('status').textContent).toBe('Complete — 1 step(s) performed');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('list', { name: 'Tests of B' }).textContent).toContain('FAIL (dry run)');
  });
});
