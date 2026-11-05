export type DocumentFileReadiness =
  | { supported: true; kind: 'text' }
  | { supported: false; reason: string };

/**
 * Browser File.text() is a text decoder, not a PDF/Office document parser.
 * Reject formats that would otherwise become unreadable binary/mojibake and
 * make the limitation explicit rather than sending corrupted content to a model.
 */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson',
  'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'pyw', 'java',
  'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sql',
  'css', 'scss', 'less', 'sh', 'ps1', 'bat', 'cmd', 'env', 'diff',
]);

const BINARY_DOCUMENTS: Record<string, string> = {
  pdf: 'PDF extraction is not configured yet. Export the PDF to TXT/Markdown, or add a PDF text-extraction adapter before analyzing it.',
  doc: 'Legacy Word (.doc) extraction is not configured. Save it as TXT/Markdown or DOCX and configure a document parser.',
  docx: 'DOCX extraction is not configured yet. Save/export it as TXT/Markdown, or add a DOCX text-extraction adapter before analyzing it.',
  odt: 'ODT extraction is not configured. Export it as TXT/Markdown or configure an ODT parser.',
  rtf: 'RTF extraction is not configured. Export it as TXT/Markdown or configure an RTF parser.',
  xls: 'Legacy Excel (.xls) extraction is not configured. Export the relevant sheet as CSV.',
  xlsx: 'Excel (.xlsx) extraction is not configured. Export the relevant sheet as CSV or configure a spreadsheet parser.',
  ppt: 'Legacy PowerPoint (.ppt) extraction is not configured. Export slide text or save as Markdown.',
  pptx: 'PowerPoint (.pptx) extraction is not configured. Export slide text or configure a presentation parser.',
};

export function getDocumentFileReadiness(fileName: string, mimeType = ''): DocumentFileReadiness {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const unsupportedReason = BINARY_DOCUMENTS[extension];
  if (unsupportedReason) return { supported: false, reason: unsupportedReason };
  if (TEXT_EXTENSIONS.has(extension) || mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
    return { supported: true, kind: 'text' };
  }
  return {
    supported: false,
    reason: 'This file type is not on the text-reader allowlist. Export it as TXT, Markdown, CSV, JSON, or source text before analysis.',
  };
}
