import { uid } from './planner.js';

/** Every participant of the inter-agent bus: the background agents plus the habit system. */
export type BusAgentId = 'popup' | 'drift' | 'progress' | 'goal' | 'screen' | 'coords' | 'supervisor' | 'habits' | 'sidetest';
/** Every participant of the inter-agent bus: the background agents, the habit system and the main Droid app. */
export type BusAgentId = 'popup' | 'drift' | 'progress' | 'goal' | 'screen' | 'coords' | 'supervisor' | 'habits' | 'mainApp';
export type BusAgentId = 'popup' | 'drift' | 'progress' | 'goal' | 'screen' | 'coords' | 'supervisor' | 'habits' | 'operations';

/** Display name of each bus participant. */
export const BUS_AGENTS: Readonly<Record<BusAgentId, string>> = {
  popup: 'Popup watcher',
  drift: 'Drift monitor',
  progress: 'Progress tracker',
  goal: 'Goal reviewer',
  screen: 'Screen watcher',
  coords: 'Coordinate learner',
  supervisor: 'Supervisor',
  habits: 'Habit system',
  sidetest: 'Side tester',
  mainApp: 'Main app',
  operations: 'Operations agents',
};

/** Every bus participant, in panel order. */
export const BUS_AGENT_IDS = Object.keys(BUS_AGENTS) as BusAgentId[];

/** A discovered or newly-identified on-screen element. Coordinates are its center, normalized 0..1. */
export interface ForwardedElement {
  name: string;
  x: number;
  y: number;
  /** Optional box size around the center, normalized 0..1. */
  w?: number;
  h?: number;
}

/** What the recipient did with a message: still queued, or handled with a note. */
export type MessageStatus = 'queued' | 'handled';

/** One forwarded element in one agent's inbox. */
export interface BusMessage {
  id: string;
  time: number;
  from: BusAgentId;
  to: BusAgentId;
  element: ForwardedElement;
  status: MessageStatus;
  /** What the recipient did with it, once handled. */
  note?: string;
}

/** Most messages kept on the bus (newest first). */
export const BUS_LIMIT = 200;

/** Every participant except the sender: the default fan-out of a forward. */
export const recipientsOf = (from: BusAgentId): BusAgentId[] => BUS_AGENT_IDS.filter((id) => id !== from);

/**
 * Queues `element` from `from` into the inbox of each recipient (by default every other
 * participant), newest first, capped at BUS_LIMIT. Returns the new bus and the queued messages.
 */
export function forward(bus: BusMessage[], from: BusAgentId, element: ForwardedElement, to: BusAgentId[] = recipientsOf(from), time = Date.now()): { bus: BusMessage[]; queued: BusMessage[] } {
  const queued = to.filter((id) => id !== from).map((recipient): BusMessage => ({ id: uid('msg'), time, from, to: recipient, element, status: 'queued' }));
  return { bus: [...queued, ...bus].slice(0, BUS_LIMIT), queued };
}

/** One agent's inbox, newest first. */
export const inbox = (bus: BusMessage[], agent: BusAgentId): BusMessage[] => bus.filter((m) => m.to === agent);

/** Marks one message handled with what its recipient did. */
export const markHandled = (bus: BusMessage[], id: string, note: string): BusMessage[] => bus.map((m) => (m.id === id ? { ...m, status: 'handled', note } : m));

/** True when two element names refer to the same thing (case and spacing insensitive). */
export const sameElement = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

/** Most predefined elements kept. */
export const ELEMENT_LIMIT = 100;

/** Records `element` as predefined knowledge, replacing an earlier entry with the same name; newest first. */
export function predefine(known: ForwardedElement[], element: ForwardedElement): ForwardedElement[] {
  return [element, ...known.filter((k) => !sameElement(k.name, element.name))].slice(0, ELEMENT_LIMIT);
}

/** A predefined element as one planning-context line. */
export const elementLine = (e: ForwardedElement) => `[Known element] "${e.name}" at x=${e.x.toFixed(3)}, y=${e.y.toFixed(3)}`;
