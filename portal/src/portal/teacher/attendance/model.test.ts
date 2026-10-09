import { describe, it, expect } from 'vitest';
import {
  addDays, calendar, classButton, dateWindow, filterStudents, markPayload, marksFrom, monthLabel, monthOf,
  pctTone, rollCounts, selectorGroups, setStatus, shiftMonth, type AttendanceClass,
} from './model';

/**
 * bd-fmf24g.7 — the teacher v2 Attendance screens' rules, without a browser:
 *   selector   her classes, not-marked first, searchable by class or subject;
 *   roll call  everyone present until marked otherwise (mark by exception), counts, the POST body;
 *   dates      WhatsApp's window — today back 90 days, never the future;
 *   view       a month as a Monday-first calendar, each marked day tinted by present %.
 */

const cls = (over: Partial<AttendanceClass>): AttendanceClass => ({
  listId: 'l', label: 'Grade 4 - A', grade: 4, section: 'A', subjects: ['General Science'], students: 32,
  marked: false, present: null, absent: null, leave: null, ...over,
});

describe('selector', () => {
  const A = cls({ listId: 'a' });
  const B = cls({ listId: 'b', label: 'Grade 5 - B', grade: 5, section: 'B', subjects: ['Mathematics'], marked: true, present: 26, absent: 2, leave: 0 });
  const C = cls({ listId: 'c', label: 'Grade 3 - A', grade: 3, section: 'A', subjects: ['English'] });

  it('not marked first, marked after, each in her order', () => {
    const g = selectorGroups([A, B, C], '');
    expect(g.notMarked.map((c) => c.listId)).toEqual(['a', 'c']);
    expect(g.marked.map((c) => c.listId)).toEqual(['b']);
  });

  it('search matches the class, its grade-section and its subject', () => {
    expect(selectorGroups([A, B, C], 'math').marked.map((c) => c.listId)).toEqual(['b']);
    expect(selectorGroups([A, B, C], '4-a').notMarked.map((c) => c.listId)).toEqual(['a']);
    expect(selectorGroups([A, B, C], 'grade 3').notMarked.map((c) => c.listId)).toEqual(['c']);
    expect(selectorGroups([A, B, C], 'zzz')).toEqual({ notMarked: [], marked: [] });
  });

  it('a class with grade and subject shows as Grade·Subject; one without, by its own name', () => {
    expect(classButton(A)).toEqual({ grade: 4, section: 'A', subject: 'General Science' });
    expect(classButton(cls({ grade: null, section: null, subjects: [], label: 'Morning class' })))
      .toEqual({ grade: '', section: '', subject: 'Morning class' });
    expect(classButton(cls({ subjects: [] }))).toEqual({ grade: '', section: '', subject: 'Grade 4 - A' });
  });
});

describe('roll call', () => {
  it('everyone present until marked: an empty marks map is "all present"', () => {
    expect(rollCounts(32, {})).toEqual({ present: 32, absent: 0, leave: 0 });
  });

  it('marking someone absent or on leave, and back to present', () => {
    let m = setStatus({}, 's1', 'absent');
    m = setStatus(m, 's2', 'leave');
    expect(rollCounts(32, m)).toEqual({ present: 30, absent: 1, leave: 1 });
    m = setStatus(m, 's1', 'present');
    expect(m).toEqual({ s2: 'leave' });
  });

  it('the POST body names only who is away', () => {
    expect(markPayload({ s1: 'absent', s2: 'leave', s3: 'absent' })).toEqual({ absentIds: ['s1', 's3'], leaveIds: ['s2'] });
  });

  it('a day already marked opens with its statuses (present ones are not stored)', () => {
    expect(marksFrom({ s1: 'present', s2: 'absent', s3: 'leave' })).toEqual({ s2: 'absent', s3: 'leave' });
  });

  it('student search: name, or the roll number exactly', () => {
    const kids = [{ id: '1', name: 'Ali Raza', roll: 1 }, { id: '2', name: 'Amna Khalid', roll: 12 }, { id: '3', name: 'Bilal', roll: 2 }];
    expect(filterStudents(kids, 'am').map((k) => k.id)).toEqual(['2']);
    expect(filterStudents(kids, '2').map((k) => k.id)).toEqual(['3']);
    expect(filterStudents(kids, '').map((k) => k.id)).toEqual(['1', '2', '3']);
  });
});

describe('dates', () => {
  it('the marking window is today back 90 days', () => {
    expect(dateWindow('2026-10-08')).toEqual({ min: '2026-07-10', max: '2026-10-08' });
  });
  it('days and months move across month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(monthOf('2026-10-08')).toBe('2026-10');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});

describe('view calendar', () => {
  it('present % tints: 90+ high, 75–89 mid, below 75 low', () => {
    expect([pctTone(90), pctTone(89), pctTone(75), pctTone(74)]).toEqual(['hi', 'mid', 'mid', 'lo']);
  });

  it('a Monday-first month: blanks before the 1st, marked days tinted, later days future', () => {
    const cells = calendar('2026-10', [{ date: '2026-10-01', present: 30, total: 32 }, { date: '2026-10-06', present: 23, total: 32 }], '2026-10-08');
    expect(cells.slice(0, 3).every((c) => c.tone === 'blank' && c.n === null)).toBe(true); // Oct 1 2026 is a Thursday
    const day = (n: number) => cells.find((c) => c.n === n)!;
    expect(day(1)).toMatchObject({ date: '2026-10-01', tone: 'hi', pct: 94 });
    expect(day(6)).toMatchObject({ tone: 'lo', pct: 72 });
    expect(day(7)).toMatchObject({ tone: 'unmarked', pct: null });
    expect(day(9)).toMatchObject({ tone: 'future' });
    expect(cells.length % 7).toBe(0);
  });
});
