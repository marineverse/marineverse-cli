import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { MarineVerseClient, boat } from '../dist/client.js';
import { run } from '../dist/cli.js';
import { request, REQUEST_TIMEOUT_MS } from '../dist/http.js';
import { commandReceipt, parseBoatRequest } from '../dist/globe.js';

// Synthetic responses shaped by Rails StateSerializer and CommandProcessor.
// Optional exporter check below also exercises actual Rails-produced receipts.
const base = () => ({ uuid: 'boat-key', name: 'Test Boat', p_lat: 0, p_lng: 0.002, heading: 45,
  target_heading: 90, mainsail_hoist_level: 0.2, jib_hoist_level: 0, mainsheet: 0.4, jibsheet: null,
  state_version: 1792670400000000, last_simulation_update: '2026-10-22T12:00:00.000000Z',
  velocity_east_mps: 0.1, velocity_north_mps: -0.2, yaw_rate_rad_s: 0.01,
  anchor: { supported: true, control_protocol: 1, mode: 'anchoring_v1', revision: 7, state: 'stowed',
    can_control: false, can_trim_sails: true, bottom_contact: false, secured: false, rode_m: 0, target_rode_m: 0,
    eligibility: { eligible: false, reason: 'too_far_from_shore', depth_m: 12, recommended_rode_m: 65 } } });

let server, origin, client, current, calls, replies, reads, writes;
before(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, path: req.url, body });
    assert.equal(req.url, '/api/v3/globe_boats/boat-key/commands');
    const input = JSON.parse(body);
    const response = replies.shift() ?? { status: 200, body: { command_id: input.command_id, applied: true, reason: 'applied',
      boat: { ...current, anchor: { ...current.anchor, revision: 8, state: input.command === 'anchor_drop' ? 'deploying' : current.anchor.state } },
      retry_horizon_seconds: 900, future_optional_field: 42 } };
    if (response.disconnect) return req.socket.destroy();
    res.writeHead(response.status);
    res.end(JSON.stringify(typeof response.body === 'function' ? response.body(input) : response.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  current = base(); calls = []; replies = []; reads = []; writes = [];
  client = new MarineVerseClient({ name: 'fixture', apiUrl: origin, webUrl: origin, clientId: 'fixture' });
  client.auth.get = async (path, scope) => { reads.push({ path, scope }); return { boat: current }; };
  client.auth.write = async (method, path, body, scope, budget) => {
    writes.push({ method, path, body, scope });
    return request(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, REQUEST_TIMEOUT_MS, false, budget);
  };
});

async function cli(...args) {
  let stdout = '', stderr = '';
  const code = await run(['node', 'marineverse', '--api-url', origin, 'globe', 'boats', ...args], {
    client: () => client, stdout: s => stdout += s, stderr: s => stderr += s,
  });
  return { code, stdout, stderr, json: () => JSON.parse(stdout) };
}

test('readback exposes anchor permissions, exact geometry, vectors and additive fields', async () => {
  current.anchor.future_optional = { extra: true };
  const result = await cli('show', 'boat-key', '--check-anchor', '--json');
  assert.equal(result.code, 0, result.stdout);
  const value = result.json().data.boat;
  assert.deepEqual(value.anchor, current.anchor);
  for (const field of ['target_heading', 'mainsheet', 'jibsheet', 'velocity_east_mps', 'velocity_north_mps', 'yaw_rate_rad_s', 'state_version', 'last_simulation_update']) {
    assert.equal(value[field], current[field]);
  }
  assert.equal(value.mainsail_hoist, 0.2);
  assert.deepEqual(reads, [{ path: '/api/v3/globe_boats/boat-key?anchor_preview=1', scope: 'globe_read' }]);
  const human = await cli('show', 'boat-key', '--columns', 'name,anchor,rode,target-rode,control,trim-sails');
  assert.equal(reads.at(-1).path, '/api/v3/globe_boats/boat-key', 'ordinary status reads skip anchor geography');
  assert.match(human.stdout, /Anchoring unavailable: Anchoring is unavailable this far from shore/);
  assert.match(human.stdout, /Last saved position: 2026-10-22T12:00:00.000000Z. REST snapshot, not live telemetry/);
  assert.match(human.stdout, /boat control false; sail trim true/);
  assert.equal(writes.length, 0);
});

test('anchor and sheet commands send exact intent, fresh revision, and no incidental sail changes', async () => {
  for (const [args, intent] of [
    [['drop-anchor'], { command: 'anchor_drop' }],
    [['set-rode', '--meters', '40'], { command: 'anchor_set_rode', rode_m: 40 }],
    [['set-rode', '--recommended'], { command: 'anchor_set_rode', recommended: true }],
    [['secure-anchor'], { command: 'anchor_secure' }],
    [['secure-anchor', '--recommended'], { command: 'anchor_secure', recommended: true }],
    [['retrieve-anchor'], { command: 'anchor_retrieve' }],
    [['set-sheets', '--main', '0', '--jib', '1'], { command: 'boat_set_controls', mainsheet: 0, jibsheet: 1 }],
  ]) {
    const result = await cli(args[0], 'boat-key', ...args.slice(1), '--json');
    assert.equal(result.code, 0, result.stdout);
    const sent = JSON.parse(calls.at(-1).body);
    const { command_id, issued_at, expected_revision, ...values } = sent;
    assert.deepEqual(values, intent);
    assert.equal(expected_revision, 7);
    assert.match(command_id, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(issued_at)));
    assert.deepEqual(result.json().data.request, sent);
    assert.equal(result.json().data.applied, true);
    assert.equal(result.json().data.verified, undefined);
    assert.match(result.json().data.warning, /does not confirm execution/);
    assert.equal(reads.at(-1).path, '/api/v3/globe_boats/boat-key', 'control prefetch does not compute an unused anchor preview');
    assert.equal(writes.at(-1).scope, 'globe_write');
  }
  assert.equal(new Set(writes.map(item => item.body.command_id)).size, 7);
  assert.equal(reads.length, 7);
});

test('invalid rode, sheet and retry input fail before any requests', async () => {
  for (const args of [
    ['set-rode', 'boat-key'], ['set-rode', 'boat-key', '--meters', '20', '--recommended'],
    ...['-1', 'NaN', 'Infinity', '', ' '].map(value => ['set-rode', 'boat-key', '--meters', value]),
    ['set-sheets', 'boat-key'], ['set-sheets', 'boat-key', '--jib', '1.1'],
    ['retry-command', 'boat-key', '--request', 'null'], ['retry-command', 'boat-key', '--request', '{}'],
  ]) assert.equal((await cli(...args, '--json')).code, 2, args.join(' '));
  assert.equal(reads.length + writes.length, 0);
});

test('older server control state refuses mutation instead of falling back to legacy PATCH', async () => {
  delete current.anchor.control_protocol;
  const result = await cli('drop-anchor', 'boat-key', '--json');
  assert.equal(result.code, 6);
  assert.equal(result.json().error.code, 'UNSUPPORTED_BOAT_CONTROLS');
  assert.equal(writes.length, 0);
});

test('extension callers cannot combine rename with a legacy control bypass', async () => {
  await assert.rejects(client.updateBoat('boat-key', { name: 'New Name', heading: 90 }), /Rename separately/);
  assert.equal(reads.length + writes.length, 0);
});

test('a slow ordinary command retains the thirty-second network budget', async t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  let attempts = 0;
  client.auth.write = async (_method, _path, input, _scope, budget) => {
    attempts++;
    assert.equal(budget.remaining(), 30_000);
    now = 20_000;
    assert.equal(budget.remaining(), 10_000);
    return { command_id: input.command_id, applied: true, reason: 'applied', boat: current };
  };
  const result = await cli('drop-anchor', 'boat-key', '--json');
  assert.equal(result.code, 0, result.stdout);
  assert.equal(attempts, 1);
});

test('human error output retains the original envelope without requiring another mutation for JSON', async () => {
  replies = [{ disconnect: true }];
  const result = await cli('drop-anchor', 'boat-key');
  assert.equal(result.code, 7);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /inspect boat state first/);
  assert.ok(result.stderr.includes(calls[0].body));
  assert.doesNotMatch(result.stderr, /use --json/);
});

test('stale revision and permission refusals preserve reason and request without retry', async () => {
  for (const [status, reason, exit] of [[409, 'stale_revision', 7], [409, 'simulation_catching_up', 7], [403, 'not_authorized', 4], [422, 'insufficient_rode', 6]]) {
    calls = [];
    replies = [{ status, body: input => ({ command_id: input.command_id, applied: false, reason, boat: status === 403 ? undefined : current }) }];
    const result = await cli('drop-anchor', 'boat-key', '--json');
    assert.equal(result.code, exit, result.stdout);
    assert.equal(result.json().error.details.receipt.reason, reason);
    assert.deepEqual(result.json().error.details.request, JSON.parse(calls[0].body));
    assert.equal(calls.length, 1);
  }
});

test('ambiguous socket failure retains exact request; explicit retry does not refresh or rebase it', async () => {
  replies = [{ disconnect: true }];
  const failed = await cli('drop-anchor', 'boat-key', '--json');
  assert.equal(failed.code, 7);
  assert.match(failed.json().error.message, /outcome is unknown/);
  assert.equal(calls.length, 1);
  const envelope = failed.json().error.details.request;
  current.anchor.revision = 99;
  const retried = await cli('retry-command', 'boat-key', '--request', JSON.stringify(envelope), '--json');
  assert.equal(retried.code, 0, retried.stdout);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(reads.length, 1);
});

test('unknown optional or malformed response fields cannot turn an invalid receipt into success', async () => {
  for (const body of [null, [], 'unknown', { command_id: 'other', applied: true, reason: 'applied', boat: base() }]) {
    calls = [];
    replies = [{ status: 200, body }];
    const result = await cli('drop-anchor', 'boat-key', '--json');
    assert.equal(result.code, 7);
    assert.equal(result.json().error.code, 'INVALID_RESPONSE');
    assert.ok(result.json().error.details.request.command_id);
    assert.equal(calls.length, 1);
  }
});

test('exact retry parser preserves timestamps and values without coercion', () => {
  const original = { command: 'boat_set_controls', command_id: '12345678-1234-1234-1234-123456789012', issued_at: '2026-10-22T12:00:00.000000Z',
    expected_revision: 17, mainsail_hoist_level: 0.375, jibsheet: 0 };
  assert.deepEqual(parseBoatRequest(JSON.stringify(original)), original);
  for (const invalid of [{ ...original, expected_revision: -1 }, { ...original, mainsail_hoist_level: '0.375' }, { ...original, client_token: 'synthetic' }]) {
    assert.throws(() => parseBoatRequest(JSON.stringify(invalid)), /unchanged request/);
  }
});

test('actual Rails exported receipt retains anchor/contact and motion contract', { skip: !process.env.MARINEVERSE_GLOBE_CONTRACT_FILE }, async () => {
  const exported = JSON.parse(await readFile(process.env.MARINEVERSE_GLOBE_CONTRACT_FILE, 'utf8'));
  const source = exported.receipt ?? exported;
  const result = commandReceipt(source, source.command_id, boat);
  assert.equal(result.applied, true);
  assert.equal(result.boat.anchor.control_protocol, 1);
  assert.deepEqual(result.boat.anchor, source.boat.anchor);
  assert.equal(result.boat.anchor.bottom_contact, false);
  assert.equal(result.boat.anchor.state, 'deploying');
  assert.equal(result.boat.velocity_east_mps, source.boat.velocity_east_mps);
});
