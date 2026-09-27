import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Defense in depth: review the exact Git candidates and npm allowlist before release.
// This deliberately reports filenames only, never potentially sensitive matching text.
const candidates = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const forbiddenPaths = /(^|\/)(ai_plans|credentials|node_modules|\.agents|\.codex|\.claude)(\/|$)|(^|\/)(\.env($|\.)|\.npmrc$|\.mcp\.json$|\.claude\.json$)|\.(pem|key|p12|pfx|jks|log|tgz)$/;
const exampleConfig = /(^|\/)(\.env(?:\.[^/]+)?\.example|\.npmrc\.example)$/;
const forbiddenContent = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,}\b/,
  /(?:\/Users\/|C:\\Users\\)[^\s/\\]+[\/\\]/,
  /https:\/\/[^\s/]+:[^\s/]+@/,
];
const failures = [];
function inspect(path, content, location) {
  if (forbiddenPaths.test(path) && !exampleConfig.test(path)) failures.push(`Excluded/private path in ${location}: ${path}`);
  if (forbiddenContent.some(pattern => pattern.test(content))) failures.push(`Potential private data in ${location}: ${path}`);
}
for (const path of candidates) {
  inspect(path, readFileSync(path, 'utf8'), 'working tree');
}
// Inspect index blobs too: sanitizing a working file does not change an earlier git add.
const staged = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const entry of staged) {
  const separator = entry.indexOf('\t');
  const [mode, objectId, stage] = entry.slice(0, separator).split(' ');
  const path = entry.slice(separator + 1);
  if (!['100644', '100755'].includes(mode) || stage !== '0') {
    failures.push(`Unsupported index entry (symlink, submodule, or conflict): ${path}`);
    continue;
  }
  inspect(path, execFileSync('git', ['cat-file', 'blob', objectId], { encoding: 'utf8' }), 'index');
}
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [name, dependency] of Object.entries(lock.packages)) {
  if (dependency.resolved && !dependency.resolved.startsWith('https://registry.npmjs.org/')) failures.push(`Non-public dependency source: ${name}`);
}
const legalFiles = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES'];
assert.deepEqual(manifest.files, ['bin/', 'dist/', 'skills/marineverse/SKILL.md', 'README.md', ...legalFiles]);
assert.equal(manifest.license, 'Apache-2.0');
assert.equal(lock.packages[''].license, manifest.license);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
const { VERSION } = await import(pathToFileURL(resolve('dist/version.js')).href);
assert.equal(VERSION, manifest.version);
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run through npm run check:release.');
const [pack] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--dry-run', '--ignore-scripts', '--json'], { encoding: 'utf8' }));
for (const { path } of pack.files) {
  if (!legalFiles.includes(path) && !/^(package\.json|README\.md|skills\/marineverse\/SKILL\.md|bin\/marineverse\.js|dist\/[a-z-]+\.(js|d\.ts))$/.test(path)) failures.push(`Unexpected package file: ${path}`);
  if (forbiddenContent.some(pattern => pattern.test(readFileSync(path, 'utf8')))) failures.push(`Potential private data in package: ${path}`);
}
assert.ok(pack.files.some(file => file.path === 'dist/cli.js'), 'Build output is missing.');
assert.ok(pack.files.some(file => file.path === 'skills/marineverse/SKILL.md'), 'Bundled skill is missing.');
for (const path of legalFiles) assert.ok(pack.files.some(file => file.path === path), `Missing package legal file: ${path}`);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${candidates.length} Git candidates and ${pack.files.length} npm files. No excluded files or recognized credential patterns found. Manual review remains required.`);
