import type { AskFn } from './ai.js';

export type AgentStreamId = 'stream-a' | 'stream-b';
export type AgentAttemptStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export interface AgentAttemptRecord {
  id: string;
  stream: AgentStreamId;
  method: string;
  attempt: number;
  status: AgentAttemptStatus;
  startedAt: number;
  finishedAt?: number;
  prompt: string;
  output: string;
  error?: string;
}
export interface AgentStreamRecord {
  id: AgentStreamId;
  branch: string;
  role: 'implementer' | 'independent-tester';
  status: 'idle' | 'working' | 'needs-test' | 'needs-execution' | 'failed' | 'cancelled';
  attempts: AgentAttemptRecord[];
  currentMethod: number;
  summary: string;
}
export interface AgentCrossReference {
  id: string;
  from: AgentStreamId;
  to: AgentStreamId;
  createdAt: number;
  content: string;
}
export interface ParallelAgentRun {
  id: string;
  task: string;
  baseCommit: string;
  createdAt: number;
  updatedAt: number;
  status: 'running' | 'needs-verification' | 'failed' | 'cancelled';
  streams: Record<AgentStreamId, AgentStreamRecord>;
  crossReferences: AgentCrossReference[];
}
export interface ParallelAgentRunnerOptions {
  ask: AskFn;
  task: string;
  baseCommit: string;
  signal?: AbortSignal;
  now?: () => number;
  onState?: (state: ParallelAgentRun) => void;
  persist?: (state: ParallelAgentRun) => void | Promise<void>;
  onCrossReference?: (message: AgentCrossReference) => void | Promise<void>;
  maxRetries?: number;
}

/**
 * Two independent AI work streams. Stream A proposes an implementation; stream B
 * independently builds tests and an alternative. They then exchange findings and
 * revise once using the other stream's output. This produces candidates, NOT verified
 * code: actual branch writes and executable tests must be performed by the host agent.
 */
export async function runParallelAgentReview(options: ParallelAgentRunnerOptions): Promise<ParallelAgentRun> {
  const now = options.now ?? Date.now;
  const maxRetries = Math.max(0, Math.min(3, Math.floor(options.maxRetries ?? 1)));
  const run: ParallelAgentRun = {
    id: `parallel-${now().toString(36)}`,
    task: options.task.slice(0, 8_000),
    baseCommit: options.baseCommit.slice(0, 100),
    createdAt: now(),
    updatedAt: now(),
    status: 'running',
    streams: {
      'stream-a': { id: 'stream-a', branch: 'agent/stream-a-primary', role: 'implementer', status: 'working', attempts: [], currentMethod: 0, summary: '' },
      'stream-b': { id: 'stream-b', branch: 'agent/stream-b-alternative', role: 'independent-tester', status: 'working', attempts: [], currentMethod: 0, summary: '' },
    },
    crossReferences: [],
  };
  let sequence = 0;
  const publish = async () => {
    run.updatedAt = now();
    options.onState?.(structuredClone(run));
    await options.persist?.(structuredClone(run));
  };
  const stopped = () => options.signal?.aborted === true;
  const askWithRetry = async (stream: AgentStreamRecord, method: string, prompt: string): Promise<string> => {
    let lastError = '';
    for (let retry = 0; retry <= maxRetries; retry++) {
      if (stopped()) throw new DOMException('Parallel agent run cancelled', 'AbortError');
      const attempt: AgentAttemptRecord = {
        id: `attempt-${(++sequence).toString(36)}`,
        stream: stream.id,
        method,
        attempt: retry + 1,
        status: 'running',
        startedAt: now(),
        prompt: prompt.slice(0, 16_000),
        output: '',
      };
      stream.attempts.push(attempt);
      await publish();
      try {
        const reply = await options.ask({
          system: stream.id === 'stream-a'
            ? 'You are Stream A, an independent senior implementation engineer. Produce a concrete implementation proposal with file paths, interfaces, edge cases, and patch-ready code where possible. Never claim code was committed or tests were run unless the tools actually did so.'
            : 'You are Stream B, an independent test engineer and alternative designer. Start from the stated base commit, challenge the proposed design, create executable test plans and edge cases, and propose a materially different implementation when useful. Never claim tests were run unless they actually were.',
          prompt,
          context: [
            `STREAM: ${stream.id}`,
            `BRANCH: ${stream.branch}`,
            `ROLE: ${stream.role}`,
            `METHOD: ${method}`,
            `ATTEMPT: ${retry + 1} of ${maxRetries + 1}`,
          ],
          signal: options.signal,
        });
        const output = reply.content.trim();
        if (!output) throw new Error('AI returned an empty response');
        attempt.output = output.slice(0, 30_000);
        attempt.status = 'completed';
        attempt.finishedAt = now();
        stream.summary = attempt.output.slice(0, 2_000);
        await publish();
        return attempt.output;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        attempt.error = lastError;
        attempt.status = stopped() ? 'cancelled' : 'failed';
        attempt.finishedAt = now();
        await publish();
        if (stopped()) throw error;
      }
    }
    throw new Error(`${stream.id} exhausted retries for ${method}: ${lastError}`);
  };

  try {
    const [primary, independent] = await Promise.all([
      askWithRetry(
        run.streams['stream-a'],
        'primary-implementation',
        `TASK: ${run.task}\nBASE COMMIT: ${run.baseCommit}\n\nDevelop the primary implementation. Work as if editing only branch ${run.streams['stream-a'].branch}. Return: proposed architecture, exact files, complete patch-ready code or diff, risks, and how to test it. Do not assume Stream B's work exists yet.`,
      ),
      askWithRetry(
        run.streams['stream-b'],
        'independent-test-and-alternative',
        `TASK: ${run.task}\nBASE COMMIT: ${run.baseCommit}\n\nIndependently inspect the problem from scratch on branch ${run.streams['stream-b'].branch}. Do not copy Stream A. Return: baseline assumptions, independent test matrix with executable commands, likely failure modes, and a materially different solution if appropriate.`,
      ),
    ]);
    if (stopped()) throw new DOMException('Parallel agent run cancelled', 'AbortError');

    const messageA: AgentCrossReference = {
      id: `xref-${now().toString(36)}-a`, from: 'stream-a', to: 'stream-b', createdAt: now(),
      content: `Primary candidate from ${run.streams['stream-a'].branch}:\n\n${primary.slice(0, 12_000)}`,
    };
    const messageB: AgentCrossReference = {
      id: `xref-${now().toString(36)}-b`, from: 'stream-b', to: 'stream-a', createdAt: now(),
      content: `Independent test plan and alternative from ${run.streams['stream-b'].branch}:\n\n${independent.slice(0, 12_000)}`,
    };
    run.crossReferences.push(messageA, messageB);
    await Promise.all([options.onCrossReference?.(messageA), options.onCrossReference?.(messageB)]);
    await publish();

    const [revisionA, revisionB] = await Promise.all([
      askWithRetry(
        run.streams['stream-a'],
        'cross-reviewed-revision',
        `TASK: ${run.task}\n\nYOUR ORIGINAL IMPLEMENTATION:\n${primary.slice(0, 12_000)}\n\nINDEPENDENT STREAM B REVIEW:\n${independent.slice(0, 12_000)}\n\nRevise the implementation. Address valid test concerns, reject incorrect criticisms with reasons, and preserve the best working approach. Return exact changes and unresolved risks.`,
      ),
      askWithRetry(
        run.streams['stream-b'],
        'cross-reviewed-test-and-alternative',
        `TASK: ${run.task}\n\nYOUR INDEPENDENT TEST PLAN:\n${independent.slice(0, 12_000)}\n\nSTREAM A IMPLEMENTATION:\n${primary.slice(0, 12_000)}\n\nChallenge the implementation against your tests. Return concrete expected failures, additional test cases, and whether your independent alternative is preferable. Do not claim tests were executed.`,
      ),
    ]);
    const finalA: AgentCrossReference = {
      id: `xref-${now().toString(36)}-final-a`, from: 'stream-a', to: 'stream-b', createdAt: now(),
      content: `Revised primary proposal:\n\n${revisionA.slice(0, 12_000)}`,
    };
    const finalB: AgentCrossReference = {
      id: `xref-${now().toString(36)}-final-b`, from: 'stream-b', to: 'stream-a', createdAt: now(),
      content: `Final independent challenge:\n\n${revisionB.slice(0, 12_000)}`,
    };
    run.crossReferences.push(finalA, finalB);
    await Promise.all([options.onCrossReference?.(finalA), options.onCrossReference?.(finalB)]);
    run.streams['stream-a'].summary = revisionA.slice(0, 2_000);
    run.streams['stream-b'].summary = revisionB.slice(0, 2_000);
    run.streams['stream-a'].status = 'needs-test';
    run.streams['stream-b'].status = 'needs-execution';
    run.status = 'needs-verification';
  } catch (error) {
    if (stopped() || (error instanceof Error && error.name === 'AbortError')) {
      run.status = 'cancelled';
      for (const stream of Object.values(run.streams)) if (stream.status === 'working') stream.status = 'cancelled';
    } else {
      run.status = 'failed';
      for (const stream of Object.values(run.streams)) if (stream.status === 'working') {
        stream.status = 'failed';
        stream.summary = error instanceof Error ? error.message : String(error);
      }
    }
  }
  await publish();
  return structuredClone(run);
}

export function parallelAgentRunText(run: ParallelAgentRun): string {
  return [
    `TASK: ${run.task}`,
    `BASE COMMIT: ${run.baseCommit}`,
    `STATUS: ${run.status}`,
    ...(['stream-a', 'stream-b'] as const).flatMap((id) => {
      const stream = run.streams[id];
      return [
        `## ${id} — ${stream.role} — ${stream.branch} — ${stream.status}`,
        stream.summary,
        ...stream.attempts.map((attempt) => `Attempt ${attempt.attempt} / ${attempt.method} / ${attempt.status}\n${attempt.error ?? attempt.output}`),
      ];
    }),
    ...run.crossReferences.map((message) => `## CROSS-REFERENCE ${message.from} → ${message.to}\n${message.content}`),
    'IMPORTANT: These are AI proposals and review findings. They are not committed branch changes and are not passing test results until executed by the host tooling.',
  ].join('\n\n').slice(0, 60_000);
}
