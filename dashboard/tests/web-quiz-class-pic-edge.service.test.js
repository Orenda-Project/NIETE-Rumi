/**
 * The class link's own picture at the edge: what a teacher's forwarded /q/<CODE> names as its og:image.
 *
 * The bot decides whether a code has one (its switches: quiz_teacher_home, and the story send's for a story) and
 * names it in the payload's art (`teach`, a signed id of its own kind, and `teach_v`, its version). The edge only
 * orders the pictures: a child's finish card (?k=) first, a child's own card (?a=) next, then the class picture, then
 * today's. Off, the payload carries neither field, and the page and its preview head are today's byte for byte (the
 * goldens in __golden__/class-pic-edge-off.json were written by running this file on the code before the picture
 * with GOLDEN_WRITE=1). The bot is the network boundary (a fake fetch).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const GOLDEN = path.join(__dirname, '__golden__', 'class-pic-edge-off.json');
const WA = 'WhatsApp/2.24.20.89 A';
const PHONE = 'Mozilla/5.0 (Linux; Android 13; SM-A135F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36';
const TEACH = 't.MzMzMzMzMzNDM0MzMzMzMw.abcdefghijkl';
const CARD_K = 'A'.repeat(60);
const CARD_A = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
function pngRes() {
  return { status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => PNG, text: async () => '' };
}
const base = (extra = {}) => ({
  quiz: { id: 'q', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', n: 2, questions: [] },
  cls: { label: null, teacher: 'Teacher', chips: [] }, live: {}, video: null, preview: false, brand: 'niete',
  art: { class: 'l.AB12CD.v1bw_tRX32tq', schools: 's.AB12CD.WmWs-ZvGRyS-', invite: null }, ...extra,
});
const storyBase = (extra = {}) => base({ quiz: { id: 'q', code: 'AB12CD', topic: 'The Brave Little Ant', lang: 'en', dir: 'ltr', n: 0, questions: [] },
  story: { id: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb', from_teacher: true, code: 'AB12CD' }, ...extra });
const withTeach = (p) => ({ ...p, art: { ...p.art, teach: TEACH, teach_v: '0a1b2c3d' } });

function req(srv, p, { ua = PHONE, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, headers: { host: 'portal.example', 'user-agent': ua, 'x-forwarded-proto': 'https' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

let srv; let answer; let calls;
async function boot(payload) {
  calls = [];
  answer = (url) => (url.indexOf('/art/') >= 0 ? pngRes() : jsonRes(200, payload));
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, logEvent: () => {}, fetchImpl: async (url) => { calls.push(url); return answer(url); }, canonicalBase: '' }));
  app.use((r, res) => res.status(418).send('fell through'));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => (srv ? new Promise((r) => srv.close(r)) : null));

const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(String(html)) || [])[1] || '').replace(/&amp;/g, '&') || undefined;

describe('both switches off: the page and its preview head are today\'s, byte for byte (goldens)', () => {
  test('class quiz and class story: full page, preview head, and the ?k= card link', async () => {
    const got = {};
    for (const [kind, payload] of [['quiz', base()], ['story', storyBase()]]) {
      await boot(payload);
      const page = await req(srv, '/q/AB12CD', { ua: PHONE });
      const head = await req(srv, '/q/AB12CD', { ua: WA });
      const card = await req(srv, `/q/AB12CD?k=${CARD_K}`, { ua: WA });
      got[kind] = {
        page: { status: page.status, body: page.body.toString('utf8').replace(/\?v=[0-9a-f]+/g, '?v=<asset>') },
        head: { status: head.status, body: head.body.toString('utf8').replace(/\?v=[0-9a-f]+/g, '?v=<asset>') },
        card: { status: card.status, image: meta(card.body, 'image'), type: meta(card.body, 'image:type') },
      };
      await new Promise((r) => srv.close(r));
      srv = null;
    }
    if (process.env.GOLDEN_WRITE === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    }
    expect(got).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });
});

describe('on: the class picture is the preview, after a child\'s card', () => {
  test('class story, both switches on: the preview head names the class picture, a PNG, with its version', async () => {
    await boot(withTeach(storyBase()));
    const res = await req(srv, '/q/AB12CD', { ua: WA });
    expect(meta(res.body, 'image')).toBe(`https://portal.example/q/AB12CD/art/teach.png?a=${TEACH}&v=0a1b2c3d`);
    expect(meta(res.body, 'image:type')).toBe('image/png');
    expect(meta(res.body, 'image:secure_url')).toBe(meta(res.body, 'image'));
    // the child's own page names it too
    const page = await req(srv, '/q/AB12CD', { ua: PHONE });
    expect(meta(page.body, 'image')).toBe(`https://portal.example/q/AB12CD/art/teach.png?a=${TEACH}&v=0a1b2c3d`);
  });

  test('class quiz: the same code with and without ?k= — the finish card keeps winning', async () => {
    await boot(withTeach(base()));
    const plain = await req(srv, '/q/AB12CD', { ua: WA });
    expect(meta(plain.body, 'image')).toMatch(/\/q\/AB12CD\/art\/teach\.png\?a=t\./);
    const card = await req(srv, `/q/AB12CD?k=${CARD_K}`, { ua: WA });
    expect(meta(card.body, 'image')).toBe(`https://portal.example/wq/card/${CARD_K}.png`);
    expect(meta(card.body, 'image:type')).toBe('image/png');
  });

  test('class story: with and without ?k= as well', async () => {
    await boot(withTeach(storyBase()));
    const card = await req(srv, `/q/AB12CD?k=${CARD_K}`, { ua: WA });
    expect(meta(card.body, 'image')).toBe(`https://portal.example/wq/card/${CARD_K}.png`);
    const plain = await req(srv, '/q/AB12CD', { ua: WA });
    expect(meta(plain.body, 'image')).toMatch(/\/art\/teach\.png/);
  });

  test('a child\'s own card share (?a=) still names the child\'s card; the class view and schools keep theirs', async () => {
    await boot(withTeach(base()));
    expect(meta((await req(srv, `/q/AB12CD?a=${CARD_A}`, { ua: WA })).body, 'image')).toMatch(/\/art\/card\.jpg\?a=c\./);
    expect(meta((await req(srv, '/q/AB12CD/class', { ua: WA })).body, 'image')).toMatch(/\/art\/class\.jpg\?a=l\./);
  });

  test('the teacher\'s reminder link (?v=<played>) keeps the live class picture, before the class link picture', async () => {
    await boot(withTeach(base()));
    const remind = await req(srv, '/q/AB12CD?v=3', { ua: WA });
    expect(meta(remind.body, 'image')).toBe('https://portal.example/q/AB12CD/art/class.jpg?a=l.AB12CD.v1bw_tRX32tq&v=3');
    // without ?v= the class link picture is still the preview
    expect(meta((await req(srv, '/q/AB12CD', { ua: WA })).body, 'image')).toMatch(/\/art\/teach\.png\?a=t\./);
  });

  test('a malformed class picture id or version names no class picture', async () => {
    await boot({ ...base(), art: { ...base().art, teach: 'l.AB12CD.v1bw_tRX32tq', teach_v: '0a1b2c3d' } });
    expect(meta((await req(srv, '/q/AB12CD', { ua: WA })).body, 'image')).not.toMatch(/teach/);
    await new Promise((r) => srv.close(r));
    await boot({ ...base(), art: { ...base().art, teach: TEACH, teach_v: 'nothex!!' } });
    expect(meta((await req(srv, '/q/AB12CD', { ua: WA })).body, 'image')).not.toMatch(/teach/);
  });
});

describe('the class picture\'s route: the share pictures\' own path, a PNG kept for good', () => {
  test('asked of the bot with the code it was opened under; immutable; the second GET and a HEAD never reach the bot', async () => {
    await boot(withTeach(base()));
    const p = `/q/AB12CD/art/teach.png?a=${TEACH}&v=0a1b2c3d`;
    const first = await req(srv, p, { ua: WA });
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toMatch(/^image\/png/);
    expect(first.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.compare(first.body, PNG)).toBe(0);
    expect(calls).toEqual([`${BOT}/api/internal/wq/art/${TEACH}?c=AB12CD`]);
    const head = await req(srv, p, { ua: WA, method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers['content-type']).toMatch(/^image\/png/);
    expect((await req(srv, p, { ua: WA })).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  test('another version of the picture is asked again (a new label or title draws anew)', async () => {
    await boot(withTeach(base()));
    await req(srv, `/q/AB12CD/art/teach.png?a=${TEACH}&v=0a1b2c3d`);
    await req(srv, `/q/AB12CD/art/teach.png?a=${TEACH}&v=99999999`);
    expect(calls).toHaveLength(2);
  });

  test('the kinds never stand in for each other: a class picture id under a jpg kind, or another id here, is 404', async () => {
    await boot(withTeach(base()));
    expect((await req(srv, `/q/AB12CD/art/class.jpg?a=${TEACH}`)).status).toBe(404);
    expect((await req(srv, `/q/AB12CD/art/teach.png?a=${CARD_A}`)).status).toBe(404);
    expect((await req(srv, '/q/AB12CD/art/teach.png?a=l.AB12CD.v1bw_tRX32tq')).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('the bot\'s refusal (switch off, a child\'s code) is the edge\'s 404, never kept', async () => {
    await boot(withTeach(base()));
    answer = () => jsonRes(404, { error: 'not_found' });
    const r = await req(srv, `/q/CH12CD/art/teach.png?a=${TEACH}&v=0a1b2c3d`);
    expect(r.status).toBe(404);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual([`${BOT}/api/internal/wq/art/${TEACH}?c=CH12CD`]);
  });
});

test('a .png share-picture path no kind owns goes on as before (not answered here)', async () => {
  await boot(base());
  expect((await req(srv, '/q/AB12CD/art/card.png?a=c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl')).status).toBe(418);
  expect(calls).toHaveLength(0);
});
