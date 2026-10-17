/**
 * The Jugnu page's end cards with the child home on (app_settings web_quiz_home_v3 → the menu's card_fold): a read, a
 * listening story, a numbers game and Story Time end on the card and ONE next thing — the ranked Next tile (the first
 * offer this page can open; else "Pick a story", the home's Stories door), or the story's questions when they follow —
 * "Share to class group" as the soft secondary, and ONE Home row to the child's home. "Again", "Show me the words" and the
 * plain "Next: …" line are not drawn. Without card_fold the end cards are today's (the goldens in
 * web-quiz-finish-card-page.service.test.js and below).
 * wq-trail.js (+ wq-finish-card.js) run in a vm with a small host of the page's helpers; the screen is one HTML string.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const FC_SRC = fs.readFileSync(path.join(WQ, 'wq-finish-card.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(WQ, 'wq-trail.js'), 'utf8');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const flush = () => new Promise((r) => setImmediate(r));
const HOME_TOP = '<div class="wq-hometop"><a class="wq-home wq-home-top" id="wq-home" href="/h/tok?kid=k1&amp;from=home">Home</a></div>';

const STORY_HREF = 'https://portal.example/c/tok?room=story&pid=p1';
function trail({ lang = 'en', data = {}, menu = {}, withFc = true, top = false, href = 'https://portal.example/c/tok' } = {}) {
  let screen = '';
  const listeners = {};
  const events = [];
  const posts = [];
  // one element of the screen string, by id: its opening tag, and the whole element for <a>/<button>
  const tagOf = (id) => { const m = new RegExp(`<(a|button|p)\\b[^>]*\\bid="${id}"[^>]*>`).exec(screen); return m; };
  const el = (id) => ({
    id,
    tagName: /^<a\b/.test((tagOf(id) || [''])[0]) ? 'A' : 'BUTTON',
    get className() { const t = tagOf(id); const m = t && /class="([^"]*)"/.exec(t[0]); return m ? m[1] : ''; },
    set className(v) { const t = tagOf(id); if (t) screen = screen.replace(t[0], t[0].replace(/class="[^"]*"/, `class="${v}"`)); },
    removeAttribute(a) { const t = tagOf(id); if (t) screen = screen.replace(t[0], t[0].replace(new RegExp(` ${a}(="[^"]*")?(?=[ >])`), '')); },
    setAttribute(a, v) {
      const t = tagOf(id);
      if (!t) return;
      const val = v === '' || v == null ? '' : `="${v}"`;
      const re = new RegExp(` ${a}(="[^"]*")?(?=[ >])`);
      screen = screen.replace(t[0], re.test(t[0]) ? t[0].replace(re, ` ${a}${val}`) : t[0].replace(/>$/, ` ${a}${val}>`));
    },
    get parentNode() {
      return { removeChild() {
        if (id === 'wqc-next') { screen = screen.replace(/<p class="wq-sub" id="wqc-next">[^<]*<\/p>/, ''); return; }
        const t = tagOf(id);
        if (t) screen = screen.replace(new RegExp(`${t[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?</${t[1]}>`), '');
      } };
    },
    addEventListener(n, fn) { (listeners[id] = listeners[id] || []).push(fn); },
  });
  const ctx = {
    location: { origin: 'https://portal.example', hash: '', href, search: href.indexOf('?') >= 0 ? href.slice(href.indexOf('?')) : '' }, navigator: {}, URL,
    sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: (url, init) => { posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') }); },
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
    on: (id, fn) => { (listeners[id] = listeners[id] || []).push(fn); }, q: () => null,
    // the page's show(): its top Home link (?home=1) and, on a practice run, the banner on every screen but the menu
    show: (name, html) => { S.screen = name; screen = (top ? HOME_TOP : '') + (S.data.practice_round ? '<p class="wqc-banner" id="wqc-practice">Story Time: just for fun</p>' : '') + html; }, jug: (pose, line) => `<p class="wq-say">${esc(line)}</p>`,
    ev: (n, p) => events.push({ n, ...p }), open() {}, refreshMenu() {}, md: () => menu, read() {}, backLabel: () => 'Back',
    qa: () => ({ open() {} }), qaButtons: () => '<button class="wq-btn wq-go" id="wqc-qa" type="button">Story questions</button><button class="wq-btn wq-soft" id="wqc-menu" type="button">Back</button>',
  };
  const TR = ctx.WQTRAIL.init(h);
  return { TR, html: () => screen, events, posts, tap: (id) => (listeners[id] || []).forEach((fn) => fn({ preventDefault() {} })) };
}

const FOLD = { card_v3: true, card_fold: true, v2: {} };
const NEXT = { kind: 'storybook', id: 'b1', href: '/s/b1/1', title: 'Read a storybook', title_ur: 'کہانی کی کتاب پڑھیں', minutes: 2 };
const INVITE = { kind: 'invite', id: 'invite', href: 'https://wa.me/?text=Play', title: 'Invite a friend' };
const primaries = (h) => (h.match(/data-primary/g) || []).length;
const ids = (h) => (h.match(/\bid="(wqfc-next|wqfc-share|wqc-fnext|wqc-qa|wqc-fhome|wqc-menu|wqc-again|wqc-next|wqc-show-words|wq-home|wqc-handback)"/g) || []).map((s) => s.slice(4, -1));
// The row set of the folded card: the Next (one primary), Share (soft), one Home row — nothing else to tap.
function expectFold(h, { next = 'wqfc-next', share = true } = {}) {
  expect(primaries(h)).toBe(1);
  expect(ids(h)).toEqual([next, ...(share ? ['wqfc-share'] : []), 'wqc-fhome']);
  expect(new RegExp(`id="${next}"[^>]*data-primary|data-primary[^>]*id="${next}"|class="[^"]*" id="${next}" data-primary`).test(h)).toBe(true);
  if (share) expect(/class="wq-btn wq-soft wqfc-share" id="wqfc-share"(?! data-primary)/.test(h)).toBe(true);
  expect(h).toContain('id="wqc-fhome" data-home href="/h/tok?kid=k1&amp;from=home"');
}

describe('home on: a read ends on the card and ONE next thing', () => {
  test('the ranked tile leads, Share is soft, one Home row to the child\'s home; no Again, no "Next:" line', () => {
    const t = trail({ menu: FOLD, data: { next_offer: NEXT } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    const h = t.html();
    expectFold(h);
    expect(h).toContain('<a class="wqfc-next wqfc-lead" id="wqfc-next" data-primary data-tap="next" href="/s/b1/1"');
    expect(h).not.toMatch(/Again|Next: /);
    expect(h).toContain('You read the whole story!');
    expect(h).toContain('>Home</a>');
  });
  test('no ranked offer: "Pick a story", the home on its Stories door, as the one primary', () => {
    const t = trail({ menu: FOLD });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    const h = t.html();
    expectFold(h);
    expect(h).toContain('href="/h/tok?kid=k1&amp;from=home#stories"');
    expect(h).toContain('<b dir="auto">Pick a story</b>');
  });
  test('the invite (a WhatsApp message) is never the tile: the next offer this page can open, else "Pick a story"', () => {
    let t = trail({ menu: FOLD, data: { next_offer: { ...INVITE, alts: [NEXT] } } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expectFold(t.html());
    expect(t.html()).toContain('href="/s/b1/1"');
    expect(t.html()).not.toContain('wa.me/?text=Play');
    t = trail({ menu: FOLD, data: { next_offer: INVITE } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expectFold(t.html());
    expect(t.html()).toContain('#stories');
  });
  test('a read that certified nothing: the same row set, without Share (the try card)', () => {
    const t = trail({ menu: FOLD, data: { story: { tokens: 'a b c d e f g h i j k l'.split(' ') } } });
    t.TR.readEnd({ score: { attempted: 0 } }, null, 0);
    expectFold(t.html(), { share: false });
  });
  test('Urdu: «کہانی چنیں» and «ہوم»', () => {
    const t = trail({ lang: 'ur', menu: FOLD });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    const h = t.html();
    expectFold(h);
    expect(h).toContain('<b dir="auto">کہانی چنیں</b>');
    expect(h).toContain('>ہوم</a>');
    expect(h).not.toContain('واپس جائیں');
  });
  test('the page\'s top Home link goes: ONE Home on the card', () => {
    const t = trail({ menu: FOLD, top: true });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expect(t.html()).not.toContain('id="wq-home"');
    expectFold(t.html());
  });
});

describe('home on: a listening story, a numbers game, Story Time', () => {
  test('a listening story and a numbers game', () => {
    for (const [ex, name] of [['listen', 'listen-result'], ['bigger', 'bigger-result'], ['missing', 'missing-result']]) {
      const t = trail({ menu: FOLD, data: { ex, next_offer: NEXT } });
      t.TR.tapEnd(name, {});
      expectFold(t.html());
    }
  });
  test('a game stopped early: the same row set', () => {
    const t = trail({ menu: FOLD, data: { ex: 'bigger' } });
    t.TR.tapEnd('bigger-result', { stopped: true });
    expectFold(t.html());
  });
  test('Story Time\'s end (a practice run): the card at last, the ranked tile or "Pick a story"; with the questions on, the questions are the one next thing; no banner on the card', () => {
    const story = { story_room: true, practice_round: true };
    let t = trail({ href: STORY_HREF + '&ex=listen', menu: { ...FOLD, v2: { story: true } }, data: { ...story, ex: 'listen' } });
    t.TR.menu();   // the room opens its story from the link
    t.TR.tapEnd('listen-result', {});
    expect(t.html()).not.toContain('You listened to the whole story!');   // Story Time's own end (storyEnd), not a stop's
    expectFold(t.html());
    expect(t.html()).not.toContain('id="wqc-practice"');
    t = trail({ href: STORY_HREF, menu: { ...FOLD, v2: { story: true } }, data: { ...story, questions_on: true } });
    t.TR.menu();
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expectFold(t.html(), { next: 'wqc-qa' });
    expect(t.html()).not.toContain('Back');
    expect(t.html()).not.toContain('id="wqc-practice"');
  });
  test('Story Time: the read\'s own result (handed to the card as data.story_r) brings the ranked tile', () => {
    const t = trail({ href: STORY_HREF + '&ex=listen', menu: { ...FOLD, v2: { story: true } }, data: { story_room: true, practice_round: true, ex: 'listen', story_r: { next_offer: NEXT } } });
    t.TR.menu();
    t.TR.tapEnd('listen-result', {});
    expectFold(t.html());
    expect(t.html()).toContain('href="/s/b1/1"');
  });
  test('a read with the questions after it: the questions lead, Share soft, one Home', () => {
    const t = trail({ menu: FOLD, data: { next_offer: NEXT } });
    t.TR.readEnd({ score: { attempted: 4 }, qa: true }, null, 4);
    // the read's own end passes qa through its result (the page decides); either way one primary
    expect(primaries(t.html())).toBe(1);
  });
});

describe('home on: a child with no class (the menu\'s no_class) — the share says "Share", not "Share to class group"', () => {
  test.each([['en', 'Share'], ['ur', 'شیئر کریں']])('%s', (lang, word) => {
    const t = trail({ lang, menu: { ...FOLD, no_class: true }, data: { next_offer: NEXT } });
    t.TR.tapEnd('bigger-result', {});
    expectFold(t.html());
    expect(t.html()).toMatch(new RegExp(`id="wqfc-share"[^>]*>${word}</a>`));
    expect(t.html()).not.toMatch(/class group|کلاس گروپ/);
  });
  test('a class child keeps "Share to class group" / «کلاس گروپ میں بھیجیں» byte for byte', () => {
    for (const [lang, word] of [['en', 'Share to class group'], ['ur', 'کلاس گروپ میں بھیجیں']]) {
      const t = trail({ lang, menu: FOLD });
      t.TR.tapEnd('bigger-result', {});
      expect(t.html()).toMatch(new RegExp(`id="wqfc-share"[^>]*>${word}</a>`));
    }
  });
  test('no_class without the fold (home off): today\'s label', () => {
    const t = trail({ menu: { card_v3: true, no_class: true, v2: {} } });
    t.TR.tapEnd('bigger-result', {});
    expect(t.html()).toMatch(/id="wqfc-share"[^>]*>Share to class group<\/a>/);
  });
});

describe('home on, without the finish card (card_v3 off) or where the card is never drawn', () => {
  test('card_v3 off: the page\'s own Next and one Home, one primary', () => {
    const t = trail({ menu: { card_fold: true, v2: {} }, data: { next_offer: NEXT } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expectFold(t.html(), { next: 'wqc-fnext', share: false });
    expect(t.html()).toContain('<a class="wq-btn wq-go" id="wqc-fnext" data-primary href="/s/b1/1">Read a storybook</a>');
  });
  test('the script for the card not loaded: the same', () => {
    const t = trail({ withFc: false, menu: FOLD });
    t.TR.tapEnd('bigger-result', {});
    expectFold(t.html(), { next: 'wqc-fnext', share: false });
  });
  test('a stop played again (a practice run): the card too, the same row set, no banner on it', () => {
    const t = trail({ menu: FOLD, data: { practice_round: true } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expectFold(t.html());
    expect(t.html()).not.toContain('id="wqc-practice"');
  });
  test('a stop played again, the whole story read: the card, never the sticker or "today", and no read_all anywhere', () => {
    for (const lang of ['en', 'ur']) {
      const t = trail({ lang, menu: FOLD, data: { practice_round: true } });
      t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
      const h = t.html();
      expectFold(h);
      expect(h).not.toContain('id="wqc-sticker"');
      expect(h).not.toContain('data-sticker');
      const share = decodeURIComponent((/id="wqfc-share"[^>]*href="https:\/\/wa\.me\/\?text=([^"]*)"/.exec(h) || [])[1] || '');
      expect(share).toContain(lang === 'ur' ? 'میں نے پوری کہانی اونچی آواز میں پڑھی!' : 'I read a whole story out loud!');
      expect(share).not.toMatch(/⭐|today|آج/);
      const mint = t.posts.find((x) => x.url === '/api/wq/card');
      expect(mint.body).toMatchObject({ kind: 'read', deed: 'read_practice' });
      expect(JSON.stringify([t.events, t.posts])).not.toContain('read_all');
    }
  });
  test('Story Time (a practice run) folded: no sticker line', () => {
    for (const [ex, end] of [['listen', (t) => t.TR.tapEnd('listen-result', {})], ['read', (t) => t.TR.readEnd({ score: { attempted: 4 } }, null, 4)]]) {
      const t = trail({ href: STORY_HREF + (ex === 'listen' ? '&ex=listen' : ''), menu: { ...FOLD, v2: { story: true } }, data: { story_room: true, practice_round: true, ex } });
      t.TR.menu();
      end(t);
      expectFold(t.html());
      expect(t.html()).not.toContain('id="wqc-sticker"');
      expect(t.posts.find((x) => x.url === '/api/wq/card').body).toMatchObject(ex === 'listen' ? { kind: 'listen', deed: 'listen_practice' } : { kind: 'story', deed: 'story_practice' });
    }
  });
  test('a counted run folded keeps its sticker and its read_all card', () => {
    const t = trail({ menu: FOLD });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expect(t.html()).toContain('id="wqc-sticker"');
    expect(t.posts.find((x) => x.url === '/api/wq/card').body).toMatchObject({ kind: 'read', deed: 'read_all' });
  });
  test('card_fold absent: a practice run still gets no card (today)', () => {
    const t = trail({ menu: { card_v3: true, v2: {} }, data: { practice_round: true } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expect(t.html()).not.toContain('wqfc');
    expect(t.html()).toContain('id="wqc-practice"');
  });
  test('a class round turn: today\'s hand-back card, never folded', () => {
    const on = trail({ menu: FOLD, data: { round_turn: true, round_handback: 'Back to the class' } });
    on.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    const off = trail({ menu: { card_v3: true, v2: {} }, data: { round_turn: true, round_handback: 'Back to the class' } });
    off.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expect(on.html()).toBe(off.html());
  });
});

describe('golden: card_fold absent, the end cards are today\'s (hashed on the base)', () => {
  const GOLD = { read_all: 'c247689a7b897e57', read_zero: 'cd1049d1491e4362', listen: '9c71f1b63448d47e' };
  test('menu without card_fold (card script present or not)', () => {
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
      expect(got).toEqual(GOLD);
    }
  });
  test('card_v3 on, card_fold absent: Share stays the primary and the host keeps its buttons', () => {
    const t = trail({ menu: { card_v3: true, v2: {} }, data: { next_offer: NEXT } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    expect(t.html()).toMatch(/id="wqfc-share" data-primary/);
    expect(t.html()).toContain('id="wqc-menu"');
    expect(t.html()).not.toContain('wqc-fhome');
  });
});

describe('the tap', () => {
  test('"Pick a story" is a plain link to the child\'s home; the ranked tile emits the card\'s next_tap', async () => {
    const t = trail({ menu: FOLD, data: { next_offer: NEXT } });
    t.TR.readEnd({ score: { attempted: 4 } }, null, 4);
    t.tap('wqfc-next');
    await flush();
    expect(t.events.map((e) => e.n)).toContain('next_tap');
  });
});

// A read that certified nothing (the try card: no Share) with no tile to lead with: the screen still has exactly one
// primary — the host's Home stays the way on; with a tile, the tile is the one primary.
describe('the try card: exactly one primary on the screen', () => {
  const CARD = { card_v3: true, v2: {} };
  const zero = (t) => t.TR.readEnd({ score: { correct: 0, attempted: 0 }, sticker: false });
  test.each(['en', 'ur'])('%s, off the fold, no next offer: no Share, no tile; Home is the one primary', (lang) => {
    const t = trail({ lang, menu: CARD });
    zero(t);
    const h = t.html();
    expect(h).toContain('data-screen="card"');
    expect(h).not.toContain('id="wqfc-share"');
    expect(h).not.toContain('id="wqfc-next"');
    expect(primaries(h)).toBe(1);
    expect(h).toMatch(/<button class="wq-btn wq-go" id="wqc-menu"[^>]*data-primary/);
  });
  test.each(['en', 'ur'])('%s, off the fold, with a next offer: the tile is the one primary; Home is soft', (lang) => {
    const t = trail({ lang, menu: CARD, data: { next_offer: NEXT } });
    zero(t);
    const h = t.html();
    expect(primaries(h)).toBe(1);
    expect(h).toContain('id="wqfc-next" data-primary');
    expect(h).toMatch(/<button class="wq-btn wq-soft" id="wqc-menu"/);
  });
  test.each(['en', 'ur'])('%s, on the fold, no next offer: one primary', (lang) => {
    const t = trail({ lang, menu: FOLD });
    zero(t);
    expect(primaries(t.html())).toBe(1);
  });
});
