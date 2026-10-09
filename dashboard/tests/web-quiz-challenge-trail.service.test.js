/**
 * The trail and "Missing number" on the Challenge page (public/wq/wq-challenge.js), run whole in the harness's vm:
 * the menu says trail:true (with its copy) ⇒ a map of stops with a gold badge for each first play; a phone with no
 * microphone sees the stops that need one as waiting, never failed, and never reaches getUserMedia; a stop played
 * again is a practice round under a banner; Missing number is a keypad whose answers go to the server as numbers.
 * Without trail:true the page is today's menu.
 */
const { page, ok, MENU, CLIPS } = require('./wqc-page-harness');

const TC = {
  title: "{name}'s Trail", sub: '{done} of {total} stops done. Pick any stop!', allDone: "You finished {name}'s Trail!", badge: 'Done',
  next: 'Next', mic: 'uses the microphone', needsMic: 'needs a microphone', micWait: 'This stop needs a microphone. It will wait for you!',
  other: 'Go to another stop', back: 'Back to the trail', practice: 'Practice round. Play as much as you like!', stopDone: 'Stop done!',
  missAsk: 'Which number is missing?', missYes: 'Yes! {n} goes here.', missWas: '{n} goes here. Let us try another.', missSkip: 'Skip',
};
const TRAIL = {
  lang: 'en', form: 'G3', record: true, trail: true, trail_copy: TC,
  exercises: [
    { id: 'bigger', name: 'Which is bigger?', mins: 2, done: true, last: null, badge: true },
    { id: 'missing', name: 'Missing number', mins: 2, done: false, last: null, badge: false },
    { id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true },
  ],
};
const ITEMS = [[5, 6, 7, null, 8], [14, 15, null, 17, 16], [20, null, 40, 50, 30], [null, 300, 400, 500, 200], [2, 4, 6, null, 8], [348, 349, null, 351, 350]]
  .map((r) => ({ seq: r.slice(0, 4), answer: r[4] }));
const MISSING = (extra = {}) => ({ ex: 'missing', ct: 'CTM', clips: CLIPS, record: true, trail: true, trail_copy: TC, items: ITEMS, practice: [{ seq: [1, 2, null, 4], answer: 3 }], stop_after: 4, first_key_s: 5, ...extra });
const type = async (p, digits) => { for (const d of String(digits)) await p.click(`wqc-k${d}`); await p.click('wqc-kok'); };
const sent = (p) => { const f = p.fetches.find((x) => /ch\/result$/.test(x.url)); return f && JSON.parse(f.init.body); };
// through the intro and the one practice row to the first measured item
const toItems = async (p) => {
  await p.click('wqc-ex-missing');
  await p.click('wqc-go');
  await type(p, 3);
  await p.runTimers((x) => x.ms === 1800);
  await p.runTimers((x) => x.ms === 300);
};

describe('without the trail the page is today\'s menu', () => {
  test('MENU has no trail: tiles, no stops, no badge', async () => {
    const p = page({ menu: MENU });
    expect(p.screen()).toBe('menu');
    expect(p.html()).not.toContain('wqc-stop');
  });
});

describe('the map', () => {
  test('a gold stop for each badge, the next stop marked, the mic stop says so; no number anywhere', async () => {
    const p = page({ menu: TRAIL, freshEls: true });
    expect(p.screen()).toBe('trail');
    const h = p.html();
    expect(h).toContain("Jugnu's Trail");
    expect(h).toContain('1 of 3 stops done. Pick any stop!');
    expect(h).toMatch(/class="wqc-stop wqc-gold" type="button" id="wqc-ex-bigger" data-badge="1"/);
    expect(h).toMatch(/class="wqc-stop wqc-nextup" type="button" id="wqc-ex-missing"/);
    expect(h).toContain('uses the microphone');
    expect(h).not.toMatch(/\d+\s*(\/|out of)\s*\d+|words a minute/);
  });

  test('every stop the phone can play done ⇒ the trail is finished, even with the mic stop waiting', async () => {
    const menu = { ...TRAIL, exercises: TRAIL.exercises.map((e) => ({ ...e, badge: e.id !== 'read' })) };
    const p = page({ menu, media: 'none', freshEls: true });
    expect(p.html()).toContain("You finished Jugnu's Trail!");
    expect(p.html()).toContain('needs a microphone');
  });
});

describe('a phone with no microphone is a branch, not a failure', () => {
  test('no mediaDevices: the read stop waits, labelled; tapping it opens the wait screen and never asks for the mic', async () => {
    const p = page({ menu: TRAIL, media: 'none', freshEls: true });
    expect(p.html()).toMatch(/id="wqc-ex-read" data-badge="0" data-wait="1"/);
    expect(p.html()).toContain('needs a microphone');
    expect(p.html()).not.toContain('uses the microphone');
    await p.click('wqc-ex-read');
    expect(p.screen()).toBe('mic-wait');
    expect(p.html()).toContain(TC.micWait);
    expect(p.html()).toContain('Go to another stop');
    expect(p.html()).not.toContain('Chrome');
    expect(p.fetches.filter((f) => /ch\/HUB\.TOKEN\/read/.test(f.url))).toHaveLength(0);
  });

  test('a refused microphone on a phone that cannot say whether it is denied: the wait screen (no Chrome), "try again", nothing kept', async () => {
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    const p = page({ menu: TRAIL, media: 'deny', storage, freshEls: true, routes: { 'ch/HUB.TOKEN/read': ok({ ex: 'read', ct: 'CT1', secs: 60, clips: CLIPS, record: true, trail: true, trail_copy: TC, story: { text: 'a b', tokens: ['a', 'b'], lines: [], dir: 'ltr' } }) } });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    expect(p.screen()).toBe('mic-wait');
    expect(p.html()).not.toContain('Chrome');
    expect(store.has('wqc_nomic')).toBe(false);
    expect(p.has('wqc-micagain')).toBe(true);
  });
});

describe('Missing number', () => {
  test('practice gives feedback; measured items give none; the answers go up as numbers with their timings', async () => {
    const p = page({ menu: TRAIL, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING()), 'ch/result$': ok({ score: { correct: 6, correct_5s: 6, n: 6, stopped: false } }) } });
    await p.click('wqc-ex-missing');
    expect(p.screen()).toBe('intro');
    await p.click('wqc-go');
    expect(p.screen()).toBe('missing-practice');
    await type(p, 3);
    expect(p.els['wqc-say'].textContent).toBe('Yes! 3 goes here.');
    expect(p.els['wqc-gap'].className).toContain('wqc-ok');
    await p.runTimers((x) => x.ms === 1800);
    await p.runTimers((x) => x.ms === 300);
    expect(p.screen()).toBe('missing-play');
    expect(p.html()).toContain('1 of 6');
    for (const it of ITEMS) {
      await p.click('wqc-k9'); await p.click('wqc-kdel');            // a key pressed and taken back
      await type(p, it.answer);
      expect(p.html()).not.toMatch(/wqc-ok|wqc-no|Yes!/);
      expect(p.els['wqc-gap'] ? p.els['wqc-gap'].className : '').not.toMatch(/wqc-ok|wqc-no/);
      await p.runTimers((x) => x.ms === 250);
    }
    const b = sent(p);
    expect(b.ct).toBe('CTM');
    expect(b.answers).toHaveLength(6);
    expect(b.answers[1]).toMatchObject({ i: 1, value: '16', keys: 5 });
    expect(typeof b.answers[1].ms).toBe('number');
    expect(typeof b.answers[1].first_key_ms).toBe('number');
    expect(p.screen()).toBe('missing-result');
    expect(p.html()).toContain('Stop done!');
    expect(p.html()).toContain('Back to the trail');
    expect(p.has('wqc-again')).toBe(false);
  });

  test('4 wrong or skipped in a row stop the run on the phone; skip shows only after 5 s and sends a null', async () => {
    const p = page({ menu: TRAIL, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING()), 'ch/result$': ok({ score: { correct: 0, correct_5s: 0, n: 6, stopped: true } }) } });
    await toItems(p);
    expect(p.html()).toMatch(/id="wqc-skip1" type="button" hidden/);
    await p.runTimers((x) => x.ms === 5000);
    expect(p.els['wqc-skip1'].hidden).toBe(false);
    await p.click('wqc-skip1');
    await p.runTimers((x) => x.ms === 250);
    for (let k = 0; k < 3; k += 1) { await type(p, 1); await p.runTimers((x) => x.ms === 250); }
    const b = sent(p);
    expect(b.answers).toHaveLength(4);
    expect(b.answers[0]).toMatchObject({ i: 0, value: null });
    // stopped: the badge still comes on the first play, the score line does not
    expect(p.html()).toContain('Stop done!');
    expect(p.has('wqc-score')).toBe(false);
  });

  test('the ✓ with nothing typed sends nothing', async () => {
    const p = page({ menu: TRAIL, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING()) } });
    await toItems(p);
    await p.click('wqc-kok');
    expect(p.screen()).toBe('missing-play');
    expect(p.html()).toContain('1 of 6');
  });
});

describe('a stop played again', () => {
  test('practice_round: the banner on every screen of the run, and no new badge at its end', async () => {
    const p = page({ menu: TRAIL, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING({ practice_round: true })), 'ch/result$': ok({ score: { correct: 6, correct_5s: 6, n: 6, stopped: false } }) } });
    await p.click('wqc-ex-missing');
    expect(p.html()).toContain(TC.practice);
    await toItemsFromIntro(p);
    expect(p.html()).toContain(TC.practice);
    p.w.missing.result({ correct: 6, n: 6, stopped: false });
    expect(p.html()).toContain(TC.practice);
    expect(p.html()).not.toContain('Stop done!');
  });
});
async function toItemsFromIntro(p) { await p.click('wqc-go'); await type(p, 3); await p.runTimers((x) => x.ms === 1800); await p.runTimers((x) => x.ms === 300); }

const TCH = { ...TC, helpAsk: 'On your own, or with help?', helpNo: 'On my own', helpYes: 'With help', micAgain: 'Try the microphone again' };
const TRAILH = { ...TRAIL, trail_copy: TCH };
const READ_EX = { ex: 'read', ct: 'CT1', secs: 60, clips: CLIPS, record: true, trail: true, trail_copy: TCH, story: { text: 'a b', tokens: ['a', 'b'], lines: [], dir: 'ltr' } };
const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

describe('the microphone memory keeps only a hard denial', () => {
  test('a dismissed prompt (NotAllowedError, permission still "prompt"): wait screen WITH "try again", nothing kept, the next open asks again', async () => {
    const storage = memStore();
    const p = page({ menu: TRAILH, media: 'deny', perm: 'prompt', storage, freshEls: true, routes: { 'ch/HUB.TOKEN/read': ok(READ_EX) } });
    await p.click('wqc-ex-read'); await p.click('wqc-help-no'); await p.click('wqc-go');
    expect(p.screen()).toBe('mic-wait');
    expect(p.has('wqc-micagain')).toBe(true);
    expect(storage.m.has('wqc_nomic')).toBe(false);
    await p.click('wqc-micagain');
    expect(p.fetches.filter((f) => /ch\/HUB\.TOKEN\/read/.test(f.url))).toHaveLength(2);
    p.w.menu();
    expect(p.html()).not.toContain('needs a microphone');
  });

  test('a hard denial (permission "denied"): kept on the phone, the wait screen has no "try again", the map shows the stop waiting', async () => {
    const storage = memStore();
    const p = page({ menu: TRAILH, media: 'deny', perm: 'denied', storage, freshEls: true, routes: { 'ch/HUB.TOKEN/read': ok(READ_EX) } });
    await p.click('wqc-ex-read'); await p.click('wqc-help-no'); await p.click('wqc-go');
    expect(p.screen()).toBe('mic-wait');
    expect(p.has('wqc-micagain')).toBe(false);
    expect(storage.m.get('wqc_nomic')).toBe('1');
    p.w.menu();
    expect(p.html()).toContain('needs a microphone');
  });

  test('a microphone granted later on the phone clears the memory', async () => {
    const storage = memStore(); storage.setItem('wqc_nomic', '1');
    const p = page({ menu: TRAILH, media: 'grant', storage, freshEls: true, routes: { 'ch/HUB.TOKEN/read': ok(READ_EX) } });
    expect(p.html()).toContain('needs a microphone');
    p.w.micStart();
    await p.flush();
    expect(storage.m.has('wqc_nomic')).toBe(false);
  });
});

describe('"On your own, or with help?"', () => {
  test('asked once per sitting with nothing preselected, its answer rides the run; the second stop is not asked again', async () => {
    const p = page({ menu: TRAILH, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING({ trail_copy: TCH })), 'ch/HUB.TOKEN/bigger': ok({ ex: 'bigger', ct: 'CTB', clips: CLIPS, trail: true, trail_copy: TCH, items: [], practice: [], stop_after: 4 }), 'ch/result$': ok({ score: { correct: 0, n: 6, stopped: true } }) } });
    await p.click('wqc-ex-missing');
    expect(p.screen()).toBe('help-ask');
    expect(p.html()).toContain('On your own, or with help?');
    expect(p.html()).not.toMatch(/aria-pressed|checked|selected/);
    await p.click('wqc-help-yes');
    expect(p.screen()).toBe('intro');
    await p.click('wqc-go'); await type(p, 3); await p.runTimers((x) => x.ms === 1800); await p.runTimers((x) => x.ms === 300);
    for (let k = 0; k < 4; k += 1) { await type(p, 1); await p.runTimers((x) => x.ms === 250); }
    expect(sent(p).helped).toBe(true);
    p.w.menu();
    await p.click('wqc-ex-bigger');
    expect(p.screen()).toBe('intro');
  });

  test('not on the trail: never asked, nothing sent', async () => {
    const p = page({ menu: MENU, routes: { 'ch/HUB.TOKEN/bigger': ok({ ex: 'bigger', ct: 'CTB', clips: CLIPS, items: [], practice: [], stop_after: 4 }), 'ch/result$': ok({ score: { correct: 0, n: 10, stopped: false } }) } });
    await p.click('wqc-ex-bigger');
    expect(p.screen()).toBe('intro');
    p.w.bigger.finish();
    await p.flush();
    expect(sent(p).helped).toBeUndefined();
  });
});

describe('the keypad', () => {
  test('no more digits than the answer has (a 3-digit row takes 3)', async () => {
    const p = page({ menu: TRAIL, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING({ items: [{ seq: [222, null, 226, 228], answer: 224 }] })), 'ch/result$': ok({ score: { correct: 1, n: 1, stopped: false } }) } });
    await toItems(p);
    for (const d of '22499') await p.click(`wqc-k${d}`);
    expect(p.els['wqc-gap'].textContent).toBe('224');
    await p.click('wqc-kok');
    await p.runTimers((x) => x.ms === 250);
    expect(sent(p).answers[0].value).toBe('224');
  });

  test('an item\'s clock starts at its row\'s paint, not at the clip before it', async () => {
    const clock = { t: 1000 };
    const p = page({ menu: TRAIL, clock, freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING()), 'ch/result$': ok({ score: { correct: 0, n: 6, stopped: true } }) } });
    await p.click('wqc-ex-missing'); await p.click('wqc-go');
    await type(p, 3);
    await p.runTimers((x) => x.ms === 1800);            // practice done ⇒ "Now on your own!" + Jugnu's clip
    clock.t = 60000;                                    // the clip and the pause take a long time
    await p.runTimers((x) => x.ms === 300);             // the first row paints now
    expect(p.screen()).toBe('missing-play');
    clock.t = 61500; await p.click('wqc-k8');
    clock.t = 62000; await p.click('wqc-kok');
    await p.runTimers((x) => x.ms === 250);
    for (let k = 0; k < 4; k += 1) { await type(p, 1); await p.runTimers((x) => x.ms === 250); }
    expect(sent(p).answers[0]).toMatchObject({ value: '8', first_key_ms: 1500, ms: 2000 });
  });
});

describe('numbers in Urdu on the trail are Western, isolated', () => {
  test('the map and the item counter write 1, 3, 2 — never ۱ ۳ ۲', async () => {
    const ur = { ...TRAIL, lang: 'ur', trail_copy: { ...TC, sub: '{total} میں سے {done} پڑاؤ مکمل۔ کوئی بھی پڑاؤ چنیں!' } };
    const p = page({ menu: ur, lang: 'ur', freshEls: true, routes: { 'ch/HUB.TOKEN/missing': ok(MISSING({ lang: 'ur' })) } });
    expect(p.html()).toContain('⁦3⁩ میں سے ⁦1⁩ پڑاؤ');
    expect(p.html()).toContain('⁦2⁩ منٹ');
    expect(p.html()).not.toMatch(/[۰-۹]/);
    await toItems(p);
    expect(p.html()).toContain('⁦6⁩ میں سے ⁦1⁩');
  });

  test('tc() isolates a number it fills into Urdu copy, and only in Urdu', async () => {
    const ur = { ...TRAIL, lang: 'ur', trail_copy: { ...TC, sub: '{total} میں سے {done} پڑاؤ مکمل۔' } };
    const pu = page({ menu: ur, lang: 'ur', freshEls: true });
    expect(pu.html()).toMatch(/⁦3⁩ میں سے ⁦1⁩ پڑاؤ مکمل/);
    const pe = page({ menu: TRAIL, freshEls: true });
    expect(pe.html()).toContain('1 of 3 stops done.');
    expect(pe.html()).not.toContain('⁦');
  });
});
