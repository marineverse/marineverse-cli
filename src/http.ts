import { setTimeout as delay } from 'node:timers/promises';
import { randomInt } from 'node:crypto';
import { CliError } from './errors.js';
import { CLIENT_NAME, VERSION } from './version.js';

export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : undefined;
}

export async function request(url: string, options: RequestInit = {}, timeoutMs = 15_000, retryReads = true): Promise<any> {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('User-Agent', `${CLIENT_NAME}/${VERSION}`);
  headers.set('X-MarineVerse-Client', CLIENT_NAME);
  headers.set('X-MarineVerse-Client-Version', VERSION);
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...options, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new CliError('NETWORK_ERROR', method === 'GET' ? 'Request failed or timed out.' : 'Request failed; the operation may have completed. Read back state before retrying.');
    }
    const retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
    if (retryReads && method === 'GET' && attempt < 2 && [429, 502, 503, 504].includes(response.status)) {
      if (retryAfter === undefined || retryAfter <= 5) {
        await response.body?.cancel();
        const backoff = (2 ** attempt) * 500 + randomInt(0, 251);
        await delay(Math.max((retryAfter || 0) * 1000, backoff));
        continue;
      }
    }
    if (response.status >= 300 && response.status < 400) throw new CliError('REDIRECT_REFUSED', 'The API redirected this request. Check the configured API origin.');
    let body: any;
    try { body = response.status === 204 ? {} : await response.json(); }
    catch {
      if (response.ok) throw new CliError('INVALID_RESPONSE', `API returned a non-JSON response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const codes: Record<number, [string, number]> = { 400: ['VALIDATION_ERROR', 6], 401: ['AUTH_REQUIRED', 3], 403: ['FORBIDDEN', 4], 404: ['NOT_FOUND', 5], 410: ['ACCOUNT_DELETED', 3], 422: ['VALIDATION_ERROR', 6], 429: ['RATE_LIMITED', 7] };
      const [code, exit] = codes[response.status] || ['API_ERROR', 7];
      const detail = Array.isArray(body?.errors) ? body.errors.join('; ') : body?.error_description || body?.error;
      const message = typeof detail === 'string' ? detail : `API returned HTTP ${response.status}.`;
      throw new CliError(code, `${message}${retryAfter !== undefined ? ` Retry after ${retryAfter} seconds.` : ''}`, exit, retryAfter);
    }
    return body;
  }
}
