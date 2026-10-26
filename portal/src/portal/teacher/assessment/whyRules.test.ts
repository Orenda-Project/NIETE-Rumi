import { describe, it, expect } from 'vitest';
import { STEPS, checkPages, digitsOnly, newPicks, stepReady, stepWhy, type Picks } from './model';

/**
 * bd-fmf24g.34 — the limits the New paper holds her to, each with its reason. The limits are the server's
 * (bot question-types.js: MAX_QUESTIONS 50, MAX_TYPE_SLOTS 8, MAX_TOTAL_MARKS 1000; the Flow's PAGES screen: pages
 * 1..the book's last page, from before to), and one of the page's own: marks under the question count, because the
 * generator drops whole questions to fit a budget it cannot meet.
 */

const base = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15), grade: 4, subject: 'science', subjectName: 'Science', chapters: [1], typesSeeded: true, seen: 5, typeCounts: { MCQs: 10 }, ...over,
});

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

describe('stepWhy', () => {
  it('is null exactly when the step is ready, on every step and every state tried', () => {
    const states: Picks[] = [
      newPicks(15), base(), base({ chapters: [] }), base({ coverBy: 'pages' }), base({ coverBy: 'pages', ranges: [[1, 2]] }),
      base({ seen: 0, typeCounts: {} }), base({ seen: 45, typeCounts: { MCQs: 10 } }), base({ typeCounts: {} }),
      base({ marks: 5000 }), base({ marks: 40 }), base({ marks: 3 }), base({ seen: 0 }),
    ];
    for (const p of states) for (const s of STEPS) expect(stepWhy(s, p, 50) === null).toBe(stepReady(s, p, 50));
  });
  it('class, chapters, pages', () => {
    expect(stepWhy('class', newPicks(15), 50)).toEqual({ code: 'class' });
    expect(stepWhy('cover', base({ chapters: [] }), 50)).toEqual({ code: 'chapters' });
    expect(stepWhy('cover', base({ coverBy: 'pages' }), 50)).toEqual({ code: 'ranges' });
  });
  it('questions: none at all, past the cap, more types than a paper takes', () => {
    expect(stepWhy('questions', base({ seen: 0, typeCounts: {} }), 50)).toEqual({ code: 'none' });
    expect(stepWhy('questions', base({ seen: 45, typeCounts: { MCQs: 10 } }), 50)).toEqual({ code: 'count', max: 50 });
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`T${i}`, 1]));
    expect(stepWhy('questions', base({ typeCounts: nine }), 50)).toEqual({ code: 'typesMax', max: 8 });
  });
  it('marks: beyond the ceiling, or under the question count', () => {
    expect(stepWhy('questions', base({ marks: 1500 }), 50)).toEqual({ code: 'marks', max: 1000 });
    expect(stepWhy('questions', base({ marks: 14 }), 50)).toEqual({ code: 'marksLow', total: 15 });
    expect(stepWhy('questions', base({ marks: 15 }), 50)).toBeNull();
  });
  it('check names the first step still to finish', () => {
    expect(stepWhy('check', base({ marks: 3 }), 50)).toEqual({ code: 'earlier', step: 'questions' });
    expect(stepWhy('check', newPicks(15), 50)).toEqual({ code: 'earlier', step: 'class' });
    expect(stepWhy('check', base(), 50)).toBeNull();
  });
});
