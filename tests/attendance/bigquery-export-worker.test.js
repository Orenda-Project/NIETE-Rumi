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
  normalizeSector,
  APPROVED_SECTORS,
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

describe('normalizeSector (TEMP: B.K → Barakahu)', () => {
  test('returns null for null / undefined / empty', () => {
    expect(normalizeSector(null)).toBeNull();
    expect(normalizeSector(undefined)).toBeNull();
    expect(normalizeSector('')).toBeNull();
    expect(normalizeSector('   ')).toBeNull();
  });

  test('rewrites B.K → Barakahu', () => {
    expect(normalizeSector('B.K')).toBe('Barakahu');
  });

  test('passes through approved sector names unchanged', () => {
    for (const s of ['Urban-I', 'Urban-II', 'Sihala', 'Nilore', 'Tarnol', 'Barakahu']) {
      expect(normalizeSector(s)).toBe(s);
    }
  });

  test('preserves unrecognized values (aggregatePresence filters later)', () => {
    // We normalize whitespace but don't guess unknown values into approved ones.
    expect(normalizeSector('Sector-Z')).toBe('Sector-Z');
    expect(normalizeSector('  Nilore  ')).toBe('Nilore');
  });
});

describe('APPROVED_SECTORS', () => {
  test('contains exactly the 6 sectors Hasnat approved on TASK-133', () => {
    expect(Array.from(APPROVED_SECTORS).sort()).toEqual(
      ['Barakahu', 'Nilore', 'Sihala', 'Tarnol', 'Urban-I', 'Urban-II'].sort()
    );
  });
});

describe('aggregatePresence', () => {
  const targetDate = '2026-07-16';

  test('empty input → empty rows, zero dropped', () => {
    expect(aggregatePresence([], targetDate)).toEqual({
      rows: [],
      droppedCount: 0,
      droppedTeacherIds: [],
    });
  });

  test('rolls one teacher (present) into a single Presence row — sector from users.region', () => {
    const raw = [{
      id: 'r1', teacher_id: 'tid-1', school_id: 'sid-1',
      date: targetDate, status: 'present', leave_type: null,
      teacher: { id: 'tid-1', phone_number: '923330000001', school_id: 'sid-1', region: 'Nilore' },
    }];
    const out = aggregatePresence(raw, targetDate);
    expect(out.droppedCount).toBe(0);
    expect(out.rows).toEqual([{
      teacher_id: 'tid-1',
      mobile: '923330000001',
      school_id: 'sid-1',
      sector: 'Nilore',
      period_start: targetDate,
      period_end: targetDate,
      present_days: 1,
      absent_days: 0,
      leave_days: 0,
      working_days: 1,
      presence_pct: 100,
    }]);
  });

  test('groups multiple teachers separately, exercising all 3 statuses', () => {
    const raw = [
      {
        teacher_id: 'tid-1', school_id: 'sid-1', date: targetDate, status: 'present',
        teacher: { id: 'tid-1', phone_number: '92A', school_id: 'sid-1', region: 'Urban-I' },
      },
      {
        teacher_id: 'tid-2', school_id: 'sid-2', date: targetDate, status: 'absent',
        teacher: { id: 'tid-2', phone_number: '92B', school_id: 'sid-2', region: 'Urban-II' },
      },
      {
        teacher_id: 'tid-3', school_id: 'sid-2', date: targetDate, status: 'leave', leave_type: 'sick',
        teacher: { id: 'tid-3', phone_number: '92C', school_id: 'sid-2', region: 'Sihala' },
      },
    ];
    const out = aggregatePresence(raw, targetDate);
    expect(out.droppedCount).toBe(0);
    expect(out.rows).toHaveLength(3);
    const byId = Object.fromEntries(out.rows.map((r) => [r.teacher_id, r]));
    expect(byId['tid-1'].presence_pct).toBe(100);
    expect(byId['tid-1'].present_days).toBe(1);
    expect(byId['tid-1'].sector).toBe('Urban-I');
    expect(byId['tid-2'].presence_pct).toBe(0);
    expect(byId['tid-2'].absent_days).toBe(1);
    expect(byId['tid-2'].sector).toBe('Urban-II');
    expect(byId['tid-3'].presence_pct).toBe(0);
    expect(byId['tid-3'].leave_days).toBe(1);
    expect(byId['tid-3'].working_days).toBe(1);
    expect(byId['tid-3'].sector).toBe('Sihala');
  });

  test('B.K sector is normalized to Barakahu and NOT dropped', () => {
    const raw = [{
      teacher_id: 'tid-bk', school_id: null, date: targetDate, status: 'present',
      teacher: { id: 'tid-bk', phone_number: '92BK', school_id: null, region: 'B.K' },
    }];
    const out = aggregatePresence(raw, targetDate);
    expect(out.droppedCount).toBe(0);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].sector).toBe('Barakahu');
  });

  test('drops teacher with NULL region and reports count', () => {
    const raw = [
      { teacher_id: 'tid-good', date: targetDate, status: 'present',
        teacher: { id: 'tid-good', phone_number: '92G', school_id: null, region: 'Tarnol' } },
      { teacher_id: 'tid-null', date: targetDate, status: 'present',
        teacher: { id: 'tid-null', phone_number: '92N', school_id: null, region: null } },
    ];
    const out = aggregatePresence(raw, targetDate);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].teacher_id).toBe('tid-good');
    expect(out.droppedCount).toBe(1);
    expect(out.droppedTeacherIds).toEqual(['tid-null']);
  });

  test('drops teacher with unrecognized (non-approved) sector', () => {
    const raw = [
      { teacher_id: 'tid-junk', date: targetDate, status: 'present',
        teacher: { id: 'tid-junk', phone_number: '92J', school_id: null, region: 'Sector-Junk' } },
    ];
    const out = aggregatePresence(raw, targetDate);
    expect(out.rows).toHaveLength(0);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedTeacherIds).toEqual(['tid-junk']);
  });

  test('school_id passes through from users.school_id (users.region owns sector)', () => {
    const raw = [{
      teacher_id: 'tid-1', school_id: 'sid-99', date: targetDate, status: 'present',
      teacher: { id: 'tid-1', phone_number: '92A', school_id: 'sid-99', region: 'Nilore' },
    }];
    const out = aggregatePresence(raw, targetDate);
    expect(out.rows[0].school_id).toBe('sid-99');
    expect(out.rows[0].sector).toBe('Nilore');
  });

  test('skips rows with no teacher_id (defensive)', () => {
    const raw = [
      { teacher_id: null, date: targetDate, status: 'present' },
      { teacher_id: 'tid-1', date: targetDate, status: 'present',
        teacher: { id: 'tid-1', phone_number: '92A', school_id: null, region: 'Barakahu' } },
    ];
    const out = aggregatePresence(raw, targetDate);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].teacher_id).toBe('tid-1');
    expect(out.droppedCount).toBe(0);
  });

  test('caps droppedTeacherIds sample at 20 entries', () => {
    const raw = [];
    for (let i = 0; i < 25; i++) {
      raw.push({
        teacher_id: `tid-drop-${i}`, date: targetDate, status: 'present',
        teacher: { id: `tid-drop-${i}`, phone_number: `92X${i}`, school_id: null, region: null },
      });
    }
    const out = aggregatePresence(raw, targetDate);
    expect(out.rows).toHaveLength(0);
    expect(out.droppedCount).toBe(25);
    expect(out.droppedTeacherIds).toHaveLength(20);
  });
});
