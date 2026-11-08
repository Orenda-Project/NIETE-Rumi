import { describe, expect, it } from 'vitest';
import { OWN_STEPS, ownUrl, readOwn, nextStep, prevStep, toAnswers } from './state';

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
    expect(back).toEqual({ ...at, step: 'check', seg: 's1', size: '51_70', res: ['board', 'objects'], level: 'mixed', way: 'tarl' });
  });

  it('starts at pages with nothing answered', () => {
    expect(readOwn(new URLSearchParams({ grade: '8', subject: 'Science', chapter: 'c02' }).toString())).toEqual({
      ...at, step: 'pages', seg: null, size: null, res: [], level: null, way: null,
    });
  });

  it('needs a grade 1–12, a subject and a chapter', () => {
    expect(readOwn('subject=Science&chapter=c02')).toBeNull();
    expect(readOwn('grade=13&subject=Science&chapter=c02')).toBeNull();
    expect(readOwn('grade=8&chapter=c02')).toBeNull();
    expect(readOwn('grade=8&subject=Science')).toBeNull();
  });

  it('drops anything off the lists', () => {
    const s = readOwn('grade=8&subject=Science&chapter=c02&step=nope&size=huge&res=board,slates&level=great&way=lecture');
    expect(s).toEqual({ ...at, step: 'pages', seg: null, size: null, res: ['board'], level: null, way: null });
  });

  it('never carries the textbook in the address (it is always there)', () => {
    expect(ownUrl({ ...at, step: 'resources', res: ['textbook', 'board'] })).not.toMatch(/textbook/);
  });
});

describe('steps', () => {
  it('runs pages → size → resources → level → way → check', () => {
    expect(OWN_STEPS).toEqual(['pages', 'size', 'resources', 'level', 'way', 'check']);
    expect(nextStep('pages')).toBe('size');
    expect(nextStep('way')).toBe('check');
    expect(nextStep('check')).toBeNull();
    expect(prevStep('size')).toBe('pages');
    expect(prevStep('pages')).toBeNull();
  });
});

describe('toAnswers — what Make my plan sends', () => {
  it('the codes, the textbook added, and the note', () => {
    const s = readOwn('grade=8&subject=Science&chapter=c02&seg=s1&size=up30&res=board&level=ahead&way=games')!;
    expect(toAnswers(s, '  two grades  ')).toEqual({
      size: 'up30', resources: ['textbook', 'board'], level: 'ahead', way: 'games', note: 'two grades',
    });
  });
});
