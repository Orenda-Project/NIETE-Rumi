/**
 * The Trail page v2 (public/wq/wq-trail.js, loaded only when the menu says v2) run with the real Challenge page in
 * the harness's vm. With v2 off the page is the base's (goldens captured from the base page code); with v2 on:
 * help asked once per sitting before the first scored stop (never before practice), sent as a string on every result;
 * the keep screen after the microphone, nothing preselected, its answer on the upload and the result; "Whose turn?"
 * from the serve's ask; on_its_way closes the stop (no mic, no upload); end cards carry no number about the child;
 * a stop opened by URL is what the serve says; the warm-up's stop_after 0 never stops; a listening story still being
 * recorded is "getting ready", never an error.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY } = H;
// BASE_SRC: run the same tests against another page source (the base's, for the red run)
const page = (o = {}) => H.page({ ...(process.env.BASE_SRC && !o.src ? { src: fs.readFileSync(process.env.BASE_SRC, 'utf8') } : {}), ...o });
const { renderChallengePage } = require(process.env.BASE_ROUTES || '../routes/web-quiz.routes');

const TRAIL_SRC = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8'); } catch (e) { return ''; } })();
const GOLDEN = path.join(__dirname, 'fixtures', 'trail-page-v2-off.golden.json');

const TC = {
  title: "{name}'s Trail", sub: '{done} of {total} stops done. Pick any stop!', allDone: "You finished {name}'s Trail!", badge: 'Done',
  next: 'Next', mic: 'uses the microphone', needsMic: 'needs a microphone', micWait: 'This stop needs a microphone. It will wait for you!',
  other: 'Go to another stop', back: 'Back to the trail', practice: 'Practice round. Play as much as you like!', stopDone: 'Stop done!',
  missAsk: 'Which number is missing?', missYes: 'Yes! {n} goes here.', missWas: '{n} goes here. Let us try another.', missSkip: 'Skip',
  helpAsk: 'On your own, or with help?', helpNo: 'On my own', helpYes: 'With help',
};
const EXS = [
  { id: 'missing', name: 'Missing number', mins: 2, done: false, last: null, badge: false, anchor_block: 'A1' },
  { id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true },
  { id: 'bigger', name: 'Which is bigger?', mins: 2, done: false, last: null, badge: false },
];
const V2 = { pool: true, story: false, consent: true };
const TRAIL = (v2 = V2) => ({ lang: 'en', form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, ...(v2 ? { v2 } : {}) });
const BIGGER = (extra = {}) => ({ ex: 'bigger', ct: 'CTB', clips: CLIPS, record: true, trail: true, trail_copy: TC, items: [{ a: 3, b: 5 }], practice: [], per_item_s: 10, stop_after: 4, v2: V2, ...extra });
const READ = (extra = {}) => ({ ex: 'read', ct: 'CTR', secs: 60, clips: CLIPS, story: STORY, record: true, trail: true, trail_copy: TC, v2: V2, ...extra });
const ITEMS = Array.from({ length: 10 }, (_, i) => ({ seq: [i + 1, i + 2, null, i + 4], answer: i + 3 }));
const MISSING = (extra = {}) => ({ ex: 'missing', ct: 'CTM', clips: CLIPS, record: true, trail: true, trail_copy: TC, items: ITEMS, practice: [{ seq: [1, 2, null, 4], answer: 3 }], stop_after: 4, first_key_s: 5, v2: V2, anchor_block: 'A1', ...extra });
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const v2page = (o = {}) => page({ menu: TRAIL(), freshEls: true, session: store(), pre: [TRAIL_SRC], ...o });
const bodies = (p, rx) => p.fetches.filter((f) => rx.test(f.url) && f.init && f.init.body).map((f) => JSON.parse(f.init.body));
const text = (h) => h.replace(/<[^>]+>/g, ' ');

describe('golden: with v2 off the page and its shell are the base\'s', () => {
  // the base page code is used to (re)capture: WRITE_TRAIL_PAGE_GOLDEN=1 BASE_SRC=<base wq-challenge.js>
  const shots = (src) => {
    const out = {};
    const MENU = { lang: 'en', form: 'G3', exercises: [{ id: 'bigger', name: 'Which is bigger?', mins: 2, done: true, last: { correct: 7, n: 10 } }, { id: 'read', name: 'Read aloud', mins: 2, done: true, last: { wcpm: 42 } }] };
    out.menu = page({ menu: MENU, src }).html();
    const t = page({ menu: TRAIL(null), src, freshEls: true });
    out.trail = t.html();
    t.w.S.data = READ({ v2: undefined });
    t.w.readResult({ score: { correct: 88, attempted: 90, stopped: false }, wcpm: 90, previous: { wcpm: 80 } });
    out.readEnd = t.html();
    t.w.S.data = BIGGER({ v2: undefined });
    t.w.bigger.result({ correct: 9, n: 10, stopped: false });
    out.biggerEnd = t.html();
    out.shell = renderChallengePage({ menu: TRAIL(null), token: 'HUB.TOKEN', kid: null, origin: 'https://portal.test', assetV: 'A', chV: 'C', brandKey: null });
    return out;
  };
  test('v2 absent → menu, trail, end cards and the page shell string-equal to the base', () => {
    const src = process.env.BASE_SRC ? fs.readFileSync(process.env.BASE_SRC, 'utf8') : undefined;
    const now = shots(src);
    expect(now).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });
  test('the shell loads wq-trail.js only when the menu says v2', () => {
    expect(renderChallengePage({ menu: TRAIL(), token: 'HUB.TOKEN', kid: null, origin: 'https://portal.test', assetV: 'A', chV: 'C', brandKey: null })).toMatch(/<script src="\/wq\/wq-trail\.js\?v=[0-9a-f]{10}" defer><\/script>\n<script src="\/wq\/wq-challenge\.js/);
  });
});

describe('the v2 trail map in Urdu', () => {
  test('Urdu digits for the minutes and the microphone on its own line, no Latin middot; English as today', () => {
    const ur = v2page({ lang: 'ur', menu: { ...TRAIL(), lang: 'ur', trail_copy: { ...TC, mic: 'مائیک استعمال ہوگا' } } }).html();
    expect(ur).toContain('۲ منٹ');
    expect(ur).toContain('<br>🎤 مائیک استعمال ہوگا');
    expect(ur).not.toContain('·');
    expect(v2page().html()).toContain('2 min · 🎤 uses the microphone');
  });
});

describe('the v2 trail map line: no count, no «پڑاؤ»', () => {
  const UR_TC = { ...TC, sub: '‏⁨{total}⁩ میں سے {done} پڑاؤ مکمل۔ کوئی بھی پڑاؤ چنیں!', allDone: 'آپ نے {name} کا راستہ مکمل کر لیا!' };
  const map = (badges, lang = 'ur') => v2page({ lang, menu: { ...TRAIL(), lang, trail_copy: lang === 'ur' ? UR_TC : TC, exercises: EXS.map((e, i) => ({ ...e, badge: badges[i] })) } }).html();
  test('several waiting → "Games are waiting", one → "A game is waiting", none → no line; never a digit or «پڑاؤ»', () => {
    const many = map([true, false, false]);
    expect(many).toContain('جگنو کے راستے پر کھیل آپ کا انتظار کر رہے ہیں۔');
    expect(map([true, true, false])).toContain('جگنو کے راستے پر ایک کھیل آپ کا انتظار کر رہا ہے۔');
    expect(map([true, true, true])).not.toContain('wqc-trail-sub');
    for (const h of [many, map([true, true, true]), map([false, false, false], 'en')]) {
      // the only number left on the map is a stop's minutes (a policy fact, COPY §B7), never a count about the child
      expect(text(h).replace(/[0-9۰-۹]+ (min|منٹ)/g, '')).not.toMatch(/[0-9۰-۹]/);
      expect(h).not.toContain('پڑاؤ');
    }
    expect(map([false, false, false], 'en')).toContain('Games are waiting for you on the Trail.');
  });
});

describe('no «پڑاؤ» on a v2 screen (ruled jg.trail.* copy)', () => {
  const UR_TC = { ...TC, sub: '‏⁨{total}⁩ میں سے {done} پڑاؤ مکمل۔ کوئی بھی پڑاؤ چنیں!', micWait: 'اس پڑاؤ کے لیے مائیک چاہیے۔ یہ انتظار کرے گا!', other: 'کسی اور پڑاؤ پر جائیں', stopDone: 'پڑاؤ مکمل!', practice: 'مشق کا دور۔ جتنا چاہیں کھیلیں!' };
  test('map, mic wait and practice banner use the ruled lines (Urdu)', async () => {
    const menu = { ...TRAIL(), lang: 'ur', trail_copy: UR_TC };
    const p = v2page({ lang: 'ur', menu, routes: { 'ch/HUB.TOKEN/bigger': ok(BIGGER({ practice_round: true, trail_copy: UR_TC })) } });
    const seen = [p.html()];
    p.w.micWait(true); seen.push(p.html());
    expect(p.html()).toContain('اس کھیل کے لیے مائیک چاہیے۔ مائیک چلنے پر کھیلیں۔');
    expect(p.html()).toContain('کوئی اور کھیل کھیلیں');
    p.w.open('bigger'); await p.flush(); seen.push(p.html());
    expect(p.html()).toContain('یہ کھیل دوبارہ: بس مزے کے لیے');
    seen.forEach((h) => expect(h).not.toContain('پڑاؤ'));
  });
});

describe('held-back keep lines do not ship', () => {
  test('the page copy has no 90-day or STOP keep strings, in English or Urdu', () => {
    const vm = require('vm');
    const ctx = { window: {}, document: {} };
    vm.createContext(ctx);
    vm.runInContext(TRAIL_SRC, ctx);
    for (const l of ['en', 'ur']) {
      const T = ctx.window.WQTRAIL.T[l];
      expect(T).not.toHaveProperty('keepSub');
      expect(T).not.toHaveProperty('keepStop');
      expect(JSON.stringify(T)).not.toMatch(/90 days|۹۰ دن|STOP/);
    }
  });
});

describe('help: once per sitting, before the first scored stop, sent as a string', () => {
  test('asked before the first stop, nothing preselected; the answer rides every result; not asked again', async () => {
    const p = v2page({ routes: { 'ch/HUB\\.TOKEN\\?': ok(TRAIL()), 'ch/HUB.TOKEN/bigger': ok(BIGGER()), 'ch/result': ok({ score: { correct: 1, n: 1, stopped: false } }) } });
    await p.click('wqc-ex-bigger');
    expect(p.screen()).toBe('help-ask');
    expect(p.html()).toContain('Is someone helping you today?');
    expect(p.html()).toContain('You get the sticker both ways.');
    expect(p.html()).not.toMatch(/aria-pressed="true"|checked/);
    await p.click('wqc-help-yes');
    expect(p.events.find((e) => e.n === 'ch_helped')).toMatchObject({ v: 'helped' });
    p.w.bigger.taps = [];
    p.w.bigger.finish();
    await p.flush();
    expect(bodies(p, /ch\/result$/)[0].helped).toBe('helped');
    await p.click('wqc-menu');
    await p.click('wqc-ex-bigger');
    expect(p.screen()).toBe('intro');
    p.w.bigger.taps = [];
    p.w.bigger.finish();
    await p.flush();
    expect(bodies(p, /ch\/result$/)[1].helped).toBe('helped');
  });
  test('never before a practice round', async () => {
    const p = v2page({ routes: { 'ch/HUB.TOKEN/bigger': ok(BIGGER({ practice_round: true })) } });
    await p.click('wqc-ex-bigger');
    expect(p.screen()).toBe('intro');
    expect(p.html()).toContain('Playing again: just for fun');
  });
});

describe('keep this reading? after the microphone, nothing preselected', () => {
  test('mic on → keep screen; "No" → audio_consent kept_no on the upload and the result', async () => {
    const p = v2page({ session: (() => { const s = store(); s.setItem('wqc_helped_v2:', 'self'); return s; })(),
      routes: { 'ch/HUB.TOKEN/read': ok(READ()), 'ch/upload': ok({ put_url: 'https://r2.test/put', key: 'k', content_type: 'audio/webm' }), 'r2.test': ok({}), 'ch/result': ok({ score: { correct: 30, attempted: 30 }, wcpm: 30 }) } });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    expect(p.screen()).toBe('keep-ask');
    const h = p.html();
    expect(h).toContain('May Jugnu keep this reading to check that it heard right?');
    // retention lines held back pending a ruling on retention copy (kept readings are not deleted after 90 days)
    expect(h).not.toMatch(/90 days|STOP|deleted/);
    // copy.v2.json v2.1: jg.keep.sub_v2 (no «جانچ», no checker job title), then jg.keep.ask_grownup above the two answers.
    expect(h).toContain('Kept so one person can listen and confirm Jugnu heard right. A grown-up can say no.');
    expect(h).toMatch(/Ask a grown-up this one\.<\/p><div class="wq-stack"><button[^>]*id="wqc-keep-yes"/);
    expect(h).toContain('Jugnu listens either way.');
    expect(h).not.toMatch(/aria-pressed="true"|checked/);
    await p.click('wqc-keep-no');
    p.w.rec.chunks = [{ size: 4000 }];
    p.w.upload();
    await p.flush();
    expect(bodies(p, /ch\/upload$/)[0]).toMatchObject({ ct: 'CTR', audio_consent: 'kept_no' });
    expect(bodies(p, /ch\/result$/)[0]).toMatchObject({ audio_consent: 'kept_no', helped: 'self' });
  });
});

describe('"Whose turn?" from the serve; the page never picks', () => {
  const ASK = { ask: 'whose_turn', kids: [{ chip: 'c1', first: 'Zara', animal: 'owl' }, { chip: 'c2', first: 'Ali', animal: 'cat', line2: 'Class 3', avatarLine: true }] };
  test('menu ask → chips, no exercise request until a tap; a tap reloads with kid', async () => {
    const p = v2page({ menu: { ...TRAIL(), ...ASK } });
    expect(p.screen()).toBe('whose-turn');
    const h = p.html();
    expect(h).toContain('Whose turn?');
    expect(h).toContain('Tap your name.');
    expect(h).toMatch(/role="img" aria-label="owl">🦉/);
    expect(h).toContain('Played on this phone before');
    expect(p.fetches.filter((f) => /\/api\/wq\/ch\//.test(f.url))).toEqual([]);
    await p.click('wqc-who-c2');
    expect(p.loc.href).toContain('kid=c2');
  });
  test('"Someone else": a child who is not remembered never taps another child\'s name; it opens the hub with nobody picked', async () => {
    const p = v2page({ menu: { ...TRAIL(), ...ASK } });
    expect(p.screen()).toBe('whose-turn');
    expect(p.html()).toMatch(/id="wqc-who-else"[^>]*>Someone else</);
    await p.click('wqc-who-else');
    expect(p.loc.href).toBe('/h/HUB.TOKEN?from=home');
    expect(p.loc.href).not.toContain('kid=');
    expect(p.fetches.filter((f) => /\/api\/wq\/ch\//.test(f.url))).toEqual([]);
  });
  test('deep link #read with an ask payload → "Whose turn?"', async () => {
    const p = v2page({ href: 'https://portal.test/c/HUB.TOKEN#read', routes: { 'ch/HUB.TOKEN/read': ok({ ...ASK }) } });
    await p.flush();
    expect(p.screen()).toBe('whose-turn');
  });
  test('deep link #read with practice_round → the practice banner', async () => {
    const p = v2page({ href: 'https://portal.test/c/HUB.TOKEN#read', routes: { 'ch/HUB.TOKEN/read': ok(READ({ practice_round: true })) } });
    await p.flush();
    expect(p.html()).toContain('Playing again: just for fun');
  });
});

describe('serve outcomes', () => {
  test('on_its_way → a card, the stop closed: no mic, no upload', async () => {
    const p = v2page({ href: 'https://portal.test/c/HUB.TOKEN#read', routes: { 'ch/HUB.TOKEN/read': ok({ ex: 'read', draw: { outcome: 'on_its_way' } }) } });
    await p.flush();
    expect(p.screen()).toBe('on-its-way');
    expect(p.html()).toContain('A new story is on its way.');
    expect(p.has('wqc-go')).toBe(false);
    expect(p.fetches.filter((f) => /ch\/upload/.test(f.url))).toEqual([]);
    expect(p.mic.ctx).toBe(0);
  });
  test('lower_band → the ordinary passage screen', async () => {
    const p = v2page({ session: (() => { const s = store(); s.setItem('wqc_helped_v2:', 'self'); return s; })(), routes: { 'ch/HUB.TOKEN/read': ok(READ({ draw: { outcome: 'lower_band' } })) } });
    await p.click('wqc-ex-read');
    expect(p.screen()).toBe('intro');
  });
});

describe('end cards under v2: what was done, never a number', () => {
  const end = (r) => {
    const p = v2page();
    p.w.S.data = READ();
    p.w.readResult(r);
    return p.html();
  };
  test('0 words and 90 words: no digit in the card, the same sticker line', () => {
    const zero = end({ score: { correct: 0, attempted: 0, stopped: false }, wcpm: 0 });
    const ninety = end({ score: { correct: 88, attempted: 90, stopped: false }, wcpm: 90, previous: { wcpm: 80 } });
    expect(text(zero)).not.toMatch(/\d/);
    expect(text(ninety)).not.toMatch(/\d/);
    expect(zero).toContain('You tried a whole new story!');
    expect(ninety).toContain('You read the whole story!');   // the fixture story is 10 words
    expect(end({ score: { correct: 4, attempted: 5, stopped: true }, wcpm: 4 })).toContain('You read out loud with Jugnu!');
    const sticker = (h) => (/<p class="wq-sub" id="wqc-sticker">[^<]*<\/p>/.exec(h) || [])[0];
    expect(sticker(zero)).toBe(sticker(ninety));
    expect(sticker(zero)).toContain('A sticker went into your Book.');
  });
  test('bigger / missing answered to the end → "You answered all the questions!" with the sticker', () => {
    const p = v2page();
    p.w.S.data = BIGGER();
    p.w.bigger.result({ correct: 6, n: 10, stopped: false });
    expect(p.html()).toContain('You answered all the questions!');
    expect(p.html()).toContain('A sticker went into your Book.');
    expect(text(p.html())).not.toMatch(/\d/);
  });
  test('bigger / missing stopped early → never "answered all"; only the sticker line and Home', () => {
    for (const [ex, data] of [['bigger', BIGGER()], ['missing', MISSING({ anchor_block: null })]]) {
      const p = v2page();
      p.w.S.data = data;
      p.w[ex].result({ correct: 2, n: 10, stopped: true });
      const h = p.html();
      expect(h).not.toContain('You answered all the questions!');
      expect(h).toContain('A sticker went into your Book.');
      expect(h).toContain('id="wqc-menu"');
      expect(text(h)).not.toMatch(/\d/);
    }
  });
  test('the whole story read, with the resolver\'s next title and read-along-first', () => {
    const p = v2page();
    p.w.S.data = READ({ next: { kind: 'story', title: 'The Kite' }, read_along_first: true });
    p.w.readResult({ score: { correct: 10, attempted: 10, stopped: false }, wcpm: 50 });
    const h = p.html();
    expect(h).toContain('You read the whole story!');
    expect(h).toContain('Next: The Kite');
    expect(h).toContain('Next time Jugnu can read a story with you first.');
  });
  test('warm-up: its title on the stop, its own lines; stop_after 0 never stops (6 misses still reach item 10)', async () => {
    const p = v2page({ session: (() => { const s = store(); s.setItem('wqc_helped_v2:', 'self'); return s; })(), routes: { 'ch/HUB.TOKEN/missing': ok(MISSING({ stop_after: 0 })), 'ch/result': ok({ score: { correct: 4, n: 10, stopped: false } }) } });
    expect(p.html()).toContain('Number warm-up');
    await p.click('wqc-ex-missing');
    expect(p.html()).toContain("Let's start with some numbers.");
    p.w.S.data = MISSING({ stop_after: 0 });
    const shown = [];
    const realScreen = p.w.missing.screen;
    p.w.missing.screen = function (name, it, ask, k, n) { shown.push(k); };
    p.w.missing.answers = []; p.w.missing.miss = 6;   // six misses in a row so far
    p.w.missing.item(9);
    p.w.missing.screen = realScreen;
    expect(shown).toEqual([10]);
    expect(p.screen()).not.toBe('missing-wait');
  });
});

describe('Story Time room (no story payload from the serve yet)', () => {
  test('?room=story with the story switch → the banner and "on its way"; nothing is requested', async () => {
    const p = v2page({ menu: TRAIL({ ...V2, story: true }), href: 'https://portal.test/c/HUB.TOKEN?room=story&pid=en.read.1.kite' });
    expect(p.screen()).toBe('story');
    expect(p.html()).toContain('Story Time: just for fun');
    expect(p.html()).toContain('A new story is on its way.');
    expect(p.fetches.filter((f) => /\/api\/wq\/ch\//.test(f.url))).toEqual([]);
  });
  test('?room=story with the story switch off → the trail', async () => {
    const p = v2page({ href: 'https://portal.test/c/HUB.TOKEN?room=story&pid=x' });
    expect(p.screen()).toBe('trail');
  });
});

describe('a listening story still being recorded', () => {
  test('503 getting_ready → today\'s friendly line with "try again", never the error screen; it retries', async () => {
    const p = v2page({ routes: { 'ch/HUB.TOKEN/listen': () => ({ status: 503, body: { error: 'getting_ready' } }) } });
    p.w.open('listen');
    await p.flush();
    expect(p.screen()).toBe('getting-ready');
    expect(p.has('wqc-retry')).toBe(true);
    expect(p.timers.some((x) => x.ms === 2000)).toBe(true);
  });
  test('a served listen with no clip yet → getting ready, not a dead screen', async () => {
    const p = v2page({ routes: { 'ch/HUB.TOKEN/listen': ok({ ex: 'listen', ct: 'CTL', clips: CLIPS, story_clip: { url: null }, v2: V2 }) } });
    p.w.open('listen');
    await p.flush();
    expect(p.screen()).toBe('getting-ready');
  });
});
