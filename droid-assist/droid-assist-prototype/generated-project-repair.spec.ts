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

  it('includes directly imported files as read-only repair context', async () => {
    const output = [
      'FILE: src/main.ts',
      '```ts',
      "import { helper } from './helper';",
      "import './missing';",
      'export const main = helper();',
      '```',
      'FILE: src/helper.ts',
      '```ts',
      'export const helper = () => true;',
      '```',
    ].join('\n');
    const ask = vi.fn<AskFn>().mockImplementation(async (request) => {
      expect(request.prompt).toContain('READ-ONLY DEPENDENCY FILE: src/helper.ts');
      expect(request.prompt).toContain('export const helper = () => true;');
      return {
        content: ['FILE: src/main.ts', '```ts', "import { helper } from './helper';", 'export const main = helper();', '```'].join('\n'),
        thinking: null,
      };
    });
    const result = await repairGeneratedProject(ask, output);
    expect(result.repaired).toBe(true);
    expect(result.output).toContain('FILE: src/helper.ts');
  });

  it('does not call the model for a clean project', async () => {
    const clean = ['FILE: src/a.ts', '```ts', 'export const a = 1;', '```'].join('\n');
    const ask = vi.fn<AskFn>();
    const result = await repairGeneratedProject(ask, clean);
    expect(ask).not.toHaveBeenCalled();
    expect(result.output).toBe(clean);
    expect(result.attempts).toBe(0);
  });

  it('rejects the entire patch when the model includes an unrelated file', async () => {
    const ask = vi.fn<AskFn>().mockResolvedValue({
      content: [
        'FILE: src/main.ts', '```ts', 'export const main = true;', '```',
        'FILE: src/untouched.ts', '```ts', 'export const changed = true;', '```',
      ].join('\n'),
      thinking: null,
    });
    const result = await repairGeneratedProject(ask, broken);
    expect(result.repaired).toBe(false);
    expect(result.output).toBe(broken);
    expect(result.output).not.toContain('src/untouched.ts');
  });

  it('rejects a partial patch when one of multiple required targets is omitted', async () => {
    const output = [
      'FILE: src/one.ts', '```ts', "import './missing-one';", '```',
      'FILE: src/two.ts', '```ts', "import './missing-two';", '```',
    ].join('\n');
    const ask = vi.fn<AskFn>().mockResolvedValue({
      content: ['FILE: src/one.ts', '```ts', 'export const one = true;', '```'].join('\n'),
      thinking: null,
    });
    const result = await repairGeneratedProject(ask, output);
    expect(result.repaired).toBe(false);
    expect(result.output).toBe(output);
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
