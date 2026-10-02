/**
 * bd-s1oo0.1 — child-test item bank accessor (CONTRACT §2).
 * Pure module over bot/shared/data/child-test/item-bank.v1.json; nothing to mock.
 */
const path = require('path');
const fs = require('fs');

const bank = require('../../../bot/shared/services/child-test/item-bank');
const RAW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../../bot/shared/data/child-test/item-bank.v1.json'), 'utf8'));

describe('child-test item bank accessor', () => {
  test('version is the bank version string', () => {
    expect(bank.version).toBe('child-test-items-v1');
    expect(bank.version).toBe(RAW.version);
  });

  test('getForm returns the three blocks for every grade and form, accepting number or string grades', () => {
    for (const g of [3, 5, '3', '5']) {
      for (const f of ['A', 'B']) {
        const form = bank.getForm(g, f);
        expect(Object.keys(form).sort()).toEqual(['english', 'maths', 'urdu']);
        expect(form.urdu.story.id).toBe(`u${g}${f}-story`);
      }
    }
    expect(bank.getForm('5', 'a').maths.word_problem.id).toBe('m5A-wp');
  });

  test('getBlock returns one block', () => {
    const urdu = bank.getBlock(3, 'A', 'urdu');
    expect(urdu.questions).toHaveLength(3);
    expect(urdu.first_sounds).toHaveLength(5);
    expect(urdu.nonwords).toHaveLength(5);
    expect(bank.getBlock(5, 'B', 'english').nonwords).toHaveLength(8);
    expect(bank.getBlock(5, 'B', 'maths').quick_sums.length).toBeGreaterThanOrEqual(40);
  });

  test('maths blocks carry the strip code L2 prints and L5 compares (CONTRACT §11)', () => {
    for (const g of [3, 5]) for (const f of ['A', 'B']) {
      expect(bank.getBlock(g, f, 'maths').strip_code).toBe(`G${g}-${f}`);
    }
  });

  test('cue exposes the optional section cues (CONTRACT §10 CR-4)', () => {
    expect(Object.keys(bank.cue.urdu)).toEqual(expect.arrayContaining(['start', 'stop', 'questions', 'first_sounds', 'nonwords']));
    expect(Object.keys(bank.cue.english)).toEqual(expect.arrayContaining(['start', 'stop', 'questions', 'nonwords']));
    expect(Object.keys(bank.cue.maths)).toEqual(expect.arrayContaining(['start', 'stop', 'numbers', 'quick_sums', 'word_problem']));
    expect(bank.cue.english.nonwords).toBe('Now read these made-up words');
  });

  test('getForm / getBlock throw on an unknown grade, form or block', () => {
    expect(() => bank.getForm(4, 'A')).toThrow(/grade/);
    expect(() => bank.getForm(3, 'C')).toThrow(/form/);
    expect(() => bank.getBlock(3, 'A', 'science')).toThrow(/block/);
  });

  test('getItem finds any item by id, with its place in the bank', () => {
    const q = bank.getItem('u3A-q1');
    expect(q).toMatchObject({ grade: '3', form: 'A', block: 'urdu', kind: 'questions' });
    expect(q.item.id).toBe('u3A-q1');
    expect(q.item.accept.length).toBeGreaterThan(0);

    expect(bank.getItem('e5B-story')).toMatchObject({ grade: '5', form: 'B', block: 'english', kind: 'story' });
    expect(bank.getItem('m5A-wp').item.answer).toBe(144);
    expect(bank.getItem('m3B-qs7')).toMatchObject({ block: 'maths', kind: 'quick_sums' });
    expect(bank.getItem('u5B-nw2').kind).toBe('nonwords');
    expect(bank.getItem('u3A-fs5').kind).toBe('first_sounds');
  });

  test('getItem returns null for an unknown id', () => {
    expect(bank.getItem('u9Z-q1')).toBeNull();
    expect(bank.getItem(undefined)).toBeNull();
  });

  test('returned content is frozen, so one caller cannot corrupt the bank for the next', () => {
    const form = bank.getForm(3, 'A');
    expect(Object.isFrozen(form)).toBe(true);
    expect(Object.isFrozen(form.urdu.story.tokens)).toBe(true);
    expect(() => { 'use strict'; form.urdu.story.tokens.push('x'); }).toThrow();
    expect(bank.getForm(3, 'A').urdu.story.tokens).toEqual(RAW.grades['3'].forms.A.urdu.story.tokens);
  });

  test('every id in the bank is reachable through getItem and resolves to the same object', () => {
    let n = 0;
    for (const g of ['3', '5']) for (const f of ['A', 'B']) {
      const form = RAW.grades[g].forms[f];
      for (const [block, content] of Object.entries(form)) {
        for (const [kind, v] of Object.entries(content)) {
          const list = Array.isArray(v) ? v : (v && typeof v === 'object' && v.id ? [v] : []);
          for (const it of list) {
            if (!it || !it.id) continue;
            const hit = bank.getItem(it.id);
            expect(hit).toMatchObject({ grade: g, form: f, block, kind });
            expect(hit.item).toEqual(it);
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(300);
  });
});
