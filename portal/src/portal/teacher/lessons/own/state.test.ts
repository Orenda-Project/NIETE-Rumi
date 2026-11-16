import { describe, expect, it } from 'vitest';
import { ownUrl, readOwn, nextStep, prevStep, stepsFor, toAnswers } from './state';

/**
 * bd-snkn32 — "Make my own" keeps every answer in the address (the Lesson Plans rule: Back and a reload land where she
 * was). Codes only; anything not on the lists is dropped, never trusted.
 */

const at = { grade: 8, subject: 'Science', chapter: 'c02' };

describe('ownUrl / readOwn round trip', () => {
  it('carries the chapter, the step and every answer', () => {
    const url = ownUrl({ ...at, step: 'check', seg: 's1', size: '51_70', res: ['board', 'objects'], level: 'mixed', way: 'practical', purpose: 'board' });
    expect(url.startsWith('/portal/teacher/lessons/own?')).toBe(true);
    const back = readOwn(url.split('?')[1]);
    expect(back).toEqual({ ...at, step: 'check', seg: 's1', size: '51_70', res: ['board', 'objects'], level: 'mixed', way: 'practical', purpose: 'board', focus: null });
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

describe('steps — bd-snkn32.19: one flow 1–12, only the lists differ', () => {
  it('grades 1–5 run pages → size → level → resources → way → check', () => {
    const steps = stepsFor({ grade: 4, mixed: false });
    expect(steps).toEqual(['pages', 'size', 'level', 'resources', 'way', 'check']);
    expect(nextStep('pages', steps)).toBe('size');
    expect(nextStep('way', steps)).toBe('check');
    expect(nextStep('check', steps)).toBeNull();
    expect(prevStep('size', steps)).toBe('pages');
    expect(prevStep('pages', steps)).toBeNull();
  });
  it('grades 6–12 ask what the lesson is for right after the pages', () => {
    expect(stepsFor({ grade: 8, mixed: false })).toEqual(['pages', 'purpose', 'size', 'level', 'resources', 'way', 'check']);
    expect(stepsFor({ grade: 7, mixed: true })).not.toContain('focus');
  });
  it('which outcomes first: grades 9–12, a mixed lesson, and not exam practice', () => {
    const mixed = stepsFor({ grade: 10, mixed: true, purpose: 'new' });
    expect(mixed).toEqual(['pages', 'purpose', 'focus', 'size', 'level', 'resources', 'way', 'check']);
    expect(nextStep('purpose', mixed)).toBe('focus');
    expect(prevStep('size', mixed)).toBe('focus');
    expect(stepsFor({ grade: 10, mixed: true, purpose: 'board' })).not.toContain('focus');
    expect(stepsFor({ grade: 10, mixed: false, purpose: 'new' })).not.toContain('focus');
    expect(stepsFor({ grade: 4, mixed: true })).not.toContain('focus');
  });
});

describe('readOwn — the band decides what survives (bd-snkn32.19)', () => {
  it('drops a way that is not on her list for this grade and subject', () => {
    expect(readOwn('grade=8&subject=Science&chapter=c02&way=tarl')!.way).toBeNull();
    expect(readOwn('grade=4&subject=Science&chapter=c02&way=past_paper')!.way).toBeNull();
    expect(readOwn('grade=10&subject=Chemistry&chapter=c02&way=worked')!.way).toBeNull();
    expect(readOwn('grade=4&subject=Urdu&chapter=c02&way=phonics')!.way).toBe('phonics');
  });
  it('drops exam practice below Grade 8 and any purpose at 1–5', () => {
    expect(readOwn('grade=7&subject=Science&chapter=c02&purpose=board')!.purpose).toBeNull();
    expect(readOwn('grade=8&subject=Science&chapter=c02&purpose=board')!.purpose).toBe('board');
    expect(readOwn('grade=4&subject=Science&chapter=c02&purpose=new')!.purpose).toBeNull();
  });
  it('drops the outcomes focus below Grade 9 and on exam practice', () => {
    expect(readOwn('grade=8&subject=Science&chapter=c02&focus=summative')!.focus).toBeNull();
    expect(readOwn('grade=10&subject=Physics&chapter=c02&purpose=board&focus=summative')!.focus).toBeNull();
    expect(readOwn('grade=10&subject=Physics&chapter=c02&purpose=new&focus=summative')!.focus).toBe('summative');
  });
  it('drops adding the next lesson at 1–5 and keeps chosen pages at every band', () => {
    expect(readOwn('grade=4&subject=Science&chapter=c02&ext=double')!.ext).toBeUndefined();
    expect(readOwn('grade=10&subject=Physics&chapter=c02&pg=12-14')!.pg).toEqual({ start: 12, end: 14 });
  });
});

describe('toAnswers — what Make my plan sends', () => {
  it('the codes, the textbook added, and the note', () => {
    const s = readOwn('grade=4&subject=Science&chapter=c02&seg=s1&size=up30&res=board&level=ahead&way=games')!;
    expect(toAnswers(s, '  two grades  ')).toEqual({
      size: 'up30', resources: ['textbook', 'board'], level: 'ahead', way: 'games', note: 'two grades',
    });
  });
  it('bd-snkn32.13: a 6–12 plan also sends what it is for and the SLO focus', () => {
    const s = readOwn('grade=10&subject=Mathematics&chapter=c01&seg=s1&size=up30&level=ahead&way=worked&purpose=revise&focus=summative')!;
    expect(toAnswers(s, '')).toEqual({
      size: 'up30', resources: ['textbook'], level: 'ahead', way: 'worked', note: '', purpose: 'revise', focus: 'summative',
    });
  });
});

/** bd-snkn32.24 — she may tick more than one teaching way; the first is still `way`. */
describe('several teaching ways', () => {
  it('reads a comma list in her order, once each, dropping ways off her list', () => {
    const s = readOwn('grade=2&subject=English&chapter=c01&way=games,tarl,games,practical');
    expect(s?.ways).toEqual(['games', 'tarl']);
    expect(s?.way).toBe('games');
  });
  it('one way alone carries no list (old addresses read the same)', () => {
    expect(readOwn('grade=2&subject=English&chapter=c01&way=tarl')?.ways).toBeUndefined();
  });
  it('writes the list back into the address and sends it to the bot', () => {
    const s = readOwn('grade=2&subject=English&chapter=c01&way=games,tarl')!;
    expect(ownUrl(s)).toContain('way=games%2Ctarl');
    expect(toAnswers(s, '')).toMatchObject({ way: 'games', ways: ['games', 'tarl'] });
    expect(toAnswers(readOwn('grade=2&subject=English&chapter=c01&way=tarl')!, '')).not.toHaveProperty('ways');
  });
});
