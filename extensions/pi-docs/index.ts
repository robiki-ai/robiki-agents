import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { ripgrep } from '../../utils/ripgrep.ts';

const wiki = join(dirname(fileURLToPath(import.meta.url)), 'wiki');

function sectionPath(section?: string) {
  const name = section?.replace(/\.md$/i, '');
  if (name && !/^[a-z0-9-]+$/i.test(name)) {
    throw new Error(`Unknown section: ${section}`);
  }
  return { name, file: name ? join(wiki, 'docs', `${name}.md`) : undefined };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'pi_docs',
    label: 'Pi Docs',
    description:
      'Look up pi interface docs. Pass query to search the wiki; pass section to read a page (e.g. extensions). Omit both to list the catalog.',
    promptSnippet: 'Search or read pi interface documentation',
    promptGuidelines: [
      'Use pi_docs before writing or changing extensions, skills, commands, settings, themes, or any other pi interface.',
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: 'Search the wiki (regex)' })),
      section: Type.Optional(Type.String({ description: 'Doc section name, e.g. extensions' })),
    }),
    execute(_id, { query, section }) {
      const { name, file } = sectionPath(section);
      const target = file ?? wiki;

      if (query) {
        return ripgrep(['--line-number', '--color=never', '--smart-case', '--max-count', '20', '--', query, target]).then(
          ({ stdout }) => {
            const text = (stdout || 'No matches found').replaceAll(`${wiki}/`, '');
            return { content: [{ type: 'text', text }], details: { query, section: name ?? 'wiki' } };
          },
        );
      }

      return readFile(file ?? join(wiki, 'INDEX.md'), 'utf8')
        .catch(() => {
          throw new Error(`Unknown section: ${section}. Omit section to list the catalog.`);
        })
        .then((text) => ({ content: [{ type: 'text', text }], details: { query, section: name ?? 'index' } }));
    },
  });
}
