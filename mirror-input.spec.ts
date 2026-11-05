import { describe, it, expect } from 'vitest';
import { mirrorStep, mirrorMode } from './mirror-input.js';
import { dispatchState } from './safety.js';

describe('mirrorStep', () => {
  it('turns a click into a pending click step at the given point', () => {
    const step = mirrorStep({ kind: 'click', x: 0.3, y: 0.6 }, 'step-1');
    expect(step).toMatchObject({ id: 'step-1', action: 'click', x: 0.3, y: 0.6, status: 'pending' });
  });

  it('turns a double_click into a pending double_click step at the given point', () => {
    const step = mirrorStep({ kind: 'double_click', x: 0.2, y: 0.4 }, 'step-2');
    expect(step).toMatchObject({ id: 'step-2', action: 'double_click', x: 0.2, y: 0.4, status: 'pending' });
  });

  it('turns a drag into a drag step carrying both endpoints', () => {
    const step = mirrorStep({ kind: 'drag', x: 0.1, y: 0.2, endX: 0.8, endY: 0.9 }, 'step-3');
    expect(step).toMatchObject({ id: 'step-3', action: 'drag', x: 0.1, y: 0.2, endX: 0.8, endY: 0.9, status: 'pending' });
  });

  it('clamps out-of-range points to the 0..1 screen', () => {
    const step = mirrorStep({ kind: 'click', x: 1.4, y: -0.2 }, 'step-4');
    expect(step).toMatchObject({ x: 1, y: 0 });
  });

  it('clamps out-of-range drag endpoints too', () => {
    const step = mirrorStep({ kind: 'drag', x: 1.4, y: -0.2, endX: -0.2, endY: 1.4 }, 'step-5');
    expect(step).toMatchObject({ x: 1, y: 0, endX: 0, endY: 1 });
  });

  it('turns a negative-deltaY scroll into an "up" scroll step', () => {
    const step = mirrorStep({ kind: 'scroll', x: 0.5, y: 0.5, deltaY: -10 }, 'step-6');
    expect(step).toMatchObject({ id: 'step-6', action: 'scroll', text: 'up' });
  });

  it('turns a positive-deltaY scroll into a "down" scroll step', () => {
    const step = mirrorStep({ kind: 'scroll', x: 0.5, y: 0.5, deltaY: 10 }, 'step-7');
    expect(step).toMatchObject({ id: 'step-7', action: 'scroll', text: 'down' });
  });

  it('turns a key combo into a key step naming the combo', () => {
    const step = mirrorStep({ kind: 'key', combo: 'ctrl+s' }, 'step-8');
    expect(step).toMatchObject({ id: 'step-8', action: 'key', text: 'ctrl+s' });
  });

  it('turns typed text into a type step carrying the text', () => {
    const step = mirrorStep({ kind: 'type', text: 'hello' }, 'step-9');
    expect(step).toMatchObject({ id: 'step-9', action: 'type', text: 'hello' });
  });
});

describe('mirrorMode', () => {
  const live = dispatchState({ armed: true, bridgeOnline: true, executorOn: true, aborted: false });
  const disarmed = dispatchState({ armed: false, bridgeOnline: true, executorOn: true, aborted: false });
  const aborted = dispatchState({ armed: true, bridgeOnline: true, executorOn: true, aborted: true });

  it('is passive and non-interactive when off, regardless of dispatch state', () => {
    expect(mirrorMode(false, live)).toEqual({ interactive: false, real: false, label: 'Mirror off — passive preview' });
  });

  it('is LIVE and real when on and the dispatch pipeline really reaches the PC', () => {
    expect(mirrorMode(true, live)).toEqual({ interactive: true, real: true, label: 'Mirror LIVE — input goes to the PC' });
  });

  it('is an interactive but non-real dry run when on and disarmed', () => {
    expect(mirrorMode(true, disarmed)).toEqual({ interactive: true, real: false, label: 'Mirror DRY RUN — disarmed — not dispatched' });
  });

  it('labels the dry run with "aborted" when the run was aborted', () => {
    expect(mirrorMode(true, aborted).label).toContain('aborted');
  });
});
