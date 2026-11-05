import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';

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

export function ParallelStreamsPanel({ engine }: { engine: AssistEngine }) {
  const [task, setTask] = useState('');
  const [baseCommit, setBaseCommit] = useState('67872b196d468aaa8d52533ca50f6ab67cd6f4fc');
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
    </section>
  );
}
