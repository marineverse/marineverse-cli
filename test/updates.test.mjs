import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { checkVersion, detectInstallation, newerRelease, runUpgradeStep, upgrade, upgradeSteps, versionMessage } from '../dist/updates.js';
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
    assert.equal(result.upgrade_command, 'npm install -g --prefer-online @marineverse/cli@latest');
    assert.match(versionMessage(result), /Could not check/);
  }
});

test('upgrades target the actual installation and never interpolate paths into shell commands', async () => {
  const executed = [];
  const runner = async step => { executed.push(step); };
  const npm = await upgrade(() => {}, '/custom prefix/lib/node_modules/@marineverse/cli', runner);
  assert.equal(npm.upgraded, true);
  assert.deepEqual(executed.splice(0), [{ command: 'npm', args: ['install', '--global', '--prefer-online', '@marineverse/cli@latest'], prefix: '/custom prefix' }]);
  await upgrade(() => {}, '/project with spaces/node_modules/@marineverse/cli', runner);
  assert.deepEqual(executed.splice(0), [{ command: 'npm', args: ['install', '--prefer-online', '@marineverse/cli@latest'], cwd: '/project with spaces' }]);
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

function packageManager(chunks, code = 1) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      for (const [stream, text] of chunks) child[stream].emit('data', Buffer.from(text));
      child.emit('close', code);
    });
    return child;
  };
}

const npmStep = upgradeSteps('npm-global', '/custom/lib/node_modules/@marineverse/cli')[0];
const missingVersion = 'npm error code ETARGET\nnpm error notarget No matching version found for @marineverse/cli@0.1.99.\n';
const missingTarball = 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@marineverse/cli/-/cli-0.1.99.tgz - Not found\n';

test('npm missing CLI releases preserve diagnostics and suggest retrying, including split chunks', async () => {
  for (const diagnostic of [missingVersion, missingTarball, missingVersion.replaceAll('npm error', 'npm ERR!'), missingTarball.replaceAll('npm error', 'npm ERR!')]) {
    let output = '';
    const chunks = [['stderr', 'x'.repeat(100000)], ['stderr', diagnostic.slice(0, 31)],
      ['stdout', 'progress\n'], ['stderr', diagnostic.slice(31, 78)], ['stderr', diagnostic.slice(78)]];
    await assert.rejects(runUpgradeStep(npmStep, text => output += text, packageManager(chunks)), error => {
      assert.equal(error.code, 'UPGRADE_FAILED');
      assert.match(error.message, /may not be available from npm yet/);
      assert.match(error.message, /Wait a few minutes and run marineverse upgrade again/);
      return true;
    });
    assert.equal(output, chunks.map(([, text]) => text).join(''));
  }
});

test('unrelated npm failures and Homebrew keep the generic failure message; success remains successful', async () => {
  for (const diagnostic of [
    missingVersion.replace('@marineverse/cli@', '@other/dependency@'),
    missingVersion.replace('@marineverse/cli@', '@marineverse/cli-extra@'),
    missingTarball.replace('@marineverse/cli/', '@other/dependency/'),
    'npm error code E404\nnpm error 404 https://registry.npmjs.org/@marineverse%2fcli - Not found\n',
    'npm error code E401\nnpm error Unable to authenticate @marineverse/cli\n',
    'npm error code ECONNRESET\nnpm error network request for @marineverse/cli failed\n',
  ]) {
    await assert.rejects(runUpgradeStep(npmStep, () => {}, packageManager([['stderr', diagnostic]])), /could not complete the upgrade/);
  }
  await assert.rejects(runUpgradeStep({ command: 'brew', args: ['update'] }, () => {}, packageManager([['stderr', missingVersion]])), /could not complete the upgrade/);
  await runUpgradeStep(npmStep, () => {}, packageManager([['stderr', missingVersion]], 0));
});

test('a missing npm release reaches JSON as UPGRADE_FAILED with exit code 7 and diagnostics on stderr', async () => {
  let stdout = '', stderr = '';
  const services = {
    stdout: text => stdout += text, stderr: text => stderr += text,
    upgrade: output => upgrade(output, '/custom/lib/node_modules/@marineverse/cli',
      (step, write) => runUpgradeStep(step, write, packageManager([['stderr', missingTarball]]))),
  };
  assert.equal(await run(['node', 'marineverse', 'upgrade', '--json'], services), 7);
  assert.equal(JSON.parse(stdout).error.code, 'UPGRADE_FAILED');
  assert.match(JSON.parse(stdout).error.message, /Wait a few minutes and run marineverse upgrade again/);
  assert.match(stderr, /npm error code E404/);
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
