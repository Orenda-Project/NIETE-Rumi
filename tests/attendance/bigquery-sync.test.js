/**
 * Unit tests for bot/shared/services/attendance/bigquery-sync.service.js.
 *
 * Scope:
 *   * Config validation — required env vars fail loud, optional ones have
 *     sensible defaults.
 *   * Row shaping — toBigQueryRow() mirrors the DDL exactly, skips rows
 *     without identity, coerces types.
 *   * Upsert semantics — enforces one period_end per batch; DELETE-then-INSERT
 *     ordering; no-op on empty rows.
 *
 * The real @google-cloud/bigquery is NOT required; we pass a mock client into
 * the pure functions.
 */

const {
  getBigQueryConfig,
  qualifiedTable,
  toBigQueryRow,
  upsertRows,
} = require('../../bot/shared/services/attendance/bigquery-sync.service');

describe('getBigQueryConfig', () => {
  const OLD = { ...process.env };
  beforeEach(() => { process.env = { ...OLD }; });
  afterAll(() => { process.env = OLD; });

  test('throws when GOOGLE_SERVICE_ACCOUNT_PATH is missing', () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    process.env.BIGQUERY_STEPS_PROJECT_ID = 'p';
    expect(() => getBigQueryConfig()).toThrow(/GOOGLE_SERVICE_ACCOUNT_PATH/);
  });

  test('throws when BIGQUERY_STEPS_PROJECT_ID is missing', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_PATH = '/tmp/sa.json';
    delete process.env.BIGQUERY_STEPS_PROJECT_ID;
    expect(() => getBigQueryConfig()).toThrow(/BIGQUERY_STEPS_PROJECT_ID/);
  });

  test('defaults dataset=steps and table=attendance', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_PATH = '/tmp/sa.json';
    process.env.BIGQUERY_STEPS_PROJECT_ID = 'my-proj';
    delete process.env.BIGQUERY_STEPS_DATASET;
    delete process.env.BIGQUERY_STEPS_TABLE;
    const cfg = getBigQueryConfig();
    expect(cfg).toEqual({
      projectId: 'my-proj',
      dataset: 'steps',
      table: 'attendance',
      keyFilename: '/tmp/sa.json',
    });
    expect(qualifiedTable(cfg)).toBe('my-proj.steps.attendance');
  });

  test('respects overrides', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_PATH = '/tmp/sa.json';
    process.env.BIGQUERY_STEPS_PROJECT_ID = 'p';
    process.env.BIGQUERY_STEPS_DATASET = 'ds';
    process.env.BIGQUERY_STEPS_TABLE = 't';
    expect(qualifiedTable(getBigQueryConfig())).toBe('p.ds.t');
  });
});

describe('toBigQueryRow', () => {
  const syncedAt = '2026-07-17T22:00:00.000Z';

  test('shapes a fully populated presence row correctly', () => {
    const presence = {
      teacher_id: 'tid-1',
      mobile: '923330000001',
      school_id: 'sid-1',
      sector: 'Sector-A',
      period_start: '2026-07-16',
      period_end: '2026-07-16',
      present_days: 1,
      absent_days: 0,
      leave_days: 0,
      working_days: 1,
      presence_pct: 100,
    };
    expect(toBigQueryRow(presence, syncedAt)).toEqual({
      teacher_phone_e164: '923330000001',
      teacher_id: 'tid-1',
      school_id: 'sid-1',
      sector: 'Sector-A',
      period_start: '2026-07-16',
      period_end: '2026-07-16',
      present_days: 1,
      absent_days: 0,
      leave_days: 0,
      working_days: 1,
      presence_pct: 100,
      synced_at: syncedAt,
    });
  });

  test('returns null when teacher_id is missing', () => {
    expect(toBigQueryRow({ mobile: '92', period_start: 'd', period_end: 'd' }, syncedAt)).toBeNull();
  });

  test('returns null when mobile is missing', () => {
    expect(toBigQueryRow({ teacher_id: 'x', period_start: 'd', period_end: 'd' }, syncedAt)).toBeNull();
  });

  test('coerces numeric fields, keeps school_id/sector as null when absent', () => {
    const row = toBigQueryRow({
      teacher_id: 'tid',
      mobile: '92',
      school_id: null,
      sector: null,
      period_start: '2026-07-16',
      period_end: '2026-07-16',
      present_days: '3',      // string → coerced
      absent_days: undefined, // → 0
      leave_days: null,       // → 0
      working_days: '3',      // string → coerced
      presence_pct: 100.0,
    }, syncedAt);
    expect(row.present_days).toBe(3);
    expect(row.absent_days).toBe(0);
    expect(row.leave_days).toBe(0);
    expect(row.working_days).toBe(3);
    expect(row.school_id).toBeNull();
    expect(row.sector).toBeNull();
  });
});

describe('upsertRows', () => {
  function mockClient({ deleteAffected = 0 } = {}) {
    const queries = [];
    const inserts = [];
    return {
      queries, inserts,
      client: {
        query: jest.fn(async (opts) => {
          queries.push(opts);
          return [{ numDmlAffectedRows: deleteAffected }];
        }),
        dataset: jest.fn((_ds) => ({
          table: jest.fn((_t) => ({
            insert: jest.fn(async (rows, insertOpts) => {
              inserts.push({ rows, insertOpts });
            }),
          })),
        })),
      },
    };
  }

  const cfg = { projectId: 'p', dataset: 'ds', table: 't', keyFilename: '/tmp/sa.json' };

  test('no-op on empty input', async () => {
    const { client } = mockClient();
    await expect(upsertRows(client, [], cfg)).resolves.toEqual({ deleted: 0, inserted: 0 });
    expect(client.query).not.toHaveBeenCalled();
    expect(client.dataset).not.toHaveBeenCalled();
  });

  test('throws when rows span multiple period_end values', async () => {
    const { client } = mockClient();
    const rows = [
      { period_end: '2026-07-16', teacher_id: 'a' },
      { period_end: '2026-07-17', teacher_id: 'b' },
    ];
    await expect(upsertRows(client, rows, cfg)).rejects.toThrow(/one period_end/);
  });

  test('DELETEs matching period_end, then INSERTs the batch', async () => {
    const mc = mockClient({ deleteAffected: 5 });
    const rows = [
      { teacher_phone_e164: '92X', teacher_id: 't1', period_end: '2026-07-16', presence_pct: 100 },
      { teacher_phone_e164: '92Y', teacher_id: 't2', period_end: '2026-07-16', presence_pct: 0 },
    ];
    const res = await upsertRows(mc.client, rows, cfg);
    expect(res).toEqual({ deleted: 5, inserted: 2 });

    // one DELETE query with parameter binding
    expect(mc.queries).toHaveLength(1);
    expect(mc.queries[0].query).toMatch(/DELETE FROM `p\.ds\.t` WHERE period_end = @period_end/);
    expect(mc.queries[0].params).toEqual({ period_end: '2026-07-16' });

    // one INSERT of both rows
    expect(mc.inserts).toHaveLength(1);
    expect(mc.inserts[0].rows).toEqual(rows);
    expect(mc.inserts[0].insertOpts).toEqual({ skipInvalidRows: false, ignoreUnknownValues: false });
  });
});
