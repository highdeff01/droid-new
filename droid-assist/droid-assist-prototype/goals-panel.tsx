import type { AssistEngine } from './use-assist.js';
import type { GoalRecord, GoalStatus } from './goal-tracer.js';
import styles from './droid-assist.module.css';

const clock = (t: number) => new Date(t).toLocaleString();
const STATUS_TONE: Record<GoalStatus, string> = { active: 'info', paused: 'info', completed: 'ok', failed: 'error', abandoned: 'warn' };

/** One goal: status, progress, timestamps, per-step states, obstacles and linked runs. */
function GoalItem({ g }: { g: GoalRecord }) {
  return (
    <li data-tone={STATUS_TONE[g.status]} aria-label={`Goal ${g.goal}`}>
      <b>{g.goal}</b> <small>· {g.source} · {g.status}</small>{' '}
      <progress value={g.progress} max={100} aria-label={`Progress ${g.goal}`} /> <span>{g.progress}%</span>
      <small> · created {clock(g.createdAt)} · updated {clock(g.updatedAt)} · {g.retries} retries</small>
      <ol>
        {g.stepIds.map((id) => <li key={id}>{g.steps[id]?.name} <small>· {g.steps[id]?.state} {clock(g.steps[id]?.at ?? g.createdAt)}</small></li>)}
      </ol>
      {g.obstacles.length > 0 && (
        <>
          <h4>Obstacles <small>{g.obstacles.length}</small></h4>
          <ul>{g.obstacles.map((o, i) => <li key={i}><small>{clock(o.time)}</small> <b>{o.cause}</b> {o.text}</li>)}</ul>
        </>
      )}
      <p className={styles.muted}>
        Workflow: {g.workflowId ?? 'none'} · Runs: {g.runIds.length ? g.runIds.join(', ') : 'none yet'}
      </p>
    </li>
  );
}

/** Goals: every operation's GoalRecord, newest first; finished ones stay listed for the memory system. */
export function GoalsPanel({ engine }: { engine: AssistEngine }) {
  const { goals, tracerStatus } = engine;
  return (
    <section className={styles.panel} aria-label="Goals">
      <h3>Goals <small>{goals.length} · {tracerStatus}</small></h3>
      {!goals.length && <p className={styles.muted}>Each plan, loaded flow or run gets its own traced goal here.</p>}
      <ul className={styles.log}>{goals.map((g) => <GoalItem key={g.id} g={g} />)}</ul>
    </section>
  );
}
