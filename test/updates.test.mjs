import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkVersion, detectInstallation, newerRelease, upgrade, upgradeSteps, versionMessage } from '../dist/updates.js';
import { VERSION } from '../dist/version.js';
import { run } from '../dist/cli.js';
import { CliError } from '../dist/errors.js';

test('detects the running installation on macOS, Linux, and Windows', () => {
  for (const root of ['/opt/homebrew/Cellar/marineverse/0.1.0/libexec/lib/node_modules/@marineverse/cli',
    '/home/linuxbrew/.linuxbrew/Cellar/marineverse/0.1.0/libexec/lib/node_modules/@marineverse/cli',
    '/usr/local/opt/marineverse/libexec/lib/node_modules/@marineverse/cli']) {
    assert.equal(detectInstallation(root), 'homebrew');
    assert.match(upgradeSteps('homebrew', root)[0].command, /\/bin\/brew$/);
  }
  assert.equal(detectInstallation('/opt/node/lib/node_modules/@marineverse/cli'), 'npm-global');
  assert.equal(detectInstallation('C:\\Tools\\npm\\node_modules\\@marineverse\\cli'), 'npm-global');
  assert.equal(detectInstallation('C:\\Tools\\node\\node_modules\\@marineverse\\cli', false, 'C:\\Tools\\node'), 'npm-global');
  assert.equal(detectInstallation('/cache/_npx/abc/node_modules/@marineverse/cli'), 'npx');
  assert.equal(detectInstallation('/project/node_modules/@marineverse/cli'), 'npm-local');
  assert.equal(detectInstallation('/project/cli', true), 'source');
  assert.equal(detectInstallation('/unrecognized/cli'), 'unknown');
});

test('compares stable releases numerically, including prerelease installations', () => {
  assert.equal(newerRelease('1.10.0', '1.9.9'), true);
  assert.equal(newerRelease('1.9.9', '1.10.0'), false);
  assert.equal(newerRelease('2.0.0', '1.99.99'), true);
  assert.equal(newerRelease('1.0.0', '1.0.0'), false);
  assert.equal(newerRelease('1.0.0', '1.0.0-beta.1'), true);
  assert.equal(newerRelease('1.0.0; command', '0.1.0'), false);
});

test('version check is anonymous, bounded, and supplies package-manager instructions', async () => {
  let calls = 0;
  const result = await checkVersion(async (url, options) => {
    calls++;
    assert.equal(url, 'https://registry.npmjs.org/@marineverse%2fcli/latest');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'User-Agent']);
    return Response.json({ version: '999.0.0', upgrade_command: 'untrusted command' });
  }, 'homebrew');
  assert.equal(calls, 1);
  assert.equal(result.installed, VERSION);
  assert.equal(result.status, 'update_available');
  assert.equal(result.upgrade_command, 'brew update && brew upgrade marineverse/tap/marineverse');
  assert.match(versionMessage(result), /marineverse upgrade/);
  assert.match(versionMessage(result), /Homebrew releases can arrive after npm/);
  assert.doesNotMatch(versionMessage(result), /untrusted/);
  assert.equal((await checkVersion(async () => Response.json({ version: VERSION }), 'npm-global')).status, 'up_to_date');
});

test('offline, rate limits, and invalid registry responses still report installed version without retries', async () => {
  for (const response of [null, new Response('', { status: 429 }), Response.json({ version: 'bad\u001b[31m' }), Response.json(null), Response.json({ version: '999999999999999999999.0.0' })]) {
    let calls = 0;
    const result = await checkVersion(async () => { calls++; if (response === null) throw new Error('offline'); return response; }, 'npm-global');
    assert.equal(calls, 1);
    assert.equal(result.installed, VERSION);
    assert.equal(result.latest, null);
    assert.equal(result.status, 'check_unavailable');
    assert.equal(result.upgrade_command, 'npm install -g @marineverse/cli@latest');
    assert.match(versionMessage(result), /Could not check/);
  }
});

test('upgrades target the actual installation and never interpolate paths into shell commands', async () => {
  const executed = [];
  const runner = async step => { executed.push(step); };
  const npm = await upgrade(() => {}, '/custom prefix/lib/node_modules/@marineverse/cli', runner);
  assert.equal(npm.upgraded, true);
  assert.deepEqual(executed.splice(0), [{ command: 'npm', args: ['install', '--global', '@marineverse/cli@latest'], prefix: '/custom prefix' }]);
  await upgrade(() => {}, '/project with spaces/node_modules/@marineverse/cli', runner);
  assert.deepEqual(executed.splice(0), [{ command: 'npm', args: ['install', '@marineverse/cli@latest'], cwd: '/project with spaces' }]);
  await upgrade(() => {}, '/opt/homebrew/Cellar/marineverse/0.1.0/libexec/lib/node_modules/@marineverse/cli', runner);
  assert.deepEqual(executed.splice(0), [
    { command: '/opt/homebrew/bin/brew', args: ['update'] },
    { command: '/opt/homebrew/bin/brew', args: ['upgrade', 'marineverse/tap/marineverse'] },
  ]);
  for (const root of [fileURLToPath(new URL('..', import.meta.url)), '/unknown/cli', '/cache/_npx/abc/node_modules/@marineverse/cli']) {
    assert.equal((await upgrade(() => {}, root, runner)).upgraded, false);
  }
  assert.deepEqual(executed, []);
  let attempts = 0;
  await assert.rejects(upgrade(() => {}, '/opt/homebrew/Cellar/marineverse/0.1.0/libexec/lib/node_modules/@marineverse/cli', async () => {
    attempts++; throw new CliError('UPGRADE_FAILED', 'Package manager failed');
  }), /Package manager failed/);
  assert.equal(attempts, 1, 'A failed brew update must not proceed to brew upgrade');
});

test('version and upgrade need no API configuration, keep JSON clean, and propagate upgrade failure', async () => {
  let stdout = '', stderr = '';
  const services = {
    client: () => { throw new Error('Must not access the API'); },
    stdout: value => stdout += value, stderr: value => stderr += value,
    checkVersion: () => checkVersion(async () => Response.json({ version: '999.0.0' }), 'npm-global'),
    upgrade: async output => { output('Package manager output\n'); return { upgraded: true, message: 'Finished' }; },
  };
  assert.equal(await run(['node', 'marineverse', 'version', '--json', '--api-url', 'invalid'], services), 0);
  assert.equal(JSON.parse(stdout).data.status, 'update_available');
  stdout = '';
  assert.equal(await run(['node', 'marineverse', 'upgrade', '--json'], services), 0);
  assert.equal(JSON.parse(stdout).data.upgraded, true);
  assert.equal(stderr, 'Package manager output\n');
  stdout = '';
  services.upgrade = async () => { throw new CliError('UPGRADE_FAILED', 'Failed'); };
  assert.equal(await run(['node', 'marineverse', 'upgrade', '--json'], services), 7);
  assert.equal(JSON.parse(stdout).error.code, 'UPGRADE_FAILED');
});
