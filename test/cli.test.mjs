import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { run } from '../dist/cli.js';
import { MarineVerseClient, boat } from '../dist/client.js';
import { human } from '../dist/output.js';
import { setEnvironment, resolveEnvironment } from '../dist/config.js';
import { Auth, callback } from '../dist/auth.js';
import { request, retryAfterSeconds } from '../dist/http.js';
import { callbackPage } from '../dist/callback-page.js';
import { CliError } from '../dist/errors.js';

const { version: expectedVersion } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const storage = process.platform === 'win32' ? 'keyring' : 'file';
const inheritedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('MARINEVERSE_')));
const originalFetch = globalThis.fetch;

let server, directory, environment, requests, currentBoat, refreshCount, failRead, failure, sailingData, deviceStart, devicePolls, revokeStatuses, boatSnapshot;
const race = { publicKey: 'race-key', name: 'Test Race', state: 'active', entries: [{ position: 1,
  boat: { uuid: 'boat-key', name: 'Boat', heading: 90, id: 999 }, owner: { name: 'Owner', uuid: 'owner-key', id: 123 }, penaltySeconds: 30 }] };
const feedbackPost = { uuid: 'post-uuid', slug: 'better-docking', board_slug: 'sailing', title: 'Better docking', description: 'More practice.\n\nIn strong wind.',
  status: 'planned', vote_count: 2, comment_count: 1, upvoted_by_me: true, id: 99,
  author: { name: 'Test Sailor', uuid: 'profile-uuid', email: 'private@example.test', id: 88 },
  upvoted_by: [{ name: 'A voter', id: 77 }], similar_posts: [{ slug: 'related', board_slug: 'sailing', title: 'Related idea', vote_count: 3 }],
  comments: [{ uuid: 'comment-uuid', content: 'Great idea!', author: { name: 'A commenter', id: 66 }, vote_count: 1, replies: [
    { uuid: 'reply-uuid', content: 'Thanks.', author: { name: 'A reply author' }, vote_count: 0 }] }] };

before(async () => {
  for (const key of Object.keys(inheritedEnvironment)) delete process.env[key];
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Tests must not contact non-loopback services');
    return originalFetch(input, options);
  };
  directory = await mkdtemp(join(tmpdir(), 'marineverse-cli-test-'));
  process.env.MARINEVERSE_CONFIG_DIR = directory;
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    if (failure) return send(failure, { error: 'Fixture failure' });
    if (req.url === '/empty-forbidden') { res.writeHead(403); return res.end(); }
    if (req.url === '/html-limited') { res.writeHead(429, { 'Content-Type': 'text/html', 'Retry-After': '60' }); return res.end('<h1>Too many requests</h1>'); }
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'https://example.com' }); return res.end('{}'); }
    if (req.url === '/limited') { res.setHeader('Retry-After', '60'); return send(429, { error: 'Too many requests' }); }
    if (req.url === '/retry') {
      const count = requests.filter(r => r.path === '/retry').length;
      res.setHeader('Retry-After', '0');
      return send(count < 3 ? 503 : 200, { count });
    }
    if (req.url === '/oauth/device_authorization' && deviceStart) return send(...deviceStart);
    if (req.url === '/oauth/token' && new URLSearchParams(body).get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code' && devicePolls.length) {
      const [status, value, headers = {}] = devicePolls.shift();
      for (const [name, header] of Object.entries(headers)) res.setHeader(name, header);
      return send(status, value);
    }
    if (req.url === '/oauth/token') {
      const params = new URLSearchParams(body);
      if (params.get('grant_type') === 'refresh_token') refreshCount++;
      return send(200, { access_token: `access-${refreshCount}`, refresh_token: `refresh-${refreshCount}`, expires_in: 7200, scope: 'public globe_read globe_write sailing_cv kb_read ai_ask feedback_read feedback_write' });
    }
    if (req.url === '/oauth/revoke') return send(revokeStatuses.shift() ?? 200, {});
    if (req.url === '/api/v3/users/me') return send(200, { uuid: 'user-key', display_name: 'Test Sailor', country_code: 'NZ', time_zone: 'Pacific/Auckland', id: 42, email: 'private@example.test' });
    if (req.url === '/api/v3/sailing_progress') return send(200, sailingData);
    if (req.url.startsWith('/api/v3/feedback/')) {
      const path = new URL(req.url, 'http://localhost').pathname;
      const pagination = { current_page: 1, total_pages: 2, total_entries: 12, per_page: 10 };
      if (req.method !== 'GET') {
        if (path.endsWith('/upvote') || path.endsWith('/downvote')) return send(200, { message: 'Vote saved', vote_count: 3, id: 99 });
        if (path.includes('/comments')) return send(200, req.method === 'DELETE' ? { message: 'Comment deleted successfully' }
          : { message: 'Comment saved', comment: { ...feedbackPost.comments[0], content: JSON.parse(body).content } });
        return send(200, { message: 'Post saved', post: feedbackPost });
      }
      if (path.endsWith('/boards')) return send(200, { boards: [{ slug: 'sailing', name: 'Sailing', uuid: 'board-uuid', post_count: 12, id: 99 }] });
      if (path.endsWith('/roadmap')) return send(200, { planned: [feedbackPost], in_progress: [], complete: [] });
      if (path.endsWith('/feed')) return send(200, { board: { name: 'Sailing' }, entries: [{ type: 'post', title: 'New post', description: 'Details', created_words: 'one day ago', post_link: { board_slug: 'sailing', slug: 'better-docking' } }], ...pagination });
      if (path.endsWith('/posts')) return send(200, { name: 'Sailing', posts: [feedbackPost], ...pagination });
      if (path.endsWith('/suggested')) return send(200, { posts: [feedbackPost] });
      return send(200, feedbackPost);
    }
    if (req.url === '/api/v3/knowledge_base/search') return send(200, { articles: [{ uuid: '00000000-0000-4000-8000-000000000001', title: 'Reefing', excerpt: 'Reduce sail.', relevance: 0.9, id: 99 }], tokens: { consumed: 7, remaining: 93 } });
    if (req.url === '/api/v3/knowledge_base/00000000-0000-4000-8000-000000000001') return send(200, { article: { uuid: '00000000-0000-4000-8000-000000000001', title: 'Reefing', content: 'Reduce sail.\n\nKeep control.', id: 99 } });
    if (req.url === '/api/v3/ai/ask') return send(200, { answer: 'Ease the sheet.\nThen reef.', interaction_uuid: '00000000-0000-4000-8000-000000000002', tokens: { consumed: 20, remaining: 73 }, user_id: 99 });
    if (req.url === '/api/v2/globe/races') return send(200, { registration_open_races: [], active_races: [race], finished_races: [] });
    if (req.url === '/api/v2/globe/races/race-key') return send(200, { race });
    if (req.url === '/api/v2/globe/boats/boat-key/profile') return send(200, { boat: currentBoat, races: { active: [race], past: [] }, ...boatSnapshot });
    if (req.url === '/api/v3/globe_boats') return send(200, { boats: [currentBoat] });
    if (req.url.startsWith('/api/v3/globe_boats/boat-key/history?')) {
      const query = new URL(req.url, 'http://localhost').searchParams;
      return send(200, { uuid: 'boat-key', type: query.get('type'), ...boatSnapshot.history?.[query.get('cursor') ?? 'first'] });
    }
    if (req.url === '/api/v3/globe_boats?include=weather') return send(200, { boats: [{ ...currentBoat, weather_now: boatSnapshot.weather_now ?? null }], weather_units: { wind_speed_10m: 'kn' } });
    if (req.url === '/api/v3/globe_boats/boat-key') {
      if (req.method === 'PATCH') {
        Object.assign(currentBoat, JSON.parse(body).boat);
        currentBoat.is_anchored = currentBoat.mainsail_hoist < 0.05 && currentBoat.jib_hoist < 0.05;
        return send(200, { boat: currentBoat });
      }
      if (failRead) return send(503, { error: 'Readback unavailable' });
      return send(200, { boat: currentBoat, ...boatSnapshot });
    }
    send(404, { error: 'Not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  environment = await setEnvironment('test', origin, origin, 'test-client');
});
beforeEach(() => {
  requests = []; currentBoat = { uuid: 'boat-key', name: 'Boat', heading: 90, mainsail_hoist: 1, jib_hoist: 0.6, is_anchored: false, id: 999 }; refreshCount = 0; failRead = false; failure = undefined;
  deviceStart = undefined; devicePolls = []; revokeStatuses = []; boatSnapshot = {};
  sailingData = { uuid: 'user-key', display_name: 'Test Sailor', id: 42, next_step: 'Try a race', finished_race: false,
    boat_stats: { yacht: { total_distance_nm: 12.34567, total_time_minutes: '90.12345', id: 99 }, dinghy: { total_distance_nm: 0, total_time_minutes: 0 } },
    tutorial: { yacht_tutorial_basics_started_at: '2026-01-01T12:00:00Z', yacht_tutorial_basics_finished_at: '2026-01-01T12:10:00Z',
      yacht_tutorial_steering_started_at: '2026-01-02T12:00:00Z', yacht_tutorial_steering_finished_at: null,
      dinghy_tutorial_basics_started_at: null, dinghy_tutorial_basics_finished_at: null, internal_id: 123 } };
});
after(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (key.startsWith('MARINEVERSE_')) delete process.env[key];
  Object.assign(process.env, inheritedEnvironment);
  globalThis.fetch = originalFetch;
});

async function cli(...args) {
  let stdout = '', stderr = '';
  const code = await run(['node', 'marineverse', ...args], { client: env => new MarineVerseClient(env), stdout: s => stdout += s, stderr: s => stderr += s });
  return { code, stdout, stderr, json: () => JSON.parse(stdout) };
}
async function signedIn(expired = false, scopes = ['public', 'globe_read', 'globe_write', 'sailing_cv', 'kb_read', 'ai_ask', 'feedback_read', 'feedback_write']) {
  const auth = new Auth(environment);
  await auth.credentials.lock(() => auth.credentials.write({ userUuid: 'user-key', accessToken: 'access-0', refreshToken: 'refresh-0', scopes, expiresAt: Date.now() + (expired ? -100 : 7200_000) }, storage));
  return auth;
}

test('feedback browsing works anonymously and preserves details with only public fields', async () => {
  await new Auth(environment).credentials.remove();
  for (const args of [['feedback', 'boards', 'list'], ['feedback', 'roadmap'], ['feedback', 'posts', 'list', 'sailing'], ['feedback', 'posts', 'show', 'sailing', 'better-docking'], ['feedback', 'boards', 'feed', 'sailing']]) {
    const response = await cli(...args, '--json');
    assert.equal(response.code, 0, response.stderr);
    assert.doesNotMatch(response.stdout, /private@example|"id"|"user_id"/);
    assert.equal(requests.at(-1).authorization, undefined);
  }
  const detail = await cli('feedback', 'posts', 'show', 'sailing', 'better-docking');
  for (const text of ['More practice.\n\nIn strong wind.', 'A voter', 'Related idea', 'Great idea!', 'Thanks.', 'comment-uuid']) assert.ok(detail.stdout.includes(text), text);
  const listing = await cli('feedback', 'posts', 'list', 'sailing');
  assert.match(listing.stdout, /Page 1 of 2/);
});

test('feedback suggestions work anonymously or signed in and are never automatically retried', async () => {
  for (const loggedIn of [false, true]) {
    if (loggedIn) await signedIn();
    requests = [];
    const result = await cli('feedback', 'posts', 'suggested', 'sailing', '--title', 'Better docking', '--description', 'Wind & waves', '--json');
    assert.equal(result.code, 0);
    assert.equal(result.json().data.posts[0].slug, 'better-docking');
    const url = new URL(requests[0].path, environment.apiUrl);
    assert.equal(url.searchParams.get('description'), 'Wind & waves');
    assert.equal(Boolean(requests[0].authorization), loggedIn);
    requests = [];
    failure = 503;
    assert.notEqual((await cli('feedback', 'posts', 'suggested', 'sailing', '--title', 'Better docking')).code, 0);
    assert.equal(requests.length, 1);
    failure = undefined;
  }
});

test('feedback sends encoded filters, pagination and existing OAuth identity', async () => {
  await signedIn();
  assert.equal((await cli('feedback', 'posts', 'list', 'sailing', '--search', 'wind & waves', '--sort', 'new', '--filter', 'mine', '--page', '2')).code, 0);
  const url = new URL(requests.at(-1).path, environment.apiUrl);
  assert.equal(url.searchParams.get('search'), 'wind & waves');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('filter'), 'mine');
  assert.equal(requests.at(-1).authorization, 'Bearer access-0');
  assert.equal((await cli('feedback', 'boards', 'feed', 'sailing', '--types', 'comments', '--page', '2')).code, 0);
  assert.match(requests.at(-1).path, /posts=false&comments=true&votes=false/);
  assert.equal((await cli('feedback', 'roadmap', '--filter', 'upvoted_by_me', '--search', 'docking')).code, 0);
});

test('feedback writes use the expected verbs, payloads and one request without automatic retries', async () => {
  await signedIn();
  const cases = [
    [['posts', 'create', 'sailing', '--title', 'Idea', '--description', 'Details'], 'POST', '/posts', { board_slug: 'sailing', title: 'Idea', description: 'Details' }],
    [['posts', 'update', 'sailing', 'better-docking', '--title', 'Idea', '--description', 'Details'], 'PATCH', '/posts/sailing/better-docking', { title: 'Idea', description: 'Details' }],
    [['posts', 'upvote', 'sailing', 'better-docking'], 'POST', '/posts/sailing/better-docking/upvote', {}],
    [['posts', 'unvote', 'sailing', 'better-docking'], 'POST', '/posts/sailing/better-docking/downvote', {}],
    [['comments', 'create', 'post-uuid', '--content', 'Reply', '--reply-to', 'comment-uuid'], 'POST', '/comments', { post_uuid: 'post-uuid', content: 'Reply', parent_comment_uuid: 'comment-uuid' }],
    [['comments', 'update', 'comment-uuid', '--content', 'Edited'], 'PATCH', '/comments/comment-uuid', { content: 'Edited' }],
    [['comments', 'delete', 'comment-uuid'], 'DELETE', '/comments/comment-uuid', {}],
    [['comments', 'upvote', 'comment-uuid'], 'POST', '/comments/comment-uuid/upvote', {}],
    [['comments', 'unvote', 'comment-uuid'], 'POST', '/comments/comment-uuid/downvote', {}],
  ];
  for (const [args, method, path, body] of cases) {
    requests = [];
    const response = await cli('feedback', ...args, '--json');
    assert.equal(response.code, 0, response.stderr);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, `/api/v3/feedback${path}`);
    assert.equal(requests[0].method, method);
    assert.equal(requests[0].authorization, 'Bearer access-0');
    assert.deepEqual(JSON.parse(requests[0].body), body);
    failure = 503;
    requests = [];
    assert.notEqual((await cli('feedback', ...args)).code, 0);
    assert.equal(requests.length, 1);
    failure = undefined;
  }
});

test('feedback validates before network access, requires normal login, and exposes offline help and links', async () => {
  await signedIn();
  for (const args of [['posts', 'list', 'sailing', '--page', '0'], ['posts', 'list', 'sailing', '--sort', 'wrong'], ['posts', 'show', '../private', 'post'], ['comments', 'create', 'post', '--content', ' '], ['boards', 'feed', 'sailing', '--types', 'wrong']]) {
    assert.equal((await cli('feedback', ...args)).code, 2);
  }
  assert.equal(requests.length, 0);
  await signedIn(false, ['public']);
  const denied = await cli('feedback', 'posts', 'upvote', 'sailing', 'post');
  assert.equal(denied.code, 3);
  assert.match(denied.stderr, /marineverse login/);
  await new Auth(environment).credentials.remove();
  assert.equal((await cli('feedback', 'roadmap', '--filter', 'mine')).code, 3);
  for (const args of [[], ['boards'], ['posts'], ['comments']]) assert.equal((await cli('feedback', ...args)).code, 0);
  const opened = await cli('feedback', 'posts', 'open', 'sailing', 'better-docking', '--no-browser', '--json');
  assert.equal(opened.json().data.url, `${environment.webUrl}/feedback/sailing/better-docking`);
  assert.equal(requests.length, 0);
});

test('knowledge base and AI commands use authenticated requests and preserve readable paragraphs', async () => {
  await signedIn();
  const result = await cli('knowledge-base', 'search', 'reefing & wind', '--limit', '3', '--json');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json().data.articles[0].title, 'Reefing');
  assert.equal(result.json().data.articles[0].id, undefined);
  assert.deepEqual(JSON.parse(requests.at(-1).body), { query: 'reefing & wind', limit: 3 });
  assert.equal(requests.at(-1).method, 'POST');
  assert.equal(requests.at(-1).authorization, 'Bearer access-0');
  const article = await cli('kb', 'show', '00000000-0000-4000-8000-000000000001');
  assert.equal(article.code, 0, article.stderr);
  assert.match(article.stdout, /Reduce sail\.\n\nKeep control\./);
  const answer = await cli('ai', 'ask', 'How do I reef?');
  assert.equal(answer.code, 0, answer.stderr);
  assert.equal(answer.stdout, 'Ease the sheet.\nThen reef.\n');
  assert.deepEqual(JSON.parse(requests.at(-1).body), { question: 'How do I reef?' });
});

test('chargeable knowledge and AI requests are not automatically retried', async () => {
  await signedIn();
  for (const args of [['kb', 'search', 'reefing'], ['ai', 'ask', 'How do I reef?']]) {
    for (const status of [401, 403, 429, 503]) {
      failure = status;
      requests = [];
      const result = await cli(...args, '--json');
      assert.notEqual(result.code, 0);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, 'POST');
    }
  }
});

test('knowledge and AI validate input and request normal login for old sessions', async () => {
  await signedIn();
  for (const args of [['kb', 'search', ' '], ['kb', 'search', 'x', '--limit', '11'], ['kb', 'show', '../private'], ['ai', 'ask', 'x'.repeat(8001)]]) {
    assert.equal((await cli(...args)).code, 2);
  }
  assert.equal(requests.length, 0);
  await signedIn(false, ['public']);
  for (const args of [['kb', 'search', 'reef'], ['ai', 'ask', 'reef']]) {
    const result = await cli(...args);
    assert.equal(result.code, 3);
    assert.match(result.stderr, /marineverse login/);
  }
  assert.equal(requests.length, 0);
  for (const args of [['kb'], ['knowledge-base'], ['ai']]) assert.equal((await cli(...args)).code, 0);
});

test('help and version work offline', async () => {
  const bare = await cli();
  assert.equal(bare.code, 0);
  assert.match(bare.stdout, /Usage: marineverse/);
  assert.equal(bare.stderr, '');
  for (const args of [['help'], ['help', 'globe'], ['globe'], ['globe', 'races'], ['globe', 'boats'], ['globe', 'help', 'boats'], ['auth'], ['config'], ['skills'], ['profile'], ['progress'], ['stats'], ['sailing-club'], ['groups'], ['clubs']]) {
    const group = await cli(...args);
    assert.equal(group.code, 0, args.join(' '));
    assert.match(group.stdout, /Usage: marineverse/);
    assert.match(group.stdout, /Commands:/);
    assert.equal(group.stderr, '');
  }
  assert.match((await cli('--help')).stdout, /globe/);
  assert.match((await cli('globe', 'boats', '--help')).stdout, /set-heading/);
  assert.equal((await cli('--version')).stdout.trim(), expectedVersion);
  assert.equal(requests.length, 0);
});
test('top-level login uses the same options and implementation as auth login', async () => {
  for (const path of [['login'], ['auth', 'login']]) {
    let captured, output = '';
    const code = await run(['node', 'marineverse', ...path, '--no-browser', '--storage', 'file', '--json'], {
      client: env => ({ environment: env, auth: { login: async options => { captured = options; return { logged_in: true }; } } }),
      stdout: text => output += text, stderr: assert.fail,
    });
    assert.equal(code, 0);
    assert.equal(captured.browser, false);
    assert.equal(captured.storage, 'file');
    assert.equal(typeof captured.announce, 'function');
    assert.equal(JSON.parse(output).data.logged_in, true);
  }
  assert.equal(requests.length, 0);
});
test('login chooser defaults to browser, method flags skip it, and scripts never wait on it', async () => {
  const login = async (args, { interactive = true, choice = 'browser' } = {}) => {
    const started = [];
    let asked = false, stdout = '';
    const code = await run(['node', 'marineverse', ...args], {
      client: env => ({ environment: env, auth: {
        login: async options => { started.push(['browser', options.browser]); return {}; },
        deviceLogin: async options => { started.push(['device', options.browser]); return {}; } } }),
      stdout: text => stdout += text, stderr: () => {}, isInteractive: () => interactive,
      chooseLoginMethod: async () => { asked = true; return choice; },
    });
    return { code, started, asked, ...(args.includes('--json') ? { stdout } : {}) };
  };
  for (const path of [['login'], ['auth', 'login']]) {
    assert.deepEqual(await login(path), { code: 0, started: [['browser', true]], asked: true });
    assert.deepEqual((await login(path, { choice: 'device' })).started, [['device', true]]);
    const cancelled = await login(path, { choice: null });
    assert.equal(cancelled.code, 3);
    assert.deepEqual(cancelled.started, []);
    assert.deepEqual(await login([...path, '--browser']), { code: 0, started: [['browser', true]], asked: false });
    assert.deepEqual(await login([...path, '--device-auth', '--no-browser']), { code: 0, started: [['device', false]], asked: false });
    assert.deepEqual((await login([...path, '--no-browser'])).started, [['browser', false]]);
    const conflict = await login([...path, '--browser', '--device-auth']);
    assert.equal(conflict.code, 2);
    assert.deepEqual(conflict.started, []);
    const script = await login(path, { interactive: false });
    assert.equal(script.asked, false);
    assert.deepEqual(script.started, [['browser', true]]);
    const json = await login([...path, '--json']);
    assert.equal(json.asked, false);
    assert.deepEqual(JSON.parse(json.stdout), { schema_version: 1, data: {}, meta: { environment: 'test' } });
  }
  assert.equal(requests.length, 0);
});
test('profile, progress and distance use authenticated v3 reads with safe fields and useful tables', async () => {
  await signedIn();
  const profile = await cli('profile', 'show', '--json');
  assert.equal(profile.code, 0);
  assert.equal(profile.json().data.profile.country_code, 'NZ');
  assert.equal(profile.json().data.profile.time_zone, 'Pacific/Auckland');
  assert.equal(profile.json().data.profile.id, undefined);
  assert.equal(profile.json().data.profile.email, undefined);
  assert.match((await cli('profile', 'show')).stdout, /display_name: Test Sailor/);
  const progress = await cli('progress', 'show', '--json');
  assert.equal(progress.code, 0);
  assert.equal(progress.json().data.progress.next_step, 'Try a race');
  assert.deepEqual(progress.json().data.progress.tutorials.map(row => row.status), ['completed', 'in_progress', 'not_started']);
  assert.equal(progress.json().data.progress.id, undefined);
  const table = await cli('progress', 'show', '--columns', 'status,name');
  assert.match(table.stdout, /STATUS\s+TUTORIAL/);
  const distance = await cli('stats', 'distance', '--boat', 'yacht', '--json');
  assert.equal(distance.code, 0);
  assert.deepEqual(distance.json().data.distance_stats, [{ boat_type: 'yacht', total_distance_nm: 12.34567, total_time_minutes: 90.12345 }]);
  assert.equal(distance.json().data.period, 'overall');
  const totals = await cli('stats', 'distance', '--columns', 'boat,distance,time');
  assert.match(totals.stdout, /DISTANCE \(nm\)/);
  assert.match(totals.stdout, /TIME \(min\)/);
  assert.match(totals.stdout, /dinghy\s+0\s+0/);
  assert.ok(requests.every(r => r.method === 'GET' && r.path.startsWith('/api/v3/') && r.authorization === 'Bearer access-0'));
  assert.doesNotMatch(JSON.stringify([profile.json(), progress.json(), distance.json()]), /private@example|internal_id|access-0|refresh-0/);
});
test('statistics accept Rails decimal strings and reject malformed metrics', async () => {
  await signedIn();
  for (const [value, expected] of [['0.9012345e2', 90.12345], ['0.0', 0], ['.5', 0.5], [12.5, 12.5], [null, null]]) {
    sailingData.boat_stats.yacht.total_time_minutes = value;
    const result = await cli('stats', 'distance', '--boat', 'yacht', '--json');
    assert.equal(result.code, 0);
    assert.equal(result.json().data.distance_stats[0].total_time_minutes, expected);
  }
  for (const value of ['', ' ', 'NaN', 'Infinity', '1e999', '-1', '0x10', '12 minutes', true, [], {}]) {
    sailingData.boat_stats.yacht.total_time_minutes = value;
    const result = await cli('stats', 'distance', '--json');
    assert.equal(result.json().error.code, 'INVALID_RESPONSE');
  }
});
test('old sessions can read their profile and are told to log in again for progress and stats', async () => {
  const auth = await signedIn(false, ['public', 'globe_read', 'globe_write']);
  assert.equal((await cli('profile', 'show')).code, 0);
  requests = [];
  for (const args of [['progress', 'show'], ['stats', 'distance'], ['clubs', 'list'], ['clubs', 'join', 'test-club'], ['clubs', 'leave', 'test-club']]) {
    const result = await cli(...args, '--json');
    assert.equal(result.code, 3);
    assert.equal(result.json().error.code, 'AUTH_REQUIRED');
    assert.match(result.json().error.message, /marineverse login again/);
    assert.doesNotMatch(result.json().error.message, /--with|--scope/);
  }
  assert.equal(requests.length, 0);
  assert.equal((await auth.credentials.read()).accessToken, 'access-0');
  await auth.credentials.lock(() => auth.credentials.remove());
  for (const args of [['profile', 'show'], ['progress', 'show'], ['stats', 'distance']]) assert.equal((await cli(...args)).code, 3);
});
test('useful links list and open named public URLs without clients or network access', async () => {
  const expected = [
    ['website', 'https://www.marineverse.com/'], ['llms', 'https://www.marineverse.com/llms.txt'],
    ['dashboard', 'https://www.marineverse.com/dashboard-app'], ['my-profile', 'https://www.marineverse.com/my-profile'],
    ['try-sailing', 'https://www.marineverse.com/try-sailing'],
    ['history', 'https://www.marineverse.com/marineverse-sailing-club/history'], ['links', 'https://www.marineverse.com/links'],
    ['steam', 'https://www.marineverse.com/steam'], ['quest', 'https://www.marineverse.com/quest'],
    ['cli', 'https://www.marineverse.com/cli'], ['mcp', 'https://www.marineverse.com/mcp'], ['discord', 'https://discord.gg/marineverse'],
    ['support', 'https://www.marineverse.com/contact'],
    ['blog', 'https://blog.marineverse.com/'], ['learn-to-sail', 'https://www.marineverse.com/learn-how-to-sail'],
    ['racing-dashboard', 'https://www.marineverse.com/marineverse-cup/racing-dashboard'],
    ['multiplayer', 'https://www.marineverse.com/marineverse-cup/multiplayer'],
  ];
  const call = async (...args) => {
    let output = '', error = '', opened;
    const code = await run(['node', 'marineverse', '--env', 'not-configured', ...args], {
      client: assert.fail, stdout: text => output += text, stderr: text => error += text,
      openBrowser: async url => { opened = url; },
    });
    return { code, output, error, opened };
  };
  for (const args of [['links', '--json'], ['links', 'list', '--json']]) {
    const result = await call(...args);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.output).data.links.map(link => [link.name, link.url]), expected);
  }
  assert.match((await call('links')).output, /NAME\s+TITLE\s+DESCRIPTION\s+URL/);
  for (const [name, url] of expected) {
    assert.equal((await call('links', 'url', name)).output, `${url}\n`);
    const opened = await call('links', 'open', name, '--json');
    assert.equal(opened.opened, url);
    assert.deepEqual(JSON.parse(opened.output).data, { url, browser_opened: true });
    const printed = await call('links', 'open', name, '--no-browser', '--json');
    assert.equal(printed.opened, undefined);
    assert.deepEqual(JSON.parse(printed.output).data, { url, browser_opened: false });
  }
  for (const action of ['url', 'open']) {
    const invalid = await call('links', action, 'https://example.com', '--json');
    assert.equal(invalid.code, 2);
    assert.equal(JSON.parse(invalid.output).error.code, 'INVALID_USAGE');
    assert.match(JSON.parse(invalid.output).error.message, /Unknown link.*Choose from:/);
    assert.equal(invalid.opened, undefined);
  }
  assert.equal(requests.length, 0);
});
test('account browser commands open the selected website without accessing credentials', async () => {
  for (const [group, path] of [['profile', '/my-profile'], ['progress', '/marineverse-cup/my-progress'], ['stats', '/marineverse-cup/my-distance-stats']]) {
    let output = '', opened;
    const code = await run(['node', 'marineverse', group, 'open', '--json'], {
      client: assert.fail, stdout: s => output += s, stderr: assert.fail, openBrowser: async url => { opened = url; },
    });
    assert.equal(code, 0);
    assert.equal(opened, `${environment.webUrl}${path}`);
    assert.equal(JSON.parse(output).data.browser_opened, true);
    const production = await cli('--env', 'production', group, 'open', '--no-browser', '--json');
    assert.equal(production.json().data.url, `https://www.marineverse.com${path}`);
    assert.equal(production.json().data.browser_opened, false);
  }
  assert.equal(requests.length, 0);
});
test('account reads preserve refresh, forbidden and malformed-response behavior', async () => {
  await signedIn(true);
  assert.equal((await cli('progress', 'show')).code, 0);
  assert.equal(refreshCount, 1);
  failure = 403;
  const denied = await cli('stats', 'distance', '--json');
  assert.equal(denied.code, 4);
  assert.equal(denied.json().error.code, 'FORBIDDEN');
  failure = undefined;
  sailingData.boat_stats.yacht.total_distance_nm = -1;
  assert.equal((await cli('stats', 'distance', '--json')).json().error.code, 'INVALID_RESPONSE');
  sailingData.boat_stats.yacht.total_distance_nm = null;
  assert.equal((await cli('stats', 'distance', '--json')).json().data.distance_stats[0].total_distance_nm, null);
  assert.equal((await cli('stats', 'distance', '--boat', '__proto__')).code, 2);
  sailingData.tutorial.yacht_tutorial_basics_started_at = { id: 5 };
  assert.equal((await cli('progress', 'show', '--json')).json().error.code, 'INVALID_RESPONSE');
  requests = [];
  assert.equal((await cli('stats', 'distance', '--columns', 'password')).code, 2);
  assert.equal(requests.length, 0);
});
test('production defaults include the public client ID without changing the selected environment', async () => {
  const production = await resolveEnvironment({ env: 'production' });
  assert.equal(production.apiUrl, 'https://api.marineverse.com');
  assert.equal(production.webUrl, 'https://www.marineverse.com');
  assert.equal(production.clientId, '40eZdXyuN0o-ZTFrmCP9y5398XvN3qCtYyjq5q8Y4RY');
  assert.equal((await resolveEnvironment({})).name, 'test');
  assert.equal((await resolveEnvironment({ env: 'production', apiUrl: environment.apiUrl })).clientId, undefined);
});
test('config commands save origins, show their location, and switch named environments', async () => {
  const saved = await cli('--json', 'config', 'set', 'second', '--api-url', environment.apiUrl, '--web-url', environment.webUrl, '--client-id', 'other-client');
  assert.equal(saved.code, 0, saved.stdout);
  assert.equal(saved.json().data.clientId, 'other-client');
  assert.equal((await cli('--json', 'config', 'path')).json().data.config_directory, directory);
  assert.ok((await cli('--json', 'config', 'list')).json().data.environments.second);
  assert.equal((await cli('--json', 'config', 'use', 'test')).json().data.name, 'test');
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    const invalid = await cli('config', 'set', name, '--api-url', environment.apiUrl, '--web-url', environment.webUrl);
    assert.equal(invalid.code, 2);
    assert.equal((await cli('config', 'use', name)).code, 2);
  }
});
test('browser commands use the configured website without API calls or credentials', async () => {
  const opened = [];
  for (const [args, path] of [
    [['boats', 'open', 'boat-key'], '/globe/boats-profiles/boat-key'],
    [['boats', 'view-3d', 'boat-key'], '/globe/boats-profiles/boat-key/3d'],
    [['races', 'open', 'race-key'], '/globe/races/race-key'],
    [['races', 'open'], '/globe/races'],
  ]) {
    let stdout = '';
    const code = await run(['node', 'marineverse', '--json', 'globe', ...args], {
      client: () => { throw new Error('Browser commands must not create an API client'); },
      stdout: s => stdout += s, stderr: assert.fail,
      openBrowser: async url => { opened.push(url); },
    });
    assert.equal(code, 0);
    assert.equal(opened.at(-1), `${environment.webUrl}${path}`);
    assert.deepEqual(JSON.parse(stdout).data, { url: `${environment.webUrl}${path}`, browser_opened: true });
    const printed = await cli('--env', 'production', '--json', 'globe', ...args, '--no-browser');
    assert.equal(printed.code, 0);
    assert.deepEqual(printed.json().data, { url: `https://www.marineverse.com${path}`, browser_opened: false });
  }
  for (const key of ['..', '../other', 'boat?secret=value', 'boat#fragment', 'https://example.com']) {
    assert.equal((await cli('globe', 'boats', 'open', key, '--no-browser')).code, 2);
  }
  assert.equal((await cli('globe', 'boats', 'view-3d', '--no-browser')).code, 2);
  assert.equal((await cli('globe', 'not-a-command')).code, 2);
  assert.equal(requests.length, 0);
});
test('browser launch failures retain a usable URL', async () => {
  let stdout = '';
  const code = await run(['node', 'marineverse', '--json', 'globe', 'boats', 'view-3d', 'boat-key'], {
    client: () => { throw new Error('Unexpected API client'); }, stdout: s => stdout += s, stderr: assert.fail,
    openBrowser: async () => { throw new Error('No desktop'); },
  });
  assert.equal(code, 7);
  assert.equal(JSON.parse(stdout).error.code, 'BROWSER_ERROR');
  assert.ok(JSON.parse(stdout).error.message.includes(`${environment.webUrl}/globe/boats-profiles/boat-key/3d`));
});
test('anonymous race, leaderboard and profile commands never send stored credentials or expose internal IDs', async () => {
  await signedIn();
  for (const args of [['races', 'list'], ['races', 'show', 'race-key'], ['races', 'leaderboard', 'race-key'], ['boats', 'profile', 'boat-key']]) {
    const result = await cli('--json', 'globe', ...args);
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.json().schema_version, 1);
    assert.doesNotMatch(result.stdout, /"id"|999|123/);
  }
  assert.ok(requests.every(r => !r.authorization));
});
test('leaderboard preserves server rank and penalty', async () => {
  const result = (await cli('--json', 'globe', 'races', 'leaderboard', 'race-key')).json();
  assert.equal(result.data.entries[0].position, 1);
  assert.equal(result.data.entries[0].penaltySeconds, 30);
});
test('race JSON keeps origin, destination, course and each entry next feature', async () => {
  const plain = (await cli('--json', 'globe', 'races', 'show', 'race-key')).json().data;
  assert.deepEqual([plain.origin, plain.destination, plain.course, plain.entries[0].nextFeature], [null, null, null, null]);
  const gate = { id: 'gate-1', kind: 'gate', sequence: 1, a: { lat: -36.8, lng: 174.7 }, b: { lat: -36.81, lng: 174.71 }, direction: 'a_to_b' };
  Object.assign(race, { origin: { lat: -36.84, lng: 174.76 }, destination: { name: 'Russell', lat: -35.26, lng: 174.12 },
    course: { version: 1, strict_order: true, waypoint_radius_nm_default: 4, features: [gate] } });
  Object.assign(race.entries[0], { nextFeature: { id: 'gate-1', kind: 'gate', name: 'Start gate', sequence: 1 }, nextFeatureDistanceNm: 2.5 });
  try {
    const shown = (await cli('--json', 'globe', 'races', 'show', 'race-key')).json().data;
    assert.deepEqual(shown.origin, race.origin);
    assert.deepEqual(shown.destination, race.destination);
    assert.deepEqual(shown.course, race.course);
    assert.deepEqual(shown.entries[0].nextFeature, race.entries[0].nextFeature);
    assert.equal(shown.entries[0].nextFeatureDistanceNm, 2.5);
    const leaderboard = (await cli('--json', 'globe', 'races', 'leaderboard', 'race-key')).json().data;
    assert.deepEqual(leaderboard.entries[0].nextFeature, race.entries[0].nextFeature);
    assert.match((await cli('globe', 'races', 'show', 'race-key')).stdout, /Test Race \(race-key\)/);
  } finally {
    for (const key of ['origin', 'destination', 'course']) delete race[key];
    delete race.entries[0].nextFeature; delete race.entries[0].nextFeatureDistanceNm;
  }
});
test('boat coordinates are preserved and displayed across public and authenticated results', async () => {
  Object.assign(currentBoat, { p_lat: -37.867123456, p_lng: 0 });
  const profile = await cli('--json', 'globe', 'boats', 'profile', 'boat-key');
  assert.equal(profile.json().data.boat.latitude, -37.867123456);
  assert.equal(profile.json().data.boat.longitude, 0);
  const publicText = await cli('globe', 'boats', 'profile', 'boat-key');
  assert.match(publicText.stdout, /LATITUDE.*LONGITUDE/);
  assert.match(publicText.stdout, /-37\.86712\s+0\.00000/);
  await signedIn();
  Object.assign(currentBoat, { latitude: 0, longitude: 144.912345678 });
  for (const args of [['list', '--mine'], ['show', 'boat-key'], ['set-heading', 'boat-key', '--degrees', '90']]) {
    const output = await cli('globe', 'boats', ...args);
    assert.equal(output.code, 0);
    assert.match(output.stdout, /LATITUDE.*LONGITUDE/);
    assert.match(output.stdout, /0\.00000\s+144\.91235/);
  }
  const located = boat({ uuid: 'fixture', p_lat: 0, p_lng: -10.123456 });
  assert.match(human({ entries: [{ boat: located }] }), /0\.00000\s+-10\.12346/);
  const missing = boat({ uuid: 'fixture' });
  assert.equal(missing.latitude, null);
  assert.equal(missing.longitude, null);
  assert.match(human({ boat: missing }), /LATITUDE.*LONGITUDE/);
});
test('table columns are selectable in order while JSON keeps its full result', async () => {
  Object.assign(currentBoat, { p_lat: -37, p_lng: 144 });
  const profile = await cli('globe', 'boats', 'profile', 'boat-key', '--columns', 'longitude, name,latitude');
  assert.equal(profile.code, 0);
  assert.match(profile.stdout, /^LONGITUDE \(°\)\s+NAME\s+LATITUDE \(°\)\n144\.00000\s+Boat\s+-37\.00000/);
  assert.doesNotMatch(profile.stdout, /UUID|HEADING|LOCATION/);
  const json = await cli('--json', 'globe', 'boats', 'profile', 'boat-key', '--columns', 'name');
  assert.equal(json.json().data.boat.uuid, 'boat-key');
  assert.equal(json.json().data.boat.longitude, 144);
  const races = await cli('globe', 'races', 'list', '--columns', 'name,state');
  assert.match(races.stdout, /NAME\s+STATE/);
  assert.doesNotMatch(races.stdout, /RACE KEY|START/);
  const board = await cli('globe', 'races', 'leaderboard', 'race-key', '--columns', 'name,position');
  assert.match(board.stdout, /BOAT\s+POS\nBoat\s+1/);
  assert.match((await cli('globe', 'boats', 'profile', '--help')).stdout, /--columns/);
});
test('boats show returns state, weather and the last port call in one read, with optional weather columns', async () => {
  await signedIn();
  const weather = { lat: 10, lng: 20, time: ['2026-09-30T12:00', '2026-09-30T13:00'], wind_speed_10m: [10, 20], wind_direction_10m: [350, 10],
    wind_gusts_10m: [14, 24], wave_height: [1, 2], wave_direction: [180, 200], ocean_current_velocity: [0.5, 1.5], ocean_current_direction: [90, 110], visibility: [24000, 20000], weather_code: [1, 2] };
  const weatherNow = { wind_speed_kn: 15.46, wind_direction_deg: 0.17, wind_gusts_kn: 19.5, wave_height_m: 1.55, wave_direction_deg: 191, current_speed_kn: 1.04, current_direction_deg: 101 };
  const lastPortCall = { port: { name: 'Russell', uuid: 'port-uuid' }, event_type: 'departure', event_timestamp: '2026-09-29T10:00:00Z' };
  Object.assign(currentBoat, { awa: 45, time_since_last_update_seconds: 120, in_port: false, crew_role: null });
  boatSnapshot = { weather, weather_now: weatherNow, weather_units: { wind_speed_10m: 'kn' }, last_port_call: lastPortCall };
  const json = (await cli('--json', 'globe', 'boats', 'show', 'boat-key', '--columns', 'name')).json().data;
  assert.deepEqual(json.weather, weather);
  assert.deepEqual(json.weather_now, weatherNow);
  assert.deepEqual(json.last_port_call, lastPortCall);
  assert.deepEqual([json.boat.awa, json.boat.time_since_last_update_seconds, json.boat.in_port, json.boat.crew_role], [45, 120, false, null]);
  assert.equal(requests.filter(r => r.path.startsWith('/api/v3/globe_boats')).length, 1);
  const table = await cli('globe', 'boats', 'show', 'boat-key', '--columns', 'name,wind,wind-dir,current,wave,update-age,in-port');
  assert.match(table.stdout, /^NAME\s+WIND \(kn\)\s+WIND DIR \(°\)\s+CURRENT \(kn\)\s+WAVE \(m\)\s+UPDATED \(s ago\)\s+IN PORT\nBoat\s+15\.5\s+0\.2\s+1\s+1\.6\s+120\s+false/);
  const compact = await cli('globe', 'boats', 'show', 'boat-key');
  assert.doesNotMatch(compact.stdout, /WIND|UPDATED|IN PORT/);
  boatSnapshot = { weather: null, weather_now: null, last_port_call: null };
  const missing = await cli('globe', 'boats', 'show', 'boat-key', '--columns', 'name,wind,wave');
  assert.match(missing.stdout, /Boat\s+—\s+—/);
});
test('public boat profile JSON keeps an allowlist of useful sections and drops private ones', async () => {
  const port = (name, extra = {}) => ({ uuid: `${name}-uuid`, name, p_lat: -35, p_lng: 174, typeName: 'port', internal_id: 7, ...extra });
  boatSnapshot = {
    weather: { time: ['2026-09-30T12:00'], wind_speed_10m: [12] },
    port_calls: [{ port: { name: 'Russell', uuid: 'russell-uuid' }, event_type: 'arrival', event_timestamp: '2026-09-30T10:00:00Z' },
      { port: { name: 'Auckland', uuid: 'auckland-uuid' }, event_type: 'departure', event_timestamp: '2026-09-29T10:00:00Z' }],
    boat_stats: { overall: 120.5, yearly: [{ date: '2026-01-01', distance_nm: 120.5 }], monthly: [], daily: [], secret: 1 },
    passages: [{ uuid: 'passage-uuid', startPort: port('Auckland'), endPort: port('Russell'), departedAt: '2026-09-29T10:00:00Z', arrivedAt: '2026-09-30T10:00:00Z',
      durationSeconds: 86400, durationHuman: 'one day', rhumbDistanceNm: 120.5 }],
    seas_visited: [{ sea: { name: 'Hauraki Gulf', featurecla: 'bay' }, first_visited_at: '2026-09-29T11:00:00Z', latest_visited_at: '2026-09-29T12:00:00Z', visit_count: 2 }],
    boat_log: [{ timestamp: 1 }], boat_tracks: { hourly: {} }, crew_members: [{ name: 'Crew', memberId: 3 }],
    possible_crew_roles: ['admin'], crew_applications: [{ id: 1 }], crew_invite_url: 'https://example.test/invite/secret',
  };
  const data = (await cli('--json', 'globe', 'boats', 'profile', 'boat-key')).json().data;
  assert.deepEqual(Object.keys(data).sort(), ['boat', 'boat_stats', 'last_port_call', 'passages', 'races', 'seas_visited', 'weather']);
  assert.deepEqual(data.weather, boatSnapshot.weather);
  assert.deepEqual(data.last_port_call, boatSnapshot.port_calls[0]);
  assert.deepEqual(data.boat_stats, { overall: 120.5, yearly: [{ date: '2026-01-01', distance_nm: 120.5 }], monthly: [], daily: [] });
  assert.deepEqual(data.passages[0].endPort, { uuid: 'Russell-uuid', name: 'Russell', p_lat: -35, p_lng: 174, typeName: 'port' });
  assert.equal(data.passages[0].rhumbDistanceNm, 120.5);
  assert.deepEqual(data.seas_visited, [{ sea: { name: 'Hauraki Gulf' }, first_visited_at: '2026-09-29T11:00:00Z', latest_visited_at: '2026-09-29T12:00:00Z', visit_count: 2 }]);
  assert.doesNotMatch(JSON.stringify(data), /invite|secret|memberId|internal_id/);
  boatSnapshot = { weather: {}, port_calls: [] };
  const empty = (await cli('--json', 'globe', 'boats', 'profile', 'boat-key')).json().data;
  assert.deepEqual([empty.weather, empty.last_port_call], [null, null]);
  assert.equal(requests.some(r => r.authorization), false);
});
test('boats history reads one bounded type per request and pages with the server cursor', async () => {
  await signedIn();
  boatSnapshot = { history: {
    first: { items: [{ timestamp: '2026-09-30T12:02:00Z', p_lat: 1.3, p_lng: 2.3, heading: 110, last_speed_in_kts: 6.5, wind_speed: 12, offline: true }], next_cursor: 'CURSOR1', oldest_available_at: '2026-09-29T12:00:00Z' },
    CURSOR1: { items: [{ timestamp: '2026-09-30T12:01:00Z', p_lat: 1.2, p_lng: 2.2, event: 'teleport' }], next_cursor: null, oldest_available_at: '2026-09-29T12:00:00Z' },
  } };
  const first = (await cli('--json', 'globe', 'boats', 'history', 'boat-key', '--limit', '1', '--since', '2026-09-30T00:00:00Z')).json().data;
  assert.deepEqual(first.items[0], { timestamp: '2026-09-30T12:02:00Z', heading: 110, last_speed_in_kts: 6.5, wind_speed: 12, offline: true, latitude: 1.3, longitude: 2.3 });
  assert.equal(first.next_cursor, 'CURSOR1');
  const query = new URL(requests.at(-1).path, 'http://localhost').searchParams;
  assert.deepEqual(Object.fromEntries(query), { type: 'logs', limit: '1', since: '2026-09-30T00:00:00Z' });
  const second = await cli('globe', 'boats', 'history', 'boat-key', '--cursor', 'CURSOR1');
  assert.match(second.stdout, /TIME \(UTC\)\s+LATITUDE \(°\).*NOTE\n2026-09-30T12:01:00Z\s+1\.20000\s+2\.20000.*teleport\nOldest retained log: 2026-09-29T12:00:00Z\n$/s);
  assert.doesNotMatch(second.stdout, /More records/);
  assert.match((await cli('globe', 'boats', 'history', 'boat-key')).stdout, /More records: add --cursor CURSOR1/);

  boatSnapshot = { history: { first: { items: [{ port: { name: 'Russell', uuid: 'port-uuid', id: 5 }, event_type: 'arrival', event_timestamp: '2026-09-30T10:00:00Z' }], next_cursor: null } } };
  const calls = await cli('--json', 'globe', 'boats', 'history', 'boat-key', '--type', 'port-calls');
  assert.deepEqual(calls.json().data.items, [{ port: { name: 'Russell', uuid: 'port-uuid' }, event_type: 'arrival', event_timestamp: '2026-09-30T10:00:00Z' }]);
  boatSnapshot = { history: { first: { items: [{ uuid: 'passage-uuid', startPort: { name: 'Auckland', uuid: 'a' }, endPort: { name: 'Russell', uuid: 'r' },
    departedAt: '2026-09-29T10:00:00Z', arrivedAt: '2026-09-30T10:00:00Z', durationSeconds: 86400, rhumbDistanceNm: 120.5 }], next_cursor: null } } };
  assert.match((await cli('globe', 'boats', 'history', 'boat-key', '--type', 'passages')).stdout, /passage-uuid\s+Auckland\s+Russell\s+2026-09-29T10:00:00Z\s+2026-09-30T10:00:00Z\s+120\.5\s+24/);

  requests = [];
  assert.equal((await cli('globe', 'boats', 'history', 'boat-key', '--limit', '500')).code, 2);
  assert.equal((await cli('globe', 'boats', 'history', 'boat-key', '--type', 'tracks')).code, 2);
  assert.equal(requests.length, 0);
});
test('boats list requests weather only when a weather column is selected', async () => {
  await signedIn();
  Object.assign(currentBoat, { time_since_last_update_seconds: 30 });
  boatSnapshot = { weather_now: { wind_speed_kn: 12.34, wind_direction_deg: 270, current_speed_kn: 0.4, wave_height_m: 1.2 } };
  const plain = await cli('globe', 'boats', 'list', '--mine', '--columns', 'name,speed,update-age');
  assert.match(plain.stdout, /NAME\s+SPEED \(kn\)\s+UPDATED \(s ago\)\nBoat\s+—\s+30/);
  assert.deepEqual(requests.filter(r => r.path.startsWith('/api/v3/globe_boats')).map(r => r.path), ['/api/v3/globe_boats']);
  requests = [];
  const weather = await cli('globe', 'boats', 'list', '--mine', '--columns', 'name,heading,wind,update-age');
  assert.match(weather.stdout, /NAME\s+HEADING \(°\)\s+WIND \(kn\)\s+UPDATED \(s ago\)\nBoat\s+90\s+12\.3\s+30/);
  assert.deepEqual(requests.filter(r => r.path.startsWith('/api/v3/globe_boats')).map(r => r.path), ['/api/v3/globe_boats?include=weather']);
  const json = (await cli('--json', 'globe', 'boats', 'list', '--mine', '--columns', 'wind')).json().data;
  assert.equal(json.boats[0].weather_now.wind_speed_kn, 12.34);
  assert.deepEqual(json.weather_units, { wind_speed_10m: 'kn' });
  assert.equal((await cli('--json', 'globe', 'boats', 'list', '--mine')).json().data.boats[0].weather_now, undefined);
});
test('invalid columns fail before reads or mutations', async () => {
  for (const columns of ['', 'name,', 'name,name', 'password', 'name,unknown']) {
    for (const args of [['profile', 'boat-key'], ['set-heading', 'boat-key', '--degrees', '90'], ['rename', 'boat-key', '--name', 'New Name']]) {
      const result = await cli('globe', 'boats', ...args, '--columns', columns);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /column names/);
    }
  }
  assert.equal(requests.length, 0);
});
test('all API requests identify the CLI and its version', async () => {
  await signedIn(true);
  await cli('globe', 'races', 'list');
  await cli('auth', 'status');
  await cli('globe', 'boats', 'set-heading', 'boat-key', '--degrees', '215');
  await cli('auth', 'logout');
  assert.ok(requests.some(r => r.path === '/oauth/token'));
  assert.ok(requests.some(r => r.path === '/oauth/revoke'));
  for (const { headers } of requests) {
    assert.equal(headers['user-agent'], `marineverse-cli/${expectedVersion}`);
    assert.equal(headers['x-marineverse-client'], 'marineverse-cli');
    assert.equal(headers['x-marineverse-client-version'], expectedVersion);
  }
});
test('JSON errors use nonzero codes without contaminating stdout', async () => {
  const invalid = await cli('--json', 'globe', 'boats', 'set-heading', 'boat-key', '--degrees', 'NaN');
  assert.equal(invalid.code, 2);
  assert.equal(invalid.json().error.code, 'INVALID_USAGE');
  const missing = await cli('--json', 'globe', 'races', 'show', 'missing');
  assert.equal(missing.code, 5);
  assert.equal(missing.json().error.code, 'NOT_FOUND');
});
test('sail controls send one authenticated patch, preserve omitted sails, and verify readback', async () => {
  await signedIn();
  for (const [args, expected] of [
    [['set-sails', 'boat-key', '--main', '0.37'], { mainsail_hoist: 0.37 }],
    [['set-sails', 'boat-key', '--jib', '0.25'], { jib_hoist: 0.25 }],
    [['set-sails', 'boat-key', '--main', '0.5', '--jib', '0.75'], { mainsail_hoist: 0.5, jib_hoist: 0.75 }],
    [['lower-sails', 'boat-key'], { mainsail_hoist: 0, jib_hoist: 0 }],
    [['raise-sails', 'boat-key'], { mainsail_hoist: 1, jib_hoist: 1 }],
    [['drop-anchor', 'boat-key'], { mainsail_hoist: 0, jib_hoist: 0 }],
  ]) {
    const before = { ...currentBoat };
    requests = [];
    const result = await cli('globe', 'boats', ...args, '--json');
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(requests.map(r => r.method), ['PATCH', 'GET']);
    assert.deepEqual(JSON.parse(requests[0].body), { boat: expected });
    assert.ok(requests.every(r => r.authorization === 'Bearer access-0'));
    assert.equal(result.json().data.verified, true);
    for (const field of ['mainsail_hoist', 'jib_hoist']) assert.equal(result.json().data.boat[field], expected[field] ?? before[field]);
  }
  const table = await cli('globe', 'boats', 'show', 'boat-key', '--columns', 'name,main,jib,anchored');
  assert.match(table.stdout, /MAIN\s+JIB\s+ANCHORED/);
  assert.match(table.stdout, /Boat\s+0\s+0\s+true/);
  const publicBoat = boat({ uuid: 'boat-key', mainsail_hoist_level: 0.2, jib_hoist_level: 0, is_anchored: false });
  assert.equal(publicBoat.mainsail_hoist, 0.2);
  assert.equal(publicBoat.jib_hoist, 0);
  assert.equal(publicBoat.is_anchored, false);
});
test('invalid sail levels fail before any request, and denied writes are not retried', async () => {
  await signedIn();
  for (const args of [[], ...['--main', '--jib'].flatMap(option => ['', ' ', '-0.1', '1.1', 'NaN', 'Infinity', 'junk'].map(value => [option, value]))]) {
    const result = await cli('globe', 'boats', 'set-sails', 'boat-key', ...args, '--json');
    assert.equal(result.code, 2);
  }
  assert.equal(requests.length, 0);
  failure = 403;
  assert.equal((await cli('globe', 'boats', 'drop-anchor', 'boat-key')).code, 4);
  assert.deepEqual(requests.map(r => r.method), ['PATCH']);
});
test('sail readback failures remain distinct from a rejected write', async () => {
  await signedIn();
  failRead = true;
  const result = await cli('globe', 'boats', 'drop-anchor', 'boat-key', '--json');
  assert.equal(result.code, 0);
  assert.equal(result.json().data.update_accepted, true);
  assert.equal(result.json().data.verified, false);
  assert.match(result.json().data.warning, /readback failed/);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
});
test('authenticated list, heading and rename read back saved state', async () => {
  await signedIn();
  assert.equal((await cli('--json', 'globe', 'boats', 'list', '--mine')).code, 0);
  const heading = await cli('--json', 'globe', 'boats', 'set-heading', 'boat-key', '--degrees', '360');
  assert.equal(heading.json().data.boat.heading, 0);
  assert.equal(heading.json().data.verified, true);
  const rename = await cli('--json', 'globe', 'boats', 'rename', 'boat-key', '--name', 'New Boat');
  assert.equal(rename.json().data.boat.name, 'New Boat');
  assert.ok(requests.every(r => r.authorization === 'Bearer access-0'));
});
test('concurrent expired sessions refresh once and persist rotation securely', async () => {
  const auth = await signedIn(true);
  const result = await Promise.all([auth.accessToken(), new Auth(environment).accessToken()]);
  assert.deepEqual(result, ['access-1', 'access-1']);
  assert.equal(refreshCount, 1);
  assert.equal((await auth.credentials.read()).refreshToken, 'refresh-1');
  if (process.platform !== 'win32') assert.equal((await stat(join(auth.credentials.directory, 'tokens.json'))).mode & 0o777, 0o600);
});
test('an API origin override drops the configured OAuth client and cannot reuse tokens', async () => {
  await signedIn();
  const other = await resolveEnvironment({ apiUrl: 'http://localhost:1' });
  assert.equal(other.clientId, undefined);
  await assert.rejects(new Auth(other).accessToken(), error => error.code === 'AUTH_REQUIRED');
});
test('redirects are refused and transient GET failures use bounded retries', async () => {
  await assert.rejects(request(`${environment.apiUrl}/redirect`), error => error.code === 'REDIRECT_REFUSED');
  assert.deepEqual(await request(`${environment.apiUrl}/retry`), { count: 3 });
});
test('long Retry-After stops without retrying and exposes the cooldown', async () => {
  await assert.rejects(request(`${environment.apiUrl}/limited`), error => error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 60);
  assert.equal(requests.length, 1);
  assert.equal(retryAfterSeconds('Wed, 01 Jan 2025 00:01:00 GMT', Date.parse('2025-01-01T00:00:00Z')), 60);
  assert.equal(retryAfterSeconds('invalid'), undefined);
});
test('non-JSON HTTP failures retain permission and rate-limit semantics', async () => {
  await assert.rejects(request(`${environment.apiUrl}/empty-forbidden`), error => error.code === 'FORBIDDEN' && error.exitCode === 4);
  await assert.rejects(request(`${environment.apiUrl}/html-limited`), error => error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 60);
  assert.equal(requests.length, 2);
});
test('mutations are never retried after a server failure', async () => {
  await signedIn(); failure = 503;
  const result = await cli('--json', 'globe', 'boats', 'set-heading', 'boat-key', '--degrees', '215');
  assert.equal(result.code, 7);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
});
test('readback failure is distinguished from a rejected mutation', async () => {
  await signedIn(); failRead = true;
  const result = await cli('--json', 'globe', 'boats', 'set-heading', 'boat-key', '--degrees', '215');
  assert.equal(result.json().data.update_accepted, true);
  assert.equal(result.json().data.verified, false);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
});
test('browser login uses frontend consent with S256 then exchanges code and stores identity', async () => {
  const auth = new Auth(environment);
  let authorized;
  await auth.login({ browser: false, storage, announce: raw => {
    authorized = new URL(raw);
    const callbackUrl = new URL(authorized.searchParams.get('redirect_uri'));
    callbackUrl.searchParams.set('state', authorized.searchParams.get('state'));
    callbackUrl.searchParams.set('code', 'one-use-code');
    void fetch(callbackUrl);
  } });
  assert.equal(authorized.origin, environment.webUrl);
  assert.equal(authorized.pathname, '/oauth/authorize');
  assert.equal(authorized.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorized.searchParams.get('scope'), 'public globe_read globe_write sailing_cv kb_read ai_ask feedback_read feedback_write clubs_read clubs_write');
  const exchange = new URLSearchParams(requests.find(r => r.path === '/oauth/token').body);
  assert.equal(exchange.get('code'), 'one-use-code');
  assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), authorized.searchParams.get('code_challenge'));
  assert.equal((await auth.credentials.read()).userUuid, 'user-key');
});
const deviceCode = 'secret-device-code-never-shown';
const startDevice = (overrides = {}) => {
  deviceStart = [200, { device_code: deviceCode, user_code: 'BCDF-GHJK', verification_uri: `${environment.webUrl}/oauth/device`,
    verification_uri_complete: `${environment.webUrl}/oauth/device?user_code=BCDF-GHJK`, expires_in: 900, interval: 5, ...overrides }];
};
async function deviceLogin(auth = new Auth(environment)) {
  const waits = [], shown = [];
  try {
    const result = await auth.deviceLogin({ browser: false, storage, sleep: async ms => { waits.push(ms); await new Promise(resolve => setTimeout(resolve, 2)); }, announce: (...args) => shown.push(args) });
    return { result, waits, shown };
  } catch (error) { return { error, waits, shown }; }
}
test('device login polls without a local listener, slows down when asked, and stores the approved identity', async () => {
  startDevice();
  devicePolls = [[400, { error: 'authorization_pending' }], [400, { error: 'slow_down' }], [400, { error: 'authorization_pending' }]];
  const { result, waits, shown, error } = await deviceLogin();
  assert.equal(error, undefined);
  assert.equal(result.user_uuid, 'user-key');
  assert.deepEqual(shown, [[`${environment.webUrl}/oauth/device`, 'BCDF-GHJK', 900]]);
  assert.deepEqual(waits, [5000, 5000, 10000, 10000]);
  const start = new URLSearchParams(requests.find(r => r.path === '/oauth/device_authorization').body);
  assert.equal(start.get('client_id'), 'test-client');
  assert.equal(start.get('scope'), 'public globe_read globe_write sailing_cv kb_read ai_ask feedback_read feedback_write clubs_read clubs_write');
  const polls = requests.filter(r => r.path === '/oauth/token').map(r => new URLSearchParams(r.body));
  assert.equal(polls.length, 4);
  assert.ok(polls.every(p => p.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code' && p.get('device_code') === deviceCode && p.get('client_id') === 'test-client'));
  assert.equal(requests.some(r => r.path.includes('redirect_uri')), false);
  assert.equal((await new Auth(environment).credentials.read()).userUuid, 'user-key');
});
test('device login reports denial, expiry, unsupported servers and foreign verification pages distinctly', async () => {
  for (const [poll, code] of [[{ error: 'access_denied' }, 'AUTH_DENIED'], [{ error: 'expired_token' }, 'AUTH_EXPIRED'], [{ error: 'invalid_grant' }, 'DEVICE_AUTH_FAILED']]) {
    startDevice(); devicePolls = [[400, poll]];
    const { error } = await deviceLogin();
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, new RegExp(deviceCode));
  }
  startDevice({ expires_in: 0.001 });
  assert.equal((await deviceLogin()).error.code, 'AUTH_EXPIRED');
  requests = [];
  deviceStart = undefined;
  assert.equal((await deviceLogin()).error.code, 'DEVICE_AUTH_UNSUPPORTED');
  assert.equal(requests.some(r => r.path === '/oauth/token'), false);
  for (const overrides of [{ verification_uri: 'https://attacker.example/oauth/device' }, { verification_uri_complete: 'https://attacker.example/x' }, { user_code: '\u001b[31m' }, { device_code: '' }]) {
    startDevice(overrides);
    assert.equal((await deviceLogin()).error.code, 'INVALID_RESPONSE');
  }
});
test('device login respects Retry-After and bounds transport backoff', async () => {
  startDevice();
  devicePolls = [[429, { error: 'Too many requests' }, { 'Retry-After': '30' }], [503, {}]];
  const limited = await deviceLogin();
  assert.equal(limited.error, undefined);
  assert.deepEqual(limited.waits, [5000, 30000, 10000]);
  startDevice();
  devicePolls = Array.from({ length: 6 }, () => [503, {}]);
  const failing = await deviceLogin();
  assert.equal(failing.error.code, 'API_ERROR');
  assert.deepEqual(failing.waits, [5000, 10000, 20000, 40000, 60000, 60000]);
});
test('callback page is branded and self-contained without external assets or scripts', async () => {
  const page = callbackPage('received');
  assert.match(page, /MarineVerse CLI/);
  assert.match(page, /aria-label="MarineVerse"/);
  assert.match(page, /#00284b/);
  assert.doesNotMatch(page, /<script|<link|<img|https?:\/\/(?!www\.w3\.org)/);
  const listener = await callback(1000);
  try {
    const url = new URL(listener.redirectUri);
    url.searchParams.set('state', listener.state);
    url.searchParams.set('code', 'test-code');
    const response = await fetch(url);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.doesNotMatch(await response.text(), /test-code/);
    assert.equal(await listener.code, 'test-code');
  } finally { listener.close(); }
});
test('callback rejects wrong state, denial, missing code, and timeout', async () => {
  for (const kind of ['state', 'denial', 'code', 'timeout']) {
    const listener = await callback(kind === 'timeout' ? 10 : 1000);
    try {
      if (kind !== 'timeout') {
        const url = new URL(listener.redirectUri);
        url.searchParams.set('state', kind === 'state' ? 'wrong' : listener.state);
        if (kind === 'denial') url.searchParams.set('error', 'access_denied');
        await fetch(url);
      }
      await assert.rejects(listener.code, /state|denied|Missing|timed out/);
    } finally { listener.close(); }
  }
});
test('logout revokes both tokens and removes the local credentials', async () => {
  const auth = await signedIn();
  assert.equal((await auth.logout()).server_revocation_confirmed, true);
  assert.equal(requests.filter(r => r.path === '/oauth/revoke').length, 2);
  assert.equal(await auth.credentials.read(), undefined);
});
test('offline logout explicitly reports unconfirmed revocation while clearing local credentials', async () => {
  const auth = await signedIn(); failure = 503;
  assert.equal((await auth.logout()).server_revocation_confirmed, false);
  assert.equal(await auth.credentials.read(), undefined);
});
const posixUser = process.platform !== 'win32' && process.getuid?.() !== 0;
test('saved login details without their tokens are reported accurately and can be cleared', { skip: !posixUser }, async () => {
  const auth = await signedIn();
  await rm(join(auth.credentials.directory, 'tokens.json'));
  const missing = await cli('auth', 'status', '--local', '--json');
  assert.equal(missing.code, 3);
  assert.equal(missing.json().error.code, 'CREDENTIAL_MISSING');
  assert.match(missing.json().error.message, /tokens are missing from the credential file.*marineverse login again/);
  assert.deepEqual((await cli('auth', 'logout', '--json')).json().data, { logged_out: true, server_revocation_confirmed: false });
  assert.equal((await cli('auth', 'status', '--local', '--json')).json().error.code, 'AUTH_REQUIRED');
  assert.equal(requests.length, 0);
});
test('credential storage failures are typed and malformed local data can be cleared', { skip: !posixUser }, async () => {
  const auth = await signedIn();
  const { directory } = auth.credentials;
  await chmod(join(directory, 'tokens.json'), 0o000);
  assert.equal((await cli('auth', 'status', '--json')).json().error.code, 'CREDENTIAL_FILE_UNREADABLE');
  await chmod(join(directory, 'tokens.json'), 0o600);
  await writeFile(join(directory, 'tokens.json'), 'not json');
  assert.equal((await cli('auth', 'status', '--json')).json().error.code, 'CREDENTIAL_INVALID');
  await writeFile(join(directory, 'account.json'), '{');
  const malformed = await cli('auth', 'status', '--local', '--json');
  assert.equal(malformed.code, 3);
  assert.equal(malformed.json().error.code, 'CREDENTIAL_METADATA_INVALID');
  assert.equal((await cli('auth', 'logout', '--json')).json().data.server_revocation_confirmed, false);
  assert.equal((await cli('auth', 'status', '--local', '--json')).json().error.code, 'AUTH_REQUIRED');
  assert.equal(requests.length, 0);
});
test('login checks credential storage before contacting MarineVerse', { skip: !posixUser }, async () => {
  const saved = process.env.MARINEVERSE_CONFIG_DIR;
  const readOnly = await mkdtemp(join(tmpdir(), 'marineverse-cli-readonly-'));
  await chmod(readOnly, 0o500);
  process.env.MARINEVERSE_CONFIG_DIR = readOnly;
  try {
    const auth = new Auth(environment);
    await assert.rejects(auth.login({ browser: false, storage, announce: assert.fail }), { code: 'CREDENTIAL_DIRECTORY_UNWRITABLE' });
    await assert.rejects(auth.deviceLogin({ browser: false, storage, announce: assert.fail }), { code: 'CREDENTIAL_DIRECTORY_UNWRITABLE' });
  } finally {
    process.env.MARINEVERSE_CONFIG_DIR = saved;
    await chmod(readOnly, 0o700);
    await rm(readOnly, { recursive: true, force: true });
  }
  assert.equal(requests.length, 0);
});
test('tokens that cannot be saved are revoked and the previous session is kept', { skip: !posixUser }, async () => {
  const auth = await signedIn();
  const previous = await auth.credentials.read();
  const { directory } = auth.credentials;
  startDevice();
  // Storage breaks after the preflight check, while the CLI waits for approval.
  const error = await auth.deviceLogin({ browser: false, storage, announce() {}, sleep: () => chmod(directory, 0o500) }).then(() => undefined, failure => failure);
  await chmod(directory, 0o700);
  assert.equal(error.code, 'AUTH_CREDENTIAL_SAVE_FAILED');
  assert.match(error.message, /AUTH_LOCK_FAILED/);
  assert.deepEqual(requests.filter(r => r.path === '/oauth/revoke').map(r => new URLSearchParams(r.body).get('token')), ['refresh-0', 'access-0']);
  assert.deepEqual(await auth.credentials.read(), previous);
});
test('switching to file storage preserves the new login when old keyring cleanup fails', { skip: process.platform === 'win32' }, async () => {
  for (const failurePoint of ['entry', 'delete']) {
    const auth = await signedIn();
    await writeFile(join(auth.credentials.directory, 'account.json'), JSON.stringify({ userUuid: 'user-key', storage: 'keyring' }));
    // Simulate an unavailable native keyring without accessing the real OS store.
    auth.credentials.entry = async () => {
      if (failurePoint === 'entry') throw new CliError('CREDENTIAL_STORE_UNAVAILABLE', 'Fixture unavailable keyring');
      return { deletePassword: async () => { throw new Error('Fixture cleanup failure'); } };
    };
    startDevice();
    const { result, error } = await deviceLogin(auth);
    assert.equal(error, undefined);
    assert.equal(result.user_uuid, 'user-key');
    assert.equal((await auth.credentials.read()).accessToken, 'access-0');
    assert.equal((await auth.status()).user_uuid, 'user-key');
    assert.equal(requests.some(request => request.path === '/oauth/revoke'), false);
  }
});
test('failed credential saves report revocation only when both token revocations succeed', async () => {
  for (const statuses of [[200, 200], [503, 503], [200, 503], [503, 200]]) {
    const auth = await signedIn();
    const previous = await auth.credentials.read();
    auth.credentials.write = async () => { throw new CliError('AUTH_CREDENTIAL_SAVE_FAILED', 'Fixture storage failure'); };
    startDevice();
    devicePolls = [[200, { access_token: 'unsaved-access', refresh_token: 'unsaved-refresh', expires_in: 7200, scope: 'public' }]];
    revokeStatuses = [...statuses];
    requests = [];
    const { error } = await deviceLogin(auth);
    assert.equal(error.code, 'AUTH_CREDENTIAL_SAVE_FAILED');
    if (statuses.every(status => status === 200)) assert.match(error.message, /The new tokens were revoked\./);
    else {
      assert.match(error.message, /revocation could not be confirmed; the new tokens may still be valid/);
      assert.doesNotMatch(error.message, /tokens were revoked/);
    }
    assert.deepEqual(requests.filter(request => request.path === '/oauth/revoke').map(request => new URLSearchParams(request.body).get('token')),
      ['unsaved-refresh', 'unsaved-access']);
    assert.deepEqual(await auth.credentials.read(), previous);
  }
});
test('auth status --local reads stored metadata without network access or refresh', async () => {
  await signedIn(true);
  const result = await cli('auth', 'status', '--local', '--json');
  assert.equal(result.code, 0);
  assert.equal(result.json().data.user_uuid, 'user-key');
  assert.equal(result.json().data.access_token_expired, true);
  assert.equal(requests.length, 0);
});
test('a browser login timeout offers device login only interactively and after asking', async () => {
  const attempt = async ({ interactive = true, agree = true, code = 'AUTH_TIMEOUT' } = {}) => {
    const started = [];
    let asked = false;
    const exit = await run(['node', 'marineverse', 'login', '--browser'], {
      client: env => ({ environment: env, auth: {
        login: async () => { started.push('browser'); throw new CliError(code, 'Login did not finish.', 3); },
        deviceLogin: async () => { started.push('device'); return {}; } } }),
      stdout: () => {}, stderr: () => {}, isInteractive: () => interactive,
      confirmDeviceLogin: async () => { asked = true; return agree; },
    });
    return { exit, started, asked };
  };
  assert.deepEqual(await attempt(), { exit: 0, started: ['browser', 'device'], asked: true });
  assert.deepEqual(await attempt({ agree: false }), { exit: 3, started: ['browser'], asked: true });
  assert.deepEqual(await attempt({ interactive: false }), { exit: 3, started: ['browser'], asked: false });
  assert.deepEqual(await attempt({ code: 'AUTH_DENIED' }), { exit: 3, started: ['browser'], asked: false });
});
test('unexpected filesystem errors report only errno and system call', async () => {
  let stdout = '';
  await run(['node', 'marineverse', 'auth', 'logout', '--json'], {
    client: env => ({ environment: env, auth: { logout: async () => { throw Object.assign(new Error('open /private/secret'), { code: 'EACCES', syscall: 'open' }); } } }),
    stdout: text => stdout += text, stderr: () => {},
  });
  const { error } = JSON.parse(stdout);
  assert.equal(error.code, 'FILESYSTEM_ERROR');
  assert.match(error.message, /EACCES during open/);
  assert.doesNotMatch(error.message, /secret/);
});
