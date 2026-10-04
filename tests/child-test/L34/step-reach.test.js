'use strict';
/**
 * L34 (bd-s1oo0.47, CONTRACT §20) — the story step tells the coach which questions to ask: from question 2
 * on (or from 1 when its needs_line > 1), "Only if the child read past:" and the anchor words on their own
 * said line. Step 3: look where the child's finger is before turning the card face down. Plain text; the
 * whole message fits WhatsApp's 4096 text cap in code points. Real: steps.js, the catalog, the item bank.
 */
const steps = require('../../../bot/shared/services/child-test/conversation/steps');
const bank = require('../../../bot/shared/services/child-test/item-bank');
const { anchorFor } = require('../../../bot/shared/services/child-test/scoring/reach');

const RLI = '⁧'; const LRI = '⁦'; const PDI = '⁩';
const msg = (lang, block, grade, form = 'A') => steps.stepMessage(lang, block, { name: 'Ayesha Khan', grade, form });
const lines = (s) => s.split('\n');

describe('step 4: the condition before each gated question', () => {
  test('EN coach, G3A Urdu: q1 (line 1) is open; q2 and q3 each follow "Only if the child read past:" + the anchor', () => {
    const s = msg('en', 'urdu', 3);
    const l = lines(s);
    const f = bank.getForm(3, 'A').urdu;
    const i1 = l.findIndex((x) => x.includes(`${LRI}①${PDI}`));
    const i2 = l.findIndex((x) => x.includes(`${LRI}②${PDI}`));
    const i3 = l.findIndex((x) => x.includes(`${LRI}③${PDI}`));
    expect(l[i1 - 1]).not.toMatch(/Only if/);
    expect(l[i2 - 2]).toBe('   Only if the child read past:');
    expect(l[i2 - 1]).toBe(`   ${RLI}«${anchorFor(f, f.questions[1])}»${PDI}`);
    expect(l[i3 - 2]).toBe('   Only if the child read past:');
    expect(l[i3 - 1]).toBe(`   ${RLI}«اور مسکراتا رہا»${PDI}`);
  });

  test('EN coach, G5A English: question 1 needs line 2, so it is gated too', () => {
    const s = msg('en', 'english', 5);
    const l = lines(s);
    const i1 = l.findIndex((x) => x.includes(`${LRI}①${PDI}`));
    expect(l[i1 - 2]).toBe('   Only if the child read past:');
    expect(l[i1 - 1]).toBe('   «was planting trees»');
    expect(s.match(/Only if the child read past:/g)).toHaveLength(3);
    expect(s).toContain('«to water it»');
  });

  test('UR coach, G5A Urdu: Urdu condition, Urdu anchor, two gated questions', () => {
    const s = msg('ur', 'urdu', 5);
    expect(s.match(/صرف اگر بچہ یہ الفاظ پڑھ چکا ہو:/g)).toHaveLength(2);
    expect(s).toContain('   «سے تالیاں بجائیں»');
  });

  test('UR coach, G5A English: the English anchor sits in an LTR isolate on its own line', () => {
    const s = msg('ur', 'english', 5);
    expect(lines(s)).toContain(`   ${LRI}«to water it»${PDI}`);
  });

  test('N questions, not 3: a fifth question gets its own number and condition', () => {
    const f = bank.getForm(5, 'A');
    const five = { ...f, urdu: { ...f.urdu, questions: [...f.urdu.questions, { ...f.urdu.questions[1], id: 'x4', needs_line: 9 }, { ...f.urdu.questions[2], id: 'x5', needs_line: 14 }] } };
    const s = steps.stepMessage('en', 'urdu', { name: 'A', grade: 5, form: 'A', bankForm: five });
    expect(s).toContain(`${LRI}⑤${PDI}`);
    expect(s.match(/Only if the child read past:/g)).toHaveLength(4);
  });
});

describe('step 3: look at the finger, then turn the card', () => {
  test.each([['en', /Look where the child's finger is, then turn the card \*face down\*\./], ['ur', /دیکھیں بچے کی انگلی کہاں ہے، پھر کارڈ \*الٹا\* کر دیں۔/]])('%s', (lang, re) => {
    expect(msg(lang, 'urdu', 3)).toMatch(re);
    expect(msg(lang, 'english', 5)).toMatch(re);
  });
});

describe('the whole message', () => {
  test('plain text within the 4096 text cap, every grade, form, block, language', () => {
    for (const lang of ['en', 'ur']) for (const g of [3, 5]) for (const f of ['A', 'B']) for (const b of ['urdu', 'english']) {
      const s = steps.stepMessage(lang, b, { name: 'Muhammad Abdullah Khan Niazi', grade: g, form: f });
      expect([...s].length).toBeLessThanOrEqual(4096);
      expect(s).not.toMatch(/undefined|null|\{\w+\}/);
    }
  });
  test('Urdu prose keeps Urdu digits: no ASCII digit outside an isolate', () => {
    const outside = (line) => line.replace(/[⁦-⁨][^⁩]*⁩/g, '');
    for (const b of ['urdu', 'english']) for (const line of lines(msg('ur', b, 5))) expect(outside(line)).not.toMatch(/[0-9]/);
  });
});
