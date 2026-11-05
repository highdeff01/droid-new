import type { AssistEngine } from './use-assist.js';
import { operationView, type AttemptPath, type Point } from './current-operation.js';
import styles from './droid-assist.module.css';

const W = 160;
const H = 90;
const pts = (ps: Point[]) => ps.map((p) => `${(p.x * W).toFixed(1)},${(p.y * H).toFixed(1)}`).join(' ');
const pct = (p: Point) => `${Math.round(p.x * 100)}%, ${Math.round(p.y * 100)}%`;
const ATTEMPT_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#c084fc'];

/** The small trajectory map: each attempt's planned dashed line and the actual trail it drew. */
function Trajectories({ paths, attention }: { paths: AttemptPath[]; attention: Point | null }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W * 2} height={H * 2} role="img" aria-label="Attempt trajectories" style={{ background: '#0f172a', borderRadius: 4 }}>
      {paths.map((p, i) => {
        const color = ATTEMPT_COLORS[i % ATTEMPT_COLORS.length];
        return (
          <g key={p.attempt.id} aria-label={`Attempt ${i + 1}`}>
            <polyline data-kind="planned" points={pts(p.planned)} fill="none" stroke={color} strokeDasharray="3 2" strokeWidth={0.8} />
            {p.actual.length > 0 && <polyline data-kind="actual" points={pts(p.actual)} fill="none" stroke={color} strokeWidth={1.2} />}
            <circle cx={p.attempt.to.x * W} cy={p.attempt.to.y * H} r={1.8} fill={color} />
          </g>
        );
      })}
      {attention && <circle data-kind="attention" cx={attention.x * W} cy={attention.y * H} r={4} fill="none" stroke="#f87171" strokeWidth={1} />}
    </svg>
  );
}

/** One attempt's line in the attempt list. */
function AttemptItem({ p, n }: { p: AttemptPath; n: number }) {
  const a = p.attempt;
  const state = a.end === undefined ? 'running' : a.ok ? 'ok' : 'failed';
  return (
    <li>
      <b>Attempt {n}</b> <small>· {a.actor} · {state} · planned {a.from ? pct(a.from) : 'start'} → {pct(a.to)} · actual {p.actual.length} trail points</small>
    </li>
  );
}

/** Current operation: the active step, its goal-tracer progress, attention, attempt trajectories, next step and main goal. */
export function CurrentOperationPanel({ engine }: { engine: AssistEngine }) {
  const v = operationView({ steps: engine.steps, activeIndex: engine.activeIndex, attempts: engine.attempts, trail: engine.trail, record: engine.activeGoal, goal: engine.goal, cursor: engine.cursor });
  return (
    <section className={styles.panel} aria-label="Operation progress">
      <h3>Operation progress <small>{v.step ? v.step.status : 'idle'}</small></h3>
      {!v.step && <p className={styles.muted}>No operation running — the active step shows here.</p>}
      {v.step && (
        <dl>
          <dt>Operation</dt>
          <dd>{v.step.action} "{v.step.target ?? v.step.name}" <small>· {v.step.name} · at {pct({ x: v.step.correctedX ?? v.step.x, y: v.step.correctedY ?? v.step.y })}{v.step.text ? ` · text "${v.step.text}"` : ''}</small></dd>
          {v.intent && (<><dt>Intention</dt><dd>{v.intent}</dd></>)}
        </dl>
      )}
      <dl>
        <dt>Main goal</dt>
        <dd>{v.goal || 'none set'}</dd>
        <dt>Progress</dt>
        <dd>{v.progress === null ? 'no traced goal' : <><progress value={v.progress} max={100} aria-label="Goal progress" /> {v.progress}% · {v.verified}/{v.total} steps verified</>}</dd>
        <dt>Attention</dt>
        <dd>{v.attention ? `${pct(v.attention)} — ${v.attentionLabel}` : v.attentionLabel}</dd>
        <dt>Next</dt>
        <dd>{v.next ?? 'nothing planned after this'}</dd>
      </dl>
      <h4>Attempts <small>{v.attempts.length}</small></h4>
      <Trajectories paths={v.attempts} attention={v.attention} />
      <ol>{v.attempts.map((p, i) => <AttemptItem key={p.attempt.id} p={p} n={i + 1} />)}</ol>
    </section>
  );
}
