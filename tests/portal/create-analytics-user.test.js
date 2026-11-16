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
/** region_features as on every tier since V1.8.8: FDE's six sectors under 'niete', Gilgit-Baltistan under 'moawin'. */
const REGISTRY = [
  { region: 'niete', organization: null, is_active: true },
  { region: 'b.k', organization: 'niete', is_active: true },
  { region: 'tarnol', organization: 'niete', is_active: true },
  { region: 'gilgit-baltistan', organization: 'moawin', is_active: true },
  { region: 'old-pilot', organization: 'retired', is_active: false },
];
function fakeSupabase({ users = [], flagValue, orgMap, registry = REGISTRY } = {}) {
  const db = {
    users: users.map((u) => ({ ...u })),
    app_settings: [
      ...(flagValue === undefined ? [] : [{ key: 'portal_analytics_only', value: flagValue }]),
      ...(orgMap === undefined ? [] : [{ key: 'portal_analytics_organizations', value: orgMap }]),
    ],
    region_features: registry.map((r) => ({ ...r })),
  };
  const writes = [];
  let seq = 0;
  const from = (table) => {
    const filters = {};
    const chain = {
      select: () => chain,
      eq: (c, v) => { filters[c] = v; return chain; },
      limit: () => chain,
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

// ── bd-s6qbts.5: an account NAME instead of a phone ─────────────────────────────
//
//   node scripts/create-analytics-user.js --env prod --name fde-islamabad --display "FDE Islamabad" [--commit]
//
// users.phone_number = 'analytics:<name>' (non-numeric: no teacher can hold it, WhatsApp cannot reach it), and
// --reset-password re-opens an existing one for a new password through a fresh setup link.
describe('parseArgs — which flag means what', () => {
  const { parseArgs } = require('../../scripts/create-analytics-user');

  it('--name is the account name and --display the label it is greeted by', () => {
    expect(parseArgs(['--env', 'prod', '--name', 'fde-islamabad', '--display', 'FDE Islamabad'])).toMatchObject({
      env: 'prod', account: 'fde-islamabad', name: 'FDE Islamabad', phone: null, commit: false, resetPassword: false,
    });
  });

  it('--phone keeps working, with --display or (as before) --name as the label', () => {
    expect(parseArgs(['--env', 'sandbox', '--phone', '03001234567', '--display', 'Analytics Test']))
      .toMatchObject({ phone: '03001234567', name: 'Analytics Test', account: null });
    expect(parseArgs(['--env', 'sandbox', '--phone', '03001234567', '--name', 'Analytics Test']))
      .toMatchObject({ phone: '03001234567', name: 'Analytics Test', account: null });
  });

  it('--commit and --reset-password are switches', () => {
    expect(parseArgs(['--env', 'prod', '--name', 'fde-islamabad', '--reset-password', '--commit']))
      .toMatchObject({ account: 'fde-islamabad', resetPassword: true, commit: true });
  });

  it('refuses an ambiguous --phone + --name + --display', () => {
    expect(() => parseArgs(['--env', 'prod', '--phone', '03001234567', '--name', 'fde', '--display', 'FDE']))
      .toThrow(/REFUSED/);
  });
});

describe('run() with an account name', () => {
  const base = { account: 'fde-islamabad', name: 'FDE Islamabad', portalUrl: 'https://portal.example', log: quiet };

  it('commit: creates analytics:<name> with the display name, unregistered, no school; lists it; mints the link', async () => {
    const sb = fakeSupabase({ flagValue: ['other'] });
    const inv = invite();
    const out = await run({ ...base, supabase: sb.client, invite: inv, commit: true });
    const ins = sb.writes.find((w) => w.op === 'insert');
    expect(ins.table).toBe('users');
    expect(ins.row).toMatchObject({
      phone_number: 'analytics:fde-islamabad', name: 'FDE Islamabad', role: 'unregistered', school_id: null,
      ...ANALYTICS_ACCOUNT_DEFAULTS,
    });
    expect(sb.db.app_settings[0].value).toEqual(['other', out.userId]);
    expect(inv.generatePortalToken).toHaveBeenCalledWith(out.userId);
    expect(out.setupUrl).toBe('https://portal.example/portal/setup/tok-123');
    expect(out.signInAs).toBe('fde-islamabad');
  });

  it('lower-cases the name, as the login does', async () => {
    const sb = fakeSupabase({ flagValue: [] });
    await run({ ...base, account: '  FDE-Islamabad ', supabase: sb.client, invite: invite(), commit: true });
    expect(sb.writes.find((w) => w.op === 'insert').row.phone_number).toBe('analytics:fde-islamabad');
  });

  it('dry run: writes nothing, mints nothing', async () => {
    const sb = fakeSupabase({ flagValue: [] });
    const inv = invite();
    const out = await run({ ...base, supabase: sb.client, invite: inv, commit: false });
    expect(out.committed).toBe(false);
    expect(sb.writes).toEqual([]);
    expect(inv.generatePortalToken).not.toHaveBeenCalled();
  });

  it.each(['ab', 'fde islamabad', '9fde', 'analytics:fde', '_fde', '', 'fde-03001234567'])('refuses the name %p and writes nothing', async (bad) => {
    const sb = fakeSupabase({ flagValue: [] });
    await expect(run({ ...base, account: bad, supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/REFUSED/);
    expect(sb.writes).toEqual([]);
  });

  it('needs a display name', async () => {
    const sb = fakeSupabase({ flagValue: [] });
    await expect(run({ ...base, name: ' ', supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/REFUSED/);
    expect(sb.writes).toEqual([]);
  });

  it('refuses both a phone and a name, and neither', async () => {
    const sb = fakeSupabase({ flagValue: [] });
    await expect(run({ ...base, phone: '03001234567', supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/REFUSED/);
    await expect(run({ ...base, account: null, supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/REFUSED/);
    expect(sb.writes).toEqual([]);
  });

  it('a re-run reuses the account and leaves the list as it was', async () => {
    const existing = { id: 'acct-fde', phone_number: 'analytics:fde-islamabad', role: 'unregistered', school_id: null, name: 'FDE Islamabad' };
    const sb = fakeSupabase({ users: [existing], flagValue: ['acct-fde'] });
    const out = await run({ ...base, supabase: sb.client, invite: invite(), commit: true });
    expect(out.plan.action).toBe('reuse');
    expect(sb.writes.filter((w) => w.op === 'insert' || w.table === 'app_settings')).toEqual([]);
  });
});

describe('run() --reset-password — a fresh setup link for an analytics account that has lost its password', () => {
  const base = { account: 'fde-islamabad', name: null, resetPassword: true, portalUrl: 'https://portal.example', log: quiet };
  const acct = (over) => ({
    id: 'acct-fde', phone_number: 'analytics:fde-islamabad', role: 'unregistered', school_id: null, name: 'FDE Islamabad',
    portal_activated: true, portal_password_hash: '$2a$10$x', ...over,
  });

  it('commit: clears the password and the activation (so setup will take a new one), then mints a link', async () => {
    const sb = fakeSupabase({ users: [acct()], flagValue: ['acct-fde'] });
    const inv = invite();
    const out = await run({ ...base, supabase: sb.client, invite: inv, commit: true });
    expect(sb.writes).toEqual([{
      table: 'users', op: 'update', row: { portal_password_hash: null, portal_activated: false }, where: { id: 'acct-fde' },
    }]);
    expect(inv.generatePortalToken).toHaveBeenCalledWith('acct-fde');
    expect(out.setupUrl).toBe('https://portal.example/portal/setup/tok-123');
  });

  it('dry run: writes nothing, mints nothing', async () => {
    const sb = fakeSupabase({ users: [acct()], flagValue: ['acct-fde'] });
    const inv = invite();
    await run({ ...base, supabase: sb.client, invite: inv, commit: false });
    expect(sb.writes).toEqual([]);
    expect(inv.generatePortalToken).not.toHaveBeenCalled();
  });

  it('refuses an account that does not exist', async () => {
    const sb = fakeSupabase({ flagValue: ['acct-fde'] });
    await expect(run({ ...base, supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/REFUSED/);
    expect(sb.writes).toEqual([]);
  });

  it('refuses an account that is not on portal_analytics_only', async () => {
    const sb = fakeSupabase({ users: [acct()], flagValue: ['someone-else'] });
    const inv = invite();
    await expect(run({ ...base, supabase: sb.client, invite: inv, commit: true })).rejects.toThrow(/REFUSED/);
    expect(sb.writes).toEqual([]);
    expect(inv.generatePortalToken).not.toHaveBeenCalled();
  });

  it('refuses a phone: a teacher resets her own password on WhatsApp', async () => {
    const sb = fakeSupabase({ users: [{ ...acct(), phone_number: '923001234567' }], flagValue: ['acct-fde'] });
    await expect(run({ ...base, account: null, phone: '03001234567', supabase: sb.client, invite: invite(), commit: true }))
      .rejects.toThrow(/REFUSED/);
    expect(sb.writes).toEqual([]);
  });
});

// Shoaib (GB POC, 15 Nov): "Each account needs both portal_analytics_only and the moawin mapping, or it shows ICT's
// data." The mapping was a second write by hand. --organization makes it part of making the account: the mapping is
// written FIRST (an account is never on the list without it), an organization the region registry does not know is
// refused, and an account already mapped elsewhere is never moved. The CLI asks for it on every new account.
describe('--organization: whose regions the account sees, written with the account', () => {
  const ORG_KEY = 'portal_analytics_organizations';
  const base = { account: 'moawin-ho-test', name: 'Moawin HO (test)', portalUrl: 'https://portal.example', log: quiet };
  const mapRow = (sb) => (sb.db.app_settings.find((r) => r.key === ORG_KEY) || {}).value;
  const listRow = (sb) => (sb.db.app_settings.find((r) => r.key === 'portal_analytics_only') || {}).value;

  it('commit: maps the new account to moawin BEFORE it goes on the list, keeping every other mapping', async () => {
    const sb = fakeSupabase({ flagValue: ['fde-1', 'gb-1'], orgMap: { 'gb-1': 'moawin' } });
    const out = await run({ ...base, organization: 'moawin', supabase: sb.client, invite: invite(), commit: true });
    expect(mapRow(sb)).toEqual({ 'gb-1': 'moawin', [out.userId]: 'moawin' });
    expect(listRow(sb)).toEqual(['fde-1', 'gb-1', out.userId]);
    const keys = sb.writes.filter((w) => w.table === 'app_settings').map((w) => w.row.key);
    expect(keys).toEqual([ORG_KEY, 'portal_analytics_only']);
    expect(out.organization).toBe('moawin');
  });

  it('creates the mapping row when there is none; a JSON-string map is read as the map', async () => {
    const none = fakeSupabase({ flagValue: [] });
    const a = await run({ ...base, organization: 'moawin', supabase: none.client, invite: invite(), commit: true });
    expect(mapRow(none)).toEqual({ [a.userId]: 'moawin' });
    const str = fakeSupabase({ flagValue: [], orgMap: JSON.stringify({ 'gb-1': 'moawin' }) });
    const b = await run({ ...base, organization: 'moawin', supabase: str.client, invite: invite(), commit: true });
    expect(mapRow(str)).toEqual({ 'gb-1': 'moawin', [b.userId]: 'moawin' });
  });

  it('spelling is forgiven (" Moawin "), an organization the registry does not know is not', async () => {
    const ok = fakeSupabase({ flagValue: [] });
    const out = await run({ ...base, organization: ' Moawin ', supabase: ok.client, invite: invite(), commit: true });
    expect(mapRow(ok)[out.userId]).toBe('moawin');
    for (const org of ['mowain', 'retired', 'gb', '']) {
      const sb = fakeSupabase({ flagValue: [] });
      // eslint-disable-next-line no-await-in-loop
      await expect(run({ ...base, organization: org, supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/REFUSED/);
      expect(sb.writes).toEqual([]);
    }
  });

  it('dry run: checks the organization and the map, writes nothing, mints nothing', async () => {
    const sb = fakeSupabase({ flagValue: [], orgMap: {} });
    const inv = invite();
    const out = await run({ ...base, organization: 'moawin', supabase: sb.client, invite: inv, commit: false });
    expect(out.committed).toBe(false);
    expect(sb.writes).toEqual([]);
    expect(inv.generatePortalToken).not.toHaveBeenCalled();
    const bad = fakeSupabase({ flagValue: [] });
    await expect(run({ ...base, organization: 'mowain', supabase: bad.client, invite: invite(), commit: false })).rejects.toThrow(/REFUSED/);
  });

  it('a mapping value that is not an object of names is refused before any write', async () => {
    for (const orgMap of [['x'], true, 'moawin', '{bad json', { a: 7 }]) {
      const sb = fakeSupabase({ flagValue: [], orgMap });
      // eslint-disable-next-line no-await-in-loop
      await expect(run({ ...base, organization: 'moawin', supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/REFUSED/);
      expect(sb.writes).toEqual([]);
    }
  });

  it('an account already mapped to another organization is never moved', async () => {
    const existing = { id: 'acct-1', phone_number: 'analytics:moawin-ho-test', role: 'unregistered', school_id: null, name: 'X' };
    const sb = fakeSupabase({ users: [existing], flagValue: ['acct-1'], orgMap: { 'acct-1': 'moawin' } });
    await expect(run({ ...base, organization: 'niete', supabase: sb.client, invite: invite(), commit: true })).rejects.toThrow(/REFUSED/);
    expect(sb.writes).toEqual([]);
  });

  it("niete (FDE's) is the default: no mapping row is written, the list is as before", async () => {
    const sb = fakeSupabase({ flagValue: ['fde-1'], orgMap: { 'gb-1': 'moawin' } });
    const out = await run({ ...base, account: 'fde-ho-test', organization: 'niete', supabase: sb.client, invite: invite(), commit: true });
    expect(mapRow(sb)).toEqual({ 'gb-1': 'moawin' });
    expect(listRow(sb)).toEqual(['fde-1', out.userId]);
  });

  it('a re-run with the same organization changes nothing in either row', async () => {
    const existing = { id: 'acct-1', phone_number: 'analytics:moawin-ho-test', role: 'unregistered', school_id: null, name: 'X' };
    const sb = fakeSupabase({ users: [existing], flagValue: ['acct-1'], orgMap: { 'acct-1': 'moawin' } });
    await run({ ...base, organization: 'moawin', supabase: sb.client, invite: invite(), commit: true });
    expect(sb.writes.filter((w) => w.table === 'app_settings')).toEqual([]);
  });

  it('the command line: --organization is read, and a new account without it is refused (a reset needs none)', () => {
    const { parseArgs, checkArgs } = require('../../scripts/create-analytics-user');
    const args = parseArgs(['--env', 'staging', '--name', 'moawin-ho-test', '--display', 'Moawin HO (test)', '--organization', 'moawin']);
    expect(args.organization).toBe('moawin');
    expect(() => checkArgs(args)).not.toThrow();
    expect(() => checkArgs(parseArgs(['--env', 'staging', '--name', 'moawin-ho-test', '--display', 'X']))).toThrow(/REFUSED.*--organization/);
    expect(() => checkArgs(parseArgs(['--env', 'staging', '--name', 'moawin-ho-test', '--reset-password']))).not.toThrow();
  });
});
