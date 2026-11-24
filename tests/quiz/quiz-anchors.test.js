'use strict';
/**
 * Anchor questions (bd-chz35n.10.3): a few FIXED questions per skill, asked again word for word in the
 * class's later quiz on that skill, so "did the class get better on this skill?" can be measured on the
 * same item. Eval #228 found no question was ever re-asked. Pure helpers + the switch; no I/O here.
 */
const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const A = require('../../bot/shared/services/quiz/quiz-anchors');

const row = (n, slo, over = {}) => ({
  id: `src${n}`, quiz_id: 'Q1', sort_order: n - 1, external_id: `tq:Q1:${slo}:${n}`,
  question_text: `What is ${n} + ${n}?`, option_a: `${2 * n}`, option_b: `${2 * n + 1}`, option_c: `${2 * n - 1}`,
  correct_option: 'A', explanation: 'Add them.', difficulty_level: 3, render_pattern: 'P1',
  media: { display_order: [0, 1, 2] }, ...over,
});

describe('itemKey — the same question is the same item, whatever letter its answer sits under', () => {
  test('a reshuffled copy has the same key; a different stem or key does not', () => {
    const a = row(1, 'S1');
    const shuffled = { ...a, option_a: a.option_c, option_c: a.option_a, correct_option: 'C' };
    expect(A.itemKey(shuffled)).toBe(A.itemKey(a));
    expect(A.itemKey({ ...a, question_text: 'What is 1 + 2?' })).not.toBe(A.itemKey(a));
    expect(A.itemKey({ ...a, correct_option: 'B' })).not.toBe(A.itemKey(a));
    expect(A.itemKey(a)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('pickAnchors — up to two, one per skill first, never a picture or a pick-several question', () => {
  test('one per SLO in quiz order', () => {
    const rows = [row(3, 'S1'), row(1, 'S1'), row(2, 'S1'), row(4, 'S2')];
    expect(A.pickAnchors(rows).map((r) => r.id)).toEqual(['src1', 'src4']);
  });
  test('one skill only → its first two', () => {
    expect(A.pickAnchors([row(1, 'S1'), row(2, 'S1'), row(3, 'S1')]).map((r) => r.id)).toEqual(['src1', 'src2']);
  });
  test('pictures, four-option and several-answer questions are skipped', () => {
    const rows = [
      row(1, 'S1', { media: { question_image: 'https://r2/p.png' } }),
      row(2, 'S1', { option_d: '9' }),
      row(3, 'S2', { correct_option: 'A,C' }),
      row(4, 'S2'),
    ];
    expect(A.pickAnchors(rows).map((r) => r.id)).toEqual(['src4']);
  });
  test('nothing usable → none', () => { expect(A.pickAnchors([])).toEqual([]); });
});

describe('carryRows — the anchors take the last slots; the quiz keeps its length', () => {
  const authored = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    ...row(n + 10, n % 2 ? 'S1' : 'S2'), id: undefined, quiz_id: 'R1', external_id: `tq:R1:${n % 2 ? 'S1' : 'S2'}:${n}`, sort_order: n - 1,
  }));
  const anchors = [row(1, 'S1'), row(4, 'S2')];

  test('7 authored + 2 anchors → 7 rows: the first 5 authored, then the two anchors copied word for word', () => {
    const out = A.carryRows('R1', authored, anchors);
    expect(out.rows).toHaveLength(7);
    expect(out.keep).toEqual([0, 1, 2, 3, 4]);
    expect(out.rows.slice(0, 5).map((r) => r.question_text)).toEqual(authored.slice(0, 5).map((r) => r.question_text));
    const [c1, c2] = out.rows.slice(5);
    ['question_text', 'option_a', 'option_b', 'option_c', 'correct_option', 'explanation', 'media'].forEach((k) => {
      expect(c1[k]).toEqual(anchors[0][k]);
      expect(c2[k]).toEqual(anchors[1][k]);
    });
    expect(c1).not.toHaveProperty('id');
    expect(c1.quiz_id).toBe('R1');
    expect(out.rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(c1.external_id).toBe('tq:R1:S1:6');
    expect(c2.external_id).toBe('tq:R1:S2:7');
    expect(new Set(out.rows.map((r) => r.external_id)).size).toBe(7);
    expect(out.anchors).toEqual([
      { key: A.itemKey(anchors[0]), external_id: 'tq:R1:S1:6', from_question_id: 'src1' },
      { key: A.itemKey(anchors[1]), external_id: 'tq:R1:S2:7', from_question_id: 'src4' },
    ]);
  });

  test('an authored question that IS an anchor is dropped, so the class never sees it twice', () => {
    const dup = [...authored.slice(0, 2), { ...authored[2], question_text: anchors[0].question_text }, ...authored.slice(3)];
    const out = A.carryRows('R1', dup, anchors);
    expect(out.keep).toEqual([0, 1, 3, 4, 5]);
    expect(out.rows.filter((r) => r.question_text === anchors[0].question_text)).toHaveLength(1);
  });

  test('no anchors → rows untouched', () => {
    const out = A.carryRows('R1', authored, []);
    expect(out.rows).toBe(authored);
    expect(out.anchors).toEqual([]);
  });
});

describe('the switch: app_settings quiz_anchor_items, only JSON true is on', () => {
  beforeEach(() => A._reset());
  test.each([[true, true], ['true', false], [1, false], [{ enabled: true }, false]])('value %p → %p', async (value, on) => {
    mockDb = makeDb({ app_settings: [{ key: 'quiz_anchor_items', value }] });
    expect(await A.anchorsOn()).toBe(on);
  });
  test('no row → off', async () => {
    mockDb = makeDb({ app_settings: [] });
    expect(await A.anchorsOn()).toBe(false);
  });
});
