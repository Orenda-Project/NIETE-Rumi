import { describe, it, expect } from 'vitest';
import { EXTENDS, nextLesson } from './extend';
import { ownUrl, readOwn, toAnswers } from './state';

/** bd-snkn32.14 — "Add the next lesson's pages": the next lesson is the one right after hers in the chapter list. */
const L = (id: string, lane: 'g612' | 'k5' = 'g612', kind: 'lesson' | 'day' | 'worksheet' = 'lesson') =>
  ({ id, lane, kind, number: null, part: null, title: id, pages: null, sent: false, answerKey: false });

describe('nextLesson', () => {
  const list = [L('a'), L('b'), L('c')];
  it('is the lesson right after hers', () => expect(nextLesson(list, 'a')?.id).toBe('b'));
  it('is nothing on the last lesson of the chapter', () => expect(nextLesson(list, 'c')).toBeNull());
  it('is nothing for no lesson, or a lesson not in the list', () => {
    expect(nextLesson(list, null)).toBeNull();
    expect(nextLesson(list, 'zz')).toBeNull();
  });
  it('is grades 6–12 only', () => expect(nextLesson([L('a', 'k5', 'day'), L('b', 'k5', 'day')], 'a')).toBeNull());
});

describe('the address and the body', () => {
  it('keeps the shape in the address, and drops one off the list', () => {
    const url = ownUrl({ grade: 8, subject: 'Science', chapter: 'c02', seg: 'a', ext: 'double' });
    expect(url).toContain('ext=double');
    expect(readOwn(url.split('?')[1])?.ext).toBe('double');
    expect(readOwn('grade=8&subject=S&chapter=c&ext=triple')?.ext).toBeFalsy();
    expect(EXTENDS).toEqual(['one_period', 'double']);
  });
  it('sends the next lesson and the shape only when both are there', () => {
    const s = readOwn('grade=8&subject=S&chapter=c&seg=a&size=up30&level=behind&way=tarl&ext=one_period')!;
    expect(toAnswers(s, '', 'b')).toEqual(expect.objectContaining({ extend: { next: 'b', shape: 'one_period' } }));
    expect(toAnswers(s, '', null)).not.toHaveProperty('extend');
    expect(toAnswers({ ...s, ext: null }, '', 'b')).not.toHaveProperty('extend');
  });
});
