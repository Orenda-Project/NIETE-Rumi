import { describe, expect, it } from 'vitest';
import { ownUrl, readOwn, stepsFor, toAnswers } from './state';

/**
 * bd-snkn32.56 (queue #134 E) — "Start from a learning goal or topic": the goal rides in the address like every other
 * answer (`start=goal`, `gk` outcome|topic, `gt` its words, `seg` the closest lesson the bot writes over). Grades 6–12
 * only; the walk swaps the book-pages screen for the goal screen; Make my plan sends the goal and no pages.
 */

const at = { grade: 7, subject: 'General Science', chapter: 'c01' };
const base = { ...at, seg: 'g7.c03.p020', size: '51_70' as const, res: ['board' as const], level: 'mixed' as const, way: 'worked' as const, purpose: 'new' as const, focus: null };

describe('the goal in the address', () => {
  it('round-trips the goal and the lesson under it', () => {
    const url = ownUrl({ ...base, step: 'check', goal: { kind: 'topic', text: 'Rain and the water cycle' } });
    const back = readOwn(url.split('?')[1]);
    expect(back?.goal).toEqual({ kind: 'topic', text: 'Rain and the water cycle' });
    expect(back?.seg).toBe('g7.c03.p020');
  });

  it('on the goal screen before she picks: an empty goal', () => {
    expect(readOwn(ownUrl({ ...at, step: 'goal', goal: { kind: null, text: '' } }).split('?')[1])?.goal).toEqual({ kind: null, text: '' });
  });

  it('a book start has no goal key at all', () => {
    expect(readOwn(ownUrl({ ...base, step: 'size' }).split('?')[1])).not.toHaveProperty('goal');
  });

  it('grades 1–5 take a goal too (bd-snkn32.57), and an unknown kind is dropped', () => {
    expect(readOwn('grade=3&subject=math&chapter=1&start=goal&gk=topic&gt=Shapes')?.goal).toEqual({ kind: 'topic', text: 'Shapes' });
    expect(readOwn('grade=7&subject=Maths&chapter=c1&start=goal&gk=book&gt=Shapes')?.goal).toEqual({ kind: null, text: 'Shapes' });
  });

  it('bounds the words she typed', () => {
    expect(readOwn(`grade=7&subject=Maths&chapter=c1&start=goal&gk=topic&gt=${'x'.repeat(400)}`)?.goal?.text).toHaveLength(120);
  });
});

describe('the walk with a goal', () => {
  it('the goal screen replaces the book pages, and no "which outcomes first"', () => {
    expect(stepsFor({ grade: 10, mixed: true, purpose: 'new', goal: true })).toEqual(['goal', 'purpose', 'size', 'level', 'resources', 'way', 'check']);
  });
  it('grades 1–5: the goal screen replaces the day\'s pages (bd-snkn32.57), then what the lesson is for (bd-snkn32.63)', () => {
    expect(stepsFor({ grade: 3, mixed: false, goal: true })).toEqual(['goal', 'purpose', 'size', 'level', 'resources', 'way', 'check']);
  });
  it('without a goal, as before', () => {
    expect(stepsFor({ grade: 10, mixed: false })).toEqual(['pages', 'purpose', 'size', 'level', 'resources', 'way', 'check']);
  });
});

describe('Make my plan with a goal', () => {
  it('sends her goal, no book pages, no next lesson and no textbook', () => {
    const a = toAnswers({ ...base, step: 'check', goal: { kind: 'outcome', text: 'Describe the water cycle' }, pg: { start: 1, end: 2 }, ext: 'one_period' }, '', 'next-1');
    expect((a as { goal?: unknown }).goal).toEqual({ kind: 'outcome', text: 'Describe the water cycle' });
    expect(a).not.toHaveProperty('pages');
    expect(a).not.toHaveProperty('extend');
    expect(a.resources).toEqual(['board']);
  });
  it('a book start sends the textbook and no goal, as before', () => {
    const a = toAnswers({ ...base, step: 'check' }, '');
    expect(a).not.toHaveProperty('goal');
    expect(a.resources).toEqual(['textbook', 'board']);
  });
  it('bd-m8zwt1.3: a picked outcome keeps up to 400 characters in the URL; a typed topic stays at 120', () => {
    const long = 'a'.repeat(371);
    expect(readOwn(`grade=3&subject=math&start=goal&gk=outcome&gt=${long}`)?.goal?.text).toHaveLength(371);
    expect(new URLSearchParams(ownUrl({ grade: 3, subject: 'math', step: 'check', goal: { kind: 'outcome', text: long } }).split('?')[1]).get('gt')).toHaveLength(371);
    expect(readOwn(`grade=3&subject=math&start=goal&gk=outcome&gt=${'b'.repeat(900)}`)?.goal?.text).toHaveLength(400);
    expect(readOwn(`grade=3&subject=math&start=goal&gk=topic&gt=${long}`)?.goal?.text).toHaveLength(120);
  });
});
