import type { PluginModule } from './plugins.js';

/**
 * A worked example of a plugin: it adds a notes capability the AI can invoke, a `/note` command, and
 * a small panel. It exists to show the whole lifecycle (register → appear in the registry → unload)
 * and to give the Plugins panel something real to load.
 */
export interface Note {
  text: string;
  at: number;
}

/** The notes the example plugin holds, in memory (a real plugin would persist its own store). */
export const exampleNotes: Note[] = [];

export const examplePlugin: PluginModule = {
  manifest: {
    id: 'example.notes',
    name: 'Notes',
    version: '1.0.0',
    description: 'A tiny notes plugin: an append capability, a /note command and a Notes panel.',
    capabilities: [
      {
        id: 'append',
        description: 'Append one line to the plugin notes.',
        params: [{ name: 'text', type: 'string', required: true, description: 'the line to append' }],
        access: 'all',
        invoke: async (params) => {
          const text = String(params.text ?? '').trim();
          if (!text) return { ok: false, message: 'append needs a non-empty text' };
          exampleNotes.push({ text, at: Date.now() });
          return { ok: true, message: `Noted "${text}" (${exampleNotes.length} total)` };
        },
      },
    ],
    commands: [
      {
        name: 'note',
        usage: 'Usage: /note <text> — appends a line to the plugin notes',
        run: (target) => {
          const text = target.trim();
          if (!text) throw new Error('Usage: /note <text>');
          exampleNotes.push({ text, at: Date.now() });
        },
      },
    ],
    panels: [
      {
        id: 'notes',
        title: 'Notes (example plugin)',
        render: () => exampleNotes.map((n) => n.text),
      },
    ],
  },
  activate: (api) => {
    api.log(`loaded with ${exampleNotes.length} note(s)`);
  },
};
