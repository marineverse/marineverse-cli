import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { release } from '../scripts/release.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const artifact = Buffer.from('Synthetic release artifact');
const integrity = `sha512-${createHash('sha512').update(artifact).digest('base64')}`;

function fixture({ dirty = false, pushed = true, existing = false, mismatch = false, http = 404, failedCheck, tagConflict = false } = {}) {
  const calls = [];
  const log = [];
  let fetched = false;
  const run = (command, args) => {
    const kind = command === 'git' ? 'git' : 'npm';
    const parts = kind === 'git' ? args : args.slice(1);
    calls.push([kind, ...parts]);
    if (kind === 'git') {
      if (args[0] === 'status') return dirty ? ' M README.md' : '';
      if (args[0] === 'rev-parse') return 'commit-head';
      if (args[0] === 'symbolic-ref') return 'master';
      if (args[0] === 'ls-remote') {
        if (args[2].startsWith('refs/heads/')) return `${pushed ? 'commit-head' : 'older-commit'}\trefs/heads/master`;
        return tagConflict ? `different-commit\trefs/tags/v${version}` : '';
      }
      return '';
    }
    if (parts[0] === 'run' && parts[1] === failedCheck) throw new Error('Check failed');
    if (parts[0] === 'pack') {
      const filename = `cli-${version}.tgz`;
      writeFileSync(join(parts.at(-1), filename), artifact);
      return JSON.stringify([{ filename, version }]);
    }
    return '';
  };
  return {
    calls, log,
    options: { run, log: message => log.push(message), fetcher: async url => {
      fetched = true;
      assert.equal(url, `https://registry.npmjs.org/@marineverse%2fcli/${version}`);
      return existing ? Response.json({ dist: { integrity: mismatch ? 'different-artifact' : integrity } }) : new Response('', { status: http });
    } },
    get fetched() { return fetched; },
  };
}

test('release publishes the checked artifact before creating and pushing the version tag', async () => {
  const f = fixture();
  await release(f.options);
  assert.deepEqual(f.calls.filter(c => c[0] === 'npm' && c[1] === 'run').map(c => c[2]), ['test', 'check:release', 'test:package']);
  const publish = f.calls.findIndex(c => c[1] === 'publish');
  const tag = f.calls.findIndex(c => c[0] === 'git' && c[1] === 'tag' && c[2] !== '--list');
  const push = f.calls.findIndex(c => c[1] === 'push');
  assert.ok(publish >= 0 && publish < tag && tag < push);
  assert.deepEqual(f.calls[publish].slice(3), ['--access', 'public', '--tag', 'latest', '--registry', 'https://registry.npmjs.org/']);
  assert.deepEqual(f.calls[tag], ['git', 'tag', `v${version}`, 'commit-head']);
  assert.match(f.log.at(-1), new RegExp(createHash('sha256').update(artifact).digest('hex')));
});

test('dry runs allow uncommitted changes but never publish, tag, or push', async () => {
  const f = fixture({ dirty: true, pushed: false });
  await release({ ...f.options, dryRun: true });
  assert.ok(f.calls.some(c => c[1] === 'pack'));
  assert.ok(!f.calls.some(c => c[1] === 'publish' || c[1] === 'push' || (c[1] === 'tag' && c[2] !== '--list')));
});

test('dirty or unpushed commits, conflicting tags, and failed checks cannot publish', async () => {
  for (const options of [{ dirty: true }, { pushed: false }, { tagConflict: true }, { failedCheck: 'test' }]) {
    const f = fixture(options);
    await assert.rejects(release(f.options));
    assert.ok(!f.calls.some(c => c[1] === 'publish' || c[1] === 'push'));
    assert.equal(f.fetched, false);
  }
});

test('retries reuse only the exact published artifact; registry errors stop release', async () => {
  const same = fixture({ existing: true });
  await release(same.options);
  assert.ok(!same.calls.some(c => c[1] === 'publish'));
  assert.ok(same.calls.some(c => c[1] === 'push'));
  for (const options of [{ existing: true, mismatch: true }, { http: 403 }, { http: 500 }]) {
    const f = fixture(options);
    await assert.rejects(release(f.options));
    assert.ok(!f.calls.some(c => c[1] === 'publish' || c[1] === 'push'));
  }
});
