/**
 * Unit tests for bot/workers/attendance-bigquery-export.worker.js — the pure
 * helpers only (parseArgs, yesterdayInKarachi, aggregatePresence). main() is
 * left for a follow-up integration test with a fuller mock.
 *
 * The worker requires ../shared/config/supabase (which needs
 * @supabase/supabase-js) at import time — that dep lives in bot/node_modules
 * and isn't present in the root test job. We virtual-mock the supabase config
 * module here so the pure helpers can be tested in isolation. Same trick the
 * existing OSS suite uses for axios / pino / canvas (see tests/__mocks__/).
 */

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock(
  '../../bot/shared/config/supabase',
  () => ({ from: jest.fn(), rpc: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '../../bot/shared/utils/logger',
  () => ({ logToFile: () => {} }),
  { virtual: true }
);

const {
  parseArgs,
  yesterdayInKarachi,
  aggregatePresence,
} = require('../../bot/workers/attendance-bigquery-export.worker');

describe('parseArgs', () => {
  test('empty argv returns defaults', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, date: null });
  });
  test('--dry-run + short alias', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['-n']).dryRun).toBe(true);
  });
  test('--date=YYYY-MM-DD', () => {
    expect(parseArgs(['--date=2026-07-16'])).toEqual({ dryRun: false, date: '2026-07-16' });
  });
  test('multiple flags combine', () => {
    expect(parseArgs(['--dry-run', '--date=2026-01-02'])).toEqual({
      dryRun: true, date: '2026-01-02',
    });
  });
});

describe('yesterdayInKarachi', () => {
  test('returns yesterday PKT for a known UTC instant', () => {
    // 2026-07-17 22:00 UTC = 2026-07-18 03:00 PKT → yesterday PKT = 2026-07-17
    const now = new Date('2026-07-17T22:00:00Z');
    expect(yesterdayInKarachi(now)).toBe('2026-07-17');
  });
  test('handles cross-year boundary', () => {
    // 2027-01-01 22:00 UTC = 2027-01-02 03:00 PKT → yesterday PKT = 2027-01-01
    const now = new Date('2027-01-01T22:00:00Z');
    expect(yesterdayInKarachi(now)).toBe('2027-01-01');
  });
});

describe('aggregatePresence', () => {
  const targetDate = '2026-07-16';

  test('empty input → empty output', () => {
    expect(aggregatePresence([], targetDate)).toEqual([]);
  });

  test('rolls one teacher (present) into a single Presence row', () => {
    const raw = [{
      id: 'r1', teacher_id: 'tid-1', school_id: 'sid-1',
      date: targetDate, status: 'present', leave_type: null,
      teacher: { id: 'tid-1', phone_number: '923330000001', school_id: 'sid-1' },
      school:  { id: 'sid-1', region: 'Sector-A' },
    }];
    const out = aggregatePresence(raw, targetDate);
    expect(out).toEqual([{
      teacher_id: 'tid-1',
      mobile: '923330000001',
      school_id: 'sid-1',
      sector: 'Sector-A',
      period_start: targetDate,
      period_end: targetDate,
      present_days: 1,
      absent_days: 0,
      leave_days: 0,
      working_days: 1,
      presence_pct: 100,
    }]);
  });

  test('groups multiple teachers separately', () => {
    const raw = [
      {
        teacher_id: 'tid-1', school_id: 'sid-1', date: targetDate, status: 'present',
        teacher: { id: 'tid-1', phone_number: '92A', school_id: 'sid-1' },
        school: { id: 'sid-1', region: 'A' },
      },
      {
        teacher_id: 'tid-2', school_id: 'sid-2', date: targetDate, status: 'absent',
        teacher: { id: 'tid-2', phone_number: '92B', school_id: 'sid-2' },
        school: { id: 'sid-2', region: 'B' },
      },
      {
        teacher_id: 'tid-3', school_id: 'sid-2', date: targetDate, status: 'leave', leave_type: 'sick',
        teacher: { id: 'tid-3', phone_number: '92C', school_id: 'sid-2' },
        school: { id: 'sid-2', region: 'B' },
      },
    ];
    const out = aggregatePresence(raw, targetDate);
    expect(out).toHaveLength(3);
    const byId = Object.fromEntries(out.map((r) => [r.teacher_id, r]));
    expect(byId['tid-1'].presence_pct).toBe(100);
    expect(byId['tid-1'].present_days).toBe(1);
    expect(byId['tid-2'].presence_pct).toBe(0);
    expect(byId['tid-2'].absent_days).toBe(1);
    expect(byId['tid-3'].presence_pct).toBe(0);
    expect(byId['tid-3'].leave_days).toBe(1);
    expect(byId['tid-3'].working_days).toBe(1);
    expect(byId['tid-3'].sector).toBe('B');
  });

  test('falls back to teacher.school_id when school embed is missing', () => {
    const raw = [{
      teacher_id: 'tid-1', school_id: 'sid-99', date: targetDate, status: 'present',
      teacher: { id: 'tid-1', phone_number: '92A', school_id: 'sid-99' },
      school: null, // schools embed missing
    }];
    const out = aggregatePresence(raw, targetDate);
    expect(out[0].school_id).toBe('sid-99');
    expect(out[0].sector).toBeNull();
  });

  test('skips rows with no teacher_id (defensive)', () => {
    const raw = [
      { teacher_id: null, date: targetDate, status: 'present' },
      { teacher_id: 'tid-1', date: targetDate, status: 'present',
        teacher: { id: 'tid-1', phone_number: '92A', school_id: null }, school: null },
    ];
    const out = aggregatePresence(raw, targetDate);
    expect(out).toHaveLength(1);
    expect(out[0].teacher_id).toBe('tid-1');
  });
});
