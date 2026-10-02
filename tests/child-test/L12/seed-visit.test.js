'use strict';
/**
 * seed-visit — today's observe2 visit for the SIM coach at the SIM school, so `/egra` opens a list
 * (as after a real observe2 visit: it fixes the observed grade).
 * Sandbox only; the SIM coach must be a test user; idempotent per PKT day; removable.
 *
 * Only the Supabase client is faked (the network boundary).
 */
const { seedVisit, removeSimVisits, assertSandbox, SIM } = require('../../../bot/scripts/e2e/child-test-sim/seed-visit');

const SANDBOX_URL = 'https://olvritwoqujtjvwfulbh.supabase.co';

/** A chainable fake of the supabase-js query builder: records every call, answers from `answers[table]`. */
function fakeSupabase(answers) {
  const calls = [];
  const from = (table) => {
    const q = { table, ops: [] };
    calls.push(q);
    const chain = new Proxy({}, {
      get(_, op) {
        if (op === 'then') {
          const a = answers[table];
          const res = typeof a === 'function' ? a(q) : a;
          return (ok, bad) => Promise.resolve(res || { data: null, error: null }).then(ok, bad);
        }
        return (...args) => { q.ops.push([op, ...args]); return chain; };
      },
    });
    return chain;
  };
  return { from, calls };
}

const coachRow = { data: { id: SIM.coachId, phone_number: SIM.coachPhone, is_test_user: true, role: 'coach' }, error: null };

describe('assertSandbox', () => {
  test('accepts only the NIETE sandbox project', () => {
    expect(() => assertSandbox(SANDBOX_URL)).not.toThrow();
    expect(() => assertSandbox('https://ihzciabopbttygxxgrkm.supabase.co')).toThrow(/sandbox/);
    expect(() => assertSandbox('https://jlpenspfdcwxkopaidys.supabase.co')).toThrow(/sandbox/);
    expect(() => assertSandbox('')).toThrow(/sandbox/);
  });
});

describe('seedVisit', () => {
  test('inserts a sealed SIM visit by the SIM coach of the Grade 3 teacher at the SIM school, tagged sim', async () => {
    let inserted = null;
    const sb = fakeSupabase({
      users: coachRow,
      observation_field_forms: (q) => {
        if (q.ops.some(([op]) => op === 'insert')) { inserted = q.ops.find(([op]) => op === 'insert')[1]; return { data: { id: 'v-new' }, error: null }; }
        return { data: [], error: null };
      },
    });
    const now = new Date('2026-10-02T05:00:00Z');   // 10:00 PKT
    const r = await seedVisit({ supabase: sb, url: SANDBOX_URL, now });
    expect(r).toEqual({ ok: true, visitId: 'v-new', reused: false });
    expect(inserted).toMatchObject({
      observer_user_id: SIM.coachId, teacher_user_id: SIM.teachers['3A'],
      visit_context: { school_ext_id: 'niete:SIM-CT-0001', sim: 'child-test-sim' },
      sealed_at: now.toISOString(),
    });
    const lookup = sb.calls.find((c) => c.table === 'observation_field_forms' && c.ops.some(([op]) => op === 'select'));
    expect(lookup.ops).toEqual(expect.arrayContaining([['eq', 'observer_user_id', SIM.coachId], ['eq', 'visit_context->>sim', 'child-test-sim'],
      ['gte', 'created_at', '2026-10-01T19:00:00.000Z']]));
  });

  test('reuses today\'s SIM visit instead of adding a second', async () => {
    const sb = fakeSupabase({ users: coachRow, observation_field_forms: { data: [{ id: 'v-old', teacher_user_id: SIM.teachers['5A'] }], error: null } });
    const r = await seedVisit({ supabase: sb, url: SANDBOX_URL, teacher: '5A' });
    expect(r).toEqual({ ok: true, visitId: 'v-old', reused: true });
    expect(sb.calls.some((c) => c.ops.some(([op]) => op === 'insert'))).toBe(false);
  });

  test('refuses a non-sandbox database before any query', async () => {
    const sb = fakeSupabase({});
    await expect(seedVisit({ supabase: sb, url: 'https://ihzciabopbttygxxgrkm.supabase.co' })).rejects.toThrow(/sandbox/);
    expect(sb.calls).toHaveLength(0);
  });

  test('refuses when the coach row is not a test user', async () => {
    const sb = fakeSupabase({ users: { data: { ...coachRow.data, is_test_user: false }, error: null } });
    await expect(seedVisit({ supabase: sb, url: SANDBOX_URL })).rejects.toThrow(/test user/);
  });

  test('an insert error is loud', async () => {
    const sb = fakeSupabase({ users: coachRow, observation_field_forms: (q) => (q.ops.some(([op]) => op === 'insert') ? { data: null, error: { message: 'boom' } } : { data: [], error: null }) });
    await expect(seedVisit({ supabase: sb, url: SANDBOX_URL })).rejects.toThrow(/boom/);
  });
});

describe('removeSimVisits', () => {
  test('deletes only SIM-tagged visits of the SIM coach', async () => {
    const sb = fakeSupabase({ observation_field_forms: { data: [{ id: 'a' }, { id: 'b' }], error: null } });
    const r = await removeSimVisits({ supabase: sb, url: SANDBOX_URL });
    expect(r).toEqual({ ok: true, removed: 2 });
    const del = sb.calls[0];
    expect(del.ops[0][0]).toBe('delete');
    expect(del.ops).toEqual(expect.arrayContaining([['eq', 'observer_user_id', SIM.coachId], ['eq', 'visit_context->>sim', 'child-test-sim']]));
  });
});
