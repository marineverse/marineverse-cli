import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { CliError, usage } from './errors.js';

export interface Environment { name: string; apiUrl: string; webUrl: string; clientId?: string }
export interface Config { selected?: string; environments: Record<string, Environment> }
export interface GlobalOptions { env?: string; apiUrl?: string; json?: boolean }

export function configDir(): string {
  return process.env.MARINEVERSE_CONFIG_DIR || (process.platform === 'win32'
    ? join(process.env.APPDATA || homedir(), 'MarineVerse')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'marineverse'));
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export async function readConfig(): Promise<Config> {
  try {
    const value = JSON.parse(await readFile(join(configDir(), 'config.json'), 'utf8'));
    if (!value.environments || typeof value.environments !== 'object') throw new Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { environments: {} };
    throw new CliError('CONFIG_ERROR', 'Cannot read configuration. Check config.json in MARINEVERSE_CONFIG_DIR.', 2);
  }
}

export function origin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return usage('Supply a valid API or website origin.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') usage('Use an origin without credentials, path, query, or fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    usage('HTTPS is required except for localhost/loopback development.');
  }
  return url.origin;
}

export async function resolveEnvironment(options: GlobalOptions): Promise<Environment> {
  const config = await readConfig();
  const name = options.env || process.env.MARINEVERSE_ENV || config.selected || 'production';
  const defaults: Record<string, Environment> = {
    production: { name, apiUrl: 'https://api.marineverse.com', webUrl: 'https://www.marineverse.com', clientId: '40eZdXyuN0o-ZTFrmCP9y5398XvN3qCtYyjq5q8Y4RY' },
    local: { name, apiUrl: 'http://localhost:3000', webUrl: 'http://localhost:3005' },
  };
  const base = Object.hasOwn(config.environments, name) ? config.environments[name] : Object.hasOwn(defaults, name) ? defaults[name] : undefined;
  if (!base) usage(`Unknown environment: ${name}. Use config set first.`);
  const apiUrl = origin(options.apiUrl || process.env.MARINEVERSE_API_URL || base.apiUrl);
  return {
    ...base, name, apiUrl, webUrl: origin(process.env.MARINEVERSE_WEB_URL || base.webUrl),
    clientId: apiUrl === origin(base.apiUrl) ? (process.env.MARINEVERSE_CLIENT_ID || base.clientId) : undefined,
  };
}

export async function setEnvironment(name: string, apiUrl: string, webUrl: string, clientId?: string): Promise<Environment> {
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) usage('Use an environment name containing letters, numbers, underscores, or hyphens, excluding reserved object property names.');
  const config = await readConfig();
  const environment = { name, apiUrl: origin(apiUrl), webUrl: origin(webUrl), clientId };
  config.environments[name] = environment;
  config.selected = name;
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await atomicJson(join(configDir(), 'config.json'), config);
  return environment;
}

export async function selectEnvironment(name: string): Promise<void> {
  const config = await readConfig();
  if (!Object.hasOwn(config.environments, name) && !['local', 'production'].includes(name)) usage(`Unknown environment: ${name}.`);
  config.selected = name;
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await atomicJson(join(configDir(), 'config.json'), config);
}
