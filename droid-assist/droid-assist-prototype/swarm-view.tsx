import type { AssistEngine } from './use-assist.js';
import { busyAgents, conflicts, dispatchable, roundLine, type SwarmRound } from './project-swarm.js';
import type { ForwardedElement } from './agent-bus.js';
import styles from './droid-assist.module.css';

/** The tasks list: which agent reads which area this round. */
function TaskList({ round }: { round: SwarmRound }) {
  return (
    <ul className={styles.steps} aria-label="Swarm tasks">
      {round.tasks.map((t) => (
        <li key={`${t.agentId}-${t.area.id}`}>
          <div>
            <b>{t.agentId}</b>
            <span>{t.area.id}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Elements the swarm agrees on, each with a Dispatch button. */
function ConsensusList({ round, onDispatch }: { round: SwarmRound; onDispatch: (element: ForwardedElement) => void }) {
  const elements = dispatchable(round);
  return (
    <ul className={styles.steps} aria-label="Swarm consensus">
      {elements.map((element) => (
        <li key={element.name}>
          <div>
            <b>{element.name}</b>
            <span>({element.x.toFixed(2)}, {element.y.toFixed(2)})</span>
          </div>
          <button type="button" aria-label={`Dispatch ${element.name}`} onClick={() => onDispatch(element)}>Dispatch</button>
        </li>
      ))}
    </ul>
  );
}

/** Elements the swarm disagrees on: sent to the resolution center. */
function ConflictList({ round }: { round: SwarmRound }) {
  const list = conflicts(round);
  if (!list.length) return null;
  return (
    <div aria-label="Swarm conflicts">
      <p className={styles.muted}>Sent to resolution center:</p>
      <ul className={styles.steps}>
        {list.map((c) => <li key={c.element.name}><div><b>{c.element.name}</b><span>spread {c.spread.toFixed(3)}</span></div></li>)}
      </ul>
    </div>
  );
}

/**
 * Swarm view: agents fanning out to read droid-main's project quickly, cross-referencing findings
 * and dispatching actions on what they agree on.
 */
export function SwarmView({ engine }: { engine: AssistEngine }) {
  const { bridgeV2, settings } = engine;
  const { swarmRound } = bridgeV2;
  const dispatch = (element: ForwardedElement) => void bridgeV2.dispatchSwarm(element);
  return (
    <div aria-label="Swarm view">
      <div className={styles.hud2}>
        <span>Crew size <b>{settings.crewSize}</b></span>
        <span>Agents busy <b>{busyAgents(swarmRound)}</b></span>
        <button type="button" onClick={() => void bridgeV2.runSwarm(true)}>Run swarm round</button>
      </div>
      {!swarmRound ? (
        <p className={styles.muted}>No swarm round yet</p>
      ) : (
        <>
          <p>{roundLine(swarmRound)}</p>
          <TaskList round={swarmRound} />
          <p>Findings: <b>{swarmRound.findings.length}</b></p>
          <ConsensusList round={swarmRound} onDispatch={dispatch} />
          <ConflictList round={swarmRound} />
        </>
      )}
    </div>
  );
}
