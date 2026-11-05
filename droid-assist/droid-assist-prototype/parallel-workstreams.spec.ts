import { describe, expect, it } from 'vitest';
import {
  bestVerifiedArtifacts,
  buildCrossReferencePacket,
  createParallelWorkstreamState,
  runParallelWorkstreams,
  type AttemptContext,
  type ParallelWorkstreamOptions,
} from './parallel-workstreams.js';

const streams: ParallelWorkstreamOptions['streams'] = [
  {
    id: 'stream-a',
    branch: 'agent/stream-a-primary',
    role: 'implementer',
    task: 'Implement the feature with a distinct strategy fallback',
    maxRetriesPerMethod: 1,
    methods: [
      { id: 'direct', label: 'Direct implementation', instruction: 'Implement directly from the existing design.' },
      { id: 'alternate', label: 'Alternative implementation', instruction: 'Use a materially different design and cross-check the failed approach.' },
    ],
  },
  {
    id: 'stream-b',
    branch: 'agent/stream-b-alternative',
    role: 'tester',
    task: 'Independently test the feature and try another test strategy if blocked',
    maxRetriesPerMethod: 1,
    methods: [
      { id: 'unit', label: 'Unit-test approach', instruction: 'Test the public contract with focused unit tests.' },
      { id: 'integration', label: 'Integration-test approach', instruction: 'Use an independent integration-oriented test strategy.' },
    ],
  },
];

describe('parallel workstreams', () => {
  it('requires two independent branches and unique method IDs', () => {
    expect(() => createParallelWorkstreamState({
      runId: 'run', task: 'task', baseCommit: 'abc',
      streams: [streams[0], { ...streams[1], branch: streams[0].branch }],
    })).toThrow(/different branches/);
    expect(() => createParallelWorkstreamState({
      runId: 'run', task: 'task', baseCommit: 'abc',
      streams: [streams[0], { ...streams[1], methods: [streams[1].methods[0], { ...streams[1].methods[1], id: 'unit' }] }],
    })).toThrow(/unique/);
  });

  it('runs both streams concurrently, retries each method, then tries an alternative for both', async () => {
    const calls: Array<{ stream: string; method: string; attempt: number; incoming: number }> = [];
    const state = await runParallelWorkstreams({
      runId: 'two-streams',
      task: 'Build and verify a resilient workflow handoff',
      baseCommit: 'base-sha',
      streams,
      now: (() => { let time = 1_000; return () => ++time; })(),
      execute: async (context: AttemptContext) => {
        calls.push({
          stream: context.stream.id,
          method: context.method.id,
          attempt: context.attempt.attemptNumber,
          incoming: context.incomingMessages.length,
        });
        if (context.method.id === 'direct' || context.method.id === 'unit') {
          return {
            passed: false,
            summary: 'Initial strategy failed; preserve this evidence and try again.',
            error: 'Representative failure',
            artifacts: [{
              kind: 'log' as const,
              title: 'Failed strategy evidence',
              content: 'Failure detail retained for comparison.',
            }],
            crossReferences: [{
              kind: 'method-suggestion' as const,
              content: `${context.stream.id} recommends checking the alternative strategy.`,
            }],
          };
        }
        return {
          passed: true,
          summary: 'Alternative strategy passed independent verification.',
          verification: { testPassed: true, evidence: 'Focused checks and regression assertions passed.' },
          artifacts: [{
            kind: 'patch' as const,
            title: `${context.stream.id} verified candidate`,
            content: 'candidate diff',
            testPassed: true,
            branch: context.stream.branch,
            commitSha: `${context.stream.id}-commit`,
          }],
          crossReferences: [{
            kind: 'verified-solution' as const,
            content: 'Candidate is ready for independent review; do not merge without comparing both streams.',
          }],
        };
      },
    });

    expect(state.status).toBe('completed');
    expect(state.streams['stream-a'].status).toBe('passed');
    expect(state.streams['stream-b'].status).toBe('passed');
    expect(state.streams['stream-a'].attempts.map((a) => a.methodId)).toEqual(['direct', 'direct', 'alternate']);
    expect(state.streams['stream-b'].attempts.map((a) => a.methodId)).toEqual(['unit', 'unit', 'integration']);
    expect(state.streams['stream-a'].attempts[0].status).toBe('failed');
    expect(state.streams['stream-a'].attempts[2].status).toBe('passed');
    expect(state.streams['stream-a'].attempts[2].alternativeMethod).toBe(true);
    expect(state.streams['stream-b'].attempts[2].alternativeMethod).toBe(true);
    expect(state.streams['stream-a'].workingArtifactIds).toHaveLength(1);
    expect(state.streams['stream-b'].workingArtifactIds).toHaveLength(1);
    expect(state.artifacts.some((a) => a.kind === 'log' && !a.verified)).toBe(true);
    expect(bestVerifiedArtifacts(state)).toHaveLength(2);
    expect(calls.some((call) => call.stream === 'stream-a' && call.method === 'alternate' && call.incoming > 0)).toBe(true);
    expect(calls.some((call) => call.stream === 'stream-b' && call.method === 'integration' && call.incoming > 0)).toBe(true);
    expect(state.messages.some((m) => m.from === 'stream-a' && m.to === 'stream-b' && m.kind === 'failure-analysis')).toBe(true);
    expect(state.messages.some((m) => m.from === 'stream-b' && m.to === 'stream-a' && m.kind === 'failure-analysis')).toBe(true);
  });

  it('does not replace a verified solution with a later unverified artifact', async () => {
    let run = 0;
    const state = await runParallelWorkstreams({
      runId: 'preserve-good',
      task: 'Keep a known-good result',
      baseCommit: 'base',
      streams: [
        { ...streams[0], maxRetriesPerMethod: 0, methods: [streams[0].methods[0], streams[0].methods[1]] },
        { ...streams[1], maxRetriesPerMethod: 0, methods: [streams[1].methods[0], streams[1].methods[1]] },
      ],
      execute: async (context) => {
        run++;
        if (context.method.id === 'direct' || context.method.id === 'unit') return {
          passed: true,
          summary: 'First attempt independently verified.',
          verification: { testPassed: true, evidence: 'Test suite passed.' },
          artifacts: [{ kind: 'patch' as const, title: 'Known good', content: 'good patch', testPassed: true }],
        };
        return {
          passed: false,
          summary: 'Alternative experiment failed; keep the verified candidate.',
          artifacts: [{ kind: 'patch' as const, title: 'Failed experiment', content: 'bad patch', testPassed: false }],
        };
      },
    });
    expect(run).toBe(2);
    expect(state.streams['stream-a'].workingArtifactIds).toHaveLength(1);
    expect(state.streams['stream-b'].workingArtifactIds).toHaveLength(1);
    expect(bestVerifiedArtifacts(state)).toHaveLength(2);
  });

  it('persists intermediate failures and exposes a reviewer packet', async () => {
    const snapshots: string[] = [];
    const state = await runParallelWorkstreams({
      runId: 'persist',
      task: 'Test persistence and reviewer context',
      baseCommit: 'base',
      streams: [
        { ...streams[0], maxRetriesPerMethod: 0, methods: [streams[0].methods[0]] },
        { ...streams[1], maxRetriesPerMethod: 0, methods: [streams[1].methods[0]] },
      ],
      persist: (snapshot) => { snapshots.push(snapshot.status + ':' + snapshot.artifacts.length); },
      execute: async () => ({ passed: false, summary: 'All methods failed.', error: 'test failure' }),
    });
    expect(snapshots.length).toBeGreaterThan(2);
    expect(state.status).toBe('failed');
    expect(buildCrossReferencePacket(state)).toContain('REVIEW RULE');
    expect(buildCrossReferencePacket(state)).toContain('failure-analysis');
  });

  it('cancels without claiming a passing result', async () => {
    const controller = new AbortController();
    const state = await runParallelWorkstreams({
      runId: 'cancel',
      task: 'Cancel the two streams',
      baseCommit: 'base',
      streams,
      signal: controller.signal,
      execute: async () => {
        controller.abort();
        return { passed: true, summary: 'Should not count as passed.' };
      },
    });
    expect(state.status).toBe('cancelled');
    expect(state.streams['stream-a'].status).toBe('cancelled');
    expect(state.streams['stream-b'].status).toBe('cancelled');
  });
});
