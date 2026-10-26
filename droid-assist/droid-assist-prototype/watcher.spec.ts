import { describe, expect, it, vi } from 'vitest';
import { AiError } from './ai.js';
import type { AskFn } from './ai.js';
import type { Frame, WorkflowStep } from './types.js';
import {
  NOTE_LIMIT,
  TEST_LIMIT,
  WATCH_SYSTEM,
  addTest,
  mergeNotes,
  mergeProposals,
  observeScreen,
  patchProposal,
  proposalStep,
  reorderSteps,
} from './watcher.js';
import type { NoteDraft, NoteKind, ProposalDraft, ProposalKind, WatchNote, WatchProposal, WatchTest } from './watcher.js';

const frame = { id: 1, url: 'data:image/jpeg;base64,QUJD' } as Frame;
const step = (id: string, status: WorkflowStep['status'] = 'pending'): WorkflowStep => ({ id, name: `Step ${id}`, action: 'click', x: 0.2, y: 0.3, status });
const ask = (content: string, thinking: string | null = null) => vi.fn<AskFn>(async () => ({ content, thinking }));

describe('observeScreen', () => {
  it('sends the watch system prompt, the frame and json:true, and returns the thinking', async () => {
    const fn = ask('{"notes":[],"proposals":[]}', 'looked around the screen');
    const result = await observeScreen(fn, frame, [], [], 'Open settings');
    expect(fn.mock.calls[0][0]).toMatchObject({ system: WATCH_SYSTEM, frame, json: true });
    expect(result.thinking).toBe('looked around the screen');
  });

  it('keeps valid notes and drops notes with an unknown kind or blank text', async () => {
    const fn = ask(JSON.stringify({
      notes: [
        { kind: 'element', text: 'Files sidebar item' },
        { kind: 'bogus', text: 'should be dropped' },
        { kind: 'change', text: '   ' },
      ],
      proposals: [],
    }));
    const { notes } = await observeScreen(fn, frame, [], [], 'goal');
    expect(notes).toEqual([{ kind: 'element', text: 'Files sidebar item' }]);
  });

  it('keeps close_popup and familiar proposals with a target and a cell, resolving to a point on screen', async () => {
    const fn = ask(JSON.stringify({
      notes: [],
      proposals: [
        { kind: 'close_popup', text: 'This popup keeps returning', target: 'Close button', cell: 'B3', cx: 0.5, cy: 0.5 },
        { kind: 'familiar', text: 'Files sidebar is stable', target: 'Files icon', cell: 'D7', cx: 0.5, cy: 0.5 },
      ],
    }));
    const { proposals } = await observeScreen(fn, frame, [], [], 'goal');
    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(p.target).toBeTruthy();
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('keeps a pattern proposal with only text', async () => {
    const fn = ask(JSON.stringify({ notes: [], proposals: [{ kind: 'pattern', text: 'avoid clicking the taskbar first' }] }));
    const { proposals } = await observeScreen(fn, frame, [], [], 'goal');
    expect(proposals).toEqual([{ kind: 'pattern', text: 'avoid clicking the taskbar first' }]);
  });

  it('keeps a reorder proposal with a positive, distinct integer from/to and drops malformed ones', async () => {
    const fn = ask(JSON.stringify({
      notes: [],
      proposals: [
        { kind: 'reorder', text: 'reorder steps', from: 2, to: 4 },
        { kind: 'reorder', text: 'same position', from: 3, to: 3 },
        { kind: 'reorder', text: 'negative', from: -1, to: 2 },
        { kind: 'reorder', text: 'not an integer', from: 1.5, to: 2 },
      ],
    }));
    const { proposals } = await observeScreen(fn, frame, [], [], 'goal');
    expect(proposals).toEqual([{ kind: 'reorder', text: 'reorder steps', from: 2, to: 4 }]);
  });

  it('rejects a non-JSON reply instead of inventing an observation', async () => {
    await expect(observeScreen(ask('sure, I looked at the screen'), frame, [], [], 'goal')).rejects.toBeInstanceOf(AiError);
  });
});

describe('mergeNotes', () => {
  const noteDraft = (text: string, kind: NoteKind = 'element'): NoteDraft => ({ kind, text });

  it('collapses three identical drafts across separate calls into one note', () => {
    let notes: WatchNote[] = [];
    for (let i = 0; i < 3; i++) {
      ({ notes } = mergeNotes(notes, [noteDraft('Files sidebar visible')]));
    }
    expect(notes).toHaveLength(1);
  });

  it('keeps A, B, A across three calls as two notes', () => {
    let notes: WatchNote[] = [];
    for (const text of ['A note', 'B note', 'A note']) {
      ({ notes } = mergeNotes(notes, [noteDraft(text)]));
    }
    expect(notes.map((n) => n.text)).toEqual(['B note', 'A note']);
  });

  it('dedups case- and punctuation-insensitively', () => {
    const { notes: first } = mergeNotes([], [noteDraft('Files Sidebar, visible!')]);
    const { notes: second, added } = mergeNotes(first, [noteDraft('files sidebar visible')]);
    expect(second).toHaveLength(1);
    expect(added).toEqual([]);
  });

  it('keeps the same text when it is a different kind of note', () => {
    const { notes: first } = mergeNotes([], [noteDraft('stable position', 'element')]);
    const { notes: second } = mergeNotes(first, [noteDraft('stable position', 'opportunity')]);
    expect(second).toHaveLength(2);
  });

  it('`added` lists only the notes actually added', () => {
    const { notes: first } = mergeNotes([], [noteDraft('A'), noteDraft('B')]);
    const { added } = mergeNotes(first, [noteDraft('A'), noteDraft('C')]);
    expect(added.map((n) => n.text)).toEqual(['C']);
  });

  it('caps the merged list at NOTE_LIMIT', () => {
    const drafts = Array.from({ length: NOTE_LIMIT + 10 }, (_, i) => noteDraft(`note ${i}`));
    const { notes } = mergeNotes([], drafts);
    expect(notes).toHaveLength(NOTE_LIMIT);
  });
});

describe('mergeProposals', () => {
  const proposalDraft = (text: string, kind: ProposalKind = 'pattern'): ProposalDraft => ({ kind, text });

  it('does not add an identical pending proposal twice', () => {
    const { proposals: first } = mergeProposals([], [proposalDraft('avoid clicking fast')]);
    const { proposals: second, added } = mergeProposals(first, [proposalDraft('avoid clicking fast')]);
    expect(second).toHaveLength(1);
    expect(added).toEqual([]);
  });

  it('proposes the same draft again once the pending one has been dismissed', () => {
    const { proposals: first } = mergeProposals([], [proposalDraft('avoid clicking fast')]);
    const dismissed = patchProposal(first, first[0].id, { status: 'dismissed' });
    const { proposals: second, added } = mergeProposals(dismissed, [proposalDraft('avoid clicking fast')]);
    expect(added).toHaveLength(1);
    expect(second).toHaveLength(2);
  });
});

describe('reorderSteps', () => {
  describe('proposalStep', () => {
    it('returns a click step with the target and point for a testable proposal', () => {
      const p: WatchProposal = { id: 'p1', time: 1, kind: 'close_popup', text: 'close it', target: 'Close button', x: 0.4, y: 0.6, status: 'pending' };
      const s = proposalStep(p);
      expect(s).toMatchObject({ action: 'click', target: 'Close button', x: 0.4, y: 0.6 });
    });

    it('returns null for proposals with no on-screen point (pattern, reorder)', () => {
      const pattern: WatchProposal = { id: 'p2', time: 1, kind: 'pattern', text: 'avoid x', status: 'pending' };
      const reorder: WatchProposal = { id: 'p3', time: 1, kind: 'reorder', text: 'reorder', from: 1, to: 2, status: 'pending' };
      expect(proposalStep(pattern)).toBeNull();
      expect(proposalStep(reorder)).toBeNull();
    });
  });

  describe('reorderSteps', () => {
    it('moves step 3 to position 1', () => {
      const steps = [step('a'), step('b'), step('c')];
      const reordered = reorderSteps(steps, 3, 1);
      expect(reordered?.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    });

    it('returns null when from or to is out of range', () => {
      const steps = [step('a'), step('b')];
      expect(reorderSteps(steps, 0, 1)).toBeNull();
      expect(reorderSteps(steps, 1, 3)).toBeNull();
    });
  });

  describe('addTest', () => {
    it('prepends a test with a fresh id and time, capped at TEST_LIMIT', () => {
      const base: WatchTest[] = Array.from({ length: TEST_LIMIT }, (_, i) => ({ id: `t${i}`, time: i, proposalId: 'p', tried: 'click', happened: 'nothing', verdict: 'passed', dryRun: true }));
      const next = addTest(base, { proposalId: 'p1', tried: 'clicked the close button', happened: 'popup closed', verdict: 'passed', dryRun: true }, 999);
      expect(next).toHaveLength(TEST_LIMIT);
      expect(next[0]).toMatchObject({ time: 999, proposalId: 'p1' });
      expect(next[0].id).toBeTruthy();
    });
  });
});
