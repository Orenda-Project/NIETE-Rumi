/**
 * A cut-short or junk link on the door, join and teacher pages (app_settings quiz_cut_link_page, default OFF).
 *
 * Today a token that does not parse falls through every edge router to the portal's own page. With the switch ON the
 * same request gets the expired page a tampered token already gets — the door's two-language "go.stale" page, the
 * join's "expired" note, the teacher's "mk.stale" page — each with its one "Open WhatsApp" tap, status 410, and no bot
 * call. A token that parses is never touched (valid or tampered: the bot decides, as today). /m and /f stay as they
 * are. OFF: every probe gets the portal's shell, bytes and headers equal to the golden recorded before the switch.
 *
 * The routers are mounted in the portal's own order (routes/edge-mounts.js) in front of the portal's catch-all
 * (cut-link-off-harness.js); the bot is a fake fetch that counts calls.
 */
const GoPage = require('../../bot/shared/services/first-touch/go.page');
const { buildMessagePage } = require('../../bot/shared/services/first-touch/maker.page');
const { str } = require('../../bot/shared/services/first-touch/teacher-home.strings');
const { isQuizMenuRequest } = require('../../bot/shared/services/quiz/quiz-menu-request');
const { renderJoinNote } = require('../routes/quiz-join.routes');
const CutLink = require('../routes/cut-link-page');
const H = require('./cut-link-off-harness');
const GOLDEN = require('./fixtures/cut-link-page-off.golden.json');

const { WA_BOT, BOT, SIG, GO_TOK, CUT } = H;
const JOIN_TOK = `eyJrIjoiam9pbiIsIm4iOjF9.${SIG}`;
const TH_TOK = `eyJrIjoidGgiLCJuIjoxfQ.${SIG}`;
const TAMPERED = `eyJrIjoiZ28iLCJuIjoxfQ.${'B'.repeat(22)}`;

let b;
const saved = {};
beforeAll(() => {
  ['WHATSAPP_BOT_NUMBER', 'REFERRAL_BOT_NUMBER', 'MAIN_BOT_URL', 'INTERNAL_API_KEY'].forEach((k) => { saved[k] = process.env[k]; });
  process.env.WHATSAPP_BOT_NUMBER = WA_BOT;
  process.env.MAIN_BOT_URL = BOT;
  process.env.INTERNAL_API_KEY = H.KEY;
});
afterAll(() => Object.entries(saved).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));
afterEach(async () => { if (b) await b.close(); b = null; });

/** The portal's edge block, in its own order, with `cutLinkOn` handed to every router; the portal's shell behind it. */
async function boot(cutLinkOn) { b = await H.boot({ cutLinkOn }); return b; }
const get = (p, headers) => H.get(b.srv, p, headers);

/** A settings client whose app_settings read answers `rows` (or throws), counting reads and keeping the keys asked. */
function settings(rows) {
  const seen = { reads: 0, asked: [] };
  const db = () => ({ from: (t) => ({ select: (cols) => ({ in: async (k, keys) => {
    seen.reads += 1;
    seen.asked.push([t, cols, k, keys]);
    if (rows instanceof Error) throw rows;
    return rows;
  } }) }) });
  return { db, seen };
}
async function flagWith(rows) {
  const s = settings(rows);
  const on = CutLink.createCutLinkFlag({ db: s.db, now: () => 0 });
  on();
  await on.ready();
  return on;
}
const cutRow = (value) => ({ data: [{ key: 'quiz_cut_link_page', value }], error: null });

const ON = () => true;
const OFF = () => false;

// no test word on a page a child or teacher sees
const TEST_WORDS = /\b(test|tests|testing|testwala|fixture|mock|dummy|stub|lorem)\b/i;
/** The page's one WhatsApp tap. */
const waHrefs = (html) => [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
/** The tap holds the words the bot answers (a quiz request), and nothing of the link the child opened. */
function expectTap(html, junk) {
  const hrefs = waHrefs(html);
  expect(hrefs).toEqual([`https://wa.me/${WA_BOT}?text=quiz`]);
  const words = new URL(hrefs[0]).searchParams.get('text');
  expect(isQuizMenuRequest(words)).toBe(true);
  expect(hrefs[0]).not.toContain(junk);
  expect(hrefs[0]).not.toContain('eyJ');
}

describe('switch OFF: every probe gets the portal\'s shell, bytes and headers equal to the golden recorded before the switch', () => {
  test('the golden: every probe the same shell (recorded on the product files before the switch)', () => {
    expect(Object.keys(GOLDEN)).toEqual([...H.OFF_PROBES]);
    expect(new Set(Object.values(GOLDEN).map((r) => r.sha256)).size).toBe(1);
  });
  test.each(H.OFF_PROBES)('%s (the switch answering false)', async (p) => {
    await boot(OFF);
    expect(H.row(await get(p))).toEqual(GOLDEN[p]);
    expect(b.calls).toEqual([]);
  });
});

describe('switch ON: the door, the join and the teacher home answer a token that does not parse with their expired page', () => {
  const goPage = () => GoPage.buildMessagePage({ id: 'go.stale', lang: 'bi', bot: WA_BOT });

  test.each([
    ['junk', 'abc'],
    ['a real token cut before its "."', CUT],
    ['a signature cut short', GO_TOK.slice(0, -3)],
    ['a trailing full stop from the message', `${GO_TOK}.`],
  ])('the door, %s → the two-language expired page with its one tap, 410, no bot call', async (_, junk) => {
    await boot(ON);
    const r = await get(`/quiz/go/${junk}`);
    expect(r.status).toBe(410);
    expect(r.body).toBe(goPage().html);
    expect(r.headers['content-security-policy']).toBe(goPage().csp);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.body).not.toContain(junk);
    expect(r.body).not.toMatch(TEST_WORDS);
    expectTap(r.body, junk);
    expect(b.calls).toEqual([]);
  });

  test.each([
    ['en', {}, 'abc'],
    ['ur', { 'accept-language': 'ur-PK,ur;q=0.9' }, 'abc'],
    ['en', {}, CUT],
  ])('the join, junk (%s phone) → the join\'s own expired note with its one tap, 410, no bot call', async (lang, headers, junk) => {
    await boot(ON);
    const r = await get(`/quiz/join/${junk}`, headers);
    expect(r.status).toBe(410);
    expect(r.body).toBe(renderJoinNote({ lang, kind: 'stale', bot: WA_BOT }));
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).not.toContain(junk);
    expect(r.body).not.toMatch(TEST_WORDS);
    expectTap(r.body, junk);
    expect(b.calls).toEqual([]);
  });

  test.each([
    ['/quiz/teacher/abc', 'en', {}, 'abc'],
    [`/quiz/teacher/${TH_TOK.slice(0, 12)}`, 'en', {}, TH_TOK.slice(0, 12)],
    ['/quiz/teacher/abc', 'ur', { 'accept-language': 'ur' }, 'abc'],
    ['/quiz/teacher/abc/stories', 'en', {}, 'abc'],
    ['/quiz/teacher/abc/send', 'en', {}, 'abc'],
  ])('the teacher home %s (%s) → the teacher\'s expired words with its one tap, 410, no bot call', async (p, lang, headers, junk) => {
    await boot(ON);
    const r = await get(p, headers);
    const built = buildMessagePage({ lang, id: 'mk.stale', tap: { href: `https://wa.me/${WA_BOT}?text=quiz`, text: str('th.open.wa', lang) } });
    expect(r.status).toBe(410);
    expect(r.body).toBe(built.html);
    expect(r.headers['content-security-policy']).toBe(built.csp);
    expect(r.body).not.toContain(junk);
    expect(r.body).not.toMatch(TEST_WORDS);
    expectTap(r.body, junk);
    expect(b.calls).toEqual([]);
  });

  test.each(['/m/abc', '/f/abc'])('%s stays with its owner (the portal\'s shell, as today)', async (p) => {
    await boot(ON);
    expect(H.row(await get(p))).toEqual(GOLDEN[p]);
  });
});

describe('switch ON: a token that parses is the bot\'s, exactly as today', () => {
  test.each([
    ['a valid door token', `/quiz/go/${GO_TOK}`, `/api/internal/go/land/${GO_TOK}`],
    ['a tampered door signature', `/quiz/go/${TAMPERED}`, `/api/internal/go/land/${TAMPERED}`],
    ['a valid teacher token', `/quiz/teacher/${TH_TOK}`, `/api/internal/th/quiz/teacher/${TH_TOK}`],
  ])('%s → forwarded, the bot\'s page passes', async (_, p, botPath) => {
    for (const sw of [ON, OFF]) {
      await boot(sw);
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(r.body).toContain('data-screen="bot"');
      expect(b.calls.map((u) => u.replace(BOT, '').split('?')[0])).toEqual([botPath]);
      await b.close();
      b = null;
    }
  });
  test('a valid join token → forwarded, the join page is drawn', async () => {
    await boot(ON);
    const r = await get(`/quiz/join/${JOIN_TOK}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain('data-screen=');
    expect(b.calls.map((u) => u.replace(BOT, ''))).toEqual([`/api/internal/wq/join/page/${JOIN_TOK}`]);
  });
});

describe('the switch is asked only on the junk path, with one cached read', () => {
  test('a token that parses never asks the switch', async () => {
    const asked = jest.fn(() => true);
    await boot(asked);
    await get(`/quiz/go/${GO_TOK}`);
    await get(`/quiz/teacher/${TH_TOK}`);
    await get(`/quiz/join/${JOIN_TOK}`);
    expect(asked).not.toHaveBeenCalled();
  });

  test('60 junk requests on three routers → ONE settings read of both keys, 0 bot calls, no token text logged', async () => {
    const s = settings(cutRow(true));
    const on = CutLink.createCutLinkFlag({ db: s.db, now: () => 1000 });
    await boot(on);   // a cold reader: the first junk request waits for the one read
    const spies = ['log', 'info', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    try {
      for (let i = 0; i < 20; i += 1) {
        expect((await get(`/quiz/go/cutlinkjunk${i}`)).status).toBe(410);
        expect((await get(`/quiz/join/cutlinkjunk${i}`)).status).toBe(410);
        expect((await get(`/quiz/teacher/cutlinkjunk${i}`)).status).toBe(410);
      }
      const printed = spies.flatMap((sp) => sp.mock.calls.map((c) => c.map(String).join(' ')));
      expect([...printed, ...b.logged].filter((l) => l.includes('cutlinkjunk'))).toEqual([]);
    } finally { spies.forEach((sp) => sp.mockRestore()); }
    expect(s.seen.reads).toBe(1);
    expect(s.seen.asked).toEqual([['app_settings', 'key, value', 'key', ['quiz_cut_link_page', 'web_quiz_adventure_look']]]);
    expect(b.calls).toEqual([]);
  });

  test('the cache: one read per 30 s, a new read after', async () => {
    let t = 0;
    const s = settings(cutRow(true));
    const on = CutLink.createCutLinkFlag({ db: s.db, now: () => t });
    on(); await on.ready();
    t = 29999; expect(on()).toBe(true); await on.ready();
    expect(s.seen.reads).toBe(1);
    t = 30000; on(); await on.ready();
    expect(s.seen.reads).toBe(2);
  });

  test('a read that never lands → the junk link gets today\'s shell after the short wait (never hangs)', async () => {
    const on = CutLink.createCutLinkFlag({ db: () => ({ from: () => ({ select: () => ({ in: () => new Promise(() => {}) }) }) }) });
    await boot(on);
    expect(H.row(await get('/quiz/go/abc'))).toEqual(GOLDEN['/quiz/go/abc']);
  });
});

describe('the adventure key rides the same read and changes nothing here', () => {
  test.each([
    ['present and true', true],
    ['present, the string', 'true'],
    ['absent', undefined],
  ])('the adventure key %s, the cut switch ON → the same bytes as the cut switch alone', async (_, adv) => {
    const rows = [{ key: 'quiz_cut_link_page', value: true }];
    if (adv !== undefined) rows.push({ key: 'web_quiz_adventure_look', value: adv });
    const on = await flagWith({ data: rows, error: null });
    expect(on.adv()).toBe(adv === true);
    await boot(on);
    const r = await get(`/quiz/go/${CUT}`);
    expect(r.status).toBe(410);
    expect(r.body).toBe(GoPage.buildMessagePage({ id: 'go.stale', lang: 'bi', bot: WA_BOT }).html);
    const j = await get('/quiz/join/abc');
    expect(j.body).toBe(renderJoinNote({ lang: 'en', kind: 'stale', bot: WA_BOT }));
  });
  test('the adventure key true, the cut switch absent → OFF (the portal\'s shell, the golden)', async () => {
    const on = await flagWith({ data: [{ key: 'web_quiz_adventure_look', value: true }], error: null });
    await boot(on);
    for (const p of H.OFF_PROBES) expect(H.row(await get(p))).toEqual(GOLDEN[p]);
  });
});

describe('the switch: only the JSON boolean true', () => {
  test('true → ON: the cut door link gets the expired page', async () => {
    const on = await flagWith(cutRow(true));
    await boot(on);
    expect((await get(`/quiz/go/${CUT}`)).status).toBe(410);
  });
  test.each([
    ['the string true', cutRow('true')],
    ['the quoted string', cutRow('"true"')],
    ['1', cutRow(1)],
    ['{}', cutRow({})],
    ['false', cutRow(false)],
    ['no row', { data: [], error: null }],
    ['no data', { data: null, error: null }],
    ['a read error', { data: null, error: { message: 'x' } }],
    ['a thrown read', new Error('down')],
  ])('%s → OFF: every probe gets the golden bytes and headers', async (_, rows) => {
    const on = await flagWith(rows);
    expect(on()).toBe(false);
    await boot(on);
    for (const p of H.OFF_PROBES) expect(H.row(await get(p))).toEqual(GOLDEN[p]);
  });
  test('no database client → OFF', async () => {
    const on = CutLink.createCutLinkFlag({ db: () => null });
    on(); await on.ready();
    expect(on()).toBe(false);
  });
  test('a switch reader that throws → OFF (the golden)', async () => {
    await boot(() => { throw new Error('boom'); });
    for (const p of H.OFF_PROBES) expect(H.row(await get(p))).toEqual(GOLDEN[p]);
  });
});
