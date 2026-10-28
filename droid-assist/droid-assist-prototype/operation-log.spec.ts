import { describe, expect, it } from 'vitest';
import { buildOperation, captureDraft, elementDraft, errorDraft, ideaDraft, projectOf, trackDraft } from './operation-log.js';
import type { WorkflowStep } from './types.js';
import type { WatchProposal } from './watcher.js';

const step: WorkflowStep = { id: 's', name: 'Type name', action: 'type', target: 'Name field', text: 'Ada', x: 0.25, y: 0.5, status: 'pending' };

describe('operation write path', () => {
  it('names the project after the loaded flow, else the goal, else a placeholder', () => {
    expect(projectOf('Invoice flow', 'open the invoice')).toBe('Invoice flow');
    expect(projectOf(null, ' open the invoice ')).toBe('open the invoice');
    expect(projectOf(undefined, '')).toBe('(no project)');
  });

  it('records a track operation with the step as input and the real outcome as output', () => {
    const d = trackDraft(step, { ok: false, executed: true, message: 'Field not found', target: { x: 0.3, y: 0.6 } });
    expect(d).toEqual({ category: 'track', op: 'type', element: 'Name field', input: 'type "Name field" with "Ada" at (30.0%, 60.0%)', output: 'Field not found', ok: false });
  });

  it('builds a full record with scope, id and time', () => {
    const r = buildOperation({ project: 'P', agent: 'Element map', section: 'elementMap' }, elementDraft('map', 'OK button', 'box 10,10', 'mapped'), 42);
    expect(r).toMatchObject({ time: 42, project: 'P', agent: 'Element map', section: 'elementMap', category: 'element', op: 'map', element: 'OK button', input: 'box 10,10', output: 'mapped', ok: true });
    expect(r.id).toMatch(/^op_/);
  });

  it('records capture operations and errors with their kind', () => {
    expect(captureDraft('source', 'desktop', 'Bridge unreachable', false)).toEqual({ category: 'capture', op: 'source', input: 'desktop', output: 'Bridge unreachable', ok: false });
    expect(errorDraft({ kind: 'drift', message: 'Drift red', goal: 'g', step: 'Save' })).toEqual({ category: 'error', op: 'drift', errorKind: 'drift', element: 'Save', input: 'g', output: 'Drift red', ok: false });
  });

  it('records an idea event with its proposal as input', () => {
    const p: WatchProposal = { id: 'p', time: 1, kind: 'close_popup', text: 'Close the ad', target: 'Ad close', status: 'pending' };
    expect(ideaDraft('accepted', p, 'Added as a step')).toEqual({ category: 'idea', op: 'accepted', element: 'Ad close', input: 'close_popup: Close the ad', output: 'Added as a step', ok: true });
  });
});
