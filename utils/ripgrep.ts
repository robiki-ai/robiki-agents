import { access } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ripgrep as runRipgrep } from 'ripgrep';

export function ripgrep(args: string[], cwd?: string) {
  return runRipgrep(args, {
    buffer: true,
    ...(cwd ? { preopens: { '.': cwd } } : {}),
  }).then(({ code, stdout = '', stderr = '' }) => {
    if (code === 2) throw new Error(stderr.trim() || 'ripgrep failed');
    return { code, stdout, stderr };
  });
}

function withWorkspace(path: string, cwd?: string) {
  const workspace = join(cwd ?? process.cwd(), '.workspace');
  return access(workspace)
    .then(() => {
      const rel = relative(workspace, resolve(path));
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return [path];
      return [path, workspace];
    })
    .catch(() => [path]);
}

export function search(query: string, path: string, cwd?: string) {
  return withWorkspace(path, cwd)
    .then((paths) => ripgrep(['--line-number', '--color=never', '--fixed-strings', '--', query, ...paths], cwd))
    .then(({ stdout }) => stdout.trim());
}

export function match(query: string, path: string, cwd?: string) {
  return withWorkspace(path, cwd)
    .then((paths) => ripgrep(['--line-number', '--color=never', '--', query, ...paths], cwd))
    .then(({ stdout }) => stdout.trim());
}

export function glob(pattern: string, cwd: string) {
  return withWorkspace(cwd, cwd)
    .then((paths) => ripgrep(['--files', '--color=never', '--glob', pattern, ...paths], cwd))
    .then(({ stdout }) => stdout.trim());
}
