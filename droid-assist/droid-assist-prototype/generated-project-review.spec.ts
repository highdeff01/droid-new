import { describe, expect, it } from 'vitest';
import { reviewGeneratedProject } from './generated-project-review.js';

describe('generated project review', () => {
  it('extracts files and validates relative imports across the manifest', () => {
    const output = [
      'FILE: src/main.ts',
      '```ts',
      "import { helper } from './helper';",
      'export const main = helper();',
      '```',
      'FILE: src/helper.ts',
      '```ts',
      'export const helper = () => true;',
      '```',
    ].join('\n');
    const result = reviewGeneratedProject(output, ['src/main.ts', 'src/helper.ts']);
    expect(result.complete).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual(['src/main.ts', 'src/helper.ts']);
    expect(result.issues).toEqual([]);
  });

  it('reports missing expected files and duplicate declarations', () => {
    const output = [
      'FILE: src/a.ts',
      '```ts',
      'export const a = 1;',
      '```',
      'FILE: src/a.ts',
      '```ts',
      'export const a = 2;',
      '```',
    ].join('\n');
    const result = reviewGeneratedProject(output, ['src/a.ts', 'src/b.ts']);
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate_file');
    expect(result.issues.map((issue) => issue.code)).toContain('missing_file');
    expect(result.complete).toBe(false);
  });

  it('rejects absolute and traversal paths', () => {
    const result = reviewGeneratedProject('FILE: ../outside.ts\n```ts\nnope\n```\nFILE: C:/temp/a.ts\n```ts\nnope\n```');
    expect(result.files).toHaveLength(0);
    expect(result.issues.filter((issue) => issue.code === 'unsafe_path')).toHaveLength(2);
  });

  it('detects unclosed fences, empty files and unresolved relative imports', () => {
    const result = reviewGeneratedProject([
      'FILE: src/main.ts',
      '```ts',
      "import './missing';",
      'export const main = true;',
      'FILE: src/empty.ts',
      '```ts',
      '```',
    ].join('\n'));
    expect(result.issues.map((issue) => issue.code)).toContain('unclosed_fence');
    expect(result.issues.map((issue) => issue.code)).toContain('empty_file');
    expect(result.issues.map((issue) => issue.code)).toContain('unresolved_relative_import');
  });

  it('rejects relative imports that escape the generated project root', () => {
    const result = reviewGeneratedProject([
      'FILE: src/main.ts',
      '```ts',
      "import '../../../outside';",
      'export const main = true;',
      '```',
    ].join('\n'));
    expect(result.issues.some((issue) => issue.code === 'unsafe_path')).toBe(true);
  });

  it('reports output without explicit file headers', () => {
    const result = reviewGeneratedProject('Just prose, no file sections.');
    expect(result.issues[0]?.code).toBe('missing_file_header');
    expect(result.complete).toBe(false);
  });
});
