import { describe, expect, it } from 'vitest';
import { ownUrl, readOwn, nextStep, prevStep, stepsFor, toAnswers } from './state';

/**
 * bd-snkn32 — "Make my own" keeps every answer in the address (the Lesson Plans rule: Back and a reload land where she
 * was). Codes only; anything not on the lists is dropped, never trusted.
 */

const at = { grade: 8, subject: 'Science', chapter: 'c02' };

describe('ownUrl / readOwn round trip', () => {
  it('carries the chapter, the step and every answer', () => {
    const url = ownUrl({ ...at, step: 'check', seg: 's1', size: '51_70', res: ['board', 'objects'], level: 'mixed', way: 'tarl' });
    expect(url.startsWith('/portal/teacher/lessons/own?')).toBe(true);
    const back = readOwn(url.split('?')[1]);
    expect(back).toEqual({ ...at, step: 'check', seg: 's1', size: '51_70', res: ['board', 'objects'], level: 'mixed', way: 'tarl', purpose: null, focus: null });
  });

  it('starts at pages with nothing answered', () => {
    expect(readOwn(new URLSearchParams({ grade: '8', subject: 'Science', chapter: 'c02' }).toString())).toEqual({
      ...at, step: 'pages', seg: null, size: null, res: [], level: null, way: null, purpose: null, focus: null,
    });
  });

  it('needs a grade 1–12, a subject and a chapter', () => {
    expect(readOwn('subject=Science&chapter=c02')).toBeNull();
    expect(readOwn('grade=13&subject=Science&chapter=c02')).toBeNull();
    expect(readOwn('grade=8&chapter=c02')).toBeNull();
    expect(readOwn('grade=8&subject=Science')).toBeNull();
  });

  it('drops anything off the lists', () => {
    const s = readOwn('grade=8&subject=Science&chapter=c02&step=nope&size=huge&res=board,slates&level=great&way=lecture&purpose=fun&focus=both');
    expect(s).toEqual({ ...at, step: 'pages', seg: null, size: null, res: ['board'], level: null, way: null, purpose: null, focus: null });
  });

  it('never carries the textbook in the address (it is always there)', () => {
    expect(ownUrl({ ...at, step: 'resources', res: ['textbook', 'board'] })).not.toMatch(/textbook/);
  });
});

describe('steps', () => {
  it('grades 1–5 run pages → size → resources → level → way → check', () => {
    const steps = stepsFor({ grade: 4, mixed: false });
    expect(steps).toEqual(['pages', 'size', 'resources', 'level', 'way', 'check']);
    expect(nextStep('pages', steps)).toBe('size');
    expect(nextStep('way', steps)).toBe('check');
    expect(nextStep('check', steps)).toBeNull();
    expect(prevStep('size', steps)).toBe('pages');
    expect(prevStep('pages', steps)).toBeNull();
  });
  // bd-snkn32.13
  it('grades 6–12 add what the lesson is for, and which outcomes first only on a mixed lesson', () => {
    expect(stepsFor({ grade: 8, mixed: false })).toEqual(['pages', 'size', 'resources', 'level', 'purpose', 'way', 'check']);
    const mixed = stepsFor({ grade: 10, mixed: true });
    expect(mixed).toEqual(['pages', 'size', 'resources', 'level', 'purpose', 'way', 'focus', 'check']);
    expect(nextStep('way', mixed)).toBe('focus');
    expect(prevStep('check', mixed)).toBe('focus');
    expect(stepsFor({ grade: 4, mixed: true })).not.toContain('focus');
  });
});

describe('toAnswers — what Make my plan sends', () => {
  it('the codes, the textbook added, and the note', () => {
    const s = readOwn('grade=8&subject=Science&chapter=c02&seg=s1&size=up30&res=board&level=ahead&way=games')!;
    expect(toAnswers(s, '  two grades  ')).toEqual({
      size: 'up30', resources: ['textbook', 'board'], level: 'ahead', way: 'games', note: 'two grades',
    });
  });
  it('bd-snkn32.13: a 6–12 plan also sends what it is for and the SLO focus', () => {
    const s = readOwn('grade=10&subject=Chemistry&chapter=c01&seg=s1&size=up30&level=ahead&way=worked&purpose=board&focus=summative')!;
    expect(toAnswers(s, '')).toEqual({
      size: 'up30', resources: ['textbook'], level: 'ahead', way: 'worked', note: '', purpose: 'board', focus: 'summative',
    });
  });
});
