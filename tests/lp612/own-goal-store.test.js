/**
 * bd-snkn32.56 — the goal start's two reads: the list-only switch, and one grade+subject's current lessons.
 */
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

describe('goalStartOn (list-only)', () => {
  it.each([
    ['a list naming her', ['u1', 'u9'], true],
    ['the list as a JSON string', '["u1"]', true],
    ['a list without her', ['u9'], false],
    ['true (everyone) is NOT on while it is a test', true, false],
    ['"teachers" is NOT on either', 'teachers', false],
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
  it('nothing for grades 1-5, a bad subject or a failed read', async () => {
    expect(await goalRows(fake({ data: rows }).client, { grade: 3, subject: 'English' })).toEqual([]);
    expect(await goalRows(fake({ data: rows }).client, { grade: 7, subject: '' })).toEqual([]);
    expect(await goalRows(fake({ data: null, error: { message: 'x' } }).client, { grade: 7, subject: 'English' })).toEqual([]);
  });
});
