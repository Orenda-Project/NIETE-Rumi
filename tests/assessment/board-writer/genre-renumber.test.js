'use strict';
// bd-qyi45h.1 follow-up (Amena, 11 Nov 2026): when the poem / ghazal slots of a G11/G12 Urdu board paper are left
// out, the printed question numbers run on with no gap (Q3, Q4, Q5..., Q2a, Q2b, Q2c...), and the teacher's
// marking-scheme legend says why, in the paper's language. Slot ids never change: replies, checks and the scheme
// are keyed on them. Book text below is made up; the markers are the ones the G11/G12 Urdu books print.
const A = '../../../bot/shared/services/assessment/';
const GP = require(`${A}board-6-12/genre-presence`);
const hssc1 = require(`${A}patterns/board/fbise-hssc1`);
const hssc2 = require(`${A}patterns/board/fbise-hssc2`);

const FILL = 'مصنف نے اس بات کی مزید وضاحت کی ہے۔';
const span = (first, body) => [0, 1, 2].map((i) => `=== Page ${first + i} ===\n${i ? FILL : body}`).join('\n');
const PROSE = span(12, 'اس سبق میں مصنف نے گاؤں کی زندگی بیان کی ہے۔');
const NAZM = span(81, 'اس نظم میں شاعر نے صبح کا منظر پیش کیا ہے۔');
const GHAZAL = span(111, '# غزل\nمیر تقی میر کی غزل پڑھیے۔ اس غزل کا مطلع دوبارہ لکھیے۔');
const urdu1 = hssc1.subjects.urdu.variants[0];
const urdu2 = hssc2.subjects.urdu.variants[0];

const NOTE = {
  poem: { en: 'No poem in the chosen pages, so the poem questions are left out.', ur: 'منتخب صفحات میں کوئی نظم نہیں، اس لیے نظم کے سوالات شامل نہیں کیے گئے۔' },
  ghazal: { en: 'No ghazal in the chosen pages, so the ghazal questions are left out.', ur: 'منتخب صفحات میں کوئی غزل نہیں، اس لیے غزل کے سوالات شامل نہیں کیے گئے۔' },
};
/** [slot id, label_en, label_ur] in paper order. */
const rows = (V) => V.sections.flatMap((s) => s.slots.map((x) => [x.slot, x.label_en, x.label_ur]));
const notes = (V, lang) => V.legend[`lines_${lang}`].join('\n');
const CASES = [['HSSC-I', urdu1], ['HSSC-II', urdu2]];

describe.each(CASES)('%s Urdu: printed numbers run on after a drop', (_name, V0) => {
  test('no ghazal: Q2a-Q2c, then Q3, Q4, Q5, Q6 (letter and Q7 move up)', () => {
    const V = GP.forContent(V0, 'urdu', [PROSE, NAZM].join('\n'));
    expect(rows(V)).toEqual([
      ['1.Q1', 'Q1', 'سوال 1'],
      ['2.Q2a prose', 'Q2a prose', 'Q2a prose'], ['2.Q2b poem', 'Q2b poem', 'Q2b poem'], ['2.Q2d grammar', 'Q2c grammar', 'Q2c grammar'],
      ['3.Q3', 'Q3', 'سوال 3'], ['3.Q4', 'Q4', 'سوال 4'], ['3.Q6', 'Q5', 'سوال 5'], ['3.Q7', 'Q6', 'سوال 6'],
    ]);
  });
  test('no poem: the ghazal parts move up one (Q2b ghazal, Q4 = the ghazal explanation)', () => {
    const V = GP.forContent(V0, 'urdu', [PROSE, GHAZAL].join('\n'));
    expect(rows(V)).toEqual([
      ['1.Q1', 'Q1', 'سوال 1'],
      ['2.Q2a prose', 'Q2a prose', 'Q2a prose'], ['2.Q2c ghazal', 'Q2b ghazal', 'Q2b ghazal'], ['2.Q2d grammar', 'Q2c grammar', 'Q2c grammar'],
      ['3.Q3', 'Q3', 'سوال 3'], ['3.Q5', 'Q4', 'سوال 4'], ['3.Q6', 'Q5', 'سوال 5'], ['3.Q7', 'Q6', 'سوال 6'],
    ]);
  });
  test('prose only: Q2a, Q2b grammar; Q3, Q4, Q5', () => {
    const V = GP.forContent(V0, 'urdu', PROSE);
    expect(rows(V)).toEqual([
      ['1.Q1', 'Q1', 'سوال 1'],
      ['2.Q2a prose', 'Q2a prose', 'Q2a prose'], ['2.Q2d grammar', 'Q2b grammar', 'Q2b grammar'],
      ['3.Q3', 'Q3', 'سوال 3'], ['3.Q6', 'Q4', 'سوال 4'], ['3.Q7', 'Q5', 'سوال 5'],
    ]);
  });
  test('only the label moves: every other field of a renumbered slot is the pattern\'s', () => {
    const V = GP.forContent(V0, 'urdu', PROSE);
    const was = V0.sections[2].slots.find((s) => s.slot === '3.Q6');
    const now = V.sections.find((s) => s.id === '3').slots.find((s) => s.slot === '3.Q6');
    expect(now).not.toBe(was);
    expect({ ...now, label_en: was.label_en, label_ur: was.label_ur }).toEqual(was);
  });
  test('a slot before the first drop is the very same object (nothing to renumber)', () => {
    const V = GP.forContent(V0, 'urdu', [PROSE, NAZM].join('\n'));
    expect(V.sections[1].slots[0]).toBe(V0.sections[1].slots[0]);
    expect(V.sections[2].slots[0]).toBe(V0.sections[2].slots[0]);
  });
  test('the frozen pattern keeps its own labels', () => {
    const before = JSON.stringify(V0);
    GP.forContent(V0, 'urdu', PROSE);
    expect(JSON.stringify(V0)).toBe(before);
    expect(V0.sections[2].slots.map((s) => s.label_en)).toEqual(['Q3', 'Q4', 'Q5', 'Q6', 'Q7']);
  });
});

describe.each(CASES)('%s Urdu: the teacher is told what was left out', (_name, V0) => {
  test('nothing dropped: same variant, so no note and no renumbering', () => {
    const V = GP.forContent(V0, 'urdu', [PROSE, NAZM, GHAZAL].join('\n'));
    expect(V).toBe(V0);
    ['en', 'ur'].forEach((lang) => {
      expect(notes(V, lang)).not.toContain(NOTE.poem[lang]);
      expect(notes(V, lang)).not.toContain(NOTE.ghazal[lang]);
    });
  });
  test('no ghazal: the ghazal note only, in English and Urdu, after the pattern\'s own legend lines', () => {
    const V = GP.forContent(V0, 'urdu', [PROSE, NAZM].join('\n'));
    ['en', 'ur'].forEach((lang) => {
      expect(notes(V, lang)).toContain(NOTE.ghazal[lang]);
      expect(notes(V, lang)).not.toContain(NOTE.poem[lang]);
      expect(V.legend[`lines_${lang}`].slice(0, V0.legend[`lines_${lang}`].length)).toEqual(V0.legend[`lines_${lang}`]);
    });
    expect(V.legend.lines_en).toHaveLength(V0.legend.lines_en.length + 1);
  });
  test('no poem: the poem note only', () => {
    const V = GP.forContent(V0, 'urdu', [PROSE, GHAZAL].join('\n'));
    ['en', 'ur'].forEach((lang) => {
      expect(notes(V, lang)).toContain(NOTE.poem[lang]);
      expect(notes(V, lang)).not.toContain(NOTE.ghazal[lang]);
    });
  });
  test('prose only: both notes, poem first (paper order)', () => {
    const V = GP.forContent(V0, 'urdu', PROSE);
    expect(V.legend.lines_en.slice(-2)).toEqual([NOTE.poem.en, NOTE.ghazal.en]);
    ['en', 'ur'].forEach((lang) => {
      expect(notes(V, lang)).toContain(NOTE.poem[lang]);
      expect(notes(V, lang)).toContain(NOTE.ghazal[lang]);
    });
    expect(V.legend.title_en).toBe(V0.legend.title_en);
  });
});
