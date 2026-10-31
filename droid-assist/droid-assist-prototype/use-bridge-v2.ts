import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LogEntry, WorkflowStep } from './types.js';
import { sameElement, type BusAgentId, type BusMessage, type ForwardedElement } from './agent-bus.js';
import type { MainBridge } from './main-bridge.js';
import type { AppStatePayload, ConsoleLevel, InboundMessage, OutboundPayloads, OutboundType, PeerPayloads, RegulateCommand } from './main-bridge-protocol.js';
import { routeV2, type PeerHandlers, type V2Machinery } from './bridge-v2-handlers.js';
import { TAKEOVER_MS, TAKEOVER_SOURCE, addRemoteOpinion, addTakeover, agreementState, applyRegulate, arbitrate, handOffReason, shouldHandOff, syncAgreements, takeoverPayload, type RegulateTarget, type StepAgreement } from './takeover.js';
import { selectApp, type JobDecision } from './app-selection.js';
import { advanceWatermarks, fromPayload, mergeDelta, mergeLine, outgoingDelta, toPayload, type StoreWatermarks } from './store-sync.js';
import { applySyncEntries, loadStoreWatermarks, loadSyncEntries, saveStoreWatermarks } from './storage.js';
import { DRIVING_SOURCE, drivingLine, enqueueSuggestion, handWheel, isDriving, newDriving, suggestionLine, takeSuggestion, takeWheel, type Driving, type Suggestion } from './driver.js';
import { busyAgents, roundLine, runSwarmRound, conflicts, type SwarmRound } from './project-swarm.js';
import { buildCrew } from './crew.js';
import { BROWSER_LOGS_SOURCE, captureConsole, fromConsolePayload, pushBrowserLog, type BrowserLog, type LogApp } from './browser-logs.js';
import { coordinationRows, pushFlow, type RequestFlow } from './coordination.js';
import { entry, isLedgerEntry, ledgerDelta, ledgerTotals, mergeLedger, pushEntry, type LedgerEntry } from './run-ledger.js';
import { capabilitiesFromHealth, fromHealthPayload, healthLine, localHealth, toHealthPayload, type Health } from './health.js';
import { fromResumePayload, isResumable, resumePlan, toResumePayload, type RunSnapshot } from './session-resume.js';
import type { ApprovalDecisionPayload } from './main-bridge-protocol.js';

/** Log source of the v2 bridge traffic (user requests, regulation, opinions). */
export const BRIDGE_V2_SOURCE = 'Main app v2';
/** Log source of swarm rounds. */
export const SWARM_SOURCE = 'Swarm';
/** Log source of learned-store sync over the bridge. */
export const STORE_SYNC_SOURCE = 'Store sync';
/** Log source of the shared run ledger. */
export const LEDGER_SOURCE = 'Run ledger';
/** Log source of the health exchange. */
export const HEALTH_SOURCE = 'Health';
/** Log source of session resume. */
export const RESUME_SOURCE = 'Resume';
/** How often, while connected, the shared run ledger and this app's health cross the bridge. */
export const LEDGER_SYNC_MS = 5_000;
/** How often this app broadcasts its health. */
export const HEALTH_MS = 4_000;
/** How often, while connected, learned-store deltas cross the bridge (an element learned in one app reaches the other). */
export const STORE_SYNC_MS = 10_000;
/** This app's name on the wire. */
export const ASSIST_APP = 'droid-new';

/** Agents that take a console error as a note (it has no real position). */
const NOTE_AGENTS: BusAgentId[] = ['progress', 'goal', 'supervisor'];
/** Which bus participant puts each app's console errors on the bus. */
const ERROR_SENDER: Readonly<Record<LogApp, BusAgentId>> = { 'droid-new': 'screen', 'droid-main': 'mainApp' };

/** What the v2 bridge needs from the engine. */
export interface BridgeV2Deps {
  bridge: () => MainBridge | null;
  connected: boolean;
  steps: WorkflowStep[];
  running: boolean;
  activeIndex: number | null;
  armed: boolean;
  aiOnline: () => boolean;
  crewSize: number;
  /** Elements droid-new knows (its swarm reading). */
  knownElements: ForwardedElement[];
  /** The agent bus; droid-main's forwarded elements are its swarm reading. */
  bus: BusMessage[];
  goal: () => string;
  recentLog: () => LogEntry[];
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  forwardElement: (from: BusAgentId, element: ForwardedElement, to?: BusAgentId[]) => void;
  /** The existing machinery every main→assist request is routed into. */
  machinery: V2Machinery;
  /** What droid-main's regulate commands act on. */
  regulate: RegulateTarget;
  /** Plans a user request that came from droid-main. */
  plan: (text: string) => Promise<unknown>;
  /** Elements droid-new's agents dispute (open disagreements in the resolution center). */
  disputedElements: string[];
  /** Records droid-new's arbiter verdict in the resolution center. */
  arbitrate: (step: string, brief: string, complete: boolean) => void;
  /** Performs one action against an element the swarm agreed on (gated like any step). */
  act: (element: ForwardedElement) => Promise<unknown>;
  /** This app's live health, measured locally (AI endpoint, latency, crew load, armed). */
  health: () => { aiUp: boolean; latencyMs: number; crewLoad: number; armed: boolean; canExecute: boolean };
  /** Applies an approval decision that arrived from the other app (it was answered there). */
  decideApproval: (id: string, decision: ApprovalDecisionPayload['decision'], text?: string) => void;
  /** The current run's snapshot, for resuming on the other app after a restart. */
  snapshot: () => RunSnapshot | null;
  /** Applies a resume the other app offered: replay what happened while this app was down. */
  onResume: (plan: { resumeAt: number; replay: string[]; summary: string }) => void;
}

/** droid-main's elements on the bus, newest per name. */
function mainElements(bus: readonly BusMessage[]): ForwardedElement[] {
  const seen = new Set<string>();
  return bus.filter((m) => m.from === 'mainApp').flatMap((m) => {
    const key = m.element.name.trim().toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [m.element];
  });
}

/**
 * Protocol v2 on top of the main-app bridge: routes every main→assist request into the machinery
 * and answers it, carries user requests both ways, runs the takeover protocol (agreements, the 10 s
 * first-step handoff, opinions, arbiter), regulates both ways, captures browser logs and runs the
 * project swarm on the crew.
 */
export function useBridgeV2(deps: BridgeV2Deps) {
  const depsRef = useRef(deps);
  useLayoutEffect(() => {
    depsRef.current = deps;
  });
  const [agreements, setAgreements] = useState<StepAgreement[]>([]);
  const agreementsRef = useRef<StepAgreement[]>([]);
  const [flows, setFlows] = useState<RequestFlow[]>([]);
  const [browserLogs, setBrowserLogs] = useState<BrowserLog[]>([]);
  const browserLogsRef = useRef<BrowserLog[]>([]);
  const [remote, setRemote] = useState<AppStatePayload | null>(null);
  const [round, setRound] = useState<SwarmRound | null>(null);
  const roundRef = useRef(0);
  const [decision, setDecision] = useState<JobDecision | null>(null);
  const planKeyRef = useRef('');
  /** Once-per-plan effects already done (opinions sent, arbitrations, completions). */
  const doneRef = useRef(new Set<string>());
  /** Store-sync watermarks: the newest learned observation already exchanged with droid-main. */
  const watermarksRef = useRef<StoreWatermarks>(loadStoreWatermarks());
  /** Who owns execution right now (droid-new by default). */
  const [driving, setDriving] = useState<Driving>(() => newDriving());
  const drivingRef = useRef(driving);
  /** droid-main's simultaneous commands, held for droid-new to accept or dismiss. */
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const suggestionsRef = useRef<Suggestion[]>([]);
  /** The shared run ledger: one timeline of every step, verdict and handoff, merged from both apps. */
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const ledgerRef = useRef<LedgerEntry[]>([]);
  /** Ledger entries already exchanged with droid-main, so a delta never repeats one. */
  const sentLedgerRef = useRef(new Set<string>());
  /** droid-main's live health (null until it reports; stale reports are ignored). */
  const [peerHealth, setPeerHealth] = useState<Health | null>(null);
  const peerHealthRef = useRef<Health | null>(null);
  /** The run snapshot the other app holds while this app restarts, for resuming on reconnect. */
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const snapshotRef = useRef<RunSnapshot | null>(null);

  const commit = (next: StepAgreement[]) => {
    agreementsRef.current = next;
    setAgreements(next);
  };
  const log = (message: string, tone: LogEntry['tone'] = 'info', from = BRIDGE_V2_SOURCE) => depsRef.current.addLog(from, message, tone);
  const send = <K extends OutboundType>(type: K, payload: OutboundPayloads[K], replyTo?: string) =>
    depsRef.current.bridge()?.send(type, payload, replyTo) ?? Promise.resolve({ ok: false, message: 'Main app bridge not started' });

  /** Appends a local entry to the shared run ledger and returns it (so callers can send it too). */
  const ledgerAdd = (kind: LedgerEntry['kind'], text: string, stepIndex?: number, ok?: boolean): LedgerEntry => {
    const e = entry(ASSIST_APP, kind, text, Date.now(), stepIndex, ok);
    const next = pushEntry(ledgerRef.current, e);
    ledgerRef.current = next;
    setLedger(next);
    return e;
  };

  /** Merges droid-main's ledger entries into the shared timeline (a union by id — nothing dropped). */
  const mergeRemoteLedger = (entries: LedgerEntry[]) => {
    const next = mergeLedger(ledgerRef.current, entries);
    ledgerRef.current = next;
    setLedger(next);
  };

  /** Records a new driving flag in both the UI and the ref, and logs the change. */
  const commitDriving = (next: Driving) => {
    drivingRef.current = next;
    setDriving(next);
    log(drivingLine(next), 'info', DRIVING_SOURCE);
  };

  /** The wheel passes to droid-main (it took over a step). */
  const handOverWheel = (reason: string) => commitDriving(handWheel(reason));

  /** droid-new takes the wheel back. */
  const takeWheelBack = (reason = 'droid-new took the wheel back') => commitDriving(takeWheel(reason));

  const dropSuggestion = (id: string): Suggestion | null => {
    const { queue, taken } = takeSuggestion(suggestionsRef.current, id);
    suggestionsRef.current = queue;
    setSuggestions(queue);
    return taken;
  };

  /** droid-new accepts a queued suggestion and applies it (it stays the driver). */
  const acceptSuggestion = (id: string): boolean => {
    const taken = dropSuggestion(id);
    if (!taken) return false;
    log(applyRegulate(taken, depsRef.current.regulate, 'droid-main'), 'warn');
    log(`droid-new accepted droid-main's suggestion "${taken.command}${taken.mode ? ` → ${taken.mode}` : ''}"`, 'info', DRIVING_SOURCE);
    return true;
  };

  /** droid-new dismisses a queued suggestion without applying it. */
  const dismissSuggestion = (id: string): boolean => {
    const taken = dropSuggestion(id);
    if (!taken) return false;
    log(`droid-new dismissed droid-main's suggestion "${taken.command}${taken.mode ? ` → ${taken.mode}` : ''}"`, 'info', DRIVING_SOURCE);
    return true;
  };

  /** Decides which app does a job and logs it, from live health when it is known. */
  const decide = (name: string): JobDecision => {
    const d = depsRef.current;
    const local = localHealth(ASSIST_APP, d.health());
    const caps = capabilitiesFromHealth({ assist: local, main: peerHealthRef.current });
    const next = selectApp({ name, apps: caps }, (source, line) => d.addLog(source, line, 'info'));
    setDecision(next);
    return next;
  };

  /** Adds a browser log line; a new error goes on the agent bus so agents can detect and fix it. */
  const recordLog = (app: LogApp, level: ConsoleLevel, message: string) => {
    const head = browserLogsRef.current[0];
    const next = pushBrowserLog(browserLogsRef.current, { app, level, message, time: Date.now() });
    browserLogsRef.current = next;
    // A repeat only bumps the count silently: re-rendering on it could itself log again (React warnings).
    if (next[0] === head || next[0].count > 1) return;
    setBrowserLogs(next);
    if (app === 'droid-main' && level !== 'info') log(`droid-main console ${level}: ${message}`, 'warn', BROWSER_LOGS_SOURCE);
    if (level === 'error') depsRef.current.forwardElement(ERROR_SENDER[app], { name: `console error (${app}): ${message.slice(0, 120)}`, x: 0.5, y: 0.5 }, NOTE_AGENTS);
  };

  const clearBrowserLogs = () => {
    browserLogsRef.current = [];
    setBrowserLogs([]);
  };

  // droid-new's own console errors and warnings, deferred so a line logged during a render never re-renders inside it.
  // A line logged while a captured line is being recorded (e.g. React warning about that very update) is dropped, never fed back.
  const recordingRef = useRef(false);
  useEffect(() => captureConsole(window, (level, message) => {
    if (recordingRef.current) return;
    setTimeout(() => {
      recordingRef.current = true;
      try {
        recordLog(ASSIST_APP, level, message);
      } finally {
        recordingRef.current = false;
      }
    }, 0);
  }), []);

  /** The machinery, with run decisions logged and droid-main's errors kept in the browser logs. */
  const machinery = (): V2Machinery => {
    const m = depsRef.current.machinery;
    return {
      ...m,
      run: (goal, selfTest) => {
        decide(`run workflow${goal ? ` "${goal}"` : ''}`);
        return m.run(goal, selfTest);
      },
      assistError: (message, goal) => {
        recordLog('droid-main', 'error', message);
        return m.assistError(message, goal);
      },
    };
  };

  const peers: PeerHandlers = {
    user_request: (p) => {
      setFlows((list) => pushFlow(list, { time: Date.now(), direction: 'from-main', text: p.text }));
      log(`User request from ${p.from || 'droid-main'}: "${p.text}"`);
      decide(`user request "${p.text}"`);
      void depsRef.current.plan(p.text);
    },
    takeover: (p) => {
      commit(addTakeover(agreementsRef.current, p, Date.now()));
      handOverWheel(`droid-main took over step ${p.index + 1} "${p.step}" — ${p.reason}`);
      log(`droid-main took over step ${p.index + 1} "${p.step}" — ${p.reason}; droid-new stays arbiter`, 'warn', TAKEOVER_SOURCE);
    },
    regulate: (p) => {
      if (isDriving(drivingRef.current, 'droid-main')) {
        log(applyRegulate(p, depsRef.current.regulate, 'droid-main'), 'warn');
        return;
      }
      // droid-new is driving: a simultaneous command does not take effect, it becomes a queued suggestion.
      const queued = enqueueSuggestion(suggestionsRef.current, p.command, p.mode, p.reason ?? '');
      suggestionsRef.current = queued;
      setSuggestions(queued);
      log(suggestionLine(queued[0]), 'warn', DRIVING_SOURCE);
    },
    step_opinion: (p) => {
      commit(addRemoteOpinion(agreementsRef.current, p, Date.now()));
      if (p.element) depsRef.current.forwardElement('mainApp', p.element);
      log(`droid-main agents ${p.agree ? 'agree' : 'disagree'} on step ${p.index + 1} "${p.step}"${p.note ? ` — ${p.note}` : ''}`, p.agree ? 'info' : 'warn', TAKEOVER_SOURCE);
    },
    console_log: (p) => {
      recordLog('droid-main', p.level, fromConsolePayload(p).message);
      if (p.level === 'error') void depsRef.current.machinery.assistError(p.message, undefined);
    },
    app_state: (p: PeerPayloads['app_state']) => setRemote(p),
    store_delta: (p) => {
      const entries = fromPayload(p);
      const applied = applySyncEntries(entries);
      watermarksRef.current = advanceWatermarks(watermarksRef.current, entries);
      saveStoreWatermarks(watermarksRef.current);
      log(mergeLine('droid-main', mergeDelta(loadSyncEntries(), entries)), applied ? 'ok' : 'info', STORE_SYNC_SOURCE);
    },
    ledger_delta: (p) => {
      const entries = p.entries.filter(isLedgerEntry) as LedgerEntry[];
      mergeRemoteLedger(entries);
      log(`Run ledger: merged ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from droid-main`, 'info', LEDGER_SOURCE);
    },
    health: (p) => {
      const h = fromHealthPayload(p);
      peerHealthRef.current = h;
      setPeerHealth(h);
      log(healthLine(h), 'info', HEALTH_SOURCE);
    },
    approval_decision: (p) => {
      depsRef.current.decideApproval(p.id, p.decision, p.text);
      log(`Approval ${p.id} ${p.decision} on ${p.by} — applied here too`, 'ok', BRIDGE_V2_SOURCE);
      ledgerAdd('approval', `approval ${p.id} ${p.decision} (answered on ${p.by})`, undefined, p.decision !== 'rejected');
    },
    resume: (p) => {
      const snap = fromResumePayload(p);
      if (!isResumable(snap)) { log(`Resume ignored — run "${p.goal}" is not resumable`, 'warn', RESUME_SOURCE); return; }
      const plan = resumePlan(snap, 0);
      depsRef.current.onResume(plan);
      log(plan.summary, 'ok', RESUME_SOURCE);
      ledgerAdd('note', `resumed from droid-main: ${plan.summary}`);
    },
  } satisfies PeerHandlers;

  /** One inbound message: a v2 request is answered with a result; true when it was v2. */
  const onMessage = (m: InboundMessage): boolean =>
    routeV2(m, { machinery: machinery(), peers, reply: (result, replyTo) => void send('result', result, replyTo) });

  // Agreements follow the run; a new plan starts them afresh.
  const planKey = deps.steps.map((s) => s.id).join('|');
  const statusKey = deps.steps.map((s) => s.status).join('|');
  const disputedKey = deps.disputedElements.join('|');
  useEffect(() => {
    const d = depsRef.current;
    const fresh = planKeyRef.current !== planKey;
    if (fresh) doneRef.current = new Set();
    planKeyRef.current = planKey;
    commit(syncAgreements(fresh ? [] : agreementsRef.current, d.steps, Date.now(), (s) => !!s.target && d.disputedElements.some((e) => sameElement(e, s.target!))));
    // Re-synced whenever the plan or a step's status changes; everything else is read through refs.
  }, [planKey, statusKey, disputedKey]);

  /** Runs `fn` once per plan for `key`. */
  const once = (key: string, fn: () => void) => {
    if (doneRef.current.has(key)) return;
    doneRef.current.add(key);
    fn();
  };

  /** Background agent-to-agent talk per step, the arbiter on disagreements and the completion line. */
  const reactTo = (a: StepAgreement, connected: boolean) => {
    const state = agreementState(a);
    if (a.local !== undefined && connected) once(`opinion:${a.index}:${a.local}`, () => void send('step_opinion', { index: a.index, step: a.step, agree: a.local === true }));
    if (state === 'disagreement') once(`arbiter:${a.index}`, () => {
      const ruling = arbitrate(a);
      depsRef.current.arbitrate(a.step, ruling.text, ruling.complete);
      ledgerAdd('verdict', `droid-new arbitrated step ${a.index + 1} "${a.step}": ${ruling.text}`, a.index, ruling.complete);
    });
    if (state === 'complete') once(`complete:${a.index}`, () => {
      log(`Step ${a.index + 1} "${a.step}" complete — droid-new verified it and both apps' agents agree`, 'ok', TAKEOVER_SOURCE);
      ledgerAdd('verdict', `step ${a.index + 1} "${a.step}" complete — verified, both agents agree`, a.index, true);
      if (drivingRef.current.driver !== 'droid-new') takeWheelBack(`step ${a.index + 1} "${a.step}" completed`);
    });
  };

  useEffect(() => {
    agreements.forEach((a) => reactTo(a, deps.connected));
    // Reacts to each new agreement state (and to a reconnect, for opinions not yet sent).
  }, [agreements, deps.connected]);

  /** Hands the first step to droid-main with its full context when it is still not complete. */
  const handOff = () => {
    const d = depsRef.current;
    const a = agreementsRef.current.find((x) => x.index === 0);
    if (!a || !shouldHandOff(a, Date.now())) return;
    const reason = handOffReason(a);
    const lines = d.recentLog().slice(0, 40).reverse().map((l) => `[${l.source}] ${l.message}`);
    const payload = takeoverPayload(d.goal(), d.steps.map((s) => s.name), a, lines, reason);
    void send('takeover', payload).then((r) => {
      if (r.ok) {
        commit(agreementsRef.current.map((x) => (x.index === 0 ? { ...x, owner: 'main' as const } : x)));
        handOverWheel(`droid-main took over step 1 "${a.step}" — ${reason}`);
      }
      log(r.ok ? `Handed step 1 "${a.step}" to droid-main — ${reason}` : `Could not hand step 1 "${a.step}" to droid-main — ${r.message}`, r.ok ? 'warn' : 'error', TAKEOVER_SOURCE);
      if (r.ok) ledgerAdd('handoff', `handed step 1 "${a.step}" to droid-main — ${reason}`, 0);
    });
  };

  const first = agreements.find((a) => a.index === 0);
  const firstOpen = !!first && first.owner === 'assist' && agreementState(first) !== 'complete';
  useEffect(() => {
    if (!first || !firstOpen) return undefined;
    const timer = setTimeout(handOff, Math.max(0, TAKEOVER_MS - (Date.now() - first.startedAt)));
    return () => clearTimeout(timer);
    // One timer per first step while it is open; handOff re-checks the latest agreement.
  }, [first?.startedAt, firstOpen]);

  /** One swarm round over both apps' readings; `announce` logs it. */
  const runSwarm = (announce = true): SwarmRound => {
    const d = depsRef.current;
    roundRef.current += 1;
    const readings = [{ source: 'assist' as const, elements: d.knownElements }, { source: 'main' as const, elements: mainElements(d.bus) }];
    const next = runSwarmRound(roundRef.current, buildCrew(d.crewSize), readings);
    setRound(next);
    if (announce) log(roundLine(next), conflicts(next).length ? 'warn' : 'info', SWARM_SOURCE);
    return next;
  };

  // The swarm re-reads whenever either app's known elements change.
  const elementsKey = (list: readonly ForwardedElement[]) => list.map((e) => `${e.name}@${e.x.toFixed(3)},${e.y.toFixed(3)}`).join('|');
  const mainKey = elementsKey(mainElements(deps.bus));
  const knownKey = elementsKey(deps.knownElements);
  useEffect(() => {
    runSwarm(false);
    // Inputs are read through refs; the keys say when they changed.
  }, [knownKey, mainKey, deps.crewSize]);

  /** Dispatches an action against an element the swarm agreed on, after deciding which app performs it. */
  const dispatchSwarm = (element: ForwardedElement) => {
    decide(`act on "${element.name}"`);
    return depsRef.current.act(element);
  };

  // droid-main hears droid-new's live state whenever it changes.
  const busy = busyAgents(round);
  useEffect(() => {
    if (!deps.connected) return;
    void send('app_state', { app: ASSIST_APP, running: deps.running, goal: depsRef.current.goal(), steps: deps.steps.length, activeIndex: deps.activeIndex ?? -1, agentsBusy: busy });
  }, [deps.connected, deps.running, deps.steps.length, deps.activeIndex, busy]);

  /** A user request typed in droid-new flows to droid-main. */
  const sendUserRequest = async (text: string): Promise<boolean> => {
    const t = text.trim();
    if (!t) return false;
    setFlows((list) => pushFlow(list, { time: Date.now(), direction: 'to-main', text: t }));
    decide(`user request "${t}"`);
    const r = await send('user_request', { text: t, from: ASSIST_APP });
    log(r.ok ? `User request sent to droid-main: "${t}"` : `User request not sent to droid-main — ${r.message}`, r.ok ? 'info' : 'warn');
    return r.ok;
  };

  /** droid-main regulates droid-new. */
  const regulateMain = async (command: RegulateCommand, mode?: string): Promise<boolean> => {
    const r = await send('regulate', { command, ...(mode ? { mode } : {}), reason: 'regulated from droid-new' });
    log(r.ok ? `Regulated droid-main: ${command}${mode ? ` → ${mode}` : ''}` : `Could not regulate droid-main — ${r.message}`, r.ok ? 'info' : 'warn');
    return r.ok;
  };

  /** Sends an approval this app just answered to droid-main, so the shared queue agrees on both sides. */
  const sendApprovalDecision = async (id: string, decision: ApprovalDecisionPayload['decision'], text?: string): Promise<boolean> => {
    if (!depsRef.current.connected) return false;
    const r = await send('approval_decision', { id, decision, ...(text ? { text } : {}), by: ASSIST_APP });
    ledgerAdd('approval', `approval ${id} ${decision} (answered here)`, undefined, decision !== 'rejected');
    if (!r.ok) log(`Approval ${id} decision not sent to droid-main — ${r.message}`, 'warn', BRIDGE_V2_SOURCE);
    return r.ok;
  };

  /**
   * Sends droid-main the learned-store entries it has not seen (habits, familiar elements, element
   * maps, access paths, blacklist rules and patterns), then records them as exchanged. Nothing is sent
   * when the stores hold nothing new, so a quiet bridge stays quiet.
   */
  const sendStoreDelta = async (): Promise<number> => {
    if (!depsRef.current.connected) return 0;
    const entries = loadSyncEntries();
    const delta = outgoingDelta(entries, watermarksRef.current);
    if (!delta.length) return 0;
    const r = await send('store_delta', toPayload(delta));
    if (!r.ok) {
      log(`Store sync to droid-main not sent — ${r.message}`, 'warn', STORE_SYNC_SOURCE);
      return 0;
    }
    watermarksRef.current = advanceWatermarks(watermarksRef.current, delta);
    saveStoreWatermarks(watermarksRef.current);
    log(mergeLine('droid-new', mergeDelta([], delta)), 'info', STORE_SYNC_SOURCE);
    return delta.length;
  };

  // Both apps exchange what they have learned when they connect, then keep learning from each other.
  useEffect(() => {
    if (!deps.connected) return undefined;
    void sendStoreDelta();
    const timer = setInterval(() => void sendStoreDelta(), STORE_SYNC_MS);
    return () => clearInterval(timer);
    // Re-syncs on every (re)connect; the stores themselves are read fresh each time.
  }, [deps.connected]);

  /** Sends droid-main the ledger entries it has not seen, so both Assist pages show one timeline. */
  const sendLedgerDelta = async (): Promise<number> => {
    if (!depsRef.current.connected) return 0;
    const delta = ledgerDelta(ledgerRef.current, sentLedgerRef.current);
    if (!delta.length) return 0;
    const r = await send('ledger_delta', { entries: delta });
    if (!r.ok) {
      log(`Run ledger to droid-main not sent — ${r.message}`, 'warn', LEDGER_SOURCE);
      return 0;
    }
    delta.forEach((e) => sentLedgerRef.current.add(e.id));
    return delta.length;
  };

  // The shared ledger crosses the bridge whenever it changes, and on connect for catch-up.
  useEffect(() => {
    if (!deps.connected) return undefined;
    void sendLedgerDelta();
    const timer = setInterval(() => void sendLedgerDelta(), LEDGER_SYNC_MS);
    return () => clearInterval(timer);
  }, [deps.connected, ledger]);

  // This app's health goes out on a cadence, so droid-main picks the executor from facts, not assumptions.
  useEffect(() => {
    if (!deps.connected) return undefined;
    const broadcast = () => void send('health', toHealthPayload(localHealth(ASSIST_APP, depsRef.current.health())));
    broadcast();
    const timer = setInterval(broadcast, HEALTH_MS);
    return () => clearInterval(timer);
  }, [deps.connected]);

  // A run in progress is snapshotted and offered to droid-main, so a restart on either side resumes.
  useEffect(() => {
    if (!deps.connected || !deps.running) return undefined;
    const snap = depsRef.current.snapshot();
    if (!snap || !isResumable(snap)) return undefined;
    snapshotRef.current = snap;
    setSnapshot(snap);
    void send('resume', toResumePayload(snap));
    // Offered when a run starts and whenever the active step moves on.
  }, [deps.connected, deps.running, deps.activeIndex]);

  return {
    onMessage, agreements, coordination: coordinationRows(deps.steps, agreements), flows,
    browserLogs, clearBrowserLogs, remote, swarmRound: round, runSwarm, dispatchSwarm,
    sendUserRequest, regulateMain, sendStoreDelta, sendApprovalDecision, decision,
    driving, suggestions, acceptSuggestion, dismissSuggestion, takeWheelBack,
    ledger, ledgerAdd, ledgerTotals: ledgerTotals(ledger), peerHealth, snapshot,
  };
}

/** The v2 bridge's public surface, for the toolbar and tabs. */
export type BridgeV2 = ReturnType<typeof useBridgeV2>;
