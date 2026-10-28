import { describe, expect, it } from 'vitest';
import { AiError } from './ai.js';
import { parsePlayTurn } from './play-turn.js';

const reply = (body: unknown) => JSON.stringify(body);

describe('parsePlayTurn', () => {
  it('reads elements with position and relevance, the action and the portfolio notes', () => {
    const turn = parsePlayTurn(reply({ elements: [{ name: 'Lever', x: 0.25, y: 0.75, relevance: 0.8 }, { name: '', x: 0.1, y: 0.1, relevance: 1 }], action: { kind: 'drag', x: 0.1, y: 0.2, endX: 0.6, endY: 0.7 }, did: 'Pulled the lever', learned: 'Levers open gates', achieved: '' }), 'hmm');
    expect(turn.elements).toEqual([{ name: 'Lever', x: 0.25, y: 0.75, relevance: 0.8 }]);
    expect(turn.action).toEqual({ kind: 'drag', x: 0.1, y: 0.2, endX: 0.6, endY: 0.7 });
    expect(turn).toMatchObject({ did: 'Pulled the lever', learned: 'Levers open gates', achieved: '', thinking: 'hmm' });
  });

  it('reads scroll direction, key combo and typed text; wait or no action is null', () => {
    expect(parsePlayTurn(reply({ action: { kind: 'scroll', x: 0.5, y: 0.5, direction: 'up' } }), null).action).toEqual({ kind: 'scroll', x: 0.5, y: 0.5, deltaY: -1 });
    expect(parsePlayTurn(reply({ action: { kind: 'key', combo: 'space' } }), null).action).toEqual({ kind: 'key', combo: 'space' });
    expect(parsePlayTurn(reply({ action: { kind: 'type', text: 'gg' } }), null).action).toEqual({ kind: 'type', text: 'gg' });
    expect(parsePlayTurn(reply({ action: { kind: 'wait' } }), null).action).toBeNull();
    expect(parsePlayTurn(reply({}), null)).toMatchObject({ elements: [], action: null });
  });

  it('rejects an unknown action kind instead of guessing', () => {
    expect(() => parsePlayTurn(reply({ action: { kind: 'teleport' } }), null)).toThrow(AiError);
  });
});
