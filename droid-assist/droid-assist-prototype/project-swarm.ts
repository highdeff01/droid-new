import type { ForwardedElement } from './agent-bus.js';
import { sameElement } from './agent-bus.js';
import { AGREE_DISTANCE } from './cross-reference.js';
import type { CrewAgent } from './crew.js';

/** One swarm agent's slice of droid-main's project: a cell of the mirrored frame, normalized 0..1. */
export interface SwarmArea {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where a reading came from: droid-new's own knowledge or droid-main's bridge-fetched state. */
export type SwarmSource = 'assist' | 'main';

/** Elements one source knows, as read off the frame and the app state. */
export interface SourceReading {
  source: SwarmSource;
  elements: readonly ForwardedElement[];
}

/** One agent's task this round. */
export interface SwarmTask {
  agentId: string;
  area: SwarmArea;
}

/** One element an agent found in its area. */
export interface SwarmFinding {
  agentId: string;
  source: SwarmSource;
  element: ForwardedElement;
}

/** A cross-referenced element: consensus when every reading lies within AGREE_DISTANCE, else conflict. */
export interface SwarmConsensus {
  element: ForwardedElement;
  agents: string[];
  sources: SwarmSource[];
  spread: number;
  status: 'consensus' | 'conflict';
}

/** One swarm round: who read what, what was found and what agrees. */
export interface SwarmRound {
  round: number;
  tasks: SwarmTask[];
  findings: SwarmFinding[];
  consensus: SwarmConsensus[];
}

/** A cols×rows grid of areas just big enough for `n` agents. */
export function swarmAreas(n: number): SwarmArea[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return { id: `R${r + 1}C${c + 1}`, x0: c / cols, y0: r / rows, x1: (c + 1) / cols, y1: (r + 1) / rows };
  });
}

/** Every crew agent takes one area (the grid covers the whole frame, so every element is read). */
export function fanOut(crew: readonly CrewAgent[]): SwarmTask[] {
  const areas = swarmAreas(crew.length);
  return areas.map((area, i) => ({ agentId: crew[i % crew.length].id, area }));
}

const inArea = (a: SwarmArea, e: ForwardedElement) => e.x >= a.x0 && e.y >= a.y0 && (e.x < a.x1 || a.x1 === 1) && (e.y < a.y1 || a.y1 === 1);

/** What one agent finds: every source's elements inside its area. */
export const readArea = (task: SwarmTask, readings: readonly SourceReading[]): SwarmFinding[] =>
  readings.flatMap((r) => r.elements.filter((e) => inArea(task.area, e)).map((element) => ({ agentId: task.agentId, source: r.source, element })));

const spreadOf = (list: readonly ForwardedElement[]) => list.reduce((max, a, i) => list.slice(i + 1).reduce((m, b) => Math.max(m, Math.hypot(a.x - b.x, a.y - b.y)), max), 0);
const mean = (list: readonly number[]) => list.reduce((a, b) => a + b, 0) / list.length;
const unique = <T,>(list: readonly T[]) => [...new Set(list)];

/** Groups findings by element and cross-references the readings. */
export function crossReferenceFindings(findings: readonly SwarmFinding[]): SwarmConsensus[] {
  const groups: SwarmFinding[][] = [];
  for (const f of findings) {
    const group = groups.find((g) => sameElement(g[0].element.name, f.element.name));
    if (group) group.push(f);
    else groups.push([f]);
  }
  return groups.map((g) => {
    const points = g.map((f) => f.element);
    const spread = spreadOf(points);
    return {
      element: { name: g[0].element.name, x: mean(points.map((p) => p.x)), y: mean(points.map((p) => p.y)) },
      agents: unique(g.map((f) => f.agentId)),
      sources: unique(g.map((f) => f.source)),
      spread,
      status: spread <= AGREE_DISTANCE ? 'consensus' : 'conflict',
    };
  });
}

/** One round: fan out, read every area, cross-reference what was found. */
export function runSwarmRound(round: number, crew: readonly CrewAgent[], readings: readonly SourceReading[]): SwarmRound {
  const tasks = fanOut(crew);
  const findings = tasks.flatMap((t) => readArea(t, readings));
  return { round, tasks, findings, consensus: crossReferenceFindings(findings) };
}

/** Elements the swarm agrees on: ready to dispatch actions against. */
export const dispatchable = (round: SwarmRound): ForwardedElement[] => round.consensus.filter((c) => c.status === 'consensus').map((c) => c.element);

/** Elements the swarm disagrees on: go to the resolution center. */
export const conflicts = (round: SwarmRound): SwarmConsensus[] => round.consensus.filter((c) => c.status === 'conflict');

/** The agents that found something this round (busy), for the status tab. */
export const busyAgents = (round: SwarmRound | null): number => (round ? unique(round.findings.map((f) => f.agentId)).length : 0);

/** One summary line of a round for the log. */
export const roundLine = (r: SwarmRound) =>
  `Swarm round ${r.round}: ${r.tasks.length} areas read by ${unique(r.tasks.map((t) => t.agentId)).length} agents — ${r.findings.length} findings, ${dispatchable(r).length} agreed, ${conflicts(r).length} in conflict`;
