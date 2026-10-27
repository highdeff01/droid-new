import { describe, expect, it, vi } from 'vitest';
import {
  addToProject,
  drawWorldScreen,
  worldEmbed,
  worldImageAt,
  WORLD_HOLD_TICKS,
  WORLD_SCREEN,
  type PresentationProject,
  type PresentationRef,
} from './presentation-project.js';

const ref = (overrides: Partial<PresentationRef> = {}): PresentationRef => ({
  id: 'ref_1',
  kind: 'slideshow',
  name: 'Deck',
  added: 1,
  ...overrides,
});

describe('addToProject', () => {
  it('appends another presentation to a project that already holds one, in order', () => {
    const existing: PresentationProject = { id: 'p1', name: 'My Project', created: 0, presentations: [ref({ id: 'ref_1' })] };
    const { project, added } = addToProject([existing], 'My Project', ref({ id: 'ref_2' }));
    expect(added).toBe(true);
    expect(project.presentations.map((r) => r.id)).toEqual(['ref_1', 'ref_2']);
  });

  it('does not duplicate the same ref id added again', () => {
    const existing: PresentationProject = { id: 'p1', name: 'My Project', created: 0, presentations: [ref({ id: 'ref_1' })] };
    const { project, added } = addToProject([existing], 'My Project', ref({ id: 'ref_1' }));
    expect(added).toBe(false);
    expect(project.presentations).toHaveLength(1);
  });

  it('creates a new project when the name is unknown', () => {
    const { projects, project, added } = addToProject([], 'New Project', ref());
    expect(added).toBe(true);
    expect(project.name).toBe('New Project');
    expect(projects).toHaveLength(1);
  });

  it('matches an existing project name case-insensitively', () => {
    const existing: PresentationProject = { id: 'p1', name: 'My Project', created: 0, presentations: [] };
    const { project, projects } = addToProject([existing], 'my project', ref());
    expect(projects).toHaveLength(1);
    expect(project.id).toBe('p1');
  });
});

describe('worldEmbed', () => {
  it('filters out empty images', () => {
    const embed = worldEmbed('e1', 'slideshow', 'Title', ['a.png', '', 'b.png']);
    expect(embed.images).toEqual(['a.png', 'b.png']);
  });

  it('throws when there are no images to show', () => {
    expect(() => worldEmbed('e1', 'slideshow', 'Title', ['', ''])).toThrow();
  });
});

describe('worldImageAt', () => {
  it('cycles every WORLD_HOLD_TICKS ticks', () => {
    const embed = worldEmbed('e1', 'slideshow', 'Title', ['a.png', 'b.png', 'c.png']);
    expect(worldImageAt(embed, 0)).toBe(0);
    expect(worldImageAt(embed, WORLD_HOLD_TICKS - 1)).toBe(0);
    expect(worldImageAt(embed, WORLD_HOLD_TICKS)).toBe(1);
    expect(worldImageAt(embed, WORLD_HOLD_TICKS * 2)).toBe(2);
    expect(worldImageAt(embed, WORLD_HOLD_TICKS * 3)).toBe(0);
  });
});

const mockCtx = () =>
  ({
    fillStyle: '',
    font: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
  }) as unknown as CanvasRenderingContext2D;

describe('drawWorldScreen', () => {
  it('draws the image at WORLD_SCREEN fractions of w,h when given', () => {
    const ctx = mockCtx();
    const image = {} as CanvasImageSource;
    drawWorldScreen(ctx, 1000, 500, 'My Deck', image);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      image,
      WORLD_SCREEN.x * 1000,
      WORLD_SCREEN.y * 500,
      WORLD_SCREEN.w * 1000,
      WORLD_SCREEN.h * 500,
    );
  });

  it('does not draw an image when null', () => {
    const ctx = mockCtx();
    drawWorldScreen(ctx, 1000, 500, 'My Deck', null);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('fills the title text', () => {
    const ctx = mockCtx();
    drawWorldScreen(ctx, 1000, 500, 'My Deck', null);
    expect(ctx.fillText).toHaveBeenCalledWith('My Deck', expect.any(Number), expect.any(Number));
  });
});
