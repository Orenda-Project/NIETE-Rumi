/**
 * The finish card on the child's pages (wq-finish-card.js, window.WQFC; app_settings web_quiz_card_v3 via the
 * finish's / the menu's card_v3). One card after every finish: the deed first, ONE sticker (never a star count), a
 * share that never navigates the page (an <a target=_blank> to wa.me, or the picture as a file), the link on its own
 * line and the /quiz return line last, the Next tile, Home. Switch off: the quiz card, its share text and the Trail's
 * end cards are today's, byte for byte (goldens hashed from origin/sandbox before this change).
 * wq.js runs whole in the harness's vm; wq-trail.js runs with a small host of the page's helpers.
 */
// The server's copy is read from its module; its database and loggers are never reached here.
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const FC_SRC = fs.readFileSync(path.join(WQ, 'wq-finish-card.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(WQ, 'wq-trail.js'), 'utf8');
const SERVER = require('../../bot/shared/services/quiz/web-quiz-card-image');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const TOK = 'Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const RET = { en: { text: 'Play with Jugnu any day. Tap, then send:', words: 'quiz please', href: 'https://wa.me/15550001111?text=quiz%20please' },
  ur: { text: 'جب دل چاہے جگنو کے ساتھ کھیلیں! یہاں دبائیں، پھر بھیجیں:', words: 'کوئز دکھائیں', href: 'https://wa.me/15550001111?text=%DA%A9%D9%88%D8%A6%D8%B2%20%D8%AF%DA%A9%DA%BE%D8%A7%D8%A6%DB%8C%DA%BA' } };
// A child's screen never says these.
const BANNED = /\b(test|exam|assessment|practice|counted|challenge|trail|wpm)\b|امتحان|ٹیسٹ/i;

// WQFC alone, in a vm (its pure functions need no page).
function fcAlone(extra = {}) {
  const ctx = { window: {}, document: {}, location: { origin: 'https://portal.example' }, navigator: {}, ...extra };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FC_SRC, ctx);
  return ctx.WQFC;
}
const FC = fcAlone();

describe('the words: the server and the page say the same deed', () => {
  test('every deed, both languages, word for word', () => {
    expect(JSON.parse(JSON.stringify(FC.DEEDS.en))).toEqual(Object.fromEntries(Object.values(SERVER.DEEDS).flat().map((d) => [d, SERVER.COPY.en[d]])));
    expect(JSON.parse(JSON.stringify(FC.DEEDS.ur))).toEqual(Object.fromEntries(Object.values(SERVER.DEEDS).flat().map((d) => [d, SERVER.COPY.ur[d]])));
    expect(FC.W.en.words).toBe(SERVER.CARD_RETURN_WORDS.en);
    expect(FC.W.ur.words).toBe(SERVER.CARD_RETURN_WORDS.ur);
    expect(FC.W.ur.ret).toBe(SERVER.COPY.ur.ret);
  });
  test('no deed carries a digit or a test word; Urdu has no Latin middot', () => {
    for (const l of ['en', 'ur']) {
      for (const t of Object.values(FC.DEEDS[l])) {
        expect(t).not.toMatch(/[0-9۰-۹]/);
        expect(t).not.toMatch(BANNED);
        if (l === 'ur') expect(t).not.toContain('·');
      }
    }
  });
});

describe('the share text', () => {
  test.each(['en', 'ur'])('%s: deed first, the title, the link ALONE on its line, the return line last', (lang) => {
    const url = `https://portal.example/k/${TOK}`;
    const txt = FC.shareText({ lang, deed: 'read_all', title: 'The lost kite', url, ret: RET[lang] });
    const lines = txt.split('\n');
    expect(lines[0]).toBe(`⭐ ${FC.DEEDS[lang].read_all}`);
    expect(lines[1]).toContain('The lost kite');
    expect(lines[2]).toBe(url);
    expect(lines[3]).toBe(RET[lang].text);
    expect(lines[4]).toBe(RET[lang].href);
    expect(txt).not.toMatch(/\d+\s*\/\s*\d+/);
  });
  test('before the token is in (or with no bot number): the words and the return words, never a broken link', () => {
    const txt = FC.shareText({ lang: 'en', deed: 'game_done' });
    expect(txt.split('\n')).toEqual([`⭐ ${FC.DEEDS.en.game_done}`, RET.en.text, '“quiz please”']);
  });
});

describe('the card block, for every kind of finish', () => {
  const NEXT = { kind: 'storybook', id: 'b1', href: '/s/b1/1', title: 'Read a storybook', title_ur: 'کہانی کی کتاب پڑھیں', sub: 'Sunny Day', minutes: 2, art: '/wq/art/story-1.webp' };
  test.each([['quiz', 'quiz_done'], ['read', 'read_all'], ['game', 'game_done'], ['story', 'story_read'], ['listen', 'listen_done'], ['book', 'book_read'], ['video', 'video_watched']])('%s', (kind, deed) => {
    for (const lang of ['en', 'ur']) {
      const h = FC.html({ kind, deed, lang, next: NEXT, home: '/h/tok' });
      expect(h).toContain('data-screen="card"');
      // share = an anchor to wa.me in a new window, the primary
      expect(h).toMatch(/<a class="wq-btn wq-go wqfc-share" id="wqfc-share" data-primary data-tap="card_share" target="_blank" rel="noopener" href="https:\/\/wa\.me\/\?text=/);
      expect((h.match(/data-primary/g) || []).length).toBe(1);
      expect(h).toContain(lang === 'ur' ? 'کلاس کو بھیجیں' : '>Send to class<');
      expect(h).toContain('id="wqfc-next" data-tap="next" href="/s/b1/1"');
      expect(h).toContain(lang === 'ur' ? '۲ منٹ' : '2 min');
      expect(h).toContain('data-home');
      // never a star count on a card
      expect(h).not.toMatch(/⭐\s*[⭐x×\d]/);
      expect(decodeURIComponent(h.replace(/&amp;/g, '&'))).not.toMatch(BANNED);
    }
  });
  test('a sound switch on the card; the tile in the brand colour (green is Share only); no emoji', () => {
    const h = FC.html({ kind: 'read', deed: 'read_all', lang: 'en', next: { href: '/s/b1/1', title: 'Read a storybook' } });
    expect(h).toMatch(/<button class="wqfc-snd" id="wqfc-snd" type="button" data-tap="sound" aria-label="Sound" aria-pressed="false"><svg/);
    const css = /CSS = ([\s\S]*?);\n/.exec(FC_SRC)[1];
    expect(css).toMatch(/\.wqfc-next\{[^}]*border:2px solid var\(--brand-ink/);
    expect(/\.wqfc-next\{[^}]*\}/.exec(css)[0]).not.toMatch(/#15803D|#14532D/);
    // no emoji or pictograph code point in anything the card draws on the child's screen
    expect(h).not.toMatch(/[\u2190-\u2BFF\u{1F000}-\u{1FAFF}]/u);
  });
  test('the sound switch writes both keys the pages read (without the sound kit)', () => {
    const store = {};
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    const listeners = {};
    const btn = { setAttribute() {}, set innerHTML(v) { this.h = v; }, addEventListener: (n, fn) => { listeners.snd = fn; } };
    const fc = fcAlone({ localStorage: ls, document: { getElementById: (id) => (id === 'wqfc-snd' ? btn : null), createElement: () => ({}), head: { appendChild() {} } } });
    fc.mount({ insertAdjacentHTML() {} }, { kind: 'game', deed: 'game_done', lang: 'en', auth: { ct: 'c' } });
    listeners.snd();
    expect(store).toEqual({ wq_snd: '0', wq_sound: 'false' });
    listeners.snd();
    expect(store).toEqual({ wq_snd: '1', wq_sound: 'true' });
  });
  test('a Next object with no same-origin href draws no tile (today\'s next video has none)', () => {
    expect(FC.nextHtml('en', { vid: 'v', title: 'Water' })).toBe('');
    expect(FC.nextHtml('en', { href: 'https://evil.example', title: 'x' })).toBe('');
  });
});

/* ---------------- the teacher's quiz card (wq.js M10) ---------------- */
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, art: { card: CARD } };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result } });
const waText = (p) => { const m = /id="wq-wa" href="([^"]+)"/.exec(p.html()); return m ? decodeURIComponent(m[1].replace(/&amp;/g, '&').replace(/^https:\/\/wa\.me\/\?text=/, '')) : null; };
const MINT = { '/api/wq/card': { token: TOK, url: `/q/TEST?k=${TOK}`, img: `/wq/card/${TOK}.png`, ret: RET.en } };

describe('golden: switch off, the quiz card and its class share are today\'s', () => {
  // Hashed from origin/sandbox ad10e50fc (this harness, these fixtures) before this change.
  const GOLD = { en_html: '8a0a7b8e07da9f31', en_share: 'b731a541ab256d6d', ur_html: '58789e47df634ec6', ur_share: '0ad7fddbddad9a42' };
  test('EN and UR: the card\'s HTML and the shared text', () => {
    const got = {};
    for (const lang of ['en', 'ur']) {
      const p = page({ lang, store: store(RESULT) });
      got[`${lang}_html`] = sha(p.html());
      expect(p.fetches.some((f) => /wq-finish-card|\/api\/wq\/card/.test(f.url))).toBe(false);
      p.els['#wq-share'].fire('click');
      got[`${lang}_share`] = sha(waText(p));
    }
    expect(got).toEqual(GOLD);
  });
});

describe('switch on: the quiz card gains the deed and its class share becomes the card', () => {
  function onPage(lang, extra = {}) {
    const p = page({ lang, store: store({ ...RESULT, card_v3: true, ...extra }), api: MINT });
    vm.runInContext(FC_SRC, p.ctx);
    p.wq.card();
    return p;
  }
  test('without the file yet, the page asks for it (and draws the card again once it is in)', () => {
    const p = page({ lang: 'en', store: store({ ...RESULT, card_v3: true }) });
    expect(p.html()).not.toContain('wqfc-deed');
    expect(p.fetches.some((f) => /\/api\/wq\/card/.test(f.url))).toBe(false);
  });
  test('EN: the deed above the score (the score stays on the child\'s own screen)', () => {
    const h = onPage('en').html();
    expect(h).toContain('<p class="wqfc-deed" id="wqfc-deed">You finished the whole quiz!</p><div class="wq-big">3/5</div>');
  });
  test('UR: in Urdu', () => {
    expect(onPage('ur').html()).toContain('<p class="wqfc-deed" id="wqfc-deed">شاباش! آپ نے پورا کوئز کر لیا!</p>');
  });
  test('the token is asked for as the card opens, with the session token only', async () => {
    const p = onPage('en');
    await flush();
    const mint = p.fetches.find((f) => f.url === '/api/wq/card');
    expect(mint).toBeTruthy();
    expect(JSON.parse(mint.init.body)).toEqual({ kind: 'quiz', deed: 'quiz_done', lang: 'en', st: 's1' });
  });
  test('"Share to class group": deed + topic, the class link with the card, the return line — no score', async () => {
    const p = onPage('en');
    await flush(); await flush();
    p.els['#wq-share'].fire('click');
    const t = waText(p);
    expect(t.split('\n')).toEqual([`⭐ ${FC.DEEDS.en.quiz_done}`, '“⁨Plants⁩”', `https://example.test/q/TEST?k=${TOK}`, RET.en.text, RET.en.href]);
    expect(t).not.toMatch(/3\/5|stars|beat/);
  });
  test('the Next tile comes from the ranked next_offer, never from the chapter video under next', () => {
    const offer = { kind: 'storybook', href: '/s/b1/1', title: 'Read a storybook', minutes: 2, offer: 'o1', arm: 'rank' };
    const h = onPage('en', { next: { vid: 'v1', title: 'Water' }, next_offer: offer }).html();
    expect(h).toContain('id="wqfc-next" data-tap="next" href="/s/b1/1"');
    expect(onPage('en', { next: { vid: 'v1', title: 'Water', href: '/q/X' } }).html()).not.toContain('wqfc-next');
  });
  test('a friend\'s challenge run: no card (the challenge share is today\'s)', () => {
    const p = page({ lang: 'en', store: store({ ...RESULT, card_v3: true }), challenge: { code: 'CHAL12', first: 'Omar' } });
    vm.runInContext(FC_SRC, p.ctx);
    p.wq.card();
    expect(p.html()).not.toContain('wqfc-deed');
  });
  test('card_shown once per finish, however often the card is drawn', async () => {
    const p = onPage('en');
    p.wq.card(); p.wq.card();
    p.fireWin('pagehide');
    const evs = p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
    expect(evs.filter((e) => e.n === 'card_shown')).toEqual([expect.objectContaining({ n: 'card_shown', src: 'quiz', ok: true })]);
  });
});

/* ---------------- the Jugnu end cards (wq-trail.js) ---------------- */
// A small host: the page's helpers as wq-challenge.js hands them over, the screen as one HTML string.
function trail({ lang = 'en', data = {}, menu = {}, withFc = false } = {}) {
  let screen = '';
  const listeners = {};
  const fetches = [];
  const events = [];
  const el = (id) => ({ id, tagName: id === 'wqfc-share' || id === 'wqfc-next' ? 'A' : 'DIV', parentNode: { removeChild() { screen = screen.replace(/<p class="wq-sub" id="wqc-next">[^<]*<\/p>/, ''); } },
    addEventListener(n, fn) { (listeners[id] = listeners[id] || []).push(fn); }, setAttribute() {} });
  const ctx = {
    location: { origin: 'https://portal.example', hash: '' }, navigator: {},
    sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ token: TOK, url: `/k/${TOK}`, img: `/wq/card/${TOK}.png`, ret: RET[lang] })) }); },
    document: {
      getElementById: (id) => (screen.indexOf(`id="${id}"`) >= 0 ? el(id) : null),
      querySelector: (sel) => (sel === '#wq .wq-stack' && screen.indexOf('<div class="wq-stack">') >= 0
        ? { insertAdjacentHTML: (pos, h) => { screen = screen.replace('<div class="wq-stack">', `${h}<div class="wq-stack">`); } } : null),
      createElement: () => ({ setAttribute() {} }), head: { appendChild() {} },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (withFc) vm.runInContext(FC_SRC, ctx);
  vm.runInContext(TRAIL_SRC, ctx);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { data: { ct: 'CT1', ex: 'read', story: { tokens: ['a', 'b', 'c', 'd'] }, title: { en: 'The lost kite', ur: 'کھوئی ہوئی پتنگ' }, ...data } };
  const h = {
    L: lang, t: { again: 'Again', later: 'Later', listening: 'Listening' }, tc: (k) => k, boot: { kid: 'k1', token: 'tok' }, S, esc,
    on: () => {}, q: () => null, show: (name, html) => { S.screen = name; screen = html; }, jug: (pose, line) => `<p class="wq-say">${esc(line)}</p>`,
    ev: (n, p) => events.push({ n, ...p }), open() {}, refreshMenu() {}, md: () => menu, read() {}, backLabel: () => '', qa: () => ({ open() {} }), qaButtons: () => '<button id="wqc-qa">Q</button>',
  };
  const TR = ctx.WQTRAIL.init(h);
  return { TR, html: () => screen, fetches, events, tap: (id) => (listeners[id] || []).forEach((fn) => fn({ preventDefault() {} })) };
}

describe('golden: switch off, the Trail end cards are today\'s', () => {
  const GOLD = { read_all: 'c247689a7b897e57', read_zero: 'cd1049d1491e4362', listen: '9c71f1b63448d47e' };
  test('read all / read none / listen, with the card script even present', () => {
    for (const withFc of [false, true]) {
      const got = {};
      let t = trail({ withFc });
      t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
      got.read_all = sha(t.html());
      t = trail({ withFc });
      t.TR.readEnd({ score: { attempted: 0 } }, null, 0);
      got.read_zero = sha(t.html());
      t = trail({ withFc, data: { ex: 'listen' } });
      t.TR.tapEnd('listen-result', {});
      got.listen = sha(t.html());
      t = trail({ withFc, data: { ex: 'listen' } });
      t.TR.tapEnd('listen-result', {});
      expect(t.fetches.length).toBe(0);
      expect(got).toEqual(GOLD);
    }
  });
});

describe('switch on: every Trail finish gets the card', () => {
  const on = (o = {}) => trail({ withFc: true, menu: { card_v3: true }, ...o });
  test('a read: Send to class sits above the card\'s own buttons; the deed matches the line', async () => {
    const t = on();
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    const h = t.html();
    expect(h.indexOf('id="wqfc-share"')).toBeGreaterThan(h.indexOf('You read the whole story!'));
    expect(h.indexOf('id="wqfc-share"')).toBeLessThan(h.indexOf('<div class="wq-stack">'));
    await flush();
    expect(JSON.parse(t.fetches[0].init.body)).toEqual({ kind: 'read', deed: 'read_all', lang: 'en', ct: 'CT1' });
    expect(t.events).toContainEqual({ n: 'card_shown', src: 'read', ok: true });
  });
  test.each([
    [{ score: { attempted: 1 } }, 1, 'read_some'],
    [{ score: { attempted: 0 } }, 0, 'read_tried'],
  ])('read %#: deed %s', async (r, heard, deed) => {
    const t = on();
    t.TR.readEnd(r, null, heard);
    await flush();
    expect(JSON.parse(t.fetches[0].init.body).deed).toBe(deed);
  });
  test('a listening story and a numbers game', async () => {
    let t = on({ data: { ex: 'listen' } });
    t.TR.tapEnd('listen-result', {});
    await flush();
    expect(JSON.parse(t.fetches[0].init.body)).toMatchObject({ kind: 'listen', deed: 'listen_done' });
    t = on({ data: { ex: 'bigger' } });
    t.TR.tapEnd('bigger-result', {});
    await flush();
    expect(JSON.parse(t.fetches[0].init.body)).toMatchObject({ kind: 'game', deed: 'game_done' });
  });
  test('the share opens wa.me with the link and the return line; the Next tile replaces the plain Next line', async () => {
    const NEXT = { kind: 'story', href: '/c/tok?kid=k1#read', title: 'Read a story with Jugnu', minutes: 2 };
    const t = on({ data: { next_offer: NEXT } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expect(t.html()).toContain('id="wqfc-next"');
    expect(t.html()).not.toContain('id="wqc-next"');
    await flush(); await flush();
    t.tap('wqfc-share');
    expect(t.events).toContainEqual({ n: 'card_share', src: 'read', step: 'card_image', how: 'wa' });
    // the picture is asked for on the tap, so the sender's preview finds it drawn
    expect(t.fetches.map((f) => f.url)).toContain(`/wq/card/${TOK}.png`);
  });
  test('Urdu', () => {
    const t = on({ lang: 'ur' });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expect(t.html()).toContain('کلاس کو بھیجیں');
    expect(t.html()).toContain('dir="rtl"');
  });
  test('never on a practice round or a class round turn', () => {
    for (const data of [{ practice_round: true }, { round_turn: true, round_handback: 'Back' }]) {
      const t = on({ data });
      t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
      expect(t.html()).not.toContain('wqfc');
    }
  });
});
