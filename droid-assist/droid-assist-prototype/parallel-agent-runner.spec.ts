import { describe, expect, it } from 'vitest';
import type { AiReply, AskFn } from './ai.js';
import { parallelAgentRunText, runParallelAgentReview } from './parallel-agent-runner.js';

const reply = (content: string): AiReply => ({ content, thinking: null });

describe('parallel AI agent runner', () => {
  it('runs independent streams concurrently and cross-references both revisions', async () => {
    const calls: string[] = [];
    const ask: AskFn = async (request) => {
      calls.push(request.context?.[0] ?? 'unknown');
      return reply(`Response for ${request.context?.[0]}: ${request.prompt.slice(0, 90)}`);
    };
    const refs: string[] = [];
    const snapshots: string[] = [];
    const run = await runParallelAgentReview({
      ask,
      askA: async (request) => { calls.push('A:' + (request.context?.[0] ?? '')); return reply('Stream A isolated response'); },
      askB: async (request) => { calls.push('B:' + (request.context?.[0] ?? '')); return reply('Stream B isolated response'); },
      task: 'Implement reliable workflow transfer',
      baseCommit: 'base-sha',
      now: (() => { let n = 100; return () => ++n; })(),
      onCrossReference: (message) => { refs.push(`${message.from}->${message.to}`); },
      onState: (state) => { snapshots.push(state.status); },
    });
    expect(run.status).toBe('needs-verification');
    expect(run.streams['stream-a'].status).toBe('needs-test');
    expect(run.streams['stream-b'].status).toBe('needs-execution');
    expect(run.streams['stream-a'].attempts).toHaveLength(2);
    expect(run.streams['stream-b'].attempts).toHaveLength(2);
    expect(run.crossReferences).toHaveLength(4);
    expect(refs).toContain('stream-a->stream-b');
    expect(refs).toContain('stream-b->stream-a');
    expect(calls.filter((c) => c.includes('stream-a'))).toHaveLength(2);
    expect(calls.filter((c) => c.includes('stream-b'))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('A:'))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('B:'))).toHaveLength(2);
    expect(snapshots.length).toBeGreaterThan(3);
    expect(parallelAgentRunText(run)).toContain('not passing test results');
  });

  it('retries a failed model method and preserves the failed attempt', async () => {
    let streamACalls = 0;
    const ask: AskFn = async (request) => {
      const stream = request.context?.[0] ?? '';
      if (stream.includes('stream-a') && ++streamACalls === 1) throw new Error('temporary endpoint failure');
      return reply('Recovered response');
    };
    const run = await runParallelAgentReview({
      ask,
      task: 'Retry safely',
      baseCommit: 'base',
      maxRetries: 1,
    });
    const attempts = run.streams['stream-a'].attempts;
    expect(attempts[0].status).toBe('failed');
    expect(attempts[0].error).toContain('temporary endpoint failure');
    expect(attempts[1].status).toBe('completed');
    expect(run.status).toBe('needs-verification');
  });

  it('switches both streams to distinct alternative methods after retry exhaustion', async () => {
    const attempts: string[] = [];
    const makeAsk = (prefix: string): AskFn => {
      let initialCalls = 0;
      return async (request) => {
        const method = request.context?.find((line) => line.startsWith('METHOD:')) ?? '';
        attempts.push(prefix + method);
        if (method.includes('primary-implementation') || method.includes('independent-test-and-alternative')) {
          initialCalls++;
          if (initialCalls <= 2) throw new Error('primary method blocked');
        }
        return reply('Alternative method produced a usable proposal.');
      };
    };
    const run = await runParallelAgentReview({
      ask: async () => reply('fallback'),
      askA: makeAsk('A:'),
      askB: makeAsk('B:'),
      task: 'Force alternate method fallback',
      baseCommit: 'base',
      maxRetries: 1,
    });
    expect(attempts).toContain('A:METHOD: alternative-minimal-implementation');
    expect(attempts).toContain('B:METHOD: alternative-black-box-test-method');
    expect(run.streams['stream-a'].attempts.some((a) => a.method === 'alternative-minimal-implementation')).toBe(true);
    expect(run.streams['stream-b'].attempts.some((a) => a.method === 'alternative-black-box-test-method')).toBe(true);
    expect(run.status).toBe('needs-verification');
  });

  it('does not report completion as verified test success', async () => {
    const ask: AskFn = async () => reply('A complete proposal, but no tests were executed.');
    const run = await runParallelAgentReview({ ask, task: 'No false green', baseCommit: 'base' });
    expect(run.status).toBe('needs-verification');
    expect(run.streams['stream-a'].status).toBe('needs-test');
    expect(run.streams['stream-b'].status).toBe('needs-execution');
    expect(parallelAgentRunText(run)).toContain('not passing test results');
  });

  it('records cancellation without marking either stream verified', async () => {
    const controller = new AbortController();
    const ask: AskFn = async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    };
    const run = await runParallelAgentReview({
      ask, task: 'Cancel', baseCommit: 'base', signal: controller.signal,
    });
    expect(run.status).toBe('cancelled');
    expect(run.streams['stream-a'].status).toBe('cancelled');
    expect(run.streams['stream-b'].status).toBe('cancelled');
  });
});
