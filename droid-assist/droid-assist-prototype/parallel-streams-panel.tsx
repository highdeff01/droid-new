import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import type { NativeAgentWorktreeApi } from './electron/agent-worktree-api.js';
import type { AgentCheckResult, AgentDiffResult, AgentWorktreeId, AgentWorktreeSnapshot } from './electron/agent-worktrees.js';
import type { ParallelAgentRun } from './parallel-agent-runner.js';
import { extractUnifiedGitDiff } from './parallel-patch.js';

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--line, #334155)',
  borderRadius: 12,
  padding: 14,
  margin: '12px 0',
  background: 'var(--panel, rgba(15, 23, 42, .72))',
  color: 'var(--text, #e2e8f0)',
};
const muted: React.CSSProperties = { color: 'var(--muted, #94a3b8)', fontSize: 12 };
const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: 9, borderRadius: 8,
  border: '1px solid var(--line, #475569)', background: 'var(--surface, #0f172a)',
  color: 'var(--text, #e2e8f0)', font: 'inherit',
};
const button: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line, #475569)',
  background: 'var(--accent, #0891b2)', color: '#fff', cursor: 'pointer',
};

function AgentWorktreeExecutionPanel({ run }: { run: ParallelAgentRun | null }) {
  const native = (window as Window & { droidAgentWorktrees?: NativeAgentWorktreeApi }).droidAgentWorktrees;
  const [repository, setRepository] = useState('');
  const [snapshot, setSnapshot] = useState<AgentWorktreeSnapshot | null>(null);
  const [patches, setPatches] = useState<Record<AgentWorktreeId, string>>({ 'stream-a': '', 'stream-b': '' });
  const [checks, setChecks] = useState<Partial<Record<AgentWorktreeId, AgentCheckResult[]>>>({});
  const [diffs, setDiffs] = useState<Partial<Record<AgentWorktreeId, AgentDiffResult>>>({});
  const [busy, setBusy] = useState<Partial<Record<AgentWorktreeId | 'prepare', boolean>>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!native) return <p style={muted}>Branch execution is available in the Electron desktop build. The browser build can still generate and cross-review both proposals.</p>;

  const withBusy = async (key: AgentWorktreeId | 'prepare', action: () => Promise<void>) => {
    setError(''); setMessage(''); setBusy((old) => ({ ...old, [key]: true }));
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy((old) => ({ ...old, [key]: false })); }
  };
  const loadCandidatePatch = (id: AgentWorktreeId) => {
    const attempts = run?.streams[id].attempts ?? [];
    const candidate = [...attempts].reverse()
      .filter((attempt) => attempt.status === 'completed')
      .map((attempt) => ({ attempt, patch: extractUnifiedGitDiff(attempt.output) }))
      .find((item) => item.patch !== null);
    const patch = candidate?.patch ?? null;
    if (!patch) {
      setError(`No complete unified diff found in the latest completed ${id} response.`);
      return;
    }
    setPatches((old) => ({ ...old, [id]: patch }));
    setError('');
    setMessage(`Loaded ${id} diff. Review it before applying.`);
  };
  const prepare = () => withBusy('prepare', async () => {
    const selected = await native.chooseRepository();
    if (!selected) return;
    setRepository(selected);
    const sharedBase = /^[0-9a-f]{40}$/i.test(run?.baseCommit ?? '') ? run!.baseCommit : undefined;
    const result = await native.prepare(selected, sharedBase);
    setSnapshot(result);
    setChecks({});
    setDiffs({});
    setMessage(`Prepared two isolated worktrees from ${result.baseCommit.slice(0, 12)}. The original checkout was not modified.`);
  });
  const apply = (id: AgentWorktreeId) => withBusy(id, async () => {
    const result = await native.applyPatch(id, patches[id]);
    setMessage(`${id}: patch applied after validation (${result.check}). Saved candidate: ${result.artifactPath}`);
    const diff = await native.getDiff(id);
    setDiffs((old) => ({ ...old, [id]: diff }));
    setChecks((old) => ({ ...old, [id]: undefined }));
  });
  const test = (id: AgentWorktreeId) => withBusy(id, async () => {
    const result = await native.runChecks(id);
    setChecks((old) => ({ ...old, [id]: result }));
    const diff = await native.getDiff(id);
    setDiffs((old) => ({ ...old, [id]: diff }));
    setMessage(`${id}: ${result.filter((item) => item.exitCode === 0).length}/${result.length} checks passed.`);
  });
  const commit = (id: AgentWorktreeId) => withBusy(id, async () => {
    const result = checks[id];
    if (!result?.length || result.some((item) => item.exitCode !== 0)) throw new Error('Run and pass all checks for this stream before committing.');
    const diff = await native.getDiff(id);
    if (!diff.changedFiles.length) throw new Error('There are no changed files to commit.');
    const sha = await native.commit(id, diff.changedFiles, `Droid agent: reviewed ${id} candidate`);
    setMessage(`${id}: committed ${sha.slice(0, 12)}. Push remains a separate explicit action.`);
    const latest = await native.getDiff(id);
    setDiffs((old) => ({ ...old, [id]: latest }));
  });
  const copyVerificationPacket = async (id: AgentWorktreeId) => {
    const diff = diffs[id] ?? await native.getDiff(id);
    const packet = {
      task: run?.task,
      baseCommit: snapshot?.baseCommit,
      stream: id,
      branch: snapshot?.worktrees[id].branch,
      aiAttempts: run?.streams[id].attempts,
      checks: checks[id],
      diff: diff.diff,
      changedFiles: diff.changedFiles,
      artifacts: (checks[id] ?? []).flatMap((item) => [item.artifactPath, item.diffArtifactPath]).filter(Boolean),
    };
    await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
    setMessage(`Copied ${id} verification packet for another tab or review method.`);
  };
  const push = (id: AgentWorktreeId) => withBusy(id, async () => {
    const sha = await native.push(id);
    setMessage(`${id}: pushed ${sha.slice(0, 12)} to origin. No merge was performed.`);
  });
  return (
    <section style={{ borderTop: '1px solid var(--line, #334155)', marginTop: 16, paddingTop: 14 }}>
      <strong>Isolated branch execution</strong>
      <p style={muted}>Select your local Droid-New repository. The desktop app creates two Git worktrees from its current HEAD. Each stream installs its own dependencies, then runs tests and lint independently. Apply a unified diff, inspect results, then explicitly commit and push. Nothing is auto-merged.</p>
      <button type="button" style={button} onClick={() => void prepare()} disabled={!!busy.prepare || !!snapshot || Object.values(busy).some(Boolean)}>
        {busy.prepare ? 'Preparing worktrees…' : snapshot ? 'Two worktrees prepared' : 'Choose repository and prepare both branches'}
      </button>
      {repository && <p style={muted}>Repository: {repository}</p>}
      {snapshot && <p style={muted}>Shared base: {snapshot.baseCommit}</p>}
      {error && <p role="alert" style={{ color: '#fca5a5', fontSize: 12 }}>{error}</p>}
      {message && <p role="status" style={{ color: '#86efac', fontSize: 12 }}>{message}</p>}
      {snapshot && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10, marginTop: 12 }}>
          {(['stream-a', 'stream-b'] as const).map((id) => {
            const diff = diffs[id];
            const result = checks[id];
            const running = !!busy[id];
            return (
              <article key={id} style={{ border: '1px solid var(--line, #334155)', borderRadius: 9, padding: 10, minWidth: 0 }}>
                <strong>{id === 'stream-a' ? 'A · Implementation branch' : 'B · Alternative / test branch'}</strong>
                <div style={muted}>{snapshot.worktrees[id].branch}</div>
                <textarea rows={5} value={patches[id]} onChange={(event) => setPatches((old) => ({ ...old, [id]: event.target.value }))}
                  placeholder="Paste a complete unified Git diff for this branch…" style={{ ...field, marginTop: 8 }} disabled={running} />
                <button type="button" style={{ ...button, marginTop: 7, background: 'transparent', color: 'var(--text, #e2e8f0)' }}
                  disabled={running || !run?.streams[id].attempts.some((attempt) => attempt.status === 'completed')}
                  onClick={() => loadCandidatePatch(id)}>Load latest AI diff</button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <button type="button" style={button} disabled={running || !patches[id].trim()} onClick={() => void apply(id)}>Validate and apply patch</button>
                  <button type="button" style={button} disabled={running} onClick={() => void test(id)}>{running ? 'Working…' : 'Install dependencies + run tests/lint'}</button>
                  <button type="button" style={button} disabled={running || !result?.length || result.some((item) => item.exitCode !== 0) || !diff?.changedFiles.length || diff.clean}
                    onClick={() => void commit(id)}>Commit reviewed changes</button>
                  <button type="button" style={{ ...button, background: '#475569' }} disabled={running || !result?.length || result.some((item) => item.exitCode !== 0) || !diff?.clean}
                    onClick={() => void push(id)}>Push branch</button>
                  <button type="button" style={{ ...button, background: 'transparent', color: 'var(--text, #e2e8f0)' }}
                    disabled={!result?.length || !diff} onClick={() => void copyVerificationPacket(id)}>Copy test packet to other tabs</button>
                </div>
                {result?.map((item) => (
                  <div key={item.command} style={{ borderTop: '1px solid var(--line, #334155)', marginTop: 8, paddingTop: 7 }}>
                    <div style={{ fontSize: 12, color: item.exitCode === 0 ? '#86efac' : '#fca5a5' }}>{item.command}: {item.exitCode === 0 ? 'passed' : `failed (exit ${item.exitCode})`}</div>
                    {item.artifactPath && <div style={muted}>Saved log: {item.artifactPath}</div>}
                    {item.diffArtifactPath && <div style={muted}>Saved diff: {item.diffArtifactPath}</div>}
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 150, overflow: 'auto', fontSize: 10 }}>{[item.stdout, item.stderr].filter(Boolean).join('\n')}</pre>
                  </div>
                ))}
                {diff && <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12 }}>Diff ({diff.changedFiles.length} files)</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto', fontSize: 10 }}>{diff.diff || 'No tracked diff.'}</pre>
                </details>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ParallelStreamsPanel({ engine }: { engine: AssistEngine }) {
  const [task, setTask] = useState('');
  const [baseCommit, setBaseCommit] = useState('95d22ba9d06439f6d502e1e6cdf6d03a9b96b28d');
  const [error, setError] = useState('');
  const run = engine.parallelAgentRun;
  const busy = run?.status === 'running';

  const start = async () => {
    setError('');
    try {
      await engine.runParallelAgents(task, baseCommit);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section style={panelStyle} aria-label="Parallel agent work streams">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong>Parallel work streams</strong>
          <div style={muted}>Two independent AI sessions · cross-reference · retry · alternative method</div>
        </div>
        <span role="status" style={muted}>{run ? run.status.replaceAll('-', ' ') : 'idle'}</span>
      </header>
      <p style={muted}>
        Stream A develops the primary proposal. Stream B starts independently as tester and alternative designer.
        They exchange results and revise. This creates candidate work, not Git commits or passing tests.
      </p>
      <label style={{ display: 'block', fontSize: 12, marginBottom: 5 }}>Task / feature</label>
      <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={3} style={field}
        placeholder="Describe the feature, bug, or engineering task for both streams…" disabled={busy} />
      <label style={{ display: 'block', fontSize: 12, margin: '9px 0 5px' }}>Exact base commit (recommended)</label>
      <input value={baseCommit} onChange={(event) => setBaseCommit(event.target.value)} style={field}
        placeholder="Paste the SHA both branches should start from" disabled={busy} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" style={button} onClick={() => void start()} disabled={busy || !task.trim()}>
          {busy ? 'Running both streams…' : 'Start both streams'}
        </button>
        {busy && <button type="button" style={{ ...button, background: '#7f1d1d' }} onClick={engine.stopParallelAgents}>Stop both</button>}
        {run && <button type="button" style={{ ...button, background: 'transparent', color: 'var(--text, #e2e8f0)' }}
          onClick={() => void navigator.clipboard?.writeText(engine.exportParallelAgentRun())}>Copy cross-reference report</button>}
      </div>
      {error && <p role="alert" style={{ color: '#fca5a5', fontSize: 12 }}>{error}</p>}
      {run && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 14 }}>
          {(['stream-a', 'stream-b'] as const).map((id) => {
            const stream = run.streams[id];
            return (
              <article key={id} style={{ border: '1px solid var(--line, #334155)', borderRadius: 9, padding: 10, minWidth: 0 }}>
                <strong>{id === 'stream-a' ? 'A · Primary implementation' : 'B · Independent tester / alternative'}</strong>
                <div style={muted}>{stream.branch} · {stream.status}</div>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{stream.summary || 'Waiting for output…'}</p>
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12 }}>Attempts ({stream.attempts.length})</summary>
                  {stream.attempts.map((attempt) => (
                    <div key={attempt.id} style={{ borderTop: '1px solid var(--line, #334155)', paddingTop: 7, marginTop: 7 }}>
                      <div style={muted}>#{attempt.attempt} · {attempt.method} · {attempt.status}</div>
                      {attempt.error && <p style={{ color: '#fca5a5', fontSize: 12 }}>{attempt.error}</p>}
                      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11, maxHeight: 260, overflow: 'auto' }}>{attempt.output}</pre>
                    </div>
                  ))}
                </details>
              </article>
            );
          })}
        </div>
      )}
      {run?.crossReferences.length ? (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer' }}>Cross-reference inbox ({run.crossReferences.length})</summary>
          {run.crossReferences.map((message) => (
            <article key={message.id} style={{ borderTop: '1px solid var(--line, #334155)', padding: '9px 0' }}>
              <div style={muted}>{message.from} → {message.to}</div>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11 }}>{message.content}</pre>
            </article>
          ))}
        </details>
      ) : null}
      {run?.status === 'needs-verification' && (
        <p style={{ color: '#fbbf24', fontSize: 12 }}>
          Both streams completed their AI cross-review. Next: apply each proposal on its own Git branch, execute the test plan, retry failed methods, and compare the resulting diffs. Neither proposal is marked verified yet.
        </p>
      )}
      <AgentWorktreeExecutionPanel run={run ?? null} />
    </section>
  );
}
