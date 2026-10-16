'use strict';
/**
 * The read-along timing arithmetic (web-quiz-readalong-timing.js, pure): recogniser tokens → words, printed ↔ spoken
 * matching (names spelled differently), every printed word timed (missed runs between, before and after heard words),
 * where pauses go, the tempo, and the stored file the player and the serve both accept.
 */
const Tm = require('../../../shared/services/quiz/web-quiz-readalong-timing');
const RA = require('../../../shared/services/quiz/web-quiz-readalong');

const sp = (t, s, e) => ({ t, s_ms: s, e_ms: e });

describe('recogniser tokens → spoken words', () => {
  test('a token starting with a space starts a word; the rest join it; the end time follows the last piece', () => {
    const tokens = [{ text: 'As', start_ms: 300, end_ms: 400 }, { text: 'ad', start_ms: 400, end_ms: 600 }, { text: ' played', start_ms: 700, end_ms: 1100 }, { text: '.', start_ms: 1100, end_ms: 1120 }];
    expect(Tm.sttWords(tokens)).toEqual([sp('Asad', 300, 600), sp('played.', 700, 1120)]);
  });
});

describe('printed ↔ spoken', () => {
  test('punctuation and case do not matter; Urdu letters are kept', () => {
    expect(Tm.norm('“Wall.”')).toBe('wall');
    expect(Tm.norm('گاؤں۔')).toBe('گاؤں');
  });
  test('a name the recogniser spells differently still matches (1 edit from 4 letters); short words must be exact', () => {
    expect(Tm.sameWord('asad', 'assad')).toBe(true);
    expect(Tm.sameWord('the', 'tha')).toBe(false);
    expect(Tm.sameWord('grandmother', 'grandmothers')).toBe(true);
  });
  test('an extra spoken word is skipped; a missed printed word is null; order is kept', () => {
    const printed = ['Asad', 'played', 'cricket.'];
    const spoken = [sp('Assad', 300, 600), sp('um', 610, 650), sp('cricket', 1200, 1800)];
    expect(Tm.match(printed, spoken).map(([i, h]) => [i, h && h.t])).toEqual([[0, 'Assad'], [1, null], [2, 'cricket']]);
  });
});

describe('every printed word timed', () => {
  test('a missed word between two heard words shares their gap by length', () => {
    const printed = ['Asad', 'played', 'cricket.'];
    const w = Tm.finalize(printed, [[0, sp('Asad', 300, 600)], [1, null], [2, sp('cricket', 1200, 1800)]], 3000);
    expect(w.map((x) => [x.s_ms, x.e_ms, x.src])).toEqual([[300, 600, 'stt'], [600, 1200, 'interp'], [1200, 1800, 'stt']]);
  });
  test('a missed FIRST word ends just before the first heard word, at the heard speaking rate — never stretched from 0', () => {
    const printed = ['Asad', 'played', 'cricket.'];
    const w = Tm.finalize(printed, [[0, null], [1, sp('played', 1700, 2300)], [2, sp('cricket', 2400, 3100)]], 5000);
    expect(w[0].src).toBe('interp');
    expect(w[0].e_ms).toBeLessThanOrEqual(1700);
    expect(w[0].s_ms).toBeGreaterThan(1000);
  });
  test('a missed LAST word starts just after the last heard word and stays inside the clip', () => {
    const w = Tm.finalize(['a', 'big', 'kite.'], [[0, sp('a', 100, 200)], [1, sp('big', 300, 600)], [2, null]], 900);
    expect(w[2].s_ms).toBeGreaterThanOrEqual(600);
    expect(w[2].e_ms).toBeLessThanOrEqual(900);
  });
  test('times never go back, whatever the recogniser said', () => {
    const w = Tm.finalize(['a', 'b', 'c'], [[0, sp('a', 500, 700)], [1, sp('b', 300, 400)], [2, sp('c', 900, 1000)]], 2000);
    for (let k = 1; k < w.length; k += 1) expect(w[k].s_ms).toBeGreaterThanOrEqual(w[k - 1].s_ms);
    w.forEach((x) => expect(x.e_ms).toBeGreaterThanOrEqual(x.s_ms));
  });
});

describe('pacing', () => {
  const printed = ['One', 'day,', 'Asad', 'ran.', 'He', 'won!'];
  const timed = [sp('One', 0, 200), sp('day', 250, 500), sp('Asad', 600, 900), sp('ran', 950, 1200), sp('He', 1400, 1500), sp('won', 1550, 1800)];
  test('silence goes in the middle of the gap after a sentence end (700) and a clause comma (250); never after the last word', () => {
    expect(Tm.pacePlan(printed, timed)).toEqual([{ i: 1, at_ms: 550, add_ms: 250 }, { i: 3, at_ms: 1300, add_ms: 700 }]);
    expect(Tm.pacePlan(['کچھ', 'دیر۔', 'پھر'], [sp('a', 0, 100), sp('b', 200, 300), sp('c', 500, 600)])).toEqual([{ i: 1, at_ms: 400, add_ms: 700 }]);
  });
  test('the tempo brings the clip to the wanted pace, never below the floor nor above 1', () => {
    // 6 words in 1.8 s = 200 wpm; at 100 wpm they need 3.6 s: with 0.95 s of silence, speech must stretch to 2.65 s
    expect(Tm.tempoFor(timed, 100, 950, 0.5)).toBeCloseTo(1800 / 2650, 4);
    expect(Tm.tempoFor(timed, 100, 950)).toBe(0.7);
    expect(Tm.tempoFor(timed, 400, 0)).toBe(1);
  });
  test('a page too short for sentence pauses gets even word gaps (≤ 250 ms) to reach the pace; a long one does not', () => {
    const one = ['It', 'is', 'a', 'sunny', 'day.'];
    const fast = [sp('It', 0, 100), sp('is', 150, 250), sp('a', 300, 350), sp('sunny', 400, 700), sp('day', 750, 1000)];
    const { cuts, tempo } = Tm.planPace(one, fast, 90, { floor: 0.65 });
    expect(tempo).toBe(0.65);
    expect(cuts.map((c) => c.i)).toEqual([0, 1, 2, 3]);
    expect(cuts.every((c) => c.add_ms === 250)).toBe(true);   // wanted 3.33 s, speech 1.54 s: capped at 250 a gap
    const slow = [sp('It', 0, 400), sp('is', 600, 1000), sp('a', 1200, 1500), sp('sunny', 1700, 2400), sp('day', 2600, 3300)];
    expect(Tm.planPace(one, slow, 90, { floor: 0.65 }).cuts).toEqual([]);
  });
  test('words a minute: first word start to last word end', () => {
    expect(Tm.wpmOf(timed)).toBe(200);
  });
});

describe('the stored file', () => {
  test('the serve accepts what the builder writes, for the text it was made from — and refuses it for any other', () => {
    const text = 'Asad played  cricket.';
    const words = Tm.finalize(Tm.printedWords(text), [[0, sp('Asad', 300, 600)], [1, sp('played', 700, 1100)], [2, sp('cricket', 1200, 1800)]], 2500);
    const f = Tm.timingFile({ id: 'en.read.2.story01', lang: 'en', text, audioName: 'sx-grace-12345678.ogg', audioMs: 2500.4, words, voice: { provider: 'soniox', voice: 'Grace' } });
    expect(f).toMatchObject({ v: 1, id: 'en.read.2.story01', lang: 'en', dir: 'ltr', audio: { url: 'sx-grace-12345678.ogg', ms: 2500 }, pace_wpm: 120, timing_src: 'stt_final' });
    expect(f.words.map((w) => w.t)).toEqual(['Asad', 'played', 'cricket.']);
    expect(RA.check(f, text)).toEqual({ ok: true, data: f });
    expect(RA.check(f, 'Asad played football.')).toEqual({ ok: false, why: 'text_hash' });
    expect(Tm.timingFile({ id: 'x', lang: 'ur', text: 'a', audioName: 'a.ogg', audioMs: 1, words: [{ i: 0, t: 'a', s_ms: 0, e_ms: 1 }] }).dir).toBe('rtl');
  });
});
