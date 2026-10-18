/**
 * The class grade lookup in a database outage, behind the app_settings switch `class_vocabulary_outage_guard`
 * (default OFF).
 *
 *   ON  (1) 20 lookups inside 30 s while grade_levels fails (returns { error } or the query throws)
 *           → 1 grade_levels read, 1 log line, every answer null, no rejection reaches the caller
 *       (2) after 30 s → exactly 1 more read
 *       (3) a vocabulary loaded before the outage keeps answering after its 10 min while the store is down;
 *           recovery → a fresh read and the normal 10-min cache
 *       (4) the switch's own read in a full outage: last known ON holds, ≤ 1 app_settings read per 30 s
 *   OFF (5) today's behaviour: one read and one log per lookup on { error }; a throw still reaches the caller
 *   GOLDEN  a healthy store answers byte-identically with the switch OFF, ON, and as recorded before the switch
 *
 * Supabase and the logger are the boundary; the clock is Date.now.
 */

const mockDb = { gradeMode: 'ok', settingsMode: 'ok', settingsRows: [], gradeReads: 0, settingsReads: 0 };

const GRADE_ROWS = [
  { code: 'early_years', ordinal: 0, band: 'early_years', aliases: ['early_years', 'Early Years', 'ECE', 'Katchi', 'KG'] },
  { code: 'grade_1', ordinal: 1, band: 'primary', aliases: ['grade_1', 'Grade 1', 'Grade One', '1', '1st'] },
  { code: 'grade_3', ordinal: 3, band: 'primary', aliases: ['grade_3', 'Grade 3', 'Grade Three', '3', '3rd'] },
  { code: 'grade_5', ordinal: 5, band: 'primary', aliases: ['grade_5', 'Grade 5', 'Grade Five', '5', '5th'] },
  { code: 'grade_8', ordinal: 8, band: 'middle', aliases: ['grade_8', 'Grade 8', 'Grade Eight', '8', '8th'] },
  { code: 'grade_10', ordinal: 10, band: 'high', aliases: ['grade_10', 'Grade 10', 'Grade Ten', '10', '10th', 'Matric'] },
];

function outcome(mode, rows) {
  if (mode === 'throw') return Promise.reject(new Error('store down'));
  if (mode === 'error') return Promise.resolve({ data: null, error: { message: 'store down' } });
  return Promise.resolve({ data: rows, error: null });
}

const mockSupabase = {
  from: (table) => ({
    select: () => ({
      eq: () => {
        if (table !== 'grade_levels') return outcome('ok', []);
        mockDb.gradeReads += 1;
        return outcome(mockDb.gradeMode, GRADE_ROWS);
      },
      in: (col, keys) => {
        mockDb.settingsReads += 1;
        return outcome(mockDb.settingsMode, mockDb.settingsRows.filter((r) => keys.includes(r.key)));
      },
    }),
  }),
};
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const GUARD_ON = [{ key: 'class_vocabulary_outage_guard', value: true }];
const T0 = 1.8e12;
const TEN_MIN = 10 * 60 * 1000;
let now = T0;
let vocab;

const gradeLogs = () => mockLog.mock.calls.filter((c) => /grade_levels/.test(String(c[0]))).length;

/** 10 lookups at once, then 10 more spread over the next 29 s: all inside one 30 s window from `t0`. */
async function twentyLookups(t0) {
  now = t0;
  const settled = await Promise.allSettled(Array.from({ length: 10 }, () => vocab.resolveGradeLevel('grade_3')));
  for (let i = 1; i <= 10; i += 1) {
    now = t0 + i * 2900;
    settled.push(...(await Promise.allSettled([vocab.resolveGradeLevel('grade_3')])));
  }
  return settled;
}

beforeEach(() => {
  jest.resetModules();
  mockLog.mockClear();
  Object.assign(mockDb, { gradeMode: 'ok', settingsMode: 'ok', settingsRows: [], gradeReads: 0, settingsReads: 0 });
  now = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  vocab = require('../../bot/shared/services/classes/class-vocabulary.service');
});
afterEach(() => { jest.restoreAllMocks(); });

describe('switch ON: a grade_levels outage', () => {
  test.each(['error', 'throw'])('(1) 20 lookups in 30 s (read %s) → 1 read, 1 log line, all null, nothing escapes', async (kind) => {
    mockDb.settingsRows = GUARD_ON;
    mockDb.gradeMode = kind;
    const settled = await twentyLookups(T0);
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(0);
    expect(settled.map((s) => s.value)).toEqual(Array(20).fill(null));
    expect(mockDb.gradeReads).toBe(1);
    expect(gradeLogs()).toBe(1);
  });

  test.each(['error', 'throw'])('(2) after 30 s (read %s) → exactly 1 more read and 1 more log line', async (kind) => {
    mockDb.settingsRows = GUARD_ON;
    mockDb.gradeMode = kind;
    await twentyLookups(T0);
    await twentyLookups(T0 + 30 * 1000);
    expect(mockDb.gradeReads).toBe(2);
    expect(gradeLogs()).toBe(2);
  });

  test('(3) a vocabulary loaded before the outage keeps answering; recovery reads once and caches 10 min', async () => {
    mockDb.settingsRows = GUARD_ON;
    await expect(vocab.resolveGradeLevel('Grade Three')).resolves.toEqual({ code: 'grade_3', ordinal: 3, band: 'primary' });
    expect(mockDb.gradeReads).toBe(1);

    mockDb.gradeMode = 'throw';
    const settled = await twentyLookups(T0 + TEN_MIN + 1);
    expect(settled.every((s) => s.status === 'fulfilled' && s.value && s.value.code === 'grade_3')).toBe(true);
    expect(mockDb.gradeReads).toBe(2);

    mockDb.gradeMode = 'ok';
    now = T0 + TEN_MIN + 1 + 30 * 1000;
    await expect(vocab.resolveGradeLevel('5')).resolves.toEqual({ code: 'grade_5', ordinal: 5, band: 'primary' });
    now += TEN_MIN - 1;
    await expect(vocab.gradesInBand('primary')).resolves.toEqual(['grade_1', 'grade_3', 'grade_5']);
    expect(mockDb.gradeReads).toBe(3);
  });

  test('(4) full outage (settings too): the switch last read ON holds, ≤ 1 app_settings read and ≤ 1 grade read per 30 s', async () => {
    mockDb.settingsRows = GUARD_ON;
    await vocab.resolveGradeLevel('grade_3');
    vocab.clearCache();
    mockDb.gradeReads = 0;
    mockDb.settingsReads = 0;
    mockDb.gradeMode = 'throw';
    mockDb.settingsMode = 'throw';
    const settled = await twentyLookups(T0 + 31 * 1000);
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(0);
    expect(mockDb.gradeReads).toBe(1);
    expect(mockDb.settingsReads).toBe(1);
  });
});

describe('switch OFF: today\'s behaviour', () => {
  test('(5a) { error } → one read and one log line per lookup, null', async () => {
    mockDb.gradeMode = 'error';
    const settled = await twentyLookups(T0);
    expect(settled.map((s) => s.value)).toEqual(Array(20).fill(null));
    expect(mockDb.gradeReads).toBe(20);
    expect(gradeLogs()).toBe(20);
  });

  test('(5b) a throw still reaches the caller', async () => {
    mockDb.settingsRows = [{ key: 'class_vocabulary_outage_guard', value: false }];
    mockDb.gradeMode = 'throw';
    await expect(vocab.resolveGradeLevel('grade_3')).rejects.toThrow('store down');
  });

  test('(5c) a process that never read the switch, started in a full outage → OFF (today\'s answer)', async () => {
    mockDb.gradeMode = 'error';
    mockDb.settingsMode = 'error';
    await expect(vocab.resolveGradeLevel('grade_3')).resolves.toBeNull();
    await expect(vocab.resolveGradeLevel('grade_3')).resolves.toBeNull();
    expect(mockDb.gradeReads).toBe(2);
  });
});

describe('golden: a healthy store answers byte-identically', () => {
  const INPUTS = ['grade_3', 'Grade Five', '10', '  gRaDe fIvE  ', 'Katchi', 'PRIMARY', 'Full Attendance Class', '', null, 7];
  // Recorded on the base (before the switch existed).
  const GOLDEN = '[{"code":"grade_3","ordinal":3,"band":"primary"},{"code":"grade_5","ordinal":5,"band":"primary"},'
    + '{"code":"grade_10","ordinal":10,"band":"high"},{"code":"grade_5","ordinal":5,"band":"primary"},'
    + '{"code":"early_years","ordinal":0,"band":"early_years"},null,null,null,null,null,'
    + '["grade_1","grade_3","grade_5"],["grade_8"],[]]';

  async function answers() {
    const out = [];
    for (const raw of INPUTS) out.push(await vocab.resolveGradeLevel(raw));
    for (const band of ['primary', 'middle', 'nope']) out.push(await vocab.gradesInBand(band));
    return JSON.stringify(out);
  }

  test.each([
    ['no switch row', []],
    ['switch OFF', [{ key: 'class_vocabulary_outage_guard', value: false }]],
    ['switch ON', GUARD_ON],
  ])('%s → the recorded answers, one grade read', async (_label, rows) => {
    mockDb.settingsRows = rows;
    expect(await answers()).toBe(GOLDEN);
    expect(mockDb.gradeReads).toBe(1);
  });
});
