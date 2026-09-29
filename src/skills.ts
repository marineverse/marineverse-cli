import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { CliError } from './errors.js';
import { VERSION } from './version.js';

export type SkillAgent = 'codex' | 'claude';
export type SkillScope = 'user' | 'project';
export type SkillAction = 'install' | 'update' | 'uninstall';
const marker = '.marineverse-skill.json';
const names = ['SKILL.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

export function skillDirectory(agent: SkillAgent, scope: SkillScope, home = homedir(), cwd = process.cwd()): string {
  return join(scope === 'user' ? home : resolve(cwd), agent === 'codex' ? '.agents' : '.claude', 'skills', 'marineverse-cli');
}

export async function bundledSkill(): Promise<string> {
  return readFile(join(packageRoot, 'skills', 'marineverse-cli', 'SKILL.md'), 'utf8');
}

async function assertManaged(directory: string): Promise<void> {
  const conflict = () => new CliError('SKILL_CONFLICT', `The skill at ${directory} is unmanaged or modified. Preserve or move it before replacing/removing it.`, 2);
  try {
    if (!(await lstat(directory)).isDirectory()) throw conflict();
    const entries = await readdir(directory);
    if (entries.length !== names.length + 1 || entries.some(name => ![...names, marker].includes(name))) throw conflict();
    for (const name of [...names, marker]) if (!(await lstat(join(directory, name))).isFile()) throw conflict();
    const manifest = JSON.parse(await readFile(join(directory, marker), 'utf8'));
    if (manifest.owner !== '@marineverse/cli' || manifest.schema_version !== 1) throw conflict();
    for (const name of names) if (hash(await readFile(join(directory, name), 'utf8')) !== manifest.files?.[name]) throw conflict();
  } catch { throw conflict(); }
}

export async function manageSkill(action: SkillAction, agent: SkillAgent, scope: SkillScope,
  paths: { home?: string; cwd?: string } = {}) {
  const directory = skillDirectory(agent, scope, paths.home, paths.cwd);
  const parent = resolve(directory, '..');
  // A project checkout must not redirect installation into another scope.
  for (const path of [resolve(parent, '..'), parent]) {
    const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
    if (info?.isSymbolicLink()) throw new CliError('SKILL_CONFLICT', `Skill installation refuses a symlinked agent directory: ${path}`, 2);
  }
  await mkdir(parent, { recursive: true });
  const lock = join(parent, '.marineverse-install-lock');
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new CliError('SKILL_BUSY', `A skill installation holds ${lock}. If it crashed, inspect that directory before removing its lock.`, 2);
  }
  let staged: string | undefined;
  let backup: string | undefined;
  try {
    const existing = await lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
    if (existing) await assertManaged(directory);
    if (action === 'uninstall') {
      if (existing) await rm(directory, { recursive: true });
      return { agent, scope, path: directory, status: existing ? 'uninstalled' : 'not_installed' };
    }
    if (action === 'update' && !existing) throw new CliError('SKILL_NOT_INSTALLED', 'Run skills install for this agent and scope first.', 2);
    if (action === 'install' && existing) return { agent, scope, path: directory, status: 'already_installed', hint: 'Use skills update to install the copy bundled with this CLI.' };

    const contents: Record<string, string> = { 'SKILL.md': await bundledSkill() };
    for (const name of names.slice(1)) contents[name] = await readFile(join(packageRoot, name), 'utf8');
    const manifest = { owner: '@marineverse/cli', schema_version: 1, cli_version: VERSION,
      files: Object.fromEntries(Object.entries(contents).map(([name, content]) => [name, hash(content)])) };
    staged = await mkdtemp(join(parent, '.marineverse-stage-'));
    for (const [name, content] of Object.entries(contents)) await writeFile(join(staged, name), content, { flag: 'wx' });
    await writeFile(join(staged, marker), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    if (existing) {
      const previous = join(lock, 'previous');
      await rename(directory, previous);
      backup = previous;
    }
    try { await rename(staged, directory); staged = undefined; }
    catch (error) {
      if (backup) { await rename(backup, directory); backup = undefined; }
      throw error;
    }
    if (backup) { await rm(backup, { recursive: true }); backup = undefined; }
    return { agent, scope, path: directory, status: existing ? 'updated' : 'installed', cli_version: VERSION };
  } finally {
    if (staged) await rm(staged, { recursive: true, force: true });
    // Keep a recovery backup and its lock if a rollback failed.
    if (!backup) await rmdir(lock);
  }
}
