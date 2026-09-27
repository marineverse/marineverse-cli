import { createServer } from 'node:http';
import { callbackPage } from '../dist/callback-page.js';

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const state = path === '/denied' ? 'denied' : path === '/invalid' ? 'invalid' : 'received';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(callbackPage(state));
});
server.listen(0, '127.0.0.1', () => console.log(`Login-page preview: http://127.0.0.1:${server.address().port}`));
