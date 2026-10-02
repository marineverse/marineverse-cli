import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarineVerseClient } from '../dist/client.js';
import { run } from '../dist/cli.js';
import { human } from '../dist/output.js';
import { racingHuman } from '../dist/racing-output.js';

const environment = { name: 'fixture', apiUrl: 'https://api.example.test', webUrl: 'https://example.test' };
const links = { web: 'https://example.test/marineverse-cup/race/race-one', map_2d: 'https://example.test/marineverse-cup/race/race-one/map2d', map_3d: 'https://example.test/marineverse-cup/race/race-one/map3d', chart: 'https://example.test/marineverse-cup/race/race-one/charts' };
const entry = { id: 41, key: 'private/replay', public_key: 'entry-one', race_public_key: 'race-one', name: 'Fixture sailor', race_time_seconds: 81.25, points: 12,
  stats: { start_speed: 4.25, start_delay: 0.5, max_speed: 8.9 }, legs: [{ name: 'Leg 1', start_time: 0, end_time: 30.75, num_tacks: 2, num_gybes: 0, avg_speed: 5.3, distance_traveled: 125 }], links };
const race = { id: 9, public_key: 'race-one', name: 'Fixture race', boat_model: 'yacht', entries: [entry], ai_summary: 'A close race.', links };

function setup() {
  const client = new MarineVerseClient(environment);
  client.auth.credentials.read = async () => null;
  const opened = [];
  const call = async (...args) => {
    let output = '', error = '';
    const code = await run(['node', 'marineverse', 'racing', ...args], { client: () => client, stdout: text => output += text, stderr: text => error += text,
      openBrowser: async url => opened.push(url) });
    return { code, output, error, data: output.startsWith('{') ? JSON.parse(output).data : undefined };
  };
  return { client, call, opened };
}

test('guest racing discovery uses public GETs and preserves points, stats, legs and canonical links', async () => {
  const original = globalThis.fetch;
  const { client, call, opened } = setup();
  const requests = [];
  client.auth.get = assert.fail;
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), method: options.method || 'GET', authorization: options.headers.get('Authorization') });
      const path = new URL(url).pathname;
      const body = path.endsWith('/leagues') ? { leagues: [{ public_key: 'league-one', name: 'Fixture league', links: { web: 'https://example.test/leagues/league-one' } }] }
        : path.endsWith('/series') ? { series: [{ public_key: 'series-one', name: 'Fixture series' }], pagination: { current_page: 1, total_pages: 2, total_entries: 10 } }
        : path.endsWith('/rankings') ? { rankings: [{ id: 8, position: 1, name: 'Fixture sailor', points: 1520, points_change: 20 }], date: '2026-09-30' }
        : path.endsWith('/races') ? { races: [race], pagination: { current_page: 2, total_pages: 2, total_entries: 8 } }
        : path.includes('/entries/') ? { entry } : { race };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    };
    const result = await call('drp', 'races', 'list', '--league', 'league-one', '--boat', 'yacht', '--page', '2', '--json');
    assert.equal(result.code, 0, result.error);
    assert.equal(new URL(requests.at(-1).url).search, '?league=league-one&boat=yacht&page=2');
    assert.equal(result.data.races[0].id, undefined);
    assert.equal(result.data.races[0].entries[0].key, undefined);
    assert.equal(result.data.races[0].entries[0].race_time_seconds, 81.25);
    assert.match((await call('leagues', 'list')).output, /LEAGUE KEY.*NAME/);
    assert.match((await call('multiplayer', 'races', 'show', 'race-one')).output, /Fixture race[\s\S]*POINTS[\s\S]*A close race/);
    assert.equal((await call('drp', 'races', 'summary', 'race-one', '--json')).data.race.ai_summary, 'A close race.');
    assert.equal((await call('drp', 'entries', 'stats', 'entry-one', '--json')).data.entry.stats.max_speed, 8.9);
    assert.match((await call('drp', 'races', 'stats', 'race-one')).output, /START \(kn\)[\s\S]*4.25/);
    assert.match((await call('drp', 'entries', 'legs', 'entry-one')).output, /DURATION[\s\S]*30.75 s/);
    assert.equal((await call('drp', 'races', 'links', 'race-one', '--json')).data.links.map_3d, links.map_3d);
    assert.equal((await call('drp', 'series', 'list', '--json')).data.pagination.total_pages, 2);
    assert.equal((await call('drp', 'ratings', 'list', '--league', 'league-one', '--date', '2026-09-30', '--country', 'au', '--json')).data.rankings[0].points, 1520);
    assert.equal(new URL(requests.at(-1).url).searchParams.get('country'), 'AU');
    assert.equal((await call('multiplayer', 'ratings', 'list', '--type', 'participation', '--boat', 'dinghy', '--days', '30')).code, 0);
    assert.equal((await call('globe', 'races', 'list', '--json')).code, 0);
    assert.ok(requests.every(request => request.authorization === null && request.method === 'GET'));
    assert.deepEqual(opened, []);
  } finally { globalThis.fetch = original; }
});

test('personal reads and saved-session race details use normal sailing_cv OAuth without anonymous fallback', async () => {
  const { client, call } = setup();
  const calls = [];
  client.auth.get = async (path, scope) => {
    calls.push({ path, scope });
    return path.endsWith('/dashboard') ? { dashboard: { today_races: [] } } : path.includes('/leagues') ? { leagues: [] } : path.includes('?mine') ? { races: [race] } : { race };
  };
  assert.equal((await call('dashboard', '--json')).code, 0);
  assert.deepEqual(calls.at(-1), { path: '/api/v3/racing/dashboard', scope: 'sailing_cv' });
  assert.equal((await call('leagues', 'list', '--mine')).code, 0);
  for (const mode of ['drp', 'multiplayer', 'globe']) {
    assert.equal((await call(mode, 'races', 'list', '--mine')).code, 0);
    assert.deepEqual(calls.at(-1), { path: `/api/v3/racing/${mode}/races?mine=true`, scope: 'sailing_cv' });
  }
  client.auth.credentials.read = async () => ({ scopes: ['sailing_cv'] });
  assert.equal((await call('drp', 'races', 'show', 'race-one')).code, 0);
  assert.deepEqual(calls.at(-1), { path: '/api/v3/racing/drp/races/race-one', scope: 'sailing_cv' });
  client.auth.get = async () => { throw new Error('invalid saved session'); };
  assert.notEqual((await call('drp', 'races', 'show', 'race-one')).code, 0);
});

test('discovery lists use optional saved identity and never turn invalid sessions into guest reads', async () => {
  const { client, call } = setup();
  const original = globalThis.fetch;
  const guestRequests = [], authenticatedRequests = [];
  const body = path => path.includes('/leagues') ? { leagues: [{ public_key: 'private-league', name: 'Fixture private league' }] }
    : path.includes('/series') ? { series: [{ public_key: 'private-series', name: 'Fixture private series' }], pagination: { current_page: 1 } }
    : path.includes('/tournaments') ? { tournaments: [{ public_key: 'private-tournament', name: 'Fixture private tournament' }], pagination: { current_page: 1 } }
    : { races: [race], pagination: { current_page: 1 } };
  const reads = [['leagues', 'list'], ['drp', 'races', 'list', '--league', 'private-league'], ['multiplayer', 'races', 'list'], ['globe', 'races', 'list'],
    ['drp', 'series', 'list', '--league', 'private-league'], ['tournaments', 'list']];
  try {
    globalThis.fetch = async (url, options) => {
      guestRequests.push({ url: String(url), authorization: options.headers.get('Authorization') });
      return new Response(JSON.stringify(body(new URL(url).pathname)));
    };
    client.auth.get = async (path, scope) => {
      authenticatedRequests.push({ path, scope });
      return body(path);
    };
    for (const args of reads) assert.equal((await call(...args, '--json')).code, 0);
    assert.equal(guestRequests.length, reads.length);
    assert.ok(guestRequests.every(request => request.authorization === null));
    assert.deepEqual(authenticatedRequests, []);
    client.auth.credentials.read = async () => ({ scopes: ['sailing_cv'] });
    for (const args of reads) assert.equal((await call(...args, '--json')).code, 0);
    assert.equal(guestRequests.length, reads.length);
    assert.deepEqual(authenticatedRequests, [
      { path: '/api/v3/racing/leagues', scope: 'sailing_cv' },
      { path: '/api/v3/racing/drp/races?league=private-league', scope: 'sailing_cv' },
      { path: '/api/v3/racing/multiplayer/races', scope: 'sailing_cv' },
      { path: '/api/v3/racing/globe/races', scope: 'sailing_cv' },
      { path: '/api/v3/racing/drp/series?league=private-league', scope: 'sailing_cv' },
      { path: '/api/v3/racing/tournaments', scope: 'sailing_cv' }
    ]);
    client.auth.get = async () => { throw new Error('invalid saved session'); };
    for (const args of reads) assert.notEqual((await call(...args, '--json')).code, 0);
    assert.equal(guestRequests.length, reads.length);
  } finally { globalThis.fetch = original; }
});

test('comparison reads existing stat differences and browser opens only a validated returned link', async () => {
  const original = globalThis.fetch;
  const { call, opened } = setup();
  const requests = [];
  try {
    globalThis.fetch = async url => {
      requests.push(String(url));
      const body = new URL(url).pathname.endsWith('/compare') ? { comparison: { race_public_key: 'race-one', entries: [entry, { ...entry, public_key: 'entry-two', name: 'Fixture rival', race_time_seconds: 85 }],
        stats: [{ metric: 'race_time_seconds', first: 81.25, second: 85, difference: -3.75 }], legs: [{ leg: 1, first: { name: 'Leg 1', start_time: 0, end_time: 30 }, second: { name: 'Leg 1', start_time: 0, end_time: 32 }, differences: { duration_seconds: -2 } }], ai_summary: null, links: { web: 'https://example.test/compare' } } } : { race };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    };
    const compare = await call('drp', 'entries', 'compare', 'entry-one', 'entry-two', '--json');
    assert.equal(compare.code, 0, compare.error);
    assert.equal(compare.data.comparison.stats[0].difference, -3.75);
    assert.equal(compare.data.comparison.legs[0].differences.duration_seconds, -2);
    assert.equal(new URL(requests.at(-1)).searchParams.get('entries'), 'entry-one,entry-two');
    assert.deepEqual(opened, []);
    const comparisonUrl = await call('drp', 'entries', 'compare', 'entry-one', 'entry-two', '--open', '--no-browser', '--json');
    assert.deepEqual(comparisonUrl.data, { url: 'https://example.test/compare', browser_opened: false });
    assert.deepEqual(opened, []);
    const printed = await call('drp', 'races', 'open', 'race-one', '--view', 'map_3d', '--no-browser', '--json');
    assert.equal(printed.code, 0, printed.error);
    assert.deepEqual(printed.data, { url: links.map_3d, browser_opened: false });
    assert.deepEqual(opened, []);
    assert.equal((await call('drp', 'races', 'open', 'race-one', '--view', 'chart', '--json')).code, 0);
    assert.deepEqual(opened, [links.chart]);
    const official = 'https://www.marineverse.com/marineverse-cup/race/race-one';
    globalThis.fetch = async () => new Response(JSON.stringify({ race: { ...race, links: { web: official } } }));
    assert.equal((await call('drp', 'races', 'open', 'race-one', '--json')).data.url, official);
    assert.deepEqual(opened, [links.chart, official]);
    globalThis.fetch = async () => new Response(JSON.stringify({ race: { ...race, links: { web: 'https://evil.example/phishing' } } }));
    assert.notEqual((await call('drp', 'races', 'open', 'race-one')).code, 0);
    assert.deepEqual(opened, [links.chart, official]);
  } finally { globalThis.fetch = original; }
});

test('comparison leg durations label seconds and preserve recorded values with unspecified units', () => {
  const comparison = { entries: [entry, { ...entry, public_key: 'entry-two' }], legs: [
    { first: { name: 'Leg 1', start_time: 0, end_time: 30.75, duration: 999 }, second: { name: 'Leg 1', duration: 77 }, differences: {} },
    { first: { name: 'Leg 2', duration_seconds: 12.5 }, second: { name: 'Leg 2', duration: 0 }, differences: { duration_seconds: -2 } }
  ] };
  const output = racingHuman({ comparison });
  assert.match(output, /FIRST DURATION\s+SECOND DURATION\s+DIFFERENCE \(s\)/);
  assert.match(output, /30.75 s\s+77 \(recorded; units unspecified\)\s+—/);
  assert.match(output, /12.5 s\s+0 \(recorded; units unspecified\)\s+-2/);
  assert.ok(!output.includes('FIRST (s)'));
  assert.ok(!output.includes('SECOND (s)'));
  assert.equal(comparison.legs[0].first.duration, 999);
  assert.equal(comparison.legs[0].second.duration, 77);
});

test('racing validates keys and filters before any request and rejects malformed results', async () => {
  const { client, call } = setup();
  let reads = 0;
  client.auth.get = async () => { reads++; return {}; };
  client.auth.credentials.read = async () => { reads++; return null; };
  for (const args of [['drp', 'races', 'show', '../private'], ['drp', 'races', 'list', '--page', '0'], ['drp', 'ratings', 'list', '--date', '2026-02-30'],
    ['drp', 'ratings', 'list', '--type', 'wins', '--date', '2026-09-30'], ['multiplayer', 'ratings', 'list', '--country', 'Australia'],
    ['multiplayer', 'ratings', 'list', '--days', '30'], ['drp', 'entries', 'compare', 'entry-one', 'entry-one']]) {
    assert.equal((await call(...args)).code, 2, args.join(' '));
  }
  assert.equal(reads, 0);
  client.auth.get = async () => ({ races: [{}] });
  assert.equal((await call('drp', 'races', 'list', '--mine')).code, 7);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ race: {} }));
    assert.equal((await call('drp', 'races', 'show', 'race-one')).code, 7);
  } finally { globalThis.fetch = original; }
});

test('multiplayer schedule reads the shared server projection anonymously and preserves authoritative next starts', async () => {
  const original = globalThis.fetch;
  const { client, call, opened } = setup();
  client.auth.get = client.auth.credentials.read = assert.fail;
  const requests = [];
  let zone = 'Europe/London';
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, authorization: options.headers.get('Authorization') });
      return new Response(JSON.stringify({ schedule: { schema_version: 1, as_of: '2026-03-28T19:00:00Z', source: 'https://api.marineverse.com/api/v3/racing/schedule',
        sessions: [{ session_key: 'weekly-intro', description: 'Intro session', time_label: 'Sunday 8PM', day_of_week: 0, hour: 20, minute: 0,
          time_zone: zone, next_start: '2026-03-29T19:00:00Z', volunteers: [{ name: 'Fixture volunteer', uuid: 'public-profile' }] }], community_volunteers: [],
        links: { web: 'https://www.marineverse.com/marineverse-cup/multiplayer', live: 'https://www.marineverse.com/marineverse-cup/multiplayer/live', events: 'https://lu.ma/vr-sailing' } } }));
    };
    const result = await call('multiplayer', 'schedule', '--json');
    assert.equal(result.code, 0, result.error);
    assert.equal(result.data.schedule.sessions[0].session_key, 'weekly-intro');
    assert.equal(result.data.schedule.sessions[0].time_zone, 'Europe/London');
    assert.equal(result.data.schedule.sessions[0].hour, 20);
    assert.equal(result.data.schedule.sessions[0].next_start, '2026-03-29T19:00:00Z');
    assert.equal(result.data.schedule.as_of, '2026-03-28T19:00:00Z');
    assert.equal(result.data.schedule.source, 'https://api.marineverse.com/api/v3/racing/schedule');
    assert.equal(result.data.schedule.links.events, 'https://lu.ma/vr-sailing');
    assert.match((await call('multiplayer', 'schedule')).output, /Sunday 8PM.*Europe\/London/);
    assert.ok(requests.every(request => request.url === 'https://api.example.test/api/v3/racing/schedule' && request.authorization === null));
    assert.deepEqual(opened, []);
    zone = 'Invalid/Zone';
    assert.equal((await call('multiplayer', 'schedule')).code, 7);
  } finally { globalThis.fetch = original; }
});

test('personal ratings, explanations, attempts and activity preserve source dates and real missing history', async () => {
  const { client, call } = setup();
  const calls = [];
  client.auth.get = async (path, scope) => {
    calls.push({ path, scope });
    if (path.includes('/activity')) return { activity: { type: 'drp', time_zone: 'Australia/Melbourne', start_date: '2026-09-29', end_date: '2026-09-30', current_streak: 1, longest_streak: 5, total_active_days: 1, total_count: 2, count_unit: 'races', activities: [{ date: '2026-09-29', count: 0, level: 0 }, { date: '2026-09-30', count: 2, level: 2 }] } };
    if (path.includes('/rating/explain')) return { explanation: { name: 'Fixture sailor', date: '2026-09-30', previous_date: '2026-09-29', points: 1520, previous_points: 1500, points_change: 20, calculated_points_change: 20, reconciled: true,
      races: [{ public_key: 'race-one', name: 'Fixture race', points_before: 1500, points_after: 1520, points_change: 20, calculation_log: ['Fixture contribution'] }] } };
    if (path.includes('/multiplayer/rating')) return { rating: { name: 'Fixture sailor', mode: 'multiplayer', boat_model: 'yacht', rating: 1010, previous_rating: null, points_change: null, history_available: false } };
    if (path.includes('/rating')) return { rating: { name: 'Fixture sailor', mode: 'drp', requested_date: '2026-10-01', date: '2026-09-30', previous_date: '2026-09-29', points: 1520, previous_points: 1500, points_change: 20, position: 3 } };
    return { entries: [entry], pagination: { current_page: 1, per_page: 25, total_entries: 1, total_pages: 1 } };
  };
  const rating = await call('drp', 'ratings', 'show', '--json');
  assert.equal(rating.code, 0, rating.error);
  assert.equal(rating.data.rating.requested_date, '2026-10-01');
  assert.equal(rating.data.rating.date, '2026-09-30');
  assert.deepEqual(calls.at(-1), { path: '/api/v3/racing/drp/rating', scope: 'sailing_cv' });
  const explain = await call('drp', 'ratings', 'explain', '--league', 'league-one', '--date', '2026-09-30', '--json');
  assert.equal(explain.data.explanation.races[0].points_change, 20);
  assert.equal(explain.data.explanation.reconciled, true);
  assert.equal(calls.at(-1).path, '/api/v3/racing/drp/rating/explain?league=league-one&date=2026-09-30');
  assert.match((await call('multiplayer', 'ratings', 'show', '--boat', 'yacht')).output, /Historical rating changes are unavailable/);
  const history = await call('drp', 'entries', 'list', '--mine', '--since', '2026-09-30T00:00:00+10:00', '--json');
  assert.equal(history.data.entries[0].race_time_seconds, 81.25);
  assert.equal(new URL(calls.at(-1).path, environment.apiUrl).searchParams.get('since'), '2026-09-30T00:00:00+10:00');
  const activity = await call('activity', '--type', 'drp', '--since', '2026-09-29', '--until', '2026-09-30', '--json');
  assert.equal(activity.data.activity.activities[0].count, 0);
  assert.equal(activity.data.activity.activities[1].count, 2);
  assert.equal(calls.at(-1).path, '/api/v3/racing/activity?type=drp&since=2026-09-29&until=2026-09-30');
  const count = calls.length;
  assert.equal((await call('activity', '--since', '2026-10-02', '--until', '2026-10-01')).code, 2);
  assert.equal((await call('drp', 'entries', 'list', '--mine', '--since', '2026-09-30')).code, 2);
  assert.equal(calls.length, count);
  client.auth.credentials.read = async () => ({ scopes: ['sailing_cv'] });
  assert.equal((await call('drp', 'ratings', 'show', '--profile', '/public-profile', '--json')).code, 0);
  assert.equal(new URL(calls.at(-1).path, environment.apiUrl).searchParams.get('profile'), '/public-profile');
});

test('missing rating baselines remain explicit in JSON and readable explanations', async () => {
  const { client, call } = setup();
  const explanation = { mode: 'drp', name: 'Fixture sailor', date: '2026-09-30', points: 1500, previous_date: null, previous_points: null, points_change: null,
    explanation_available: false, change_unavailable_reason: 'No previous-day rating snapshot is stored.', races: [], calculated_points_change: null, reconciled: null };
  client.auth.get = async () => ({ explanation });
  const result = await call('drp', 'ratings', 'explain', '--json');
  assert.equal(result.code, 0, result.error);
  assert.deepEqual(result.data.explanation, explanation);
  const displayed = await call('drp', 'ratings', 'explain');
  assert.equal(displayed.code, 0, displayed.error);
  assert.match(displayed.output, /No previous-day rating snapshot is stored\./);
});

test('tournament discovery and date-based series filters retain public registrations and schedules', async () => {
  const original = globalThis.fetch;
  const { call } = setup();
  const requests = [];
  const tournament = { public_key: 'tournament-one', name: 'Fixture tournament', state: 'active', start_at: '2026-10-02T09:00:00Z', registration_status: 'open',
    links: { web: 'https://example.test/tournaments/tournament-one' }, participants: [{ active: true, seed: 1, sailor: { name: 'Fixture sailor', profile_uuid: 'public-profile', country_code: 'AU', multiplayer_rating: 1010, rating_boat_model: 'yacht' } }],
    matches: [{ round: 1, match_number: 2, state: 'scheduled', scheduled_start_at: '2026-10-02T10:00:00Z', participants: [{ sailor: { name: 'Fixture sailor' }, showed_up: null }] }] };
  try {
    globalThis.fetch = async url => {
      requests.push(String(url));
      const path = new URL(url).pathname;
      return new Response(JSON.stringify(path.endsWith('/series') ? { series: [{ public_key: 'series-one', name: 'Past weekly series', type: 'weekly', status: 'past', start_date: '2026-09-01', end_date: '2026-09-07' }], pagination: { current_page: 1 } }
        : path.endsWith('/tournaments') ? { tournaments: [tournament], pagination: { current_page: 1 } } : { tournament }));
    };
    const series = await call('drp', 'series', 'list', '--league', 'league-one', '--type', 'weekly', '--status', 'past', '--json');
    assert.equal(series.data.series[0].status, 'past');
    assert.equal(new URL(requests.at(-1)).searchParams.get('type'), 'weekly');
    assert.equal((await call('tournaments', 'list', '--json')).data.tournaments[0].registration_status, 'open');
    const detail = await call('tournaments', 'show', 'tournament-one', '--json');
    assert.equal(detail.data.tournament.matches[0].scheduled_start_at, '2026-10-02T10:00:00Z');
    assert.equal(detail.data.tournament.participants[0].sailor.multiplayer_rating, 1010);
    assert.equal(detail.data.tournament.participants[0].sailor.rating_boat_model, 'yacht');
    assert.equal((await call('tournaments', 'open', 'tournament-one', '--no-browser', '--json')).data.url, tournament.links.web);
  } finally { globalThis.fetch = original; }
});

test('reviewed race and series projections keep qualifications, contributions and public course controls', async () => {
  const { client } = setup();
  client.auth.credentials.read = async () => ({ scopes: ['sailing_cv'] });
  const series = { public_key: 'series-one', name: 'Fixture series', unqualified_entries: [{ name: 'Fixture sailor', races_completed: 2, races_needed: 3 }], unqualified_count: 1, total_sailors: 4,
    race_contributions: [{ public_key: 'entry-one', race_public_key: 'race-one', points: 12, max_points: 20 }], revealed_races_only: true, threshold_basis: 'revealed races', calculated_through: '2026-09-30T20:00:00Z',
    my_position: null, my_points: null, my_races_completed: 2, my_qualified: false, my_races_needed: 3 };
  client.auth.get = async path => path.includes('/series/') ? { series } : path.includes('/leagues/') ? { league: { public_key: 'league-one', name: 'Fixture league', latest_race: race,
    navigation: { races: '/api/v3/racing/drp/races?league=league-one', series: '/api/v3/racing/drp/series?league=league-one' } } }
    : { race: { ...race, wind_speed_kn: 10, my_result: entry, published_at: '2026-09-30T20:00:00Z', entries: [{ ...entry, next_feature: { id: 'feature-one', kind: 'gate', name: 'Finish', sequence: 2 }, boat: { uuid: 'boat-one', is_anchored: true } }] } };
  const detail = await client.racing.race('drp', 'race-one');
  assert.equal(detail.race.my_result.public_key, 'entry-one');
  assert.equal(detail.race.wind_speed_kn, 10);
  assert.equal(detail.race.entries[0].next_feature.id, 'feature-one');
  assert.equal(detail.race.entries[0].boat.is_anchored, true);
  assert.equal(detail.race.my_result.id, undefined);
  assert.deepEqual((await client.racing.showSeries('series-one')).series, series);
  assert.equal((await client.racing.league('league-one')).league.navigation.series, '/api/v3/racing/drp/series?league=league-one');
  const local = new MarineVerseClient({ ...environment, webUrl: 'http://localhost:3005' });
  assert.equal(local.racing.link({ links: { web: 'http://localhost:3005/marineverse-cup/race/race-one' } }), 'http://localhost:3005/marineverse-cup/race/race-one');
  assert.equal(local.racing.link({ links: { web: 'https://www.marineverse.com/marineverse-cup/race/race-one' } }), 'https://www.marineverse.com/marineverse-cup/race/race-one');
  for (const url of ['https://evil.marineverse.com/', 'https://www.marineverse.com.evil.test/', 'https://user:password@www.marineverse.com/', 'http://www.marineverse.com/']) assert.throws(() => local.racing.link({ links: { web: url } }), error => error.code === 'INVALID_RESPONSE');
});

test('daily briefs use one authenticated read, preserve calendar dates and label unavailable optional opportunities', async () => {
  const { client, call } = setup();
  const calls = [];
  client.auth.get = async (path, scope) => {
    calls.push({ path, scope });
    const day = new URL(path, environment.apiUrl).searchParams.get('day');
    return { day: { day, date: day === 'today' ? '2026-10-01' : '2026-09-30', time_zone: 'Australia/Melbourne',
      activity: { drp: { entries: [{ ...entry, race_name: 'Fixture race' }], total_entries: 101, truncated: true }, multiplayer: { entries: [], total_entries: 0, truncated: false } },
      ...(day === 'today' ? { opportunities: { drp: [{ league_name: 'Fixture league', race: { public_key: 'race-one', can_race: true, attempts_used: 1, attempts_limit: 2, availability_reasons: [] } }],
        multiplayer: { sessions: [], available: false, error: 'Community schedule unavailable' }, globe: [] } } : {}),
      globe_participation: [{ public_key: 'globe-one', name: 'Fixture Globe race', participation_basis: 'current_owned_or_crewed_boat', links: { web: 'https://example.test/globe/races/globe-one' } }] } };
  };
  const today = await call('today', '--json');
  assert.equal(today.code, 0, today.error);
  assert.equal(today.data.day.activity.drp.entries[0].race_time_seconds, 81.25);
  assert.equal(today.data.day.opportunities.drp[0].race.can_race, true);
  assert.equal(today.data.day.activity.drp.total_entries, 101);
  assert.equal(today.data.day.activity.drp.truncated, true);
  assert.deepEqual(calls, [{ path: '/api/v3/racing/day?day=today', scope: 'sailing_cv' }]);
  const human = (await call('today')).output;
  assert.match(human, /Community schedule unavailable[\s\S]*current owned or crewed boats/);
  assert.match(human, /racing drp entries list --mine --page 1 --json/);
  const yesterday = await call('yesterday', '--json');
  assert.equal(yesterday.data.day.date, '2026-09-30');
  assert.equal(yesterday.data.day.opportunities, undefined);
  assert.equal(yesterday.data.day.globe_participation[0].participation_basis, 'current_owned_or_crewed_boat');
});

test('focused leaderboards retain own result and race stats preserve reveal state and pagination', async () => {
  const { client, call } = setup();
  client.auth.credentials.read = async () => ({ scopes: ['sailing_cv'] });
  client.auth.get = async () => ({ race: { ...race, entries: [], my_result: entry, results_available: false,
    entries_pagination: { current_page: 2, total_pages: 3, total_entries: 60 } } });
  const leaderboard = await call('drp', 'races', 'leaderboard', 'race-one', '--page', '2', '--json');
  assert.equal(leaderboard.data.race.my_result.public_key, 'entry-one');
  assert.match((await call('drp', 'races', 'leaderboard', 'race-one')).output, /Your latest result[\s\S]*81.25/);
  const stats = await call('drp', 'races', 'stats', 'race-one', '--page', '2', '--json');
  assert.equal(stats.data.race.results_available, false);
  assert.deepEqual(stats.data.race.entries_pagination, { current_page: 2, total_pages: 3, total_entries: 60 });
  assert.deepEqual(stats.data.race.entry_stats, []);
  assert.match((await call('drp', 'races', 'stats', 'race-one', '--page', '2')).output, /results_available: false[\s\S]*Page 2 of 3/);
});

test('racing rendering keeps league rankings primary, supports ordered columns and preserves legacy Globe output', async () => {
  const { client, call } = setup();
  const original = globalThis.fetch;
  const league = { public_key: 'league-one', name: 'Fixture league' };
  const rankings = { league, rankings: [{ name: 'Fixture sailor', position: 1, points: 1520, points_change: 20 }], pagination: { current_page: 1, total_pages: 2, total_entries: 30 } };
  let reads = 0;
  try {
    globalThis.fetch = async () => { reads++; return new Response(JSON.stringify(rankings)); };
    const table = await call('drp', 'ratings', 'list', '--league', 'league-one', '--columns', 'points,name');
    assert.equal(table.code, 0, table.error);
    assert.match(table.output, /^POINTS\s+SAILOR[\s\S]*1520[\s\S]*Fixture sailor[\s\S]*Page 1 of 2/);
    const json = await call('drp', 'ratings', 'list', '--columns', 'name', '--json');
    assert.equal(json.data.rankings[0].points_change, 20);
    const before = reads;
    assert.equal((await call('drp', 'ratings', 'list', '--columns', 'password')).code, 2);
    assert.equal((await call('drp', 'entries', 'show', 'entry-one', '--columns', 'time')).code, 2);
    assert.equal(reads, before);
    const legacy = { publicKey: 'old-race', name: 'Legacy race', entries: [{ position: 3, boat: { uuid: 'boat-one', name: 'Legacy boat' }, raceTimeSeconds: 99, penaltySeconds: 5 }] };
    assert.equal(racingHuman({ race: legacy }), undefined);
    assert.match(human(legacy, ['name', 'position']), /BOAT\s+POS[\s\S]*Legacy boat\s+3/);
    assert.equal(racingHuman({ rating: 1200 }), undefined);
    client.auth.credentials.read = async () => ({ scopes: ['sailing_cv'] });
    client.auth.get = async () => ({ race: { ...race, my_result: entry } });
    assert.match((await call('drp', 'races', 'show', 'race-one', '--columns', 'time,name')).output, /TIME \(s\)\s+SAILOR[\s\S]*81.25/);
  } finally { globalThis.fetch = original; }
});

test('leg seconds use numeric endpoints, nullable names remain valid and per-race attempts are paged', async () => {
  const { client, call } = setup();
  const calls = [];
  client.auth.credentials.read = async () => ({ scopes: ['sailing_cv'] });
  client.auth.get = async (path, scope) => {
    calls.push({ path, scope });
    if (path.includes('/races/')) return { race: { ...race, name: null } };
    if (path.includes('/series/')) return { series: { public_key: 'series-one', name: 'Fixture series', entries: [{ position: 1, name: 'Fixture sailor', points: 90 }], races: [] } };
    const data = { ...entry, legs: [{ name: 'Known seconds', start_time: 2, end_time: 32.75, duration: 999 }, { name: 'Raw duration', duration: 77 },
      { name: 'Explicit seconds', duration_seconds: 12.5, duration: 88 }, { name: 'Zero raw duration', duration: 0 }, { name: 'Missing duration' }] };
    return path.includes('/entries?') ? { entries: [data], pagination: { current_page: 2, total_pages: 3, total_entries: 70 } } : { entry: data };
  };
  const legs = await call('drp', 'entries', 'legs', 'entry-one', '--columns', 'duration,name');
  assert.match(legs.output, /DURATION\s+LEG[\s\S]*30.75 s\s+Known seconds[\s\S]*77 \(recorded; units unspecified\)\s+Raw duration/);
  assert.match(legs.output, /12.5 s\s+Explicit seconds[\s\S]*0 \(recorded; units unspecified\)\s+Zero raw duration[\s\S]*—\s+Missing duration/);
  assert.ok(!legs.output.includes('DURATION (s)'));
  assert.match((await call('drp', 'entries', 'show', 'entry-one')).output, /77 \(recorded; units unspecified\)/);
  const json = await call('drp', 'entries', 'legs', 'entry-one', '--json');
  assert.equal(json.data.entry.legs[0].duration, 999);
  assert.equal(json.data.entry.legs[1].duration, 77);
  assert.equal((await call('drp', 'entries', 'legs', 'entry-one', '--columns', 'points')).code, 2);
  assert.equal((await call('drp', 'races', 'show', 'race-one', '--json')).data.race.name, null);
  assert.match((await call('drp', 'races', 'show', 'race-one')).output, /^race-one\n/);
  const attempts = await call('multiplayer', 'entries', 'list', '--mine', '--race', 'race-one', '--page', '2', '--json');
  assert.equal(attempts.data.pagination.current_page, 2);
  assert.deepEqual(calls.at(-1), { path: '/api/v3/racing/multiplayer/entries?mine=true&page=2&race=race-one', scope: 'sailing_cv' });
  assert.match((await call('drp', 'series', 'leaderboard', 'series-one', '--columns', 'points,name')).output, /POINTS\s+SAILOR[\s\S]*90\s+Fixture sailor/);
});

test('activity validation names the supplied flag and participation accepts server day boundaries', async () => {
  const { call } = setup();
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async url => { requests.push(String(url)); return new Response(JSON.stringify({ rankings: [], pagination: { current_page: 1 } })); };
    for (const flag of ['--since', '--until']) {
      const result = await call('activity', flag, '2026-02-30');
      assert.equal(result.code, 2);
      assert.ok(result.error.includes(flag), result.error);
      assert.ok(!result.error.includes('--date'), result.error);
    }
    assert.equal(requests.length, 0);
    for (const days of ['0', '3650']) {
      assert.equal((await call('multiplayer', 'ratings', 'list', '--type', 'participation', '--days', days)).code, 0);
      assert.equal(new URL(requests.at(-1)).searchParams.get('days'), days);
    }
    const before = requests.length;
    for (const days of ['-1', '3651']) assert.equal((await call('multiplayer', 'ratings', 'list', '--type', 'participation', '--days', days)).code, 2);
    assert.equal(requests.length, before);
  } finally { globalThis.fetch = original; }
});
