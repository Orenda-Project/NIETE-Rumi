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
function trail({ lang = 'en', data = {}, menu = {}, withFc = false, href = 'https://portal.example/c/tok' } = {}) {
  let screen = '';
  const listeners = {};
  const fetches = [];
  const events = [];
  // a button's class as the screen string carries it (the card restyles the host's Home)
  const classOf = (id) => { const m = new RegExp(`class="([^"]*)" id="${id}"`).exec(screen); return m ? m[1] : ''; };
  const el = (id) => ({ id, tagName: id === 'wqfc-share' || id === 'wqfc-next' ? 'A' : 'DIV', parentNode: { removeChild() { screen = screen.replace(/<p class="wq-sub" id="wqc-next">[^<]*<\/p>/, ''); } },
    get className() { return classOf(id); }, set className(v) { screen = screen.replace(`class="${classOf(id)}" id="${id}"`, `class="${v}" id="${id}"`); },
    addEventListener(n, fn) { (listeners[id] = listeners[id] || []).push(fn); }, setAttribute() {} });
  const ctx = {
    location: { origin: 'https://portal.example', hash: '', href }, navigator: {}, URL,
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
    // EVENTS_V3 §4's names (source, share_ok) beside today's (src, ok)
    expect(t.events).toContainEqual({ n: 'card_shown', src: 'read', ok: true, source: 'read', share_ok: true });
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
    expect(t.events).toContainEqual({ n: 'card_share', src: 'read', step: 'card_image', how: 'wa', source: 'read', kind: 'card_image', path: 'wa' });
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

/* ---------------- a card never certifies a read nobody heard (the zero-input chain) ---------------- */
describe('switch on: the zero-input chain — the outcome decides the card, not the line', () => {
  const TWELVE = { tokens: 'a b c d e f g h i j k l'.split(' ') };
  const on = (o = {}) => trail({ withFc: true, menu: { card_v3: true }, ...o, data: { story: TWELVE, ...(o.data || {}) } });
  const mintOf = (t) => JSON.parse(t.fetches.find((f) => f.url === '/api/wq/card').init.body);
  test.each([
    ['Done at 0 of 12', { score: { attempted: 0 } }, 0],
    ['Done at 1 of 12 (under a tenth)', { score: { attempted: 1 } }, 1],
    ['the live read heard nothing though the server counted words', { score: { attempted: 3 } }, 0],
    ['the read ended silent', { score: { attempted: 3 }, ended: 'silent' }, 3],
    ['the recording failed', { failed: true, score: { attempted: 5 } }, null],
  ])('%s: "Let\'s read it together", no sticker line, the try card', async (_, r, heard) => {
    const t = on();
    t.TR.readEnd(r, null, heard);
    const h = t.html();
    expect(h).toContain('Let&#39;s read it together');
    expect(h).not.toContain('wqc-sticker');
    expect(h).not.toMatch(/sticker went into/i);
    await flush();
    expect(mintOf(t)).toMatchObject({ kind: 'read', deed: 'read_tried' });
    // a card that certified nothing says so, so return-by-source can leave it out
    expect(t.events).toContainEqual(expect.objectContaining({ n: 'card_shown', source: 'read', tried: true }));
  });
  test('Urdu: «آئیں مل کر پڑھیں»', () => {
    const t = on({ lang: 'ur' });
    t.TR.readEnd({ score: { attempted: 0 } }, null, 0);
    expect(t.html()).toContain('آئیں مل کر پڑھیں');
    expect(t.html()).not.toContain('wqc-sticker');
  });
  test('2 of 12 (a tenth or more) still earns the sticker and "read some"', async () => {
    const t = on();
    t.TR.readEnd({ score: { attempted: 2 } }, null, 2);
    expect(t.html()).toContain('wqc-sticker');
    await flush();
    expect(mintOf(t).deed).toBe('read_some');
  });
  test('not scored yet (later): "Just wait a little" (never «نتیجہ»), no sticker, no Again, the try card', async () => {
    const t = on();
    t.TR.readEnd({ later: true });
    const h = t.html();
    expect(h).toContain('Just wait a little.');
    const u = on({ lang: 'ur' });
    u.TR.readEnd({ later: true });
    expect(u.html()).toContain('بس تھوڑا سا انتظار کریں۔');
    expect(u.html()).not.toContain('نتیجہ');
    expect(h).not.toContain('wqc-sticker');
    expect(h).not.toContain('wqc-again');
    await flush();
    expect(mintOf(t).deed).toBe('read_tried');
  });
  test('Story Time, nothing heard: the together card, no sticker, the try card', async () => {
    const t = on({ href: 'https://portal.example/c/tok?room=story&pid=p1', menu: { card_v3: true, v2: { story: true } }, data: { story_room: true } });
    // the room opens its story (h.open), then the story's read ends with no words heard
    t.TR.menu();
    t.TR.readEnd({ score: { attempted: 0 } }, null, 0);
    expect(t.html()).toContain('Let&#39;s read it together');
    expect(t.html()).not.toContain('wqc-sticker');
  });
  test('switch on: the host\'s Home is soft, so green is Share only', () => {
    const t = on();
    t.TR.readEnd({ score: { attempted: 12 } }, null, 12);
    expect(t.html()).toMatch(/class="wq-btn wq-soft" id="wqc-menu"/);
  });
});

/* ---------------- one card, three sources (the story reader's call) ---------------- */
describe('WQFC.mount({source}) — the result object the reader hands over', () => {
  function mountWith(o) {
    let out = '';
    const fetches = [];
    const fc = fcAlone({ fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ token: TOK, url: `/k/${TOK}`, img: `/wq/card/${TOK}.png`, ret: RET[o.lang || 'en'] })) }); },
      document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } } });
    const events = [];
    const ok = fc.mount({ insertAdjacentHTML: (pos, h) => { out += h; } }, { auth: { hub: 'H', kid: 'K' }, ev: (n, p) => events.push({ n, ...p }), ...o });
    return { ok, out, fetches, fc, events };
  }
  test('a story read: the deed counts pages in Urdu digits, the headline by `ended`, ONE sticker, the share', async () => {
    const m = mountWith({ source: 'story', ended: 'read', pages_read: 3, stars: 3, title: 'دھوپ', lang: 'ur' });
    expect(m.ok).toBe(true);
    expect(m.out).toContain('۳ صفحے پڑھے');
    expect(m.out).toContain('آپ نے جگنو کے ساتھ پڑھا!');
    expect((m.out.match(/data-sticker/g) || []).length).toBe(1);
    expect(m.out).toContain('id="wqfc-share"');
    expect(/data-n>([^<]*)</.exec(m.out)[1]).not.toMatch(/[0-9]/);
    await flush();
    expect(JSON.parse(m.fetches[0].init.body)).toEqual({ kind: 'book', deed: 'book_read', lang: 'ur', hub: 'H', kid: 'K' });
    expect(m.events).toContainEqual({ n: 'card_shown', src: 'book', ok: true, source: 'story', share_ok: true });
  });
  test('EN: one page reads "1 page read"; effort stars are never drawn as a count', () => {
    const m = mountWith({ source: 'story', ended: 'read', pages_read: 1, stars: 2, lang: 'en' });
    expect(m.out).toContain('1 page read');
    expect(m.out).not.toMatch(/⭐|★|stars?\b/);
  });
  test('listened only: "pages heard", the listening deed', async () => {
    const m = mountWith({ source: 'story', ended: 'listened', pages_read: 0, pages_listened: 2, lang: 'en' });
    expect(m.out).toContain('2 pages heard');
    expect(m.out).toContain('You listened with Jugnu!');
    await flush();
    expect(JSON.parse(m.fetches[0].init.body)).toMatchObject({ kind: 'book', deed: 'listen_done' });
  });
  test('zero input: "Let\'s read it together", no sticker, no count, the try card', async () => {
    const m = mountWith({ source: 'story', ended: 'read', pages_read: 0, lang: 'en' });
    expect(m.out).toContain('Let&#39;s read it together');
    expect(m.out).not.toContain('data-sticker');
    expect(m.out).not.toMatch(/pages? (read|heard)/);
    await flush();
    expect(JSON.parse(m.fetches[0].init.body).deed).toBe('read_tried');
  });
  test('the share text never carries the page count', () => {
    const m = mountWith({ source: 'story', ended: 'read', pages_read: 7, lang: 'en' });
    const href = /id="wqfc-share"[^>]*href="([^"]+)"/.exec(m.out)[1];
    expect(decodeURIComponent(href.replace(/&amp;/g, '&'))).not.toMatch(/7|page/);
  });
  test('numbers is WQFC\'s, from the source: the quiz keeps its own score, a read none, a story the count-up deed', () => {
    expect(FC.numbersFor('quiz')).toBe('score');
    expect(FC.numbersFor('read')).toBe('none');
    expect(FC.numbersFor('story')).toBe('deed');
    expect(FC.numbersFor('anything')).toBe('none');
  });
  test('the old {kind, deed} call still mounts', () => {
    expect(mountWith({ kind: 'game', deed: 'game_done', lang: 'en' }).ok).toBe(true);
  });
});

/* ---------------- the shared files keep guard lines only ---------------- */
describe('wq.js / wq-trail.js carry guard lines, the card lives in wq-finish-card.js', () => {
  const WQ_SRC = fs.readFileSync(path.join(WQ, 'wq.js'), 'utf8');
  test('today\'s "Share to class group" handler is untouched; the card\'s tap is its own guarded line', () => {
    expect(WQ_SRC).toContain("    on('#wq-share', function () { share(line, classUrl, 'card', art.card); });\n");
  });
  test('wq-trail.js: every card line is one guarded call into WQFC, no card function of its own', () => {
    expect(TRAIL_SRC).not.toMatch(/function finishCard/);
    const lines = TRAIL_SRC.split('\n').filter((l) => /WQFC/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.trim()).toMatch(/^if \(window\.WQFC/);
  });
  test('the stylesheet the story reader asks for is the card\'s own CSS', () => {
    expect(fs.readFileSync(path.join(WQ, 'wq-finish-card.css'), 'utf8')).toBe(FC.CSS);
  });
});

describe('golden: switch off, the Urdu Trail cards, Story Time\'s end and a held card are today\'s', () => {
  // Hashed from origin/sandbox ad10e50fc's wq-trail.js (this harness, these fixtures) before this change.
  const GOLD = { ur_read_all: '5fd11c96d988ff65', ur_read_zero: '4234b39a29b107b6', ur_listen: '60c9b1d21df7cb88', en_story_end: '343db7dd3b03ef46', ur_story_end: '5140be996c852a58', en_hold: 'a81be8ad568eaaeb', en_later: '85395ff3222f9033' };
  test('with the card script present and the switch off', () => {
    for (const withFc of [false, true]) {
      const got = {};
      let t = trail({ withFc, lang: 'ur' });
      t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
      got.ur_read_all = sha(t.html());
      t = trail({ withFc, lang: 'ur' });
      t.TR.readEnd({ score: { attempted: 0 } }, null, 0);
      got.ur_read_zero = sha(t.html());
      t = trail({ withFc, lang: 'ur', data: { ex: 'listen' } });
      t.TR.tapEnd('listen-result', {});
      got.ur_listen = sha(t.html());
      for (const lang of ['en', 'ur']) {
        t = trail({ withFc, lang, href: 'https://portal.example/c/tok?room=story&pid=p1', menu: { v2: { story: true } }, data: { story_room: true } });
        t.TR.menu();
        t.TR.readEnd({ score: { attempted: 3 } }, null, 3);
        expect(t.html()).toContain('id="wqc-sticker"');
        got[`${lang}_story_end`] = sha(t.html());
      }
      t = trail({ withFc });
      t.TR.readHold({ score: { attempted: 2 } }, null, 2);
      got.en_hold = sha(t.html());
      t = trail({ withFc });
      t.TR.readEnd({ later: true });
      got.en_later = sha(t.html());
      expect(t.fetches.length).toBe(0);
      expect(got).toEqual(GOLD);
    }
  });
});

describe('a card that certified nothing: the Next tile is the one primary, Share a soft secondary', () => {
  const NEXT = { kind: 'readalong', href: '/c/tok?kid=k1#along', title: 'Read along with Jugnu', minutes: 2, offer: 'o9' };
  test('the try card leads with the tile; the sticker card keeps Share first', () => {
    const tried = FC.html({ kind: 'read', deed: 'read_tried', lang: 'en', next: NEXT });
    expect((tried.match(/data-primary/g) || []).length).toBe(1);
    expect(tried).toMatch(/<a class="wqfc-next wqfc-lead" id="wqfc-next" data-primary data-tap="next"/);
    expect(tried).toMatch(/<a class="wq-btn wq-soft wqfc-share" id="wqfc-share" data-tap="card_share" target="_blank"/);
    expect(tried.indexOf('id="wqfc-next"')).toBeLessThan(tried.indexOf('id="wqfc-share"'));
    const won = FC.html({ kind: 'read', deed: 'read_all', lang: 'en', next: NEXT });
    expect(won.indexOf('id="wqfc-share"')).toBeLessThan(won.indexOf('id="wqfc-next"'));
    expect(won).toMatch(/class="wq-btn wq-go wqfc-share" id="wqfc-share" data-primary/);
  });
  test('no tile to lead with: Share stays the primary', () => {
    const h = FC.html({ kind: 'read', deed: 'read_tried', lang: 'en' });
    expect(h).toMatch(/class="wq-btn wq-go wqfc-share" id="wqfc-share" data-primary/);
  });
  test('the tile\'s slot events say it came after a try', () => {
    const events = [];
    const fc = fcAlone({ document: { getElementById: (id) => (id === 'wqfc-next' ? { addEventListener() {} } : null), createElement: () => ({}), head: { appendChild() {} } } });
    fc.mount({ insertAdjacentHTML() {} }, { kind: 'read', deed: 'read_tried', lang: 'en', next: NEXT, auth: { ct: 'c' }, ev: (n, p) => events.push({ n, ...p }) });
    expect(events).toContainEqual(expect.objectContaining({ n: 'next_shown', ctx: 'after_read_tried', offer: 'o9' }));
  });
});
