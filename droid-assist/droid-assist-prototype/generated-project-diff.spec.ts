import { describe, expect, it } from 'vitest';
import { getGeneratedProjectDiff } from './generated-project-diff.js';
const file = (path: string, body: string) => `FILE: ${path}\n\`\`\`ts\n${body}\n\`\`\``;
describe('generated project diff', () => {
  it('identifies added, removed, modified and unchanged files', () => {
    const before = [file('src/edit.ts', 'const value = 1;'), file('src/keep.ts', 'export {};'), file('src/remove.ts', 'old')].join('\n');
    const after = [file('src/add.ts', 'new'), file('src/edit.ts', 'const value = 2;'), file('src/keep.ts', 'export {};')].join('\n');
    const diff = getGeneratedProjectDiff(before, after);
    expect(diff.map((item) => [item.path, item.kind])).toEqual([['src/add.ts', 'added'], ['src/edit.ts', 'modified'], ['src/keep.ts', 'unchanged'], ['src/remove.ts', 'removed']]);
    expect(diff.find((item) => item.path === 'src/edit.ts')?.removedLines).toEqual(['const value = 1;']);
    expect(diff.find((item) => item.path === 'src/edit.ts')?.addedLines).toEqual(['const value = 2;']);
  });
  it('bounds displayed changed lines', () => {
    const before = file('src/a.ts', Array.from({ length: 30 }, (_, i) => `old ${i}`).join('\n'));
    const after = file('src/a.ts', Array.from({ length: 30 }, (_, i) => `new ${i}`).join('\n'));
    expect(getGeneratedProjectDiff(before, after, 5)[0].addedLines).toHaveLength(5);
  });
});