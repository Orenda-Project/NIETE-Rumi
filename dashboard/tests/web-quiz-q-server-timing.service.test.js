/**
 * The class link's page (GET /q/:code) says where its wait went, as the hub page does: the bot sends its own numbers
 * (`app;dur`, the round-trip count) on the quiz answer only while app_settings web_quiz_server_timing is on, and the edge
 * passes them on with its own wait and the page's render:
 *  - a page whose headers have not gone yet (fast switch off, or this process has not learnt it): ONE Server-Timing,
 *    `edge;dur`, the bot's items, `render;dur`; a header only, the body today's bytes;
 *  - the flushed page (headers gone before the bot answers): the tail's boot JSON carries one `st`;
 *  - off (the bot sent no timing): no header, no `st`, every page byte for byte today's.
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const APP = 'app;dur=3650, dbq;desc="23"';

function jsonRes(status, body, headers = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  return { status, ok: status >= 200 && status < 300, headers: { get: (n) => (h[n.toLowerCase()] !== undefined ? h[n.toLowerCase()] : null) }, text: async () => JSON.stringify(body) };
}
const QUIZ = (extra = {}) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null,
  preview: false,
  brand: 'niete',
  rt: false,
  ...extra,
});
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function get(srv, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example' } }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, body }));
    });
    r.on('error', reject); r.end();
  });
}
/** A portal process whose bot answers every quiz call with `body`, plus `headers` (the bot's Server-Timing, when on). */
async function portal(body, headers = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async () => jsonRes(200, body, headers), logEvent: () => {} }));
  return start(app);
}
const boot = (body) => JSON.parse(body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const stLines = (raw) => raw.filter((h, i) => i % 2 === 0 && h.toLowerCase() === 'server-timing');
const close = (srv) => new Promise((r) => srv.close(r));

describe('the class link page, headers not gone yet (this process has not learnt the fast switch)', () => {
  test('on: one Server-Timing, the edge\'s wait, the bot\'s items, the render; the body today\'s bytes', async () => {
    const off = await portal(QUIZ());
    const on = await portal(QUIZ(), { 'server-timing': APP });
    try {
      const a = await get(off, '/q/AB12CD');
      const b = await get(on, '/q/AB12CD');
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.headers['server-timing']).toBeUndefined();
      expect(stLines(b.raw)).toHaveLength(1);
      expect(b.headers['server-timing']).toMatch(/^edge;dur=\d+, app;dur=3650, dbq;desc="23", render;dur=\d+$/);
      expect(b.body).toBe(a.body);
      expect(boot(b.body)).not.toHaveProperty('st');
    } finally { await close(off); await close(on); }
  });
  test('the class table view (/q/:code/class) says it too', async () => {
    const on = await portal(QUIZ(), { 'server-timing': APP });
    try {
      const b = await get(on, '/q/AB12CD/class');
      expect(b.headers['server-timing']).toMatch(/^edge;dur=\d+, app;dur=3650, dbq;desc="23", render;dur=\d+$/);
    } finally { await close(on); }
  });
  test('only listed items pass: free text or an unknown name from the bot never reaches the phone', async () => {
    const on = await portal(QUIZ(), { 'server-timing': 'dbq;desc="Sana Testwala", zzz;dur=4, app;dur=12' });
    try {
      const b = await get(on, '/q/AB12CD');
      expect(b.headers['server-timing']).toMatch(/^edge;dur=\d+, app;dur=12, render;dur=\d+$/);
      expect(b.headers['server-timing']).not.toMatch(/Sana|zzz/);
    } finally { await close(on); }
  });
});

describe('the flushed class link page (the fast switch learnt)', () => {
  test('on: the tail\'s boot JSON carries the bot\'s items as `st`; off: no `st`, the same page', async () => {
    const off = await portal(QUIZ({ fast: true }));
    const on = await portal(QUIZ({ fast: true }), { 'server-timing': APP });
    try {
      await get(off, '/q/AB12CD');
      await get(on, '/q/AB12CD');
      const a = await get(off, '/q/AB12CD');
      const b = await get(on, '/q/AB12CD');
      expect(a.body).toContain('rel="preload"');
      expect(boot(a.body)).not.toHaveProperty('st');
      expect(boot(b.body).st).toBe(APP);
      // the rest of the page and of its boot JSON byte for byte the off page's
      const outside = (body) => body.replace(/<script id="boot" type="application\/json">[\s\S]*?<\/script>/, '');
      expect(outside(b.body)).toBe(outside(a.body));
      const { st, ...rest } = boot(b.body);
      expect(JSON.stringify(rest)).toBe(JSON.stringify(boot(a.body)));
    } finally { await close(off); await close(on); }
  });
});

// The boot JSON's `st` is the step timings (this file, the hub page's since its timing car), while the quiz page's own
// `st` (wq.js S.st, the finish card's auth) is the session token from the start answer. No page script may read the
// boot's `st`, or a timing string could reach the auth path one day. Each boot reader's variable is found in the source.
describe('no page script reads the boot JSON\'s `st` (step timings, not the session token)', () => {
  test('every /wq/*.js boot reader: no `<boot>.st`, `<boot>[\'st\']`, `boot().st` or `{ st } = <boot>`', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../public/wq');
    const hits = [];
    let readers = 0;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const names = new Set();
      const rx = /(\w+)\s*=\s*(?:\w+\s*\?\s*)?JSON\.parse\(\s*(?:document\.getElementById\(['"]boot['"]\)|bootEl)/g;
      let m;
      while ((m = rx.exec(src))) names.add(m[1]);
      if (/function boot\(\)\s*\{[^}]*JSON\.parse\(document\.getElementById\(['"]boot['"]\)/.test(src)) names.add('boot()');
      if (!names.size) continue;
      readers += 1;
      for (const n of names) {
        const e = n.replace(/[()]/g, '\\$&');
        const bad = [new RegExp(`(^|[^\\w.])${e}\\s*\\.\\s*st\\b`), new RegExp(`(^|[^\\w.])${e}\\s*\\[\\s*['"]st['"]\\s*\\]`), new RegExp(`\\{[^}=]*\\bst\\b[^}=]*\\}\\s*=\\s*${e}\\b`)];
        if (bad.some((r) => r.test(src))) hits.push(`${f}: ${n}`);
      }
    }
    expect(readers).toBeGreaterThanOrEqual(8);
    expect(hits).toEqual([]);
  });
});
