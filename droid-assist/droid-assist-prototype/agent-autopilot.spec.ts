import { describe, expect, it } from 'vitest';
import { automaticOpsPlan } from './agent-autopilot.js';

describe('automaticOpsPlan', () => {
  it('schedules half the eligible background roles and uses the goal as context', () => {
    const plan = automaticOpsPlan(['monitor', 'logging', 'testing', 'recheck', 'loopControl', 'screenshots'], {
      goal: 'Export the report',
      hasFrame: true,
      candidate: null,
      hasApplied: false,
    });
    expect(plan?.agents).toEqual(['monitor', 'logging', 'loopControl', 'screenshots']);
    expect(plan?.minimumCommands).toBe(2);
    expect(plan?.fallbackTasks.monitor).toContain('Export the report');
    expect(plan?.fallbackTasks.logging).toContain('prior operations');
  });

  it('adds target testing and applied-action rechecks when there is work for them', () => {
    const plan = automaticOpsPlan(['monitor', 'testing', 'recheck'], {
      goal: 'Save the document',
      hasFrame: true,
      candidate: 'Save button',
      hasApplied: true,
    });
    expect(plan?.agents).toEqual(['monitor', 'testing', 'recheck']);
    expect(plan?.minimumCommands).toBe(2);
    expect(plan?.fallbackTasks.testing).toContain('Save button');
    expect(plan?.fallbackTasks.recheck).toContain('Recheck');
  });

  it('does not schedule work without a current frame or enabled review agent', () => {
    expect(automaticOpsPlan(['monitor'], { goal: '', hasFrame: false, candidate: null, hasApplied: false })).toBeNull();
    expect(automaticOpsPlan(['apply'], { goal: '', hasFrame: true, candidate: null, hasApplied: false })).toBeNull();
  });
});
