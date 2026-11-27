'use strict';
/**
 * The content owner's picks (27 Nov 2026) among the takes staged for the 26 Nov letter swaps, and the two cards she
 * changed with them.
 *
 * Clips. Each picked letter resolves through the committed coach batteries to the clip a phone plays: the picker row's
 * prompt_audio (sa/v5/<lang>/sha1(lang|text)[:12].mp3), or for the letter-names practice example ک the model's «کاف» clip
 * (named under sa/v1, served from sa/v4 by sa_voice_v4; ک is the example while sa_r28_letter_pick is ON). The bytes
 * under that key are the picked take (its sha256, in base64 so no hex digest reads as a phone number to the fixture
 * rule), and prompt_timings.json holds the timings measured on the picked file, not on the take it replaced.
 *
 * Cards. On the ت screen ٹ becomes ج (ٹ looks too close to ت); on the W screen v becomes z. Every other picker row,
 * Urdu and English, test and practice, keeps the five cards it had, in the same order (the control).
 *
 * Not here: the English j take. No screen says /j/ yet (the English test has no T for it to replace), and a clip under
 * sa/v5 that no battery names fails sa-r28-v5-clips, so it is added with the row that plays it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const REPO = path.join(__dirname, '..', '..');
const DASH = path.join(REPO, 'dashboard');
const DATA = path.join(REPO, 'bot', 'shared', 'data', 'child-test', 'sa');
const PAGES = [1, 2, 3, 4, 5].flatMap((g) => ['ur', 'en'].map((page) => `sa.coach.G${g}.A.${page}.json`));
const battery = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
// served as staging and production serve it: every switch before round 28 ON, and the letter-sound picker's ON
const LETTER_PICK_ON = { ...Object.fromEntries(Object.keys(SWITCHES).map((k) => [k, !/^r28/.test(k)])), r28LetterPick: true };
const task = (b, id) => b.tasks.find((t) => t.id === id);
const sha256 = (key) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DASH, key))).digest('base64');
const TIMINGS = JSON.parse(fs.readFileSync(path.join(DASH, 'sa', 'v5', 'prompt_timings.json'), 'utf8'));
const t3 = (start, end, dur, spans) => ({ speech_start_ms: start, speech_end_ms: end, dur_ms: dur, first_end_ms: spans[0][1], speech_spans_ms: spans });

// [letter, task, items|practice, take, the key it is served under, sha256 (base64), the picked file's timings]
const PICKS = [
  ['ا', 'ur.letter_pick10', 'items', 'C', 'sa/v5/ur/025b34d4fe2f.mp3', 'dBNxhNKv+Hj8Q9tzV3pZXdzauX38zcUEp1qilKPWATQ=',
    t3(308, 1693, 1814, [[308, 439], [935, 1066], [1562, 1693]])],
  ['ت', 'ur.letter_pick10', 'items', 'B', 'sa/v5/ur/6cbe48d95dc1.mp3', 'O8gKgffm6VsERWdrA76ulSgyJNJPcnnKvgayTKYWFhk=',
    t3(304, 1683, 1804, [[304, 429], [931, 1056], [1558, 1683]])],
  ['k', 'en.letter_pick10', 'practice', 'C', 'sa/v5/en/fa6a577d1290.mp3', '8ZTuLzFKC4jx7wwRYoWO0YV4gQOvq+37UY7mZEX+krM=',
    t3(310, 1543, 1667, [[310, 394], [884, 968], [1459, 1543]])],
  ['g', 'en.letter_pick10', 'items', 'C', 'sa/v5/en/6cc5c36d85b2.mp3', 'l/l91H/5AO8Y3RUyfEPtNLRBKxzAVvCiQsEXf4IenGY=',
    t3(310, 1691, 1819, [[310, 438], [937, 1065], [1564, 1691]])],
  ['w', 'en.letter_pick10', 'items', 'A', 'sa/v5/en/2f988087bd31.mp3', 'mbcXrKSgurbCy7GZO0QHflyC4e7eh3bFivU9GXNOUQk=',
    t3(310, 1681, 1811, [[310, 427], [937, 1054], [1564, 1681]])],
  ['q', 'en.letter_pick10', 'items', 'C', 'sa/v5/en/360e801b2da2.mp3', 'u9zvzJP45MXjzWAkkjyP8BgS/++h4JhvRlxBSdYVBtk=',
    t3(310, 1617, 1745, [[310, 414], [911, 1016], [1512, 1617]])],
  ['x', 'en.letter_pick10', 'items', 'A', 'sa/v5/en/902fc6e315f9.mp3', 'nfLqWMYkNeOBv+rVcvCY9k/sMtYf5G+1VJAv+vH5ux4=',
    t3(310, 2169, 2294, [[310, 601], [1093, 1385], [1877, 2169]])],
];
// ک is the letter-names practice example, modelled by its name «کاف».
const KAF = { take: 'C', key: 'sa/v4/ur/4283e5e14e7a.mp3', named: 'sa/v1/ur/4283e5e14e7a.mp3', sha256: 'AqR7qSQcsUwKotdKDiKUTnW5q8DEAhPNPxyIUipd2IQ=' };

// Every picker row's five cards, as the batteries serve them; only the ت and w rows differ from the staged branch, and
// the English j row is d's row with d -> j (27 Nov).
const CARDS = {
  'ur.letter_pick10': {
    items: [['ب', ['ت', 'ب', 'پ', 'ٹ', 'ن']], ['م', ['ت', 'ف', 'ق', 'م', 'ل']], ['ک', ['ک', 'گ', 'ل', 'ٹ', 'د']],
      ['س', ['ش', 'ب', 'د', 'ل', 'س']], ['ر', ['ڑ', 'ز', 'ر', 'د', 'ن']], ['ش', ['ش', 'س', 'ت', 'خ', 'ل']],
      ['گ', ['ک', 'ل', 'د', 'گ', 'ب']], ['ا', ['ق', 'ا', 'ب', 'ک', 'ل']], ['چ', ['ج', 'خ', 'ٹ', 'ل', 'چ']],
      ['ت', ['ج', 'پ', 'ت', 'ب', 'ن']]],
    practice: [['ل', ['ک', 'ل', 'د', 'گ', 'ر']], ['ن', ['ب', 'ت', 'پ', 'ن', 'ل']]],
  },
  'en.letter_pick10': {
    items: [['g', ['q', 'p', 'g', 'y', 'd']], ['w', ['z', 'w', 'm', 'u', 'y']], ['q', ['p', 'g', 'd', 'q', 'b']],
      ['x', ['x', 'k', 'z', 'y', 'v']], ['j', ['b', 'p', 'q', 't', 'j']], ['f', ['f', 'l', 'v', 'h', 't']],
      ['b', ['p', 'b', 'q', 'd', 'h']], ['a', ['d', 'c', 'q', 'g', 'a']], ['p', ['b', 'q', 'p', 'd', 'g']],
      ['o', ['c', 'q', 'd', 'o', 'g']]],
    practice: [['b', ['d', 'h', 'b', 'p', 'l']], ['k', ['h', 'l', 'k', 't', 'f']]],
  },
};

describe('the content owner\'s picks: each letter plays the take she chose', () => {
  test.each(PICKS)('%s (%s %s): take %s, served under %s', (letter, id, where, take, key, sum, timings) => {
    for (const name of PAGES) {
      const row = task(battery(name), id)[where].filter((it) => it.target === letter);
      expect([name, row.map((it) => it.prompt_audio)]).toEqual([name, [key]]);
    }
    expect(sha256(key)).toBe(sum);
    expect(TIMINGS[key]).toEqual(timings);
  });

  test(`ک (ur.letter_names5 practice): «کاف» take ${KAF.take}, served under ${KAF.key}`, () => {
    for (const name of PAGES) {
      const [p] = task(applySwitches(battery(name), LETTER_PICK_ON), 'ur.letter_names5').practice;
      expect([name, p.target, p.model[1].text, p.model[1].audio]).toEqual([name, 'ک', 'کاف', KAF.named]);
    }
    expect(KAF.named.replace('sa/v1/', 'sa/v4/')).toBe(KAF.key);
    expect(sha256(KAF.key)).toBe(KAF.sha256);
  });
});

describe('the two cards she changed, and every other card kept', () => {
  test('the ت screen shows ج, not ٹ; the W screen shows z, not v', () => {
    for (const name of PAGES) {
      const b = battery(name);
      const te = task(b, 'ur.letter_pick10').items.find((it) => it.target === 'ت');
      const w = task(b, 'en.letter_pick10').items.find((it) => it.target === 'w');
      expect([name, te.options.includes('ج'), te.options.includes('ٹ')]).toEqual([name, true, false]);
      expect([name, w.options.includes('z'), w.options.includes('v')]).toEqual([name, true, false]);
      for (const it of [te, w]) expect([name, new Set(it.options).size]).toEqual([name, 5]);
    }
  });

  test('every picker row on every coach page has exactly these five cards, in this order', () => {
    for (const name of PAGES) {
      const b = battery(name);
      for (const [id, want] of Object.entries(CARDS)) {
        const t = task(b, id);
        expect([name, id, { items: t.items.map((it) => [it.target, it.options]), practice: t.practice.map((it) => [it.target, it.options]) }])
          .toEqual([name, id, want]);
      }
    }
  });
});
