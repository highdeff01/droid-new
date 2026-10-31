import { describe, expect, it } from 'vitest';
import { buildCrew, CREW_SIZE_DEFAULT } from './crew.js';
import { busyAgents, conflicts, dispatchable, fanOut, roundLine, runSwarmRound, type SourceReading } from './project-swarm.js';

describe('project swarm', () => {
  const crew = buildCrew(CREW_SIZE_DEFAULT);

  it('builds a 25-agent crew', () => {
    expect(crew).toHaveLength(25);
  });

  describe('fanOut', () => {
    const tasks = fanOut(crew);

    it('gives every agent at least one area', () => {
      const covered = new Set(tasks.map((t) => t.agentId));
      crew.forEach((a) => expect(covered.has(a.id)).toBe(true));
    });

    it('covers the whole 0..1 frame (areas sum to one)', () => {
      const total = tasks.reduce((sum, t) => sum + (t.area.x1 - t.area.x0) * (t.area.y1 - t.area.y0), 0);
      expect(total).toBeCloseTo(1);
    });
  });

  describe('runSwarmRound', () => {
    const readings: SourceReading[] = [
      {
        source: 'assist',
        elements: [
          { name: 'OK button', x: 0.5, y: 0.5 },
          { name: 'Save', x: 0.1, y: 0.1 },
          { name: 'Corner', x: 1, y: 1 },
        ],
      },
      {
        source: 'main',
        elements: [
          { name: 'OK button', x: 0.51, y: 0.5 },
          { name: 'Save', x: 0.3, y: 0.1 },
        ],
      },
    ];
    const round = runSwarmRound(1, crew, readings);

    it('reaches consensus on an element both sources agree on', () => {
      const c = round.consensus.find((x) => x.element.name === 'OK button');
      expect(c).toMatchObject({ status: 'consensus' });
      expect(c?.sources.sort()).toEqual(['assist', 'main']);
    });

    it('flags conflict for an element the sources disagree on', () => {
      const c = round.consensus.find((x) => x.element.name === 'Save');
      expect(c).toMatchObject({ status: 'conflict' });
    });

    it('still finds an element at the frame\'s far corner', () => {
      const c = round.consensus.find((x) => x.element.name === 'Corner');
      expect(c).toBeDefined();
    });

    it('dispatchable returns the agreed element at the mean position', () => {
      const el = dispatchable(round).find((e) => e.name === 'OK button');
      expect(el?.x).toBeCloseTo(0.505);
      expect(el?.y).toBeCloseTo(0.5);
    });

    it('conflicts returns the conflicting element', () => {
      const c = conflicts(round);
      expect(c.map((x) => x.element.name)).toContain('Save');
    });
  });

  it('busyAgents is 0 without a round', () => {
    expect(busyAgents(null)).toBe(0);
  });

  it('roundLine mentions the round number', () => {
    const round = runSwarmRound(3, crew, []);
    expect(roundLine(round)).toContain('round 3');
  });
});
