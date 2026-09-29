import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MarineVerseClient } from '../dist/client.js';
import { run } from '../dist/cli.js';

test('guest club search supports keywords and nearby filters with compact public output', async t => {
  const requests = [];
  const club = { id: 123, uuid: 'public-uuid', name: 'Royal Yachting Association', description: 'Supporting sailors.',
    canonicalUrl: 'https://www.marineverse.com/associations/assoc-rya', clubType: 'federation', countryCode: 'GB', city: 'Hamble', distanceKm: 4.125 };
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ clubs: [club] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const environment = { name: 'fixture', apiUrl: `http://127.0.0.1:${server.address().port}`, webUrl: 'https://www.marineverse.com' };
  const client = new MarineVerseClient(environment);
  client.auth.get = client.auth.post = client.auth.accessToken = assert.fail;
  const call = async (...args) => {
    let output = '', error = '';
    const code = await run(['node', 'marineverse', 'clubs', 'search', ...args], {
      client: () => client, stdout: text => output += text, stderr: text => error += text,
    });
    return { code, output, error };
  };
  const json = await call(' rya ', '--type', 'federation', '--country', 'gb', '--limit', '50', '--json');
  assert.equal(json.code, 0, json.error);
  assert.deepEqual(JSON.parse(json.output).data.clubs, [{ uuid: club.uuid, name: club.name, description: club.description, url: club.canonicalUrl,
    type: 'federation', city: 'Hamble', country_code: 'GB', distance_km: 4.125 }]);
  const parameters = new URL(requests.at(-1).url, environment.apiUrl).searchParams;
  assert.equal(parameters.get('q'), 'rya');
  assert.equal(parameters.get('club_type'), 'federation');
  assert.equal(parameters.get('country_code'), 'GB');
  assert.equal(parameters.get('limit'), '50');
  const nearby = await call('--latitude', '-37.8', '--longitude', '144.9', '--radius-km', '20', '--type', 'sailability_chapter');
  assert.equal(nearby.code, 0, nearby.error);
  assert.match(nearby.output, /NAME.*DESCRIPTION.*MARINEVERSE URL.*DISTANCE/);
  assert.match(nearby.output, /associations\/assoc-rya/);
  const coordinates = new URL(requests.at(-1).url, environment.apiUrl).searchParams;
  assert.equal(coordinates.get('latitude'), '-37.8');
  assert.equal(coordinates.get('radius_km'), '20');
  const count = requests.length;
  for (const args of [[' '], ['x'.repeat(201)], ['--latitude', '0'], ['--longitude', '0'], ['--radius-km', '20'],
    ['--latitude', '91', '--longitude', '0'], ['--latitude', 'NaN', '--longitude', '0'],
    ['--latitude', '0', '--longitude', '0', '--radius-km', '501'], ['--type', 'private'], ['--country', 'Australia'],
    ['--limit', '51'], ['--limit', '1.5']]) assert.equal((await call(...args)).code, 2, args.join(' '));
  assert.equal(requests.length, count);
  assert.ok(requests.every(req => req.authorization === undefined));
});

test('membership commands share groups alias, validate before auth and preserve approval status', async () => {
  const client = new MarineVerseClient({ name: 'fixture', apiUrl: 'https://example.test', webUrl: 'https://example.test' });
  const club = { uuid: 'public-uuid', slug: 'test-club', name: 'Test club', description: 'Sailing together.', url: 'https://example.test/clubs/test-club', id: 123 };
  const calls = [];
  client.auth.get = async (path, scope) => { calls.push({ path, scope }); return { memberships: [{ club, role: 'member', status: 'active' }], pending_requests: [{ club, status: 'pending', message: 'Hello' }] }; };
  client.auth.write = async (method, path, body, scope) => { calls.push({ method, path, body, scope }); return { status: method === 'DELETE' ? 'left' : 'pending_approval', club, request: { status: 'pending', message: 'Hello' } }; };
  const call = async (...args) => {
    let output = '', error = '';
    const code = await run(['node', 'marineverse', ...args], { client: () => client, stdout: text => output += text, stderr: text => error += text });
    return { code, output, error };
  };
  const list = await call('groups', 'list', '--json');
  assert.equal(list.code, 0, list.error);
  assert.equal(JSON.parse(list.output).data.memberships[0].club.id, undefined);
  assert.deepEqual(calls.at(-1), { path: '/api/v3/sailing-clubs/my', scope: 'clubs_read' });
  assert.match((await call('clubs', 'my')).output, /Memberships[\s\S]*active[\s\S]*Pending requests[\s\S]*pending/);
  const join = await call('groups', 'join', 'test-club', '--message', ' Hello ');
  assert.equal(join.code, 0, join.error);
  assert.match(join.output, /Join request pending approval/);
  assert.doesNotMatch(join.output, /Joined/);
  assert.deepEqual(calls.at(-1), { method: 'POST', path: '/api/v3/sailing-clubs/test-club/join', body: { message: 'Hello' }, scope: 'clubs_write' });
  assert.equal((await call('clubs', 'leave', 'public-uuid')).code, 0);
  assert.deepEqual(calls.at(-1), { method: 'DELETE', path: '/api/v3/sailing-clubs/public-uuid/leave', body: {}, scope: 'clubs_write' });
  const count = calls.length;
  for (const args of [['join', '../private'], ['leave', 'club/path'], ['join', 'club--invalid'], ['leave', 'x'.repeat(101)], ['join', 'test-club', '--message', ' '], ['join', 'test-club', '--message', 'x'.repeat(10001)]]) assert.equal((await call('clubs', ...args)).code, 2);
  assert.equal(calls.length, count);
  for (const value of [null, {}, { memberships: [null], pending_requests: [] }, { memberships: [], pending_requests: [{ club, status: 1 }] }]) {
    client.auth.get = async () => value;
    await assert.rejects(() => client.clubs.list(), error => error.code === 'INVALID_RESPONSE');
  }
  for (const value of [null, {}, { status: 'joined', club: {} }, { status: 'rejected', club }, { status: 'pending_approval', club, request: { status: 1 } }]) {
    client.auth.write = async () => value;
    await assert.rejects(() => client.clubs.join('test-club'), error => error.code === 'INVALID_RESPONSE');
  }
});

test('club search rejects malformed API responses', async () => {
  const original = globalThis.fetch;
  try {
    const client = new MarineVerseClient({ name: 'fixture', apiUrl: 'https://example.test', webUrl: 'https://example.test' });
    for (const value of [{}, { clubs: [null] }, { clubs: [{ name: 'Missing details' }] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
      await assert.rejects(() => client.clubs.search(), error => error.code === 'INVALID_RESPONSE');
    }
  } finally { globalThis.fetch = original; }
});

test('membership API requests use normal OAuth scopes and never replay writes', async () => {
  const original = globalThis.fetch;
  const client = new MarineVerseClient({ name: 'fixture', apiUrl: 'https://example.test', webUrl: 'https://example.test', clientId: 'fixture' });
  client.auth.accessToken = async () => 'fixture-token';
  client.auth.credentials.read = async () => ({ scopes: ['clubs_read', 'clubs_write'] });
  const club = { uuid: 'public-uuid', slug: 'test-club', name: 'Test club', description: 'Sailing together.', url: 'https://example.test/clubs/test-club' };
  let calls = [], status = 200;
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, method: options.method || 'GET', authorization: options.headers.get('Authorization'), body: options.body });
      return new Response(JSON.stringify(status === 200 ? { status: 'joined', club } : { error: 'Denied' }), { status, headers: { 'Content-Type': 'application/json' } });
    };
    assert.equal((await client.clubs.join('test-club')).status, 'joined');
    assert.deepEqual(calls[0], { url: 'https://example.test/api/v3/sailing-clubs/test-club/join', method: 'POST', authorization: 'Bearer fixture-token', body: '{}' });
    for (status of [401, 403, 429, 503]) {
      calls = [];
      await assert.rejects(() => client.clubs.join('test-club'));
      assert.equal(calls.length, 1);
      calls = [];
      await assert.rejects(() => client.clubs.leave('test-club'));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'DELETE');
    }
    calls = [];
    client.auth.credentials.read = async () => ({ scopes: ['public'] });
    for (const action of [() => client.clubs.list(), () => client.clubs.join('test-club'), () => client.clubs.leave('test-club')]) {
      await assert.rejects(action, error => error.code === 'AUTH_REQUIRED' && /marineverse login again/.test(error.message));
    }
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = original; }
});
