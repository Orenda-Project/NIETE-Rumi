/**
 * The standing class link at the edge: GET /j/:code, its generic preview, its hub fallback, and the
 * /q/<code> page left byte-identical.
 *
 * The bot is the network boundary (a fake fetch). The goldens in __golden__/class-link-edge-off.json were written
 * by running this file on the ORIGINAL origin/sandbox router with GOLDEN_WRITE=1.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const GOLDEN = path.join(__dirname, '__golden__', 'class-link-edge-off.json');
const CODE = 'KZ7QW3MNPX';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}
const QUIZ = {
  quiz: { id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A', why: 'Roots drink.' }] },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 3, ict_today_floor: 40 },
  video: null,
  preview: false,
};

function start(app) { return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); }); }
function req(srv, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p,
      headers: { host: 'quiz.example.org', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function build(fetchImpl) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, canonicalBase: '' }));
  app.use((r, res) => res.status(418).send('fell through'));
  return app;
}

// The bot as the fake fetch answers it: /quiz/AB12CD is a quiz, any other /quiz is unknown; /cl/<code> per `cl`.
function bot(cl) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/api/internal/wq/quiz/AB12CD')) return jsonRes(200, QUIZ);
    if (url.includes('/api/internal/wq/quiz/')) return jsonRes(404, { error: 'not_found' });
    if (url.includes('/api/internal/wq/cl/')) return typeof cl === 'function' ? cl(url, opts) : cl;
    return jsonRes(404, { error: 'not_found' });
  };
  return { calls, fetchImpl };
}

describe('golden: /q/<code> is byte-identical (the class link touches nothing on it)', () => {
  let srv;
  afterEach(() => new Promise((r) => srv.close(r)));
  it('the quiz page and an unknown code\'s page match the original router', async () => {
    const b = bot(jsonRes(200, { lang: 'en' }));
    srv = await start(build(b.fetchImpl));
    const quiz = await req(srv, 'GET', '/q/AB12CD');
    const unknown = await req(srv, 'GET', '/q/ZZ99ZZ99');
    const got = { quiz: { status: quiz.status, body: quiz.body }, unknown: { status: unknown.status, body: unknown.body } };
    if (process.env.GOLDEN_WRITE === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(got).toEqual(want);
  });
});

describe('/j/:code', () => {
  let srv;
  afterEach(() => new Promise((r) => srv.close(r)));

  it('(d) switch off / unknown / revoked / expired (the bot says not_found): exactly an unknown /q/ code\'s page', async () => {
    const b = bot(jsonRes(404, { error: 'not_found' }));
    srv = await start(build(b.fetchImpl));
    const j = await req(srv, 'GET', `/j/${CODE}`);
    const q = await req(srv, 'GET', '/q/ZZ99ZZ99');
    expect(j.status).toBe(404);
    expect(j.body).toBe(q.body);
    expect(b.calls.some((c) => c.url === `${BOT}/api/internal/wq/cl/${CODE}`)).toBe(true);
  });

  it('a code outside the class-link alphabet (I, O, 0, 1, lower case, < 8) never reaches the bot', async () => {
    const b = bot(jsonRes(200, { lang: 'en' }));
    srv = await start(build(b.fetchImpl));
    for (const bad of ['KZ7QW3MNPI', 'KZ7QW3MNP0', 'kz7qw3mnpx', 'KZ7QW3M']) {
      const r = await req(srv, 'GET', `/j/${bad}`);
      expect(r.status).toBe(404);
    }
    expect(b.calls).toHaveLength(0);
  });

  it('(e) the preview: og tags from og.link.* only, no class/school/teacher/child name, no digit; no child data in the page', async () => {
    const b = bot(jsonRes(200, { lang: 'en' }));
    srv = await start(build(b.fetchImpl));
    const r = await req(srv, 'GET', `/j/${CODE}`);
    expect(r.status).toBe(200);
    const og = {};
    r.body.replace(/<meta property="og:([a-z_:]+)" content="([^"]*)">/g, (m, k, v) => { og[k] = v; return m; });
    expect(og.title).toBe("Jugnu&#39;s Challenge");
    expect(og.description).toBe('Stories and number games. Tap to play.');
    Object.entries(og).forEach(([k, v]) => {
      if (k.startsWith('image:')) return; // width/height are the picture's pixel size, not about the class
      // the text a person reads (entities decoded: &#39; is an apostrophe, not a digit)
      const shown = v.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      expect(shown).not.toMatch(/[0-9۰-۹]/);
    });
    expect(r.body).not.toMatch(/Zara|Bilal|Testwala|Class 3/);
    const boot = JSON.parse(/<script id="boot" type="application\/json">([^<]*)<\/script>/.exec(r.body)[1]);
    expect(Object.keys(boot).sort()).toEqual(['code', 'lang', 'view']);
  });

  it('(e) Urdu when the bot says the class is Urdu: the Urdu og strings', async () => {
    const b = bot(jsonRes(200, { lang: 'ur' }));
    srv = await start(build(b.fetchImpl));
    const r = await req(srv, 'GET', `/j/${CODE}`);
    expect(r.body).toContain('<meta property="og:title" content="جگنو کا چیلنج">');
    expect(r.body).toContain('<meta property="og:description" content="کہانیاں اور گنتی کے کھیل۔ کھیلنے کے لیے دبائیں۔">');
    expect(r.body).toContain('dir="rtl"');
  });

  it('a link-preview fetch asks the bot with pv=1 (no door_shown for a crawler)', async () => {
    const b = bot(jsonRes(200, { lang: 'en' }));
    srv = await start(build(b.fetchImpl));
    await req(srv, 'GET', `/j/${CODE}`, undefined, { 'user-agent': 'WhatsApp/2.23.20.0 A' });
    expect(b.calls[0].url).toBe(`${BOT}/api/internal/wq/cl/${CODE}?pv=1`);
  });

  it('the arrival steps are forwarded as POSTs with the device_ref in the body, never the URL', async () => {
    const b = bot(jsonRes(200, { step: 'teacher', teachers: [] }));
    srv = await start(build(b.fetchImpl));
    for (const step of ['arrive', 'teacher', 'letter', 'pick']) {
      const body = { code: CODE, device_ref: 'dddddddddddddddddddddd' };
      const r = await req(srv, 'POST', `/api/wq/cl/${step}`, body);
      expect(r.status).toBe(200);
      const call = b.calls[b.calls.length - 1];
      expect(call.url).toBe(`${BOT}/api/internal/wq/cl/${step}`);
      expect(JSON.parse(call.opts.body)).toEqual(body);
    }
  });
});

describe('the teacher card\'s Copy and Forward at the report edge (/r/:token/jlink)', () => {
  const { createTeacherReportRouter } = require('../routes/teacher-report.routes');
  const TOK = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
  const CLS = 'c1a55000-0000-4000-8000-000000000001';
  let srv;
  afterEach(() => new Promise((r) => srv.close(r)));
  const redirectBot = (location, status) => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return { status, ok: false, headers: { get: (h) => (h.toLowerCase() === 'location' ? location : null) }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' };
    };
    return { calls, fetchImpl };
  };
  const buildTr = (fetchImpl) => { const app = express(); app.use(createTeacherReportRouter({ botUrl: BOT, apiKey: KEY, fetchImpl })); return app; };

  it('Copy: the bot\'s 303 back to the report (card open) is followed; how and the class reach the bot', async () => {
    const back = `/r/${TOK}?tab=class&cl_open=${CLS}#class-link`;
    const b = redirectBot(back, 303);
    srv = await start(buildTr(b.fetchImpl));
    const r = await req(srv, 'GET', `/r/${TOK}/jlink?class=${CLS}&how=copy`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe(back);
    expect(b.calls[0]).toBe(`${BOT}/api/internal/tr/jlink/${TOK}?class=${CLS}&how=copy`);
  });

  it('the report page passes cl_open (a class id) to the bot, so the card opens', async () => {
    const b = redirectBot(null, 200);
    srv = await start(buildTr(b.fetchImpl));
    await req(srv, 'GET', `/r/${TOK}?tab=class&cl_open=${CLS}`);
    expect(b.calls[0]).toBe(`${BOT}/api/internal/tr/page/${TOK}?tab=class&cl_open=${CLS}`);
  });

  it('a Copy redirect anywhere but the report itself is refused', async () => {
    const b = redirectBot('https://evil.example/', 303);
    srv = await start(buildTr(b.fetchImpl));
    const r = await req(srv, 'GET', `/r/${TOK}/jlink?class=${CLS}&how=copy`);
    expect(r.status).toBe(502);
  });
});

describe('the card\'s "Make a new link" at the report edge (POST /r/:token/jnew)', () => {
  const { createTeacherReportRouter } = require('../routes/teacher-report.routes');
  const TOK = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
  const CLS = 'c1a55000-0000-4000-8000-000000000001';
  let srv;
  afterEach(() => new Promise((r) => srv.close(r)));
  const answering = (status, location = null) => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'location' ? location : (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null)) },
        arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' };
    };
    return { calls, fetchImpl };
  };
  const buildTr = (fetchImpl) => { const app = express(); app.use(createTeacherReportRouter({ botUrl: BOT, apiKey: KEY, fetchImpl })); return app; };
  const postForm = (p, form) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', path: p,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(form) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    r.on('error', reject);
    r.write(form);
    r.end();
  });

  it('the form\'s class reaches the bot as a POST; its 303 back to the class tab is followed', async () => {
    const back = `/r/${TOK}?tab=class#class-link`;
    const b = answering(303, back);
    srv = await start(buildTr(b.fetchImpl));
    const r = await postForm(`/r/${TOK}/jnew`, `class=${CLS}&extra=dropped`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe(back);
    expect(b.calls[0].url).toBe(`${BOT}/api/internal/tr/jnew/${TOK}`);
    expect(b.calls[0].opts.method).toBe('POST');
    expect(JSON.parse(b.calls[0].opts.body)).toEqual({ class: CLS });
  });

  it('the bot\'s 404 (switch off, not this teacher\'s class) is passed through as 404', async () => {
    const b = answering(404);
    srv = await start(buildTr(b.fetchImpl));
    const r = await postForm(`/r/${TOK}/jnew`, `class=${CLS}`);
    expect(r.status).toBe(404);
  });
});

describe('the teacher\'s own visit from the card (/j/<code>?t=<signed>)', () => {
  let srv;
  afterEach(() => new Promise((r) => srv.close(r)));
  it('the signed teacher token reaches the bot\'s landing call, so the bot can leave door_shown out', async () => {
    const b = bot(jsonRes(200, { lang: 'en' }));
    srv = await start(build(b.fetchImpl));
    const jt = `${'x'.repeat(40)}.${'y'.repeat(22)}`;
    await req(srv, 'GET', `/j/${CODE}?t=${jt}`);
    expect(b.calls[0].url).toBe(`${BOT}/api/internal/wq/cl/${CODE}?jt=${jt}`);
    await req(srv, 'GET', `/j/${CODE}?t=not-a-token`);
    expect(b.calls[1].url).toBe(`${BOT}/api/internal/wq/cl/${CODE}`);
  });
});
