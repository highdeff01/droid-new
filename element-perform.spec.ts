import { describe, expect, it } from 'vitest';
import type { Frame, WorkflowStep } from './types.js';
import type { MappedElement, PerformFn } from './element-map-studio.js';
import { checkPerform, navigateStep, parsePerformProposal, performRequest, performText, resolveMappedStep, setPerform } from './element-perform.js';

const el = (id: string, name: string, x: number, y: number, perform?: PerformFn): MappedElement => ({ id, name, box: { x, y, w: 0.1, h: 0.1 }, mappedAt: 1, ...(perform ? { perform } : {}) });
const frame = { id: 1, time: 1, url: 'data:image/jpeg;base64,AA', data: {} as ImageData, srcW: 1920, srcH: 1080, source: 'demo' } as Frame;
const isStep = (s: WorkflowStep | { error: string }): s is WorkflowStep => !('error' in s);

describe('perform functions', () => {
  it('requires text for type and a drop point or element for drag', () => {
    expect(checkPerform({ kind: 'click', source: 'user' }).ok).toBe(true);
    expect(checkPerform({ kind: 'double_click', source: 'ai' }).ok).toBe(true);
    expect(checkPerform({ kind: 'type', text: '  ', source: 'user' }).ok).toBe(false);
    expect(checkPerform({ kind: 'type', text: 'hi', source: 'user' }).ok).toBe(true);
    expect(checkPerform({ kind: 'drag', source: 'user' }).ok).toBe(false);
    expect(checkPerform({ kind: 'drag', to: { x: 1.2, y: 0.5 }, source: 'user' }).ok).toBe(false);
    expect(checkPerform({ kind: 'drag', to: { x: 0.2, y: 0.5 }, source: 'user' }).ok).toBe(true);
    expect(checkPerform({ kind: 'drag', toElementId: 'b', source: 'user' }).ok).toBe(true);
  });

  it('sets, clears and refuses incomplete perform functions', () => {
    const list = [el('a', 'Save', 0.1, 0.1), el('b', 'Bin', 0.5, 0.5)];
    const set = setPerform(list, 'a', { kind: 'double_click', source: 'user' });
    expect(set[0].perform).toEqual({ kind: 'double_click', source: 'user' });
    expect(set[1]).toBe(list[1]);
    expect(setPerform(set, 'a', null)[0].perform).toBeUndefined();
    expect(setPerform(list, 'a', { kind: 'type', source: 'user' })).toBe(list);
  });

  it('describes each perform kind', () => {
    const map = [el('b', 'Bin', 0.5, 0.5)];
    expect(performText({ kind: 'click', source: 'user' })).toBe('click');
    expect(performText({ kind: 'double_click', source: 'user' })).toBe('double click');
    expect(performText({ kind: 'type', text: 'hi', source: 'user' })).toBe('type "hi"');
    expect(performText({ kind: 'drag', toElementId: 'b', source: 'user' }, map)).toBe('drag to "Bin"');
    expect(performText({ kind: 'drag', to: { x: 0.5, y: 0.25 }, source: 'user' })).toBe('drag to (50.0%, 25.0%)');
  });

  it('builds an auto-navigate step aimed at the element centre with its perform', () => {
    const bin = el('b', 'Bin', 0.6, 0.6);
    expect(navigateStep(el('a', 'Plain', 0.1, 0.1), [])).toHaveProperty('error');
    const typed = navigateStep(el('a', 'Search', 0.2, 0.3, { kind: 'type', text: 'cats', source: 'user' }), [], 'n1');
    expect(typed).toMatchObject({ id: 'n1', action: 'type', text: 'cats', target: 'Search', mappedId: 'a', status: 'pending' });
    expect(isStep(typed) && typed.x).toBeCloseTo(0.25);
    expect(isStep(typed) && typed.y).toBeCloseTo(0.35);
    const file = el('f', 'File', 0.1, 0.1, { kind: 'drag', toElementId: 'b', source: 'ai' });
    const drag = navigateStep(file, [file, bin]);
    expect(drag).toMatchObject({ action: 'drag', endTarget: 'Bin' });
    expect(isStep(drag) && drag.endX).toBeCloseTo(0.65);
    expect(navigateStep(file, [file])).toEqual({ error: 'the drop element of "File" is no longer mapped' });
  });

  it('re-aims a mapped step at where the element is now, and fails when it is gone', () => {
    const plain: WorkflowStep = { id: 's', name: 'Click', action: 'click', x: 0.5, y: 0.5, status: 'pending' };
    expect(resolveMappedStep(plain, [])).toBe(plain);
    const btn = el('a', 'Play', 0.1, 0.1, { kind: 'click', source: 'user' });
    const step = navigateStep(btn, [btn], 'n1') as WorkflowStep;
    const moved = { ...btn, box: { x: 0.7, y: 0.4, w: 0.1, h: 0.1 } };
    const now = resolveMappedStep({ ...step, name: 'Go play' }, [moved]);
    expect(now).toMatchObject({ id: 'n1', name: 'Go play', action: 'click', mappedId: 'a' });
    expect(isStep(now) && now.x).toBeCloseTo(0.75);
    expect(isStep(now) && now.y).toBeCloseTo(0.45);
    expect(resolveMappedStep(step, [])).toHaveProperty('error');
    expect(resolveMappedStep(step, [{ ...btn, perform: undefined }])).toHaveProperty('error');
  });

  it('parses the AI perform proposal and rejects unusable ones', () => {
    const p = parsePerformProposal({ content: '{"kind":"type","text":"abc","reason":"r","train":true}', thinking: 't' });
    expect(p).toEqual({ perform: { kind: 'type', text: 'abc', source: 'ai', reason: 'r' }, train: true, thinking: 't' });
    const d = parsePerformProposal({ content: '{"kind":"drag","toX":0.5,"toY":0.25,"train":false}', thinking: null });
    expect(d.perform).toEqual({ kind: 'drag', to: { x: 0.5, y: 0.25 }, source: 'ai' });
    expect(d.train).toBe(false);
    expect(() => parsePerformProposal({ content: 'no json here', thinking: null })).toThrow();
    expect(() => parsePerformProposal({ content: '{"kind":"type"}', thinking: null })).toThrow();
    expect(() => parsePerformProposal({ content: '{"kind":"hover"}', thinking: null })).toThrow();
  });

  it('asks the AI with the element boundary and its crop', () => {
    const req = performRequest(el('a', 'Files icon', 0.2, 0.4), frame, frame);
    expect(req.prompt).toContain('"Files icon"');
    expect(req.crops).toEqual([frame]);
    expect(req.json).toBe(true);
  });
});
