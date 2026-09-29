import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

assert.ok(process.env.npm_execpath, 'Run through npm run test:package.');
const { version: expectedVersion } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'marineverse-package-'));
const npm = args => execFileSync(process.execPath, [process.env.npm_execpath, ...args], { encoding: 'utf8' });
try {
  const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]));
  const install = join(temporary, 'install');
  npm(['install', '--prefix', install, '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)]);
  const bin = join(install, 'node_modules', '@marineverse', 'cli', 'bin', 'marineverse.js');
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES']) {
    const installed = await readFile(join(install, 'node_modules', '@marineverse', 'cli', name), 'utf8');
    assert.equal(installed, await readFile(name, 'utf8'), `Installed ${name} must match the source`);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MARINEVERSE_')));
  env.MARINEVERSE_CONFIG_DIR = join(temporary, 'settings');
  const cli = args => execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd: resolve(temporary), env });
  for (const args of [[], ['help'], ['globe'], ['globe', 'boats'], ['login', '--help']]) assert.match(cli(args), /Usage: marineverse/);
  const skill = await readFile('skills/marineverse-cli/SKILL.md', 'utf8');
  assert.equal(cli(['skills', 'show']), skill);
  for (const agent of ['codex', 'claude']) {
    const args = ['--agent', agent, '--scope', 'project', '--json'];
    const installed = JSON.parse(cli(['skills', 'install', ...args])).data;
    assert.equal(installed.status, 'installed');
    assert.equal(await readFile(join(installed.path, 'SKILL.md'), 'utf8'), skill);
    assert.equal(JSON.parse(cli(['skills', 'update', ...args])).data.status, 'updated');
    assert.equal(JSON.parse(cli(['skills', 'uninstall', ...args])).data.status, 'uninstalled');
  }
  const result = JSON.parse(cli(['--env', 'local', '--json', 'globe', 'boats', 'view-3d', 'test-boat', '--no-browser']));
  assert.equal(result.data.url, 'http://localhost:3005/globe/boats-profiles/test-boat/3d');
  assert.equal(result.data.browser_opened, false);
  assert.equal(cli(['--version']).trim(), expectedVersion);
  console.log('Packed CLI installs and runs independently of the checkout.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
