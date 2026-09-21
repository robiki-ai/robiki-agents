import { access, constants, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { readJsonFile } from '../../utils/fs.ts';
import { guardPath, guardText } from '../../utils/guard.ts';
import { glob, match, search } from '../../utils/ripgrep.ts';

interface ToolConfig {
  enabled?: boolean;
  description?: string;
}

const toolsPath = join(homedir(), '.pi', 'agent', 'tools.json');

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value || '(empty)' }], details: {} };
}

function resolvePath(cwd: string, path?: string) {
  const raw = (path ?? '.').replace(/^@/, '');
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

function splitArgs(command: string) {
  return [...command.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

function resultText(content: unknown) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text ?? '') : ''))
    .join('\n');
}

function blockedCall(toolName: string, input: Record<string, unknown>, cwd: string) {
  const pathCheck =
    typeof input.path === 'string'
      ? guardPath(resolvePath(cwd, input.path)).then((blocked) => (blocked ? `Blocked path: ${input.path}` : undefined))
      : Promise.resolve(undefined);

  return pathCheck.then((reason) => {
    if (reason) return reason;
    if (toolName === 'write' && typeof input.content === 'string' && guardText(input.content)) {
      return 'Blocked sensitive content';
    }
    if (toolName === 'edit' && Array.isArray(input.edits)) {
      for (const edit of input.edits) {
        if (!edit || typeof edit !== 'object') continue;
        const item = edit as { oldText?: string; newText?: string };
        if (guardText(item.oldText ?? '') || guardText(item.newText ?? '')) return 'Blocked sensitive content';
      }
    }
    if ((toolName === 'git' || toolName === 'gh') && typeof input.command === 'string' && guardText(input.command)) {
      return 'Blocked sensitive content';
    }
  });
}

function blockedResult(toolName: string, input: Record<string, unknown>, content: unknown, cwd: string) {
  const raw = resultText(content);
  if (toolName === 'glob' || toolName === 'ls') {
    const root = toolName === 'ls' && typeof input.path === 'string' ? resolvePath(cwd, input.path) : cwd;
    return Promise.all(
      raw.split('\n').map((line) => {
        const name = line.replace(/\/$/, '');
        if (!name || name.startsWith('(') || name.startsWith('[')) return Promise.resolve(line);
        return guardPath(resolvePath(root, name)).then((blocked) => (blocked ? undefined : line));
      }),
    ).then((lines) => ({
      content: [{ type: 'text' as const, text: lines.filter((line) => line !== undefined).join('\n') || '(empty)' }],
    }));
  }
  if (
    (toolName === 'read' || toolName === 'search' || toolName === 'match' || toolName === 'git' || toolName === 'gh') &&
    guardText(raw)
  ) {
    return Promise.resolve({ content: [{ type: 'text' as const, text: 'Blocked sensitive content' }], isError: true });
  }
}

function run(pi: ExtensionAPI, bin: string, command: string, cwd: string, signal?: AbortSignal) {
  const args = splitArgs(command);
  if (args[0] === bin) args.shift();
  if (args.length === 0) return Promise.reject(new Error(`${bin} command is required`));

  return pi.exec(bin, args, { signal, cwd }).then((result) => {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.killed) throw new Error('cancelled');
    if (result.code !== 0) throw new Error(output || `${bin} exited ${result.code}`);
    return text(output);
  });
}

function which(command: string) {
  if (!command.trim() || /[/\\]/.test(command)) {
    return Promise.reject(new Error('command must be a name, not a path'));
  }

  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : [''];
  const candidates = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((dir) => exts.map((ext) => join(dir, `${command}${ext}`)));

  return candidates
    .reduce<Promise<string | undefined>>(
      (prev, candidate) =>
        prev.then((found) => {
          if (found) return found;
          return stat(candidate)
            .then((info) => (info.isFile() ? access(candidate, constants.X_OK).then(() => candidate) : undefined))
            .catch(() => undefined);
        }),
      Promise.resolve(undefined),
    )
    .then((found) => {
      if (!found) throw new Error(`not found: ${command}`);
      return text(found);
    });
}

function registerCustomTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'search',
    label: 'search',
    description: 'Search for a literal substring in the contents of a file',
    parameters: Type.Object({
      query: Type.String({ description: 'The substring to search for' }),
      path: Type.Optional(Type.String({ description: 'The path to the file to search' })),
    }),
    execute(_id, { query, path }, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      return search(query, resolvePath(cwd, path), cwd).then((stdout) => text(stdout || 'No matches found'));
    },
  });

  pi.registerTool({
    name: 'match',
    label: 'match',
    description: 'Search for a regex pattern in the contents of a file',
    parameters: Type.Object({
      query: Type.String({ description: 'The regex pattern to search for' }),
      path: Type.Optional(Type.String({ description: 'The path to the file to search' })),
    }),
    execute(_id, { query, path }, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      return match(query, resolvePath(cwd, path), cwd).then((stdout) => text(stdout || 'No matches found'));
    },
  });

  pi.registerTool({
    name: 'glob',
    label: 'glob',
    description: 'List files with a glob pattern',
    parameters: Type.Object({
      pattern: Type.String({ description: 'The glob pattern to search for' }),
    }),
    execute(_id, { pattern }, _signal, _onUpdate, ctx) {
      return glob(pattern, ctx.cwd).then((stdout) => text(stdout || 'No files found'));
    },
  });

  pi.registerTool({
    name: 'ls',
    label: 'ls',
    description: 'List the contents of a directory',
    parameters: Type.Object({
      path: Type.String({ description: 'The path to the directory to list' }),
    }),
    execute(_id, { path }, _signal, _onUpdate, ctx) {
      const dir = resolvePath(ctx.cwd, path);
      return stat(dir)
        .then((info) => {
          if (!info.isDirectory()) throw new Error(`Not a directory: ${dir}`);
          return readdir(dir, { withFileTypes: true });
        })
        .then((entries) => {
          entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
          if (entries.length === 0) return text('(empty directory)');
          return text(entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).join('\n'));
        });
    },
  });

  pi.registerTool({
    name: 'which',
    label: 'which',
    description: 'Find the path of a command in the PATH',
    parameters: Type.Object({
      command: Type.String({ description: 'The command to find' }),
    }),
    execute(_id, { command }) {
      return which(command);
    },
  });

  pi.registerTool({
    name: 'git',
    label: 'git',
    description: 'Run a git command',
    parameters: Type.Object({
      command: Type.String({ description: 'The git command to run' }),
    }),
    execute(_id, { command }, signal, _onUpdate, ctx) {
      return run(pi, 'git', command, ctx.cwd, signal);
    },
  });

  pi.registerTool({
    name: 'gh',
    label: 'gh',
    description: 'Run a GitHub CLI command',
    parameters: Type.Object({
      command: Type.String({ description: 'The GitHub CLI command to run' }),
    }),
    execute(_id, { command }, signal, _onUpdate, ctx) {
      return run(pi, 'gh', command, ctx.cwd, signal);
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerCustomTools(pi);

  let allowed = new Set<string>();
  let prompt = '';

  pi.on('session_start', () => {
    return readJsonFile<Record<string, ToolConfig>>(toolsPath).then((config) => {
      const known = new Set(pi.getAllTools().map((tool) => tool.name));
      const enabled = Object.entries(config).filter(([name, tool]) => tool.enabled === true && known.has(name));

      allowed = new Set(enabled.map(([name]) => name));
      prompt = enabled.map(([name, tool]) => `- \`${name}\`: ${tool.description ?? ''}`).join('\n');
      pi.setActiveTools([...allowed]);
    });
  });

  pi.on('before_agent_start', (event) => {
    pi.setActiveTools([...allowed]);
    if (!prompt) return;
    return { systemPrompt: `${event.systemPrompt}\n\n## Tools\n\n${prompt}` };
  });

  pi.on('tool_call', (event, ctx) => {
    if (!allowed.has(event.toolName)) {
      return Promise.resolve({ block: true, reason: `${event.toolName} is not enabled` });
    }
    return blockedCall(event.toolName, event.input as Record<string, unknown>, ctx.cwd).then((reason) =>
      reason ? { block: true, reason } : undefined,
    );
  });

  pi.on('tool_result', (event, ctx) => {
    return blockedResult(event.toolName, event.input as Record<string, unknown>, event.content, ctx.cwd);
  });
}
