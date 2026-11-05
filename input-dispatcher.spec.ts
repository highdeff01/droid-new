import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputDispatcher } from './input-dispatcher.js';
import type { PlatformAdapter } from './platform-adapter.js';

describe('InputDispatcher', () => {
  let dispatcher: InputDispatcher;
  let mockAdapter: PlatformAdapter;

  beforeEach(() => {
    mockAdapter = {
      mouseClick: vi.fn(async () => {}),
      mouseDoubleClick: vi.fn(async () => {}),
      mouseDrag: vi.fn(async () => {}),
      mouseScroll: vi.fn(async () => {}),
      mouseMove: vi.fn(async () => {}),
      mouseRelease: vi.fn(async () => {}),
      keyPress: vi.fn(async () => {}),
      keyRelease: vi.fn(async () => {}),
      typeText: vi.fn(async () => {}),
      getMousePosition: vi.fn(async () => ({ x: 0, y: 0 })),
      getActiveWindow: vi.fn(async () => 'Unknown'),
      isAvailable: vi.fn(async () => true),
    };

    dispatcher = new InputDispatcher(mockAdapter);
  });

  describe('dry-run mode', () => {
    it('disables real dispatch when enabled', async () => {
      dispatcher.setDryRunMode(true);
      const step = {
        id: '1',
        name: 'Click',
        action: 'click' as const,
        x: 0.5,
        y: 0.5,
        status: 'pending' as const,
      };

      const result = await dispatcher.dispatchWorkflowStep(step);
      expect(result.executed).toBe(false);
      expect(result.ok).toBe(true);
      expect(mockAdapter.mouseClick).not.toHaveBeenCalled();
    });

    it('returns simulated results in dry-run', async () => {
      dispatcher.setDryRunMode(true);
      const step = {
        id: '1',
        name: 'Click',
        action: 'click' as const,
        x: 0.5,
        y: 0.5,
        status: 'pending' as const,
      };

      const result = await dispatcher.dispatchWorkflowStep(step);
      expect(result.ok).toBe(true);
      expect(result.executed).toBe(false);
      expect(result.message).toContain('dry-run');
    });
  });

  describe('pause and resume', () => {
    it('prevents dispatch when paused', async () => {
      dispatcher.pause('Testing pause');
      const step = {
        id: '1',
        name: 'Click',
        action: 'click' as const,
        x: 0.5,
        y: 0.5,
        status: 'pending' as const,
      };

      const result = await dispatcher.dispatchWorkflowStep(step);
      expect(result.ok).toBe(false);
      expect(result.halt).toBe(true);
      expect(result.message).toContain('paused');
      expect(mockAdapter.mouseClick).not.toHaveBeenCalled();
    });

    describe('dispatch gate', () => {
      const step = {
        id: 'gated',
        name: 'Blocked click',
        action: 'click' as const,
        x: 0.5,
        y: 0.5,
        status: 'pending' as const,
      };

      it('halts a step rejected by the configured safety gate', async () => {
        dispatcher.setDispatchGate(() => ({ kind: 'avoid', reason: 'Blocked by safety rule' }));
        const result = await dispatcher.dispatchWorkflowStep(step);

        expect(result).toMatchObject({ ok: false, executed: false, halt: true, message: 'Blocked by safety rule' });
        expect(mockAdapter.mouseClick).not.toHaveBeenCalled();
        expect(dispatcher.getStats().failed).toBe(1);
      });

      it('fails closed and reports gate errors', async () => {
        dispatcher.setDispatchGate(() => { throw new Error('gate unavailable'); });
        const result = await dispatcher.dispatchWorkflowStep(step);

        expect(result).toMatchObject({ ok: false, halt: true, message: 'Dispatch safety gate failed: gate unavailable' });
        expect(mockAdapter.mouseClick).not.toHaveBeenCalled();
      });
    });

    it('allows dispatch after resume', async () => {
      dispatcher.pause('Testing pause');
      dispatcher.resume();
      
      const state = dispatcher.getDispatchState();
      expect(state.mode).toBe('live');
    });
  });

  describe('dispatch state', () => {
    it('reports live state by default', () => {
      const state = dispatcher.getDispatchState();
      expect(state.mode).toBe('live');
      expect(state.real).toBe(true);
    });

    it('reports dry-run state when enabled', () => {
      dispatcher.setDryRunMode(true);
      const state = dispatcher.getDispatchState();
      expect(state.mode).toBe('dry-run');
      expect(state.real).toBe(false);
    });

    it('includes queue size in state', () => {
      const state = dispatcher.getDispatchState();
      expect(state).toHaveProperty('queueSize');
      expect(typeof state.queueSize).toBe('number');
    });
  });

  describe('statistics tracking', () => {
    it('tracks dispatch statistics', async () => {
      const step = {
        id: '1',
        name: 'Click',
        action: 'click' as const,
        x: 0.5,
        y: 0.5,
        status: 'pending' as const,
      };

      await dispatcher.dispatchWorkflowStep(step);
      const stats = dispatcher.getStats();
      
      expect(stats.total).toBe(1);
      expect(stats.succeeded).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.successRate).toBe(1);
    });

    it('tracks failed dispatches', async () => {
      mockAdapter.mouseClick = vi.fn(async () => {
        throw new Error('Mock error');
      });

      const step = {
        id: '1',
        name: 'Click',
        action: 'click' as const,
        x: 0.5,
        y: 0.5,
        status: 'pending' as const,
      };

      await dispatcher.dispatchWorkflowStep(step);
      const stats = dispatcher.getStats();
      
      expect(stats.total).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.successRate).toBe(0);
    });
  });

  describe('rate limiting', () => {
    it('sets rate limit', () => {
      expect(() => dispatcher.setRateLimit(100)).not.toThrow();
    });
  });

  describe('batch dispatch', () => {
    it('dispatches multiple steps', async () => {
      const steps = [
        { id: '1', name: 'Click 1', action: 'click' as const, x: 0.1, y: 0.1, status: 'pending' as const },
        { id: '2', name: 'Click 2', action: 'click' as const, x: 0.2, y: 0.2, status: 'pending' as const },
      ];

      const results = await dispatcher.dispatch(steps);
      expect(results).toHaveLength(2);
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(true);
    });
  });
});
