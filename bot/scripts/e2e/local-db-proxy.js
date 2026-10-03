#!/usr/bin/env node
// local-db-proxy.js — gives the local PostgREST the URL shape supabase-js expects (bd-z3ze4).
//
// supabase-js calls `${SUPABASE_URL}/rest/v1/<table>`; PostgREST serves `/<table>` at its root. This strips
// the prefix and forwards, nothing more. Any other Supabase service path (/auth/v1, /storage/v1, …) is a
// loud 501: the bot does not use them, and a silent 404 would hide it if that ever changed.
//
//   node local-db-proxy.js <listen_port> <postgrest_port>
const http = require('http');

const [listenPort, restPort] = process.argv.slice(2).map(Number);
if (!listenPort || !restPort) {
  console.error('usage: local-db-proxy.js <listen_port> <postgrest_port>');
  process.exit(2);
}
const PREFIX = '/rest/v1';

http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  if (!req.url.startsWith(PREFIX)) {
    res.writeHead(501, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ message: `local-db: ${req.url.split('?')[0]} is not served (only ${PREFIX})` }));
  }
  const upstream = http.request({
    host: '127.0.0.1', port: restPort, method: req.method,
    path: req.url.slice(PREFIX.length) || '/',
    headers: { ...req.headers, host: `127.0.0.1:${restPort}` },
  }, (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
  upstream.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `local-db: PostgREST unreachable (${e.code})` }));
  });
  req.pipe(upstream);
}).listen(listenPort, '127.0.0.1');
