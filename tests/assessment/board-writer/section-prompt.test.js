'use strict';
const SP = require('../../../bot/shared/services/assessment/board-6-12/section-prompt');

const tag = (b) => ({ chapter: 1, section: null, code: 'x', page: 1, official_slo: null, blooms: b, difficulty: 'easy' });
const tree = (...items) => ({ unseen: { objective: { MCQs: items } } });
const q = (id, slot, text, b, marks) => ({ id, slot, question: text, marks, tag: tag(b) });
const slots = [{ slot: 'S', marks_each: 1 }, { slot: 'T', marks_each: 2 }];

describe('earlierStems', () => {
  test('none yet before anything is written', () => {
    expect(SP.earlierStems([])).toBe('none yet');
  });
  test('lists stems in order, cut to 60 characters, from OR and stimulus members too', () => {
    const long = 'x'.repeat(80);
    const t = tree(q('1', 'S', 'What is a force?', 'K', 1), { id: 'o', slot: 'S', or: [q('a', 'S', long, 'K', 1), q('b', 'S', 'Define mass.', 'K', 1)] });
    expect(SP.earlierStems([t])).toBe(`What is a force?; ${'x'.repeat(60)}; Define mass.`);
  });
  test('keeps at most the last 40 stems', () => {
    const items = Array.from({ length: 45 }, (_, i) => q(String(i), 'S', `stem ${i}`, 'K', 1));
    const out = SP.earlierStems([tree(...items)]).split('; ');
    expect(out).toHaveLength(40);
    expect(out[0]).toBe('stem 5');
    expect(out[39]).toBe('stem 44');
  });
  test('uses main_question when a leaf has no question', () => {
    expect(SP.earlierStems([tree({ id: '1', slot: 'S', main_question: 'Describe it', tag: tag('K') })])).toBe('Describe it');
  });
});

describe('levelTally', () => {
  test('sums marks per level letter across trees; a leaf with no marks takes its slot marks_each', () => {
    const a = tree(q('1', 'S', 'a', 'K', 1), q('2', 'T', 'b', 'U', undefined), q('3', 'S', 'c', 'K', 1));
    expect(SP.levelTally([a], slots)).toEqual({ K: 2, U: 2 });
  });
  test('an untagged leaf is not counted', () => {
    expect(SP.levelTally([tree({ id: '1', slot: 'S', marks: 3 })], slots)).toEqual({});
  });
});

describe('promptValues', () => {
  const row = { code: 'physics', tos_default: { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 } };
  const variant = {
    variant_id: 'v', label_en: '50% MCQs', generated_marks: 60, total_marks: 60,
    cognitive_split: { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 },
    exam_header: { lines_en: ['Federal Board SSC-I Examination', 'Physics · Examination Paper', 'Time'] },
  };
  const unit = { key: 'B(i)', title: 'Section B', time_min: 20, slots: [{ slot: 'S', label_en: 'Q1', type: 'srq', printed: 2, attempt: 2, generate: 2, marks_each: 3 }], section: { id: 'B' } };
  const base = { grade: 9, row, P: { name_en: 'Physics' }, variant, unit, done: [] };

  test('fills the section placeholders from the unit', () => {
    const v = SP.promptValues(base);
    expect(v.section_key).toBe('B(i)');
    expect(v.section_title).toBe('Section B');
    expect(v.section_marks).toBe(6);
    expect(v.time_line).toBe(', 20 minutes');
    expect(v.slot_lines).toBe('- Q1 [slot S]: 2 x srq at 3 marks; levels: K 1, U 1');
  });
  test('r9 A6b: each slot line carries its level quota from the split; a rewrite slot carries its own quota', () => {
    const six = { ...unit, slots: [{ ...unit.slots[0], printed: 6, attempt: 6, generate: 6 }] };
    expect(SP.promptValues({ ...base, unit: six }).slot_lines).toBe('- Q1 [slot S]: 6 x srq at 3 marks; levels: K 2, U 3, A 1');
    const re = { ...unit, slots: [{ ...unit.slots[0], generate: 2, quota: { K: 0, U: 1, A: 1 } }] };
    expect(SP.promptValues({ ...base, unit: re }).slot_lines).toBe('- Q1 [slot S]: 2 x srq at 3 marks; levels: U 1, A 1');
  });
  test('no split -> no levels on the slot line', () => {
    const v = SP.promptValues({ ...base, row: { code: 'physics' }, variant: { ...variant, cognitive_split: null } });
    expect(v.slot_lines).toBe('- Q1 [slot S]: 2 x srq at 3 marks');
  });
  test('an untimed unit has an empty time_line', () => {
    expect(SP.promptValues({ ...base, unit: { ...unit, time_min: null } }).time_line).toBe('');
  });
  test('fills the cell placeholders', () => {
    const v = SP.promptValues(base);
    expect(v.grade).toBe(9);
    expect(v.age).toBe('14 to 15');
    expect(v.exam_name).toBe('Federal Board SSC-I Examination · Physics · Examination Paper');
    expect(v.variant_label).toBe('50% MCQs');
    expect(v.level_scale).toBe('K/U/A');
    expect(v.level_legend).toBe('K Knowledge, U Understand, A Apply');
    expect(v.tolerance_pp).toBe(5);
    expect(v.slo_list).toBe('none loaded');
  });
  test('the first section has nothing earlier and the whole split still to come, in marks', () => {
    const v = SP.promptValues(base);
    expect(v.earlier_stems_short).toBe('none yet');
    expect(v.level_tally).toBe('none yet');
    expect(v.split_remaining).toBe('K 18 / U 30 / A 12');
  });
  test('later sections see what is done and the split still needed (never below 0)', () => {
    const done = [tree(q('1', 'S', 'first stem', 'K', 20), q('2', 'S', 'second', 'U', 10))];
    const v = SP.promptValues({ ...base, done, slotsAll: slots });
    expect(v.earlier_stems_short).toBe('first stem; second');
    expect(v.level_tally).toBe('K 20, U 10');
    expect(v.split_remaining).toBe('K 0 / U 20 / A 12');
  });
  test('the variant label falls back to the Urdu label, then the variant id', () => {
    expect(SP.promptValues({ ...base, variant: { ...variant, label_en: null, label_ur: 'اردو' } }).variant_label).toBe('اردو');
    expect(SP.promptValues({ ...base, variant: { ...variant, label_en: null, label_ur: null } }).variant_label).toBe('v');
  });
  test('name falls back to the pattern name, slo_list to a supplied text', () => {
    const v = SP.promptValues({ ...base, variant: { ...variant, exam_header: null }, sloList: '- P-09-A-01 — motion' });
    expect(v.exam_name).toBe('Physics');
    expect(v.slo_list).toBe('- P-09-A-01 — motion');
  });
  test('a cell with no split set is not invented: the registry default, else "not set"', () => {
    const noSplit = { ...variant, cognitive_split: null };
    expect(SP.promptValues({ ...base, variant: noSplit }).level_scale).toBe('K/U/A');
    const v = SP.promptValues({ ...base, variant: noSplit, row: { code: 'x', tos_default: { status: 'design_pending' } } });
    expect(v.level_scale).toBe('not set');
    expect(v.level_split).toBe('not set');
    expect(v.split_remaining).toBe('not set');
    expect(v.level_legend).toBe('not set');
    expect(v.tolerance_pp).toBe('not set');
  });
});

describe('userPrompt', () => {
  test('carries the book text in the block the cache split looks for, then the note', () => {
    const u = SP.userPrompt({ content: 'BOOK', pageReference: 'pp 3-5', note: 'Short: S (1 of 3)' });
    expect(u).toContain('**Book Text Content:**\n```\nBOOK\n```\n');
    expect(u).toContain('Pages: pp 3-5');
    expect(u.endsWith('Short: S (1 of 3)')).toBe(true);
    expect(u).toContain('Return JSON only');
  });
  test('no note, no trailing text after the instruction', () => {
    expect(SP.userPrompt({ content: 'B', pageReference: null }).endsWith('Return JSON only.')).toBe(true);
  });
});

describe('topUpNote', () => {
  test('names every short slot with what it has and needs', () => {
    expect(SP.topUpNote([{ slot: 'S', have: 1, need: 3 }, { slot: 'T', have: 0, need: 1 }]))
      .toBe('TOP-UP: the first reply was short. Write only the missing items for these slots, same rules: S (have 1, need 3); T (have 0, need 1).');
  });
});

describe('rewriteNote review faults (round 9b)', () => {
  test('the reviewer faults of removed items are listed to avoid; none, no line', () => {
    const rows = [{ slot: 'A.Q1', write: 1 }];
    const note = SP.rewriteNote(rows, ['Old stem?'], [], [], false, ['"Old stem?": key given away (paraphrase)']);
    expect(note).toContain('A reviewer removed these items for these faults; do not repeat them: "Old stem?": key given away (paraphrase)');
    expect(SP.rewriteNote(rows, ['Old stem?'])).not.toContain('reviewer');
  });
});

describe('checkFaults (round 10)', () => {
  test('a D18 drop tells the rewrite the key stood out; other checks add nothing', () => {
    expect(SP.checkFaults([{ question: 'Old?', check: 'D18' }, { question: 'Other?', check: 'D13' }]))
      .toEqual(['"Old?": the key stood out (longest option, or always/never); write all four options the same length and detail, the key no longer than the longest distractor']);
  });
});

describe('checkFaults: D22 method marks (Amena, 7 Nov 2026)', () => {
  test('a D22 drop tells the rewrite to list method/working marks apart from the final-answer mark', () => {
    const [line] = SP.checkFaults([{ question: 'Find v.', check: 'D22' }]);
    expect(line).toMatch(/^"Find v\.": /);
    expect(line).toMatch(/only a final-answer mark/);
    expect(line).toMatch(/formula, substitution, working/);
    expect(line).toMatch(/value with unit/);
  });
});
