import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { AvoidRule } from './blacklist.js';
import { BlacklistPanel } from './panels.js';

const HOUR = 3600_000;
const rule = (over: Partial<AvoidRule>): AvoidRule => ({
  id: 'r1', action: 'click', target: 'Files icon', x: 0.1, y: 0.2, source: 'habit', reason: 'Click hit nothing interactive',
  strikes: 2, firstAt: Date.now() - 2 * HOUR, lastAt: Date.now() - HOUR, expiresAt: Date.now() + 22 * HOUR, ...over,
});

const mount = (avoidRules: AvoidRule[]) => {
  const invoke = vi.fn(async () => ({ ok: true, result: '' }));
  render(<BlacklistPanel engine={{ avoidRules, invoke } as unknown as AssistEngine} />);
  return { invoke, panel: screen.getByRole('region', { name: 'Blacklist' }) };
};

describe('BlacklistPanel', () => {
  afterEach(cleanup);
  it('lists each rule with its scope, source, status, age and expiry', () => {
    const { panel } = mount([rule({}), rule({ id: 'r2', target: 'Close', source: 'dismissal', strikes: 1, x: null, y: null, expiresAt: Date.now() + 2 * 60_000 })]);
    const items = within(panel).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/click "Files icon" near \(10\.0%, 20\.0%\).*habit · blocking · age 2 h · expires in 22 h/);
    expect(items[1]).toMatch(/click "Close".*dismissal · blocking · age 2 h · expires in 2 min/);
  });

  it('shows a rule below the re-learn threshold as pending', () => {
    const { panel } = mount([rule({ strikes: 1 })]);
    expect(panel.textContent).toContain('pending 1/2');
  });

  it('clears one rule or all of them through the capability registry', () => {
    const { invoke, panel } = mount([rule({})]);
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear blacklist entry click "Files icon" near (10.0%, 20.0%)' }));
    expect(invoke).toHaveBeenCalledWith('blacklist.clear', { id: 'r1' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear all' }));
    expect(invoke).toHaveBeenCalledWith('blacklist.clear', { id: 'all' });
  });

  it('says what blocks when empty and offers no clear-all', () => {
    const { panel } = mount([]);
    expect(within(panel).queryByRole('button', { name: 'Clear all' })).toBeNull();
    expect(panel.textContent).toMatch(/Only repeated fresh failures/);
  });
});
