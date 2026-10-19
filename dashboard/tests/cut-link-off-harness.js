'use strict';
/**
 * The edge block as the portal mounts it (routes/edge-mounts.js, in its order) in front of the portal's own SPA
 * catch-all (index.js: Cache-Control from lib/portal-static-cache, then sendFile of the built index.html), so a request
 * that falls through gets the portal's shell exactly as it does today. The shell is a stand-in file with a fixed mtime,
 * so its bytes and every header (ETag and Last-Modified included) are the same on every run.
 *
 * Used by cut-link-page.service.test.js and to record its OFF golden (fixtures/cut-link-page-off.golden.json) on the
 * product files before the switch existed: it needs nothing the switch added.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { PORTAL_INDEX_CACHE_CONTROL } = require('../lib/portal-static-cache');

const SHELL = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Portal</title>\n<script type="module" crossorigin src="/assets/index-AbCdEf12.js"></script>\n</head>\n<body>\n<div id="root"></div>\n</body>\n</html>\n';
const SHELL_MTIME = new Date('2026-01-01T00:00:00Z');

let shellDir = null;
function shellPath() {
  if (!shellDir) {
    shellDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-link-shell-'));
    fs.writeFileSync(path.join(shellDir, 'index.html'), SHELL);
  }
  const file = path.join(shellDir, 'index.html');
  fs.utimesSync(file, SHELL_MTIME, SHELL_MTIME);
  return file;
}

// the bot's WhatsApp number, built at run time (no phone-shaped literal in the source)
const WA_BOT = ['92', '300', '000', '0000'].join('');
const BOT = 'http://bot.test';
const KEY = 'edge-internal-key';
const SIG = 'A'.repeat(22);
const GO_TOK = `eyJrIjoiZ28iLCJuIjoxfQ.${SIG}`;
// a real-shaped token cut before its "." (a wrapped or half-copied link)
const CUT = GO_TOK.slice(0, 15);
/** Every junk probe the switch covers, plus the two pages it leaves with their owners. */
const OFF_PROBES = Object.freeze([
  '/quiz/go/abc', `/quiz/go/${CUT}`, `/quiz/go/${GO_TOK}.`, '/quiz/join/abc', `/quiz/join/${CUT}`,
  '/quiz/teacher/abc', '/quiz/teacher/abc/stories', '/quiz/teacher/abc/send', '/m/abc', '/f/abc',
]);
// headers that differ per connection or per second
const VOLATILE = new Set(['date', 'connection', 'keep-alive']);

/** Boot the edge block + the portal's catch-all. extra: options handed to every router (e.g. cutLinkOn). */
function boot(extra = {}) {
  const calls = [];
  const logged = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const json = url.includes('/api/internal/wq/join/page/');
    const body = json ? JSON.stringify({ ok: true, lang: 'en', bot: WA_BOT }) : '<!doctype html><main data-screen="bot"></main>';
    const type = json ? 'application/json' : 'text/html; charset=utf-8';
    return {
      status: 200, ok: true,
      headers: { get: (h) => ({ 'content-type': type }[h.toLowerCase()] || null) },
      text: async () => body, json: async () => JSON.parse(body),
      arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
    };
  };
  const logEvent = (e, p) => logged.push(JSON.stringify([e, p]));
  const app = express();
  for (const [, file, make] of require('../routes/edge-mounts')) {
    app.use(require(`../routes/${file}`)[make]({ botUrl: BOT, apiKey: KEY, fetchImpl, logEvent, ...extra }));
  }
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', PORTAL_INDEX_CACHE_CONTROL);
    res.sendFile(shellPath());
  });
  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve({ srv, calls, logged, close: () => new Promise((r) => srv.close(r)) }));
  });
}

function get(srv, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** What a golden row holds: the status, the body's sha256 and length, and every header but the volatile ones. */
function row(r) {
  const headers = Object.fromEntries(Object.keys(r.headers).filter((h) => !VOLATILE.has(h)).sort().map((h) => [h, r.headers[h]]));
  return { status: r.status, sha256: crypto.createHash('sha256').update(r.body, 'utf8').digest('hex'), bytes: Buffer.byteLength(r.body), headers };
}

/** The OFF golden: every probe, through the edge block, to the portal's shell. */
async function record(extra = {}) {
  const env = { WHATSAPP_BOT_NUMBER: WA_BOT, MAIN_BOT_URL: BOT, INTERNAL_API_KEY: KEY };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const b = await boot(extra);
  try {
    const out = {};
    for (const p of OFF_PROBES) out[p] = row(await get(b.srv, p));
    return out;
  } finally {
    await b.close();
    Object.entries(saved).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
}

module.exports = { boot, get, row, record, OFF_PROBES, WA_BOT, BOT, KEY, SIG, GO_TOK, CUT, SHELL };

// node tests/cut-link-off-harness.js → prints the OFF golden (recorded on the product files at hand)
if (require.main === module) {
  record().then((g) => process.stdout.write(`${JSON.stringify(g, null, 2)}\n`)).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
