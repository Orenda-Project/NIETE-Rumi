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

/**
 * Serves both register tables, so the teacher-overlap question can be driven.
 * Filters on whatever `.eq()` the caller applied, which is how the guard reaches
 * one ext id's rows.
 */
function serveRegister({ schools = [], teachers = [], teachersError = null } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    const state = {};
    const rows = table === 'leader_schools' ? schools
      : table === 'leader_teachers' ? teachers
        : [];
    const q = {
      select: jest.fn(() => q),
      eq: jest.fn((col, val) => { state[col] = val; return q; }),
      limit: jest.fn(() => q),
      then: (resolve) => {
        if (table === 'leader_teachers' && teachersError) {
          return resolve({ data: null, error: teachersError });
        }
        let out = rows;
        for (const [col, val] of Object.entries(state)) out = out.filter((r) => r[col] === val);
        return resolve({ data: out, error: null });
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

/**
 * Disagreeing names are not enough to refuse.
 *
 * Production 2026-08-26, after the duplicate merge: exactly one ext id has
 * holders who disagree, niete:427, held as 'IMSB (I-V), MAL' by one coach and
 * 'IMSB (I-V), MALOT' by another. Both rosters are the SAME seven teachers. It
 * is one school typed two ways, so refusing inheritance there costs a coach a
 * manual re-entry and teaches them the guard is wrong.
 *
 * Teachers settle it. Two spellings that share a teacher are one school; two
 * spellings with disjoint rosters are two schools sharing a number, which is the
 * bug. No shared teacher and no evidence either way still refuses.
 */
describe('extIdIsAmbiguous: one school spelled two ways', () => {
  const at427 = (leader, phone) => ({ school_ext_id: 'niete:427', leader_user_id: leader, teacher_phone_e164: phone });

  it('is FALSE when the two spellings share their roster, the real niete:427 shape', async () => {
    serveRegister({
      schools: [
        { school_ext_id: 'niete:427', school_name: 'IMSB (I-V), MAL', leader_user_id: 'coach-a' },
        { school_ext_id: 'niete:427', school_name: 'IMSB (I-V), MALOT', leader_user_id: 'coach-b' },
      ],
      teachers: [at427('coach-a', 'p1'), at427('coach-a', 'p2'),
        at427('coach-b', 'p1'), at427('coach-b', 'p2')],
    });
    await expect(admin.extIdIsAmbiguous('niete:427')).resolves.toBe(false);
  });

  it('is FALSE on a partial overlap: one shared teacher is one school', async () => {
    serveRegister({
      schools: [
        { school_ext_id: 'niete:427', school_name: 'IMSB (I-V), MAL', leader_user_id: 'coach-a' },
        { school_ext_id: 'niete:427', school_name: 'IMSB (I-V), MALOT', leader_user_id: 'coach-b' },
      ],
      teachers: [at427('coach-a', 'p1'), at427('coach-a', 'p2'), at427('coach-b', 'p2')],
    });
    await expect(admin.extIdIsAmbiguous('niete:427')).resolves.toBe(false);
  });

  it('stays TRUE when the two spellings share NO teacher, which is the niete:607 bug', async () => {
    serveRegister({
      schools: [
        { school_ext_id: 'niete:607', school_name: 'IMSB (I-V) Sang Jani', leader_user_id: 'coach-a' },
        { school_ext_id: 'niete:607', school_name: 'IMSB (VI-X) Shah Allah Ditta', leader_user_id: 'coach-b' },
      ],
      teachers: [at427('coach-a', 'p1'), at427('coach-b', 'p9')].map(
        (r) => ({ ...r, school_ext_id: 'niete:607' }),
      ),
    });
    await expect(admin.extIdIsAmbiguous('niete:607')).resolves.toBe(true);
  });

  it('stays TRUE when a spelling has no teachers: absence of evidence is not agreement', async () => {
    serveRegister({
      schools: [
        { school_ext_id: 'niete:607', school_name: 'IMSB (I-V) Sang Jani', leader_user_id: 'coach-a' },
        { school_ext_id: 'niete:607', school_name: 'IMSB (VI-X) Shah Allah Ditta', leader_user_id: 'coach-b' },
      ],
      teachers: [{ school_ext_id: 'niete:607', leader_user_id: 'coach-a', teacher_phone_e164: 'p1' }],
    });
    await expect(admin.extIdIsAmbiguous('niete:607')).resolves.toBe(true);
  });

  it('is TRUE when a third spelling is disjoint, even though two of them agree', async () => {
    serveRegister({
      schools: [
        { school_ext_id: 'niete:427', school_name: 'IMSB (I-V), MAL', leader_user_id: 'coach-a' },
        { school_ext_id: 'niete:427', school_name: 'IMSB (I-V), MALOT', leader_user_id: 'coach-b' },
        { school_ext_id: 'niete:427', school_name: 'IMSG (VI-X) Somewhere Else', leader_user_id: 'coach-c' },
      ],
      teachers: [at427('coach-a', 'p1'), at427('coach-b', 'p1'), at427('coach-c', 'p9')],
    });
    await expect(admin.extIdIsAmbiguous('niete:427')).resolves.toBe(true);
  });

  it('fails CLOSED when the teacher lookup errors', async () => {
    serveRegister({
      schools: [
        { school_ext_id: 'niete:427', school_name: 'IMSB (I-V), MAL', leader_user_id: 'coach-a' },
        { school_ext_id: 'niete:427', school_name: 'IMSB (I-V), MALOT', leader_user_id: 'coach-b' },
      ],
      teachers: [at427('coach-a', 'p1'), at427('coach-b', 'p1')],
      teachersError: { message: 'boom' },
    });
    await expect(admin.extIdIsAmbiguous('niete:427')).resolves.toBe(true);
  });

  it('does not go looking for teachers when the names already agree', async () => {
    serveRegister({
      schools: [
        { school_ext_id: 'niete:722', school_name: 'IMSG(I-VIII) KH. DAK', leader_user_id: 'coach-a' },
        { school_ext_id: 'niete:722', school_name: 'IMSG(I-VIII)  KH.  DAK', leader_user_id: 'coach-b' },
      ],
      teachers: [],
      teachersError: { message: 'must not be reached' },
    });
    await expect(admin.extIdIsAmbiguous('niete:722')).resolves.toBe(false);
  });
});

/**
 * The helper being correct is not the same as it being wired in. Deleting the
 * CALL from addSchoolForCoach while keeping the definition left every other test
 * in this file green, so this drives the whole function.
 */
describe('addSchoolForCoach (bot copy) is actually gated', () => {
  /**
   * Full supabase double. `names` drives whether the spellings disagree, and
   * `probeTeachers` (rows carrying leader_user_id) drives whether they overlap.
   * Both leader_teachers selects mention teacher_phone_e164, so they are told
   * apart by leader_user_id, which only the probe asks for. Default is no shared
   * teachers, i.e. two genuinely different schools.
   */
  function serveAll({ names, roster, probeTeachers = [] }) {
    const inserted = { leader_schools: [], leader_teachers: [] };
    mockSupabase.from.mockImplementation((table) => {
      const st = { sel: null, cols: {} };
      const q = {
        select: jest.fn((cols) => { st.sel = String(cols || ''); return q; }),
        eq: jest.fn((c, v) => { st.cols[c] = v; return q; }),
        limit: jest.fn(() => q),
        insert: jest.fn((rows) => {
          inserted[table].push(...(Array.isArray(rows) ? rows : [rows]));
          return { then: (r) => r({ data: null, error: null }) };
        }),
        then: (resolve) => {
          if (table === 'schools') {
            return resolve({ data: [{ name: 'IMSB (VI-X) Shah Allah Ditta', emis: '607' }], error: null });
          }
          if (table === 'leader_schools') {
            // the ambiguity probe selects school_name and filters on ext id only
            if (/school_name/.test(st.sel) && st.cols.leader_user_id === undefined) {
              const rows = names.map((n, i) => ({ school_name: n, leader_user_id: `coach-${i}` }));
              return resolve({ data: rows, error: null });
            }
            return resolve({ data: [], error: null });   // "is it already mine" -> no
          }
          if (table === 'leader_teachers') {
            // the probe asks for leader_user_id; the roster read never does
            if (/leader_user_id/.test(st.sel) && /teacher_phone_e164/.test(st.sel)) {
              return resolve({ data: probeTeachers, error: null });
            }
            if (/teacher_phone_e164/.test(st.sel)) return resolve({ data: roster, error: null });
            return resolve({ data: [], error: null, count: 0 });
          }
          return resolve({ data: [], error: null });
        },
      };
      return q;
    });
    return inserted;
  }

  const ROSTER = [
    { teacher_ext_id: '1', teacher_name: 'A', teacher_phone_e164: '921', teacher_phone: null, level: 'PRIMARY' },
    { teacher_ext_id: '2', teacher_name: 'B', teacher_phone_e164: '922', teacher_phone: null, level: 'HIGH' },
  ];

  it('maps the roster when the ext id is unambiguous', async () => {
    const ins = serveAll({ names: ['IMSB (VI-X) Shah Allah Ditta'], roster: ROSTER });
    const out = await admin.addSchoolForCoach('leader-1', 'niete:607');
    expect(out.ambiguousExtId).toBe(false);
    expect(ins.leader_teachers).toHaveLength(2);
  });

  it('maps NOBODY when the holders disagree, and flags why', async () => {
    const ins = serveAll({
      names: ['IMSB (I-V) Sang Jani', 'IMSB (VI-X) Shah Allah Ditta'],
      roster: ROSTER,
    });
    const out = await admin.addSchoolForCoach('leader-1', 'niete:607');
    expect(out.ambiguousExtId).toBe(true);
    expect(out.teachersMapped).toBe(0);
    expect(ins.leader_teachers).toHaveLength(0);
  });

  it('still records the school itself, so the coach is not silently refused', async () => {
    const ins = serveAll({
      names: ['IMSB (I-V) Sang Jani', 'IMSB (VI-X) Shah Allah Ditta'],
      roster: ROSTER,
    });
    await admin.addSchoolForCoach('leader-1', 'niete:607');
    expect(ins.leader_schools).toHaveLength(1);
  });

  /**
   * End to end for the niete:427 shape: the names disagree, the rosters are the
   * same people, so it is one school and the coach SHOULD inherit. Without the
   * overlap condition this returns 0 teachers and ambiguousExtId true.
   */
  it('maps the roster when the spellings disagree but the teachers are shared', async () => {
    const ins = serveAll({
      names: ['IMSB (I-V), MAL', 'IMSB (I-V), MALOT'],
      roster: ROSTER,
      probeTeachers: [
        { leader_user_id: 'coach-0', teacher_phone_e164: '921' },
        { leader_user_id: 'coach-1', teacher_phone_e164: '921' },
      ],
    });
    const out = await admin.addSchoolForCoach('leader-1', 'niete:427');
    expect(out.ambiguousExtId).toBe(false);
    expect(ins.leader_teachers).toHaveLength(2);
  });

  it('still maps NOBODY when the spellings disagree and share no teacher', async () => {
    const ins = serveAll({
      names: ['IMSB (I-V) Sang Jani', 'IMSB (VI-X) Shah Allah Ditta'],
      roster: ROSTER,
      probeTeachers: [
        { leader_user_id: 'coach-0', teacher_phone_e164: '921' },
        { leader_user_id: 'coach-1', teacher_phone_e164: '999' },
      ],
    });
    const out = await admin.addSchoolForCoach('leader-1', 'niete:607');
    expect(out.ambiguousExtId).toBe(true);
    expect(ins.leader_teachers).toHaveLength(0);
  });
});

// ── dashboard copy ──────────────────────────────────────────────────────────
const { addSchool } = require('../../dashboard/services/leader-assignment.service');

/**
 * Fake `query`. Dispatches on the SQL so the ambiguity probe can be driven
 * independently of the roster read.
 */
function makeQuery({ disjointPairs = 0, roster = [] } = {}) {
  const writes = [];
  const q = jest.fn(async (sql) => {
    // Match on the probe's own alias. ROSTER_SQL repeats the same test as a
    // NOT EXISTS subquery, so matching on its body would misroute it here.
    if (/\bas\s+disjoint_pairs\b/is.test(sql)) return { rows: [{ disjoint_pairs: disjointPairs }] };
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
    const q = makeQuery({ disjointPairs: 0, roster: ROSTER });
    const out = await addSchool(q, 'leader-1', 'niete:607');
    expect(out.teachersMapped).toBe(2);
    expect(q.writes.filter((s) => /insert\s+into\s+leader_teachers/is.test(s))).toHaveLength(2);
  });

  it('inherits NOTHING when the holders disagree on the school', async () => {
    const q = makeQuery({ disjointPairs: 1, roster: ROSTER });
    const out = await addSchool(q, 'leader-1', 'niete:607');
    expect(out.teachersMapped).toBe(0);
    expect(q.writes.filter((s) => /insert\s+into\s+leader_teachers/is.test(s))).toHaveLength(0);
  });

  it('says why, instead of looking like a school with no teachers', async () => {
    const q = makeQuery({ disjointPairs: 1, roster: ROSTER });
    const out = await addSchool(q, 'leader-1', 'niete:607');
    expect(out.ambiguousExtId).toBe(true);
    expect(String(out.warning)).toMatch(/more than one school|two schools|different school/i);
  });

  it('still adds the school itself, so the coach is not silently refused', async () => {
    const q = makeQuery({ disjointPairs: 1, roster: ROSTER });
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

  /**
   * ROSTER_SQL repeats the test as a subquery so a future caller cannot reach
   * that statement without it. Nothing else exercises that layer, because the JS
   * gate short-circuits first, so pin the text or the belt-and-braces can be
   * deleted silently. Verified by mutation: removing the subquery turns this red.
   */
  it('the dashboard ROSTER_SQL carries the guard as a subquery, not just in JS', () => {
    const code = codeOf('dashboard/services/leader-assignment.service.js');
    const roster = /const ROSTER_SQL = `([\s\S]*?)`;/.exec(code);
    expect(roster).not.toBeNull();
    const sql = roster[1];
    expect(sql).toMatch(/leader_schools/);
    expect(sql).toMatch(/REGEXP_REPLACE/i);
    expect(sql).toMatch(/NOT\s+EXISTS/i);
    // and it must compare the spellings by teacher, not just count names
    expect(sql).toMatch(/teacher_phone_e164/);
  });

  /**
   * Both copies must ask the teacher question, not just the name question. The
   * name-only version refuses niete:427, which is one school spelled two ways.
   */
  it.each(FILES)('%s decides on shared teachers, not names alone', (rel) => {
    const code = codeOf(rel);
    expect(code).toMatch(/teacher_phone_e164/);
    expect(code).toMatch(/leader_teachers/);
  });

  /**
   * And the bot copy must CALL the helper, not merely define it. Deleting the
   * call left all fifteen earlier tests green, which is exactly the "would pass
   * with the feature deleted" failure this repo has hit five times.
   */
  it('the bot copy calls extIdIsAmbiguous, it does not just define it', () => {
    const code = codeOf('bot/shared/services/observe/observe-school-admin.service.js');
    const defs = (code.match(/function\s+extIdIsAmbiguous/g) || []).length;
    const calls = (code.match(/await\s+extIdIsAmbiguous\s*\(/g) || []).length;
    expect(defs).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
