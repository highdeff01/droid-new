import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistSettings, LearnedPattern, LogEntry, WorkflowStep } from './types.js';
import { useApprovals } from './use-approvals.js';
import { DEFAULT_SETTINGS } from './use-assist.js';
import { OPERATION_CLASSES } from './approvals.js';
import type { ApprovalItem, CheckContext } from './approvals.js';

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 's1',
  name: '',
  action: 'click',
  x: 0.5,
  y: 0.5,
  status: 'pending',
  ...overrides,
});

function setup(settings: AssistSettings, patterns: LearnedPattern[] = []) {
  const log: LogEntry[] = [];
  const addLog = vi.fn((source: string, message: string, tone: LogEntry['tone'] = 'info') => {
    log.unshift({ id: String(log.length), time: Date.now(), source, message, tone });
  });
  const hook = renderHook(() => useApprovals(settings, () => patterns, addLog));
  return { ...hook, log, addLog };
}

beforeEach(() => {
  localStorage.clear();
});

describe('useApprovals', () => {
  describe('gate', () => {
    it('returns null for an input-class click step', () => {
      const { result } = setup(DEFAULT_SETTINGS);
      act(() => {
        const r = result.current.gate(step({ name: 'click the Play button' }), 'Replay', { goal: 'goal', planned: true });
        expect(r).toBeNull();
      });
    });

    it('queues an admin-class step for approval and queues it only once across two gates', () => {
      const { result } = setup(DEFAULT_SETTINGS);
      const s = step({ target: 'PowerShell' });
      act(() => {
        const r1 = result.current.gate(s, 'Replay', { goal: 'goal', planned: true });
        expect(r1).toContain('queued for approval');
        const r2 = result.current.gate(s, 'Replay', { goal: 'goal', planned: true });
        expect(r2).toContain('queued for approval');
      });
      const operations = result.current.items.filter((i) => i.kind === 'operation');
      expect(operations).toHaveLength(1);
      expect(operations[0].step?.id).toBe(s.id);
    });

    it('lets a released step through exactly once', () => {
      const { result } = setup(DEFAULT_SETTINGS);
      const s = step({ target: 'PowerShell' });
      act(() => {
        result.current.release(s.id);
      });
      act(() => {
        expect(result.current.gate(s, 'Replay', { goal: 'goal', planned: true })).toBeNull();
      });
      act(() => {
        expect(result.current.gate(s, 'Replay', { goal: 'goal', planned: true })).toContain('queued for approval');
      });
    });

    it('refuses a step outside the allowed classes with an Operation conditions reason and queues nothing', () => {
      const settings = { ...DEFAULT_SETTINGS, operationPolicy: { hours: null, allowedClasses: [], scope: '' } };
      const { result } = setup(settings);
      act(() => {
        const r = result.current.gate(step({ name: 'click the Play button' }), 'Replay', { goal: 'goal', planned: true });
        expect(r).toContain('Operation conditions');
      });
      expect(result.current.items).toHaveLength(0);
    });

    it('refuses a step outside the allowed hours with an Operation conditions reason and queues nothing', () => {
      const realDate = Date;
      const fixed = new realDate(2024, 0, 1, 20);
      vi.setSystemTime(fixed);
      const settings = { ...DEFAULT_SETTINGS, operationPolicy: { hours: { start: 9, end: 17 }, allowedClasses: [...OPERATION_CLASSES], scope: '' } };
      const { result } = setup(settings);
      act(() => {
        const r = result.current.gate(step({ name: 'click the Play button' }), 'Replay', { goal: 'goal', planned: true });
        expect(r).toContain('Operation conditions');
      });
      expect(result.current.items).toHaveLength(0);
      vi.useRealTimers();
    });
  });

  describe('route', () => {
    it('auto-acts an in-scope point when Auto act is on', () => {
      const settings = { ...DEFAULT_SETTINGS, autoAct: true, operationPolicy: { hours: null, allowedClasses: [...OPERATION_CLASSES], scope: 'play the music video' } };
      const { result } = setup(settings);
      act(() => {
        expect(result.current.route({ text: 'Play the video', requestedBy: 'Watcher' }, 'play the music video')).toBe('auto');
      });
    });

    it('queues an out-of-scope point for approval with its proposalId', () => {
      const settings = { ...DEFAULT_SETTINGS, autoAct: true, operationPolicy: { hours: null, allowedClasses: [...OPERATION_CLASSES], scope: 'play the music video' } };
      const { result } = setup(settings);
      act(() => {
        expect(result.current.route({ text: 'Close the newsletter popup', requestedBy: 'Watcher', proposalId: 'p1' }, 'play the music video')).toBe('approval');
      });
      const points = result.current.items.filter((i) => i.kind === 'point');
      expect(points).toHaveLength(1);
      expect(points[0].proposalId).toBe('p1');
    });

    it('logs a blocked point', () => {
      const settings = { ...DEFAULT_SETTINGS, operationPolicy: { hours: null, allowedClasses: [], scope: '' } };
      const { result, addLog } = setup(settings);
      act(() => {
        expect(result.current.route({ text: 'Play the video', requestedBy: 'Watcher' }, 'goal')).toBe('blocked');
      });
      expect(addLog).toHaveBeenCalledWith('Approvals', expect.stringContaining('Not acted on'), 'warn');
    });
  });

  describe('decide', () => {
    it('resolves a pending item and returns it', () => {
      const { result } = setup(DEFAULT_SETTINGS);
      act(() => {
        result.current.gate(step({ target: 'PowerShell' }), 'Replay', { goal: 'goal', planned: true });
      });
      const id = result.current.items[0].id;
      let decided: ApprovalItem | null | undefined;
      act(() => {
        decided = result.current.decide(id, 'approved');
      });
      expect(decided?.status).toBe('approved');
    });

    it('returns null for an unknown id', () => {
      const { result } = setup(DEFAULT_SETTINGS);
      act(() => {
        expect(result.current.decide('nope', 'approved')).toBeNull();
      });
    });

    it('returns null for an already-decided item', () => {
      const { result } = setup(DEFAULT_SETTINGS);
      act(() => {
        result.current.gate(step({ target: 'PowerShell' }), 'Replay', { goal: 'goal', planned: true });
      });
      const id = result.current.items[0].id;
      act(() => {
        result.current.decide(id, 'approved');
      });
      act(() => {
        expect(result.current.decide(id, 'approved')).toBeNull();
      });
    });
  });

  describe('check', () => {
    it('flags stale items and logs the count', () => {
      const { result, addLog } = setup(DEFAULT_SETTINGS);
      act(() => {
        result.current.gate(step({ target: 'PowerShell' }), 'Replay', { goal: 'original goal', planned: true });
      });
      const ctx: CheckContext = { now: Date.now(), goal: 'a different goal', steps: [], history: [], proposals: [] };
      let flagged: ApprovalItem[] = [];
      act(() => {
        flagged = result.current.check(ctx);
      });
      expect(flagged).toHaveLength(1);
      expect(flagged[0].stale).toContain('the goal changed to "a different goal"');
      expect(addLog).toHaveBeenCalledWith('Approvals', expect.stringContaining('Run-check'), expect.any(String));
    });
  });

  it('persists items to localStorage and reloads them in a new render', () => {
    const { result } = setup(DEFAULT_SETTINGS);
    act(() => {
      result.current.gate(step({ target: 'PowerShell' }), 'Replay', { goal: 'goal', planned: true });
    });
    expect(localStorage.getItem('droid-assist.approvals')).toBeTruthy();
    const { result: reloaded } = setup(DEFAULT_SETTINGS);
    expect(reloaded.current.items).toHaveLength(1);
  });
});
