/**
 * The adventure look (boot adv + <html class="wq-adv">, app_settings web_quiz_adventure_look) on the quiz page's own
 * screens: the lesson video page, the class table and the school league wear the land header of the hub's land screens
 * (the round Home, the screen's name, the sound), not the old brand bar. On the video page the questions are the one
 * primary from the start. The class table opened from My class (no session of its own) still has a Home: back to the hub
 * this tab came from. Without the look every screen is today's (the goldens in the video and class tests stand).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const ADV = { htmlClass: ['wq-adv'] };
const count = (h, rx) => (h.match(rx) || []).length;
const BOARD = { rows: [{ place: 1, first: 'Zara Testwala', animal: 'owl', correct: 3, total: 5 }], you: null, finishers_n: 1, class_avg_pct: 60, class_doors: true, my_class: '3-B', one_class: true };
const LEAGUE = { mine: { name: 'Model School Testwala', place: 2, points: 40, kids: 4 }, rows: [{ place: 1, name: 'Other School', points: 50, kids: 5 }], ranked_n: 2, class_doors: true };

function videoPage(lang, adv, search = '?k=kk&via=videos') {
  const p = page({ lang, search, video: { url: 'https://r2.example/v.mp4', poster: 'https://r2.example/p.jpg' }, bootExtra: { videos_v3: true, nav: { home: true }, ...(adv ? { adv: true } : {}) }, ...(adv ? ADV : {}) });
  p.wq.S.st = 'st1';
  p.wq.video();
  return p;
}

describe('the lesson video page with the look', () => {
  for (const lang of ['en', 'ur']) {
    test(`${lang}: the Videos land header with the round Home, no brand bar`, () => {
      const h = videoPage(lang, true).html();
      expect(h).toMatch(/<section class="wq-screen" data-m="M5" data-land="videos">/);
      expect(h).toContain('<div class="wq-dtop wq-ltop"><button class="wq-home" id="wq-home" type="button"');
      expect(h).not.toContain('class="wq-bar"');
      expect(h).not.toContain('class="wq-brand"');
      expect(count(h, /<h2/g)).toBe(1);
      expect(h).toContain('id="wq-snd"');
    });
    test(`${lang}: "Go to the questions" is the one primary from the start; the play is not`, () => {
      const p = videoPage(lang, true);
      const h = p.html();
      expect(count(h, /data-primary/g)).toBe(1);
      expect(h).toMatch(/<button class="wq-btn wq-go" id="wq-skip" data-primary>/);
      expect(h).toMatch(/<button class="wq-vcover[^"]*" type="button" aria-label=/);
    });
  }
  test('without the look (no class on <html>, or no boot field): today\'s bar and secondary questions button', () => {
    for (const p of [videoPage('en', false), page({ lang: 'en', search: '?via=videos', video: { url: 'https://r2.example/v.mp4' }, bootExtra: { videos_v3: true, adv: true } })]) {
      if (!p.wq.S.st) { p.wq.S.st = 'st1'; p.wq.video(); }
      const h = p.html();
      expect(h).toContain('<div class="wq-bar">');
      expect(h).not.toContain('wq-ltop');
      expect(h).not.toContain('data-land=');
      expect(h).toContain('<button class="wq-btn wq-soft" id="wq-skip">');
    }
  });
});

describe('the class table and the league with the look', () => {
  const boardPage = async (o = {}) => {
    const p = page({ lang: o.lang || 'en', view: o.view || 'class', lib: true, bootExtra: { adv: true, nav: { home: true } }, ...ADV, api: { '/board/TEST': BOARD, '/schools/TEST': LEAGUE } });
    if (o.hub) p.sess.set('wq_hub_at', o.hub);
    await flush(); await flush();
    return p;
  };
  for (const lang of ['en', 'ur']) {
    test(`${lang}: the Games land header; opened from My class (no session), its Home goes back to the hub`, async () => {
      const p = await boardPage({ lang, hub: '/h/eyJrIjoiaCJ9.AbCd-_x' });
      const h = p.html();
      expect(p.moment()).toBe('M11');
      expect(h).toMatch(/<section class="wq-screen" data-m="M11" data-land="games">/);
      expect(h).toContain('<div class="wq-dtop wq-ltop"><button class="wq-home" id="wq-home"');
      expect(h).not.toContain('class="wq-brand"');
      p.els['#wq-home'].fire('click');
      expect(p.hist.assigned).toContain('/h/eyJrIjoiaCJ9.AbCd-_x?from=home');
    });
  }
  test('a long table keeps its primary on the screen: Play (the one primary) is sticky with the look, Share soft', async () => {
    const p = await boardPage({ hub: '/h/abc' });
    expect(p.html()).toContain('<button class="wq-btn wq-go wq-stick" id="wq-play" data-primary>');
    expect(p.html()).toContain('<button class="wq-btn wq-soft" id="wq-share-t">');
  });
  test('the school league wears the same header', async () => {
    const p = await boardPage({ view: 'schools', hub: '/h/abc' });
    expect(p.moment()).toBe('M16');
    expect(p.html()).toMatch(/<section class="wq-screen" data-m="M16" data-land="games"><div class="wq-dtop wq-ltop"><button class="wq-home"/);
  });
  test('no hub kept and no session: no dead Home (the header has the title and the sound only)', async () => {
    const p = await boardPage({ hub: 'https://evil.example/h/x' });
    expect(p.html()).toContain('<div class="wq-dtop wq-ltop"><h2 dir="auto">');
    expect(p.html()).not.toContain('id="wq-home"');
  });
});

describe('the hub keeps its path for that Home: a tap on My class or My school, with the look only', () => {
  const run = (adv, social) => {
    const dl = {}; const sess = new Map();
    const target = { closest: (sel) => (social && sel === 'a[data-social]' ? {} : null) };
    const ctx = {
      document: { documentElement: { classList: { contains: (c) => adv && c === 'wq-adv' } } },
      addEventListener: (n, fn) => { (dl[n] = dl[n] || []).push(fn); },
      location: { pathname: '/h/eyJrIjoiaCJ9.AbCd' },
      sessionStorage: { setItem: (k, v) => sess.set(k, v), getItem: (k) => sess.get(k) || null },
    };
    ctx.window = ctx;
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
    const i = src.indexOf('  // The adventure look: a tap on My class');
    expect(i).toBeGreaterThan(0);
    vm.runInNewContext(src.slice(i, src.indexOf('  }, true);\n', i) + 12), ctx);
    (dl.click || []).forEach((fn) => fn({ target }));
    return sess;
  };
  test('look on + My class tapped: kept; any other tap, or the look off: nothing written', () => {
    expect(run(true, true).get('wq_hub_at')).toBe('/h/eyJrIjoiaCJ9.AbCd');
    expect(run(true, false).size).toBe(0);
    expect(run(false, true).size).toBe(0);
  });
});

describe('the Videos see-all with the look: one back control, the lessons two by two', () => {
  const F = require('./web-quiz-video-shelf.fixture');
  const DOC = { document: { documentElement: { classList: { contains: (c) => c === 'wq-adv' } } } };
  const SHELF = { href: '/lib/x', watch: true, shelf: true };
  for (const lang of ['en', 'ur']) {
    test(`${lang}: the head's round button steps back to the subjects; no second Back; one grid with each card's chapter`, () => {
      const W = F.load({ globals: DOC });
      const h = W.WQDOORS.html(F.boot(lang, SHELF), { token: F.TOKEN, lang }, 'videos', { subject: 'Science', lib: { ...F.LIB_CHAPTERS, quiz: true } });
      expect(h).toMatch(/<div class="wq-dtop"><a class="wq-homebtn wq-backbtn" href="#" data-tap="subjects" aria-label="[^"]+">/);
      expect(count(h, /data-tap="subjects"/g)).toBe(1);
      expect(h).not.toContain('class="wq-dback"');
      expect(h).not.toContain('data-tap="home"');
      expect(count(h, /class="wq-vgrid/g)).toBe(1);
      expect(h).toContain('class="wq-vgrid wq-vgrid--one"');
      const n = F.LIB_CHAPTERS.chapters.reduce((a, c) => a + c.videos.length, 0);
      expect(count(h, /class="wq-vcard"/g)).toBe(n);
      expect(count(h, /class="wq-vch"/g)).toBe(n);
      expect(count(h, /data-primary/g)).toBe(1);
    });
  }
  test('without the look: today\'s Back under the Home head, a grid per chapter', () => {
    const W = F.load();
    const h = W.WQDOORS.html(F.boot('en', SHELF), { token: F.TOKEN, lang: 'en' }, 'videos', { subject: 'Science', lib: { ...F.LIB_CHAPTERS, quiz: true } });
    expect(h).toContain('class="wq-dback"');
    expect(h).toContain('data-tap="home"');
    expect(h).not.toContain('wq-backbtn');
    expect(h).not.toContain('wq-vgrid--one');
  });
});

describe('the Videos grade picker with the look (browse only, as the Stories shelf)', () => {
  const F = require('./web-quiz-video-shelf.fixture');
  const SHELF = { href: '/lib/x', watch: true, shelf: true };
  const ADVDOC = { documentElement: { classList: { contains: (c) => c === 'wq-adv' } } };
  const GRADES = [{ g: 'KG', n: 3 }, { g: '1', n: 4 }, { g: '3', n: 12 }];
  const SUBJ = (g) => ({ ...F.LIB_SUBJECTS, grade: g, grades: GRADES });
  for (const lang of ['en', 'ur']) {
    test(`${lang}: "Grade 3" (and its CSS caret) above the shelves, closed; the only primary stays the first See all`, () => {
      const W = F.load({ globals: { document: ADVDOC } });
      const h = W.WQDOORS.html(F.boot(lang, SHELF), { token: F.TOKEN, lang }, 'videos', { lib: SUBJ('3') });
      expect(h).toContain(`data-tap="vgl" aria-expanded="false">${lang === 'ur' ? 'جماعت ۳' : 'Grade 3'}<i class="wq-caret" aria-hidden="true"></i></button>`);
      expect(h).not.toContain('wq-vpick');
      expect(count(h, /data-primary/g)).toBe(1);
      expect(h.indexOf('wq-vgl')).toBeLessThan(h.indexOf('data-vshelf'));
    });
  }
  test('without the look, or with one grade only: no picker', () => {
    const W = F.load();
    expect(W.WQDOORS.html(F.boot('en', SHELF), { token: F.TOKEN, lang: 'en' }, 'videos', { lib: SUBJ('3') })).not.toContain('wq-vgl');
    const W2 = F.load({ globals: { document: ADVDOC } });
    expect(W2.WQDOORS.html(F.boot('en', SHELF), { token: F.TOKEN, lang: 'en' }, 'videos', { lib: { ...SUBJ('3'), grades: [{ g: '3', n: 1 }] } })).not.toContain('wq-vgl');
  });

  function el(extra = {}) {
    return {
      attrs: {}, listeners: {}, innerHTML: '', parentNode: null,
      setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
      fire(n) { (this.listeners[n] || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {} })); },
      querySelector: () => null, ...extra,
    };
  }
  const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };
  test('live: open the chips, pick Grade 1: that grade\'s subjects and shelves are asked for (&g=1); its own grade again asks with no g', async () => {
    const fetch = jest.fn((url) => {
      const g = (/[?&]g=([^&]+)/.exec(url) || [])[1] || '3';
      const j = /[?&]s=/.test(url) ? { ...F.LIB_CHAPTERS, grade: g } : SUBJ(g);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
    });
    const taps = []; const shelves = {}; const evs = [];
    const root = el({ querySelector: (sel) => { const m = /^\[data-vshelf="(.+)"\]$/.exec(sel); return m ? (shelves[m[1]] = shelves[m[1]] || el()) : null; }, querySelectorAll: (sel) => (sel === '[data-tap]' ? taps : []) });
    const document = { ...ADVDOC, getElementById: () => null, querySelector: () => null, createElement: () => el(), head: { appendChild() {} } };
    const W = F.load({ win: { scrollTo() {}, addEventListener() {} }, globals: { fetch, document, location: { hash: '', pathname: `/h/${F.TOKEN}`, search: '' }, MutationObserver: function () { this.observe = () => {}; }, setImmediate, setTimeout } });
    const ctx = { token: F.TOKEN, lang: 'en', ev: (n, d) => evs.push([n, d]), go() {} };
    const tap = async (name, item) => { const b = el(); b.setAttribute('data-tap', name); if (item) b.setAttribute('data-item', item); taps.length = 0; taps.push(b); W.WQDOORS.mount(root, F.boot('en', SHELF), ctx, 'videos'); await settle(); b.fire('click'); await settle(); };
    W.WQDOORS.mount(root, F.boot('en', SHELF), ctx, 'videos');
    await settle();
    expect(root.innerHTML).toContain('Grade 3<i class="wq-caret" aria-hidden="true"></i>');
    await tap('vgl');
    expect(root.innerHTML).toContain('class="wq-chips wq-schips wq-tall wq-vpick"');
    expect(root.innerHTML).toMatch(/<button class="wq-chip wq-on" type="button" data-tap="vg" data-item="3" aria-pressed="true">3<\/button>/);
    fetch.mockClear();
    await tap('vg', '1');
    const urls = fetch.mock.calls.map(([u]) => u);
    expect(urls.some((u) => /\/api\/wq\/lib\/h\/[^?]+\?kid=[^&]+&l=en&g=1$/.test(u))).toBe(true);
    expect(urls.some((u) => /&g=1&s=Science$/.test(u))).toBe(true);
    expect(root.innerHTML).toContain('Grade 1<i class="wq-caret" aria-hidden="true"></i>');
    expect(root.innerHTML).not.toContain('wq-vpick');
    expect(evs).toContainEqual(['lib_grade', { g: '1', own: 0 }]);
    fetch.mockClear();
    await tap('vg', '3');
    expect(fetch.mock.calls.map(([u]) => u).some((u) => /&l=en$/.test(u))).toBe(true);
    expect(root.innerHTML).toContain('Grade 3<i class="wq-caret" aria-hidden="true"></i>');
  });
});
