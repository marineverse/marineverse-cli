import { setTimeout as delay } from 'node:timers/promises';
import { randomInt } from 'node:crypto';
import { CliError, type RequestDiagnostics } from './errors.js';
import { CLIENT_NAME, VERSION } from './version.js';

export const REQUEST_TIMEOUT_MS = 15_000;
export const READ_DEADLINE_MS = 30_000;

// Retries and an authenticated read's token refresh consume the same deadline.
export class RequestBudget {
  private readonly started = performance.now();
  constructor(private readonly timeoutMs = READ_DEADLINE_MS) {}
  remaining() { return Math.max(0, this.timeoutMs - this.elapsed()); }
  elapsed() { return performance.now() - this.started; }
}

const TRANSIENT_CAUSES = new Set(['TimeoutError', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
const SAFE_CAUSES = new Set([...TRANSIENT_CAUSES, 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'AbortError', 'SyntaxError',
  'Error', 'TypeError', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

// Fetch wraps socket errors in TypeError; raw error messages can contain credentials.
function safeCause(error: unknown): string {
  let cause = 'unknown';
  for (let depth = 0; error && typeof error === 'object' && depth < 4; depth++) {
    const value = error as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof value.code === 'string' && SAFE_CAUSES.has(value.code)) cause = value.code;
    else if (typeof value.name === 'string' && SAFE_CAUSES.has(value.name) && ['unknown', 'Error', 'TypeError'].includes(cause)) cause = value.name;
    error = value.cause;
  }
  return cause;
}

export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : undefined;
}

export async function request(url: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS, retryReads = true,
  budget = new RequestBudget(options.method && options.method.toUpperCase() !== 'GET' ? timeoutMs : Math.max(timeoutMs, READ_DEADLINE_MS))): Promise<any> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('User-Agent', `${CLIENT_NAME}/${VERSION}`);
  headers.set('X-MarineVerse-Client', CLIENT_NAME);
  headers.set('X-MarineVerse-Client-Version', VERSION);
  const canRetry = (attempt: number) => retryReads && method === 'GET' && attempt < 2 && !options.signal?.aborted;
  let stage: RequestDiagnostics['stage'] = 'headers', attempts = 0, requestId: string | undefined, status: number | undefined;
  const diagnostics = (cause: string): RequestDiagnostics => ({ elapsed_ms: Math.round(budget.elapsed()), stage, attempts,
    cause, request_id: requestId, http_status: status });
  const networkError = (cause: string) => new CliError('NETWORK_ERROR', method === 'GET'
    ? 'Request failed or timed out. Try again.'
    : 'Request failed; the operation may have completed. Retrying may duplicate an action or charge.', 7, undefined, undefined, diagnostics(cause));
  const backoff = async (attempt: number, retryAfter = 0) => {
    const wait = Math.max(retryAfter * 1000, 2 ** attempt * 500 + randomInt(0, 251));
    if (wait >= budget.remaining()) return false;
    stage = 'backoff';
    try { await delay(wait, undefined, { signal: options.signal || undefined }); }
    catch (error) { throw networkError(safeCause(error)); }
    return budget.remaining() > 0;
  };
  for (let attempt = 0; ; attempt++) {
    stage = 'headers';
    requestId = undefined;
    status = undefined;
    const remaining = budget.remaining();
    if (remaining <= 0) throw networkError('TimeoutError');
    const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(timeoutMs, remaining))));
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    let response: Response, body: any;
    attempts++;
    try {
      response = await fetch(url, { ...options, headers, redirect: 'manual', signal });
      status = response.status;
      const id = response.headers.get('x-request-id');
      requestId = id && /^[A-Za-z0-9-]{1,128}$/.test(id) ? id : undefined;
      if (signal.aborted) throw signal.reason;
      if (budget.remaining() <= 0) throw new DOMException('Request deadline expired', 'TimeoutError');
      const retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
      if (canRetry(attempt) && [429, 502, 503, 504].includes(response.status) && (retryAfter === undefined || retryAfter <= 5)) {
        // Only discard a response when there is room to retry it.
        const minimumWait = Math.max((retryAfter || 0) * 1000, 2 ** attempt * 500 + 250);
        if (minimumWait < budget.remaining()) {
          await response.body?.cancel();
          if (await backoff(attempt, retryAfter)) continue;
          throw networkError('TimeoutError');
        }
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new CliError('REDIRECT_REFUSED', 'The API redirected this request. Check the configured API origin.');
      }
      stage = 'body';
      try { body = response.status === 204 ? {} : await response.json(); }
      catch (error) {
        // A stream abort/reset is transport failure, even on a non-2xx response.
        if (!(error instanceof SyntaxError) || signal.aborted) throw error;
        if (response.ok) throw new CliError('INVALID_RESPONSE', `API returned a non-JSON response (HTTP ${response.status}).`,
          7, undefined, undefined, diagnostics('SyntaxError'));
      }
      if (signal.aborted) throw signal.reason;
      if (budget.remaining() <= 0) throw new DOMException('Request deadline expired', 'TimeoutError');
      if (!response.ok) {
        const codes: Record<number, [string, number]> = { 400: ['VALIDATION_ERROR', 6], 401: ['AUTH_REQUIRED', 3], 403: ['FORBIDDEN', 4], 404: ['NOT_FOUND', 5], 410: ['ACCOUNT_DELETED', 3], 422: ['VALIDATION_ERROR', 6], 429: ['RATE_LIMITED', 7] };
        const [code, exit] = codes[response.status] || ['API_ERROR', 7];
        const detail = Array.isArray(body?.errors) ? body.errors.join('; ') : body?.error_description || body?.error;
        const message = typeof detail === 'string' ? detail : `API returned HTTP ${response.status}.`;
        throw new CliError(code, `${message}${retryAfter !== undefined ? ` Retry after ${retryAfter} seconds.` : ''}`, exit, retryAfter,
          typeof body?.error === 'string' ? body.error : undefined, diagnostics(`HTTP_${response.status}`));
      }
      return body;
    } catch (error) {
      if (error instanceof CliError) throw error;
      const cause = timeout.aborted && !options.signal?.aborted ? 'TimeoutError' : safeCause(error);
      if (canRetry(attempt) && TRANSIENT_CAUSES.has(cause) && await backoff(attempt)) continue;
      throw networkError(cause);
    }
  }
}
