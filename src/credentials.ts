import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, rmdir, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson, configDir, type Environment } from './config.js';
import { CliError } from './errors.js';

export type Storage = 'keyring' | 'file';
export interface Credential {
  accessToken: string; refreshToken: string; expiresAt: number; scopes: string[]; userUuid: string;
}
interface Account { userUuid: string; storage: Storage }

export class Credentials {
  readonly key: string;
  readonly directory: string;
  constructor(environment: Environment) {
    this.key = createHash('sha256').update(JSON.stringify([resolve(configDir()), environment.name, environment.apiUrl, environment.clientId])).digest('hex');
    this.directory = join(configDir(), 'credentials', this.key);
  }

  async lock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, 'lock');
    for (let attempt = 0; ; attempt++) {
      try { await mkdir(path, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (attempt >= 100) throw new CliError('AUTH_BUSY', `Another authentication operation holds ${path}. If it crashed, remove that empty lock directory and retry.`);
        await delay(100);
      }
    }
    try { return await action(); } finally { await rmdir(path); }
  }

  private async account(): Promise<Account | undefined> {
    try { return JSON.parse(await readFile(join(this.directory, 'account.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }

  private async entry(userUuid: string) {
    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      return new AsyncEntry('MarineVerse CLI', `${this.key}:${userUuid}`);
    } catch { throw new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'OS credential store unavailable. On Unix, explicitly select auth login --storage file if needed.'); }
  }

  async read(): Promise<Credential | undefined> {
    const account = await this.account();
    if (!account) return undefined;
    try {
      const value = account.storage === 'file'
        ? await readFile(join(this.directory, 'tokens.json'), 'utf8')
        : await (await this.entry(account.userUuid)).getPassword();
      if (!value) return undefined;
      const credential = JSON.parse(value);
      if (credential.userUuid !== account.userUuid || typeof credential.accessToken !== 'string' || typeof credential.refreshToken !== 'string' || !Number.isFinite(credential.expiresAt)) throw new Error();
      return credential;
    } catch { throw new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'Cannot read stored credentials. Unlock the OS credential store, or log in again with an available storage mode.'); }
  }

  async write(credential: Credential, storage?: Storage): Promise<void> {
    const previous = await this.account();
    const selected = storage || previous?.storage || 'keyring';
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (selected === 'file') {
      if (process.platform === 'win32') throw new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'Use the Windows credential store; file token storage is supported only on Unix.');
      await chmod(this.directory, 0o700);
      await atomicJson(join(this.directory, 'tokens.json'), credential);
    } else {
      try { await (await this.entry(credential.userUuid)).setPassword(JSON.stringify(credential)); }
      catch { throw new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'Could not save credentials in the OS store. Unlock it, or explicitly use --storage file on Unix.'); }
    }
    await atomicJson(join(this.directory, 'account.json'), { userUuid: credential.userUuid, storage: selected });
    if (previous?.storage === 'keyring' && (selected !== 'keyring' || previous.userUuid !== credential.userUuid)) {
      await (await this.entry(previous.userUuid)).deletePassword();
    }
    if (selected !== 'file') await unlink(join(this.directory, 'tokens.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }

  async remove(): Promise<void> {
    const account = await this.account();
    if (account?.storage === 'keyring') await (await this.entry(account.userUuid)).deletePassword();
    for (const name of ['tokens.json', 'account.json']) {
      await unlink(join(this.directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
