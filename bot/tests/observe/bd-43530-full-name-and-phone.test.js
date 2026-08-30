/**
 * bd-43530 — the observe pickers name a WHOLE person, and give her phone.
 *
 * Operator, 2026-08-31: "in the /observe flow there are screens where we show
 * teachers of the school. we display their first names. can we instead display
 * their full names and also their phone numbers as well? ... the screen where it
 * says visited, not visited" — i.e. SELECT_TEACHER. And: "phone number should be
 * taken from the users table as the phone number field for that teacher."
 *
 * WHY `users.name` AND NOT `first_name || ' ' || last_name`. Measured on NIETE
 * prod 2026-08-31 over all 9,362 teachers+principals:
 *   · `last_name` is populated for only 4,304 of them, but `name` for 7,912 —
 *     so first+last yields a real multi-word name 4,315 times, `name` 7,912.
 *   · 2,531 people have a ONE-WORD `first_name` and a MULTI-WORD `name`
 *     (first_name 'Irene', last_name NULL, name 'Irene Khan'). Concatenating
 *     first+last there returns "Irene" — still a first name, the bug unfixed.
 *   · 1,150 names have THREE parts ('Muhammad Kashif Rafique'), which two
 *     columns cannot reconstruct at all.
 *   · 26 rows have first/last but NO `name`, so first+last is a needed FALLBACK,
 *     not dead code. 513 have neither and must degrade, never print "null".
 * Resolution order is therefore: name → first+last → first → null.
 *
 * WHY THE PHONE GOES IN `description`. Max full-name length on prod is 29 code
 * points, so a name fits the 30-cap title untouched. A phone is 12 digits and
 * `description` caps at 20 on the legacy NavigationList — so the phone gets that
 * field ALONE and the band/level moves in front of the status line. A phone
 * clipped to "92333123456…" is worse than absent: it cannot be dialled, and it
 * silently reads as a real number. This also matches the send-report picker
 * (buildTeacherPickPayload), which already renders title=name, description=phone.
 *
 * No Flow republish: SELECT_TEACHER already binds title/description/metadata.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  shapePatchRow, dedupePatch, toLeaderSourceRow, listPatchViaSupabase, PATCH_SQL,
} = require('../../shared/services/observe/patch-resolver.service');

const row = (over = {}) => ({
  user_id: 'u1',
  phone_number: '923001234567',
  first_name: 'Irene',
  last_name: null,
  name: 'Irene Khan',
  role: 'teacher',
  school_id: 's1',
  school_name: 'IMSB (VI-X), Rawal Dam',
  emis: '409',
  training_bands: ['primary'],
  grades_taught: null,
  ...over,
});

describe('bd-43530 · shapePatchRow resolves a WHOLE name', () => {
  it('prefers users.name over first+last — the 2,531-row "Irene" / "Irene Khan" case', () => {
    expect(shapePatchRow(row()).name).toBe('Irene Khan');
  });

  it('keeps a three-part name two columns could never rebuild (1,150 people)', () => {
    expect(shapePatchRow(row({
      first_name: 'Muhammad', last_name: null, name: 'Muhammad Kashif Rafique',
    })).name).toBe('Muhammad Kashif Rafique');
  });

  it('joins first+last when `name` is empty — the 26 rows that need the fallback', () => {
    expect(shapePatchRow(row({ name: null, first_name: 'Munazza', last_name: 'Khatoon' })).name)
      .toBe('Munazza Khatoon');
    expect(shapePatchRow(row({ name: '   ', first_name: 'Munazza', last_name: 'Khatoon' })).name)
      .toBe('Munazza Khatoon');
  });

  it('still returns the lone first name when that is all there is (back-compat)', () => {
    // The pre-existing patch-resolver suite fixtures stuff a full name into
    // first_name; they must keep passing.
    expect(shapePatchRow(row({ name: null, first_name: 'Tahira Manzoor', last_name: null })).name)
      .toBe('Tahira Manzoor');
    expect(shapePatchRow(row({ name: null, first_name: 'Irene', last_name: null })).name)
      .toBe('Irene');
  });

  it('degrades to null rather than printing "null" — 513 people have no name at all', () => {
    expect(shapePatchRow(row({ name: null, first_name: null, last_name: null })).name).toBeNull();
    expect(shapePatchRow(row({ name: '', first_name: '', last_name: '' })).name).toBeNull();
  });

  it('collapses the stray whitespace a registration form leaves behind', () => {
    expect(shapePatchRow(row({ name: '  Irene   Khan ' })).name).toBe('Irene Khan');
  });

  it('carries users.phone_number through as the phone, untouched', () => {
    expect(shapePatchRow(row()).phone).toBe('923001234567');
    expect(toLeaderSourceRow(shapePatchRow(row())).teacher_phone_e164).toBe('923001234567');
  });
});

describe('bd-43530 · both queries actually ASK for the name columns', () => {
  it('PATCH_SQL selects u.name and u.last_name — a shape fix reading columns it never fetched is a no-op', () => {
    expect(PATCH_SQL).toMatch(/\bu\.name\b/);
    expect(PATCH_SQL).toMatch(/\bu\.last_name\b/);
  });

  it('the supabase path requests them too', async () => {
    const selects = [];
    const table = (rows) => {
      const q = {
        select: (cols) => { selects.push(cols); return q; },
        eq: () => q, in: () => q, then: (r) => r({ data: rows }),
      };
      return q;
    };
    const sb = { from: (t) => table({
      leader_schools: [{ school_ext_id: 'niete:409', school_id: null }],
      schools: [{ id: 's1', name: 'IMSB', emis: '409' }],
      users: [row({ id: 'u1' })],
    }[t] || []) };
    await listPatchViaSupabase(sb, 'coach-1', null);
    const usersSelect = selects.find((s) => s.includes('phone_number'));
    expect(usersSelect).toMatch(/\bname\b/);
    expect(usersSelect).toMatch(/\blast_name\b/);
  });

  it('the derived person still reaches the Flow as a full name', async () => {
    const table = (rows) => {
      const q = { select: () => q, eq: () => q, in: () => q, then: (r) => r({ data: rows }) };
      return q;
    };
    const sb = { from: (t) => table({
      leader_schools: [{ school_ext_id: 'niete:409', school_id: null }],
      schools: [{ id: 's1', name: 'IMSB', emis: '409' }],
      users: [{ id: 'u1', phone_number: '923001234567', first_name: 'Irene', last_name: null,
                name: 'Irene Khan', role: 'teacher', school_id: 's1', training_bands: ['primary'] }],
    }[t] || []) };
    const out = await listPatchViaSupabase(sb, 'coach-1', null);
    expect(out[0].name).toBe('Irene Khan');
    expect(toLeaderSourceRow(out[0]).teacher_name).toBe('Irene Khan');
  });
});

describe('bd-43530 · dedupePatch still sorts on the resolved full name', () => {
  it('orders by the whole name, principals last', () => {
    const out = dedupePatch([
      shapePatchRow(row({ user_id: 'p1', role: 'principal', name: 'Aaa Principal' })),
      shapePatchRow(row({ user_id: 't2', name: 'Zzz Teacher' })),
      shapePatchRow(row({ user_id: 't1', name: 'Aaa Teacher' })),
    ]);
    expect(out.map((r) => r.name)).toEqual(['Aaa Teacher', 'Zzz Teacher', 'Aaa Principal']);
  });
});
