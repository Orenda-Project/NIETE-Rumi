'use strict';
/**
 * The hub pages of web-quiz-shelf-one-hop.service.test.js's switch-off golden. Each case is one hub open:
 *   off_<lang>_<case>   web_quiz_fast off: today's one-shot page (renderHubPage, the asset version pinned);
 *   fast_<lang>_<case>  web_quiz_fast on, web_quiz_one_hop off: the streamed page as it reaches the phone: the head
 *                       sent before the bot answered (`early`) and the whole page (`body`), through the edge's own route.
 * Their bytes are pinned in one-hop-off-golden.json, captured from the code before the one-hop change. The edge's asset
 * version (?v=, a hash of the page files) is written as __V__ in the streamed pages, since any page file's change moves it.
 * Invented children only.
 */
const http = require('http');
const express = require('express');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const ORIGIN = 'http://portal.example';
const ASSET_V = 'abcdef0123';
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: KID, first: '<Name> Testwala', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, home_v3: 1, stories: { on: 1 },
  doors: { stories: [{ kind: 'shelf' }], games: [], videos: { watch: true } }, ...extra,
});
const CASES = {
  default: {},
  home_v3_0: { home_v3: 0 },
  locked: { locked: true, kid: null, kids: [] },
};
const normV = (s) => String(s).replace(/([?&]v=)[0-9a-f]{10}\b/g, '$1__V__');

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function get(srv, p, onFirstChunk) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example' } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks.join(''), first: chunks[0] }));
    });
    r.on('error', reject);
    r.end();
  });
}

/**
 * One streamed hub open: `answers` are the bot's hub answers for the opens before it (they teach the edge `fast`),
 * then `payload` for the open that is measured (held until the head has reached the phone).
 */
async function streamedOpen(R, answers, payload) {
  const queue = answers.map((b) => ({ res: jsonRes(200, b) })).concat([{ hold: true, res: jsonRes(200, payload) }]);
  const held = [];
  const fetchImpl = () => {
    const a = queue.shift();
    if (a && a.hold) return new Promise((r) => held.push(() => r(a.res)));
    return Promise.resolve(a.res);
  };
  const release = () => held.splice(0).forEach((f) => f());
  const app = express();
  app.set('trust proxy', 1);
  app.use(R.createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'test-internal-key', fetchImpl }));
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    for (let i = 0; i < answers.length; i += 1) await get(srv, `/h/${TOKEN}`);
    let early = null;
    const fallback = setTimeout(release, 400);
    const res = await get(srv, `/h/${TOKEN}`, (c) => { early = c; release(); });
    clearTimeout(fallback);
    return { early, body: res.body };
  } finally { await new Promise((r) => srv.close(r)); }
}

/** name → html (off_*) or { early, body } (fast_*), for the given payload fields on top of each case. */
async function cases(R, extra = {}) {
  const out = {};
  for (const lang of ['en', 'ur']) {
    for (const [name, c] of Object.entries(CASES)) {
      out[`off_${lang}_${name}`] = R.renderHubPage({ payload: HUB({ lang, ...c, ...extra }), token: TOKEN, origin: ORIGIN, assetV: ASSET_V });
      const fast = HUB({ lang, ...c, fast: true, ...extra });
      const s = await streamedOpen(R, [fast, fast], fast);
      out[`fast_${lang}_${name}`] = { early: normV(s.early), body: normV(s.body) };
    }
  }
  return out;
}

module.exports = { TOKEN, KID, ORIGIN, ASSET_V, HUB, CASES, normV, streamedOpen, cases };
