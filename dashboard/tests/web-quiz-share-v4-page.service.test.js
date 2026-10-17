/**
 * One share for every finish, on the child's pages (app_settings web_quiz_share_v4, told by the card mint's answer
 * `v4` and the quiz finish's `share_v4`; default OFF). A share tap opens ONE sheet: the card's picture, "Send on
 * WhatsApp" (the words and the link, whose preview is the card), the picture as a file where the phone can, "Save
 * picture", "Copy link", Back. The storybook and video cards name their item, so the link lands a new child on it.
 * The quiz card gets "Challenge a friend" back. The shared link's landing (/k/<t>) shows the card, the activity's mark
 * and one way in. Switch off: the tap, the mint's words, the fold card and the landing are today's, byte for byte.
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./wq-page-harness');
const { renderCardPage } = require('../routes/web-quiz.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const FC_SRC = fs.readFileSync(path.join(WQ, 'wq-finish-card.js'), 'utf8');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const TOK = 'Qm9va2Nhc2VfdG9rZW5fZm9yX3Rlc3RzX29ubHlfMDEyMzQ1Njc4OWFiY2RlZg';
const BOOK = '3b9c1e2a-7d4f-4a1b-9c2d-5e6f7a8b9c0d';
const RET = { text: 'Play with Jugnu any day. Tap, then send:', cta: 'Play with Jugnu', words: 'quiz please', href: 'https://wa.me/15550001111?text=quiz%20please' };
const BANNED = /\b(test|exam|assessment)\b|امتحان|ٹیسٹ/i;
const flush = () => new Promise((r) => setImmediate(r));

// WQFC in a vm with a small DOM: the share anchor, and a body the sheet is drawn into.
function fcPage(answer) {
  const posts = [];
  const timers = [];
  let body = '';
  const listeners = [];
  const a = { tagName: 'A', className: 'wq-btn wq-go wqfc-share', clicks: 0, attrs: {}, innerHTML: 'Share',
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener(n, fn) { listeners.push(fn); },
    tap() { const e = { currentTarget: a, prevented: 0, preventDefault() { this.prevented += 1; } }; listeners.forEach((fn) => fn(e)); return e; } };
  const els = {};
  const doc = {
    getElementById: (id) => (id === 'wqfc-share' ? a : body.indexOf(`id="${id}"`) >= 0 ? (els[id] = els[id] || { id, l: [], addEventListener(n, fn) { this.l.push(fn); }, focus() {}, parentNode: { removeChild() { body = ''; } } }) : null),
    createElement: () => ({ setAttribute() {}, style: {} }),
    head: { appendChild() {} },
    body: { insertAdjacentHTML(pos, h) { body += h; }, appendChild() {}, removeChild() {} },
    querySelector: () => null,
  };
  const stack = { insertAdjacentHTML() {} };
  const ctx = { window: {}, document: doc, location: { origin: 'https://portal.example' }, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    // answer: the mint's body, or a function (the n-th mint) giving a promise of it (a slow or failing mint); null = refused
    fetch: (url, init) => {
      if (init && init.method === 'POST') posts.push(JSON.parse(init.body));
      return Promise.resolve(typeof answer === 'function' ? answer(posts.length) : answer)
        .then((b) => (b == null ? { ok: false, text: () => Promise.resolve('') } : { ok: true, text: () => Promise.resolve(JSON.stringify(b)) }));
    } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FC_SRC, ctx);
  return { FC: ctx.WQFC, a, posts, stack, els, timers, body: () => body };
}
const MINT = { token: TOK, url: `/k/${TOK}`, img: `/wq/card/${TOK}.png`, ret: RET };

describe('the sheet (pure)', () => {
  test.each(['en', 'ur'])('%s: the picture first, ONE primary (WhatsApp, the words and the link), save, copy, back', (lang) => {
    const FC = fcPage(MINT).FC;
    const h = FC.sheetHtml({ lang, img: `/wq/card/${TOK}.png`, text: `⭐ words\nhttps://portal.example/k/${TOK}`, url: `https://portal.example/k/${TOK}`, file: false });
    expect(h).toContain(`dir="${lang === 'ur' ? 'rtl' : 'ltr'}"`);
    expect(h.indexOf('class="wqfc-sh-pic"')).toBeLessThan(h.indexOf('id="wqfc-sh-wa"'));
    expect((h.match(/data-primary/g) || []).length).toBe(1);
    expect(h).toMatch(/id="wqfc-sh-wa" data-primary data-tap="card_share" target="_blank" rel="noopener" href="https:\/\/wa\.me\/\?text=[^"]*%2Fk%2F/);
    expect(h).toContain(`id="wqfc-sh-save" data-tap="card_save" href="/wq/card/${TOK}.png" download="jugnu-card.png"`);
    expect(h).toContain('id="wqfc-sh-copy"');
    expect(h).toContain('id="wqfc-sh-back"');
    expect(h).not.toContain('id="wqfc-sh-file"');
    for (const [k, w] of Object.entries(FC.SH[lang])) expect(h.indexOf(w) >= 0 || ['copied', 'file', 'getting', 'again', 'friends'].includes(k)).toBe(true);
    expect(JSON.stringify(FC.SH[lang])).not.toMatch(BANNED);
  });
  test('a phone that can share a file gets that button too; a picture path that is not the card\'s is dropped', () => {
    const FC = fcPage(MINT).FC;
    expect(FC.sheetHtml({ lang: 'en', img: `/wq/card/${TOK}.png`, text: 'x', url: 'u', file: true })).toContain('id="wqfc-sh-file"');
    const bad = FC.sheetHtml({ lang: 'en', img: 'https://evil.example/x.png', text: 'x', url: 'u' });
    expect(bad).not.toContain('<img');
    expect(bad).not.toContain('wqfc-sh-save');
  });
});

describe('the tap', () => {
  test('switch on (the mint says v4): the tap stays on the page and opens the sheet with the card and its link', async () => {
    const p = fcPage({ ...MINT, v4: true, item: 'book' });
    expect(p.FC.mount(p.stack, { kind: 'book', deed: 'book_read', lang: 'en', title: 'The lost kite', auth: { hub: 'h', kid: 'k' }, item: { type: 'book', id: BOOK } })).toBe(true);
    await flush(); await flush();
    const e = p.a.tap();
    expect(e.prevented).toBe(1);
    const h = p.body();
    expect(h).toContain('data-screen="share_sheet"');
    expect(h).toContain(`src="/wq/card/${TOK}.png"`);
    expect(decodeURIComponent(/id="wqfc-sh-wa"[^>]*href="https:\/\/wa\.me\/\?text=([^"]+)"/.exec(h)[1])).toContain(`https://portal.example/k/${TOK}`);
    // Back takes the sheet off
    p.els['wqfc-sh-back'].l.forEach((fn) => fn({}));
    expect(p.body()).toBe('');
  });
  test('the storybook\'s item rides the mint; a bad item does not', async () => {
    const p = fcPage(MINT);
    p.FC.mount(p.stack, { kind: 'book', deed: 'book_read', lang: 'en', auth: { hub: 'h', kid: 'k' }, item: { type: 'book', id: BOOK }, v4: true });
    p.FC.mount(p.stack, { kind: 'video', deed: 'video_watched', lang: 'en', auth: { hub: 'h', kid: 'k' }, item: { type: 'video', id: '"><img>' }, v4: true });
    p.FC.mount(p.stack, { source: 'story', ended: 'read', pages_read: 3, lang: 'en', auth: { hub: 'h', kid: 'k2' }, item: { type: 'book', id: BOOK }, whole: true, v4: true });
    // switch off (no v4 from the host): today's mint body, no item
    p.FC.mount(p.stack, { kind: 'book', deed: 'book_read', lang: 'en', auth: { hub: 'h', kid: 'k3' }, item: { type: 'book', id: BOOK } });
    expect(p.posts[0].item).toEqual({ type: 'book', id: BOOK });
    expect(p.posts[1].item).toBeUndefined();
    expect(p.posts[2]).toMatchObject({ kind: 'book', item: { type: 'book', id: BOOK } });
    expect(Object.keys(p.posts[3]).sort()).toEqual(['deed', 'hub', 'kid', 'kind', 'lang']);
  });
  test('switch off (today\'s mint answer): the tap is today\'s WhatsApp link, no sheet', async () => {
    const p = fcPage(MINT);
    p.FC.mount(p.stack, { kind: 'book', deed: 'book_read', lang: 'en', auth: { hub: 'h', kid: 'k' }, item: { type: 'book', id: BOOK } });
    await flush(); await flush();
    const e = p.a.tap();
    expect(e.prevented).toBe(0);
    expect(p.body()).toBe('');
    expect(decodeURIComponent(p.a.attrs.href)).toContain(`https://portal.example/k/${TOK}`);
  });
  test('the quiz\'s class share (quizShareTap): with v4 the sheet has the picture (no picture-less fallback)', async () => {
    const p = fcPage({ ...MINT, url: `/q/CLS001?k=${TOK}`, v4: true, item: 'quiz' });
    const fb = jest.fn();
    p.FC.primeQuiz({ lang: 'ur', topic: 'Plants', st: 's1', url: 'https://portal.example/q/CLS001' });
    await flush(); await flush();
    p.FC.quizShareTap({ lang: 'ur', topic: 'Plants', st: 's1', url: 'https://portal.example/q/CLS001' }, fb)({ stopImmediatePropagation() {} });
    expect(fb).not.toHaveBeenCalled();
    expect(p.body()).toContain(`src="/wq/card/${TOK}.png"`);
    expect(p.body()).toContain('dir="rtl"');
  });
});

describe('the quiz card\'s Share (the real button on the real page) opens the one sheet', () => {
  const { flush: pflush } = require('./wq-page-harness');
  const QRES = { card: { first: 'Noor', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 },
    art: { card: 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl' }, card_v3: true, share_v4: true };
  const qstore = (result) => ({ wq_s_TEST: { st: 's1', child: { first: 'Noor', chip: 'c1', animal: 'owl' }, answers: {}, queue: [], result, vdone: true } });
  async function quizPage(lang, extra, mint) {
    const shares = [];
    const p = page({ lang, store: qstore({ ...QRES, ...extra }), api: { '/api/wq/card': mint }, nav: { share: (d) => { shares.push(d); return Promise.resolve(); } } });
    let sheet = '';
    p.ctx.document.body.insertAdjacentHTML = (pos, h) => { sheet += h; };
    vm.runInContext(FC_SRC, p.ctx);
    Object.values(p.els).forEach((el) => { el.listeners = {}; });
    p.wq.card();
    await pflush(); await pflush();
    return { p, shares, sheet: () => sheet };
  }
  for (const lang of ['en', 'ur']) {
    for (const [name, fold] of [['the card', {}], ['the folded card', { card_fold: true }]]) {
      test(`${lang}, ${name}: one tap → the sheet with the card's picture and its link; the page's own share does not run`, async () => {
        const { p, shares, sheet } = await quizPage(lang, fold, { token: TOK, url: `/q/TEST?k=${TOK}`, img: `/wq/card/${TOK}.png`, ret: RET, v4: true, item: 'quiz' });
        // the card minted at the finish is the one the tap uses (one mint, with the one share's mark asked for)
        const mints = p.fetches.filter((f) => f.url === '/api/wq/card');
        expect(mints.length).toBe(1);
        p.els['#wq-share'].fire('click');
        await pflush(); await pflush();
        expect(shares.length).toBe(0);
        expect(p.moment()).not.toBe('M12-fallback');
        expect(sheet()).toContain('data-screen="share_sheet"');
        expect(sheet()).toContain(`src="/wq/card/${TOK}.png"`);
        expect(sheet()).toContain(`dir="${lang === 'ur' ? 'rtl' : 'ltr'}"`);
        expect(decodeURIComponent(/id="wqfc-sh-wa"[^>]*href="https:\/\/wa\.me\/\?text=([^"]+)"/.exec(sheet())[1])).toContain(`https://example.test/q/TEST?k=${TOK}`);
        expect(p.fetches.filter((f) => f.url === '/api/wq/card').length).toBe(1);
      });
    }
    test(`${lang}: no card at all (the mint refused): the page's own share with the picture, never bare words`, async () => {
      const { p, shares } = await quizPage(lang, {}, null);
      p.els['#wq-share'].fire('click');
      await pflush(); await pflush();
      expect(shares.length).toBe(1);
      expect(shares[0].url).toBe(`https://example.test/q/TEST?a=${encodeURIComponent(QRES.art.card)}`);
    });
  }
});

describe('the quiz card with the home on: "Challenge a friend" is back with the one share', () => {
  const RESULT = { card: { first: 'Noor', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 },
    art: { card: 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl', invite: 'i.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl' }, card_fold: true };
  const store = (result) => ({ wq_s_TEST: { st: 's1', child: { first: 'Noor', chip: 'c1', animal: 'owl' }, answers: {}, queue: [], result, vdone: true } });
  test.each(['en', 'ur'])('%s: share_v4 → the button, and its tap shares the challenge link', (lang) => {
    const p = page({ lang, store: store({ ...RESULT, share_v4: true }) });
    p.wq.card();
    const h = p.html();
    expect(h).toContain(`id="wq-chal">${p.wq.T.challenge}</button>`);
    expect(h.indexOf('id="wq-chal"')).toBeGreaterThan(h.indexOf('id="wq-share"'));
    expect(h.indexOf('id="wq-chal"')).toBeLessThan(h.indexOf('id="wq-fhome"'));
    p.els['#wq-chal'].fire('click');
    expect(p.html()).toContain('/q/CHAL12');
  });
  test('switch off: today\'s fold card, no challenge button', () => {
    const p = page({ lang: 'en', store: store(RESULT) });
    p.wq.card();
    expect(p.html()).not.toContain('id="wq-chal"');
  });
});

describe('the shared link\'s landing (/k/<t>)', () => {
  const facts = (lang, extra = {}) => ({ kind: 'book', lang, first: 'Noor', deed_text: 'I read a storybook with Jugnu today!', ret: RET, ...extra });
  // recorded on origin/sandbox 04bebe647 (before this change) with the same facts
  const GOLDEN = { 'en|false': '9fbf818cf0fd2dea', 'en|true': 'e88ed8084c2d59e8', 'ur|false': '7c826ccd62222f7e', 'ur|true': 'b36b9adfc407a7bf' };
  test('a token minted with the switch off: today\'s page, byte for byte', () => {
    for (const [k, h] of Object.entries(GOLDEN)) {
      const [lang, uf] = k.split('|');
      expect([k, sha(renderCardPage({ facts: facts(lang), token: TOK, origin: 'https://portal.example', url: `https://portal.example/k/${TOK}`, brandKey: null, oneFace: uf === 'true' }))]).toEqual([k, h]);
    }
  });
  test.each(['en', 'ur'])('%s: a one-share token — the mark, the card, who did what, ONE way in with the item\'s ref typed', (lang) => {
    const ret = { ...RET, words: 'quiz please jb3b9c1e2a', href: 'https://wa.me/15550001111?text=quiz%20please%20jb3b9c1e2a' };
    const html = renderCardPage({ facts: facts(lang, { v4: true, mark: lang === 'ur' ? 'کہانی کی کتاب' : 'Storybook', accent: '#7C3AED', ref: 'jb3b9c1e2a', ret }), token: TOK, origin: 'https://portal.example', url: `https://portal.example/k/${TOK}`, brandKey: null });
    expect(html).toContain('data-screen="card_landing" data-v="4"');
    expect(html).toContain(`<meta property="og:image" content="https://portal.example/wq/card/${TOK}.png"`);
    expect(html).toContain('class="mark"');
    expect((html.match(/data-primary/g) || []).length).toBe(1);
    expect(html).toContain('href="https://wa.me/15550001111?text=quiz%20please%20jb3b9c1e2a"');
    expect(html).toContain(`dir="${lang === 'ur' ? 'rtl' : 'ltr'}"`);
    expect(html).not.toMatch(BANNED);
    // with no bot number (no chat link): still ONE way in — WhatsApp with the words typed, never a page without a door
    const none = renderCardPage({ facts: facts(lang, { v4: true, mark: 'x', accent: '#7C3AED', ret: { ...RET, href: null } }), token: TOK, origin: 'https://portal.example', url: 'u', brandKey: null });
    expect((none.match(/data-primary/g) || []).length).toBe(1);
    expect(none).toContain(`href="https://wa.me/?text=${encodeURIComponent(RET.words)}"`);
    // a colour that is not a colour never reaches the style
    const bad = renderCardPage({ facts: facts(lang, { v4: true, accent: 'red;}</style><script>' }), token: TOK, origin: 'https://portal.example', url: 'u', brandKey: null });
    expect(bad).not.toContain('<script>');
  });
});

describe('the one share never sends words without the card', () => {
  const BOOK_O = { kind: 'book', deed: 'book_read', lang: 'en', title: 'The lost kite', auth: { hub: 'h', kid: 'k' }, item: { type: 'book', id: BOOK } };
  test.each(['en', 'ur'])('%s: a slow card (> 2 s): the button says it is getting the card, then the sheet opens with it', async (lang) => {
    let release;
    const p = fcPage(() => new Promise((r) => { release = r; }));
    p.FC.mount(p.stack, { ...BOOK_O, lang, v4: true });
    const e = p.a.tap();
    expect(e.prevented).toBe(1);
    expect(p.a.innerHTML).toBe(p.FC.SH[lang].getting);
    expect(p.a.attrs['aria-busy']).toBe('true');
    expect(p.a.attrs.href).toBeUndefined();
    // the 2 s give-up of today is not there: nothing is sent while the card is being made
    expect(p.timers.some((t) => t.ms === 2000)).toBe(false);
    release({ ...MINT, v4: true, item: 'book' });
    await flush(); await flush();
    expect(p.body()).toContain(`src="/wq/card/${TOK}.png"`);
    expect(p.a.innerHTML).toBe('Share');
    expect(p.a.attrs['aria-busy']).toBeUndefined();
  });
  test('no card at all (the mint refused): no words sent; "tap again", and that tap asks the server again', async () => {
    const p = fcPage((n) => (n === 1 ? null : { ...MINT, v4: true }));
    p.FC.mount(p.stack, { ...BOOK_O, v4: true });
    await flush(); await flush();
    p.a.tap();
    await flush(); await flush();
    expect(p.a.innerHTML).toBe(p.FC.SH.en.again);
    expect(p.a.attrs.href).toBeUndefined();
    expect(p.body()).toBe('');
    p.a.tap();
    await flush(); await flush();
    expect(p.posts.length).toBe(2);
    expect(p.body()).toContain('data-screen="share_sheet"');
    // the button's own label is back once the card is in (never stuck on "tap again")
    expect(p.a.innerHTML).toBe('Share');
    expect(p.a.attrs['aria-busy']).toBeUndefined();
  });
  test.each(['en', 'ur'])('%s: the button says who it goes to — the mint says no class: "Share with friends"; a class: the class group', async (lang) => {
    const p = fcPage({ ...MINT, v4: true, item: 'book', plain: true });
    p.FC.mount(p.stack, { ...BOOK_O, lang, v4: true });
    await flush(); await flush();
    expect(p.a.innerHTML).toBe(p.FC.SH[lang].friends);
    const q = fcPage({ ...MINT, v4: true, item: 'book', plain: false });
    q.FC.mount(q.stack, { ...BOOK_O, lang, v4: true });
    await flush(); await flush();
    expect(q.a.innerHTML).toBe(q.FC.W[lang].send);
    // switch off: today's label, whatever the mint says
    const r = fcPage({ ...MINT, plain: true });
    r.FC.mount(r.stack, { ...BOOK_O, lang });
    await flush(); await flush();
    expect(r.a.innerHTML).toBe('Share');
  });
  test('a switch race (the host says v4, the mint answers without it): the tap is never silent — "tap again", and that tap shares the card link', async () => {
    let release;
    const p = fcPage(() => new Promise((r) => { release = r; }));
    p.FC.mount(p.stack, { ...BOOK_O, v4: true });
    p.a.tap();
    release(MINT);
    await flush(); await flush();
    expect(p.a.innerHTML).toBe(p.FC.SH.en.again);
    expect(decodeURIComponent(p.a.attrs.href)).toContain(`https://portal.example/k/${TOK}`);
    const e = p.a.tap();
    expect(e.prevented).toBe(0);
    expect(p.a.innerHTML).toBe('Share');
  });
  test('with no bot number (the mint gives no chat link): the words end with the card link, never loose words', () => {
    const FC = fcPage(MINT).FC;
    for (const lang of ['en', 'ur']) {
      const t = FC.shareText({ lang, deed: 'book_read', title: 'The lost kite', url: `https://portal.example/k/${TOK}`, ret: { text: 'x' }, v4: true });
      expect(t.split('\n').pop()).toBe(`https://portal.example/k/${TOK}`);
      expect(t).not.toContain(FC.W[lang].words);
    }
    // switch off: today's words, the return words quoted
    expect(FC.shareText({ lang: 'en', deed: 'book_read', url: 'u', ret: {} }).split('\n').pop()).toBe(`“${FC.W.en.words}”`);
  });
  test('the switch off (no v4 from the host): today\'s 2 s wait, then today\'s words', () => {
    const p = fcPage(() => new Promise(() => {}));
    p.FC.mount(p.stack, BOOK_O);
    p.a.tap();
    expect(p.a.innerHTML).toBe('Share');
    expect(p.timers.some((t) => t.ms === 2000)).toBe(true);
  });
  test('the Jugnu page\'s end card and the video card pass the host\'s share_v4 to the mint\'s tap', () => {
    const doors = fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8');
    const story = fs.readFileSync(path.join(WQ, 'wq-stories-d.js'), 'utf8');
    expect(doors).toContain("if (B.share_v4 === true) { fo.v4 = true; fo.item = w.vid ? { type: 'video', id: String(w.vid) } : null; }");
    expect(story).toContain("if (b.share_v4 === true) { fo.v4 = true; fo.item = { type: 'book', id: String(id) }; }");
    expect(FC_SRC).toContain('v4: (h.md() || {}).share_v4 === true || undefined });');
  });
});

describe('the folded quiz card: "Challenge a friend" only with share_v4 JSON true', () => {
  const RESULT = { card: { first: 'Noor', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 },
    art: { card: 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl', invite: 'i.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl' }, card_fold: true };
  const store = (result) => ({ wq_s_TEST: { st: 's1', child: { first: 'Noor', chip: 'c1', animal: 'owl' }, answers: {}, queue: [], result, vdone: true } });
  test.each([['absent', {}], ['false', { share_v4: false }], ['the string "true"', { share_v4: 'true' }], ['1', { share_v4: 1 }]])('%s: no challenge door (today\'s fold card)', (_, extra) => {
    for (const lang of ['en', 'ur']) {
      const p = page({ lang, store: store({ ...RESULT, ...extra }) });
      p.wq.card();
      expect(p.html()).not.toMatch(/id="wq-chal"/);
      expect(p.html()).not.toContain(p.wq.T.challenge);
    }
  });
});
