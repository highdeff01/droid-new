import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { nextAction, pendingInjections, progressText, type Project } from './project.js';
import { commandText, pendingFor, type ApprovalRequest } from './approval-queue.js';
import type { ProjectEngine } from './use-projects.js';
import styles from './droid-assist.module.css';

const TONE: Partial<Record<Project['state'], string>> = { complete: 'ok', failed: 'error', 'on-hold': 'warn', 'waiting-for-reply': 'warn' };

/** One queued command: approve, edit its text/target, or reject. */
function ApprovalItem({ projects, r }: { projects: ProjectEngine; r: ApprovalRequest }) {
  const [text, setText] = useState(r.step.text ?? r.step.target ?? '');
  const project = projects.projects.find((p) => p.id === r.projectId);
  const edited = r.step.text !== undefined ? { ...r.step, text } : { ...r.step, target: text };
  return (
    <li data-tone="warn">
      <b>{commandText(r.step)}</b> <small>· {project?.name ?? 'deleted project'}</small>
      <input value={text} onChange={(e) => setText(e.target.value)} aria-label={`Edit ${r.step.name}`} />
      <button type="button" onClick={() => projects.decideApproval(r.id, { kind: 'approve' })}>Approve</button>
      <button type="button" onClick={() => projects.decideApproval(r.id, { kind: 'edit', step: edited })}>Save edit</button>
      <button type="button" onClick={() => projects.decideApproval(r.id, { kind: 'reject' })}>Reject</button>
    </li>
  );
}

/** One project: state, progress, next action, injected info waiting, and its actions. */
function ProjectItem({ projects, p }: { projects: ProjectEngine; p: Project }) {
  const [info, setInfo] = useState('');
  const waiting = pendingInjections(p).length;
  const send = (research: boolean) => {
    if (research) void projects.research(p.id, info);
    else projects.inject(p.id, 'user', 'you', info);
    setInfo('');
  };
  return (
    <li data-tone={TONE[p.state] ?? 'info'}>
      <b>{p.name}</b> <small>· {p.state}{projects.running === p.id ? ' (turn running)' : ''} · turn {p.turn} · {progressText(p)}</small>
      <div><small>Next: {nextAction(p)}{waiting ? ` · ${waiting} injected item(s) for the next turn` : ''}{p.history[0] ? ` · last: ${p.history[0].note}` : ''}</small></div>
      <input value={info} onChange={(e) => setInfo(e.target.value)} placeholder="Add info or a research question" aria-label={`Info for ${p.name}`} />
      <button type="button" disabled={!info.trim()} onClick={() => send(false)}>Inject</button>
      <button type="button" disabled={!info.trim()} onClick={() => send(true)} title="Asks the live-screen AI and injects its answer">Research</button>
      {(p.state === 'failed' || p.state === 'on-hold') && <button type="button" onClick={() => projects.resume(p.id)}>Resume</button>}
      <button type="button" aria-label={`Delete ${p.name}`} onClick={() => projects.remove(p.id)}>✕</button>
    </li>
  );
}

/** Projects: multi-turn goals the AI follows through until nothing is left to do, plus the command approval queue. */
export function ProjectsPanel({ engine }: { engine: AssistEngine }) {
  const { projects, armed } = engine;
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const queue = pendingFor(projects.approvals);
  return (
    <section className={styles.panel} aria-label="Projects">
      <h3>Projects <small>{projects.projects.filter((p) => p.state !== 'complete' && p.state !== 'failed').length}/{projects.projects.length} active · {armed ? 'real input armed' : 'disarmed: projects wait'}</small></h3>
      <p className={styles.muted}>Each project runs turn by turn under the guardrails and the Project lifecycle stage. Commands outside the pre-approved bounds wait here for you.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          projects.add(name, goal);
          setName('');
          setGoal('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" aria-label="Project name" />
        <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal" aria-label="Project goal" />
        <button type="submit" disabled={!goal.trim()}>Start project</button>
      </form>
      {queue.length > 0 && (
        <>
          <h4>Waiting for approval ({queue.length})</h4>
          <ul className={styles.log}>{queue.map((r) => <ApprovalItem key={r.id} projects={projects} r={r} />)}</ul>
        </>
      )}
      <ul className={styles.log}>
        {projects.projects.map((p) => <ProjectItem key={p.id} projects={projects} p={p} />)}
      </ul>
    </section>
  );
}
