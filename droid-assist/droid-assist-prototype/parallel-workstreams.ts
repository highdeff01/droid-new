/**
 * Independent two-stream problem solving.
 *
 * Each stream owns its own branch, method sequence, retry counter and attempt history.
 * Both start from the same base commit, execute concurrently, preserve every result
 * (including failures), and exchange bounded cross-reference messages between rounds.
 *
 * This module coordinates AI/model work only. It must never dispatch physical input;
 * actual mouse/keyboard execution remains behind the single input-authority lease.
 */

export const PARALLEL_STREAM_IDS = ['stream-a', 'stream-b'] as const;
export type ParallelStreamId = typeof PARALLEL_STREAM_IDS[number];
export type StreamRole = 'implementer' | 'tester' | 'independent-reviewer' | 'alternative-builder';
export type AttemptStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped';
export type StreamStatus = 'queued' | 'working' | 'retrying' | 'passed' | 'failed' | 'cancelled';

export interface MethodStrategy {
  id: string;
  label: string;
  instruction: string;
  /** Optional explicit reason this method differs from the previous one. */
  rationale?: string;
}

export interface StreamDefinition {
  id: ParallelStreamId;
  branch: string;
  role: StreamRole;
  task: string;
  methods: MethodStrategy[];
  maxRetriesPerMethod?: number;
}

export interface StreamArtifact {
  id: string;
  streamId: ParallelStreamId;
  attemptId: string;
  methodId: string;
  kind: 'patch' | 'test-report' | 'log' | 'analysis' | 'screenshot-ref' | 'note';
  title: string;
  content: string;
  createdAt: number;
  /** A candidate is not automatically a working solution merely because it was produced. */
  verified: boolean;
  testPassed?: boolean;
  branch?: string;
  commitSha?: string;
  relatedArtifactIds?: string[];
}

export interface StreamAttempt {
  id: string;
  streamId: ParallelStreamId;
  methodId: string;
  methodLabel: string;
  attemptNumber: number;
  retryNumber: number;
  status: AttemptStatus;
  startedAt: number;
  finishedAt?: number;
  summary: string;
  error?: string;
  artifactIds: string[];
  /** A different method must have a different strategy ID, not just a renamed retry. */
  alternativeMethod: boolean;
}

export interface CrossReferenceMessage {
  id: string;
  from: ParallelStreamId;
  to: ParallelStreamId;
  createdAt: number;
  kind: 'finding' | 'challenge' | 'test-request' | 'method-suggestion' | 'verified-solution' | 'failure-analysis';
  content: string;
  artifactIds: string[];
  consumed: boolean;
}

export interface ParallelWorkstreamState {
  version: 1;
  runId: string;
  task: string;
  baseCommit: string;
  createdAt: number;
  updatedAt: number;
  streams: Record<ParallelStreamId, {
    definition: StreamDefinition;
    status: StreamStatus;
    methodIndex: number;
    retryNumber: number;
    attempts: StreamAttempt[];
    lastSummary: string;
    /** The best known verified artifact; failed or untested output never replaces it. */
    workingArtifactIds: string[];
  }>;
  artifacts: StreamArtifact[];
  messages: CrossReferenceMessage[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

export interface AttemptOutput {
  summary: string;
  passed: boolean;
  artifacts?: Array<Omit<StreamArtifact, 'id' | 'streamId' | 'attemptId' | 'methodId' | 'createdAt' | 'verified'>>;
  /** Only a test/verifier may set this true after actually running its checks. */
  verification?: { testPassed: boolean; evidence: string };
  /** Ask coordinator to advance to a different strategy even if this attempt did not throw. */
  tryAlternative?: boolean;
  error?: string;
  crossReferences?: Array<{
    kind: CrossReferenceMessage['kind'];
    content: string;
    artifactIds?: string[];
  }>;
}

export interface AttemptContext {
  runId: string;
  stream: StreamDefinition;
  method: MethodStrategy;
  attempt: StreamAttempt;
  task: string;
  baseCommit: string;
  priorAttempts: readonly StreamAttempt[];
  workingArtifacts: readonly StreamArtifact[];
  incomingMessages: readonly CrossReferenceMessage[];
  signal?: AbortSignal;
}

export interface ParallelWorkstreamOptions {
  runId: string;
  task: string;
  baseCommit: string;
  streams: [StreamDefinition, StreamDefinition];
  /** Execute one isolated attempt. Implementers should use the stream's own branch/worktree. */
  execute: (context: AttemptContext) => Promise<AttemptOutput>;
  /** Persist after each state transition, including failures and cancellation. */
  persist?: (state: ParallelWorkstreamState) => void | Promise<void>;
  /** Send a cross-reference to the other tab/agent/method or an external review surface. */
  onCrossReference?: (message: CrossReferenceMessage) => void | Promise<void>;
  onState?: (state: ParallelWorkstreamState) => void;
  signal?: AbortSignal;
  now?: () => number;
  maxRounds?: number;
  maxMessages?: number;
  maxArtifactChars?: number;
}

const text = (value: unknown, max: number): string => typeof value === 'string' ? value.slice(0, max) : '';
const id = (prefix: string, n: number, time: number) => `${prefix}-${time.toString(36)}-${n.toString(36)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function validateDefinition(stream: StreamDefinition): void {
  if (!PARALLEL_STREAM_IDS.includes(stream.id)) throw new Error(`Unknown stream ID: ${stream.id}`);
  if (!stream.branch.trim()) throw new Error(`${stream.id} requires an isolated branch name`);
  if (!stream.task.trim()) throw new Error(`${stream.id} requires a task`);
  if (!stream.methods.length) throw new Error(`${stream.id} requires at least one method`);
  if (stream.methods.some((method) => !method.id.trim() || !method.instruction.trim())) {
    throw new Error(`${stream.id} contains an empty method strategy`);
  }
  if (new Set(stream.methods.map((method) => method.id)).size !== stream.methods.length) {
    throw new Error(`${stream.id} method IDs must be unique so retries and alternatives are distinguishable`);
  }
}

export function createParallelWorkstreamState(options: Pick<ParallelWorkstreamOptions, 'runId' | 'task' | 'baseCommit' | 'streams'>, now = Date.now()): ParallelWorkstreamState {
  const [a, b] = options.streams;
  validateDefinition(a);
  validateDefinition(b);
  if (a.id === b.id) throw new Error('Two independent streams must have different IDs');
  if (a.branch === b.branch) throw new Error('Parallel streams must use different branches');
  const streamState = (definition: StreamDefinition) => ({
    definition: clone(definition),
    status: 'queued' as const,
    methodIndex: 0,
    retryNumber: 0,
    attempts: [],
    lastSummary: '',
    workingArtifactIds: [],
  });
  return {
    version: 1,
    runId: text(options.runId, 160),
    task: text(options.task, 8_000),
    baseCommit: text(options.baseCommit, 80),
    createdAt: now,
    updatedAt: now,
    streams: { 'stream-a': streamState(a), 'stream-b': streamState(b) },
    artifacts: [],
    messages: [],
    status: 'running',
  };
}

function emitMessage(
  state: ParallelWorkstreamState,
  from: ParallelStreamId,
  message: NonNullable<AttemptOutput['crossReferences']>[number],
  now: number,
  maxMessages: number,
): CrossReferenceMessage {
  const to: ParallelStreamId = from === 'stream-a' ? 'stream-b' : 'stream-a';
  const item: CrossReferenceMessage = {
    id: id('xref', state.messages.length + 1, now),
    from,
    to,
    createdAt: now,
    kind: message.kind,
    content: text(message.content, 8_000),
    artifactIds: [...new Set(message.artifactIds ?? [])].slice(0, 30),
    consumed: false,
  };
  state.messages = [...state.messages, item].slice(-maxMessages);
  return item;
}

function appendArtifact(
  state: ParallelWorkstreamState,
  streamId: ParallelStreamId,
  attempt: StreamAttempt,
  artifact: NonNullable<AttemptOutput['artifacts']>[number],
  now: number,
  maxChars: number,
  verificationPassed: boolean,
): StreamArtifact {
  const item: StreamArtifact = {
    ...artifact,
    id: id('artifact', state.artifacts.length + 1, now),
    streamId,
    attemptId: attempt.id,
    methodId: attempt.methodId,
    title: text(artifact.title, 240) || 'Untitled result',
    content: text(artifact.content, maxChars),
    createdAt: now,
    verified: verificationPassed && artifact.kind === 'patch' && artifact.testPassed === true,
    testPassed: artifact.testPassed,
    relatedArtifactIds: [...new Set(artifact.relatedArtifactIds ?? [])].slice(0, 30),
  };
  state.artifacts.push(item);
  attempt.artifactIds.push(item.id);
  if (item.verified && item.testPassed) {
    const stream = state.streams[streamId];
    stream.workingArtifactIds = [...new Set([...stream.workingArtifactIds, item.id])];
  }
  return item;
}

function nextMethod(stream: ParallelWorkstreamState['streams'][ParallelStreamId]): boolean {
  if (stream.methodIndex + 1 >= stream.definition.methods.length) return false;
  stream.methodIndex++;
  stream.retryNumber = 0;
  stream.status = 'retrying';
  return true;
}

/**
 * Run both streams concurrently. Each has independent retries and method fallback.
 * Failed outputs remain in the ledger and are forwarded as failure-analysis messages.
 * A candidate is marked working only when its own attempt explicitly supplies a passing
 * verification report and a patch artifact marked testPassed=true. A successful build or
 * plausible answer without independent verification is still retried and alternative-tested.
 */
export async function runParallelWorkstreams(options: ParallelWorkstreamOptions): Promise<ParallelWorkstreamState> {
  const now = options.now ?? Date.now;
  const maxRounds = Math.max(1, Math.min(20, Math.floor(options.maxRounds ?? 12)));
  const maxMessages = Math.max(10, Math.min(500, Math.floor(options.maxMessages ?? 120)));
  const maxArtifactChars = Math.max(1_000, Math.min(100_000, Math.floor(options.maxArtifactChars ?? 30_000)));
  const state = createParallelWorkstreamState(options, now());
  let sequence = 0;

  const publish = async () => {
    state.updatedAt = now();
    options.onState?.(clone(state));
    await options.persist?.(clone(state));
  };
  const cancelled = () => options.signal?.aborted === true;

  const runOne = async (streamId: ParallelStreamId): Promise<void> => {
    const stream = state.streams[streamId];
    if (stream.status === 'passed' || stream.status === 'failed' || stream.status === 'cancelled') return;
    if (cancelled()) {
      stream.status = 'cancelled';
      return;
    }

    const method = stream.definition.methods[stream.methodIndex];
    const attemptNumber = stream.attempts.length + 1;
    const time = now();
    const attempt: StreamAttempt = {
      id: id(`${streamId}-attempt`, ++sequence, time),
      streamId,
      methodId: method.id,
      methodLabel: method.label,
      attemptNumber,
      retryNumber: stream.retryNumber,
      status: 'running',
      startedAt: time,
      summary: '',
      artifactIds: [],
      alternativeMethod: stream.methodIndex > 0,
    };
    stream.attempts.push(attempt);
    stream.status = stream.retryNumber > 0 ? 'retrying' : 'working';
    await publish();

    const incoming = state.messages.filter((message) => message.to === streamId && !message.consumed);
    for (const message of incoming) message.consumed = true;
    const context: AttemptContext = {
      runId: state.runId,
      stream: stream.definition,
      method,
      attempt,
      task: state.task,
      baseCommit: state.baseCommit,
      priorAttempts: stream.attempts.slice(0, -1),
      workingArtifacts: stream.workingArtifactIds.map((artifactId) => state.artifacts.find((a) => a.id === artifactId)).filter((a): a is StreamArtifact => !!a),
      incomingMessages: incoming,
      signal: options.signal,
    };

    let output: AttemptOutput;
    try {
      output = await options.execute(context);
    } catch (error) {
      output = { passed: false, summary: 'Attempt threw an exception', error: error instanceof Error ? error.message : String(error) };
    }

    const ended = now();
    attempt.finishedAt = ended;
    attempt.summary = text(output.summary, 8_000);
    attempt.error = output.error ? text(output.error, 4_000) : undefined;
    const verificationPassed = output.passed && output.verification?.testPassed === true;
    attempt.status = cancelled() ? 'cancelled' : verificationPassed ? 'passed' : 'failed';

    for (const artifact of output.artifacts ?? []) {
      appendArtifact(state, streamId, attempt, artifact, ended, maxArtifactChars, verificationPassed);
    }

    const emitted: CrossReferenceMessage[] = [];
    for (const ref of output.crossReferences ?? []) emitted.push(emitMessage(state, streamId, ref, ended, maxMessages));
    if (!output.passed) {
      emitted.push(emitMessage(state, streamId, {
        kind: 'failure-analysis',
        content: `Method "${method.label}" failed for ${streamId}. Error: ${attempt.error ?? 'No error detail supplied'}. Summary: ${attempt.summary}. Inspect its preserved artifacts before choosing another method.`,
        artifactIds: attempt.artifactIds,
      }, ended, maxMessages));
    } else if (attempt.artifactIds.length) {
      emitted.push(emitMessage(state, streamId, {
        kind: 'finding',
        content: `Stream ${streamId} completed method "${method.label}". Review its output and independently challenge the result before accepting it.`,
        artifactIds: attempt.artifactIds,
      }, ended, maxMessages));
    }
    for (const message of emitted) await options.onCrossReference?.(clone(message));

    if (cancelled()) {
      stream.status = 'cancelled';
    } else if (output.passed && verificationPassed) {
      stream.status = 'passed';
      stream.lastSummary = attempt.summary;
    } else {
      const retries = Math.max(0, Math.min(5, Math.floor(stream.definition.maxRetriesPerMethod ?? 1)));
      if (stream.retryNumber < retries) {
        stream.retryNumber++;
        stream.status = 'retrying';
      } else if (nextMethod(stream)) {
        stream.status = 'retrying';
      } else {
        stream.status = 'failed';
        stream.lastSummary = attempt.summary || attempt.error || 'All retry and alternative methods were exhausted';
      }
    }
    await publish();
  };

  let round = 0;
  while (round < maxRounds && state.status === 'running') {
    if (cancelled()) {
      state.status = 'cancelled';
      break;
    }
    const active = PARALLEL_STREAM_IDS.filter((id) => !['passed', 'failed', 'cancelled'].includes(state.streams[id].status));
    if (!active.length) break;
    round++;
    // Both streams execute concurrently; each sees its own queued cross-reference inbox.
    await Promise.all(active.map((streamId) => runOne(streamId)));
    // Each stream gets the other's latest artifacts/findings on the next round.
    if (PARALLEL_STREAM_IDS.every((id) => ['passed', 'failed', 'cancelled'].includes(state.streams[id].status))) break;
  }

  if (cancelled()) {
    state.status = 'cancelled';
    for (const streamId of PARALLEL_STREAM_IDS) {
      const stream = state.streams[streamId];
      if (!['passed', 'failed'].includes(stream.status)) stream.status = 'cancelled';
    }
  } else {
    state.status = PARALLEL_STREAM_IDS.some((id) => state.streams[id].status === 'passed') ? 'completed' : 'failed';
    for (const streamId of PARALLEL_STREAM_IDS) {
      const stream = state.streams[streamId];
      if (!['passed', 'failed', 'cancelled'].includes(stream.status)) {
        stream.status = 'failed';
        stream.lastSummary = `Stopped after the ${maxRounds}-round safety limit; preserve artifacts and resume with a new run.`;
      }
    }
  }
  await publish();
  return clone(state);
}

/** Find the latest verified solution without discarding competing or failed attempts. */
export function bestVerifiedArtifacts(state: ParallelWorkstreamState): StreamArtifact[] {
  return state.artifacts.filter((artifact) => artifact.verified && artifact.testPassed === true)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Build a compact, cross-stream comparison packet for a reviewer tab or another model method. */
export function buildCrossReferencePacket(state: ParallelWorkstreamState, limit = 12): string {
  const max = Math.max(1, Math.min(40, Math.floor(limit)));
  const artifacts = state.artifacts.slice(-max).map((artifact) =>
    `[${artifact.streamId}/${artifact.methodId}/${artifact.verified ? 'verified' : 'unverified'}] ${artifact.title}\n${artifact.content.slice(0, 2_500)}`
  );
  const attempts = PARALLEL_STREAM_IDS.flatMap((streamId) => state.streams[streamId].attempts.slice(-8).map((attempt) =>
    `[${streamId} · ${attempt.methodLabel} · ${attempt.status}] ${attempt.summary}${attempt.error ? ` Error: ${attempt.error}` : ''}`
  ));
  const messages = state.messages.slice(-max).map((message) =>
    `[${message.from} → ${message.to} · ${message.kind}] ${message.content}`
  );
  return [
    `TASK: ${state.task}`,
    `BASE COMMIT: ${state.baseCommit}`,
    'ATTEMPTS:', ...attempts,
    'ARTIFACTS:', ...artifacts,
    'CROSS-REFERENCES:', ...messages,
    'REVIEW RULE: do not accept a claim without checking its artifact and test evidence. Keep a previously verified artifact if a newer attempt fails.',
  ].join('\n\n').slice(0, 40_000);
}
