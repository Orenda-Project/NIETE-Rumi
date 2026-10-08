#!/usr/bin/env node
// local-db-proxy.js — gives the local PostgREST the URL shape supabase-js expects (bd-z3ze4).
//
// supabase-js calls `${SUPABASE_URL}/rest/v1/<table>`; PostgREST serves `/<table>` at its root. This strips
// the prefix and forwards, nothing more. Any other Supabase service path (/auth/v1, /storage/v1, …) is a
// loud 501: the bot does not use them, and a silent 404 would hide it if that ever changed.
//
//   node local-db-proxy.js <listen_port> <postgrest_port>
const fs = require('fs');
const http = require('http');

const [listenPort, restPort] = process.argv.slice(2).map(Number);
if (!listenPort || !restPort) {
  console.error('usage: local-db-proxy.js <listen_port> <postgrest_port>');
  process.exit(2);
}
const PREFIX = '/rest/v1';
// One line per request, `<METHOD> <table|rpc/fn>` — what a run actually touched (the seed list is drafted
// from it). Set by local-db.sh to <run_dir>/requests.log.
const REQUEST_LOG = process.env.LOCAL_DB_REQUEST_LOG;
// The FULL request (`<METHOD> <table>?<query>`, decoded): replaying the reads against the full seed tells which
// reference ROWS a run actually used (bd-z3ze4.6). Set by local-db.sh to <run_dir>/queries.log.
const QUERY_LOG = process.env.LOCAL_DB_QUERY_LOG;
const record = (method, rest) => {
  if (!REQUEST_LOG && !QUERY_LOG) return;
  const target = decodeURIComponent(rest.split('?')[0].replace(/^\/+/, '')) || '/';
  if (REQUEST_LOG) try { fs.appendFileSync(REQUEST_LOG, `${method} ${target}\n`); } catch (_) { /* never fail a request over the log */ }
  if (QUERY_LOG) {
    let full = rest.replace(/^\/+/, '');
    try { full = decodeURIComponent(full); } catch (_) { /* keep it encoded */ }
    try { fs.appendFileSync(QUERY_LOG, `${method} ${full}\n`); } catch (_) { /* never fail a request over the log */ }
  }
};

http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  if (!req.url.startsWith(PREFIX)) {
    res.writeHead(501, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ message: `local-db: ${req.url.split('?')[0]} is not served (only ${PREFIX})` }));
  }
  record(req.method, req.url.slice(PREFIX.length));
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
