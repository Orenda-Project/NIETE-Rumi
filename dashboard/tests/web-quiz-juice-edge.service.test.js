/**
 * The edge's pages and the sound + motion kit (web_quiz_juice, decided by the bot, carried as payload `juice: true`).
 *
 * Off (no `juice` in the payload): the quiz page and the Challenge page are byte-identical to the pages drawn before
 * the kit existed (__golden__/juice-off-pages.json, rendered from the base commit; a file's ?v= hash is the only
 * part masked, since any edit to a served file moves it). On: the kit's stylesheet and script come before the page's
 * own script, so window.WQJ is there when the page boots. The kit's demo page answers only while the switch is on.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const R = require('../routes/web-quiz.routes');
const I = require('./__golden__/juice-off-inputs');

const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, '__golden__', 'juice-off-pages.json'), 'utf8'));
const mask = (s) => s.replace(/\?v=[0-9a-f]{10}/g, '?v=*');
// the boot JSON carries the payload as it came (juice: true is in it when on)
const unboot = (s) => mask(s).replace(',"juice":true', '');
const KIT = /<link rel="stylesheet" href="\/wq\/wq-juice\.css\?v=[0-9a-f]{10}">\n<script src="\/wq\/wq-juice\.js\?v=[0-9a-f]{10}" defer><\/script>\n/;

describe('switch off: every page as it was', () => {
  test.each(Object.keys(I))('%s', (k) => {
    const html = I[k](R);
    expect(mask(html)).toBe(mask(GOLD[k]));
    expect(html).not.toContain('wq-juice');
  });

  test('a payload whose juice is anything but true is off', () => {
    for (const v of [false, 'true', 1, null, {}]) {
      expect(I.quiz(R, { juice: v })).not.toMatch(/wq-juice\.(js|css)/);
      expect(I.challenge(R, { juice: v })).not.toMatch(/wq-juice\.(js|css)/);
    }
  });
});

describe('switch on: the kit is loaded before the page\'s own script', () => {
  test('the quiz page (en and ur)', () => {
    for (const k of ['quiz', 'quizUr']) {
      const html = I[k](R, { juice: true });
      expect(html).toMatch(KIT);
      expect(html.indexOf('wq-juice.js')).toBeLessThan(html.indexOf('/wq/wq.js'));
      // nothing else moved: taking the two lines out gives today's page
      expect(unboot(html.replace(KIT, ''))).toBe(mask(GOLD[k]));
    }
  });

  test('the Challenge page (Trail v2 and v1)', () => {
    for (const k of ['challenge', 'challengeV1']) {
      const html = I[k](R, { juice: true });
      expect(html).toMatch(KIT);
      expect(html.indexOf('wq-juice.js')).toBeLessThan(html.indexOf('/wq/wq-challenge.js'));
      expect(unboot(html.replace(KIT, ''))).toBe(mask(GOLD[k]));
    }
  });
});

describe('the kit\'s demo page', () => {
  function serve(juiceAnswer) {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const body = url.indexOf('/api/internal/wq/juice') >= 0 ? juiceAnswer : {};
      return { status: body && body.__status ? body.__status : 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body), json: async () => body };
    };
    const app = express();
    app.use(R.createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl, canonicalBase: '' }));
    const server = http.createServer(app);
    return new Promise((ok) => server.listen(0, () => ok({ server, calls, port: server.address().port })));
  }
  const get = (port, p) => new Promise((ok, no) => http.get({ port, path: p }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => ok({ status: res.statusCode, body: b, headers: res.headers })); }).on('error', no));

  test('on: the demo page, never cached, carrying the kit', async () => {
    const s = await serve({ on: true });
    try {
      const r = await get(s.port, '/wq/juice-demo.html');
      expect(r.status).toBe(200);
      expect(r.body).toContain('wq-juice.js');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-robots-tag']).toMatch(/noindex/);
      expect(s.calls.some((u) => u.indexOf('/api/internal/wq/juice') >= 0)).toBe(true);
    } finally { s.server.close(); }
  });

  test.each([[{ on: false }], [{ __status: 404 }], [{}]])('off (%j): 404, the static file is never served', async (ans) => {
    const s = await serve(ans);
    try {
      const r = await get(s.port, '/wq/juice-demo.html');
      expect(r.status).toBe(404);
      expect(r.body).not.toContain('wq-juice.js');
    } finally { s.server.close(); }
  });

  // the static /wq handler serves whatever sits under public/wq (cached a year), so the demo page must not be there
  const SPELLINGS = ['/wq/juice-demo%2Ehtml', '/wq/juice%2Ddemo.html', '/wq//juice-demo.html', '/wq/./juice-demo.html', '/WQ/juice-demo.html'];
  test.each([[{ on: false }], [{}]])('off (%j): every other spelling of the path is 404 too, never a cached file', async (ans) => {
    const s = await serve(ans);
    try {
      for (const p of SPELLINGS) {
        const r = await get(s.port, p);
        expect([p, r.status]).toEqual([p, 404]);
        expect(r.body).not.toContain('<!doctype');
        expect(String(r.headers['cache-control'] || '')).not.toMatch(/immutable|max-age=[1-9]/);
      }
    } finally { s.server.close(); }
  });

  test('on: only the one route draws it (the static handler has no copy)', async () => {
    const s = await serve({ on: true });
    try {
      for (const p of SPELLINGS.slice(0, 3)) expect([p, (await get(s.port, p)).status]).toEqual([p, 404]);
      expect((await get(s.port, '/wq/juice-demo.html')).status).toBe(200);
    } finally { s.server.close(); }
  });

  test('the page lives outside public/ (views/), read by the gated route', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'public', 'wq', 'juice-demo.html'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, '..', 'views', 'juice-demo.html'))).toBe(true);
  });

  test('the demo\'s finish card says the deed, never a count about the child (no stars out of ten)', () => {
    const f = path.join(__dirname, '..', 'views', 'juice-demo.html');
    const html = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'juice-demo.html'), 'utf8');
    expect(html).not.toMatch(/wq-star/);
    expect(html).not.toMatch(/\bright\s*\+=/); // no tally of right answers kept for the card
    expect(html).toContain('You answered all the questions!');
    expect(html).toContain('سارے سوال مکمل ہو گئے!');
  });

  test('no child page links to the demo', () => {
    const dir = path.join(__dirname, '..', 'public', 'wq');
    const hits = fs.readdirSync(dir).filter((f) => /\.(js|css|html)$/.test(f) && f !== 'juice-demo.html')
      .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').indexOf('juice-demo') >= 0);
    expect(hits).toEqual([]);
  });
});
