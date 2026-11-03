import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import { repairGeneratedProject } from './generated-project-repair.js';

const broken = [
  'FILE: src/main.ts',
  '```ts',
  "import './missing';",
  'export const main = true;',
  '```',
].join('\n');

describe('generated project repair', () => {
  it('repairs only the flagged file and preserves the original output', async () => {
    const ask = vi.fn<AskFn>().mockResolvedValue({
      content: ['FILE: src/main.ts', '```ts', 'export const main = true;', '```'].join('\n'),
      thinking: null,
    });
    const result = await repairGeneratedProject(ask, broken);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.originalOutput).toBe(broken);
    expect(result.repaired).toBe(true);
    expect(result.review.complete).toBe(true);
    expect(result.output).toContain('FILE: src/main.ts');
  });

  it('does not call the model for a clean project', async () => {
    const clean = ['FILE: src/a.ts', '```ts', 'export const a = 1;', '```'].join('\n');
    const ask = vi.fn<AskFn>();
    const result = await repairGeneratedProject(ask, clean);
    expect(ask).not.toHaveBeenCalled();
    expect(result.output).toBe(clean);
    expect(result.attempts).toBe(0);
  });

  it('bounds attempts and refuses patches with unsafe or malformed paths', async () => {
    const ask = vi.fn<AskFn>().mockResolvedValue({
      content: ['FILE: ../outside.ts', '```ts', 'bad', '```'].join('\n'),
      thinking: null,
    });
    const result = await repairGeneratedProject(ask, broken, { maxAttempts: 50 });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.repaired).toBe(false);
    expect(result.originalOutput).toBe(broken);
  });
});
