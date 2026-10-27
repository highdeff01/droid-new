import { describe, expect, it } from 'vitest';
import { profileLines, profileSuggestions, recordSignal, summarizeProfile, type ProfileEvent } from './user-profile.js';

describe('user profile', () => {
  const build = () => {
    let e: ProfileEvent[] = [];
    e = recordSignal(e, 'command', '/use Notepad', 'write notes', 1);
    e = recordSignal(e, 'command', '/use notepad', 'write notes', 2);
    e = recordSignal(e, 'command', '/move Save', 'write notes', 3);
    e = recordSignal(e, 'saved', 'Morning mail', '', 4);
    e = recordSignal(e, 'correction', 'removed step: click "Ad"', 'write notes', 5);
    e = recordSignal(e, 'correction', 'removed step: click "Ad"', 'write notes', 6);
    return e;
  };

  it('ignores empty signals and keeps the newest first', () => {
    const e = build();
    expect(recordSignal(e, 'command', '  ', '')).toBe(e);
    expect(e[0].time).toBe(6);
  });

  it('summarises habits from commands, goals from operations and saves, preferences from corrections', () => {
    const s = summarizeProfile(build());
    expect(s.habits).toEqual([{ text: '/use notepad', count: 2 }, { text: '/move Save', count: 1 }]);
    expect(s.goals).toEqual([{ text: 'write notes', count: 3 }, { text: 'Morning mail', count: 1 }]);
    expect(s.preferences).toEqual(['removed step: click "Ad"']);
  });

  it('feeds planning lines and suggestions that skip the current goal', () => {
    const s = summarizeProfile(build());
    const lines = profileLines(s);
    expect(lines).toContain('[User habit] /use notepad (×2)');
    expect(lines).toContain('[User goal] write notes (×3)');
    expect(lines).toContain('[User preference] removed step: click "Ad"');
    const tips = profileSuggestions(s, 'Write Notes');
    expect(tips.some((t) => t.includes('write notes'))).toBe(false);
    expect(tips.some((t) => t.includes('Morning mail'))).toBe(true);
    expect(tips.some((t) => t.includes('/use notepad'))).toBe(true);
  });
});
