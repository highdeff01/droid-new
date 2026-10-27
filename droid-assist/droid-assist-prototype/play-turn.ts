import { AiError, parseJsonReply, toUnit, type AskFn, type ViewSize, SAMPLE_VIEW } from './ai.js';
import type { Frame } from './types.js';
import type { MirrorEvent } from './mirror-input.js';
import type { Persona } from './persona.js';
import type { ElementReport, Perspective } from './element-relevance.js';

/** One AI play turn as the model answered it: what it sees, the one action it takes, and its portfolio notes. */
export interface PlayTurn {
  elements: ElementReport[];
  /** The action to take through the mirror; null when the model chose to wait. */
  action: MirrorEvent | null;
  did: string;
  learned: string;
  achieved: string;
  thinking: string | null;
}

type Raw = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.parseFloat(String(v)));

/** One reported element; null when it has no name or no numeric position. */
function toElement(raw: unknown, view: ViewSize): ElementReport | null {
  const r = (raw ?? {}) as Raw;
  const name = text(r.name);
  if (!name) return null;
  try {
    const relevance = num(r.relevance);
    return { name, x: toUnit(r.x, view.w), y: toUnit(r.y, view.h), relevance: Number.isFinite(relevance) ? relevance : 0 };
  } catch {
    return null;
  }
}

type ActionOf = (r: Raw, view: ViewSize) => MirrorEvent | null;
const point = (r: Raw, view: ViewSize) => ({ x: toUnit(r.x, view.w), y: toUnit(r.y, view.h) });

/** One reader per action kind the model may answer with. */
const ACTION_OF: Record<string, ActionOf> = {
  click: (r, v) => ({ kind: 'click', ...point(r, v) }),
  double_click: (r, v) => ({ kind: 'double_click', ...point(r, v) }),
  drag: (r, v) => ({ kind: 'drag', ...point(r, v), endX: toUnit(r.endX, v.w), endY: toUnit(r.endY, v.h) }),
  scroll: (r, v) => ({ kind: 'scroll', ...point(r, v), deltaY: text(r.direction) === 'up' ? -1 : 1 }),
  key: (r) => (text(r.combo) ? { kind: 'key', combo: text(r.combo) } : null),
  type: (r) => (text(r.text) ? { kind: 'type', text: String(r.text) } : null),
  wait: () => null,
};

/** The action of a reply; an unknown kind or bad coordinates throws AiError (never a guessed action). */
function toAction(raw: unknown, view: ViewSize): MirrorEvent | null {
  if (raw === null || raw === undefined) return null;
  const r = raw as Raw;
  const read = ACTION_OF[text(r.kind)];
  if (!read) throw new AiError(`AI play turn had an unknown action kind: ${String(r.kind)}`);
  return read(r, view);
}

/** Reads a play-turn reply; pixel coordinates are read in the `view` the screenshot was sent at. */
export function parsePlayTurn(content: string, thinking: string | null, view: ViewSize = SAMPLE_VIEW): PlayTurn {
  const r = parseJsonReply(content);
  const elements = (Array.isArray(r.elements) ? r.elements : []).map((e) => toElement(e, view)).filter((e): e is ElementReport => e !== null);
  return { elements, action: toAction(r.action, view), did: text(r.did), learned: text(r.learned), achieved: text(r.achieved), thinking };
}

/** The persona's recent portfolio as prompt lines. */
const portfolioLines = (p: Persona) => p.entries.slice(0, 8).map((e) => `- ${e.kind}: ${e.text}`).join('\n') || '- (nothing yet)';

/**
 * Asks the model for the persona's next turn: it sees the screen, logs the important elements with
 * position and relevance, and picks ONE action to take through the mirror like a regular person.
 */
export async function askPlayTurn(ask: AskFn, persona: Persona, view: Perspective, goal: string, frame: Frame | null): Promise<PlayTurn> {
  const reply = await ask({
    system: (v) => `You play the character "${persona.name}" on a real PC through a screen mirror, like a regular person with a mouse and keyboard. Character: ${persona.character || 'unspecified'}. Coordinates are fractions 0..1 of the screenshot (${v.w}x${v.h}). Reply ONLY with JSON {"elements":[{"name":string,"x":number,"y":number,"relevance":number}],"action":{"kind":"click"|"double_click"|"drag"|"scroll"|"key"|"type"|"wait","x":number,"y":number,"endX":number,"endY":number,"direction":"up"|"down","combo":string,"text":string},"did":string,"learned":string,"achieved":string} where elements are the important things on screen with relevance 0..1 to what to do next, action is the ONE next input (omit fields it does not use), and learned/achieved are empty strings when nothing new.`,
    prompt: `Goal: ${goal || 'keep playing well'}\nPrevious perspective (turn ${view.turn}): ${view.summary}\nPortfolio so far:\n${portfolioLines(persona)}\n\nWhat do you see, and what is your next move?`,
    frame,
    json: true,
  });
  return parsePlayTurn(reply.content, reply.thinking, reply.view);
}
