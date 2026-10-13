/**
 * scripts/create-analytics-user.js — make (or reuse) an analytics-only portal account.
 *
 * Dry run by default. With --commit: a users row (role 'unregistered', no school), its id
 * appended to app_settings.portal_analytics_only, and a setup link minted WITHOUT a
 * WhatsApp send. It refuses a phone that already belongs to a teacher, principal or coach:
 * turning a working account into an analytics-only one would lock that person out of
 * their own portal.
 */

const {
  normalisePkPhone, assertProjectRef, appendUserId, planAccount, run, ANALYTICS_ACCOUNT_DEFAULTS,
} = require('../../scripts/create-analytics-user');

describe('normalisePkPhone — the same canonical form portal login looks up', () => {
  it.each([
    ['03001234567', '923001234567'],
    ['3001234567', '923001234567'],
    ['+92 300 1234567', '923001234567'],
    ['0092-300-1234567', '923001234567'],
    ['923001234567', '923001234567'],
  ])('%s -> %s', (raw, want) => {
    expect(normalisePkPhone(raw)).toBe(want);
  });

  it.each([[''], [null], ['12345'], ['+1 415 555 0123'], ['92300123456789'], ['abc']])('refuses %s', (raw) => {
    expect(normalisePkPhone(raw)).toBeNull();
  });
});

describe('assertProjectRef', () => {
  it('returns the ref when it matches', () => {
    expect(assertProjectRef('https://olvritwoqujtjvwfulbh.supabase.co', 'olvritwoqujtjvwfulbh')).toBe('olvritwoqujtjvwfulbh');
  });
  it('aborts on a different project or an unparseable URL', () => {
    expect(() => assertProjectRef('https://ihzciabopbttygxxgrkm.supabase.co', 'olvritwoqujtjvwfulbh')).toThrow(/ABORT/);
    expect(() => assertProjectRef('', 'olvritwoqujtjvwfulbh')).toThrow(/ABORT/);
  });
});

describe('appendUserId — never drops anyone, never overwrites a broadcast value', () => {
  it('creates the list when the row is absent', () => {
    expect(appendUserId(undefined, 'u1')).toEqual({ ids: ['u1'], changed: true });
  });
  it('appends to an existing list, keeping every other id', () => {
    expect(appendUserId(['a', 'b'], 'u1')).toEqual({ ids: ['a', 'b', 'u1'], changed: true });
    expect(appendUserId('["a"]', 'u1')).toEqual({ ids: ['a', 'u1'], changed: true });
  });
  it('is idempotent', () => {
    expect(appendUserId(['a', 'u1'], 'u1')).toEqual({ ids: ['a', 'u1'], changed: false });
  });
  it('refuses a value that is not a list of ids', () => {
    for (const v of [true, 'true', 'teachers', { a: 1 }, 5, [1, 'a']]) {
      expect(() => appendUserId(v, 'u1')).toThrow(/not a list/);
    }
  });
});

describe('planAccount', () => {
  it('creates when the phone has no account', () => {
    expect(planAccount(null).action).toBe('create');
  });
  it('reuses an unregistered (or role-less) account with no school', () => {
    expect(planAccount({ id: 'u', role: 'unregistered', school_id: null }).action).toBe('reuse');
    expect(planAccount({ id: 'u', role: null, school_id: null }).action).toBe('reuse');
  });
  it.each(['teacher', 'principal', 'coach', ' Teacher '])('refuses a %s', (role) => {
    const p = planAccount({ id: 'u', role, school_id: null });
    expect(p.action).toBe('refuse');
    expect(p.reason).toMatch(/teacher|principal|coach/i);
  });
  it('refuses an account attached to a school', () => {
    expect(planAccount({ id: 'u', role: 'unregistered', school_id: 'sch' }).action).toBe('refuse');
  });
});

// ── run(): the whole flow against an in-memory supabase ─────────────────────────
function fakeSupabase({ users = [], flagValue } = {}) {
  const db = {
    users: users.map((u) => ({ ...u })),
    app_settings: flagValue === undefined ? [] : [{ key: 'portal_analytics_only', value: flagValue }],
  };
  const writes = [];
  let seq = 0;
  const from = (table) => {
    const filters = {};
    const chain = {
      select: () => chain,
      eq: (c, v) => { filters[c] = v; return chain; },
      maybeSingle: async () => ({ data: db[table].find((r) => Object.entries(filters).every(([c, v]) => r[c] === v)) || null, error: null }),
      insert: (row) => {
        const created = { id: `new-${++seq}`, ...row };
        writes.push({ table, op: 'insert', row: created });
        db[table].push(created);
        return { select: () => ({ single: async () => ({ data: { id: created.id }, error: null }) }) };
      },
      update: (row) => ({
        eq: async (col, val) => {
          writes.push({ table, op: 'update', row, where: { [col]: val } });
          const r = db[table].find((x) => x[col] === val);
          if (r) Object.assign(r, row);
          return { error: null };
        },
      }),
      upsert: async (row) => {
        writes.push({ table, op: 'upsert', row });
        const i = db[table].findIndex((r) => r.key === row.key);
        if (i >= 0) db[table][i] = { ...db[table][i], ...row }; else db[table].push(row);
        return { error: null };
      },
    };
    return chain;
  };
  return { client: { from }, db, writes };
}

const invite = () => ({ generatePortalToken: jest.fn(async () => ({ success: true, token: 'tok-123' })) });
const quiet = () => {};

describe('run()', () => {
  const base = { phone: '0300 1234567', name: 'FDE Analytics Test', portalUrl: 'https://portal.example', log: quiet };

  it('dry run: plans, writes nothing, mints no link', async () => {
    const sb = fakeSupabase({ flagValue: ['other'] });
    const inv = invite();
    const out = await run({ ...base, supabase: sb.client, invite: inv, commit: false });
    expect(out.plan.action).toBe('create');
    expect(out.committed).toBe(false);
    expect(sb.writes).toEqual([]);
    expect(inv.generatePortalToken).not.toHaveBeenCalled();
    expect(out.setupUrl).toBeNull();
  });

  it('commit: creates the account, appends it to the flag, prints the setup link', async () => {
    const sb = fakeSupabase({ flagValue: ['other'] });
    const inv = invite();
    const out = await run({ ...base, supabase: sb.client, invite: inv, commit: true });
    const ins = sb.writes.find((w) => w.op === 'insert');
    expect(ins.table).toBe('users');
    expect(ins.row).toMatchObject({
      phone_number: '923001234567', name: 'FDE Analytics Test', role: 'unregistered', school_id: null,
      ...ANALYTICS_ACCOUNT_DEFAULTS,
    });
    expect(sb.db.app_settings[0].value).toEqual(['other', out.userId]);
    expect(inv.generatePortalToken).toHaveBeenCalledWith(out.userId);
    expect(out.setupUrl).toBe('https://portal.example/portal/setup/tok-123');
  });

  it('creates the flag row when it does not exist', async () => {
    const sb = fakeSupabase();
    const out = await run({ ...base, supabase: sb.client, invite: invite(), commit: true });
    expect(sb.db.app_settings).toHaveLength(1);
    expect(sb.db.app_settings[0]).toMatchObject({ key: 'portal_analytics_only', value: [out.userId] });
  });

  it('is idempotent: a re-run reuses the account and leaves the list as it was', async () => {
    const existing = { id: 'acct-1', phone_number: '923001234567', role: 'unregistered', school_id: null, name: 'FDE Analytics Test' };
    const sb = fakeSupabase({ users: [existing], flagValue: ['other', 'acct-1'] });
    const out = await run({ ...base, supabase: sb.client, invite: invite(), commit: true });
    expect(out.plan.action).toBe('reuse');
    expect(out.userId).toBe('acct-1');
    expect(sb.writes.filter((w) => w.op === 'insert')).toEqual([]);
    expect(sb.writes.filter((w) => w.table === 'app_settings')).toEqual([]);
    expect(sb.db.app_settings[0].value).toEqual(['other', 'acct-1']);
    expect(out.setupUrl).toBe('https://portal.example/portal/setup/tok-123');
  });

  it('reusing a nameless account gives it the name (so the portal can greet it), and never renames one', async () => {
    const nameless = { id: 'acct-2', phone_number: '923001234567', role: null, school_id: null, name: null };
    const sb = fakeSupabase({ users: [nameless], flagValue: [] });
    await run({ ...base, supabase: sb.client, invite: invite(), commit: true });
    const upd = sb.writes.filter((w) => w.op === 'update');
    expect(upd).toEqual([{ table: 'users', op: 'update', row: { name: 'FDE Analytics Test' }, where: { id: 'acct-2' } }]);

    const named = { ...nameless, id: 'acct-3', name: 'Someone' };
    const sb2 = fakeSupabase({ users: [named], flagValue: [] });
    await run({ ...base, supabase: sb2.client, invite: invite(), commit: true });
    expect(sb2.writes.filter((w) => w.op === 'update')).toEqual([]);
  });

  it('a dry run of a reuse writes nothing either', async () => {
    const nameless = { id: 'acct-2', phone_number: '923001234567', role: null, school_id: null, name: null };
    const sb = fakeSupabase({ users: [nameless], flagValue: [] });
    await run({ ...base, supabase: sb.client, invite: invite(), commit: false });
    expect(sb.writes).toEqual([]);
  });

  it.each(['teacher', 'principal', 'coach'])('refuses a %s phone and writes nothing', async (role) => {
    const sb = fakeSupabase({ users: [{ id: 'x', phone_number: '923001234567', role, school_id: null }], flagValue: [] });
    const inv = invite();
    await expect(run({ ...base, supabase: sb.client, invite: inv, commit: true })).rejects.toThrow(/REFUSED/);
    expect(sb.writes).toEqual([]);
    expect(inv.generatePortalToken).not.toHaveBeenCalled();
  });

  it('refuses to touch a broadcast flag value', async () => {
    const sb = fakeSupabase({ flagValue: true });
    await expect(run({ ...base, supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/not a list/);
    expect(sb.writes).toEqual([]);
  });

  it('refuses a phone it cannot normalise', async () => {
    const sb = fakeSupabase();
    await expect(run({ ...base, phone: '12', supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/phone/i);
    expect(sb.writes).toEqual([]);
  });

  it('a failed token mint is an error, not a silent success', async () => {
    const sb = fakeSupabase({ flagValue: [] });
    const inv = { generatePortalToken: jest.fn(async () => ({ success: false, error: 'nope' })) };
    await expect(run({ ...base, supabase: sb.client, invite: inv, commit: true })).rejects.toThrow(/token/i);
  });
});
