import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, rmdir, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson, configDir, type Environment } from './config.js';
import { CliError, errno } from './errors.js';

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
    try { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
    catch (error) { throw new CliError('CREDENTIAL_DIRECTORY_UNWRITABLE', `Cannot create the credential directory (${errno(error)}). Check permissions under ${configDir()}.`, 2); }
    const path = join(this.directory, 'lock');
    for (let attempt = 0; ; attempt++) {
      try { await mkdir(path, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new CliError('AUTH_LOCK_FAILED', `Cannot create the credential lock (${errno(error)}). Check permissions under ${configDir()}.`, 2);
        if (attempt >= 100) throw new CliError('AUTH_BUSY', `Another authentication operation holds ${path}. If it crashed, remove that empty lock directory and retry.`);
        await delay(100);
      }
    }
    try { return await action(); }
    finally {
      await rmdir(path).catch(error => { throw new CliError('AUTH_LOCK_FAILED', `Cannot release the credential lock (${errno(error)}). Remove the empty directory ${path} and retry.`, 2); });
    }
  }

  // Checks the directory, lock and selected store before asking the user to sign in.
  async preflight(storage: Storage): Promise<void> {
    await this.lock(async () => {
      if (storage === 'file' && process.platform === 'win32') throw new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'Use the Windows credential store; file token storage is supported only on Unix.');
      if (storage === 'keyring') {
        try { await (await this.entry('preflight')).getPassword(); }
        catch { throw keyringError(); }
      }
    });
  }

  private async account(): Promise<Account | undefined> {
    const path = join(this.directory, 'account.json');
    let text;
    try { text = await readFile(path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new CliError('CREDENTIAL_DIRECTORY_UNREADABLE', `Cannot read account metadata (${errno(error)}). Check permissions under ${configDir()}.`, 2);
    }
    let account;
    try { account = JSON.parse(text); } catch { /* reported below */ }
    if (typeof account?.userUuid !== 'string' || !['keyring', 'file'].includes(account.storage)) {
      throw new CliError('CREDENTIAL_METADATA_INVALID', `Account metadata is malformed (${path}). Run marineverse auth logout or log in again to replace it.`, 3);
    }
    return account;
  }

  // On Linux the library otherwise falls back silently from Secret Service to the kernel keyring,
  // which is session-bound, so a login would appear to succeed and then vanish. Require Secret Service.
  private async entry(userUuid: string) {
    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      return new AsyncEntry('MarineVerse CLI', `${this.key}:${userUuid}`, { linux: { store: 'secret-service' } });
    } catch { throw keyringError(); }
  }

  async read(): Promise<Credential | undefined> {
    const account = await this.account();
    if (!account) return undefined;
    let value;
    if (account.storage === 'file') {
      try { value = await readFile(join(this.directory, 'tokens.json'), 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CliError('CREDENTIAL_FILE_UNREADABLE', `Cannot read the credential file (${errno(error)}). Check permissions under ${configDir()}.`, 2);
      }
    } else {
      const entry = await this.entry(account.userUuid);
      try { value = await entry.getPassword(); } catch { throw keyringError(); }
    }
    if (!value) {
      throw new CliError('CREDENTIAL_MISSING', `This environment has saved login details, but its tokens are missing from the ${account.storage === 'file' ? 'credential file' : 'OS credential store'}. `
        + 'They may have been removed or kept only for an earlier session. Run marineverse login again.', 3);
    }
    let credential;
    try { credential = JSON.parse(value); } catch { /* reported below */ }
    if (credential?.userUuid !== account.userUuid || typeof credential.accessToken !== 'string' || typeof credential.refreshToken !== 'string' || !Number.isFinite(credential.expiresAt)) {
      throw new CliError('CREDENTIAL_INVALID', 'Stored credentials are malformed. Run marineverse auth logout or log in again to replace them.', 3);
    }
    return credential;
  }

  // Metadata is committed last. If that fails, the replaced tokens are put back so a previous session survives.
  async write(credential: Credential, storage?: Storage): Promise<void> {
    const previous = await this.account().catch(error => { if (error.code === 'CREDENTIAL_METADATA_INVALID') return undefined; throw error; });
    const selected = storage || previous?.storage || 'keyring';
    const tokensPath = join(this.directory, 'tokens.json');
    let restore: () => Promise<unknown>;
    if (selected === 'file') {
      if (process.platform === 'win32') throw new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'Use the Windows credential store; file token storage is supported only on Unix.');
      const old = await readFile(tokensPath, 'utf8').catch(() => undefined);
      try { await chmod(this.directory, 0o700); await atomicJson(tokensPath, credential); }
      catch (error) { throw new CliError('AUTH_CREDENTIAL_SAVE_FAILED', `Could not write the credential file (${errno(error)}).`, 3); }
      restore = () => old === undefined ? unlink(tokensPath) : atomicJson(tokensPath, JSON.parse(old));
    } else {
      const entry = await this.entry(credential.userUuid);
      const old = await entry.getPassword().catch(() => null);
      try { await entry.setPassword(JSON.stringify(credential)); }
      catch { throw new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'Could not save credentials in the OS store. Unlock it, or explicitly use --storage file on Unix.'); }
      restore = () => old ? entry.setPassword(old) : entry.deletePassword();
    }
    try { await atomicJson(join(this.directory, 'account.json'), { userUuid: credential.userUuid, storage: selected }); }
    catch (error) {
      await restore().catch(() => {});
      throw new CliError('AUTH_CREDENTIAL_SAVE_FAILED', `Could not write account metadata (${errno(error)}).`, 3);
    }
    // The new session is saved; removing the previous copy is best effort.
    if (previous?.storage === 'keyring' && (selected !== 'keyring' || previous.userUuid !== credential.userUuid)) {
      try { await (await this.entry(previous.userUuid)).deletePassword(); }
      catch { /* An unavailable old store must not invalidate the saved session. */ }
    }
    if (selected !== 'file') await unlink(tokensPath).catch(() => {});
  }

  // With keepUnavailableSecret, an unreachable OS store does not block clearing the local metadata.
  async remove(keepUnavailableSecret = false): Promise<void> {
    const account = await this.account().catch(error => { if (error.code === 'CREDENTIAL_METADATA_INVALID') return undefined; throw error; });
    if (account?.storage === 'keyring') {
      try { await (await this.entry(account.userUuid)).deletePassword(); }
      catch (error) { if (!keepUnavailableSecret) throw error; }
    }
    for (const name of ['tokens.json', 'account.json']) {
      await unlink(join(this.directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

function keyringError() {
  return new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'The OS credential store is unavailable or locked. Unlock it; on Linux, keyring storage requires a Secret Service '
    + '(such as GNOME Keyring or KWallet), which headless and cloud sessions usually lack. Otherwise explicitly use auth login --storage file on Unix.');
}
