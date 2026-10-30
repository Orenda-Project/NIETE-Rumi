/** v26 key fixes (bd-5jmnfj.4.58.2): accept lines, G1 Urdu stem echo, common errors, LCM ladder, who-said names. */

const { acceptText } = require('../../bot/shared/services/assessment/fde-accept-line');

describe('accept line', () => {
  test('G2 Urdu Q2 ii: the answer minus a pesh is not an accept (بُلبل / بلبل)', () => {
    expect(acceptText('بُلبل، ساز، کوئل', ['بلبل، ساز، کوئل'], 'ur')).toBe('');
  });

  test('G5 Urdu Q4 item 4: an accept made of the answer\'s own pieces is dropped', () => {
    expect(acceptText('جھکڑ: جھ ۔ کڑ\nسانحہ: سا ۔ ن ۔ حہ', ['جھ ۔ کڑ، سا ۔ ن ۔ حہ'], 'ur')).toBe('');
  });

  test('a real alternative is still printed', () => {
    expect(acceptText('بُلبل، ساز، کوئل', ['بلبل، کوئل، سارنگی'], 'ur')).toBe('بلبل، کوئل، سارنگی');
  });
});

describe('G1 Urdu Q10 key', () => {
  const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
  const Patterns = require('../../bot/shared/services/assessment/patterns');
  const urdu = require('./fixtures/early/g1-urdu-exam.json');
  const fresh = () => {
    const e = JSON.parse(JSON.stringify(urdu));
    const slots = Patterns.subjectOf('fde_g1_2026', 'urdu').sections.flatMap((s) => s.slots);
    (e._layout.sections || []).forEach((s) => (s.slots || []).forEach((sl) => {
      const p = slots.find((x) => x.slot === sl.slot);
      if (p) ['picture_only', 'sentence_box', 'marks_line_en', 'marks_line_ur'].forEach((k) => { sl[k] = p[k]; });
    }));
    return e;
  };

  test('the key does not print the instruction under each model sentence (paper is clean, key repeated it x5)', () => {
    const key = R.renderMarkingScheme({ examJson: fresh(), grade: 1, subject: 'urdu', allowShort: true });
    expect(key).toMatch(/data-row="g1\.urdu\.B\.Q10"/);
    expect(key).not.toMatch(/تصویر کے بارے میں ایک جملہ لکھیں/);
  });
});

describe('G1 English Q11 iv: a common-error note naming a printed letter', () => {
  const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
  const english = require('./fixtures/fde/v26-g1-english-q11.json');
  const items = (e) => Object.values(e.unseen).flatMap((t) => Object.values(t)).flatMap((l) => l)
    .filter((q) => q && /Q11$/.test(q.slot || ''));

  test('the silent-b note on "l _ _ b" is dropped, the other notes stay', () => {
    const out = normaliseScheme(JSON.parse(JSON.stringify(english))).examJson;
    const lamb = items(out).find((q) => q.answer === 'lamb');
    expect(lamb.question).toBe('l _ _ b');
    expect(lamb.scheme.common_error || '').not.toMatch(/silent letter b/i);
    const goat = items(out).find((q) => q.answer === 'goat');
    expect(goat.scheme.common_error).toMatch(/gaot/);
  });
});

describe('G5 Maths Q2 vi: the LCM division ladder', () => {
  const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
  const exam = (answer) => ({
    unseen: { subjective: { 'Word Problems': [{
      slot: 'maths.B.Q2', marks: 5, answer,
      question: 'Two buses leave a bus stop every 24 minutes and every 36 minutes. They leave together now. After how many minutes will they leave together again? Use the division method to find the L.C.M.',
      scheme: { accept: [], points: [{ kind: 'A', text: 'x', marks: 5 }], checked: null },
    }] } },
    _layout: { subject: 'maths', sections: [{ slots: [{ slot: 'maths.B.Q2', type: 'Word Problems' }] }] },
  });
  const run = (answer) => mathsCheck(exam(answer), { subject: 'maths' }).examJson.unseen.subjective['Word Problems'][0].answer;

  test('v26 text: "to reach 1 and 3" becomes the pair the divisors really leave (2 and 3)', () => {
    const out = run('Divide 24 and 36 by 2, 2, 3 to reach 1 and 3: L.C.M. = 2 x 2 x 3 x 2 x 3 = 72. They leave together again after 72 minutes.');
    expect(out).toContain('to reach 2 and 3');
    expect(out).not.toContain('to reach 1 and 3');
    expect(out).toContain('= 72');
  });

  test('a ladder that is already right is left as written', () => {
    const ok = 'Divide 24 and 36 by 2, 2, 3 to reach 2 and 3: L.C.M. = 2 x 2 x 3 x 2 x 3 = 72.';
    expect(run(ok)).toBe(ok);
  });
});
