import { describe, expect, it } from 'vitest';
import { defaultWhy, intentionDraft, intentionText } from './intention.js';
import type { WorkflowStep } from './types.js';

const step = (over: Partial<WorkflowStep>): WorkflowStep => ({ id: 's', name: 'Open files', action: 'click', x: 0.12, y: 0.4, status: 'pending', ...over });

describe('intentionText', () => {
  it('states a click as moving to the target because of the reason', () => {
    expect(intentionText(step({ target: 'files icon' }), 'the files list is needed.')).toBe('Moving to files icon (12%, 40%) to click it because the files list is needed.');
  });

  it('states typing with its text and field', () => {
    expect(intentionText(step({ action: 'type', text: 'report', target: 'search box', x: 0.5, y: 0.1 }), 'we look for the report')).toBe('Typing "report" into search box (50%, 10%) because we look for the report.');
  });

  it('names both ends of a drag and a key repeat count', () => {
    expect(intentionText(step({ action: 'drag', target: 'note', endX: 0.8, endY: 0.2, endTarget: 'Archive' }), 'x')).toMatch(/^Dragging note \(12%, 40%\) to Archive \(80%, 20%\) because x\.$/);
    expect(intentionText(step({ action: 'key', text: 'Backspace', repeat: 3 }), 'y')).toBe('Pressing Backspace ×3 because y.');
  });

  it('falls back to the step name when there is no target', () => {
    expect(intentionText(step({ action: 'double_click' }), 'z')).toBe('Moving to Open files (12%, 40%) to double-click it because z.');
  });
});

describe('defaultWhy', () => {
  it('names the step and the goal, or the plan when no goal is set', () => {
    expect(defaultWhy({ name: 'Open files' }, ' export ')).toBe('it is step "Open files" toward "export"');
    expect(defaultWhy({ name: 'Open files' }, '')).toBe('it is step "Open files" of the plan');
  });
});

describe('intentionDraft', () => {
  it('is an info notification in the AI intentions category; retries name the attempt', () => {
    expect(intentionDraft('Moving to A because b.', 1)).toEqual({ source: 'AI intent', category: 'intent', severity: 'info', title: 'Moving to A because b.' });
    expect(intentionDraft('Moving to A because b.', 2).title).toBe('Moving to A because b. (attempt 2)');
  });
});
