/**
 * The read-along player's preload on the Jugnu page (the bot names `ra_pre` only with web_quiz_ra_preload on, a passage
 * that can be served and the read-along on): exactly one preload line whose address is the very one the page asks for
 * later (wq-trail.js's RA_V), on a passage menu only; any other menu is the page as it was (a golden from the base).
 */
const fs = require('fs');
const path = require('path');
const { renderChallengePage } = require('../routes/web-quiz.routes');
const { withRaPreload } = require('../routes/web-quiz-ra-preload');

const PUB = path.join(__dirname, '..', 'public', 'wq');
const GOLDEN = path.join(__dirname, 'fixtures', 'ra-preload-off-page.golden.html');
const page = (menu) => withRaPreload(renderChallengePage({ menu, token: 't', kid: null, origin: 'https://x', assetV: 'v1', chV: 'c', brandKey: 'niete' }), menu);
const norm = (h) => h.replace(/\?v=[0-9a-f]{10}\b/g, '?v=H').replace(/"token":"[^"]*"/g, '"token":"T"');
const MENU = { form: 'G3', lang: 'en', exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }], v2: { pool: false, story: true, consent: false } };
const preloads = (h) => h.match(/<link[^>]*rel="preload"[^>]*>/g) || [];
const raV = (file) => (fs.readFileSync(path.join(PUB, file), 'utf8').match(/RA_V = '([0-9a-f]{10})'/) || [])[1];

describe('the read-along preload line', () => {
  test('a passage menu with the mark: one preload, the same address the page loads later', () => {
    const html = page({ ...MENU, ra_pre: true });
    const tags = preloads(html);
    expect(tags).toHaveLength(1);
    const href = /href="([^"]+)"/.exec(tags[0])[1];
    expect(tags[0]).toMatch(/^<link rel="preload" as="script" href=/);
    // what wq-trail.js asks for: '/wq/wq-readalong.js?v=' + RA_V
    expect(href).toBe(`/wq/wq-readalong.js?v=${raV('wq-trail.js')}`);
    expect(href).toBe(`/wq/wq-readalong.js?v=${raV('wq-stories.js')}`);
    expect(/s\.src = '(\/wq\/wq-readalong\.js\?v=)' \+ RA_V/.test(fs.readFileSync(path.join(PUB, 'wq-trail.js'), 'utf8'))).toBe(true);
    // in the head, before the body
    expect(html.indexOf(tags[0])).toBeLessThan(html.indexOf('</head>'));
  });

  test('no crossorigin on the line, and none on the later load (the two must match byte for byte)', () => {
    const tag = preloads(page({ ...MENU, ra_pre: true }))[0];
    expect(tag).not.toMatch(/crossorigin/i);
    for (const f of ['wq-trail.js', 'wq-stories.js']) expect(fs.readFileSync(path.join(PUB, f), 'utf8')).not.toMatch(/crossOrigin|crossorigin/);
  });

  test.each([['no mark', MENU], ['mark false', { ...MENU, ra_pre: false }], ['mark as a string', { ...MENU, ra_pre: 'true' }],
    ['a menu with no passage stop (marked)', { ...MENU, ra_pre: true, exercises: [{ id: 'bigger', name: 'Bigger', mins: 2, done: false, last: null }] }]])('%s: none', (_n, menu) => {
    expect(preloads(page(menu))).toHaveLength(0);
  });

  test('a menu without Story Time: none, even with the mark', () => {
    expect(preloads(page({ ...MENU, ra_pre: true, v2: { pool: false, story: false, consent: false } }))).toHaveLength(0);
  });

  test('a menu without the second version of the trail: none, even with the mark', () => {
    const { v2, ...v1 } = MENU;
    expect(preloads(page({ ...v1, ra_pre: true }))).toHaveLength(0);
  });

  test('off: the page is the base golden, byte for byte', () => {
    const text = norm(page(MENU));
    // The golden was recorded once from the base code (write `text` to GOLDEN by hand to re-record).
    expect(text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });

  test('on adds only the one line', () => {
    const off = page(MENU);
    const on = page({ ...MENU, ra_pre: true });
    const tag = preloads(on)[0];
    expect(tag).toBeTruthy();
    expect(on.replace(`\n${tag}`, '').replace(/"ra_pre":true,?/, '').replace(/,\}/g, '}')).toBe(off.replace(/,\}/g, '}'));
    console.log(`head line bytes: ${Buffer.byteLength(`\n${tag}`)} raw, ${require('zlib').gzipSync(Buffer.from(on)).length - require('zlib').gzipSync(Buffer.from(off)).length} gz added to the page`);
  });
});

describe('through the route (the bot faked)', () => {
  const http = require('http');
  const express = require('express');
  const { createWebQuizRouter } = require('../routes/web-quiz.routes');
  const TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
  const serve = (menu) => new Promise((r) => {
    const app = express();
    const fetchImpl = async () => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(menu) });
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl }));
    const srv = app.listen(0, () => r(srv));
  });
  const get = (srv) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: `/c/${TOKEN}` }, (res) => { let o = ''; res.on('data', (c) => { o += c; }); res.on('end', () => resolve(o)); }).on('error', reject);
  });
  test('a marked passage menu: the page has the one preload line; an unmarked one has none', async () => {
    const a = await serve({ ...MENU, ra_pre: true });
    const b = await serve(MENU);
    try {
      const on = await get(a);
      const off = await get(b);
      expect(preloads(on)).toHaveLength(1);
      expect(preloads(on)[0]).toContain(`/wq/wq-readalong.js?v=${raV('wq-trail.js')}`);
      expect(preloads(off)).toHaveLength(0);
    } finally { a.close(); b.close(); }
  });
});
