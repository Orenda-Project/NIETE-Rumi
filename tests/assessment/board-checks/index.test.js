'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../../../bot/shared/services/assessment/board-checks');
const { mcq, srq, row, paper, ctxBoard, deepFreeze } = require('./paper-builder');

const DIR = path.join(__dirname, '../../../bot/shared/services/assessment/board-checks');
const bad3 = ['A) 1', 'B) 2', 'C) 3'];
const cleanPaper = () => paper({
  sections: [{ id: 'A', marks: 2, slots: [row('s.A', { attempt: 2, printed: 2 })] }],
  items: [mcq('a', 's.A', 'A'), mcq('b', 's.A', 'B')],
});
const ctx = (extra) => ctxBoard({ variant: { total_marks: 2, sections: [] }, ...extra });

describe('registry run()', () => {
  test('I1 returns exactly {shortfall, notes, record}; board ran list is the full run order', () => {
    const r = R.run(cleanPaper(), ctx());
    expect(Object.keys(r).sort()).toEqual(['notes', 'record', 'shortfall']);
    expect(r.shortfall).toEqual([]);
    expect(r.record.mode).toBe('board');
    expect(r.record.ran).toEqual(['tag-complete', 'blueprint-qa', 'mcq-shape', 'scheme-sum', 'numeric-resolve', 'maths-check-secondary', 'figure-ban', 'key-leak', 'readability']);
    expect(r.record.errors).toEqual([]);
    expect(JSON.parse(JSON.stringify(r.record))).toEqual(r.record);
  });

  test('I1 free mode lists blueprint-qa and scheme-sum as skipped (why: mode)', () => {
    const free = { unseen: { objective: { M: [mcq('a', undefined, 'A')] } } };
    const r = R.run(free, { mode: 'free', P: null, variant: null, subjectConfig: { code: 'maths' } });
    expect(r.record.skipped).toEqual([{ id: 'blueprint-qa', why: 'mode' }, { id: 'scheme-sum', why: 'mode' }]);
    expect(r.record.ran).toEqual(['tag-complete', 'mcq-shape', 'numeric-resolve', 'maths-check-secondary', 'figure-ban', 'key-leak', 'readability']);
  });

  test.todo('I1 part 2: ran order includes tag-complete first, then figure-ban, key-leak, readability, legacy (COS adds after slice 6b)');

  test('I2 deep-frozen examJson and ctx pass through unchanged', () => {
    const p = cleanPaper(); const c = ctx();
    const before = JSON.stringify([p, c]);
    expect(() => R.run(deepFreeze(p), deepFreeze(c))).not.toThrow();
    expect(JSON.stringify([p, c])).toBe(before);
  });

  test('I3 two hard issues in one slot -> one Shortfall row with both item_refs and ids', () => {
    const run = R.makeRun([require('../../../bot/shared/services/assessment/board-checks/mcq-shape')]);
    const p = paper({ sections: [{ id: 'A', marks: 2, slots: [row('s.A', { attempt: 2, printed: 2 })] }], items: [mcq('a', 's.A', 'A', bad3), mcq('b', 's.A', 'A', bad3)] });
    const r = run(p, ctx());
    expect(r.shortfall).toHaveLength(1);
    expect(r.shortfall[0]).toMatchObject({ slot: 's.A', reason: 'D13', hard: true, item_refs: ['s.A#1', 's.A#2'], items: ['a', 'b'] });
    expect(r.record.hard).toBeGreaterThanOrEqual(2);
    expect(r.record.per_check['mcq-shape'].hard).toBeGreaterThanOrEqual(2);
  });

  test('I3 a soft issue only -> shortfall [] and notes >= 1', () => {
    const p = paper({ sections: [{ id: 'A', marks: 1, slots: [row('s.A')] }], items: [mcq('a', 's.A', 'A', ['A) x', 'B) y', 'C) z', 'D) none of the above'])] });
    const r = R.run(p, ctx({ variant: { total_marks: 1, sections: [] } }));
    expect(r.shortfall).toEqual([]);
    expect(r.notes.length).toBeGreaterThanOrEqual(1);
    expect(r.notes[0].hard).toBe(false);
  });

  test('free-mode shortfall slot is free:<type>', () => {
    const free = { unseen: { objective: { M: [{ id: 'a', type: 'mcq', options: ['A) 1', 'B) 2'], answer: 'A' }] } } };
    const r = R.run(free, { mode: 'free', subjectConfig: { code: 'english' } });
    expect(r.shortfall[0]).toMatchObject({ slot: 'free:mcq', item_refs: ['mcq#1'], items: ['a'] });
  });

  test('I4 a member that throws is caught: record.errors, checker_error note, no throw, paper not failed', () => {
    const boom = { id: 'X1', name: 'boom', hard: true, modes: ['board', 'free'], run() { throw new Error('kaput'); } };
    const run = R.makeRun([boom]);
    let r;
    expect(() => { r = run(cleanPaper(), ctx()); }).not.toThrow();
    expect(r.record.errors).toEqual([{ id: 'boom', error: 'kaput' }]);
    expect(r.notes).toEqual([expect.objectContaining({ check: 'checker_error', item_ref: '-', hard: false })]);
    expect(r.shortfall).toEqual([]);
  });

  test('a member declared hard:false never produces a hard issue; the other members still run after a crash', () => {
    const soft = { id: 'S1', hard: false, modes: ['board'], run: () => ({ ok: true, issues: [{ check: 'S1', rule: 'R', item_ref: 'a#1', msg: 'm', hard: true }] }) };
    const boom = { id: 'B1', hard: true, modes: ['board'], run() { throw new Error('x'); } };
    const r = R.makeRun([boom, soft])(cleanPaper(), ctx());
    expect(r.shortfall).toEqual([]);
    expect(r.record.ran).toEqual(['S1']);
    expect(r.notes.map((n) => n.check).sort()).toEqual(['S1', 'checker_error']);
  });

  test('member `detail` and `record` extras are carried into the record', () => {
    const m = { id: 'M1', hard: true, modes: ['board'], run: () => ({ ok: true, issues: [], detail: { a: 1 }, record: { split: { target: 'x' } } }) };
    const r = R.makeRun([m])(cleanPaper(), ctx());
    expect(r.record.per_check.M1.detail).toEqual({ a: 1 });
    expect(r.record.split).toEqual({ target: 'x' });
  });
});

describe('member files', () => {
  const NOT_MEMBERS = new Set(['index.js', 'walk.js', 'common.js', 'option-text.js', 'maths-recognisers.js', 'legacy.js']);
  // `_`-prefixed files and tag-split.js are slice-6b helpers, not members
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && !NOT_MEMBERS.has(f) && !f.startsWith('_') && f !== 'tag-split.js');

  test('I5 the five part-1 members are all present', () => {
    expect(files).toEqual(expect.arrayContaining(['blueprint-qa.js', 'mcq-shape.js', 'scheme-sum.js', 'numeric-resolve.js', 'maths-check-secondary.js']));
  });

  test.each(files)('I5 %s exports {id, hard, modes, run} and a LIMITS object', (f) => {
    const m = require(path.join(DIR, f));
    expect(typeof m.id).toBe('string');
    expect([true, false, 'shape']).toContain(m.hard);
    expect(m.modes.every((x) => x === 'free' || x === 'board')).toBe(true);
    expect(typeof m.run).toBe('function');
    expect(typeof m.LIMITS).toBe('object');
    expect(typeof m.name).toBe('string'); // the record keys by run-order name
  });

  test('every member is registered, in contract order (registry.md §3; legacy not built yet)', () => {
    expect(R.MEMBERS.map((m) => m.name)).toEqual(['tag-complete', 'blueprint-qa', 'mcq-shape', 'scheme-sum', 'numeric-resolve', 'maths-check-secondary', 'figure-ban', 'key-leak', 'readability']);
  });

  test('members never read the clock, network or fs (static)', () => {
    [...files, 'index.js', 'walk.js', 'common.js', 'option-text.js', 'maths-recognisers.js'].forEach((f) => {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8');
      expect(src).not.toMatch(/require\(['"](?:fs|http|https|net|child_process)['"]\)|Date\.now|new Date\(|\beval\(|new Function\(|fetch\(/);
    });
  });

  test('line limit: every file is at most 300 lines', () => {
    fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).forEach((f) => {
      expect(fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').length).toBeLessThanOrEqual(300);
    });
  });

  test('srq import is used', () => { expect(srq('x', 's', 1).marks).toBe(1); });
});
