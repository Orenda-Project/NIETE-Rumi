/**
 * The busy page's harness (web-quiz-busy-page.service.test.js and the golden it compares with): one fresh portal per
 * case, the bot a fake fetch that answers each call from a script (a JSON answer, a throw, or no answer until the
 * edge's timeout). A case may first open a hub link that answers 200, so the portal learns the bot's switches the way
 * it does in life (`learn`: the extra fields that hub answer carries; null: no learn at all).
 * No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const HUB_TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const CARD = 'Kk1_card-token-for-the-busy-page-rows-0123456789';
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const QUIZ = (extra = {}) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A', why: 'Roots drink.' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 3, ict_today_floor: 40 },
  video: null,
  preview: false,
  brand: 'niete',
  ...extra,
});

// The child pages that call the bot, each with the language its page would pick.
const SITES = {
  q: { path: '/q/AB12CD' },
  qclass: { path: '/q/AB12CD/class?a=1' },
  h: { path: `/h/${HUB_TOKEN}?kid=0123456789abcdef` },
  hur: { path: `/h/${HUB_TOKEN}`, headers: { 'accept-language': 'ur-PK,ur;q=0.9' } },
  k: { path: `/k/${CARD}` },
  c: { path: `/c/${HUB_TOKEN}` },
  cur: { path: `/c/${HUB_TOKEN}?lang=ur` },
};

// What the bot does on the site's own call.
const FAILS = {
  throw: { throw: true },
  timeout: { hang: true },
  500: { status: 500, body: { error: 'server_error' } },
  '500ur': { status: 500, body: { error: 'server_error', lang: 'ur' } },
  502: { status: 502 },
  504: { status: 504 },
  503: { status: 503, body: { error: 'off' } },
  401: { status: 401, body: { error: 'expired' } },
  404: { status: 404 },
  '404c': { status: 404, body: { error: 'not_found' } },
};

function jsonRes(status, body) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function answer(step, opts) {
  if (step.throw) return Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { cause: { code: 'ECONNREFUSED' } }));
  if (step.hang) {
    return new Promise((_, rej) => {
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  }
  return Promise.resolve(jsonRes(step.status, step.body));
}

function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path, headers: { host: 'portal.example', ...headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// The response as compared: status, every header but the clock and the socket's, the body.
const SKIP = new Set(['date', 'connection', 'keep-alive']);
function shape(r) {
  const headers = {};
  Object.keys(r.headers).sort().forEach((k) => { if (!SKIP.has(k)) headers[k] = r.headers[k]; });
  return { status: r.status, headers, body: r.body };
}

/**
 * steps: the bot's answers in call order (the last repeats). Returns the shapes of every page opened in `paths`.
 * `calls` (optional array) collects the bot paths called.
 */
async function serve(steps, paths, calls = []) {
  const q = steps.slice();
  const app = express();
  app.use(createWebQuizRouter({
    botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, botTimeoutMs: 40, canonicalBase: '',
    fetchImpl: (url, opts) => { calls.push(String(url)); return answer(q.length > 1 ? q.shift() : q[0], opts); },
  }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const out = [];
    for (const p of paths) out.push(shape(await get(srv, p.path, p.headers)));
    return out;
  } finally { await new Promise((r) => srv.close(r)); }
}

/** One case: optionally a hub 200 first (learn: its extra fields; null: none), then the site with the bot failing. */
async function runCase(site, fail, learn = null) {
  const s = SITES[site];
  const steps = [];
  const paths = [];
  if (learn) { steps.push({ status: 200, body: HUB(learn) }); paths.push({ path: `/h/${HUB_TOKEN}` }); }
  steps.push(FAILS[fail]);
  paths.push(s);
  const out = await serve(steps, paths);
  return out[out.length - 1];
}

module.exports = { HUB_TOKEN, CARD, HUB, QUIZ, SITES, FAILS, serve, runCase, shape };
