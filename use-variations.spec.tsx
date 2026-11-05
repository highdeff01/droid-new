import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVariations, type VariationDeps, type VariationsApi } from './use-variations.js';
import { VariationsPanel } from './variations-panel.js';
import type { AssistEngine } from './use-assist.js';
import { variationActor, type Variation } from './variations.js';
import type { StepStatus, WorkflowStep } from './types.js';
import { loadVariations } from './storage.js';

let stepSeq = 0;
/** A minimal workflow step fixture; each call gets a fresh id. */
function makeStep(name: string, status: StepStatus = 'pending'): WorkflowStep {
  stepSeq += 1;
  return { id: `step_${stepSeq}`, name, action: 'click', x: 0.1, y: 0.1, status };
}

let mainGoal = '';
let mainSteps: WorkflowStep[] = [];
let hold: string | null = null;
const runStep = vi.fn<VariationDeps['runStep']>();
const log = vi.fn();
const record = vi.fn();
const mergeRecords = vi.fn();
const forgetRecords = vi.fn();

const deps: VariationDeps = {
  main: () => ({ goal: mainGoal, steps: mainSteps }),
  setMain: (goal, steps) => {
    mainGoal = goal;
    mainSteps = steps;
  },
  blocked: () => hold,
  runStep,
  budgetLimit: () => 5,
  log,
  record,
  mergeRecords,
  forgetRecords,
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  mainGoal = '';
  mainSteps = [];
  hold = null;
  stepSeq = 0;
  runStep.mockReset();
  runStep.mockResolvedValue({ ok: true, message: 'done' });
  log.mockClear();
  record.mockClear();
  mergeRecords.mockClear();
  forgetRecords.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useVariations isolation', () => {
  it("supersede creates a running variation with a copy of steps and records a 'work' entry", () => {
    const { result } = renderHook(() => useVariations(deps));
    const steps = [makeStep('Click icon')];
    act(() => {
      result.current.supersede('Old goal', steps, 'New goal');
    });
    expect(result.current.variations).toHaveLength(1);
    const v = result.current.variations[0];
    expect(v.goal).toBe('Old goal');
    expect(v.status).toBe('running');
    expect(v.steps).toEqual(steps);
    expect(v.steps).not.toBe(steps);
    expect(record).toHaveBeenCalledWith(
      variationActor(v.id),
      'work',
      expect.any(String),
      { operation: 'Old goal', opId: variationActor(v.id) },
    );
  });

  it('supersede with empty goal or no steps creates nothing', () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      expect(result.current.supersede('   ', [makeStep('a')], 'next')).toBeNull();
      expect(result.current.supersede('goal', [], 'next')).toBeNull();
    });
    expect(result.current.variations).toHaveLength(0);
  });

  it('tick runs exactly one step of the variation updated longest ago, leaving the sibling untouched', async () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Goal A', [makeStep('Step A1'), makeStep('Step A2')], 'next');
    });
    vi.setSystemTime(2_000);
    act(() => {
      result.current.supersede('Goal B', [makeStep('Step B1')], 'next');
    });
    const idA = result.current.variations.find((v) => v.goal === 'Goal A')!.id;
    const idB = result.current.variations.find((v) => v.goal === 'Goal B')!.id;
    const beforeB = result.current.variations.find((v) => v.id === idB)!;

    runStep.mockResolvedValueOnce({ ok: true, message: 'clicked' });
    await act(() => result.current.tick());

    expect(runStep).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Step A1' }),
      variationActor(idA),
      expect.any(Object),
    );
    const afterA = result.current.variations.find((v) => v.id === idA)!;
    const afterB = result.current.variations.find((v) => v.id === idB)!;
    expect(afterA.steps[0].status).toBe('done');
    expect(afterB).toEqual(beforeB);
    expect(record).toHaveBeenCalledWith(
      variationActor(idA),
      'result',
      expect.stringContaining('clicked'),
      expect.any(Object),
      true,
    );
  });

  it('a failed step pauses only that variation', async () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Goal A', [makeStep('Step A1')], 'next');
    });
    vi.setSystemTime(2_000);
    act(() => {
      result.current.supersede('Goal B', [makeStep('Step B1')], 'next');
    });
    const idA = result.current.variations.find((v) => v.goal === 'Goal A')!.id;
    const idB = result.current.variations.find((v) => v.goal === 'Goal B')!.id;
    const beforeB = result.current.variations.find((v) => v.id === idB)!;

    runStep.mockResolvedValueOnce({ ok: false, message: 'blocked by dialog' });
    await act(() => result.current.tick());

    const afterA = result.current.variations.find((v) => v.id === idA)!;
    expect(afterA.status).toBe('paused');
    const afterB = result.current.variations.find((v) => v.id === idB)!;
    expect(afterB).toEqual(beforeB);
  });
});

describe('useVariations guardrails', () => {
  it('pauses background work while blocked, and resumes once the hold clears', async () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Goal A', [makeStep('Step A1')], 'next');
    });

    hold = 'Main executor needs the screen';
    await act(() => result.current.tick());
    expect(runStep).not.toHaveBeenCalled();
    expect(result.current.held).toBe('Main executor needs the screen');

    hold = null;
    runStep.mockResolvedValueOnce({ ok: true, message: 'done' });
    await act(() => result.current.tick());
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(result.current.held).toBeNull();
  });

  it('runStep receives the same budget object for one variation across ticks, and a different one per variation', async () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Goal A', [makeStep('A1'), makeStep('A2')], 'next');
    });
    vi.setSystemTime(2_000);
    act(() => {
      result.current.supersede('Goal B', [makeStep('B1'), makeStep('B2')], 'next');
    });
    const idA = result.current.variations.find((v) => v.goal === 'Goal A')!.id;
    const idB = result.current.variations.find((v) => v.goal === 'Goal B')!.id;

    vi.setSystemTime(3_000);
    await act(() => result.current.tick());
    vi.setSystemTime(4_000);
    await act(() => result.current.tick());
    vi.setSystemTime(5_000);
    await act(() => result.current.tick());
    vi.setSystemTime(6_000);
    await act(() => result.current.tick());

    const callsFor = (id: string) => runStep.mock.calls.filter((c) => c[1] === variationActor(id));
    const budgetsA = callsFor(idA).map((c) => c[2]);
    const budgetsB = callsFor(idB).map((c) => c[2]);
    expect(budgetsA.length).toBeGreaterThan(0);
    expect(budgetsB.length).toBeGreaterThan(0);
    expect(new Set(budgetsA).size).toBe(1);
    expect(new Set(budgetsB).size).toBe(1);
    expect(budgetsA[0]).not.toBe(budgetsB[0]);
  });

  it('resume(id) after a pause gives a fresh budget object', async () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Goal A', [makeStep('A1')], 'next');
    });
    const idA = result.current.variations[0].id;

    runStep.mockResolvedValueOnce({ ok: false, message: 'oops' });
    await act(() => result.current.tick());
    const firstBudget = runStep.mock.calls[0][2];
    expect(result.current.variations.find((v) => v.id === idA)!.status).toBe('paused');

    act(() => {
      result.current.resume(idA);
    });
    runStep.mockResolvedValueOnce({ ok: true, message: 'ok' });
    await act(() => result.current.tick());
    const secondBudget = runStep.mock.calls[1][2];
    expect(secondBudget).not.toBe(firstBudget);
  });
});

describe('useVariations merge', () => {
  it("merge appends the variation's new steps to main, re-attributes its records, and keeps it listed as merged", () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Old goal', [makeStep('Shared step'), makeStep('Variation step')], 'next');
    });
    const idA = result.current.variations[0].id;
    vi.setSystemTime(2_000);
    act(() => {
      result.current.supersede('Other goal', [makeStep('Other step')], 'next');
    });
    const idB = result.current.variations.find((v) => v.goal === 'Other goal')!.id;

    mainGoal = 'Main goal';
    mainSteps = [makeStep('Shared step')];

    act(() => {
      result.current.merge(idA);
    });

    expect(mainGoal).toBe('Main goal');
    expect(mainSteps.map((s) => s.name)).toEqual(['Shared step', 'Variation step']);
    expect(mergeRecords).toHaveBeenCalledWith(idA, { operation: 'Main goal', opId: null });
    expect(result.current.variations.find((v) => v.id === idA)!.status).toBe('merged');
    expect(result.current.variations.find((v) => v.id === idB)!.status).toBe('running');
  });

  it('merge is a no-op on an already merged variation and the merged one never runs again', async () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Old goal', [makeStep('Only step')], 'next');
    });
    const idA = result.current.variations[0].id;
    mainGoal = 'Main goal';
    mainSteps = [];
    act(() => result.current.merge(idA));
    const afterFirst = mainSteps;
    act(() => result.current.merge(idA));
    act(() => result.current.resume(idA));
    act(() => result.current.discard(idA));
    expect(mainSteps).toBe(afterFirst);
    expect(result.current.variations[0].status).toBe('merged');
    await act(() => result.current.tick());
    expect(runStep).not.toHaveBeenCalled();
    expect(loadVariations()[0]).toMatchObject({ id: idA, status: 'merged' });
  });

  it('startVariation moves the current main goal and steps into a new variation and clears main', () => {
    const { result } = renderHook(() => useVariations(deps));
    mainGoal = 'Draft goal';
    mainSteps = [makeStep('Draft step')];

    act(() => {
      result.current.startVariation();
    });

    expect(result.current.variations).toHaveLength(1);
    expect(result.current.variations[0].goal).toBe('Draft goal');
    expect(mainGoal).toBe('');
    expect(mainSteps).toEqual([]);
  });

  it('switchTo makes the variation the main project and backgrounds the previous main', () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Variation goal', [makeStep('V step')], 'next');
    });
    const idA = result.current.variations[0].id;
    mainGoal = 'Current main';
    mainSteps = [makeStep('Main step')];

    act(() => {
      result.current.switchTo(idA);
    });

    expect(mainGoal).toBe('Variation goal');
    expect(mainSteps.map((s) => s.name)).toEqual(['V step']);
    expect(result.current.variations).toHaveLength(1);
    expect(result.current.variations[0].goal).toBe('Current main');
  });
});

describe('useVariations discard', () => {
  it('discard keeps that variation listed as discarded, forgets its records, and leaves the sibling running in storage', () => {
    const { result } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Goal A', [makeStep('A1')], 'next');
    });
    const idA = result.current.variations[0].id;
    vi.setSystemTime(2_000);
    act(() => {
      result.current.supersede('Goal B', [makeStep('B1')], 'next');
    });
    const idB = result.current.variations.find((v) => v.goal === 'Goal B')!.id;

    act(() => {
      result.current.discard(idA);
    });

    expect(result.current.variations.find((v) => v.id === idA)!.status).toBe('discarded');
    expect(forgetRecords).toHaveBeenCalledWith(idA);
    const persisted = loadVariations();
    expect(persisted.find((v) => v.id === idA)!.status).toBe('discarded');
    expect(persisted.find((v) => v.id === idB)!.status).toBe('running');
  });

  it('a fresh renderHook loads persisted variations including step statuses', async () => {
    const { result, unmount } = renderHook(() => useVariations(deps));
    act(() => {
      result.current.supersede('Goal A', [makeStep('A1'), makeStep('A2')], 'next');
    });
    runStep.mockResolvedValueOnce({ ok: true, message: 'done' });
    await act(() => result.current.tick());
    unmount();

    const { result: fresh } = renderHook(() => useVariations(deps));
    expect(fresh.current.variations).toHaveLength(1);
    expect(fresh.current.variations[0].goal).toBe('Goal A');
    expect(fresh.current.variations[0].steps[0].status).toBe('done');
    expect(fresh.current.variations[0].steps[1].status).toBe('pending');
  });
});

describe('VariationsPanel', () => {
  const runningVariation: Variation = {
    id: 'var_running',
    goal: 'Automate reports',
    steps: [makeStep('Open app', 'done'), makeStep('Click export', 'pending')],
    status: 'running',
    reason: 'superseded by "new goal"',
    created: 1,
    updated: 1,
  };
  const pausedVariation: Variation = {
    id: 'var_paused',
    goal: 'Clean inbox',
    steps: [makeStep('Open mail', 'failed')],
    status: 'paused',
    reason: '"Open mail" failed: dialog blocked',
    created: 1,
    updated: 2,
  };

  let startVariation: ReturnType<typeof vi.fn>;
  let switchTo: ReturnType<typeof vi.fn>;
  let merge: ReturnType<typeof vi.fn>;
  let discard: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;
  let resume: ReturnType<typeof vi.fn>;
  let api: VariationsApi;

  beforeEach(() => {
    startVariation = vi.fn();
    switchTo = vi.fn();
    merge = vi.fn();
    discard = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    api = {
      variations: [runningVariation, pausedVariation],
      held: null,
      supersede: vi.fn(),
      startVariation,
      switchTo,
      merge,
      discard,
      pause,
      resume,
      tick: vi.fn(),
    } as unknown as VariationsApi;
  });

  function renderPanel() {
    render(<VariationsPanel engine={{ variations: api } as unknown as AssistEngine} />);
  }

  it("lists both variations' goals and statuses", () => {
    renderPanel();
    expect(screen.getByText('Automate reports')).toBeTruthy();
    expect(screen.getByText('Clean inbox')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('paused')).toBeTruthy();
  });

  it('shows Pause for the running variation and Resume for the paused one', () => {
    renderPanel();
    const running = within(screen.getByLabelText('Variation Automate reports'));
    const paused = within(screen.getByLabelText('Variation Clean inbox'));
    expect(running.getByText('Pause')).toBeTruthy();
    expect(paused.getByText('Resume')).toBeTruthy();
  });

  it('clicking Pause calls pause with the running variation\'s id', () => {
    renderPanel();
    const item = within(screen.getByLabelText('Variation Automate reports'));
    fireEvent.click(item.getByText('Pause'));
    expect(pause).toHaveBeenCalledWith('var_running');
  });

  it('clicking Resume calls resume with the paused variation\'s id', () => {
    renderPanel();
    const item = within(screen.getByLabelText('Variation Clean inbox'));
    fireEvent.click(item.getByText('Resume'));
    expect(resume).toHaveBeenCalledWith('var_paused');
  });

  it('clicking Switch focus calls switchTo with that variation\'s id', () => {
    renderPanel();
    const item = within(screen.getByLabelText('Variation Automate reports'));
    fireEvent.click(item.getByText('Switch focus'));
    expect(switchTo).toHaveBeenCalledWith('var_running');
  });

  it('clicking Merge calls merge with that variation\'s id', () => {
    renderPanel();
    const item = within(screen.getByLabelText('Variation Clean inbox'));
    fireEvent.click(item.getByText('Merge'));
    expect(merge).toHaveBeenCalledWith('var_paused');
  });

  it('clicking Discard calls discard with that variation\'s id', () => {
    renderPanel();
    const item = within(screen.getByLabelText('Variation Automate reports'));
    fireEvent.click(item.getByText('Discard'));
    expect(discard).toHaveBeenCalledWith('var_running');
  });

  it('lists merged and discarded variations with their status, counts them, and offers no controls on them', () => {
    const merged: Variation = { ...pausedVariation, id: 'var_merged', goal: 'Fill form', status: 'merged', reason: 'Merged into the main project — 1 new step(s)' };
    const discarded: Variation = { ...pausedVariation, id: 'var_discarded', goal: 'Rename files', status: 'discarded', reason: 'Discarded by user' };
    api = { ...api, variations: [runningVariation, pausedVariation, merged, discarded] } as VariationsApi;
    renderPanel();
    expect(screen.getByText(/1 running · 1 paused · 1 merged · 1 discarded · 4 total/)).toBeTruthy();
    for (const label of ['Variation Fill form', 'Variation Rename files']) {
      const row = within(screen.getByLabelText(label));
      expect(row.queryByText('Merge')).toBeNull();
      expect(row.queryByText('Discard')).toBeNull();
      expect(row.queryByText('Resume')).toBeNull();
    }
    expect(within(screen.getByLabelText('Variation Fill form')).getByText('merged')).toBeTruthy();
    expect(within(screen.getByLabelText('Variation Rename files')).getByText('discarded')).toBeTruthy();
  });

  it('reflects the live hook state: supersede, tick, merge and discard show up without a remount', async () => {
    function Live() {
      const variations = useVariations(deps);
      return <VariationsPanel engine={{ variations } as unknown as AssistEngine} />;
    }
    render(<Live />);
    expect(screen.getByText(/0 running/)).toBeTruthy();
    mainGoal = 'Old goal';
    mainSteps = [makeStep('First'), makeStep('Second')];
    act(() => {
      fireEvent.click(screen.getByText('New variation'));
    });
    const row = () => within(screen.getByLabelText('Variation Old goal'));
    expect(row().getByText('running')).toBeTruthy();
    expect(row().getByText(/0\/2 step\(s\)/)).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(row().getByText(/1\/2 step\(s\)/)).toBeTruthy();
    act(() => {
      fireEvent.click(row().getByText('Merge'));
    });
    expect(row().getByText('merged')).toBeTruthy();
    expect(screen.getByText(/0 running · 0 paused · 1 merged/)).toBeTruthy();
    expect(mainSteps.map((s) => s.name)).toEqual(['First', 'Second']);
  });

  it('clicking New variation calls startVariation', () => {
    renderPanel();
    fireEvent.click(screen.getByText('New variation'));
    expect(startVariation).toHaveBeenCalled();
  });
});
