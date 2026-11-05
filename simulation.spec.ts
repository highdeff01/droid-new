import { describe, expect, it, vi } from 'vitest';
import { simulateFlow, simulationContext, simulationOutcomes, simulationText, type DryRunStep, type SimulationReport } from './simulation.js';
import type { WorkflowStep } from './types.js';

const step = (name: string, target?: string): WorkflowStep => ({ id: name, name, action: 'click', x: 0.5, y: 0.5, status: 'pending', ...(target ? { target } : {}) });

describe('simulateFlow', () => {
  it('calls the dry-run fn per step in order, stops at first failure', async () => {
    const steps = [step('A'), step('B'), step('C')];
    const calls: string[] = [];
    const dryRun: DryRunStep = vi.fn(async (s) => {
      calls.push(s.name);
      return { ok: s.name !== 'B', message: `${s.name} result` };
    });
    const r = await simulateFlow('App', steps, dryRun);
    expect(calls).toEqual(['A', 'B']);
    expect(r.steps).toHaveLength(2);
  });

  it('passed only when all ok', async () => {
    const steps = [step('A'), step('B')];
    const okAll: DryRunStep = vi.fn(async (s) => ({ ok: true, message: `${s.name} ok` }));
    const r = await simulateFlow('App', steps, okAll);
    expect(r.passed).toBe(true);

    const failing: DryRunStep = vi.fn(async (s) => ({ ok: s.name !== 'B', message: 'nope' }));
    const r2 = await simulateFlow('App', steps, failing);
    expect(r2.passed).toBe(false);
  });
});

describe('simulationOutcomes', () => {
  it("context 'simulation:<app>', success flags, avoid lesson only on failure", () => {
    const report: SimulationReport = {
      app: 'My App',
      steps: [
        { step: 'A', target: 'A', ok: true, message: 'fine' },
        { step: 'B', target: 'B', ok: false, message: 'broke' },
      ],
      passed: false,
    };
    const outcomes = simulationOutcomes(report);
    expect(outcomes[0]).toMatchObject({ context: 'simulation:My App', success: true, avoid: null });
    expect(outcomes[1]).toMatchObject({ context: 'simulation:My App', success: false, avoid: 'dry run failed: broke' });
    expect(simulationContext('My App')).toBe('simulation:My App');
  });
});

describe('simulationText', () => {
  it("PASSED/FAILED and 'no input sent'", () => {
    const passed: SimulationReport = { app: 'App', steps: [{ step: 'A', target: 'A', ok: true, message: 'ok' }], passed: true };
    const text = simulationText(passed);
    expect(text).toContain('PASSED');
    expect(text).toContain('no input sent');

    const failed: SimulationReport = { app: 'App', steps: [{ step: 'A', target: 'A', ok: false, message: 'broke' }], passed: false };
    expect(simulationText(failed)).toContain('FAILED');
  });
});
