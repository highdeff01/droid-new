import { useMemo, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { runStats, type BucketBy, type FailureCount, type FlowStats, type RateBucket, type Streaks } from './run-stats.js';
import styles from './droid-assist.module.css';

const pct = (r: number) => `${Math.round(r * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** One bar per day or session: decided runs and the success rate among them. */
function RateRows({ buckets, by }: { buckets: RateBucket[]; by: BucketBy }) {
  if (!buckets.length) return <p className={styles.muted}>No runs recorded yet.</p>;
  return (
    <ul className={styles.log}>
      {buckets.map((b) => (
        <li key={b.key} data-tone={b.successes + b.failures === 0 ? 'info' : b.rate >= 0.5 ? 'ok' : 'warn'}>
          <b>{by === 'day' ? b.key : new Date(b.start).toLocaleString()}</b>{' '}
          <span>{pct(b.rate)}</span> <small>· {b.successes} ok / {b.failures} failed of {b.runs} run(s)</small>{' '}
          <progress value={b.rate} max={1} aria-label={`Success rate ${b.key}`} />
        </li>
      ))}
    </ul>
  );
}

function FailureList({ title, items, empty }: { title: string; items: FailureCount[]; empty: string }) {
  return (
    <>
      <h4>{title}</h4>
      {!items.length && <p className={styles.muted}>{empty}</p>}
      <ol>
        {items.map((f) => (
          <li key={`${f.name}|${f.context}`}>
            <b>{f.name}</b>{f.context && <small> · {f.context}</small>} <span>{f.failures} failed of {f.attempts}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function FlowTable({ flows }: { flows: FlowStats[] }) {
  if (!flows.length) return <p className={styles.muted}>Saved flows appear here once a card is saved.</p>;
  return (
    <table>
      <thead><tr><th>Flow</th><th>Runs</th><th>Successes</th><th>Avg steps</th><th>Avg duration</th></tr></thead>
      <tbody>
        {flows.map((f) => (
          <tr key={f.id}>
            <td>{f.name}</td><td>{f.runs}</td><td>{f.successes}</td><td>{f.avgSteps.toFixed(1)}</td><td>{secs(f.avgDurationMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StreakLine({ s }: { s: Streaks }) {
  const current = s.current ? `${s.current.length} ${s.current.outcome === 'success' ? 'successful' : 'failed'} run(s) in a row` : 'none yet';
  return <p>Current streak: <b>{current}</b> · best success streak {s.bestSuccess} · {s.days} day(s) in a row with a success</p>;
}

/** Read-only run statistics from the persisted run summaries, habits, log and saved cards. */
export function StatsPanel({ engine }: { engine: AssistEngine }) {
  const [by, setBy] = useState<BucketBy>('day');
  const { runs, habits, log, cards, steps } = engine;
  const stats = useMemo(() => runStats({ runs, habits, log, cards, steps }, by), [runs, habits, log, cards, steps, by]);
  return (
    <section className={styles.panel} aria-label="Stats">
      <h3>Stats <small>{stats.totals.runs} run(s) · {pct(stats.totals.rate)} success</small></h3>
      <StreakLine s={stats.streaks} />
      <h4>
        Success rate over time{' '}
        <select value={by} onChange={(e) => setBy(e.target.value as BucketBy)} aria-label="Group runs by">
          <option value="day">per day</option>
          <option value="session">per session</option>
        </select>
      </h4>
      <RateRows buckets={stats.overTime} by={by} />
      <FailureList title="Most-failed targets" items={stats.failedTargets} empty="No failed targets in the habits." />
      <FailureList title="Most-failed steps" items={stats.failedSteps} empty="No failed steps in the run log." />
      <h4>Saved flows</h4>
      <FlowTable flows={stats.flows} />
    </section>
  );
}
