import { execFile as execFileCb } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const SENSITIVE_TEXT = [
  /-----BEGIN (?:[A-Z]+ )*(?:PRIVATE KEY|CERTIFICATE|CERTIFICATE REQUEST|PGP PRIVATE KEY BLOCK)-----/,
  /\bsk[-_][A-Za-z0-9_-]{20,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

const SENSITIVE_NAMES = new Set([
  '.env',
  '.envrc',
  '.htpasswd',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.pgpass',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
]);

const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.crt',
  '.cer',
  '.der',
  '.p8',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
]);

const SAFE_ENV = /^\.env\.(example|sample|template|dist)(\.|$)/i;

function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function guardPath(path: string): Promise<boolean> {
  return isGitIgnored(path).then((ignored) => {
    if (isWorkspace(path)) return false;
    if (ignored) return true;
    return isSensitivePath(path);
  });
}

export function guardText(text: string): boolean {
  return isSensitiveText(text);
}

async function gitRoot(path: string): Promise<string | undefined> {
  const resolved = resolve(path);
  return stat(resolved)
    .then((info) => (info.isDirectory() ? resolved : dirname(resolved)))
    .catch(() => dirname(resolved))
    .then(function walk(dir: string): Promise<string | undefined> {
      return access(join(dir, '.git'))
        .then(() => dir)
        .catch(() => {
          const parent = dirname(dir);
          return parent === dir ? undefined : walk(parent);
        });
    });
}

async function isGitIgnored(path: string): Promise<boolean> {
  return gitRoot(path).then((root) => {
    if (!root) return false;
    return execFile('git', ['check-ignore', '-q', '--', resolve(path)], {
      cwd: root,
      timeout: 3000,
      windowsHide: true,
    })
      .then(() => true)
      .catch(() => false);
  });
}

function isWorkspace(path: string): boolean {
  const resolved = resolve(path);
  return isInside(join(process.cwd(), '.workspace'), resolved) || resolved.split(/[/\\]/).includes('.workspace');
}

function isSensitiveText(text: string): boolean {
  return !!text && SENSITIVE_TEXT.some((pattern) => pattern.test(text));
}

function isSensitivePath(path: string): boolean {
  if (!path) return false;

  const name = basename(path);
  if (SENSITIVE_NAMES.has(name.toLowerCase())) return true;
  if (name.startsWith('.env.') && !SAFE_ENV.test(name)) return true;
  if (SENSITIVE_EXTENSIONS.has(extname(name).toLowerCase())) return true;

  const parts = resolve(path).split(/[/\\]/);
  return parts.some((part) => part === '.ssh' || part === '.gnupg' || part === '.aws');
}
