import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('gitignore protects common local files while retaining public deliverables', () => {
  const ignored = ['docs/ai_plans/private.md', '.env', '.env.production', '.npmrc', 'credentials/account.json',
    'tokens.json', 'node_modules/example/index.js', 'dist/cli.js', 'coverage/index.html', '.cache/item',
    'tmp/session.json', 'test-results/report.json', '.agents/skills/private/SKILL.md', '.claude/settings.json',
    '.mcp.json', '.idea/workspace.xml', '.vscode/settings.json', 'backup.bak', 'private.p12', 'release.tgz'];
  const kept = ['src/cli.ts', 'test/cli.test.mjs', 'package-lock.json', '.env.example', '.env.production.example',
    '.npmrc.example', 'skills/marineverse/SKILL.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES', '.github/workflows/ci.yml'];
  const result = execFileSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], { cwd: root,
    input: [...ignored, ...kept].join('\0') + '\0', encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.deepEqual(result, ignored);
});

test('release check catches sensitive staged content even after the working file is sanitized', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'marineverse-release-'));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  try {
    for (const path of ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES', 'bin', 'dist', 'skills']) {
      await cp(join(root, path), join(directory, path), { recursive: true });
    }
    await mkdir(join(directory, 'src'));
    await cp(join(root, 'src/version.ts'), join(directory, 'src/version.ts'));
    git(['init', '--quiet']);
    const file = join(directory, 'example.txt');
    await writeFile(file, 'ghp_' + 'a'.repeat(36)); // Synthetic scanner fixture, never a real token.
    git(['add', 'example.txt']);
    await writeFile(file, 'Sanitized working copy');
    assert.throws(() => execFileSync(process.execPath, [join(root, 'scripts/check-release.mjs')], {
      cwd: directory, encoding: 'utf8', env: process.env, stdio: 'pipe',
    }), error => error.status === 1 && error.stderr.includes('Potential private data in index: example.txt'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
