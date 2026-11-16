import { describe, it, expect } from 'vitest';
import { CHANGE_PARTS, LESSONS_CHANGE, changeUrl, checkLocal, isRefusal, readChange, type ChangeAt } from './change';

/**
 * bd-snkn32.15 — "Change this plan", the pure part: which parts she may pick (the bot's own list, per band), where the
 * page is (all in the address), and the one check made on the phone before anything is sent (too short).
 */

const AT: ChangeAt = { own: 'own-1', band: 'k5', left: 2, grade: 4, subject: 'math', chapter: '1', lesson: 'g4m2', title: 'Adding' };

describe('the parts she may change', () => {
  it('grades 1–5: the five GRR steps; grades 6–12: the plan\'s own sections — never the whole plan (bd-snkn32.19)', () => {
    expect(CHANGE_PARTS.k5).toEqual(['hook', 'i_do', 'we_do', 'you_do', 'wrap']);
    expect(CHANGE_PARTS.g612).toEqual(['objectives', 'introduction', 'development', 'activity', 'conclusion', 'homework']);
    expect(checkLocal('g612', 'whole', 'Rewrite the whole plan please')).toBe('bad_request');
  });
});

describe('the address', () => {
  it('round-trips', () => {
    expect(changeUrl(AT).startsWith(`${LESSONS_CHANGE}?`)).toBe(true);
    expect(readChange(changeUrl(AT).split('?')[1])).toEqual(AT);
    const g612 = { ...AT, band: 'g612' as const, left: 1, chapter: undefined, title: undefined, lesson: 'sci8.c02.p010' };
    expect(readChange(changeUrl(g612).split('?')[1])).toEqual(g612);
  });

  it('bd-snkn32.19: a section card names its part, and only a part of her band survives', () => {
    const withPart = { ...AT, part: 'we_do' as const };
    expect(readChange(changeUrl(withPart).split('?')[1])).toEqual(withPart);
    expect(readChange(changeUrl(AT).split('?')[1] + '&part=whole')).toEqual(AT);
    expect(readChange(changeUrl(AT).split('?')[1] + '&part=development')).toEqual(AT);
  });

  it('refuses an address without a plan, a band, a grade, a subject or a lesson', () => {
    const q = (over: Record<string, string>) => new URLSearchParams({ own: 'o', band: 'k5', remaining: '2', grade: '4', subject: 'math', lesson: 'l', ...over }).toString();
    expect(readChange(q({}))).not.toBeNull();
    for (const bad of [{ own: '' }, { band: 'x' }, { grade: '0' }, { grade: '13' }, { subject: '' }, { lesson: '' }]) {
      expect(readChange(q(bad))).toBeNull();
    }
  });

  it('changes left is 0, 1 or 2, never anything else', () => {
    const left = (v: string) => readChange(new URLSearchParams({ own: 'o', band: 'k5', remaining: v, grade: '4', subject: 'm', lesson: 'l' }).toString())?.left;
    expect(left('1')).toBe(1);
    expect(left('9')).toBe(2);
    expect(left('-3')).toBe(0);
    expect(left('x')).toBe(0);
  });
});

describe('before anything is sent', () => {
  it('needs a part from her band and at least 15 characters', () => {
    expect(checkLocal('k5', 'we_do', 'Make it a group game')).toBeNull();
    expect(checkLocal('k5', 'we_do', '  more games  ')).toBe('too_short');
    expect(checkLocal('k5', 'whole', 'Make it a group game')).toBe('bad_request');
    expect(checkLocal('g612', null, 'Make it a group game')).toBe('bad_request');
  });

  it('knows the bot\'s refusals and nothing else', () => {
    for (const o of ['too_short', 'too_small', 'repeat', 'in_flight', 'cap_reached', 'daily_limit', 'grr', 'rote']) expect(isRefusal(o)).toBe(true);
    expect(isRefusal('bad_request')).toBe(false);
    expect(isRefusal('<script>')).toBe(false);
    expect(isRefusal(undefined)).toBe(false);
  });
});
