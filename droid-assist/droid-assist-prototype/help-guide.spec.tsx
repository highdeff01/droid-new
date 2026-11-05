import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpGuide } from './help-guide.js';
import { guideFeatureCount } from './guide.js';

afterEach(cleanup);

describe('HelpGuide', () => {
  it('lists every feature by default, with the count in the heading', () => {
    render(<HelpGuide />);
    expect(screen.getByText(new RegExp(`${guideFeatureCount()} features documented`))).toBeTruthy();
    expect(screen.getByText('The live screen')).toBeTruthy();
    expect(screen.getByText('Voice control')).toBeTruthy();
  });

  it('opens a feature walkthrough when its header is clicked', () => {
    render(<HelpGuide />);
    const head = screen.getByText('Voice control').closest('button')!;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Say a command such as/)).toBeTruthy();
  });

  it('filters as you search, and says how many match', () => {
    render(<HelpGuide />);
    fireEvent.change(screen.getByLabelText('Search the user guide'), { target: { value: 'phone' } });
    expect(screen.getByText(/features match/)).toBeTruthy();
    expect(screen.getByText('Phone companion')).toBeTruthy();
    expect(screen.queryByText('Recording a workflow')).toBeNull();
  });

  it('says plainly when nothing matches', () => {
    render(<HelpGuide />);
    fireEvent.change(screen.getByLabelText('Search the user guide'), { target: { value: 'zzzz-nope' } });
    expect(screen.getByText(/No feature matches/)).toBeTruthy();
  });
});
