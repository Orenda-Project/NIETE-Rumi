'use strict';
/**
 * Roster inheritance must refuse when one school_ext_id covers two schools.
 *
 * A coach's school is recorded as 'niete:' || <EMIS typed into the roster
 * sheet>. Two rows on production carry the wrong number, so one ext id has two
 * different schools under it:
 *
 *   niete:607   IMSB (I-V) Sang Jani        AND  IMSB (VI-X) Shah Allah Ditta
 *   niete:628   IMSB (I-VIII) Dhoke Paracha AND  IMSG (I-VIII) Dhoke Paracha
 *
 * Adding a school hands the coach the existing teacher list for that ext id
 * (`WHERE school_ext_id = $1`, nothing else). So the next coach to add 607 would
 * inherit 16 teachers belonging to two different schools, and for 628 a boys'
 * and a girls' school would pool. Nobody has triggered it, which is luck.
 *
 * Measured on production 2026-08-25: 2 ext ids whose holders disagree on the
 * name, 405 where they agree, 82 held by more than one coach. So inheritance is
 * a live path and the refusal must be narrow: it fires on the 2, never the 405.
 *
 * NOT solved with a UNIQUE index on the canonical name. At least ten register
 * names are shared by two genuinely different schools (IMSG (I-V) Sihala is 529
 * and 540; IMSB (I-V), MAL is 427 and 429; Taleemabad is 1 and 98000), so such
 * an index would pass today and wrongly block a real assignment later.
 *
 * The rule pinned here: if the coaches holding an ext id disagree on what school
 * it is, inherit nothing and say so. Both copies of roster inheritance must
 * carry it. They have already drifted apart once, which is why the last test
 * checks both files rather than just the behaviour of one.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// ── bot copy ────────────────────────────────────────────────────────────────
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(),
  getCurrentCorrelationId: () => null,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const admin = require('../../bot/shared/services/observe/observe-school-admin.service');

/** leader_schools rows the mock will serve for a given ext id. */
function serveLeaderSchools(rows) {
  mockSupabase.from.mockImplementation((table) => {
    if (table !== 'leader_schools') {
      const q = { select: jest.fn(() => q), eq: jest.fn(() => q), limit: jest.fn(() => q),
                  then: (r) => r({ data: [], error: null }) };
      return q;
    }
    const state = {};
    const q = {
      select: jest.fn(() => q),
      eq: jest.fn((col, val) => { state[col] = val; return q; }),
      limit: jest.fn(() => q),
      then: (resolve) => {
        const data = state.school_ext_id === undefined
          ? rows
          : rows.filter((r) => r.school_ext_id === state.school_ext_id);
        resolve({ data, error: null });
      },
    };
    return q;
  });
}

beforeEach(() => { mockSupabase.from.mockReset(); });

describe('canonicalSchoolName', () => {
  it('ignores case, spacing and punctuation, so a double space is not a second school', () => {
    const c = admin.canonicalSchoolName;
    expect(c('IMCG(VI-XII)  Herdogher')).toBe(c('IMCG(VI-XII) Herdogher'));
    expect(c('IMSB (I-V), MAL')).toBe(c('imsb  (i-v) mal'));
  });

  it('keeps genuinely different schools apart', () => {
    const c = admin.canonicalSchoolName;
    expect(c('IMSB (I-V) Sang Jani')).not.toBe(c('IMSB (VI-X) Shah Allah Ditta'));
    // boys vs girls is one letter, and it is the whole difference
    expect(c('IMSB (I-VIII) Dhoke Paracha')).not.toBe(c('IMSG (I-VIII) Dhoke Paracha'));
  });

  it('is null-safe rather than throwing on a missing name', () => {
    expect(admin.canonicalSchoolName(null)).toBe('');
    expect(admin.canonicalSchoolName(undefined)).toBe('');
  });
});

describe('extIdIsAmbiguous (bot copy)', () => {
  it('is TRUE when the holders disagree, using the real niete:607 shape', async () => {
    serveLeaderSchools([
      { school_ext_id: 'niete:607', school_name: 'IMSB (I-V) Sang Jani' },
      { school_ext_id: 'niete:607', school_name: 'IMSB (VI-X) Shah Allah Ditta' },
    ]);
    await expect(admin.extIdIsAmbiguous('niete:607')).resolves.toBe(true);
  });

  it('is TRUE for the boys/girls pair at niete:628', async () => {
    serveLeaderSchools([
      { school_ext_id: 'niete:628', school_name: 'IMSB (I-VIII) Dhoke Paracha' },
      { school_ext_id: 'niete:628', school_name: 'IMSG (I-VIII) Dhoke Paracha' },
    ]);
    await expect(admin.extIdIsAmbiguous('niete:628')).resolves.toBe(true);
  });

  it('is FALSE when several coaches hold it and agree, which is the normal case', async () => {
    serveLeaderSchools([
      { school_ext_id: 'niete:722', school_name: 'IMSG(I-VIII) KH. DAK' },
      { school_ext_id: 'niete:722', school_name: 'IMSG(I-VIII) KH. DAK' },
      { school_ext_id: 'niete:722', school_name: 'IMSG(I-VIII)  KH.  DAK' },
    ]);
    await expect(admin.extIdIsAmbiguous('niete:722')).resolves.toBe(false);
  });

  it('is FALSE for a single holder', async () => {
    serveLeaderSchools([{ school_ext_id: 'niete:632', school_name: 'IMSB (I-V) Sang Jani' }]);
    await expect(admin.extIdIsAmbiguous('niete:632')).resolves.toBe(false);
  });

  it('fails CLOSED on a query error: refuse rather than risk pooling', async () => {
    mockSupabase.from.mockImplementation(() => {
      const q = { select: jest.fn(() => q), eq: jest.fn(() => q), limit: jest.fn(() => q),
                  then: (r) => r({ data: null, error: { message: 'boom' } }) };
      return q;
    });
    await expect(admin.extIdIsAmbiguous('niete:607')).resolves.toBe(true);
  });
});

// ── dashboard copy ──────────────────────────────────────────────────────────
const { addSchool } = require('../../dashboard/services/leader-assignment.service');

/**
 * Fake `query`. Dispatches on the SQL so the ambiguity probe can be driven
 * independently of the roster read.
 */
function makeQuery({ ambiguousNames = 1, roster = [] } = {}) {
  const writes = [];
  const q = jest.fn(async (sql) => {
    // Match on the probe's own alias. ROSTER_SQL also carries a count(DISTINCT …)
    // subquery as belt-and-braces, so matching on that would misroute it here.
    if (/\bas\s+names\b/is.test(sql)) return { rows: [{ names: ambiguousNames }] };
    if (/distinct\s+on/is.test(sql) && /leader_teachers/is.test(sql)) return { rows: roster };
    if (/from\s+schools/is.test(sql)) {
      return { rows: [{ school_ext_id: 'niete:607', school_name: 'IMSB (VI-X) Shah Allah Ditta', emis: '607' }] };
    }
    if (/select\s+school_ext_id\s+from\s+leader_schools/is.test(sql)) return { rows: [] };
    if (/count\s*\(\s*\*\s*\)\s+as\s+n\s+from\s+leader_teachers/is.test(sql)) return { rows: [{ n: 0 }] };
    if (/distinct\s+on/is.test(sql) && /leader_teachers/is.test(sql)) return { rows: roster };
    if (/^\s*insert/is.test(sql)) { writes.push(sql); return { rows: [{ id: 'x' }] }; }
    return { rows: [] };
  });
  q.writes = writes;
  return q;
}

describe('addSchool (dashboard copy)', () => {
  const ROSTER = [
    { teacher_ext_id: '1', teacher_name: 'A', teacher_phone_e164: '921', level: 'PRIMARY' },
    { teacher_ext_id: '2', teacher_name: 'B', teacher_phone_e164: '922', level: 'HIGH' },
  ];

  it('inherits the roster when the ext id is unambiguous', async () => {
    const q = makeQuery({ ambiguousNames: 1, roster: ROSTER });
    const out = await addSchool(q, 'leader-1', 'niete:607');
    expect(out.teachersMapped).toBe(2);
    expect(q.writes.filter((s) => /insert\s+into\s+leader_teachers/is.test(s))).toHaveLength(2);
  });

  it('inherits NOTHING when the holders disagree on the school', async () => {
    const q = makeQuery({ ambiguousNames: 2, roster: ROSTER });
    const out = await addSchool(q, 'leader-1', 'niete:607');
    expect(out.teachersMapped).toBe(0);
    expect(q.writes.filter((s) => /insert\s+into\s+leader_teachers/is.test(s))).toHaveLength(0);
  });

  it('says why, instead of looking like a school with no teachers', async () => {
    const q = makeQuery({ ambiguousNames: 2, roster: ROSTER });
    const out = await addSchool(q, 'leader-1', 'niete:607');
    expect(out.ambiguousExtId).toBe(true);
    expect(String(out.warning)).toMatch(/more than one school|two schools|different school/i);
  });

  it('still adds the school itself, so the coach is not silently refused', async () => {
    const q = makeQuery({ ambiguousNames: 2, roster: ROSTER });
    await addSchool(q, 'leader-1', 'niete:607');
    expect(q.writes.filter((s) => /insert\s+into\s+leader_schools/is.test(s))).toHaveLength(1);
  });
});

// ── the drift guard ─────────────────────────────────────────────────────────
describe('both copies carry the rule', () => {
  const FILES = [
    'bot/shared/services/observe/observe-school-admin.service.js',
    'dashboard/services/leader-assignment.service.js',
  ];

  // Comments are stripped first. A source-level assertion that matches the
  // comment above the code would pass with the feature deleted, which has
  // happened five times in this repo.
  const codeOf = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '');

  it.each(FILES)('%s guards roster inheritance on canonical-name agreement', (rel) => {
    const code = codeOf(rel);
    expect(code).toMatch(/REGEXP_REPLACE|canonicalSchoolName/);
    expect(code).toMatch(/ambiguous/i);
  });

  it('neither copy still inherits on school_ext_id alone with no guard nearby', () => {
    for (const rel of FILES) {
      const code = codeOf(rel);
      // the roster read must sit within reach of the guard, not on its own
      const hasGuard = /ambiguous/i.test(code);
      expect(hasGuard).toBe(true);
    }
  });
});
