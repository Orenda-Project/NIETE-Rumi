/**
 * A class round turn on the Challenge page (public/wq/wq-challenge.js + wq-trail.js, run whole in the harness's vm;
 * only the browser and the network are faked). A round run is no voluntary counted stop (the sampling design's NC4): when the
 * serve says round_turn the end card prints no sticker line and its only button hands the phone back to the round
 * page; the turn's trail shows the games already stored for this turn done and does not start them again. A check run's
 * end card keeps its sticker line and Home.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const { ok, CLIPS } = H;

const TRAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8');
const TC = {
  title: "{name}'s Trail", sub: '{done} of {total} stops done. Pick any stop!', allDone: "You finished {name}'s Trail!", badge: 'Done',
  next: 'Next', mic: 'uses the microphone', needsMic: 'needs a microphone', micWait: 'This stop needs a microphone. It will wait for you!',
  other: 'Go to another stop', back: 'Back to the trail', practice: 'Practice round. Play as much as you like!', stopDone: 'Stop done!',
  missAsk: 'Which number is missing?', missYes: 'Yes! {n} goes here.', missWas: '{n} goes here. Let us try another.', missSkip: 'Skip',
  helpAsk: 'On your own, or with help?', helpNo: 'On my own', helpYes: 'With help',
};
const V2 = { pool: true, story: false, consent: false };
const BACK = '/c/HUB.TOKEN/back?lang=en';
const HANDBACK = { en: 'Thanks for playing! Hand the phone to your teacher.', ur: 'کھیلنے کا شکریہ! اب فون ٹیچر کو دے دیں۔' };
const ROUND = (lang = 'en') => ({ round_turn: true, round_back: BACK.replace('lang=en', `lang=${lang}`), round_handback: HANDBACK[lang], round_say: 'Not sure? That is fine. Tap the arrow.' });
const EXS = (stored = []) => [
  { id: 'missing', name: 'Missing number', mins: 2, done: stored.includes('missing'), last: null, badge: stored.includes('missing'), anchor_block: 'A1' },
  { id: 'bigger', name: 'Which is bigger?', mins: 2, done: stored.includes('bigger'), last: null, badge: stored.includes('bigger') },
];
const TRAIL = ({ lang = 'en', stored = [], round = true } = {}) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS(stored), v2: V2, ...(round ? { round_turn: true } : {}) });
const BIGGER = (extra = {}) => ({ ex: 'bigger', ct: 'CTB', clips: CLIPS, record: true, trail: true, trail_copy: TC, items: [{ a: 3, b: 5 }], practice: [], per_item_s: 10, stop_after: 4, v2: V2, ...extra });
const ITEMS = Array.from({ length: 10 }, (_, i) => ({ seq: [i + 1, i + 2, null, i + 4], answer: i + 3 }));
const MISSING = (extra = {}) => ({ ex: 'missing', ct: 'CTM', clips: CLIPS, record: true, trail: true, trail_copy: TC, items: ITEMS, practice: [], stop_after: 4, first_key_s: 5, v2: V2, ...extra });
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const v2page = (o = {}) => H.page({ menu: TRAIL(o.menuOpts || {}), freshEls: true, session: store(), pre: [TRAIL_SRC], ...o });
const buttons = (h) => (h.match(/<(button|a) [^>]*class="wq-btn[^"]*"[^>]*>/g) || []);

describe('a round turn\'s end card: no sticker, the hand-back is the only button', () => {
  const cases = [
    ['bigger', 'answered to the end', () => BIGGER(ROUND()), { correct: 6, n: 10, stopped: false }],
    ['bigger', 'stopped early', () => BIGGER(ROUND()), { correct: 2, n: 10, stopped: true }],
    ['missing', 'the warm-up', () => MISSING({ ...ROUND(), anchor_block: 'A1' }), { correct: 8, n: 10, stopped: false }],
    ['missing', 'stopped early', () => MISSING(ROUND()), { correct: 1, n: 10, stopped: true }],
  ];
  test.each(cases)('round end card has no #wqc-sticker (%s, %s); its only button goes to /r/<tok>/round', async (ex, _what, data, score) => {
    const p = v2page();
    p.w.S.data = data();
    p.w[ex].result(score);
    const h = p.html();
    expect(h).not.toContain('wqc-sticker');
    expect(h).not.toContain('A sticker went into your Book.');
    expect(h).not.toContain('id="wqc-menu"');
    const bs = buttons(h);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toContain('id="wqc-handback"');
    expect(h).toContain(HANDBACK.en);
    // a tap goes to the round page of the same report token: nothing is fetched, no menu reload
    const before = p.fetches.length;
    await p.click('wqc-handback');
    expect(p.loc.href).toBe(BACK);
    expect(p.fetches.slice(before).filter((f) => f.url !== '/api/wq/e')).toEqual([]);
  });

  test('Urdu: the hand-back line in Urdu, no sticker line', () => {
    const p = v2page({ lang: 'ur', menuOpts: { lang: 'ur' } });
    p.w.S.data = BIGGER(ROUND('ur'));
    p.w.bigger.result({ correct: 2, n: 10, stopped: true });
    const h = p.html();
    expect(h).toContain(HANDBACK.ur);
    expect(h).not.toContain('wqc-sticker');
    expect(h).not.toContain('آپ کی کتاب میں ایک اسٹیکر لگ گیا۔');
  });
});

describe('golden: a check run keeps its end card', () => {
  test('a check run\'s end card keeps the sticker line and Home, no hand-back', () => {
    for (const stopped of [false, true]) {
      const p = v2page({ menu: TRAIL({ round: false }) });
      p.w.S.data = BIGGER();
      p.w.bigger.result({ correct: 6, n: 10, stopped });
      const h = p.html();
      expect(h).toContain('A sticker went into your Book.');
      expect(h).toContain('id="wqc-menu"');
      expect(h).not.toContain('wqc-handback');
    }
    // the same card string for a payload without round_turn as before (no round keys → today's markup)
    const a = v2page({ menu: TRAIL({ round: false }) });
    a.w.S.data = BIGGER();
    a.w.bigger.result({ correct: 6, n: 10, stopped: false });
    expect(a.html()).toContain('<p class="wq-sub" id="wqc-sticker">⭐ A sticker went into your Book.</p><div class="wq-stack"><button class="wq-btn wq-go" id="wqc-menu" type="button">Home</button></div>');
  });
  test('a practice round on the trail still says "Stop done!" with no sticker and Home', () => {
    const p = v2page({ menu: TRAIL({ round: false }) });
    p.w.S.data = BIGGER({ practice_round: true });
    p.w.bigger.result({ correct: 2, n: 10, stopped: true });
    expect(p.html()).toContain('id="wqc-menu"');
    expect(p.html()).not.toContain('wqc-sticker');
  });
});

describe('the turn\'s trail: the stored games are done and not started again', () => {
  test.each([['a remembered profile', () => store()], ['a fresh profile (no storage)', () => null]])('a turn resumed after game 1 shows game 1 done (%s)', async (_what, mk) => {
    const p = H.page({ menu: TRAIL({ stored: ['missing'] }), freshEls: true, storage: mk(), session: mk(), pre: [TRAIL_SRC],
      routes: { 'ch/HUB.TOKEN/missing': ok(MISSING(ROUND())), 'ch/HUB.TOKEN/bigger': ok(BIGGER(ROUND())) } });
    await p.flush();
    const h = p.html();
    expect(p.screen()).toBe('trail');
    // game 1 gold with its Done pill, game 2 is Next
    expect(h).toMatch(/id="wqc-ex-missing" data-badge="1"/);
    expect(h).toMatch(/id="wqc-ex-bigger" data-badge="0"/);
    expect(h).toMatch(/wqc-stop wqc-nextup" type="button" id="wqc-ex-bigger"/);
    expect((h.match(/wqc-pnext/g) || []).length).toBe(1);
    // tapping the played game starts nothing (the server would refuse a second run): no serve, still the trail
    await p.click('wqc-ex-missing');
    expect(p.fetches.filter((f) => /ch\/HUB\.TOKEN\/missing/.test(f.url))).toEqual([]);
    expect(p.screen()).toBe('trail');
    // game 2 still opens
    await p.click('wqc-ex-bigger');
    expect(p.fetches.filter((f) => /ch\/HUB\.TOKEN\/bigger/.test(f.url))).toHaveLength(1);
  });

  test('golden: off the round a done stop still opens (the practice round)', async () => {
    const p = H.page({ menu: TRAIL({ stored: ['missing'], round: false }), freshEls: true, session: store(), pre: [TRAIL_SRC],
      routes: { 'ch/HUB.TOKEN/missing': ok(MISSING({ practice_round: true })) } });
    await p.flush();
    await p.click('wqc-ex-missing');
    expect(p.fetches.filter((f) => /ch\/HUB\.TOKEN\/missing/.test(f.url))).toHaveLength(1);
  });
});
