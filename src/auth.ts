import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import type { Environment } from './config.js';
import { Credentials, type Credential, type Storage } from './credentials.js';
import { CliError, authRequired } from './errors.js';
import { request } from './http.js';
import { callbackPage } from './callback-page.js';

export async function callback(timeoutMs = 180_000) {
  const state = randomBytes(32).toString('base64url');
  let resolve!: (code: string) => void;
  let reject!: (error: Error) => void;
  const code = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  // The caller may still be opening the browser when a callback arrives.
  void code.catch(() => {});
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (req.method !== 'GET' || url.pathname !== '/marineverse-cli/callback') { res.writeHead(404).end('Not found'); return; }
    const received = Buffer.from(url.searchParams.get('state') || '');
    const expected = Buffer.from(state);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      res.writeHead(400).end(callbackPage('invalid'));
      reject(new CliError('AUTH_STATE_MISMATCH', 'OAuth state did not match. Start login again.', 3));
    } else if (url.searchParams.has('error')) {
      res.writeHead(400).end(callbackPage('denied'));
      reject(new CliError('AUTH_DENIED', 'Authorization was denied.', 3));
    } else if (!url.searchParams.get('code')) {
      res.writeHead(400).end(callbackPage('invalid'));
      reject(new CliError('AUTH_CALLBACK_INVALID', 'Missing authorization code.', 3));
    } else {
      res.end(callbackPage('received'));
      resolve(url.searchParams.get('code')!);
    }
  });
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const timer = setTimeout(() => reject(new CliError('AUTH_TIMEOUT', 'Login timed out. Start login again.', 3)), timeoutMs);
  return {
    state, code, redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/marineverse-cli/callback`,
    close() { clearTimeout(timer); server.close(); server.closeAllConnections(); },
  };
}

export async function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Browser launch failed')));
  });
}

export type LoginMethod = 'browser' | 'device';

// Prompts go to stderr so stdout stays machine-readable. Ctrl+C or Ctrl+D answers undefined.
function ask(question: string): Promise<string | undefined> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(resolve => {
    prompt.once('close', () => resolve(undefined));
    prompt.on('SIGINT', () => prompt.close());
    prompt.question(question, answer => { resolve(answer.trim()); prompt.close(); });
  });
}

// Enter selects browser login.
export async function chooseLoginMethod(): Promise<LoginMethod | undefined> {
  process.stderr.write('How would you like to sign in?\n'
    + '  1. Browser login (default): opens MarineVerse in a browser on this computer\n'
    + '  2. Device code login: use another browser or device when this computer\'s localhost cannot be reached\n');
  return ({ '': 'browser', 1: 'browser', 2: 'device' } as Record<string, LoginMethod>)[await ask('Choose 1 or 2 [1]: ') ?? 'cancel'];
}

// Asked only after the browser login listener has closed; the default is no.
export async function confirmDeviceLogin(): Promise<boolean> {
  return /^y(es)?$/i.test(await ask('Browser login did not reach this computer. Try device code login instead? [y/N]: ') ?? '');
}

const LOGIN_SCOPE = 'public globe_read globe_write sailing_cv kb_read ai_ask feedback_read feedback_write clubs_read clubs_write';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

// RFC 8628 section 3.2. Only the verification URL and short user code are ever shown.
function deviceAuthorization(body: any, webUrl: string) {
  let uri: URL | undefined, complete: URL | undefined;
  try { uri = new URL(body.verification_uri); complete = new URL(body.verification_uri_complete ?? body.verification_uri); } catch { /* invalid below */ }
  if (typeof body.device_code !== 'string' || !body.device_code || typeof body.user_code !== 'string' || !/^[A-Z0-9-]{4,16}$/.test(body.user_code)
    || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || (body.interval !== undefined && (!Number.isFinite(body.interval) || body.interval <= 0))) {
    throw new CliError('INVALID_RESPONSE', 'Device login returned an invalid response.');
  }
  if (uri?.origin !== webUrl || complete?.origin !== webUrl) {
    throw new CliError('INVALID_RESPONSE', 'Device login returned a verification page outside the configured MarineVerse website.');
  }
  return { deviceCode: body.device_code as string, userCode: body.user_code as string, uri: uri.href, complete: complete.href,
    expiresIn: body.expires_in as number, interval: (body.interval ?? 5) as number };
}

function tokenCredential(body: any, userUuid: string, previous?: Credential): Credential {
  if (typeof body.access_token !== 'string' || typeof (body.refresh_token || previous?.refreshToken) !== 'string' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
    throw new CliError('INVALID_RESPONSE', 'OAuth returned an invalid token response.');
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token || previous!.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000, scopes: typeof body.scope === 'string' ? body.scope.split(' ') : previous?.scopes || [], userUuid };
}

export class Auth {
  readonly credentials: Credentials;
  constructor(readonly environment: Environment) { this.credentials = new Credentials(environment); }

  private clientId(): string {
    return this.environment.clientId || authRequired('Configure a MarineVerse CLI client ID for this API origin with config set.');
  }

  private token(parameters: Record<string, string>) {
    return request(`${this.environment.apiUrl}/oauth/token`, {
      method: 'POST', body: new URLSearchParams({ ...parameters, client_id: this.clientId() }),
    });
  }

  async login(options: { browser: boolean; storage: Storage; announce: (url: string) => void }) {
    const clientId = this.clientId();
    await this.credentials.preflight(options.storage);
    const listener = await callback();
    try {
      const verifier = randomBytes(32).toString('base64url');
      const url = new URL('/oauth/authorize', this.environment.webUrl);
      url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: LOGIN_SCOPE,
        redirect_uri: listener.redirectUri, state: listener.state, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
      options.announce(url.toString());
      if (options.browser) await openBrowser(url.toString()).catch(() => {});
      const body = await this.token({ grant_type: 'authorization_code', code: await listener.code, code_verifier: verifier, redirect_uri: listener.redirectUri });
      return await this.saveLogin(body, options.storage);
    } finally { listener.close(); }
  }

  // Device mode opens no local listener: the user approves on the website while the CLI polls /oauth/token.
  async deviceLogin(options: { browser: boolean; storage: Storage; announce: (url: string, userCode: string, expiresIn: number) => void; sleep?: (ms: number) => Promise<void> }) {
    const clientId = this.clientId();
    await this.credentials.preflight(options.storage);
    const sleep = options.sleep || delay;
    let started;
    try {
      started = deviceAuthorization(await request(`${this.environment.apiUrl}/oauth/device_authorization`, {
        method: 'POST', body: new URLSearchParams({ client_id: clientId, scope: LOGIN_SCOPE }) }), this.environment.webUrl);
    } catch (error) {
      if (error instanceof CliError && error.code === 'NOT_FOUND') {
        throw new CliError('DEVICE_AUTH_UNSUPPORTED', 'This MarineVerse server does not support device code login yet. Use browser login instead.', 3);
      }
      throw error;
    }
    options.announce(started.uri, started.userCode, started.expiresIn);
    if (options.browser) await openBrowser(started.complete).catch(() => {});
    const deadline = Date.now() + started.expiresIn * 1000;
    let interval = started.interval, wait = interval, failures = 0, body;
    while (!body) {
      await sleep(wait * 1000);
      if (Date.now() >= deadline) throw new CliError('AUTH_EXPIRED', 'The device code expired before login was approved. Start login again.', 3);
      wait = interval;
      try { body = await this.token({ grant_type: DEVICE_CODE_GRANT, device_code: started.deviceCode }); }
      catch (error) {
        if (!(error instanceof CliError)) throw error;
        if (error.oauthError === 'authorization_pending') { failures = 0; continue; }
        if (error.oauthError === 'slow_down') { failures = 0; wait = interval += 5; continue; }
        if (error.oauthError === 'access_denied') throw new CliError('AUTH_DENIED', 'Authorization was denied.', 3);
        if (error.oauthError === 'expired_token') throw new CliError('AUTH_EXPIRED', 'The device code expired before login was approved. Start login again.', 3);
        if (error.code === 'RATE_LIMITED') { wait = Math.max(interval, error.retryAfterSeconds ?? 0); continue; }
        // Transport and server failures back off, but give up rather than poll indefinitely.
        if (['NETWORK_ERROR', 'API_ERROR'].includes(error.code) && ++failures <= 5) { wait = Math.min(interval * 2 ** failures, 60); continue; }
        if (error.oauthError && error.code !== 'API_ERROR') throw new CliError('DEVICE_AUTH_FAILED', `Device login failed (${error.oauthError}). Start login again.`, 3);
        throw error;
      }
    }
    return this.saveLogin(body, options.storage);
  }

  private async saveLogin(body: any, storage: Storage) {
    const credential = tokenCredential(body, '');
    const user = await request(`${this.environment.apiUrl}/api/v3/users/me`, { headers: { Authorization: `Bearer ${credential.accessToken}` } });
    if (typeof user.uuid !== 'string') throw new CliError('INVALID_RESPONSE', 'Identity response is missing a user UUID.');
    credential.userUuid = user.uuid;
    try { await this.credentials.lock(() => this.credentials.write(credential, storage)); }
    catch (error) {
      // Attempt to revoke unsaved tokens; a failed request cannot confirm revocation.
      const revoked = await this.revoke(credential);
      const reason = error instanceof CliError ? `${error.message} (${error.code})` : 'Unexpected storage failure.';
      const revocation = revoked ? 'The new tokens were revoked.' : 'Token revocation could not be confirmed; the new tokens may still be valid.';
      throw new CliError('AUTH_CREDENTIAL_SAVE_FAILED', `Signed in, but the credentials could not be saved: ${reason} ${revocation}`, 3);
    }
    return { user_uuid: user.uuid, display_name: user.display_name, scopes: credential.scopes, expires_at: new Date(credential.expiresAt).toISOString() };
  }

  async accessToken(rejectedToken?: string): Promise<string> {
    this.clientId();
    return this.credentials.lock(async () => {
      const credential = await this.credentials.read();
      if (!credential) return authRequired();
      if (credential.expiresAt > Date.now() + 30_000 && credential.accessToken !== rejectedToken) return credential.accessToken;
      let body;
      try { body = await this.token({ grant_type: 'refresh_token', refresh_token: credential.refreshToken }); }
      catch (error) {
        if (error instanceof CliError && [3, 6].includes(error.exitCode)) return authRequired('Login has expired or was revoked. Run auth login again.');
        throw error;
      }
      const updated = tokenCredential(body, credential.userUuid, credential);
      await this.credentials.write(updated);
      return updated.accessToken;
    });
  }

  async get(path: string, requiredScope?: string, retryReads = true): Promise<any> {
    const token = await this.accessToken();
    await this.requireScope(requiredScope);
    try { return await request(`${this.environment.apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } }, 15_000, retryReads); }
    catch (error) {
      if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') throw error;
      return request(`${this.environment.apiUrl}${path}`, { headers: { Authorization: `Bearer ${await this.accessToken(token)}` } }, 15_000, retryReads);
    }
  }

  async status() {
    const user = await this.get('/api/v3/users/me');
    const credential = await this.credentials.read();
    return { user_uuid: user.uuid, display_name: user.display_name, scopes: credential?.scopes, expires_at: credential ? new Date(credential.expiresAt).toISOString() : null };
  }

  // Reads stored metadata only: no network request, token refresh, lock or write.
  async localStatus() {
    const credential = await this.credentials.read();
    if (!credential) return authRequired();
    return { user_uuid: credential.userUuid, scopes: credential.scopes, expires_at: new Date(credential.expiresAt).toISOString(),
      access_token_expired: credential.expiresAt <= Date.now() };
  }

  private async requireScope(scope?: string) {
    if (scope && !(await this.credentials.read())?.scopes.includes(scope)) {
      throw new CliError('AUTH_REQUIRED', 'Your login needs updated permissions. Run marineverse login again.', 3);
    }
  }

  async write(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, scope: string) {
    const token = await this.accessToken();
    await this.requireScope(scope);
    return request(`${this.environment.apiUrl}${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  // Chargeable requests are never replayed, including after a rejected token.
  async post(path: string, body: unknown, scope: string) {
    const token = await this.accessToken();
    await this.requireScope(scope);
    try {
      return await request(`${this.environment.apiUrl}${path}`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 120_000);
    } catch (error) {
      if (error instanceof CliError && error.code === 'NETWORK_ERROR') {
        throw new CliError('NETWORK_ERROR', 'Could not reach MarineVerse. Please try again.');
      }
      throw error;
    }
  }

  async logout() {
    return this.credentials.lock(async () => {
      // Malformed, missing or unreachable tokens cannot be revoked, but logout must still be able to clear local data.
      let unreadable = false;
      const credential = await this.credentials.read().catch(error => {
        if (!(error instanceof CliError) || !['CREDENTIAL_METADATA_INVALID', 'CREDENTIAL_INVALID', 'CREDENTIAL_MISSING', 'CREDENTIAL_STORE_UNAVAILABLE'].includes(error.code)) throw error;
        unreadable = true;
        return undefined;
      });
      const revoked = credential ? await this.revoke(credential) : !unreadable;
      await this.credentials.remove(unreadable);
      return { logged_out: true, server_revocation_confirmed: revoked };
    });
  }

  private async revoke(credential: Credential): Promise<boolean> {
    let revoked = true;
    for (const token of [credential.refreshToken, credential.accessToken]) {
      try { await request(`${this.environment.apiUrl}/oauth/revoke`, { method: 'POST', body: new URLSearchParams({ client_id: this.clientId(), token }) }); }
      catch { revoked = false; }
    }
    return revoked;
  }
}
