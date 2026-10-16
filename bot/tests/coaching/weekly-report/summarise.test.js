'use strict';
/**
 * bd-v0toag.32 — the pure summariser: one teacher's rows for one week in, the five numbers out.
 * No database, no clock. The definitions follow ab-test-v10-coaching/workbench/tracking/*.sql.
 */

const { summarise, isQuietWeek } = require('../../../shared/services/coaching/weekly-report/summarise');

const empty = () => ({
  messages: [], deliveries: [], opens: [], sessions: [], ratings: [], checks: [],
});

describe('summarise — lesson plans opened', () => {
  test('distinct lessons across WhatsApp deliveries and app opens; the same lesson twice counts once', () => {
    const s = summarise({
      ...empty(),
      deliveries: [
        { lesson_id: 'L1', created_at: '2026-10-12T04:00:00Z' },
        { lesson_id: 'L1', created_at: '2026-10-13T04:00:00Z' },
        { lesson_id: 'L2', created_at: '2026-10-13T05:00:00Z' },
      ],
      opens: [
        { plan_ref: 'L2', opened_at: '2026-10-14T05:00:00Z' },
        { plan_ref: 'L3', opened_at: '2026-10-14T06:00:00Z' },
      ],
    });
    expect(s.lessonPlans).toBe(3);
  });

  test('rows with no lesson id are not a lesson plan', () => {
    const s = summarise({ ...empty(), deliveries: [{ lesson_id: null, created_at: '2026-10-12T04:00:00Z' }] });
    expect(s.lessonPlans).toBe(0);
  });
});

describe('summarise — recordings sent', () => {
  test('one per graded recording session', () => {
    const s = summarise({
      ...empty(),
      sessions: [
        { id: 's1', created_at: '2026-10-12T06:00:00Z' },
        { id: 's2', created_at: '2026-10-14T06:00:00Z' },
      ],
    });
    expect(s.recordings).toBe(2);
  });
});

describe('summarise — days used (PKT calendar days with any activity)', () => {
  test('a message, a lesson plan and a recording on the same PKT day are one day', () => {
    const s = summarise({
      ...empty(),
      messages: [{ created_at: '2026-10-12T03:00:00Z' }],
      deliveries: [{ lesson_id: 'L1', created_at: '2026-10-12T09:00:00Z' }],
      sessions: [{ id: 's1', created_at: '2026-10-12T10:00:00Z' }],
    });
    expect(s.daysUsed).toBe(1);
  });

  test('20:00 UTC Monday is Tuesday in Pakistan', () => {
    const s = summarise({
      ...empty(),
      messages: [{ created_at: '2026-10-12T10:00:00Z' }, { created_at: '2026-10-12T20:00:00Z' }],
    });
    expect(s.daysUsed).toBe(2);
  });

  test('conversations.created_at is naive UTC (no zone) and is read as UTC, not host time', () => {
    const s = summarise({
      ...empty(),
      messages: [{ created_at: '2026-10-12T18:30:00' }, { created_at: '2026-10-12T19:30:00' }],
    });
    expect(s.daysUsed).toBe(2); // 23:30 Mon and 00:30 Tue PKT
  });

  test('a row with an unreadable timestamp is ignored, not counted as a day', () => {
    const s = summarise({ ...empty(), messages: [{ created_at: 'nonsense' }, { created_at: null }] });
    expect(s.daysUsed).toBe(0);
  });
});

describe('summarise — no thing to try (removed 16 Oct)', () => {
  test('checks are ignored: no move in the summary', () => {
    const s = summarise({ ...empty(), checks: [{ outcome: 'did' }] });
    expect(s).not.toHaveProperty('move');
  });
});

describe('summarise — thumbs on the reports ("Do you agree?")', () => {
  test('1 is agree, 0 is disagree, anything else was not answered', () => {
    const s = summarise({
      ...empty(),
      ratings: [
        { user_satisfaction_rating: 1 }, { user_satisfaction_rating: 1 },
        { user_satisfaction_rating: 0 }, { user_satisfaction_rating: null },
      ],
    });
    expect(s.thumbs).toEqual({ up: 2, down: 1 });
  });
});

describe('summarise — totals, and missing inputs', () => {
  test('missing arrays are treated as empty, never thrown on', () => {
    expect(summarise({})).toEqual({
      lessonPlans: 0, daysUsed: 0, recordings: 0,
      thumbs: { up: 0, down: 0 },
    });
  });
});

describe('isQuietWeek — nothing to count', () => {
  test('true only when no lesson plan, recording or day of use', () => {
    expect(isQuietWeek(summarise({}))).toBe(true);
    expect(isQuietWeek(summarise({ messages: [{ created_at: '2026-10-12T05:00:00Z' }] }))).toBe(false);
    expect(isQuietWeek(summarise({ deliveries: [{ lesson_id: 'L', created_at: '2026-10-12T05:00:00Z' }] }))).toBe(false);
  });
});
