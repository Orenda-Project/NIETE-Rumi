/**
 * A coach's people are DERIVED from her schools, not stored (TDD, red-first).
 *
 * Operator, 2026-08-28: "The coach to school assignment is the canonical one.
 * If there is a teacher who is assigned to coach A but her school is assigned
 * to coach B, that's a flaw in data. Whoever has the school has the teacher."
 * And: coaches observe principals too, so they belong in the patch — labelled,
 * not hidden.
 *
 * So `leader_teachers` stops being the source of truth and the patch becomes:
 *
 *     leader_schools (coach -> school)  ×  users.school_id (person -> school)
 *
 * Measured against prod 2026-08-28, which is what the shape below has to honour:
 *   · 8,034 coach-person pairs stored today; 9,804 derived including principals.
 *   · 233 stored pairs the derivation drops — 168 of them the exact "assigned to
 *     A, school belongs to B" flaw the operator calls bad data.
 *   · 354 principals appear who are in nobody's patch today. They are real, they
 *     have schools, and 15 coaches observed a principal this month — so they are
 *     included and MARKED, never silently mixed in with teachers.
 *   · 85 of 400 assigned schools have more than one coach, so two coaches
 *     legitimately share a person. Co-assignment is normal again.
 *   · leader_schools.school_id is a real FK that is 0% populated; 497 of 502
 *     rows resolve, the other 5 are `test:` rows. The resolver must not depend
 *     on the string join once that is backfilled.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  shapePatchRow,
  dedupePatch,
  bandOf,
  PATCH_ROLES,
} = require('../../shared/services/observe/patch-resolver.service');

const row = (over = {}) => ({
  user_id: 'u1',
  phone_number: '923001234567',
  first_name: 'Tahira Manzoor',
  role: 'teacher',
  school_id: 's1',
  school_name: 'IMSB (VI-X), Rawal Dam',
  emis: '409',
  training_bands: ['primary'],
  grades_taught: null,
  ...over,
});

describe('who is in a patch at all', () => {
  it('teachers and principals, nobody else', () => {
    expect([...PATCH_ROLES].sort()).toEqual(['principal', 'teacher']);
  });
});

describe('shapePatchRow · a principal is never silently a teacher', () => {
  it('carries the person, her school, and her identity key', () => {
    const p = shapePatchRow(row());
    expect(p).toMatchObject({
      userId: 'u1',
      name: 'Tahira Manzoor',
      phone: '923001234567',
      schoolName: 'IMSB (VI-X), Rawal Dam',
      emis: '409',
      isPrincipal: false,
    });
  });

  it('marks a principal so the picker can label the row', () => {
    // 354 principals appear who are in nobody's patch today. Unlabelled they
    // read as teachers, and a coach observes the wrong person.
    const p = shapePatchRow(row({ role: 'principal', first_name: 'Nasir Mehmood' }));
    expect(p.isPrincipal).toBe(true);
    expect(p.roleLabel).toBe('Principal');
  });

  it('a teacher gets no label — the common case stays uncluttered', () => {
    expect(shapePatchRow(row()).roleLabel).toBe('');
  });
});

describe('bandOf · the band comes from users now, not the roster row', () => {
  it('prefers training_bands, which covers 2,492 of the 2,540 that had only a roster level', () => {
    expect(bandOf({ training_bands: ['primary'], grades_taught: null })).toBe('primary');
  });

  it('falls back to grades_taught when training_bands is empty', () => {
    expect(bandOf({ training_bands: [], grades_taught: 'MIDDLE' })).toBe('middle');
  });

  it('returns null rather than guessing — 48 teachers genuinely have neither', () => {
    expect(bandOf({ training_bands: null, grades_taught: null })).toBeNull();
    expect(bandOf({})).toBeNull();
  });

  it('normalises the spellings the old roster column was full of', () => {
    for (const raw of ['PRIMARY', 'Primary', 'primayr', 'Parimary']) {
      expect(bandOf({ grades_taught: raw })).toBe('primary');
    }
  });
});

describe('dedupePatch · two of a coach\'s schools can name the same person', () => {
  it('one row per person, not one per school', () => {
    const out = dedupePatch([row(), row({ school_id: 's2', school_name: 'Other School' })]);
    expect(out).toHaveLength(1);
  });

  it('keeps the person even when the phone is missing, keyed on user id', () => {
    const out = dedupePatch([row({ phone_number: null }), row({ phone_number: null })]);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe('u1');
  });

  it('two different people at one school both survive', () => {
    const out = dedupePatch([row(), row({ user_id: 'u2', phone_number: '923009999999' })]);
    expect(out).toHaveLength(2);
  });

  it('sorts principals after teachers, then by name — the coach came for a teacher', () => {
    const out = dedupePatch([
      row({ user_id: 'p1', role: 'principal', first_name: 'Aaa Principal' }),
      row({ user_id: 't2', first_name: 'Zzz Teacher' }),
      row({ user_id: 't1', first_name: 'Aaa Teacher' }),
    ]);
    expect(out.map((r) => r.name)).toEqual(['Aaa Teacher', 'Zzz Teacher', 'Aaa Principal']);
  });
});

// ── the supabase path, and the legacy shape the bot still expects ──────

const {
  listPatchViaSupabase, toLeaderSourceRow,
} = require('../../shared/services/observe/patch-resolver.service');

/** A fake supabase whose .from() returns canned tables. */
function fakeSupabase(tables, spy = {}) {
  return {
    from(name) {
      spy[name] = (spy[name] || 0) + 1;
      const q = {
        _rows: tables[name] || [],
        select() { return q; },
        eq(col, val) { q._rows = q._rows.filter((r) => r[col] === val); return q; },
        in(col, vals) { q._rows = q._rows.filter((r) => vals.includes(r[col])); return q; },
        then(res) { return res({ data: q._rows, error: null }); },
      };
      return q;
    },
  };
}

const TABLES = () => ({
  leader_schools: [
    { leader_user_id: 'c1', school_ext_id: 'niete:409', school_id: null },
    { leader_user_id: 'c1', school_ext_id: 'niete:203', school_id: null },
    { leader_user_id: 'c2', school_ext_id: 'niete:999', school_id: null },
  ],
  schools: [
    { id: 's409', name: 'IMSB (VI-X), Rawal Dam', emis: '409' },
    { id: 's203', name: 'IMS (I-V) G-6/1-1', emis: '203' },
  ],
  users: [
    { id: 'u1', phone_number: '923001111111', first_name: 'Tahira', role: 'teacher', school_id: 's409', training_bands: ['PRIMARY'] },
    { id: 'u2', phone_number: '923002222222', first_name: 'Nasir', role: 'principal', school_id: 's409', training_bands: [] },
    { id: 'u3', phone_number: '923003333333', first_name: 'Bushra', role: 'teacher', school_id: 's203', training_bands: ['MIDDLE'] },
    { id: 'u4', phone_number: '923004444444', first_name: 'Someone Else', role: 'teacher', school_id: 'sOTHER', training_bands: [] },
    { id: 'u5', phone_number: '923005555555', first_name: 'A Coach', role: 'coach', school_id: 's409', training_bands: [] },
  ],
});

describe('listPatchViaSupabase · the bot side of the same derivation', () => {
  it('returns everyone at her schools and nobody else', async () => {
    const out = await listPatchViaSupabase(fakeSupabase(TABLES()), 'c1');
    expect(out.map((r) => r.name).sort()).toEqual(['Bushra', 'Nasir', 'Tahira']);
  });

  it('excludes a coach who happens to sit at one of her schools', async () => {
    const out = await listPatchViaSupabase(fakeSupabase(TABLES()), 'c1');
    expect(out.find((r) => r.name === 'A Coach')).toBeUndefined();
  });

  it('excludes people at schools she does not hold', async () => {
    const out = await listPatchViaSupabase(fakeSupabase(TABLES()), 'c1');
    expect(out.find((r) => r.name === 'Someone Else')).toBeUndefined();
  });

  it('filters to ONE school when asked', async () => {
    const out = await listPatchViaSupabase(fakeSupabase(TABLES()), 'c1', 'niete:203');
    expect(out.map((r) => r.name)).toEqual(['Bushra']);
  });

  it("a blank school filter means no filter — '' must not zero the roster", async () => {
    // bd-5n1a2 shipped exactly this bug on the old path: a schedule row with
    // school_ext_id='' turned into a zero-row roster and unbound a picked teacher.
    for (const blank of ['', null, undefined]) {
      const out = await listPatchViaSupabase(fakeSupabase(TABLES()), 'c1', blank);
      expect(out).toHaveLength(3);
    }
  });

  it('a coach with no schools gets nothing, without querying users', async () => {
    const spy = {};
    const out = await listPatchViaSupabase(fakeSupabase(TABLES(), spy), 'nobody');
    expect(out).toEqual([]);
    expect(spy.users).toBeUndefined();
  });
});

describe('toLeaderSourceRow · the shape the visit Flow already consumes', () => {
  it('keys on the phone, because that is what observation_schedules stores', () => {
    // 980 of 992 live schedules and 8,043 of 8,057 roster rows already use the
    // phone as teacher_ext_id, so emitting it keeps scheduling continuous.
    const r = toLeaderSourceRow({
      userId: 'u1', name: 'Tahira', phone: '923001111111',
      emis: '409', schoolName: 'Rawal Dam', band: 'primary', isPrincipal: false,
    });
    expect(r).toEqual({
      teacher_ext_id: '923001111111',
      teacher_name: 'Tahira',
      teacher_phone_e164: '923001111111',
      school_ext_id: 'niete:409',
      level: 'PRIMARY',
      is_principal: false,
    });
  });

  it('keeps level uppercase — the old column was PRIMARY/MIDDLE/HIGH', () => {
    expect(toLeaderSourceRow({ band: 'high' }).level).toBe('HIGH');
    expect(toLeaderSourceRow({ band: null }).level).toBeNull();
  });
});
