/**
 * bd-apnnh2.11 — a retired account is in nobody's patch.
 *
 * A fold retires a teacher's spare account (bot/shared/utils/soft-delete.js:
 * deleted_at set, phone_number 'merged:<id>') and leaves its school_id and role
 * as they were. Every derivation of "who this coach or principal may observe"
 * joins users on school_id, and none of them asked whether the account was live.
 * So each fold left a second, empty copy of the teacher in the /observe picker,
 * in My Patch on the portal, and in the check that lets a coach book a visit.
 *
 * The coach edit already folds. N2 (a WhatsApp number change) and N3 ("Is this
 * you?") will fold more often, so this lands before either is switched on.
 *
 * The Supabase path is tested on behaviour. The SQL paths are pinned by text, as
 * the rest of this suite pins these statements (leader-patch-feature-engagement,
 * teacher-analytics): the unit lane has no Postgres. The pin reads the TOP LEVEL
 * of each statement, so a filter that sits inside one of the per-teacher LATERAL
 * subqueries, where it would filter nothing, does not count.
 */

const {
  listPatchViaSupabase,
  PATCH_SQL: BOT_PATCH_SQL,
} = require('../../bot/shared/services/observe/patch-resolver.service');
const {
  PATCH_TEACHERS_SQL,
  PRINCIPAL_PATCH_SQL,
} = require('../../dashboard/services/leader-patch.service');
const { createSchedule } = require('../../dashboard/services/leader-schedule-write.service');

/** The statement with every parenthesised group removed: what is left is its top level. */
function topLevel(sql) {
  let s = String(sql);
  for (let prev = null; prev !== s;) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, ' ');
  }
  return s;
}

const LIVE_ONLY = /\bu\.deleted_at\s+IS\s+NULL\b/i;

/** A fake supabase whose .from() returns canned tables, with the filters the resolver uses. */
function fakeSupabase(tables) {
  return {
    from(name) {
      const q = {
        _rows: tables[name] || [],
        select() { return q; },
        eq(col, val) { q._rows = q._rows.filter((r) => r[col] === val); return q; },
        in(col, vals) { q._rows = q._rows.filter((r) => vals.includes(r[col])); return q; },
        // PostgREST's IS: a column the row does not carry reads as NULL.
        is(col, val) {
          q._rows = q._rows.filter((r) => (r[col] === undefined ? null : r[col]) === val);
          return q;
        },
        maybeSingle() { q._single = true; return q; },
        then(res) { return res({ data: q._single ? (q._rows[0] || null) : q._rows, error: null }); },
      };
      return q;
    },
  };
}

const RETIRED_AT = '2026-11-08T10:00:00.000Z';

const TABLES = () => ({
  leader_schools: [{ leader_user_id: 'c1', school_ext_id: 'niete:409', school_id: 's409' }],
  schools: [{ id: 's409', name: 'IMSB (VI-X), Rawal Dam', emis: '409' }],
  users: [
    {
      id: 'u1', phone_number: '923001111111', name: 'Tahira', role: 'teacher',
      school_id: 's409', teacher_level: ['PRIMARY'], deleted_at: null,
    },
    // Tahira's old account, retired when her number moved onto u1.
    {
      id: 'u9', phone_number: 'merged:u1', name: 'Tahira', role: 'teacher',
      school_id: 's409', teacher_level: ['PRIMARY'], deleted_at: RETIRED_AT,
    },
    // No deleted_at on the row at all: live.
    {
      id: 'u2', phone_number: '923002222222', name: 'Nasir', role: 'principal',
      school_id: 's409', teacher_level: [],
    },
  ],
});

describe('the /observe picker (bot, Supabase path)', () => {
  it('lists the teacher once, without her retired account beside her', async () => {
    const out = await listPatchViaSupabase(fakeSupabase(TABLES()), 'c1');
    expect(out.map((p) => p.userId).sort()).toEqual(['u1', 'u2']);
    expect(out.some((p) => String(p.phone || '').startsWith('merged:'))).toBe(false);
  });

  it('an account restored to live is back in the patch', async () => {
    const tables = TABLES();
    tables.users.find((u) => u.id === 'u9').deleted_at = null;
    const out = await listPatchViaSupabase(fakeSupabase(tables), 'c1');
    expect(out.map((p) => p.userId)).toContain('u9');
  });
});

describe('the principal app (bot, Supabase path): her own school', () => {
  // bd-33wxxi.4 added a sixth derivation: a principal on the principal app observes her own school's teachers.
  it("lists her school's teachers without a retired account", async () => {
    const tables = TABLES();
    tables.app_settings = [{ key: 'portal_principal_app', value: true }];
    tables.users.push({
      id: 'p1', phone_number: '923003333333', name: 'Principal', role: 'principal', school_id: 's409',
    });
    const out = await listPatchViaSupabase(fakeSupabase(tables), 'p1');
    expect(out.map((p) => p.userId).sort()).toEqual(['u1']);
  });
});

describe('every SQL derivation of a patch asks for live accounts only', () => {
  it('the pin reads the top level: a filter inside a LATERAL does not count', () => {
    const lateralOnly = `SELECT u.id FROM users u
      LEFT JOIN LATERAL (SELECT 1 FROM t WHERE t.user_id = u.id AND u.deleted_at IS NULL) l ON true
      WHERE u.school_id = $1`;
    expect(topLevel(lateralOnly)).not.toMatch(LIVE_ONLY);
    expect(topLevel(`${lateralOnly} AND u.deleted_at IS NULL`)).toMatch(LIVE_ONLY);
  });

  it.each([
    ['the bot\'s PATCH_SQL (listPatch)', BOT_PATCH_SQL],
    ['portal My Patch for a coach (PATCH_TEACHERS_SQL)', PATCH_TEACHERS_SQL],
    ['portal My Patch for a principal (PRINCIPAL_PATCH_SQL)', PRINCIPAL_PATCH_SQL],
  ])('%s', (_label, sql) => {
    expect(typeof sql).toBe('string');
    expect(topLevel(sql)).toMatch(LIVE_ONLY);
  });

  it('booking a visit on the portal checks the patch with live accounts only', async () => {
    const seen = [];
    const query = jest.fn(async (sql) => {
      seen.push(sql);
      return { rows: [] }; // nobody in the patch, so the booking is refused
    });
    await expect(createSchedule(query, 'c1', {
      schoolExtId: 'niete:409', teacherExtId: 'merged:u1', date: '2026-11-10', slot: '09:00',
    }, { today: '2026-11-09' })).rejects.toThrow(/patch/i);
    const patchLookup = seen.find((s) => /leader_schools/i.test(s));
    expect(patchLookup).toBeDefined();
    expect(topLevel(patchLookup)).toMatch(LIVE_ONLY);
  });
});
