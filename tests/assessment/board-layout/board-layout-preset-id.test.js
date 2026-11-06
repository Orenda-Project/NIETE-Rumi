'use strict';
/**
 * bd-5jmnfj.38.25.6: a board paper's `_layout` names its pattern (`preset_id`), as G1-5 FDE layouts do,
 * so the paper view and paper list report the exam pattern instead of null. G1-5 output stays byte-identical.
 */
const crypto = require('crypto');
const path = '../../../bot/shared/services/assessment/';
const { buildLayout } = require(`${path}board-layout`);
const View = require(`${path}board-render/view`);
const Patterns = require(`${path}patterns`);
const { applyLayout } = require(`${path}fde-layout`);
const ssc1 = require(`${path}patterns/board/fbise-ssc1`);
const hssc2 = require(`${path}patterns/board/fbise-hssc2`);

const exam = (subject) => ({ subject, sections: [{ id: 'A', items: [{ q: 'Which organelle makes ATP? (fictional)' }] }] });
const firstVariant = (pat, key) => pat.subjects[key].variants[0];

describe('board layout records preset_id', () => {
  test('SSC-I biology layout carries the pattern id', () => {
    const L = buildLayout(ssc1, firstVariant(ssc1, 'biology'), exam('biology'));
    expect(L.preset_id).toBe('fbise_ssc1_2027');
  });

  test('HSSC-II layout carries its own pattern id', () => {
    const key = Object.keys(hssc2.subjects)[0];
    const L = buildLayout(hssc2, firstVariant(hssc2, key), exam(key));
    expect(L.preset_id).toBe('fbise_hssc2_2027');
  });

  test('a bare subject entry has no pattern id to record', () => {
    const L = buildLayout(ssc1.subjects.biology, firstVariant(ssc1, 'biology'), exam('biology'));
    expect(L.preset_id).toBeNull();
  });

  test('production path: a subject entry plus opts.presetId records that id', () => {
    const L = buildLayout(ssc1.subjects.biology, firstVariant(ssc1, 'biology'), exam('biology'), { presetId: 'fbise_ssc1_2027' });
    expect(L.preset_id).toBe('fbise_ssc1_2027');
  });

  test('the board paper view reports the pattern', () => {
    const L = buildLayout(ssc1, firstVariant(ssc1, 'biology'), exam('biology'));
    expect(View.paperFields({ subject: 'biology', _layout: L }).pattern).toBe('fbise_ssc1_2027');
  });
});

describe('G1-5 FDE layout unchanged', () => {
  const it5 = (n, slot, b, x = {}) => Array.from({ length: n }, (_, i) => ({ question: `${b} ${i + 1}`, answer: String(i + 1), marks: 9, slot, ...x }));
  test('fde_g5_2027 maths _layout is byte-identical to origin/sandbox', () => {
    const M = Patterns.get('fde_g5_2027').subjects.maths;
    const ex = { unseen: { objective: { MCQs: it5(20, 'maths.A.Q1a', 'mcq', { options: ['1', '2', '3', '4'] }) },
      subjective: { 'Short Questions': it5(10, 'maths.A.Q1b', 's'), 'Word Problems': it5(12, 'maths.B.Q2', 'p'),
        'Graphs & Geometric Problems': [...it5(1, 'maths.C.Q3', 'g'), ...it5(5, 'maths.C.Q4-8', 'geo')] } } };
    const L = applyLayout(ex, M, { kind: 'fde', chapters: null, pages: null }, { now: '2026-10-20T07:12:00.000Z' }).examJson._layout;
    expect(L.preset_id).toBe('fde_g5_2027');
    expect(crypto.createHash('sha256').update(JSON.stringify(L)).digest('hex'))
      .toBe('d2a7a627a30e2bd4d2209d887f795f4ffe6e2f8ff47148e6c36214793dee07b3');
  });
});
