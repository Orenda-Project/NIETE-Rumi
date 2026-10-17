/**
 * The join screen's go button says what it is doing while the join is in flight (quiz_join_wait_word). The join's
 * POST can take seconds; today the button turns grey with the same words and a small "Opening…" line appears below,
 * so a child stares at a pressed grey button and taps again. With the switch on, the button keeps its colour, stays
 * disabled, and its own text becomes ONE waiting line: "Getting your games ready…" / «آپ کے کھیل تیار ہو رہے ہیں…».
 * A second tap still sends nothing. If the join answers with anything but the home, the button is itself again.
 * Switch off: the page is today's, byte for byte, and join.js does what it does today.
 *
 * join.js runs in a small stand-in for the browser (one document, click listeners, an XHR that answers when told).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { renderJoinPage, COPY, WAIT_CSS } = require('../routes/quiz-join.routes');

const JOIN_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'join.js'), 'utf8');
const GOLDEN = require('./__golden__/quiz-join-page-off.json');

function el(id, attrs0 = {}, extra = {}) {
  const attrs = { ...attrs0 };
  return { id, hidden: false, disabled: false, value: '', innerHTML: '', textContent: '', listeners: {}, attrs,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, focus() {}, ...extra };
}

/** A join page in the stand-in: five chips, the name, "Let's go!" (its words as the page draws them). */
function page({ waitWord, lang = 'en', copy } = {}) {
  const c = COPY[lang];
  const els = {};
  ['jn-name', 'jn-notice', 'jn-out', 'jn-n1', 'jn-n2'].forEach((id) => { els[id] = el(id); });
  els['jn-go'] = el('jn-go', { 'data-tap': 'go' }, { textContent: c.go, disabled: true });
  els['jn-go'].closest = (sel) => (sel === '[data-tap]' ? els['jn-go'] : null);
  const bootCopy = copy || { noticeSave: c.noticeSave, noticeReadings: c.noticeReadings, error: c.error, wait: c.wait, ...(waitWord ? { going: c.going } : {}) };
  els.boot = el('boot', {}, { textContent: JSON.stringify({ view: 'join', t: 'tok', lang, practice: false, ...(waitWord !== undefined ? { waitWord } : {}), copy: bootCopy }) });
  const chips = [1, 2, 3, 4, 5].map((g) => {
    const ch = el(null, { 'data-tap': 'grade', 'data-grade': String(g), 'aria-pressed': 'false', class: 'chip' });
    ch.closest = (sel) => (sel === '[data-tap=grade]' || sel === '[data-tap]' ? ch : null);
    return ch;
  });
  const listeners = [];
  const posts = [];
  function XMLHttpRequest() {
    this.open = (m, p) => { this.path = p; };
    this.setRequestHeader = () => {};
    this.send = (b) => { posts.push({ path: this.path, body: JSON.parse(b), x: this }); };
  }
  const left = [];
  const document = {
    cookie: '', head: { appendChild() {} }, documentElement: el('html'),
    getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => (sel === '.chip' ? chips : []),
    querySelector: () => null,
    createElement: () => ({}),
    addEventListener: (t, f) => { if (t === 'click') listeners.push(f); },
  };
  const store = new Map();
  const window = { crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = i * 7; return a; } } };
  const ctx = { document, window, XMLHttpRequest, location: { protocol: 'https:', replace(u) { left.push(u); }, href: '' }, setTimeout: () => 0,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
  vm.createContext(ctx);
  vm.runInContext(JOIN_JS, ctx);
  const click = (target) => listeners.forEach((f) => f({ target }));
  const joins = () => posts.filter((p) => p.path === '/api/wq/join');
  const ready = (name = 'Sara') => {
    click(chips[2]);
    els['jn-name'].value = name;
    els['jn-name'].listeners.input();
  };
  /** The join's answer arrives (status, body). */
  const answer = (status, body) => { const x = joins()[joins().length - 1].x; x.status = status; x.responseText = JSON.stringify(body); x.onload(); };
  return { els, go: els['jn-go'], out: els['jn-out'], click, joins, ready, answer, left, c };
}

describe('the join page with quiz_join_wait_word: the page itself', () => {
  test('switch off (false, or not passed): the page is today\'s, byte for byte (EN, UR, practice)', () => {
    for (const [k, args] of Object.entries(GOLDEN.cases)) {
      expect([k, renderJoinPage(args)]).toEqual([k, GOLDEN.pages[k]]);
      expect([k, renderJoinPage({ ...args, waitWord: false })]).toEqual([k, GOLDEN.pages[k]]);
    }
  });

  test('switch on: the boot JSON names it and carries the waiting line, the style keeps the colour; nothing else changes', () => {
    for (const [k, args] of Object.entries(GOLDEN.cases)) {
      const html = renderJoinPage({ ...args, waitWord: true });
      const l = args.lang === 'ur' ? 'ur' : 'en';
      const boot = JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
      expect(boot.waitWord).toBe(true);
      expect(boot.copy.going).toBe(COPY[l].going);
      expect(html).toContain(WAIT_CSS);
      const offBoot = JSON.parse(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(GOLDEN.pages[k])[1]);
      const { waitWord, ...rest } = boot;
      const { going, ...restCopy } = rest.copy;
      expect({ ...rest, copy: restCopy }).toEqual(offBoot);
      const strip = (h) => h.replace(WAIT_CSS, '').replace(/<script id="boot" type="application\/json">[\s\S]*?<\/script>/, '');
      expect(strip(html)).toBe(strip(GOLDEN.pages[k]));
    }
  });

  test('the waiting line: EN "Getting your games ready…", UR «آپ کے کھیل تیار ہو رہے ہیں…» (one ellipsis character, no test words)', () => {
    expect(COPY.en.going).toBe('Getting your games ready…');
    expect(COPY.ur.going).toBe('آپ کے کھیل تیار ہو رہے ہیں…');
    for (const s of [COPY.en.going, COPY.ur.going]) {
      expect(s).not.toMatch(/test|exam|assessment|امتحان|ٹیسٹ|\.\.\./i);
    }
  });

  test('the edge sets the switch only when the bot answers waitWord: true; any other value is today\'s page', async () => {
    const http = require('http');
    const express = require('express');
    const { createQuizJoinRouter } = require('../routes/quiz-join.routes');
    const TOKEN = `${Buffer.from(JSON.stringify({ k: 'j', n: 'N'.repeat(22), l: 'en', exp: 4102444800 })).toString('base64url')}.${'s'.repeat(22)}`;
    const draw = async (waitWord) => {
      const body = { ok: true, lang: 'en', practice: false, ...(waitWord === undefined ? {} : { waitWord }) };
      const fetchImpl = async () => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
      const app = express();
      app.use(createQuizJoinRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl, logEvent: () => {} }));
      const srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
      try {
        return await new Promise((resolve, reject) => {
          http.get({ host: '127.0.0.1', port: srv.address().port, path: `/quiz/join/${TOKEN}` }, (res) => {
            let out = ''; res.on('data', (ch) => { out += ch; }); res.on('end', () => resolve(out));
          }).on('error', reject);
        });
      } finally { srv.close(); }
    };
    expect(await draw(true)).toContain('"waitWord":true');
    for (const v of ['true', '"true"', 1, 'yes', { enabled: true }, null, false, undefined]) {
      const html = await draw(v);
      expect([v, html.includes('waitWord'), html.includes(WAIT_CSS)]).toEqual([v, false, false]);
    }
  });
});

describe('the go button while the join is in flight', () => {
  test.each(['en', 'ur'])('switch on (%s): the join held open → the button says the waiting line, stays disabled, keeps its colour (aria-busy); a second tap sends nothing', (lang) => {
    const p = page({ waitWord: true, lang });
    p.ready();
    expect(p.go.disabled).toBe(false);
    p.click(p.go);
    // the join is held open (no answer yet), as for the seconds it takes on a slow server
    expect(p.joins()).toHaveLength(1);
    expect(p.go.textContent).toBe(COPY[lang].going);
    expect(p.go.disabled).toBe(true);
    expect(p.go.getAttribute('aria-busy')).toBe('true');
    // ONE waiting line: the button; no second "Opening…" line under it
    expect(p.out.innerHTML).toBe('');
    p.click(p.go);
    p.els['jn-name'].listeners.keydown({ key: 'Enter' });
    expect(p.joins()).toHaveLength(1);
  });

  test('switch on: the join answers with the home → the page leaves with the waiting line still on the button', () => {
    const p = page({ waitWord: true });
    p.ready();
    p.click(p.go);
    p.answer(200, { next: '/h/tok?from=join' });
    expect(p.left).toEqual(['/h/tok?from=join']);
    expect(p.go.textContent).toBe(COPY.en.going);
  });

  test('switch on: the join fails → the button is itself again ("Let\'s go!", no aria-busy, tappable) and the error line shows', () => {
    const p = page({ waitWord: true });
    p.ready();
    p.click(p.go);
    p.answer(503, { error: 'unavailable' });
    expect(p.go.textContent).toBe(COPY.en.go);
    expect(p.go.getAttribute('aria-busy')).toBeNull();
    expect(p.go.disabled).toBe(false);
    expect(p.out.innerHTML).toBe(`<p class="line">${COPY.en.error.replace(/'/g, '&#39;')}</p>`);
    p.click(p.go);
    expect(p.joins()).toHaveLength(2);
  });

  test('switch on: "Is this you?" → the button is itself again while the child chooses', () => {
    const p = page({ waitWord: true });
    p.ready();
    p.click(p.go);
    p.answer(200, { ask: 'is_this_you', kids: [{ chip: 'c1', first: 'Sara', animal: 'cat' }] });
    expect(p.go.textContent).toBe(COPY.en.go);
    expect(p.go.getAttribute('aria-busy')).toBeNull();
  });

  test.each([['not passed', undefined], ['false', false], ['the string "true"', 'true']])('switch %s: today\'s button — same words, grey (disabled), the small "Opening…" line', (_l, waitWord) => {
    const p = page({ waitWord });
    p.ready();
    p.click(p.go);
    expect(p.go.textContent).toBe(COPY.en.go);
    expect(p.go.disabled).toBe(true);
    expect(p.go.getAttribute('aria-busy')).toBeNull();
    expect(p.out.innerHTML).toBe(`<p class="small">${COPY.en.wait}</p>`);
    p.click(p.go);
    expect(p.joins()).toHaveLength(1);
  });

  test('switch on but no waiting line in the copy: today\'s button', () => {
    const p = page({ waitWord: true, copy: { noticeSave: 'S {n}', noticeReadings: 'R {n}', wait: COPY.en.wait } });
    p.ready();
    p.click(p.go);
    expect(p.go.textContent).toBe(COPY.en.go);
    expect(p.out.innerHTML).toBe(`<p class="small">${COPY.en.wait}</p>`);
  });
});
