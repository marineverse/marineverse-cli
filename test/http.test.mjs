import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { request, RequestBudget } from '../dist/http.js';
import { Auth } from '../dist/auth.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const url = 'https://fixture.invalid/read'; // Mocked fetch only; no network access.
const reset = () => new TypeError('private URL and bearer token', {
  cause: Object.assign(new Error('private'), { code: 'ECONNRESET' }),
});

function fixtureAuth() {
  const auth = new Auth({ apiUrl: 'https://fixture.invalid', webUrl: 'https://fixture.invalid', clientId: 'fixture', name: 'fixture' });
  auth.requireScope = async () => {};
  return auth;
}

test('network failure never requests token refresh and Auth.post keeps diagnostics', async () => {
  const auth = fixtureAuth();
  const tokens = [];
  auth.accessToken = async rejected => { tokens.push(rejected); return 'fixture-token'; };
  globalThis.fetch = async () => { throw reset(); };
  await assert.rejects(auth.get('/boat', undefined, false), error => error.code === 'NETWORK_ERROR');
  assert.deepEqual(tokens, [undefined]);
  await assert.rejects(auth.post('/ask', {}, 'ai_ask'), error => error.diagnostics.cause === 'ECONNRESET'
    && /may have completed/.test(error.message));
});

test('uncertain POST outcomes use accurate guidance for mutations and chargeable AI requests without replay', async () => {
  for (const path of ['/api/v3/globe/boats/fixture', '/api/v2/kb/search', '/api/v2/ai/ask']) {
    let attempts = 0;
    globalThis.fetch = async () => { attempts++; throw reset(); };
    await assert.rejects(request(`https://fixture.invalid${path}`, { method: 'POST' }), error => {
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.match(error.message, /may have completed/);
      assert.match(error.message, /Retrying may duplicate an action or charge/);
      assert.doesNotMatch(error.message, /Read back|Check for a result|private|bearer/);
      assert.equal(error.diagnostics.cause, 'ECONNRESET');
      assert.equal(error.diagnostics.attempts, 1);
      return true;
    });
    assert.equal(attempts, 1);
  }
});

test('expired shared read budget prevents an HTTP refresh after a 401', async () => {
  const auth = fixtureAuth();
  auth.credentials.lock = async action => action();
  auth.credentials.read = async () => ({ accessToken: 'fixture-token', refreshToken: 'fixture-refresh',
    expiresAt: Date.now() + 120000, userUuid: 'fixture-user', scopes: [] });
  auth.credentials.write = async () => { assert.fail('No rotated credentials should be written'); };
  const accessToken = auth.accessToken.bind(auth);
  auth.accessToken = async (rejected, budget) => {
    // Model expiry between the rejected read and refresh without a real 30s wait.
    if (rejected) budget.remaining = () => 0;
    return accessToken(rejected, budget);
  };
  const calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ input, method: options.method || 'GET' });
    return Response.json({}, { status: 401 });
  };
  await assert.rejects(auth.get('/boat'), error => error.code === 'NETWORK_ERROR'
    && error.diagnostics.cause === 'TimeoutError' && error.diagnostics.attempts === 0);
  assert.deepEqual(calls, [{ input: 'https://fixture.invalid/boat', method: 'GET' }]);
});

test('nested timeout cause survives a generic fetch wrapper', async () => {
  globalThis.fetch = async () => { throw new TypeError('private', { cause: new DOMException('private', 'TimeoutError') }); };
  await assert.rejects(request(url, {}, 100, false), error => error.code === 'NETWORK_ERROR'
    && error.diagnostics.cause === 'TimeoutError');
});

test('new pre-header failures cannot inherit a prior response request ID', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    if (++attempts === 1) return Response.json({}, { status: 503, headers: { 'x-request-id': 'earlier-request' } });
    throw reset();
  };
  await assert.rejects(request(url, {}, 100, true, new RequestBudget(1500)), error => error.code === 'NETWORK_ERROR'
    && error.diagnostics.attempts === 2 && error.diagnostics.request_id === undefined
    && error.diagnostics.http_status === undefined);
  assert.equal(attempts, 2);
});

test('retryReads false prevents GET replay on a transient reset', async () => {
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw reset(); };
  await assert.rejects(request(url, {}, 100, false), error => error.code === 'NETWORK_ERROR' && error.diagnostics.attempts === 1);
  assert.equal(attempts, 1);
});

test('body timeout is transport failure and keeps response diagnostics', async () => {
  for (const status of [200, 401]) {
    globalThis.fetch = async (_url, { signal }) => {
      const response = new Response('{}', { status, headers: { 'x-request-id': 'fixture-request' } });
      response.json = async () => { await delay(500, undefined, { signal }); };
      return response;
    };
    await assert.rejects(request(url, {}, 20, false), error => error.code === 'NETWORK_ERROR'
      && error.diagnostics.stage === 'body' && error.diagnostics.cause === 'TimeoutError'
      && error.diagnostics.request_id === 'fixture-request' && error.diagnostics.http_status === status);
  }
});

test('late successful body cannot bypass the deadline when a fetch mock ignores abort', async () => {
  globalThis.fetch = async () => {
    const response = Response.json({});
    response.json = async () => { await delay(40); return { late: true }; };
    return response;
  };
  await assert.rejects(request(url, {}, 100, false, new RequestBudget(15)), error => error.code === 'NETWORK_ERROR'
    && error.diagnostics.cause === 'TimeoutError' && error.diagnostics.stage === 'body');
});

test('pre-header timeout keeps stage and elapsed time', async () => {
  globalThis.fetch = async (_url, { signal }) => { await delay(500, undefined, { signal }); };
  await assert.rejects(request(url, {}, 20, false, new RequestBudget(80)), error => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.diagnostics.stage, 'headers');
    assert.equal(error.diagnostics.cause, 'TimeoutError');
    assert.equal(error.diagnostics.attempts, 1);
    assert.ok(error.diagnostics.elapsed_ms >= 15 && error.diagnostics.elapsed_ms < 200);
    return true;
  });
});

test('slow first connection and fast reused connection share an overall deadline', async () => {
  let attempts = 0;
  globalThis.fetch = async (_url, { signal }) => {
    if (++attempts === 1) await delay(500, undefined, { signal });
    return Response.json({ reused: true });
  };
  const budget = new RequestBudget(1000);
  assert.deepEqual(await request(url, {}, 20, true, budget), { reused: true });
  assert.equal(attempts, 2);
  assert.ok(budget.elapsed() < 1000);
});

test('insufficient overall deadline prevents backoff and another attempt', async () => {
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw reset(); };
  await assert.rejects(request(url, {}, 100, true, new RequestBudget(80)), error => error.code === 'NETWORK_ERROR'
    && error.diagnostics.attempts === 1 && error.diagnostics.elapsed_ms < 200);
  assert.equal(attempts, 1);
});

test('caller abort interrupts backoff without replay', async () => {
  const controller = new AbortController();
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    setTimeout(() => controller.abort(), 10);
    throw reset();
  };
  await assert.rejects(request(url, { signal: controller.signal }), error => error.code === 'NETWORK_ERROR'
    && error.diagnostics.stage === 'backoff' && error.diagnostics.cause === 'AbortError');
  assert.equal(attempts, 1);
});

test('body reset is transport failure; malformed JSON is invalid response', async () => {
  globalThis.fetch = async () => {
    const response = Response.json({});
    response.json = async () => { throw reset(); };
    return response;
  };
  await assert.rejects(request(url, {}, 100, false), error => error.code === 'NETWORK_ERROR'
    && error.diagnostics.cause === 'ECONNRESET' && error.diagnostics.stage === 'body');
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response('{broken'); };
  await assert.rejects(request(url), error => error.code === 'INVALID_RESPONSE'
    && error.diagnostics.cause === 'SyntaxError');
  assert.equal(attempts, 1);
});

test('transient GET reset retries once and POST never replays', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    if (++attempts === 1) throw reset();
    return Response.json({ connected: true });
  };
  assert.deepEqual(await request(url, {}, 100, true, new RequestBudget(1000)), { connected: true });
  assert.equal(attempts, 2);
  attempts = 0;
  globalThis.fetch = async () => { attempts++; throw reset(); };
  await assert.rejects(request(url, { method: 'POST' }), error => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.diagnostics.cause, 'ECONNRESET');
    assert.match(error.message, /may have completed/);
    assert.doesNotMatch(JSON.stringify(error), /private|bearer/);
    return true;
  });
  assert.equal(attempts, 1);
});
