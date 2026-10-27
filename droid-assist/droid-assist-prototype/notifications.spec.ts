import { describe, expect, it } from 'vitest';
import type { AskFn } from './ai.js';
import type { RunSummary } from './run-stats.js';
import {
  ACTION_KINDS,
  CATEGORY_IDS,
  DEFAULT_AUTO_ACT,
  NOTIFICATION_LIMIT,
  NOTIFY_DEDUPE_MS,
  actionStep,
  addNotification,
  diskSuggestion,
  dimmed,
  habitSuggestions,
  isNotification,
  parseAction,
  parseSuggestions,
  sanitizeAutoAct,
  suggestWithAi,
  type AssistNotification,
  type NotificationDraft,
} from './notifications.js';

const draft = (over: Partial<NotificationDraft> = {}): NotificationDraft => ({
  source: 'AI', category: 'ai', severity: 'info', title: 'AI ready', ...over,
});

describe('addNotification', () => {
  it('adds a notification at the top, unread, with a generated id and the given time', () => {
    const { list, added } = addNotification([], draft(), 1000);
    expect(added).toMatchObject({ time: 1000, read: false, source: 'AI', category: 'ai', severity: 'info', title: 'AI ready' });
    expect(typeof added!.id).toBe('string');
    expect(list).toEqual([added]);
  });

  it('puts a new notification ahead of existing ones', () => {
    const { list: first } = addNotification([], draft({ title: 'First' }), 1000);
    const { list, added } = addNotification(first, draft({ title: 'Second' }), 2000);
    expect(list[0]).toBe(added);
    expect(list[1].title).toBe('First');
  });

  it('drops a same category and title raised again within the dedupe window', () => {
    const { list: first } = addNotification([], draft(), 1000);
    const { list, added } = addNotification(first, draft(), 1000 + NOTIFY_DEDUPE_MS - 1);
    expect(added).toBeNull();
    expect(list).toBe(first);
  });

  it('accepts the same category and title again once the dedupe window has passed', () => {
    const { list: first } = addNotification([], draft(), 1000);
    const { list, added } = addNotification(first, draft(), 1000 + NOTIFY_DEDUPE_MS);
    expect(added).not.toBeNull();
    expect(list).toHaveLength(2);
  });

  it('does not dedupe the same category with a different title', () => {
    const { list: first } = addNotification([], draft({ title: 'First' }), 1000);
    const { list, added } = addNotification(first, draft({ title: 'Second' }), 1000);
    expect(added).not.toBeNull();
    expect(list).toHaveLength(2);
  });

  it('prunes the oldest notifications beyond NOTIFICATION_LIMIT', () => {
    let list: AssistNotification[] = [];
    for (let i = 0; i < NOTIFICATION_LIMIT + 5; i++) {
      list = addNotification(list, draft({ title: `Event ${i}` }), 1000 + i * NOTIFY_DEDUPE_MS).list;
    }
    expect(list).toHaveLength(NOTIFICATION_LIMIT);
    expect(list[0].title).toBe(`Event ${NOTIFICATION_LIMIT + 4}`);
  });
});

describe('sanitizeAutoAct', () => {
  it('has every category present and off by default', () => {
    expect(CATEGORY_IDS.every((c) => DEFAULT_AUTO_ACT[c] === false)).toBe(true);
  });

  it('keeps only the categories literally set to true', () => {
    const v = sanitizeAutoAct({ ai: true, bridge: 'true', goal: 1 });
    expect(v.ai).toBe(true);
    expect(v.bridge).toBe(false);
    expect(v.goal).toBe(false);
    expect(CATEGORY_IDS.every((c) => c in v)).toBe(true);
  });

  it('turns garbage input into every category off', () => {
    expect(sanitizeAutoAct('garbage')).toEqual(DEFAULT_AUTO_ACT);
    expect(sanitizeAutoAct(null)).toEqual(DEFAULT_AUTO_ACT);
    expect(sanitizeAutoAct([1, 2, 3])).toEqual(DEFAULT_AUTO_ACT);
  });
});

describe('dimmed', () => {
  const n = (over: Partial<AssistNotification> = {}): AssistNotification => ({
    id: 'n1', time: 0, source: 'AI', category: 'ai', severity: 'info', title: 'x', read: false, ...over,
  });

  it('dims an info notification in relaxation mode', () => {
    expect(dimmed(n(), true)).toBe(true);
  });

  it('does not dim outside relaxation mode', () => {
    expect(dimmed(n(), false)).toBe(false);
  });

  it('does not dim a non-info severity', () => {
    expect(dimmed(n({ severity: 'warning' }), true)).toBe(false);
  });

  it('does not dim a break reminder', () => {
    expect(dimmed(n({ category: 'relax' }), true)).toBe(false);
  });
});

describe('actionStep', () => {
  it('maps an open_app action to a step whose action is open_app and text is the app name', () => {
    const step = actionStep({ kind: 'open_app', text: 'Chrome' });
    expect(step.action).toBe('open_app');
    expect(step.text).toBe('Chrome');
  });

  it.each(ACTION_KINDS.filter((k) => k !== 'open_app'))('maps a %s action to the same action kind', (kind) => {
    const step = actionStep({ kind, text: 'payload' });
    expect(step.action).toBe(kind);
    expect(step.text).toBe('payload');
  });
});

describe('parseAction', () => {
  it('rejects an unknown action kind', () => {
    expect(parseAction({ kind: 'delete', text: 'x' })).toBeUndefined();
  });

  it('rejects empty text', () => {
    expect(parseAction({ kind: 'open_app', text: '   ' })).toBeUndefined();
  });

  it('parses a valid action', () => {
    expect(parseAction({ kind: 'key', text: 'Ctrl+S' })).toEqual({ kind: 'key', text: 'Ctrl+S' });
  });
});

describe('isNotification', () => {
  const valid: AssistNotification = { id: 'n1', time: 1, source: 'AI', category: 'ai', severity: 'info', title: 'x', read: false };

  it('accepts a valid notification', () => {
    expect(isNotification(valid)).toBe(true);
  });

  it('rejects a bad severity', () => {
    expect(isNotification({ ...valid, severity: 'urgent' })).toBe(false);
  });

  it('rejects a bad category', () => {
    expect(isNotification({ ...valid, category: 'network' })).toBe(false);
  });

  it('rejects a bad acted state', () => {
    expect(isNotification({ ...valid, acted: 'maybe' })).toBe(false);
  });
});

describe('habitSuggestions', () => {
  const at = (day: number, hour = 9) => new Date(2024, 0, day, hour, 0).getTime();
  const now = at(10, 9);
  const run = (over: Partial<RunSummary>): RunSummary => ({
    id: `r${Math.random()}`, time: now, session: 's1', goal: 'open YouTube', attempted: 1, succeeded: 1, durationMs: 100, outcome: 'success', ...over,
  });

  it('suggests opening an app run on 3 different days at the current hour', () => {
    const runs = [run({ time: at(1) }), run({ time: at(2) }), run({ time: at(3) })];
    const drafts = habitSuggestions(runs, now);
    expect(drafts).toEqual([{
      source: 'Suggestions', category: 'suggestion', severity: 'info',
      title: 'You usually open YouTube around now', action: { kind: 'open_app', text: 'YouTube' },
    }]);
  });

  it('does not suggest a habit seen on only 2 days', () => {
    const runs = [run({ time: at(1) }), run({ time: at(2) })];
    expect(habitSuggestions(runs, now)).toEqual([]);
  });

  it('ignores failed runs', () => {
    const runs = [run({ time: at(1) }), run({ time: at(2) }), run({ time: at(3), outcome: 'failed' })];
    expect(habitSuggestions(runs, now)).toEqual([]);
  });

  it('ignores runs far from the current hour', () => {
    const runs = [run({ time: at(1) }), run({ time: at(2) }), run({ time: at(3, 14) })];
    expect(habitSuggestions(runs, now)).toEqual([]);
  });

  it('suggests a non-open goal without a proposed action', () => {
    const runs = [run({ goal: 'check email', time: at(1) }), run({ goal: 'check email', time: at(2) }), run({ goal: 'check email', time: at(3) })];
    const drafts = habitSuggestions(runs, now);
    expect(drafts).toEqual([{ source: 'Suggestions', category: 'suggestion', severity: 'info', title: 'You usually run "check email" around now' }]);
  });
});

describe('diskSuggestion', () => {
  it('proposes opening disk cleanup when space is low', () => {
    const d = diskSuggestion(5, 100);
    expect(d.severity).toBe('warning');
    expect(d.title).toContain('% free');
    expect(d.action).toEqual({ kind: 'open_app', text: 'Disk Cleanup' });
  });
});

describe('parseSuggestions', () => {
  it('parses up to 3 suggestion entries from a JSON reply', () => {
    const content = JSON.stringify({ suggestions: [
      { title: 'A', severity: 'warning', action: { kind: 'open_app', text: 'App' } },
      { title: 'B', severity: 'info', action: null },
      { title: 'C', severity: 'critical' },
      { title: 'D', severity: 'info' },
    ] });
    const drafts = parseSuggestions(content);
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.title)).toEqual(['A', 'B', 'C']);
  });

  it('drops an entry with no title', () => {
    const content = JSON.stringify({ suggestions: [{ severity: 'info' }, { title: 'Kept', severity: 'info' }] });
    expect(parseSuggestions(content).map((d) => d.title)).toEqual(['Kept']);
  });

  it('omits an invalid proposed action but keeps the suggestion', () => {
    const content = JSON.stringify({ suggestions: [{ title: 'A', severity: 'info', action: { kind: 'delete', text: 'x' } }] });
    const [d] = parseSuggestions(content);
    expect(d.action).toBeUndefined();
  });

  it('falls back to info for an unknown severity and tags the suggestion category', () => {
    const content = JSON.stringify({ suggestions: [{ title: 'A', severity: 'urgent' }] });
    const [d] = parseSuggestions(content);
    expect(d.severity).toBe('info');
    expect(d.category).toBe('suggestion');
  });
});

describe('suggestWithAi', () => {
  it('returns the suggestions parsed from the model reply', async () => {
    const ask = (async () => ({ content: '{"suggestions":[{"title":"Disk almost full","severity":"warning","action":{"kind":"open_app","text":"Disk Cleanup"}}]}', thinking: null })) as unknown as AskFn;
    const drafts = await suggestWithAi(ask, ['recent: opened Chrome']);
    expect(drafts).toEqual([{ source: 'AI suggestions', category: 'suggestion', severity: 'warning', title: 'Disk almost full', action: { kind: 'open_app', text: 'Disk Cleanup' } }]);
  });
});
