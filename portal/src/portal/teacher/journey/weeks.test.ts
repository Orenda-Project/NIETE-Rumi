import { describe, it, expect } from 'vitest';
import { dayWord, groupByWeek, pkDay, taughtInWindow, updatedLine, weekHeading } from './weeks';
import { JOURNEY_COPY } from './copy';

// Wed 19 Nov 2026, 14:40 Pakistan time.
const NOW = Date.parse('2026-11-19T14:40:00+05:00');
const at = (pk: string) => new Date(Date.parse(`${pk}+05:00`)).toISOString();
const step = (kind: string, pk: string) => ({ kind, at: at(pk), refId: `${kind}-${pk}`, meta: {} });
const DAYS = { today: 'Today', yesterday: 'Yesterday', weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const TIME = { am: 'AM', pm: 'PM' };

describe('pkDay', () => {
  it('is the Pakistan calendar day', () => {
    expect(pkDay(Date.parse('2026-11-18T19:30:00Z'))).toBe('2026-11-19'); // 00:30 PKT
    expect(pkDay(Date.parse('2026-11-18T18:59:00Z'))).toBe('2026-11-18');
  });
});

describe('groupByWeek (Pakistan weeks, Monday first, newest first)', () => {
  it('groups into weeks, skips empty weeks, keeps time order inside', () => {
    const groups = groupByWeek([
      step('quiz', '2026-11-17T09:00:00'), // Tue this week
      step('taught', '2026-11-19T08:00:00'), // Wed this week
      step('plan_opened', '2026-11-16T00:10:00'), // Mon this week (just after midnight PKT)
      step('coached', '2026-11-15T23:50:00'), // Sun last week
      step('exam', '2026-10-28T10:00:00'), // 3 weeks back
    ]);
    expect(groups.map((g) => g.start)).toEqual(['2026-11-16', '2026-11-09', '2026-10-26']);
    expect(groups[0].steps.map((s) => s.kind)).toEqual(['taught', 'quiz', 'plan_opened']);
  });
});

describe('weekHeading', () => {
  it('This week, Last week, then the dates (across a month too)', () => {
    expect(weekHeading('2026-11-16', NOW, JOURNEY_COPY)).toBe('This week');
    expect(weekHeading('2026-11-09', NOW, JOURNEY_COPY)).toBe('Last week');
    expect(weekHeading('2026-11-02', NOW, JOURNEY_COPY)).toBe('2 – 8 Nov');
    expect(weekHeading('2026-10-26', NOW, JOURNEY_COPY)).toBe('26 Oct – 1 Nov');
  });
});

describe('dayWord', () => {
  it('Today, Yesterday, else the weekday', () => {
    expect(dayWord(at('2026-11-19T01:00:00'), NOW, DAYS)).toBe('Today');
    expect(dayWord(at('2026-11-18T23:00:00'), NOW, DAYS)).toBe('Yesterday');
    expect(dayWord(at('2026-11-16T10:00:00'), NOW, DAYS)).toBe('Mon');
  });
});

describe('updatedLine', () => {
  it('a night run today → last night; a day run today → today and the time; a run yesterday → yesterday', () => {
    expect(updatedLine(at('2026-11-19T01:30:00'), NOW, JOURNEY_COPY, TIME)).toBe('Updated last night');
    expect(updatedLine(at('2026-11-19T14:30:00'), NOW, JOURNEY_COPY, TIME)).toBe('Updated today, 2:30 PM');
    expect(updatedLine(at('2026-11-18T14:30:00'), NOW, JOURNEY_COPY, TIME)).toBe('Updated yesterday, 2:30 PM');
    expect(updatedLine(at('2026-11-18T09:05:00'), NOW, JOURNEY_COPY, TIME)).toBe('Updated yesterday, 9:05 AM');
  });
  it('older, missing or junk → no line', () => {
    expect(updatedLine(at('2026-11-17T14:30:00'), NOW, JOURNEY_COPY, TIME)).toBeNull();
    expect(updatedLine(null, NOW, JOURNEY_COPY, TIME)).toBeNull();
    expect(updatedLine('soon', NOW, JOURNEY_COPY, TIME)).toBeNull();
  });
});

describe('taughtInWindow (Home tile\'s 30 Pakistan days)', () => {
  it('only taught steps from 29 days before today, at Pakistan midnight', () => {
    const steps = [
      step('taught', '2026-11-19T08:00:00'),
      step('taught', '2026-10-21T00:05:00'), // first day of the window
      step('taught', '2026-10-20T23:55:00'), // the day before
      step('quiz', '2026-11-18T08:00:00'),
    ];
    expect(taughtInWindow(steps, NOW).map((s) => s.at)).toEqual([steps[0].at, steps[1].at]);
  });
});
