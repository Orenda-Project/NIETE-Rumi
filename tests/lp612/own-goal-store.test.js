/**
 * bd-snkn32.56 — the goal start's two reads: the list-only switch, and one grade+subject's current lessons.
 */
jest.mock('../../bot/shared/services/lp-own-gb', () => ({ isGbTeacher: jest.fn(async () => false) }));
const { isGbTeacher } = require('../../bot/shared/services/lp-own-gb');
const { goalStartOn, goalRows, GOAL_START_KEY } = require('../../bot/shared/services/lp612-own-goal.store');

/** A tiny PostgREST stand-in: records every filter, answers `result`. */
function fake(result) {
  const seen = { from: null, eq: [] };
  const q = {
    select: () => q,
    eq: (k, v) => { seen.eq.push([k, v]); return q; },
    limit: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
  };
  return { seen, client: { from: (t) => { seen.from = t; return q; } } };
}

describe('goalStartOn (a list)', () => {
  it.each([
    ['a list naming her', ['u1', 'u9'], true],
    ['the list as a JSON string', '["u1"]', true],
    ['a list without her', ['u9'], false],
    ['true (everyone) is NOT on while it is a test', true, false],
    ['absent', undefined, false],
  ])('%s', async (_, value, want) => {
    const { client, seen } = fake({ data: value === undefined ? null : { value }, error: null });
    expect(await goalStartOn(client, 'u1')).toBe(want);
    expect(seen.from).toBe('app_settings');
    expect(seen.eq).toContainEqual(['key', GOAL_START_KEY]);
  });
  it('a failed read or no user is off', async () => {
    expect(await goalStartOn(fake({ data: null, error: { message: 'x' } }).client, 'u1')).toBe(false);
    expect(await goalStartOn({ from: () => { throw new Error('down'); } }, 'u1')).toBe(false);
    expect(await goalStartOn(fake({ data: { value: ['u1'] } }).client, '')).toBe(false);
  });
});

// bd-sm4xdn (Amena, 23 Nov, queue #223): "teachers" = every users.role teacher, as portal_lp_own_unit reads it,
// EXCEPT a GB teacher (her rule: GB stays off). The GB check is here so the app, the form route and the bot agree.
describe('goalStartOn — "teachers"', () => {
  function byTable(setting, user) {
    const calls = [];
    const chainFor = (result) => {
      const chain = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') return (res) => res(result);
          return (...args) => { calls.push([prop, ...args]); return chain; };
        },
      });
      return chain;
    };
    return { calls, client: { from: (t) => { calls.push(['from', t]); return chainFor(t === 'users' ? user : setting); } } };
  }
  beforeEach(() => { isGbTeacher.mockReset(); isGbTeacher.mockResolvedValue(false); });
  it.each([
    ['teachers', 'teacher', true],
    ['"teachers"', 'teacher', true],
    [' Teachers ', ' Teacher ', true],
    ['teachers', 'coach', false],
    ['teachers', 'principal', false],
    ['teachers', 'unregistered', false],
  ])('value %j, role %j → %s', async (value, role, on) => {
    const f = byTable({ data: { value }, error: null }, { data: { role }, error: null });
    expect(await goalStartOn(f.client, 'u1')).toBe(on);
    expect(f.calls).toEqual(expect.arrayContaining([['from', 'users'], ['eq', 'id', 'u1']]));
  });
  it('a GB teacher stays off under "teachers"', async () => {
    isGbTeacher.mockResolvedValue(true);
    const f = byTable({ data: { value: 'teachers' }, error: null }, { data: { role: 'teacher' }, error: null });
    expect(await goalStartOn(f.client, 'u1')).toBe(false);
    expect(isGbTeacher).toHaveBeenCalledWith(f.client, 'u1');
  });
  it('a failed GB read is off', async () => {
    isGbTeacher.mockRejectedValue(new Error('down'));
    const f = byTable({ data: { value: 'teachers' }, error: null }, { data: { role: 'teacher' }, error: null });
    expect(await goalStartOn(f.client, 'u1')).toBe(false);
  });
  it('"teachers" with no users row, or a failed users read, is off', async () => {
    expect(await goalStartOn(byTable({ data: { value: 'teachers' }, error: null }, { data: null, error: null }).client, 'u1')).toBe(false);
    expect(await goalStartOn(byTable({ data: { value: 'teachers' }, error: null }, { data: null, error: { message: 'x' } }).client, 'u1')).toBe(false);
  });
  it('a named list is not GB-checked (the pilot list is hand-picked)', async () => {
    const f = byTable({ data: { value: ['u1'] }, error: null }, { data: { role: 'teacher' }, error: null });
    expect(await goalStartOn(f.client, 'u1')).toBe(true);
    expect(isGbTeacher).not.toHaveBeenCalled();
  });
});

describe('goalRows', () => {
  const rows = [
    { segment_id: 'a', curriculum: 'ict' }, { segment_id: 'b', curriculum: 'nbf_snc' }, { segment_id: 'c', curriculum: 'ict' },
  ];
  it('reads current lessons of her grade and subject, ICT first', async () => {
    const { client, seen } = fake({ data: rows, error: null });
    expect((await goalRows(client, { grade: 7, subject: 'English' })).map((r) => r.segment_id)).toEqual(['a', 'c']);
    expect(seen.from).toBe('niete_lp612_segments');
    expect(seen.eq).toEqual(expect.arrayContaining([['is_current', true], ['grade', 7], ['subject', 'English']]));
  });
  it('another curriculum when ICT has none', async () => {
    const { client } = fake({ data: [rows[1]], error: null });
    expect((await goalRows(client, { grade: 7, subject: 'English' })).map((r) => r.segment_id)).toEqual(['b']);
  });
  it('nothing off grades 1-12, for a bad subject or a failed read (grades 1-5: own-goal-k5.test.js)', async () => {
    expect(await goalRows(fake({ data: rows }).client, { grade: 13, subject: 'English' })).toEqual([]);
    expect(await goalRows(fake({ data: rows }).client, { grade: 7, subject: '' })).toEqual([]);
    expect(await goalRows(fake({ data: null, error: { message: 'x' } }).client, { grade: 7, subject: 'English' })).toEqual([]);
  });
});
