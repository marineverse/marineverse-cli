import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { run } from '../dist/cli.js';
import { MarineVerseClient } from '../dist/client.js';
import { ContentClient } from '../dist/content.js';

test('public glossary commands preserve definitions and sources without authentication', async t => {
  const requests = [];
  const source = 'https://www.marineverse.com/sailing-terms';
  const term = { term: 'apparent wind', definition: 'Published glossary definition.', source };
  const server = createServer((req, res) => {
    requests.push(req);
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('term') === 'unknown') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Sailing term not found.' })); return; }
    const result = url.pathname.endsWith('/lookup') ? term : { terms: [{ term: term.term, definition: term.definition }], query: url.searchParams.get('q'), page: Number(url.searchParams.get('page')), limit: Number(url.searchParams.get('limit')), total: 30, source };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new MarineVerseClient({ name: 'fixture', apiUrl: `http://127.0.0.1:${server.address().port}`, webUrl: 'https://www.marineverse.com' });
  client.auth.get = client.auth.post = client.auth.accessToken = assert.fail;
  const call = async (...args) => {
    let output = '', error = '';
    const code = await run(['node', 'marineverse', 'terms', ...args], { client: () => client, stdout: text => output += text, stderr: text => error += text });
    return { code, output, error };
  };
  for (const args of [[], ['--help'], ['show', '--help'], ['search', '--help'], ['list', '--help']]) assert.equal((await call(...args)).code, 0);
  assert.equal(requests.length, 0);
  assert.deepEqual(JSON.parse((await call('show', ' APPARENT WIND ', '--json')).output).data.term, term);
  assert.match(requests.at(-1).url, /term=APPARENT\+WIND/);
  const human = await call('list', '--page', '2', '--limit', '3');
  assert.match(human.output, /apparent wind\nPublished glossary definition\./);
  assert.match(human.output, /Page 2 · 30 results\nSource: https:/);
  const searched = await call('search', ' wind & tide ', '--json');
  assert.equal(JSON.parse(searched.output).data.glossary.query, 'wind & tide');
  assert.match(requests.at(-1).url, /q=wind\+%26\+tide/);
  assert.equal((await call('show', 'unknown')).code, 5);
  const count = requests.length;
  for (const args of [['show', ' '], ['show', 'x'.repeat(201)], ['search', ' '], ['search', 'x'.repeat(201)], ['list', '--limit', '21'], ['list', '--page', '0'], ['list', '--page', '1.5'], ['list', '--page', '10001']]) assert.equal((await call(...args)).code, 2);
  assert.equal(requests.length, count);
  assert.ok(requests.every(req => req.method === 'GET' && req.headers.authorization === undefined));
});

test('glossary rejects malformed response definitions', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ terms: [{}] }), { headers: { 'Content-Type': 'application/json' } });
  try {
    const client = new ContentClient('https://example.test');
    await assert.rejects(() => client.terms(), error => error.code === 'INVALID_RESPONSE');
    await assert.rejects(() => client.term('anchor'), error => error.code === 'INVALID_RESPONSE');
  } finally { globalThis.fetch = original; }
});
