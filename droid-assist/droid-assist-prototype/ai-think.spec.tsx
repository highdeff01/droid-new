import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { ThinkingEntry } from './thinking-timeline.js';
import { DEFAULT_SETTINGS } from './use-assist.js';
import { QwenThinkingPanel } from './panels.js';

const entry = (thinking: string | null): ThinkingEntry => ({ id: 't1', time: 1, step: 'Ask: where?', kind: 'thought', text: 'Top bar', thinking });

const panelText = (aiThink: boolean, thinking: string | null) => {
  const engine = { timeline: [entry(thinking)], aiStatus: { state: 'online', detail: '' }, settings: { ...DEFAULT_SETTINGS, aiThink } } as unknown as AssistEngine;
  render(<QwenThinkingPanel engine={engine} />);
  return screen.getAllByRole('region', { name: 'Qwen thinking' }).at(-1)!.textContent ?? '';
};

describe('Qwen thinking panel and the aiThink setting', () => {
  it('says plainly that thinking is disabled in Settings when it is off and none came back', () => {
    const text = panelText(false, null);
    expect(text).toContain('thinking is disabled in Settings');
    expect(text).not.toContain('No thinking returned by the model');
  });

  it('still shows thinking the model returned while the setting is off', () => {
    const text = panelText(false, 'looked at the top bar');
    expect(text).toContain('looked at the top bar');
    expect(text).not.toContain('thinking is disabled in Settings');
  });

  it('with thinking on, shows the returned thinking, or says none was returned', () => {
    expect(panelText(true, 'the search box is at the top')).toContain('the search box is at the top');
    const none = panelText(true, null);
    expect(none).toContain('No thinking returned by the model');
    expect(none).not.toContain('thinking is disabled in Settings');
  });
});
