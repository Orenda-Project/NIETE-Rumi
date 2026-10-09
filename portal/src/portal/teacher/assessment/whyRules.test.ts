import { describe, it, expect } from 'vitest';
import { checkPages, digitsOnly, newPicks, stepReady, stepWhy, typesStatus, type Picks, type Step } from './model';

/**
 * bd-fmf24g.34 — the limits the New paper holds her to, each with its reason. The limits are the server's
 * (bot question-types.js: MAX_QUESTIONS 50, per-type 1..50, MAX_TOTAL_MARKS 1000; internal-api.routes.js
 * /assessment/create: the per-type counts add up to the new questions, a Mix book count leaves room for one;
 * the Flow's PAGES screen: pages 1..the book's last page, from before to). None is invented here.
 */

const base = (over: Partial<Picks> = {}): Picks => ({ ...newPicks(15), grade: 4, subject: 'science', subjectName: 'Science', chapters: [1], ...over });

describe('digitsOnly', () => {
  it('keeps digits, turns Urdu and Arabic-Indic digits into the ones the server reads, drops the rest', () => {
    expect(digitsOnly('12a-3 ')).toBe('123');
    expect(digitsOnly('۱۲')).toBe('12');
    expect(digitsOnly('٣٤')).toBe('34');
    expect(digitsOnly('')).toBe('');
  });
});

describe('checkPages', () => {
  it('both numbers valid inside the book: ok', () => {
    expect(checkPages('4', '14', 235)).toEqual({ ok: true, from: 4, to: 14 });
    expect(checkPages('7', '7', 235)).toEqual({ ok: true, from: 7, to: 7 });
  });
  it('an empty box asks for it before it complains', () => {
    expect(checkPages('', '', 235)).toMatchObject({ ok: false, why: 'empty' });
    expect(checkPages('4', '', 235)).toMatchObject({ ok: false, why: 'empty' });
  });
  it('pages start at 1', () => {
    expect(checkPages('0', '5', 235)).toMatchObject({ ok: false, why: 'zero' });
  });
  it('from may not come after to', () => {
    expect(checkPages('12', '8', 235)).toEqual({ ok: false, why: 'order', from: 12, to: 8 });
  });
  it('past the book\'s last page', () => {
    expect(checkPages('200', '300', 235)).toEqual({ ok: false, why: 'beyond', last: 235 });
    expect(checkPages('250', '240', 235)).toMatchObject({ ok: false, why: 'beyond' });
  });
  it('with no known last page there is no upper limit to hold her to', () => {
    expect(checkPages('4', '900', null)).toEqual({ ok: true, from: 4, to: 900 });
  });
});

describe('typesStatus', () => {
  it('none picked, under, over, exactly the new questions', () => {
    expect(typesStatus(base({ count: 10, typeMode: 'pick', typeCounts: {} }))).toMatchObject({ kind: 'none', total: 0, target: 10 });
    expect(typesStatus(base({ count: 10, typeMode: 'pick', typeCounts: { MCQs: 6, 'True/False': 2 } }))).toMatchObject({ kind: 'under', total: 8, target: 10, diff: -2 });
    expect(typesStatus(base({ count: 10, typeMode: 'pick', typeCounts: { MCQs: 6, 'True/False': 3, 'Brief Answers': 3 } }))).toMatchObject({ kind: 'over', total: 12, target: 10, diff: 2 });
    expect(typesStatus(base({ count: 10, typeMode: 'pick', typeCounts: { MCQs: 10 } }))).toMatchObject({ kind: 'ok', total: 10 });
  });
  it('on a Mix the target is what is left after the book', () => {
    expect(typesStatus(base({ source: 'both', count: 15, seen: 5, typeMode: 'pick', typeCounts: { MCQs: 4 } }))).toMatchObject({ kind: 'under', target: 10, total: 4 });
  });
});

describe('stepWhy', () => {
  const STEPS: Step[] = ['class', 'cover', 'questions', 'types', 'extras', 'check'];
  it('is null exactly when the step is ready, on every step and every state tried', () => {
    const states: Picks[] = [
      newPicks(15), base(), base({ chapters: [] }), base({ coverBy: 'pages' }), base({ coverBy: 'pages', ranges: [[1, 2]] }),
      base({ count: 1, source: 'both', seen: 1 }), base({ source: 'both', count: 15, seen: 20 }), base({ typeMode: 'pick' }),
      base({ typeMode: 'pick', typeCounts: { MCQs: 15 } }), base({ marks: 5000 }), base({ marks: 40 }), base({ source: 'seen' }),
    ];
    for (const p of states) for (const s of STEPS) expect(stepWhy(s, p, 50) === null).toBe(stepReady(s, p, 50));
  });
  it('class, chapters, pages', () => {
    expect(stepWhy('class', newPicks(15), 50)).toEqual({ code: 'class' });
    expect(stepWhy('cover', base({ chapters: [] }), 50)).toEqual({ code: 'chapters' });
    expect(stepWhy('cover', base({ coverBy: 'pages' }), 50)).toEqual({ code: 'ranges' });
  });
  it('questions: out of range, and a Mix with no room for a new question', () => {
    expect(stepWhy('questions', base({ count: 60 }), 50)).toEqual({ code: 'count', max: 50 });
    expect(stepWhy('questions', base({ source: 'both', count: 1, seen: 1 }), 50)).toEqual({ code: 'seen', count: 1 });
  });
  it('types: none, too few, too many', () => {
    expect(stepWhy('types', base({ typeMode: 'pick', count: 10 }), 50)).toEqual({ code: 'typesNone' });
    expect(stepWhy('types', base({ typeMode: 'pick', count: 10, typeCounts: { MCQs: 8 } }), 50)).toEqual({ code: 'typesUnder', total: 8, target: 10 });
    expect(stepWhy('types', base({ typeMode: 'pick', count: 10, typeCounts: { MCQs: 12 } }), 50)).toEqual({ code: 'typesOver', total: 12, target: 10 });
    expect(stepWhy('types', base({ typeMode: 'auto', count: 10 }), 50)).toBeNull();
  });
  it('marks beyond the ceiling', () => {
    expect(stepWhy('extras', base({ marks: 1500 }), 50)).toEqual({ code: 'marks', max: 1000 });
  });
  it('check names the first step still to finish', () => {
    expect(stepWhy('check', base({ typeMode: 'pick', count: 10, typeCounts: { MCQs: 8 } }), 50)).toEqual({ code: 'earlier', step: 'types' });
    expect(stepWhy('check', newPicks(15), 50)).toEqual({ code: 'earlier', step: 'class' });
    expect(stepWhy('check', base(), 50)).toBeNull();
  });
});
