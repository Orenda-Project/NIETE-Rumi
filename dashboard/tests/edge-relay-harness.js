/**
 * Harness for the portal relays' response headers (tests/edge-security-headers.service.test.js).
 *
 * Every relay that forwards a bot answer is driven through its REAL router and the REAL bot client (createBotClient),
 * with a fake bot (fetchImpl) that answers each route the way the bot does, carrying the bot's own security headers.
 * run(row, { security, routerOpts }) → { status, headers, sha, length }: the response as the phone gets it, with the
 * per-request values that change from run to run (Date, the rate limit's reset) normalised.
 */
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { createQuizTeacherRouter } = require('../routes/quiz-teacher.routes');
const { createFirstTouchRouter } = require('../routes/first-touch.routes');
const { createQuizGoRouter } = require('../routes/quiz-go.routes');
const { createTeacherReportRouter } = require('../routes/teacher-report.routes');
const { createTeacherStoriesRouter } = require('../routes/teacher-stories.routes');

const TOK = `eyJrIjoidGgifQ.${'A'.repeat(22)}`;
const UUID = 'a0000000-0000-4000-8000-000000000001';
const DEVICE = 'B'.repeat(22);
const SPA = '<!doctype html><title>SPA</title>';

// What the bot sets on its pages (teacher-home.routes, maker.routes, go.routes): its CSP with frame-ancestors, nosniff,
// and two the allowlist also takes. Plus headers that must never be carried.
const BOT_SECURITY = {
  'content-security-policy': "default-src 'none'; script-src 'sha256-AAAA'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin',
};
const BOT_OTHER = { 'cache-control': 'public, max-age=60', 'set-cookie': 'bot_side=1; Path=/', 'x-bot-only': '1' };

const HTML = (title) => `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`;
const html = (status, title) => ({ status, type: 'text/html; charset=utf-8', body: HTML(title) });
const json = (status, obj) => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(obj) });

// [name, router, method, path, body (json | form), the bot's answer]
const ROWS = [
  ['teacher.page', 'teacher', 'GET', `/quiz/teacher/${TOK}`, null, html(200, 'home')],
  ['teacher.page.stale', 'teacher', 'GET', `/quiz/teacher/${TOK}?lang=ur`, null, html(404, 'stale')],
  ['teacher.stories', 'teacher', 'GET', `/quiz/teacher/${TOK}/stories`, null, html(200, 'stories')],
  ['teacher.send', 'teacher', 'GET', `/quiz/teacher/${TOK}/send?c=${UUID}&o=library`, null, { status: 302, location: 'https://wa.me/?text=x' }],
  ['teacher.api.home', 'teacher', 'GET', `/api/th/home?t=${TOK}`, null, json(200, { ok: true })],
  ['teacher.api.send', 'teacher', 'POST', '/api/th/send', { json: { t: TOK, kind: 'video', id: UUID } }, json(200, { ok: true })],
  ['maker.page', 'ft', 'GET', `/m/${TOK}`, null, html(200, 'maker')],
  ['door.page', 'ft', 'GET', `/f/${TOK}`, null, html(404, 'door')],
  ['maker.api.make', 'ft', 'POST', '/api/ft/make', { json: { t: TOK, grade: '3' } }, json(200, { ok: true })],
  ['maker.api.step', 'ft', 'POST', '/api/ft/step', { json: { t: TOK, step: 'opened' } }, { status: 204 }],
  ['go.page', 'go', 'GET', `/quiz/go/${TOK}`, null, html(200, 'go')],
  ['report.page', 'report', 'GET', `/r/${TOK}`, null, html(200, 'report')],
  ['report.form', 'report', 'POST', `/r/${TOK}/class`, { form: `quiz=${UUID}&key=k1` }, html(200, 'report-form')],
  ['report.round', 'report', 'GET', `/r/${TOK}/round`, null, html(200, 'round')],
  ['stories.page', 'stories', 'GET', `/quiz/teacher/${TOK}/stories`, null, html(200, 'stories-router')],
];
// The rows whose answer is the bot's own body (not a redirect): the ones that carry the bot's headers when ON.
const REDIRECT_ROWS = new Set(['teacher.send']);

function botFetch(answer, { security }) {
  return async () => {
    const headers = new Headers({ ...BOT_OTHER, ...(security ? BOT_SECURITY : {}) });
    if (answer.type) headers.set('content-type', answer.type);
    if (answer.location) headers.set('location', answer.location);
    const body = answer.status === 204 || answer.status === 302 ? null : answer.body;
    return new Response(body, { status: answer.status, headers });
  };
}

function routerFor(kind, opts) {
  if (kind === 'teacher') return createQuizTeacherRouter(opts);
  if (kind === 'ft') return createFirstTouchRouter(opts);
  if (kind === 'go') return createQuizGoRouter(opts);
  if (kind === 'report') return createTeacherReportRouter(opts);
  return createTeacherStoriesRouter({ teacherOn: async () => true, ...opts });
}

function normalise(headers) {
  const out = {};
  Object.keys(headers).sort().forEach((k) => {
    if (k === 'date' || k === 'connection' || k === 'keep-alive') return;
    out[k] = k === 'ratelimit-reset' ? 'N' : headers[k];
  });
  return out;
}

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { cookie: `wq_dv=${DEVICE}`, 'user-agent': 'edge-test' };
    if (body && body.json) { data = JSON.stringify(body.json); headers['content-type'] = 'application/json'; }
    if (body && body.form) { data = body.form; headers['content-type'] = 'application/x-www-form-urlencoded'; }
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: normalise(res.headers), sha: crypto.createHash('sha256').update(raw).digest('hex'), length: raw.length });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

/** One row through its real router; `routerOpts` are passed to the router (e.g. securityOn). */
async function run(row, { security = true, routerOpts = {} } = {}) {
  const [, kind, method, path, body, answer] = row;
  const app = express();
  app.use(routerFor(kind, { botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: botFetch(answer, { security }), ...routerOpts }));
  app.use((req, res) => res.status(200).type('html').send(SPA));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    return await request(srv.address().port, method, path, body);
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

module.exports = { ROWS, REDIRECT_ROWS, BOT_SECURITY, BOT_OTHER, TOK, run };
