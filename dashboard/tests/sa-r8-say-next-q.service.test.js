'use strict';
/**
 * Round 8, item 28 (the content owner: "say something, press Next"): with sa_r8_comp_wait_next ON a story or listening
 * question's button reads «آگے» / Next, so its say-then-press hint must name that button. The served battery carries a
 * second hint, lines.r7_say_next_q, only when sa_say_then_next AND sa_r8_comp_wait_next are both ON; r7_say_done stays
 * for the other spoken screens (the maths sums), whose button reads «ہو گیا» / Done. Each line has its clip in every set.
 */
const fs = require('fs');
const path = require('path');
const { applySwitches } = require('../routes/sa-battery-switches');
const R7A = require('../routes/sa-r7a-content');

const DASH = path.join(__dirname, '..');
const B = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G1.A.${lang}.json`), 'utf8'));
const ON = { rdfW3Forms: true, sayThenNext: true };

test('both switches ON: the question hint names Next / «آگے», in the battery\'s language, with its clip key', () => {
  for (const lang of ['en', 'ur']) {
    const out = applySwitches(B(lang), { ...ON, r8CompWaitNext: true });
    const q = out.lines.r7_say_next_q;
    expect(q).toEqual({ text: R7A.LINES.r7_say_next_q[lang], audio: R7A.keyOf(lang, R7A.LINES.r7_say_next_q[lang]) });
    expect(q.text).toContain(lang === 'ur' ? '«آگے»' : 'Next');
    expect(q.text).not.toMatch(/ہو گیا|Done/);
    expect(out.lines.r7_say_done.text).toBe(R7A.LINES.r7_say_done[lang]);
  }
});

test('either switch OFF: no question hint, the battery as before', () => {
  for (const lang of ['en', 'ur']) {
    expect(applySwitches(B(lang), ON).lines.r7_say_next_q).toBeUndefined();
    expect(applySwitches(B(lang), { rdfW3Forms: true, r8CompWaitNext: true }).lines.r7_say_next_q).toBeUndefined();
  }
});

test('the Done hint keeps «ہو گیا» with the space before «بٹن»', () => {
  expect(R7A.LINES.r7_say_done.ur).toContain('«ہو گیا» کا بٹن');
  expect(R7A.LINES.r7_say_done.ur).not.toContain('کابٹن');
});

// The reviewed set (sa/v4) ships with its own change; where it is on disk, these lines must be in it too.
const V4 = fs.existsSync(path.join(DASH, 'sa', 'v4', 'ur'));

test('every hint line has its clip in v1, v2 (and v4 with its word timings, where the v4 set is on disk)', () => {
  const missing = [];
  for (const [k, both] of Object.entries(R7A.LINES)) {
    for (const lang of ['en', 'ur']) {
      const key = R7A.keyOf(lang, both[lang]);
      for (const set of V4 ? ['v1', 'v2', 'v4'] : ['v1', 'v2']) {
        const f = path.join(DASH, key.replace(/^sa\/v1\//, `sa/${set}/`));
        if (!fs.existsSync(f) || fs.statSync(f).size < 500) missing.push(`${k} ${set} ${lang}`);
      }
      if (V4 && !fs.existsSync(path.join(DASH, key.replace(/^sa\/v1\//, 'sa/v4/').replace(/\.mp3$/, '.json')))) missing.push(`${k} v4 ${lang} timings`);
    }
  }
  expect(missing).toEqual([]);
});
