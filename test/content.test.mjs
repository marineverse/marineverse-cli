import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { run } from '../dist/cli.js';
import { MarineVerseClient } from '../dist/client.js';
import { ContentClient } from '../dist/content.js';

const source = 'https://www.marineverse.com/marineverse-cup/faq';
const faq = { slug: 'marineverse-sailing-club', title: 'Sailing Club FAQ', locale: 'en-US', url: source, source,
  content: { sections: [{ section: 'Getting started', items: [{ question: 'Can I learn?', answer: ['Yes, see ',
    { type: 'link', props: { href: '/learn-how-to-sail' }, children: [{ type: 'span', children: ['our guide'] }] },
    { type: 'br' }, { type: 'p', children: ['Learn and relax.'] }] }] }] } };
const history = { slug: 'marineverse-sailing-club', title: 'Sailing Club history', source: 'https://www.marineverse.com/marineverse-sailing-club/history',
  content: { entries: [{ version: '1.2.3', date: '2026-09-29', items: ['Improved sailing lessons.'] }],
    labels: { updates: 'Major updates:', boat: 'New sailing boat', date: 'September 2026' },
    sections: [{ titleKey: 'updates', cards: [{ titleKey: 'boat', dateKey: 'date', href: 'https://blog.marineverse.com/new-boat' }] }], patches: [] } };

test('guest FAQ, history and keyword search preserve content and citations without accessing authentication', async t => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization, method: req.method });
    const url = new URL(req.url, 'http://localhost');
    let result;
    if (url.pathname.endsWith('/faqs')) result = { topics: [{ slug: faq.slug, title: faq.title, url: source, locales: ['en-US'] }] };
    else if (url.pathname.endsWith('/faqs/missing')) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown FAQ topic.' })); return; }
    else if (url.pathname.includes('/faqs/')) result = faq;
    else if (url.pathname.includes('/history/')) result = history;
    else result = { query: url.searchParams.get('q'), locale: 'en-US', results: [{ type: 'faq', slug: faq.slug, title: faq.title, url: source, source, snippet: 'Learn and relax.' }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const environment = { name: 'fixture', apiUrl: `http://127.0.0.1:${server.address().port}`, webUrl: 'https://www.marineverse.com' };
  const client = new MarineVerseClient(environment);
  client.auth.get = client.auth.post = client.auth.accessToken = assert.fail;
  const call = async (...args) => {
    let output = '', error = '';
    const code = await run(['node', 'marineverse', ...args], {
      client: () => client, stdout: text => output += text, stderr: text => error += text,
    });
    return { code, output, error };
  };
  assert.match((await call('faq')).output, /TOPIC.*TITLE.*URL/);
  assert.equal((await call('faq', '--locale', 'de')).code, 0);
  assert.equal(new URL(requests.at(-1).url, environment.apiUrl).searchParams.get('locale'), 'de');
  const detailed = await call('faq', faq.slug, '--json');
  assert.deepEqual(JSON.parse(detailed.output).data.faq, faq);
  const readable = await call('faq', faq.slug, '--locale', 'fr');
  assert.match(readable.output, /our guide \(https:\/\/www.marineverse.com\/learn-how-to-sail\)/);
  assert.match(readable.output, /Source: https:/);
  assert.match(readable.output, /Learn and relax\./);
  const timeline = await call('history', '--limit', '3');
  assert.match(timeline.output, /1\.2\.3 · 2026-09-29\n- Improved sailing lessons/);
  assert.match(timeline.output, /Major updates:\nNew sailing boat · September 2026\nhttps:\/\/blog.marineverse.com\/new-boat/);
  assert.match(requests.at(-1).url, /limit=3/);
  for (const [alias, mode, args, expected] of [
    ['changelog', 'latest', [], { latest: 'true' }],
    ['release-notes', 'version', ['2.9.7'], { version: '2.9.7' }],
    ['history', 'list', ['--from-version', '2.4.0', '--to-version', '2.9.7'], { from_version: '2.4.0', to_version: '2.9.7', limit: '10' }],
    ['changelog', 'list', ['--from-date', '2025-01-01', '--to-date', '2025-12-31'], { from_date: '2025-01-01', to_date: '2025-12-31', limit: '10' }],
    ['changelog', 'list', ['--all'], { all: 'true' }],
  ]) {
    const result = await call('sailing-club', alias, mode, ...args);
    assert.equal(result.code, 0, result.error);
    assert.match(result.output, /1\.2\.3/);
    assert.doesNotMatch(result.output, /New sailing boat/);
    const parameters = new URL(requests.at(-1).url, environment.apiUrl).searchParams;
    for (const [key, value] of Object.entries(expected)) assert.equal(parameters.get(key), value);
    if (expected.all) assert.equal(parameters.has('limit'), false);
  }
  const search = await call('content', 'search', ' learn & relax ', '--locale', 'en-US', '--limit', '2', '--json');
  assert.equal(JSON.parse(search.output).data.search.query, 'learn & relax');
  const query = new URL(requests.at(-1).url, environment.apiUrl).searchParams;
  assert.equal(query.get('q'), 'learn & relax');
  assert.equal(query.get('locale'), 'en-US');
  assert.equal(query.get('limit'), '2');
  const missing = await call('faq', 'missing', '--json');
  assert.equal(missing.code, 5);
  assert.equal(JSON.parse(missing.output).error.code, 'NOT_FOUND');
  const count = requests.length;
  for (const args of [['faq', '../private'], ['faq', faq.slug, '--locale', '../en'], ['history', '--limit', '21'],
    ['content', 'search', ' '], ['content', 'search', 'x'.repeat(201)], ['content', 'search', 'sailing', '--limit', '1.5']]) {
    assert.equal((await call(...args)).code, 2);
  }
  for (const args of [
    ['version', '2.9'], ['list', '--from-version', '2.10.0', '--to-version', '2.9.0'],
    ['list', '--from-date', '2025-02-30'], ['list', '--from-date', '2025-12-31', '--to-date', '2025-01-01'],
    ['list', '--all', '--limit', '2'], ['list', '--all', '--from-version', '2.4.0'],
  ]) assert.equal((await call('sailing-club', 'changelog', ...args)).code, 2);
  assert.equal(requests.length, count);
  assert.ok(requests.every(req => req.method === 'GET' && req.authorization === undefined));
});

test('public content rejects malformed API response shapes', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  try {
    const client = new ContentClient('https://example.test');
    for (const action of [() => client.topics(), () => client.faq('marineverse'), () => client.history(), () => client.search('sailing')]) {
      await assert.rejects(action, error => error.code === 'INVALID_RESPONSE');
    }
  } finally { globalThis.fetch = original; }
});
