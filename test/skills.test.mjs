import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { manageSkill, skillDirectory, bundledSkill } from '../dist/skills.js';
import { run } from '../dist/cli.js';

async function isolated(action) {
  const directory = await mkdtemp(join(tmpdir(), 'marineverse-skills-'));
  try { await action({ home: join(directory, 'home'), cwd: join(directory, 'project') }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('both agents install, update, and uninstall only in the requested scope', async () => {
  await isolated(async paths => {
    for (const agent of ['codex', 'claude']) {
      for (const scope of ['user', 'project']) {
        const installed = await manageSkill('install', agent, scope, paths);
        assert.equal(installed.status, 'installed');
        assert.equal(installed.path, skillDirectory(agent, scope, paths.home, paths.cwd));
        assert.equal(await readFile(join(installed.path, 'SKILL.md'), 'utf8'), await bundledSkill());
        assert.match(await readFile(join(installed.path, 'LICENSE'), 'utf8'), /Apache License/);
        assert.match(await readFile(join(installed.path, 'references', 'clubs.md'), 'utf8'), /groups search/);
        assert.equal((await manageSkill('install', agent, scope, paths)).status, 'already_installed');
        assert.equal((await manageSkill('update', agent, scope, paths)).status, 'updated');
        assert.equal((await manageSkill('uninstall', agent, scope, paths)).status, 'uninstalled');
        assert.equal((await manageSkill('uninstall', agent, scope, paths)).status, 'not_installed');
        await assert.rejects(manageSkill('update', agent, scope, paths), { code: 'SKILL_NOT_INSTALLED' });
      }
    }
  });
});

test('customized, unmanaged, extra-file and custom-reference skills survive every operation', async () => {
  for (const mode of ['customized', 'unmanaged', 'extra', 'reference', 'extra-reference', 'symlink-reference']) await isolated(async paths => {
    const { path } = await manageSkill('install', 'codex', 'project', paths);
    if (mode === 'customized') await writeFile(join(path, 'SKILL.md'), 'User customization');
    if (mode === 'unmanaged') await rm(join(path, '.marineverse-skill.json'));
    if (mode === 'extra') await writeFile(join(path, 'personal-notes.md'), 'Keep this');
    if (mode === 'reference') await writeFile(join(path, 'references', 'clubs.md'), 'User reference customization');
    if (mode === 'extra-reference') await writeFile(join(path, 'references', 'personal.md'), 'Keep this reference');
    if (mode === 'symlink-reference') {
      await rm(join(path, 'references', 'clubs.md'));
      await symlink(join(path, 'SKILL.md'), join(path, 'references', 'clubs.md'));
    }
    const before = await readdir(path);
    const content = await readFile(join(path, 'SKILL.md'), 'utf8');
    for (const action of ['install', 'update', 'uninstall']) {
      await assert.rejects(manageSkill(action, 'codex', 'project', paths), { code: 'SKILL_CONFLICT' });
      assert.deepEqual(await readdir(path), before);
      assert.equal(await readFile(join(path, 'SKILL.md'), 'utf8'), content);
    }
  });
});

test('symlinked project agent directories cannot redirect skill operations', async () => {
  await isolated(async paths => {
    await mkdir(paths.home, { recursive: true });
    await mkdir(paths.cwd, { recursive: true });
    await symlink(paths.home, join(paths.cwd, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const action of ['install', 'update', 'uninstall']) {
      await assert.rejects(manageSkill(action, 'codex', 'project', paths), { code: 'SKILL_CONFLICT' });
      assert.deepEqual(await readdir(paths.home), []);
    }
  });
});

test('legacy managed single-file skills upgrade with references', async () => {
  await isolated(async paths => {
    const { path } = await manageSkill('install', 'codex', 'project', paths);
    const marker = join(path, '.marineverse-skill.json');
    const manifest = JSON.parse(await readFile(marker, 'utf8'));
    await rm(join(path, 'references'), { recursive: true });
    for (const name of Object.keys(manifest.files)) if (name.startsWith('references/')) delete manifest.files[name];
    await writeFile(marker, JSON.stringify(manifest));
    assert.equal((await manageSkill('update', 'codex', 'project', paths)).status, 'updated');
    assert.match(await readFile(join(path, 'references', 'clubs.md'), 'utf8'), /groups search/);
  });
});

test('busy installer preserves another operation and leaves its lock alone', async () => {
  await isolated(async paths => {
    const parent = join(paths.home, '.agents', 'skills');
    await mkdir(join(parent, '.marineverse-install-lock'), { recursive: true });
    await assert.rejects(manageSkill('install', 'codex', 'user', paths), { code: 'SKILL_BUSY' });
    assert.deepEqual(await readdir(parent), ['.marineverse-install-lock']);
  });
});

test('skill help and output require neither config nor API access', async () => {
  for (const args of [['skills'], ['skills', 'install', '--help'], ['skills', 'show', '--json']]) {
    let stdout = '';
    const code = await run(['node', 'marineverse', ...args], {
      client: () => { throw new Error('Unexpected API client'); }, stdout: value => stdout += value, stderr: assert.fail,
    });
    assert.equal(code, 0);
    if (args.includes('--json')) assert.equal(JSON.parse(stdout).data.skill, await bundledSkill());
    else assert.match(stdout, /Usage:/);
  }
});
