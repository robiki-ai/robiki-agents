#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, '..', 'config');
const piDir = join(homedir(), '.pi');
const agentDir = join(piDir, 'agent');

function readJsonFile(path) {
  return readFile(path, 'utf-8')
    .then((content) => JSON.parse(content))
    .catch((error) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    });
}

function writeJsonFile(path, data) {
  return mkdir(dirname(path), { recursive: true })
    .then(() => writeFile(path, JSON.stringify(data, null, 2), 'utf-8'))
    .then(() => void 0);
}

function writeMarkdownFile(path, data) {
  return mkdir(dirname(path), { recursive: true })
    .then(() => writeFile(path, data.replaceAll(/\r?\n/g, '\n'), 'utf-8'))
    .then(() => void 0);
}

function merge(args) {
  return args.reduce((acc, curr) => {
    if (!curr) return acc;
    Object.entries(curr).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (typeof value === 'object' && !Array.isArray(value)) {
        const prev = acc[key];
        acc[key] = merge([typeof prev === 'object' && prev && !Array.isArray(prev) ? prev : {}, value]);
        return;
      }
      acc[key] = value;
    });
    return acc;
  }, {});
}

function ensurePackage(packages, name, version) {
  const entry = `npm:${name}@${version}`;
  const list = Array.isArray(packages) ? packages : [];
  if (list.some((item) => typeof item === 'string' && item.includes(name))) return list;
  return [...list, entry];
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

function main() {
  if (process.env.RBK_SKIP_POSTINSTALL === '1') return Promise.resolve();

  const defaultPath = join(configDir, 'settings.json');
  const systemPath = join(configDir, 'SYSTEM.md');
  const toolsPath = join(configDir, 'tools.json');
  const globalPath = join(agentDir, 'settings.json');
  const globalToolsPath = join(agentDir, 'tools.json');
  const globalSystemPath = join(agentDir, 'SYSTEM.md');

  return Promise.all([
    readFile(systemPath, 'utf-8').then((content) => content.replaceAll(/\r?\n/g, '\n')),
    readJsonFile(globalPath),
    readJsonFile(defaultPath),
    readJsonFile(join(__dirname, '..', 'package.json')),
    readJsonFile(globalToolsPath),
    readJsonFile(toolsPath),
  ]).then(([system, existing, defaults, pkg, existingTools, defaultTools]) => {
    const merged = merge([existing, defaults]);
    merged.packages = ensurePackage(merged.packages, pkg.name, pkg.version);
    return Promise.all([
      writeMarkdownFile(globalSystemPath, system),
      writeJsonFile(globalPath, sortKeys(merged)),
      writeJsonFile(globalToolsPath, sortKeys(merge([existingTools, defaultTools]))),
    ]);
  });
}

main().catch((error) => {
  console.error(`@robiki/agents: postinstall failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
