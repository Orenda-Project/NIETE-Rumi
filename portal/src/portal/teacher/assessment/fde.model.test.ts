import { describe, it, expect } from 'vitest';
import {
  STEPS, FDE_STEPS, newPicks, stepsFor, stepWhy, toSpec, fromSpec, fdeUnitRanges, type Picks,
} from './model';

/**
 * The FDE board pattern on the New paper: two steps (Class, Check) instead of four, a spec that names the pattern
 * and lets the server resolve the FDE syllabus, and a paper without the pattern sent exactly as today.
 */

const today = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15), grade: 4, subject: 'science', subjectName: 'Science', chapters: [2, 1],
  typesSeeded: true, seen: 5, typeCounts: { MCQs: 10 }, ...over,
});
const fde = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15), grade: 5, subject: 'maths', subjectName: 'Maths',
  coverBy: 'fde', style: 'fde', pattern: 'fde_g5_2027', patternIntent: 'fde_g5_2027', ...over,
});

describe('stepsFor', () => {
  it('golden: not eligible is today\'s four steps, exactly', () => {
    expect(stepsFor(today(), false)).toEqual(STEPS);
    expect(stepsFor(fde(), false)).toEqual(STEPS);
    expect(STEPS).toEqual(['class', 'cover', 'questions', 'check']);
  });
  it('eligible but an own paper: today\'s four steps', () => {
    expect(stepsFor(fde({ style: 'own', coverBy: 'chapters' }), true)).toEqual(STEPS);
  });
  it('eligible and the FDE board pattern: Class, then Check', () => {
    expect(stepsFor(fde(), true)).toEqual(['class', 'check']);
    expect(FDE_STEPS).toEqual(['class', 'check']);
  });
});

describe('stepWhy on the FDE path', () => {
  it('Check is ready with the FDE syllabus', () => {
    expect(stepWhy('check', fde(), 50)).toBeNull();
  });
  it('a customised syllabus with no unit picked says why', () => {
    expect(stepWhy('check', fde({ coverBy: 'chapters', chapters: [] }), 50)).toEqual({ code: 'chapters' });
    expect(stepWhy('check', fde({ coverBy: 'pages', ranges: [] }), 50)).toEqual({ code: 'chapters' });
    expect(stepWhy('check', fde({ coverBy: 'chapters', chapters: [3] }), 50)).toBeNull();
  });
  it('busy: a paper for this class is being made', () => {
    expect(stepWhy('check', fde(), 50, { busy: true })).toEqual({ code: 'generating' });
  });
  it('the side door: with the card offered, an empty Chapters step asks for chapters or the pattern', () => {
    const p = today({ grade: 5, subject: 'maths', chapters: [] });
    expect(stepWhy('cover', p, 50)).toEqual({ code: 'chapters' });
    expect(stepWhy('cover', p, 50, { offerFde: true })).toEqual({ code: 'scopeOrFde' });
    expect(stepWhy('cover', fde(), 50, { offerFde: true })).toBeNull();
  });
});

describe('toSpec', () => {
  it('golden: a paper without the pattern is sent exactly as today, with no new keys', () => {
    const s = toSpec(today());
    expect(s).toEqual({
      grade: 4, subject: 'science', chapterNumbers: [1, 2], pageRanges: null,
      questionCount: 15, contentSource: 'both', seenCount: 5, questionTypes: [{ id: 'MCQs', count: 10 }],
      totalMarks: null, answerLines: true, outputFormat: 'pdf',
    });
    expect(Object.keys(s)).not.toContain('pattern');
    expect(Object.keys(s)).not.toContain('scope');
  });
  it('the FDE syllabus: the pattern and scope fde, no chapters, pages or marks', () => {
    const s = toSpec(fde());
    expect(s).toEqual({
      grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde',
      questionCount: 0, contentSource: 'unseen', seenCount: null, questionTypes: [],
      answerLines: true, outputFormat: 'pdf',
    });
    expect(JSON.stringify(s)).not.toContain('totalMarks');
  });
  it('a customised FDE paper: the pattern with chosen chapters, or pages, and no scope', () => {
    expect(toSpec(fde({ coverBy: 'chapters', chapters: [4, 3] }))).toEqual({
      grade: 5, subject: 'maths', pattern: 'fde_g5_2027', chapterNumbers: [3, 4],
      questionCount: 0, contentSource: 'unseen', seenCount: null, questionTypes: [],
      answerLines: true, outputFormat: 'pdf',
    });
    expect(toSpec(fde({ coverBy: 'pages', ranges: [[42, 66], [68, 90]] }))).toMatchObject({
      pattern: 'fde_g5_2027', pageRanges: '42-66, 68-90',
    });
  });
  it('an own paper after picking FDE first: today\'s spec, no pattern', () => {
    const s = toSpec(fde({ style: 'own', coverBy: 'chapters', chapters: [1, 2], typesSeeded: true, typeCounts: { MCQs: 10 } }));
    expect(s).not.toHaveProperty('pattern');
    expect(s).toMatchObject({ chapterNumbers: [1, 2], questionCount: 15 });
  });
});

describe('fromSpec', () => {
  it('round-trips an FDE request (Change choices on a paper that failed)', () => {
    expect(fromSpec(toSpec(fde()), 'Maths')).toMatchObject({
      grade: 5, subject: 'maths', style: 'fde', pattern: 'fde_g5_2027', patternIntent: 'fde_g5_2027', coverBy: 'fde',
    });
    expect(fromSpec(toSpec(fde({ coverBy: 'chapters', chapters: [3] })), 'Maths')).toMatchObject({
      style: 'fde', coverBy: 'chapters', chapters: [3],
    });
  });
  it('a plain request comes back with no pattern', () => {
    expect(fromSpec(toSpec(today()), 'Science')).toMatchObject({ style: null, pattern: null, coverBy: 'chapters' });
  });
});

describe('fdeUnitRanges', () => {
  it('Maths units as page ranges, from the options\' unitRanges (several runs per unit)', () => {
    const unitRanges = [{ chapter: 3, ranges: '42-66' }, { chapter: 11, ranges: '218-226, 239-244' }];
    expect(fdeUnitRanges(unitRanges, [3, 11])).toEqual([[42, 66], [218, 226], [239, 244]]);
    expect(fdeUnitRanges(unitRanges, [11])).toEqual([[218, 226], [239, 244]]);
  });
});
