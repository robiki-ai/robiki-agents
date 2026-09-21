import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(root, 'extensions', 'tools', 'index.ts');
const catalogPath = join(root, 'config', 'tools.json');
const model = 'openai-codex/gpt-5.6-sol';
const timeout = 180_000;
const marker = 'ROBIKI_TOOLS_TEST_7f3a9c';
const regexMarker = 'ROBIKI_MATCH_TOKEN_42';
const githubToken = `ghp_${'A'.repeat(36)}`;

type ToolCatalog = Record<string, { enabled?: boolean; description?: string }>;
type PiEvent = Record<string, unknown>;

interface PiRun {
  code: number | null;
  stdout: string;
  stderr: string;
  events: PiEvent[];
}

const hasPi = spawnSync('pi', ['--version'], { encoding: 'utf8' }).status === 0;

let home = '';
let catalog: ToolCatalog = {};

function eventsOf(run: PiRun, type: string, toolName?: string) {
  return run.events.filter((event) => event.type === type && (toolName ? event.toolName === toolName : true));
}

function partsText(content: unknown) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
    .join('\n');
}

function resultText(event: PiEvent) {
  const result = event.result;
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(result);
  return partsText(content);
}

function assistantText(run: PiRun) {
  return run.events
    .filter((event) => event.type === 'message_end')
    .map((event) => partsText((event.message as { content?: unknown } | undefined)?.content))
    .filter(Boolean)
    .join('\n');
}

function parseEvents(stdout: string) {
  const events: PiEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed) as PiEvent);
    } catch {
      // ignore non-JSON banners mixed into stdout
    }
  }
  return events;
}

function dump(run: PiRun) {
  const calls = eventsOf(run, 'tool_execution_start')
    .map((event) => `${event.toolName} ${JSON.stringify(event.args)}`)
    .join('\n');
  const results = eventsOf(run, 'tool_execution_end')
    .map((event) => `${event.toolName} error=${event.isError}\n${resultText(event)}`)
    .join('\n---\n');
  return `exit=${run.code}\ncalls:\n${calls || '(none)'}\nresults:\n${results || '(none)'}\nassistant:\n${assistantText(run) || '(none)'}\nstderr:\n${run.stderr}`;
}

async function writeTools(enabled: string[]) {
  const tools = Object.fromEntries(
    enabled.map((name) => [name, { ...(catalog[name] ?? {}), enabled: true }]),
  );
  await mkdir(join(home, '.pi', 'agent'), { recursive: true });
  await writeFile(join(home, '.pi', 'agent', 'tools.json'), JSON.stringify(tools, null, 2));
}

async function workspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-tools-'));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return dir;
}

function runPi(cwd: string, enabled: string[], prompt: string) {
  return writeTools(enabled).then(
    () =>
      new Promise<PiRun>((resolve, reject) => {
        const child = spawn(
          'pi',
          [
            '--model',
            model,
            '--mode',
            'json',
            '-p',
            '--no-session',
            '--approve',
            '--thinking',
            'off',
            '--no-context-files',
            '--no-skills',
            '--no-prompt-templates',
            '--no-extensions',
            '-e',
            extensionPath,
            '--append-system-prompt',
            'This is an automated tool integration test. Call exactly the one tool named in the user message, using the requested arguments. Do not call any other tool. After the tool returns, reply with the single word DONE.',
            prompt,
          ],
          {
            cwd,
            env: {
              ...process.env,
              HOME: home,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );

        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
          resolve({ code, stdout, stderr, events: parseEvents(stdout) });
        });
      }),
  );
}

function assertTool(run: PiRun, name: string) {
  assert.equal(run.code, 0, dump(run));
  const ended = eventsOf(run, 'tool_execution_end', name);
  assert.ok(ended.length > 0, `expected ${name} to run\n${dump(run)}`);
  return { ended, text: ended.map(resultText).join('\n') };
}

describe('extensions/tools', { skip: !hasPi, concurrency: false }, () => {
  before(async () => {
    catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as ToolCatalog;
    home = await mkdtemp(join(tmpdir(), 'pi-home-'));
    const agentDir = join(home, '.pi', 'agent');
    await mkdir(agentDir, { recursive: true });
    const source = join(homedir(), '.pi', 'agent');
    await Promise.all(
      ['auth.json', 'models-store.json', 'settings.json'].map((file) =>
        copyFile(join(source, file), join(agentDir, file)).catch(() => undefined),
      ),
    );
  });

  after(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  test('ls lists directory contents', { timeout }, async () => {
    const cwd = await workspace({
      'notes.txt': `${marker}\n`,
      'keep/readme.md': 'nested\n',
    });
    try {
      const run = await runPi(cwd, ['ls'], 'Call the ls tool once with path ".".');
      const { text } = assertTool(run, 'ls');
      assert.match(text, /notes\.txt/);
      assert.match(text, /keep\//);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('ls hides sensitive files', { timeout }, async () => {
    const cwd = await workspace({
      '.env': 'SECRET=1\n',
      'notes.txt': `${marker}\n`,
    });
    try {
      const run = await runPi(cwd, ['ls'], 'Call the ls tool once with path ".".');
      const { text } = assertTool(run, 'ls');
      assert.match(text, /notes\.txt/);
      assert.doesNotMatch(text, /\.env/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('glob lists files matching a pattern', { timeout }, async () => {
    const cwd = await workspace({
      'alpha.marker': 'a\n',
      'beta.marker': 'b\n',
      'skip.txt': 'no\n',
    });
    try {
      const run = await runPi(cwd, ['glob'], 'Call the glob tool once with pattern "*.marker".');
      const { text } = assertTool(run, 'glob');
      assert.match(text, /alpha\.marker/);
      assert.match(text, /beta\.marker/);
      assert.doesNotMatch(text, /skip\.txt/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('search finds a literal substring', { timeout }, async () => {
    const cwd = await workspace({
      'notes.txt': `intro\n${marker}\noutro\n`,
    });
    try {
      const run = await runPi(cwd, ['search'], `Call the search tool once with query "${marker}" and path "notes.txt".`);
      const { text } = assertTool(run, 'search');
      assert.match(text, new RegExp(marker));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('search blocks sensitive content', { timeout }, async () => {
    const cwd = await workspace({
      'notes.txt': `token ${githubToken}\n`,
    });
    try {
      const run = await runPi(cwd, ['search'], 'Call the search tool once with query "ghp_" and path "notes.txt".');
      const { ended, text } = assertTool(run, 'search');
      assert.ok(ended.some((event) => event.isError === true) || /blocked/i.test(text), dump(run));
      assert.doesNotMatch(text, /ghp_[A-Za-z0-9]{36}/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('match finds a regex pattern', { timeout }, async () => {
    const cwd = await workspace({
      'notes.txt': `intro\n${regexMarker}\noutro\n`,
    });
    try {
      const run = await runPi(cwd, ['match'], 'Call the match tool once with query "ROBIKI_MATCH_TOKEN_[0-9]+" and path "notes.txt".');
      const { text } = assertTool(run, 'match');
      assert.match(text, new RegExp(regexMarker));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('which finds a command on PATH', { timeout }, async () => {
    const cwd = await workspace({ 'notes.txt': `${marker}\n` });
    try {
      const run = await runPi(cwd, ['which'], 'Call the which tool once with command "node".');
      const { ended, text } = assertTool(run, 'which');
      assert.equal(ended[0]?.isError, false, dump(run));
      assert.match(text, /node/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('git runs a git command', { timeout }, async () => {
    const cwd = await workspace({ 'notes.txt': `${marker}\n` });
    try {
      const repo = spawnSync('git', ['init', '-b', 'main'], { cwd, encoding: 'utf8' });
      assert.equal(repo.status, 0, repo.stderr);
      const run = await runPi(cwd, ['git'], 'Call the git tool once with command "rev-parse --is-inside-work-tree".');
      const { ended, text } = assertTool(run, 'git');
      assert.equal(ended[0]?.isError, false, dump(run));
      assert.match(text, /true/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('gh runs a GitHub CLI command', { timeout }, async () => {
    const cwd = await workspace({ 'notes.txt': `${marker}\n` });
    try {
      const run = await runPi(cwd, ['gh'], 'Call the gh tool once with command "version".');
      const { ended, text } = assertTool(run, 'gh');
      assert.equal(ended[0]?.isError, false, dump(run));
      assert.match(text, /gh version/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('read returns file contents', { timeout }, async () => {
    const cwd = await workspace({ 'notes.txt': `${marker}\n` });
    try {
      const run = await runPi(cwd, ['read'], 'Call the read tool once with path "notes.txt".');
      const { text } = assertTool(run, 'read');
      assert.match(text, new RegExp(marker));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('write creates a file', { timeout }, async () => {
    const cwd = await workspace({ 'notes.txt': `${marker}\n` });
    try {
      const run = await runPi(cwd, ['write'], `Call the write tool once with path "hello.txt" and content "${marker}".`);
      assertTool(run, 'write');
      assert.equal((await readFile(join(cwd, 'hello.txt'), 'utf8')).trim(), marker);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('edit replaces text in a file', { timeout }, async () => {
    const cwd = await workspace({ 'notes.txt': 'before TOKEN after\n' });
    try {
      const run = await runPi(cwd, ['edit'], 'Call the edit tool once on path "notes.txt" replacing TOKEN with CHANGED.');
      assertTool(run, 'edit');
      assert.match(await readFile(join(cwd, 'notes.txt'), 'utf8'), /CHANGED/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('read blocks a sensitive path', { timeout }, async () => {
    const cwd = await workspace({ '.env': 'SECRET=1\n', 'notes.txt': `${marker}\n` });
    try {
      const run = await runPi(cwd, ['read'], 'Call the read tool once with path ".env".');
      const { ended, text } = assertTool(run, 'read');
      assert.ok(ended.some((event) => event.isError === true) || /blocked/i.test(text), dump(run));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('write blocks sensitive content', { timeout }, async () => {
    const cwd = await workspace({ 'notes.txt': `${marker}\n` });
    try {
      const run = await runPi(
        cwd,
        ['write'],
        'Call the write tool once with path "secret.pem" and content "-----BEGIN PRIVATE KEY-----\\nMIIEowIBAAKCAQEA\\n-----END PRIVATE KEY-----".',
      );
      const { ended, text } = assertTool(run, 'write');
      assert.ok(ended.some((event) => event.isError === true) || /blocked/i.test(text), dump(run));
      await assert.rejects(readFile(join(cwd, 'secret.pem')));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('disabled tools are not executed', { timeout }, async () => {
    const cwd = await workspace({ 'notes.txt': `${marker}\n` });
    try {
      const run = await runPi(cwd, ['ls'], 'Call the which tool once with command "node".');
      assert.equal(run.code, 0, dump(run));
      const whichEnded = eventsOf(run, 'tool_execution_end', 'which');
      assert.ok(
        whichEnded.length === 0 || whichEnded.every((event) => event.isError === true && /not enabled/i.test(resultText(event))),
        dump(run),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
