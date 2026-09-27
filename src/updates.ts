import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { CliError } from './errors.js';
import { CLIENT_NAME, VERSION } from './version.js';

export type Installation = 'homebrew' | 'npm-global' | 'npm-local' | 'npx' | 'source' | 'unknown';
export interface VersionInfo {
  installed: string;
  latest: string | null;
  status: 'update_available' | 'up_to_date' | 'check_unavailable';
  installation: Installation;
  upgrade_command: string | null;
}

// Inspect the installed package, not the working directory or whichever executable is first on PATH.
export function detectInstallation(packagePath: string, sourceCheckout = false, executableDirectory = dirname(process.execPath)): Installation {
  const path = packagePath.replaceAll('\\', '/');
  if (/\/(?:Cellar|opt)\/marineverse\/.*libexec\/lib\/node_modules\/@marineverse\/cli$/.test(path)) return 'homebrew';
  if (/\/_npx\/[^/]+\/node_modules\/@marineverse\/cli$/.test(path)) return 'npx';
  if (/\/(?:lib|npm)\/node_modules\/@marineverse\/cli$/.test(path)) return 'npm-global';
  if (/^[a-z]:\//i.test(path) && path.toLowerCase() === `${executableDirectory.replaceAll('\\', '/').toLowerCase()}/node_modules/@marineverse/cli`) return 'npm-global';
  if (/\/node_modules\/@marineverse\/cli$/.test(path)) return 'npm-local';
  return sourceCheckout ? 'source' : 'unknown';
}

function packageRoot(): string {
  return realpathSync(fileURLToPath(new URL('..', import.meta.url)));
}
function installation(): Installation {
  const root = packageRoot();
  return detectInstallation(root, existsSync(join(root, '.git')));
}

export function upgradeCommand(method: Installation): string | null {
  switch (method) {
    case 'homebrew': return 'brew update && brew upgrade marineverse/tap/marineverse';
    case 'npm-global': return 'npm install -g @marineverse/cli@latest';
    case 'npm-local': return 'npm install @marineverse/cli@latest';
    case 'npx': return 'npx @marineverse/cli@latest --help';
    case 'source': return 'git pull --ff-only && npm ci && npm run build';
    default: return null;
  }
}

export interface UpgradeStep { command: string; args: string[]; cwd?: string; prefix?: string }
export interface UpgradeResult { installation: Installation; upgraded: boolean; message: string; upgrade_command: string | null }

export function upgradeSteps(method: Installation, root: string): UpgradeStep[] {
  // Pin npm to the installation being run, including custom global prefixes.
  const path = root.replaceAll('\\', '/');
  const nodeModules = path.lastIndexOf('/node_modules/@marineverse/cli');
  if (method === 'npm-global' && nodeModules >= 0) {
    const prefix = path.slice(0, nodeModules).replace(/\/lib$/, '');
    return [{ command: 'npm', args: ['install', '--global', '@marineverse/cli@latest'], prefix }];
  }
  if (method === 'npm-local' && nodeModules >= 0) {
    return [{ command: 'npm', args: ['install', '@marineverse/cli@latest'], cwd: path.slice(0, nodeModules) }];
  }
  if (method === 'homebrew') {
    const prefix = path.split(/\/(?:Cellar|opt)\/marineverse\//)[0]!;
    return [{ command: `${prefix}/bin/brew`, args: ['update'] },
      { command: `${prefix}/bin/brew`, args: ['upgrade', 'marineverse/tap/marineverse'] }];
  }
  return [];
}

async function runStep(step: UpgradeStep, output: (message: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: step.prefix ? { ...process.env, npm_config_prefix: step.prefix } : process.env,
      // Windows npm is a .cmd launcher. Only fixed npm arguments go through its shell.
      shell: process.platform === 'win32' && step.command === 'npm',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => output(String(chunk)));
    child.stderr.on('data', chunk => output(String(chunk)));
    child.once('error', () => reject(new CliError('UPGRADE_FAILED', 'Could not start the package manager. Check that npm or Homebrew is available.')));
    child.once('close', code => code === 0 ? resolve() : reject(new CliError('UPGRADE_FAILED', 'The package manager could not complete the upgrade. See its output above.')));
  });
}

export async function upgrade(output: (message: string) => void, root = packageRoot(), runner = runStep): Promise<UpgradeResult> {
  const method = detectInstallation(root, existsSync(join(root, '.git')));
  const steps = upgradeSteps(method, root);
  const command = upgradeCommand(method);
  if (!steps.length) return { installation: method, upgraded: false, upgrade_command: command,
    message: method === 'source' ? `This is a source checkout. Update from the checkout when your changes are ready:\n  ${command}`
      : method === 'npx' ? `This is a temporary npx installation. Run the latest release:\n  ${command}`
        : 'Installation method could not be detected. See https://www.marineverse.com/cli for installation instructions.' };
  output(`Upgrading MarineVerse CLI using ${method === 'homebrew' ? 'Homebrew' : 'npm'}…\n`);
  for (const step of steps) await runner(step, output);
  return { installation: method, upgraded: true, upgrade_command: command, message: 'Upgrade finished. Run marineverse --version to verify the installed version.' };
}

function stableVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every(part => Number.isSafeInteger(Number(part)));
}

export function newerRelease(latest: string, installed: string): boolean {
  const [base, prerelease] = installed.split('-');
  if (!stableVersion(latest) || !stableVersion(base)) return false;
  const current = base.split('.').map(Number);
  for (const [index, part] of latest.split('.').map(Number).entries()) {
    if (part !== current[index]) return part > current[index]!;
  }
  return !!prerelease;
}

export async function checkVersion(fetcher: typeof fetch = fetch, method = installation()): Promise<VersionInfo> {
  const result: VersionInfo = { installed: VERSION, latest: null, status: 'check_unavailable', installation: method, upgrade_command: upgradeCommand(method) };
  try {
    // An explicit, anonymous check: no account credentials, redirects, retries, or persistent settings.
    const response = await fetcher('https://registry.npmjs.org/@marineverse%2fcli/latest', {
      headers: { Accept: 'application/json', 'User-Agent': `${CLIENT_NAME}/${VERSION}` },
      redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) { await response.body?.cancel(); return result; }
    const metadata = await response.json() as { version?: unknown };
    if (!stableVersion(metadata?.version)) return result;
    result.latest = metadata.version;
    result.status = newerRelease(metadata.version, VERSION) ? 'update_available' : 'up_to_date';
  } catch { /* Offline or unavailable registry: still show the installed version and upgrade instructions. */ }
  return result;
}

export function versionMessage(info: VersionInfo): string {
  const lines = [`MarineVerse CLI ${info.installed}`];
  if (info.status === 'update_available') lines.push(`A newer release is available: ${info.latest}`);
  else if (info.status === 'up_to_date') lines.push('You are up to date.');
  else lines.push('Could not check for updates. Try marineverse version again later.');
  if (info.upgrade_command) {
    if (['homebrew', 'npm-global', 'npm-local'].includes(info.installation)) lines.push('\nUpgrade with: marineverse upgrade');
    lines.push(`\n${info.installation === 'source' ? 'Update from your CLI checkout' : info.installation === 'npx' ? 'Run the latest release' : 'To upgrade'}:\n  ${info.upgrade_command}`);
    if (info.installation === 'homebrew') lines.push('Homebrew releases can arrive after npm releases.');
  } else lines.push('\nInstallation method could not be detected. See https://www.marineverse.com/cli for installation instructions.');
  return lines.join('\n');
}
