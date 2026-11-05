import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import { makeSwarmTasks, retrieveWorkerNotes, runAgentSwarm, SWARM_MAX_AGENTS } from './agent-swarm.js';
import type { WorkerNote } from './agent-swarm.js';

const note = (over: Partial<WorkerNote> = {}): WorkerNote => ({
  id: 'n1', workerId: 'worker-1', role: 'researcher', taskId: 'database-index',
  tags: ['database', 'index'], content: 'Use a B-tree index for database lookup performance.',
  createdAt: 10, ...over
});

describe('agent swarm', () => {
  it('retrieves notes relevant to the task instead of returning unrelated notes', () => {
    const relevant = note();
    const unrelated = note({ id: 'n2', taskId: 'screen-layout', tags: ['css'], content: 'Adjust CSS grid spacing.' });
    expect(retrieveWorkerNotes('database index lookup', [unrelated, relevant])).toEqual([relevant]);
  });

  it('creates stable task ids and defaults blank roles to generalist', () => {
    expect(makeSwarmTasks([{ role: '', instruction: 'Inspect code' }])).toEqual([
      { id: 'task-1', role: 'generalist', instruction: 'Inspect code', tags: [] }
    ]);
  });

  it('runs tasks with bounded concurrency and passes conversation, prior answer and retrieved notes', async () => {
    let active = 0;
    let peak = 0;
    const ask = vi.fn(async (request: { prompt: string }) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return { content: 'worker report', thinking: null };
    }) as unknown as AskFn;
    const saved: WorkerNote[] = [];
    const tasks = makeSwarmTasks(Array.from({ length: 7 }, (_, i) => ({
      role: 'reviewer', instruction: 'Review database index task ' + i, tags: ['database']
    })));
    const result = await runAgentSwarm(ask, tasks, {
      concurrency: 2, userInput: 'Improve database index performance',
      conversationHistory: 'Earlier we selected SQLite.',
      previousResponse: 'The current implementation uses a database.',
      priorNotes: [note()], onNote: (n) => { saved.push(n); }
    });
    expect(result.completed).toBe(7);
    expect(result.failed).toBe(0);
    expect(result.notes).toHaveLength(7);
    expect(saved).toHaveLength(7);
    expect(peak).toBeLessThanOrEqual(2);
    expect((ask as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt).toContain('Earlier we selected SQLite.');
    expect((ask as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt).toContain('PREVIOUS ASSISTANT RESPONSE');
    expect((ask as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt).toContain('RETRIEVED NOTES FROM RELEVANT WORKERS');
  });

  it('rejects more than 1,000 logical agents', async () => {
    const tasks = Array.from({ length: SWARM_MAX_AGENTS + 1 }, (_, i) => ({ id: String(i), role: 'worker', instruction: 'task' }));
    await expect(runAgentSwarm(vi.fn() as unknown as AskFn, tasks, { userInput: 'test' })).rejects.toThrow('at most 1000');
  });
});
