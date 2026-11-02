import { describe, expect, it } from 'vitest';
import { getDocumentFileReadiness } from './document-file-formats.js';

describe('document file format readiness', () => {
  it('allows common text and source formats', () => {
    for (const name of ['notes.txt', 'report.md', 'data.csv', 'config.json', 'app.ts', 'page.html']) {
      expect(getDocumentFileReadiness(name).supported, name).toBe(true);
    }
    expect(getDocumentFileReadiness('report', 'text/plain').supported).toBe(true);
  });

  it('clearly rejects PDF and Office files instead of decoding binary bytes as text', () => {
    for (const name of ['report.pdf', 'report.docx', 'sheet.xlsx', 'slides.pptx', 'archive.odt']) {
      const result = getDocumentFileReadiness(name);
      expect(result.supported, name).toBe(false);
      if (!result.supported) expect(result.reason.length).toBeGreaterThan(20);
    }
  });

  it('rejects unknown extensions unless a text MIME type is provided', () => {
    expect(getDocumentFileReadiness('payload.bin').supported).toBe(false);
    expect(getDocumentFileReadiness('payload.custom', 'text/plain').supported).toBe(true);
  });
});
