import { describe, expect, it } from 'vitest';
import { coordinationRows, coordinationTotals, FLOW_LIMIT, pushFlow, type RequestFlow } from './coordination.js';
import { startStep, type StepAgreement } from './takeover.js';
import type { WorkflowStep } from './types.js';

describe('coordination', () => {
  const steps = [
    { id: 's1', name: 'Click OK', action: 'click', x: 0.5, y: 0.5, status: 'done' } as WorkflowStep,
    { id: 's2', name: 'Type name', action: 'click', x: 0.2, y: 0.2, status: 'running' } as WorkflowStep,
    { id: 's3', name: 'Wait', action: 'click', x: 0.1, y: 0.1, status: 'pending' } as WorkflowStep,
  ];
  const agreements: StepAgreement[] = [{ ...startStep(0, 'a', 0), verified: true, local: true, remote: true }];

  describe('coordinationRows', () => {
    const rows = coordinationRows(steps, agreements);

    it('a done step with full agreement is dispatched and complete', () => {
      expect(rows[0]).toMatchObject({ dispatched: true, state: 'complete' });
    });

    it('a running step with no agreement is dispatched but unverified', () => {
      expect(rows[1]).toMatchObject({ dispatched: true, state: 'unverified' });
    });

    it('a pending step is not dispatched', () => {
      expect(rows[2]).toMatchObject({ dispatched: false });
    });

    it('a step owned by main shows owner main', () => {
      const mainAgreement: StepAgreement = { ...startStep(1, 'b', 0, 'main'), verified: true, local: true, remote: true };
      const mainRows = coordinationRows(steps, [mainAgreement]);
      expect(mainRows[1].owner).toBe('main');
    });
  });

  describe('coordinationTotals', () => {
    it('counts planned, dispatched, verified and complete', () => {
      const rows = coordinationRows(steps, agreements);
      expect(coordinationTotals(rows)).toEqual({ planned: 3, dispatched: 2, verified: 1, complete: 1 });
    });
  });

  describe('pushFlow', () => {
    it('prepends a new flow', () => {
      const flow: RequestFlow = { time: 1, direction: 'to-main', text: 'go' };
      const list = pushFlow([], flow);
      expect(list).toEqual([flow]);
    });

    it('caps at FLOW_LIMIT', () => {
      let list: RequestFlow[] = [];
      for (let i = 0; i < FLOW_LIMIT + 10; i++) list = pushFlow(list, { time: i, direction: 'to-main', text: `t${i}` });
      expect(list).toHaveLength(FLOW_LIMIT);
      expect(list[0].text).toBe(`t${FLOW_LIMIT + 9}`);
    });
  });
});
