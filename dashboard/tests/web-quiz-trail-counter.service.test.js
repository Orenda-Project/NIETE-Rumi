/**
 * The Trail's item counter and its "All done!" screen (public/wq/wq-challenge.js with wq-trail.js loaded, as the
 * menu's v2 says), run in the harness's vm. Under v2 in Urdu the counter is drawn at 20 px with the keypad's
 * digits, Western, each in an LTR isolate («⁦10⁩ میں سے ⁦1⁩», COPY §C beside a Western keypad); English and every page without v2 keep today's line byte for byte. Under v2 the
 * "All done!" line after the last item shows the happy pose, never the puzzled one.
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
const EXS = [
  { id: 'missing', name: 'Missing number', mins: 2, done: false, last: null, badge: false, anchor_block: 'A1' },
  { id: 'bigger', name: 'Which is bigger?', mins: 2, done: false, last: null, badge: false },
];
const V2 = { pool: true, story: false, consent: false };
const TRAIL = (lang, v2) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, ...(v2 ? { v2 } : {}) });
const ITEMS = Array.from({ length: 10 }, (_, i) => ({ seq: [i + 1, i + 2, null, i + 4], answer: i + 3 }));
const MISSING = (v2) => ({ ex: 'missing', ct: 'CTM', clips: { ...CLIPS, stop: { text: 'All done!', url: null } }, record: true, trail: true, trail_copy: TC, items: ITEMS, practice: [{ seq: [1, 2, null, 4], answer: 3 }], stop_after: 4, first_key_s: 5, anchor_block: 'A1', ...(v2 ? { v2 } : {}) });
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const open = (lang, v2) => H.page({ lang, menu: TRAIL(lang, v2), freshEls: true, session: store(), pre: v2 ? [TRAIL_SRC] : [], routes: { 'ch/HUB.TOKEN/missing': ok(MISSING(v2)), 'ch/result': ok({ score: { correct: 4, n: 10, stopped: false } }) } });
// the warm-up's item screen, item 1 of 10, drawn as the page draws it
const itemOne = (p, v2) => { p.w.S.data = MISSING(v2); p.w.missing.screen('missing-q', ITEMS[0], 'Which number is missing?', 1, 10); return p.html(); };
const counter = (h) => (h.match(/<p class="wq-small[^"]*"[^>]*id="wqc-of"[^>]*>[^<]*<\/p>/) || [null])[0];

describe('the warm-up counter (row 14)', () => {
  test('Urdu under v2: the keypad\'s Western digits, each isolated, at 20 px (one digit system on the screen)', () => {
    const h = itemOne(open('ur', V2), V2);
    expect(counter(h)).toBe('<p class="wq-small wqc-of-ur" id="wqc-of" style="font-size:20px;line-height:1.9">⁦10⁩ میں سے ⁦1⁩</p>');
    expect(counter(h)).not.toMatch(/[\u06F0-\u06F9]/);   // no Urdu digit beside the Western keypad
  });

  test('English under v2: today\'s line', () => {
    expect(counter(itemOne(open('en', V2), V2))).toBe('<p class="wq-small" id="wqc-of">1 of 10</p>');
  });

  test('golden: Urdu without v2 (the trail alone) is today\'s line, byte for byte', () => {
    expect(counter(itemOne(open('ur', null), null))).toBe('<p class="wq-small" id="wqc-of">⁦' + '10' + '⁩ میں سے ⁦' + '1' + '⁩</p>');
  });

  test('"Which is bigger?" and the questions after a reading use the same counter under v2 in Urdu', () => {
    const p = open('ur', V2);
    const h = p.w.bigger.pairHtml({ a: 3, b: 5 }, 'Which is bigger?', 2, 10);
    expect(h).toContain('<p class="wq-small wqc-of-ur" style="font-size:20px;line-height:1.9">⁦10⁩ میں سے ⁦2⁩</p>');
    const en = open('en', V2).w.bigger.pairHtml({ a: 3, b: 5 }, 'Which is bigger?', 2, 10);
    expect(en).toContain('<p class="wq-small">2 of 10</p>');
  });
});

describe('"All done!" after the last item', () => {
  const pose = (h) => (/wq-jimg"><img src="[^"]*?([a-z]+)\.webp"/.exec(h) || [])[1];
  test('under v2: the happy pose, never the puzzled one', async () => {
    const p = open('ur', V2);
    p.w.S.data = MISSING(V2);
    p.w.missing.finish();
    expect(p.screen()).toBe('missing-wait');
    expect(pose(p.html())).toBe('hello');
  });
  test('golden: without v2, today\'s pose', async () => {
    const p = open('ur', null);
    p.w.S.data = MISSING(null);
    p.w.missing.finish();
    expect(p.screen()).toBe('missing-wait');
    expect(pose(p.html())).toBe('thinking');
  });
});
