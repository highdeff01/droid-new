import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { MainBridgeBadge } from './hud.js';
import { SwarmView } from './swarm-view.js';
import { busyAgents } from './project-swarm.js';
import { coordinationTotals } from './coordination.js';
import { errorLogs } from './browser-logs.js';
import styles from './droid-assist.module.css';

type TabId = 'swarm' | 'status' | 'coordinate' | 'screenshare' | 'browser-logs';

/** Both apps' live state: droid-new's own, and droid-main's from the last app_state it reported. */
function StatusTab({ engine }: { engine: AssistEngine }) {
  const { mainBridge, armed, replaying, bridgeV2 } = engine;
  const remote = bridgeV2.remote;
  return (
    <div aria-label="Status tab">
      <div>
        <h4>droid-new</h4>
        <MainBridgeBadge state={mainBridge} />
        <p>{replaying ? 'run in progress' : 'idle'}</p>
        <p>Armed: <b>{armed ? 'yes' : 'no'}</b></p>
        <p>Agents busy: <b>{busyAgents(bridgeV2.swarmRound)}</b></p>
      </div>
      <div>
        <h4>droid-main</h4>
        {remote ? (
          <p>
            {remote.running ? 'running' : 'idle'} — goal "{remote.goal}", {remote.steps} step(s),
            active index {remote.activeIndex}, {remote.agentsBusy} agent(s) busy
          </p>
        ) : (
          <p className={styles.muted}>No state from droid-main yet</p>
        )}
      </div>
      {bridgeV2.decision && <p aria-label="App selection decision">{bridgeV2.decision.choice}: {bridgeV2.decision.reason}</p>}
    </div>
  );
}

/** Planned vs dispatched vs verified, with totals, then the request flows between the apps. */
function CoordinateTab({ engine }: { engine: AssistEngine }) {
  const { coordination, flows } = engine.bridgeV2;
  const totals = coordinationTotals(coordination);
  return (
    <div aria-label="Coordinate tab">
      <table>
        <thead>
          <tr><th>Step</th><th>Planned</th><th>Dispatched</th><th>Verified</th><th>Agreement</th></tr>
        </thead>
        <tbody>
          {coordination.map((row) => (
            <tr key={row.index}>
              <td>{row.name}</td>
              <td>{row.planned ? 'yes' : 'no'}</td>
              <td>{row.dispatched ? row.owner : 'no'}</td>
              <td>{row.verified === null ? 'pending' : row.verified ? 'yes' : 'no'}</td>
              <td>{row.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Planned {totals.planned} · Dispatched {totals.dispatched} · Verified {totals.verified} · Complete {totals.complete}</p>
      <ul className={styles.log} aria-label="Request flows">
        {flows.map((f) => <li key={`${f.time}-${f.text}`}>{f.direction === 'to-main' ? '→ droid-main' : '← droid-main'}: {f.text}</li>)}
      </ul>
    </div>
  );
}

/** droid-main's mirrored preview as a capture source. */
function ScreenshareTab({ engine }: { engine: AssistEngine }) {
  const { frames, source, selectMainApp } = engine;
  const frame = frames.find((f) => f.source === 'main-app');
  return (
    <div aria-label="Screenshare tab">
      {frame ? <img src={frame.url} alt="droid-main preview" /> : <p className={styles.muted}>No preview from droid-main yet</p>}
      {source === 'main-app' ? (
        <p>Capture source: droid-main</p>
      ) : (
        <button type="button" onClick={selectMainApp}>Use as capture source</button>
      )}
    </div>
  );
}

/** Console errors from either app, for agents to detect and fix. */
function BrowserLogsTab({ engine }: { engine: AssistEngine }) {
  const { browserLogs, clearBrowserLogs } = engine.bridgeV2;
  return (
    <div aria-label="Browser logs tab">
      <p>Errors: <b>{errorLogs(browserLogs).length}</b></p>
      <button type="button" onClick={clearBrowserLogs}>Clear</button>
      {!browserLogs.length ? (
        <p className={styles.muted}>No console errors</p>
      ) : (
        <ul className={styles.log}>
          {browserLogs.map((l) => (
            <li key={l.id} data-tone={l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : 'info'}>
              <b>{l.app}</b> [{l.level}] {l.message}{l.count > 1 ? ` ×${l.count}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The tab strip and its lookup table: tab id → label and the component shown for it. */
const TABS: Record<TabId, { label: string; View: (p: { engine: AssistEngine }) => JSX.Element }> = {
  swarm: { label: 'Swarm', View: SwarmView },
  status: { label: 'Status', View: StatusTab },
  coordinate: { label: 'Coordinate', View: CoordinateTab },
  screenshare: { label: 'Screenshare', View: ScreenshareTab },
  'browser-logs': { label: 'Browser logs', View: BrowserLogsTab },
};

const TAB_IDS = Object.keys(TABS) as TabId[];

/** Tab strip for the bridge views: swarm, status, coordinate, screenshare and browser logs. */
export function BridgeTabs({ engine }: { engine: AssistEngine }) {
  const [active, setActive] = useState<TabId>('swarm');
  const { View } = TABS[active];
  return (
    <div aria-label="Bridge tabs">
      <div role="tablist" aria-label="Bridge tabs">
        {TAB_IDS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={active === id} onClick={() => setActive(id)}>
            {TABS[id].label}
          </button>
        ))}
      </div>
      <View engine={engine} />
    </div>
  );
}
