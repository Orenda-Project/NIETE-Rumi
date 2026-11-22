/**
 * bd-snkn32.59 (queue #165) — the unit store: the list-only switch, and every read/write scoped to her user_id.
 */
const { unitOn, createUnitStore } = require('../../bot/shared/services/lp-own-unit.store');

/** A recording fake of the supabase query chain: every call is logged; the awaited result is `result`. */
function fake(result) {
  const calls = [];
  const chain = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res) => res(result);
      return (...args) => { calls.push([prop, ...args]); return chain; };
    },
  });
  return { calls, client: { from: (t) => { calls.push(['from', t]); return chain; } } };
}

describe('unitOn — list, fail closed', () => {
  it.each([
    [JSON.stringify(['u1']), 'u1', true],
    [['u1'], 'u1', true],
    [['u2'], 'u1', false],
    ['true', 'u1', false],
    [null, 'u1', false],
  ])('value %j for %s → %s', async (value, user, on) => {
    const f = fake({ data: value === null ? null : { value }, error: null });
    expect(await unitOn(f.client, user)).toBe(on);
  });
  it('a failed read is off', async () => {
    expect(await unitOn({ from: () => { throw new Error('down'); } }, 'u1')).toBe(false);
    expect(await unitOn(fake({ data: null, error: { message: 'x' } }).client, 'u1')).toBe(false);
  });
});

// bd-snkn32.59.8 (Amena, 22 Nov): "teachers" = every users.role teacher, as portal_lp_make_own reads it. GB stays out
// at the route (isGbTeacher), not here.
describe('unitOn — "teachers"', () => {
  /** A fake whose answer depends on the table: app_settings → the switch, users → her row. */
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
    return {
      calls,
      client: { from: (t) => { calls.push(['from', t]); return chainFor(t === 'users' ? user : setting); } },
    };
  }
  it.each([
    ['teachers', 'teacher', true],
    ['"teachers"', 'teacher', true],
    [' Teachers ', ' Teacher ', true],
    ['teachers', 'coach', false],
    ['teachers', 'principal', false],
    ['teachers', 'unregistered', false],
  ])('value %j, role %j → %s', async (value, role, on) => {
    const f = byTable({ data: { value }, error: null }, { data: { role }, error: null });
    expect(await unitOn(f.client, 'u1')).toBe(on);
    expect(f.calls).toEqual(expect.arrayContaining([['from', 'users'], ['eq', 'id', 'u1']]));
  });
  it('"teachers" with no users row, or a failed users read, is off', async () => {
    expect(await unitOn(byTable({ data: { value: 'teachers' }, error: null }, { data: null, error: null }).client, 'u1')).toBe(false);
    expect(await unitOn(byTable({ data: { value: 'teachers' }, error: null }, { data: null, error: { message: 'x' } }).client, 'u1')).toBe(false);
  });
  it('a list that names her never reads users', async () => {
    const f = byTable({ data: { value: ['u1'] }, error: null }, { data: { role: 'coach' }, error: null });
    expect(await unitOn(f.client, 'u1')).toBe(true);
    expect(f.calls).not.toContainEqual(['from', 'users']);
  });
});

describe('createUnitStore', () => {
  it('get is scoped to her user id and skips deleted units', async () => {
    const f = fake({ data: { id: 'a' }, error: null });
    expect(await createUnitStore(f.client).get('u1', 'a')).toEqual({ id: 'a' });
    expect(f.calls).toEqual(expect.arrayContaining([['from', 'niete_lp_own_units'], ['eq', 'user_id', 'u1'], ['eq', 'id', 'a'], ['is', 'deleted_at', null]]));
  });
  it('update is scoped to her user id', async () => {
    const f = fake({ data: { id: 'a' }, error: null });
    await createUnitStore(f.client).update('u1', 'a', { pace: 'slower' });
    expect(f.calls).toEqual(expect.arrayContaining([['eq', 'user_id', 'u1'], ['eq', 'id', 'a']]));
  });
  it('dayPlans reads her first makes for this unit, newest per day', async () => {
    const f = fake({
      data: [
        { id: 'p3', status: 'ready', answers: { unit: { day_no: 4 } } },
        { id: 'p2', status: 'failed', answers: { unit: { day_no: 4 } } },
        { id: 'p1', status: 'authoring', answers: { unit: { day_no: 1 } } },
      ],
      error: null,
    });
    expect(await createUnitStore(f.client).dayPlans('u1', 'unit1')).toEqual([
      { id: 'p3', status: 'ready', day_no: 4 }, { id: 'p1', status: 'authoring', day_no: 1 },
    ]);
    expect(f.calls).toEqual(expect.arrayContaining([
      ['from', 'niete_lp612_own_plans'], ['eq', 'user_id', 'u1'], ['is', 'parent_own_id', null], ['eq', 'answers->unit->>unit_id', 'unit1'],
    ]));
  });
  it('latestPeriod: her latest unit\'s period for this grade + subject, or null', async () => {
    expect(await createUnitStore(fake({ data: [{ period_minutes: 35 }], error: null }).client).latestPeriod('u1', { grade: 3, subject: 'math' })).toBe(35);
    expect(await createUnitStore(fake({ data: [], error: null }).client).latestPeriod('u1', { grade: 3, subject: 'math' })).toBeNull();
  });
  it('a database error throws (the route answers 502)', async () => {
    await expect(createUnitStore(fake({ data: null, error: { message: 'boom' } }).client).list('u1')).rejects.toThrow('boom');
  });
});
