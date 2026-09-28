import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const registry = 'https://registry.npmjs.org/';
const execute = (command, args, capture = false) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
})?.trim() || '';

export async function release({ dryRun = false, run = execute, fetcher = fetch, log = console.log } = {}) {
  const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (name !== '@marineverse/cli' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable @marineverse/cli version in package.json.');
  if (!process.env.npm_execpath) throw new Error('Run this script with npm run release.');
  const npm = (args, capture = false) => run(process.execPath, [process.env.npm_execpath, ...args], capture);
  const git = (...args) => run('git', args, true);
  const tag = `v${version}`;
  const head = git('rev-parse', 'HEAD');
  const checkTree = () => {
    if (git('status', '--porcelain') && !dryRun) throw new Error('Commit your changes and push them before releasing.');
    if (git('rev-parse', 'HEAD') !== head) throw new Error('The checkout changed during release. Run the release again.');
  };
  checkTree();
  const branch = git('symbolic-ref', '--short', 'HEAD');
  if (!dryRun && git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0] !== head) {
    throw new Error('Push the current branch to origin and wait for GitHub CI before releasing.');
  }
  const localTag = git('tag', '--list', tag);
  if (localTag && git('rev-parse', `${tag}^{}`) !== head) throw new Error(`${tag} already points to a different commit.`);
  const remoteTags = git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`);
  const refs = new Map(remoteTags.split('\n').filter(Boolean).map(line => line.split(/\s+/).reverse()));
  const remoteHead = refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`);
  if (remoteHead && remoteHead !== head) throw new Error(`Remote ${tag} points to a different commit.`);

  log(`${dryRun ? 'Checking' : 'Releasing'} ${name}@${version}`);
  for (const check of ['test', 'check:release', 'test:package']) npm(['run', check]);
  const temporary = mkdtempSync(join(tmpdir(), 'marineverse-release-'));
  try {
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], true));
    if (!packed?.filename || basename(packed.filename) !== packed.filename || packed.version !== version) throw new Error('Unexpected package output.');
    const tarball = join(temporary, packed.filename);
    const bytes = readFileSync(tarball);
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const metadataUrl = `${registry}@marineverse%2fcli/${version}`;
    const response = await fetcher(metadataUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    let published = false;
    if (response.ok) {
      const metadata = await response.json();
      if (metadata.dist?.integrity !== integrity) throw new Error(`${version} is already published with different contents. Bump the version before publishing.`);
      published = true;
      log('This exact package is already published; skipping npm publish.');
    } else if (response.status !== 404) {
      throw new Error(`Could not check npm (HTTP ${response.status}). Nothing published.`);
    }
    checkTree();
    if (dryRun) {
      log(`Dry run complete. A real release will ${published ? 'reuse the published package' : 'publish this package'}, then create/push ${tag}.`);
    } else {
      if (!published) npm(['publish', tarball, '--access', 'public', '--tag', 'latest', '--registry', registry]);
      // These steps can safely be retried if publication succeeds but Git is unavailable.
      if (!localTag) git('tag', tag, head);
      if (!remoteHead) git('push', 'origin', `refs/tags/${tag}`);
      log(`Released ${name}@${version}.`);
    }
    log(`\nHomebrew formula (${dryRun ? 'after publishing' : 'update and push the tap separately'}):\n  url "${registry}@marineverse/cli/-/cli-${version}.tgz"\n  sha256 "${sha256}"`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run release [-- --dry-run]\nPublish the committed, pushed package version and create/push its Git tag.\n--dry-run runs checks and packs without publishing or changing Git; uncommitted changes are allowed.\nDeploy required backend changes and wait for GitHub CI before releasing.');
  } else if (args.some(arg => arg !== '--dry-run')) {
    console.error('Usage: npm run release [-- --dry-run]');
    process.exitCode = 2;
  } else {
    release({ dryRun: args.includes('--dry-run') }).catch(error => { console.error(`Release stopped: ${error.message}`); process.exitCode = 1; });
  }
}
