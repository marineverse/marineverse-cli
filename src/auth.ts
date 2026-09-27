import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
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
    const listener = await callback();
    try {
      const verifier = randomBytes(32).toString('base64url');
      const url = new URL('/oauth/authorize', this.environment.webUrl);
      url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'public globe_read globe_write',
        redirect_uri: listener.redirectUri, state: listener.state, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
      options.announce(url.toString());
      if (options.browser) await openBrowser(url.toString()).catch(() => {});
      const body = await this.token({ grant_type: 'authorization_code', code: await listener.code, code_verifier: verifier, redirect_uri: listener.redirectUri });
      const credential = tokenCredential(body, '');
      const user = await request(`${this.environment.apiUrl}/api/v3/users/me`, { headers: { Authorization: `Bearer ${credential.accessToken}` } });
      if (typeof user.uuid !== 'string') throw new CliError('INVALID_RESPONSE', 'Identity response is missing a user UUID.');
      credential.userUuid = user.uuid;
      await this.credentials.lock(() => this.credentials.write(credential, options.storage));
      return { user_uuid: user.uuid, display_name: user.display_name, scopes: credential.scopes, expires_at: new Date(credential.expiresAt).toISOString() };
    } finally { listener.close(); }
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

  async get(path: string): Promise<any> {
    const token = await this.accessToken();
    try { return await request(`${this.environment.apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } }); }
    catch (error) {
      if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') throw error;
      return request(`${this.environment.apiUrl}${path}`, { headers: { Authorization: `Bearer ${await this.accessToken(token)}` } });
    }
  }

  async status() {
    const user = await this.get('/api/v3/users/me');
    const credential = await this.credentials.read();
    return { user_uuid: user.uuid, display_name: user.display_name, scopes: credential?.scopes, expires_at: credential ? new Date(credential.expiresAt).toISOString() : null };
  }

  async logout() {
    return this.credentials.lock(async () => {
      const credential = await this.credentials.read();
      let revoked = true;
      if (credential) {
        for (const token of [credential.refreshToken, credential.accessToken]) {
          try { await request(`${this.environment.apiUrl}/oauth/revoke`, { method: 'POST', body: new URLSearchParams({ client_id: this.clientId(), token }) }); }
          catch { revoked = false; }
        }
      }
      await this.credentials.remove();
      return { logged_out: true, server_revocation_confirmed: revoked };
    });
  }
}
