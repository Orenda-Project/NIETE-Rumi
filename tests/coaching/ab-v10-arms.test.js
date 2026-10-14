/**
 * v10 coaching test (bd-v0toag.21): which of the four groups a teacher's school is in.
 * A = v9 + today's report, B = v10 card + today's report, C = v9 + new report, D = card + new report.
 * The group is read from niete_coaching_ab_assignment, written once at the draw. Anything that cannot
 * be resolved (switch off, no school, school not drawn, a read error) is null: today's coaching.
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockSwitch = { v10Enabled: jest.fn(async () => true) };
jest.mock('../../bot/shared/services/coaching/ab-v10-switch', () => mockSwitch);

const arms = require('../../bot/shared/services/coaching/ab-v10-arms');

// tables: { users: [...], niete_coaching_ab_assignment: [...] }, errors: { table: message }
function db(tables, errors = {}) {
  const reads = [];
  mockSupabase.from.mockImplementation((table) => {
    const filters = [];
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn((col, v) => { filters.push((r) => r[col] === v); return chain; }),
      in: jest.fn((col, vs) => { filters.push((r) => vs.includes(r[col])); return chain; }),
      maybeSingle: jest.fn(async () => {
        if (errors[table]) return { data: null, error: { message: errors[table] } };
        return { data: (tables[table] || []).find((r) => filters.every((f) => f(r))) || null, error: null };
      }),
      then: (res, rej) => Promise.resolve(errors[table]
        ? { data: null, error: { message: errors[table] } }
        : { data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej),
    };
    reads.push(table);
    return chain;
  });
  return reads;
}

const U1 = 'u-1'; const U2 = 'u-2'; const U3 = 'u-3';
const S1 = 's-1'; const S2 = 's-2';
const TABLES = {
  users: [{ id: U1, school_id: S1 }, { id: U2, school_id: S2 }, { id: U3, school_id: null }],
  niete_coaching_ab_assignment: [{ school_id: S1, ab_group: 'C' }, { school_id: S2, ab_group: 'B' }],
};

beforeEach(() => { jest.clearAllMocks(); mockSwitch.v10Enabled.mockResolvedValue(true); });

describe('armsOf', () => {
  test.each([
    ['A', { plan: 'v9', report: 'today' }],
    ['B', { plan: 'v10', report: 'today' }],
    ['C', { plan: 'v9', report: 'new' }],
    ['D', { plan: 'v10', report: 'new' }],
  ])('%s → %p', (g, expected) => expect(arms.armsOf(g)).toEqual(expected));

  test.each([['E'], ['a'], [''], [null], [undefined]])('%p → null', (g) => expect(arms.armsOf(g)).toBeNull());
});

describe('groupFor', () => {
  test('a drawn school: its group and both arms', async () => {
    db(TABLES);
    expect(await arms.groupFor(U1)).toEqual({ group: 'C', plan: 'v9', report: 'new' });
  });

  test('switch off: null, and nothing else is read', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(false);
    const reads = db(TABLES);
    expect(await arms.groupFor(U1)).toBeNull();
    expect(reads).toHaveLength(0);
  });

  test('reads its own table, never the ch3-8 LP test table', async () => {
    const reads = db(TABLES);
    await arms.groupFor(U1);
    expect(reads).toContain('niete_coaching_ab_assignment');
    expect(reads).not.toContain('niete_lp_ab_assignment');
  });

  test.each([
    ['no user id', null],
    ['unknown user', 'u-nope'],
    ['user with no school', U3],
  ])('%s → null', async (_, id) => {
    db(TABLES);
    expect(await arms.groupFor(id)).toBeNull();
  });

  test('school not in the draw → null', async () => {
    db({ ...TABLES, niete_coaching_ab_assignment: [] });
    expect(await arms.groupFor(U1)).toBeNull();
  });

  test('a junk group letter → null', async () => {
    db({ ...TABLES, niete_coaching_ab_assignment: [{ school_id: S1, ab_group: 'Z' }] });
    expect(await arms.groupFor(U1)).toBeNull();
  });

  test.each([['users'], ['niete_coaching_ab_assignment']])('a %s read error → null, never throws', async (t) => {
    db(TABLES, { [t]: 'boom' });
    await expect(arms.groupFor(U1)).resolves.toBeNull();
  });

  test('a thrown read → null', async () => {
    mockSupabase.from.mockImplementation(() => { throw new Error('network'); });
    await expect(arms.groupFor(U1)).resolves.toBeNull();
  });
});

describe('groupsForUsers', () => {
  test('many teachers at once; undrawn or schoolless are null', async () => {
    db(TABLES);
    const out = await arms.groupsForUsers([U1, U2, U3, 'u-nope', U1, null]);
    expect(out.get(U1)).toEqual({ group: 'C', plan: 'v9', report: 'new' });
    expect(out.get(U2)).toEqual({ group: 'B', plan: 'v10', report: 'today' });
    expect(out.get(U3)).toBeNull();
    expect(out.get('u-nope')).toBeNull();
    expect(out.size).toBe(4);
  });

  test('switch off: everyone null, nothing read', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(false);
    const reads = db(TABLES);
    const out = await arms.groupsForUsers([U1, U2]);
    expect([...out.values()]).toEqual([null, null]);
    expect(reads).toHaveLength(0);
  });

  test('a read error: everyone null, never throws', async () => {
    db(TABLES, { niete_coaching_ab_assignment: 'boom' });
    const out = await arms.groupsForUsers([U1, U2]);
    expect([...out.values()]).toEqual([null, null]);
  });

  test('empty input → empty map', async () => {
    expect((await arms.groupsForUsers([])).size).toBe(0);
  });
});
