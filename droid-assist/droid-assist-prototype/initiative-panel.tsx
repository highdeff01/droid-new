import type { AssistEngine } from './use-assist.js';
import { CATEGORY_NAME, INITIATIVE_CATEGORIES, SCAN_SEC_MAX, SCAN_SEC_MIN, STRESS_CYCLES_MAX, STRESS_CYCLES_MIN, editsText, type InitiativeProposal, type SelfTestMode } from './initiative.js';
import { stressText } from './self-test.js';
import styles from './droid-assist.module.css';

const clock = (t: number) => new Date(t).toLocaleTimeString();
const TONE = { pending: 'warn', applied: 'ok', dismissed: 'info' } as const;

/** What a proposal would do, beyond its text. */
function detail(p: InitiativeProposal): string {
  if (p.edits?.length) return editsText(p.edits);
  if (p.pack) return p.pack.checks.join(' · ');
  return p.step ? `${p.step.action} "${p.step.target ?? p.step.name}"` : '';
}

/** One proposal with Accept / Dismiss while pending. */
function InitiativeItem({ engine, p }: { engine: AssistEngine; p: InitiativeProposal }) {
  const pending = p.status === 'pending';
  return (
    <li data-tone={TONE[p.status]}>
      <small>{clock(p.time)} · {CATEGORY_NAME[p.category]}</small> {p.text} <small>· {p.status}{detail(p) ? ` · ${detail(p)}` : ''}</small>
      {pending && <button type="button" onClick={() => void engine.acceptInitiative(p.id)} title={engine.armed ? 'Applies now (real input inside the budget)' : 'Applies now — input runs as a dry run'}>Accept</button>}
      {pending && <button type="button" onClick={() => engine.dismissInitiative(p.id)}>Dismiss</button>}
    </li>
  );
}

/** Scan interval, self-test mode, stress cycles and auto-apply per category. */
function InitiativeSettings({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings } = engine;
  return (
    <div className={styles.group}>
      <label className={styles.setting}>Scan every <b>{settings.scanSec} s</b>
        <small>The AI may scan sooner when it expects a change.</small>
        <input type="range" min={SCAN_SEC_MIN} max={SCAN_SEC_MAX} step={5} value={settings.scanSec} onChange={(e) => setSettings({ ...settings, scanSec: +e.target.value })} aria-label="Initiative scan interval" />
      </label>
      <label className={styles.setting}>Self-tests run in the
        <select value={settings.selfTestMode} onChange={(e) => setSettings({ ...settings, selfTestMode: e.target.value as SelfTestMode })} aria-label="Self-test mode">
          <option value="background">background (verify only, no input)</option>
          <option value="foreground">foreground (highlighted, real click when armed)</option>
        </select>
      </label>
      <label className={styles.setting}>Stress-test cycles <b>{settings.stressCycles}</b>
        <input type="range" min={STRESS_CYCLES_MIN} max={STRESS_CYCLES_MAX} value={settings.stressCycles} onChange={(e) => setSettings({ ...settings, stressCycles: +e.target.value })} aria-label="Stress-test cycles" />
      </label>
      {INITIATIVE_CATEGORIES.map((c) => (
        <label key={c} className={styles.setting}>
          <input type="checkbox" checked={settings.autoApply[c]} onChange={(e) => setSettings({ ...settings, autoApply: { ...settings.autoApply, [c]: e.target.checked } })} /> Auto-apply {CATEGORY_NAME[c]}
        </label>
      ))}
    </div>
  );
}

/** AI initiative: proposals with Accept / Dismiss, the heavy element tester, reliability reports and the initiative log. */
export function InitiativePanel({ engine }: { engine: AssistEngine }) {
  const { proposals, log, stress } = engine.initiative;
  return (
    <section className={styles.panel} aria-label="AI initiative">
      <h3>AI initiative <small>{engine.armed ? 'armed — auto-applied input is real, inside the budget' : 'disarmed — input runs as a dry run'}</small></h3>
      <InitiativeSettings engine={engine} />
      <div className={styles.group}>
        <button type="button" onClick={() => void engine.scanNow()}>Scan now</button>
      </div>
      <h4>Proposals <small>{proposals.filter((p) => p.status === 'pending').length} pending</small></h4>
      <ul className={styles.log}>{proposals.map((p) => <InitiativeItem key={p.id} engine={engine} p={p} />)}</ul>
      <h4>Heavy element tester <small>{engine.testTargets.length} element(s)</small></h4>
      {!engine.testTargets.length && <p className={styles.muted}>Map elements or let the coordinate learner find some to stress-test them.</p>}
      <ul className={styles.log}>
        {engine.testTargets.map((t) => (
          <li key={t.name}>{t.name} <button type="button" onClick={() => void engine.stressTest(t)}>Stress test</button></li>
        ))}
      </ul>
      <ul className={styles.log}>
        {stress.map((r) => <li key={r.id} data-tone={r.reliability >= 0.5 ? 'ok' : 'error'}><small>{clock(r.time)}</small> {stressText(r)}</li>)}
      </ul>
      <h4>Log <small>{log.length}</small></h4>
      <ul className={styles.log}>
        {log.map((l) => <li key={l.id} data-tone={l.ok ? 'ok' : 'warn'}><small>{clock(l.time)} · {CATEGORY_NAME[l.category]}</small> {l.text}</li>)}
      </ul>
    </section>
  );
}
