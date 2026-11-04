/**
 * The teacher home's public edge (/quiz/teacher/:token, /api/th/*): the bot's 404 {off:true} -> next() with nothing set on
 * the response (byte-identical fall-through to the SPA); a malformed token or body -> next() with no bot call; a
 * path-for-path forward with allow-listed query and body; the relay rules. The bot is an injected fake callBot.
 */
const http = require('http');
const express = require('express');
const { createQuizTeacherRouter } = require('../routes/quiz-teacher.routes');

const TOK = `eyJrIjoidGgifQ.${'A'.repeat(22)}`;
const UUID = 'a0000000-0000-4000-8000-000000000001';
const UUID2 = 'b0000000-0000-4000-8000-000000000002';
const SPA = '<!doctype html><title>SPA</title>';
const OFF = { status: 404, bytes: Buffer.from('{"off":true}'), contentType: 'application/json' };

let srv;
let calls;
async function boot(answer, opts = {}) {
  calls = [];
  const callBot = async (method, path, req, body, o) => {
    calls.push({ method, path, body, opts: o });
    return typeof answer === 'function' ? answer(method, path) : answer;
  };
  const app = express();
  app.use(createQuizTeacherRouter(opts.noBot ? opts.router : { callBot, ...(opts.router || {}) }));
  app.use((req, res) => res.status(200).type('html').send(SPA));
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

function request(method, path, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks), body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function rawPost(path, text) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', path,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.end(text);
  });
}

const POST_OK = { t: TOK };
const ROUTES = [
  ['GET', `/quiz/teacher/${TOK}`, null, false],
  ['GET', `/quiz/teacher/${TOK}/stories`, null, false],
  ['GET', `/quiz/teacher/${TOK}/send?c=${UUID}&o=library`, null, false],
  ['GET', `/api/th/home?t=${TOK}`, null, true],
  ['GET', `/api/th/library?t=${TOK}`, null, true],
  ['GET', `/api/th/quiz/${UUID}?t=${TOK}`, null, true],
  ['POST', '/api/th/send', { ...POST_OK, kind: 'video', id: UUID }, true],
  ['POST', '/api/th/quiz/make', { ...POST_OK, kind: 'lesson', id: 'lsn_lp_v8_abc' }, true],
  ['POST', '/api/th/confirm', { ...POST_OK, decision: 'same' }, true],
  ['POST', '/api/th/step', { ...POST_OK, step: 'opened' }, true],
];

// Baseline headers of the sentinel alone (what today's handling sends).
async function baseline() {
  const app = express();
  app.use((req, res) => res.status(200).type('html').send(SPA));
  const s = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  const prev = srv; srv = s;
  const res = await request('GET', '/x');
  await new Promise((r) => s.close(r));
  srv = prev;
  return res;
}
const stable = (h) => { const o = { ...h }; delete o.date; delete o.connection; delete o['keep-alive']; return o; };

describe('switch OFF at the bot: every route falls through byte-identically', () => {
  test.each(ROUTES)('%s %s', async (method, path, body) => {
    const base = await baseline();
    await boot(OFF);
    const res = await request(method, path, { body });
    expect(calls).toHaveLength(1);
    expect(res.status).toBe(200);
    expect(res.raw.equals(Buffer.from(SPA))).toBe(true);
    expect(res.headers['cache-control']).toBeUndefined();
    expect(res.headers['x-robots-tag']).toBeUndefined();
    expect(res.headers['referrer-policy']).toBeUndefined();
    expect(stable(res.headers)).toEqual(stable(base.headers));
  });
});

describe('malformed input falls through with zero bot calls', () => {
  test.each(['abc', 'abcdefgh.short', `${'A'.repeat(8)}.${'B'.repeat(23)}`, 'bad token.' + 'A'.repeat(22)])('page token %s', async (tok) => {
    await boot({ status: 200, bytes: Buffer.from('never') });
    for (const p of [`/quiz/teacher/${encodeURIComponent(tok)}`, `/quiz/teacher/${encodeURIComponent(tok)}/stories`]) {
      const res = await request('GET', p);
      expect(res.body).toBe(SPA);
    }
    expect(calls).toHaveLength(0);
  });
  test('JSON GET without t, with a bad t, or a non-uuid id', async () => {
    await boot({ status: 200, bytes: Buffer.from('never') });
    for (const p of ['/api/th/home', '/api/th/library', '/api/th/home?t=abc', `/api/th/quiz/${UUID}`, `/api/th/quiz/not-a-uuid?t=${TOK}`, `/api/th/home?t=${TOK}&t=${TOK}`]) {
      const res = await request('GET', p);
      expect(res.body).toBe(SPA);
    }
    expect(calls).toHaveLength(0);
  });
  test('POST with no valid t', async () => {
    await boot({ status: 200, bytes: Buffer.from('never') });
    for (const kind of ['send', 'quiz/make', 'confirm', 'step']) {
      for (const body of [{}, { t: 'nope' }, { t: 5 }]) {
        const res = await request('POST', `/api/th/${kind}`, { body });
        expect(res.body).toBe(SPA);
      }
    }
    expect(calls).toHaveLength(0);
  });
});

describe('path-for-path forwarding', () => {
  const ok = { status: 200, bytes: Buffer.from('{}'), contentType: 'application/json' };
  test('page: lang ur forwarded, other langs not, /stories suffix', async () => {
    await boot({ status: 200, bytes: Buffer.from('<html>x</html>'), contentType: 'text/html' });
    await request('GET', `/quiz/teacher/${TOK}?lang=ur`);
    await request('GET', `/quiz/teacher/${TOK}?lang=fr`);
    await request('GET', `/quiz/teacher/${TOK}/stories?lang=en&evil=1`);
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['GET', `/api/internal/th/quiz/teacher/${TOK}?lang=ur`],
      ['GET', `/api/internal/th/quiz/teacher/${TOK}`],
      ['GET', `/api/internal/th/quiz/teacher/${TOK}/stories?lang=en`],
    ]);
    expect(calls[0].opts).toEqual({ raw: true });
  });
  test('page: a Digital Coach report\'s session (uuid) reaches the bot with the page language; any other shape is dropped', async () => {
    await boot({ status: 200, bytes: Buffer.from('<html>x</html>'), contentType: 'text/html' });
    await request('GET', `/quiz/teacher/${TOK}?session=${UUID}`);
    await request('GET', `/quiz/teacher/${TOK}?lang=en&session=${UUID}`);
    await request('GET', `/quiz/teacher/${TOK}?session=lsn_lp_v8_abc`);
    await request('GET', `/quiz/teacher/${TOK}/stories?session=${UUID}`);
    expect(calls.map((c) => c.path)).toEqual([
      `/api/internal/th/quiz/teacher/${TOK}?session=${UUID}`,
      `/api/internal/th/quiz/teacher/${TOK}?lang=en&session=${UUID}`,
      `/api/internal/th/quiz/teacher/${TOK}`,
      `/api/internal/th/quiz/teacher/${TOK}/stories`,
    ]);
  });
  test('stories page: a story tile\'s book (uuid) and the grade (1-5) reach the stories page; bad shapes dropped', async () => {
    await boot({ status: 200, bytes: Buffer.from('<html>x</html>'), contentType: 'text/html' });
    await request('GET', `/quiz/teacher/${TOK}/stories?book=${UUID}`);
    await request('GET', `/quiz/teacher/${TOK}/stories?book=${UUID}&grade=3&lang=ur`);
    await request('GET', `/quiz/teacher/${TOK}/stories?book=not-a-book&grade=9&lang=fr&evil=1`);
    expect(calls.map((c) => c.path)).toEqual([
      `/api/internal/th/quiz/teacher/${TOK}/stories?book=${UUID}`,
      `/api/internal/th/quiz/teacher/${TOK}/stories?book=${UUID}&grade=3&lang=ur`,
      `/api/internal/th/quiz/teacher/${TOK}/stories`,
    ]);
  });
  test('send: the library code (uuid), where it started and lang reach the bot; its 302 to wa.me is passed on', async () => {
    await boot({ status: 302, location: 'https://wa.me/?text=hello', bytes: Buffer.alloc(0) });
    const r = await request('GET', `/quiz/teacher/${TOK}/send?c=${UUID}&o=again&lang=ur&evil=1`);
    await request('GET', `/quiz/teacher/${TOK}/send?c=nope&o=elsewhere`);
    expect(calls.map((c) => c.path)).toEqual([
      `/api/internal/th/quiz/teacher/${TOK}/send?c=${UUID}&o=again&lang=ur`,
      `/api/internal/th/quiz/teacher/${TOK}/send`,
    ]);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('https://wa.me/?text=hello');
  });
  test('home: only t, g (1-5), lang forwarded', async () => {
    await boot(ok);
    await request('GET', `/api/th/home?t=${TOK}&g=3&lang=en&evil=1`);
    await request('GET', `/api/th/home?t=${TOK}&g=9&lang=xx`);
    await request('GET', `/api/th/library?t=${TOK}&g=5`);
    expect(calls.map((c) => c.path)).toEqual([
      `/api/internal/th/api/th/home?t=${TOK}&g=3&lang=en`,
      `/api/internal/th/api/th/home?t=${TOK}`,
      `/api/internal/th/api/th/library?t=${TOK}&g=5`,
    ]);
  });
  test('quiz/:id with a uuid', async () => {
    await boot(ok);
    await request('GET', `/api/th/quiz/${UUID}?t=${TOK}`);
    expect(calls[0].path).toBe(`/api/internal/th/api/th/quiz/${UUID}?t=${TOK}`);
  });
});

describe('POST bodies are allow-listed', () => {
  const ok = { status: 200, bytes: Buffer.from('{}'), contentType: 'application/json' };
  const post = async (kind, body) => { await request('POST', `/api/th/${kind}`, { body }); return calls[calls.length - 1]; };
  test('send', async () => {
    await boot(ok);
    let c = await post('send', { t: TOK, kind: 'video', id: UUID, junk: 'x' });
    expect(c.method).toBe('POST');
    expect(c.path).toBe('/api/internal/th/api/th/send');
    expect(c.body).toEqual({ t: TOK, kind: 'video', id: UUID });
    c = await post('send', { t: TOK, kind: 'bogus', id: UUID });
    expect(c.body).toEqual({ t: TOK, id: UUID });
  });
  test('quiz/make', async () => {
    await boot(ok);
    const c = await post('quiz/make', { t: TOK, kind: 'lesson', id: 'lsn_lp_v8_abc' });
    expect(c.path).toBe('/api/internal/th/api/th/quiz/make');
    expect(c.body).toEqual({ t: TOK, kind: 'lesson', id: 'lsn_lp_v8_abc' });
  });
  test('confirm', async () => {
    await boot(ok);
    let c = await post('confirm', { t: TOK, looseId: UUID, candidateId: UUID2, decision: 'same' });
    expect(c.body).toEqual({ t: TOK, looseId: UUID, candidateId: UUID2, decision: 'same' });
    c = await post('confirm', { t: TOK, looseId: UUID, decision: 'maybe' });
    expect(c.body).toEqual({ t: TOK, looseId: UUID });
  });
  test('step; there is no role route (a POST /api/th/role falls through untouched, no bot call)', async () => {
    await boot(ok);
    const none = await request('POST', '/api/th/role', { body: { t: TOK, side: 'child' } });
    expect(none.body).toBe(SPA);
    let c = await post('step', { t: TOK, step: 'opened', kind: 'story', origin: 'library', id: 'nope', x: 1 });
    expect(c.body).toEqual({ t: TOK, step: 'opened', kind: 'story', origin: 'library' });
  });
});

describe('relay', () => {
  const PAGE = ROUTES.filter((r) => !r[3]);
  const JSONR = ROUTES.filter((r) => r[3]);
  const run = (r) => request(r[0], r[1], { body: r[2] });

  test.each(ROUTES)('200 passes the same bytes, no-store: %s %s', async (...r) => {
    const bytes = Buffer.from('<html>héllo</html>');
    await boot({ status: 200, bytes, contentType: 'text/html; charset=utf-8' });
    const res = await run(r);
    expect(res.status).toBe(200);
    expect(res.raw.equals(bytes)).toBe(true);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
  test('302 to wa.me passes through', async () => {
    await boot({ status: 302, location: 'https://wa.me/?text=hi' });
    for (const r of ROUTES) {
      const res = await run(r);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://wa.me/?text=hi');
    }
  });
  test('302 to a same-site page passes through', async () => {
    await boot({ status: 302, location: `/quiz/teacher/${TOK}/stories?lang=ur` });
    const res = await run(PAGE[0]);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/quiz/teacher/${TOK}/stories?lang=ur`);
  });
  test('302 to an evil host: 502 page for pages, 503 JSON for JSON routes', async () => {
    await boot({ status: 302, location: 'https://evil.example' });
    for (const r of PAGE) {
      const res = await run(r);
      expect(res.status).toBe(502);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers.location).toBeUndefined();
    }
    for (const r of JSONR) {
      const res = await run(r);
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'mk.error' });
    }
  });
  test('204 passes', async () => {
    await boot({ status: 204 });
    for (const r of ROUTES) expect((await run(r)).status).toBe(204);
  });
  test('4xx other than the off answer passes through', async () => {
    await boot({ status: 400, bytes: Buffer.from('{"error":"x"}'), contentType: 'application/json' });
    const res = await run(JSONR[3]);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'x' });
  });
  test.each([
    ['bot 500', { status: 500, bytes: Buffer.from('boom') }],
    ['callBot throws', () => { throw new Error('aborted'); }],
  ])('%s: mk.error', async (_n, answer) => {
    await boot(answer);
    for (const r of PAGE) {
      const res = await run(r);
      expect(res.status).toBe(503);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).not.toContain('boom');
    }
    for (const r of JSONR) {
      const res = await run(r);
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'mk.error' });
    }
  });
});

describe('the rate limit', () => {
  test('over the limit: the request falls through to today\'s page (never a 429), with no bot call', async () => {
    await boot(OFF, { router: { limit: 2 } });
    const page = [];
    for (let i = 0; i < 3; i += 1) page.push(await request('GET', `/quiz/teacher/${TOK}`));
    const json = await request('GET', `/api/th/home?t=${TOK}`);
    const posted = await request('POST', '/api/th/step', { body: { t: TOK, step: 'more' } });
    [...page, json, posted].forEach((r) => {
      expect(r.status).toBe(200);
      expect(r.body).toBe(SPA);
      expect(r.headers['retry-after']).toBeUndefined();
    });
    expect(calls).toHaveLength(2);
  });
  test('switch ON, over the limit: falls through as well (the bot is not called)', async () => {
    await boot({ status: 200, bytes: Buffer.from('<html>home</html>'), contentType: 'text/html' }, { router: { limit: 1 } });
    expect((await request('GET', `/quiz/teacher/${TOK}`)).body).toBe('<html>home</html>');
    const over = await request('GET', `/quiz/teacher/${TOK}`);
    expect(over.status).toBe(200);
    expect(over.body).toBe(SPA);
    expect(calls).toHaveLength(1);
  });
});

describe('unconfigured', () => {
  test('no botUrl / apiKey and no callBot: every route falls through', async () => {
    await boot(null, { noBot: true, router: { botUrl: '', apiKey: '', fetchImpl: () => { throw new Error('network'); } } });
    for (const [method, path, body] of ROUTES) {
      const res = await request(method, path, { body });
      expect(res.body).toBe(SPA);
      expect(res.headers['cache-control']).toBeUndefined();
    }
  });
});

describe('a body the app cannot read is answered exactly as without this edge (dashboard/index.js\'s own parsers and handlers)', () => {
  // dashboard/index.js after the edge: its two body parsers, the SPA catch-all (GET), the 404 handler, the error handler
  const tail = (app) => {
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.get('*', (req, res) => res.status(200).type('html').send(SPA));
    app.use((req, res) => res.status(404).type('html').send('404 - Not Found'));
    app.use((err, req, res, next) => res.status(500).type('html').send(`Server error ${err.type || ''}`)); // eslint-disable-line no-unused-vars
  };
  async function both(send) {
    const out = [];
    for (const withEdge of [true, false]) {
      calls = [];
      const app = express();
      if (withEdge) app.use(createQuizTeacherRouter({ callBot: async (...a) => { calls.push(a); return OFF; } }));
      tail(app);
      srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
      const res = await send();
      out.push({ status: res.status, body: res.body, type: res.headers['content-type'], calls: calls.length });
      await new Promise((r) => srv.close(r)); srv = null;
    }
    return out;
  }
  const post = (path, text, type = 'application/json') => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', path,
      headers: { 'content-type': type, 'content-length': Buffer.byteLength(text) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.end(text);
  });
  test.each(['send', 'quiz/make', 'confirm', 'step'])('POST /api/th/%s: malformed JSON, a 5 KB body, a form body', async (kind) => {
    const big = JSON.stringify({ t: TOK, pad: 'x'.repeat(5 * 1024) });
    for (const [text, type] of [['{not json', 'application/json'], [big, 'application/json'], [`t=${TOK}`, 'application/x-www-form-urlencoded']]) {
      const [withEdge, without] = await both(() => post(`/api/th/${kind}`, text, type));
      expect({ ...withEdge, calls: 0 }).toEqual({ ...without, calls: 0 });
    }
  });
});

describe('the edge\'s own error page carries ONE tap back to the chat', () => {
  const BOT = ['1555', '000', '1111'].join('');
  const homeWith = (bot) => ({ status: 200, bytes: Buffer.from(JSON.stringify({ lang: 'en', bot })), contentType: 'application/json' });
  test('after the bot gave its number: the 503 and 502 pages link wa.me/<bot>?text=quiz in the page language', async () => {
    let answer = homeWith(BOT);
    await boot(() => (typeof answer === "function" ? answer() : answer));
    expect((await request('GET', `/api/th/home?t=${TOK}`)).status).toBe(200);
    answer = { status: 500, bytes: Buffer.from('boom') };
    const en = await request('GET', `/quiz/teacher/${TOK}`);
    expect(en.status).toBe(503);
    expect(en.body.match(/wa\.me\//g)).toHaveLength(1);
    expect(en.body).toContain(`href="https://wa.me/${BOT}?text=quiz"`);
    expect(en.body).toContain('Open WhatsApp');
    const ur = await request('GET', `/quiz/teacher/${TOK}?lang=ur`);
    expect(ur.body).toContain(`href="https://wa.me/${BOT}?text=quiz"`);
    expect(ur.body).toContain('واٹس\u00a0ایپ کھولیں');
    answer = { status: 302, location: 'https://evil.example' };
    const bad = await request('GET', `/quiz/teacher/${TOK}/send?c=${UUID}`);
    expect(bad.status).toBe(502);
    expect(bad.body).toContain(`href="https://wa.me/${BOT}?text=quiz"`);
  });
  test('before any home answer, the portal\'s own setting gives the number (digits only), so a restart never drops the tap', async () => {
    const was = process.env.WHATSAPP_BOT_NUMBER;
    process.env.WHATSAPP_BOT_NUMBER = `+${['1', '555', '000', '1111'].join(' ')}`;
    try {
      await boot({ status: 500, bytes: Buffer.from('boom') });
      const res = await request('GET', `/quiz/teacher/${TOK}`);
      expect(res.status).toBe(503);
      expect(res.body).toContain(`href="https://wa.me/${BOT}?text=quiz"`);
    } finally { if (was === undefined) delete process.env.WHATSAPP_BOT_NUMBER; else process.env.WHATSAPP_BOT_NUMBER = was; }
  });

  test('no number yet, or one that is not digits: the words alone, no link', async () => {
    const was = [process.env.WHATSAPP_BOT_NUMBER, process.env.REFERRAL_BOT_NUMBER];
    delete process.env.WHATSAPP_BOT_NUMBER; delete process.env.REFERRAL_BOT_NUMBER;
    let answer = { status: 500, bytes: Buffer.from('boom') };
    try { await boot(() => (typeof answer === "function" ? answer() : answer)); } finally {
      if (was[0] !== undefined) process.env.WHATSAPP_BOT_NUMBER = was[0];
      if (was[1] !== undefined) process.env.REFERRAL_BOT_NUMBER = was[1];
    }
    const none = await request('GET', `/quiz/teacher/${TOK}`);
    expect(none.body).not.toContain('wa.me');
    answer = homeWith('+92 300 <script>');
    await request('GET', `/api/th/home?t=${TOK}`);
    answer = () => { throw new Error('aborted'); };
    const res = await request('GET', `/quiz/teacher/${TOK}`);
    expect(res.status).toBe(503);
    expect(res.body).not.toContain('wa.me');
    expect(res.body).not.toContain('<script>');
  });
});
