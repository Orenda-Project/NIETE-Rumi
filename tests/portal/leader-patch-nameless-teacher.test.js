'use strict';
/**
 * THE COACH'S "MY PATCH" LIST MUST NOT CONTAIN A BLANK PERSON.
 *
 * Reported by a coach: a teacher's observations were "not showing in the data".
 * Both sessions existed and both reports were delivered. What was missing was
 * her NAME. Her `users.first_name` is an EMPTY STRING, and this resolver did
 *
 *     u.first_name AS teacher_name   →   name: r.teacher_name || null
 *
 * so she reached the coach's school-scoped patch list as a row with no name at
 * all. Her counts were right; there was nothing on the row to recognise her by,
 * which reads exactly like "she is not in the data".
 *
 * Measured on prod 2026-09-07: `first_name = ''` on 210 rows, 57 of them
 * role='teacher' with a school — i.e. inside somebody's patch. (A further 2,679
 * of 10,369 have `first_name IS NULL`: same blank row, different cause, and
 * covered by the same chain.)
 *
 * Two rules the fix has to respect:
 *
 *   · `first_name || ' ' || last_name` is the WRONG fix and is deliberately not
 *     what happens. Measured over all 9,362 NIETE teachers+principals,
 *     `users.name` is populated 7,912 times against 4,304 for `last_name`, and
 *     2,531 people have a one-word first_name beside a multi-word `name`. The
 *     chain leads with `name`. That reasoning lives beside `fullNameOf` in
 *     bot/shared/services/observe/patch-resolver.service.js, and this resolver
 *     now calls THAT function rather than growing a second copy of it.
 *
 *   · A name is never invented. When nothing resolves, the row carries a
 *     LABEL — role plus the last four digits of the number the coach already
 *     has (this very payload already ships `phone` in full) — and says so via
 *     `hasName: false`.
 *
 * `getPatchTeachers` takes an injected `query(sql, params)`, so the real
 * resolver runs here against a fake at the database boundary.
 */

const { getPatchTeachers, PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

/** The reported row: first_name '', a last name, no `name`. */
const NAMELESS = {
  teacher_ext_id: '923495021455',
  first_name: '',
  last_name: null,
  name: null,
  phone: '923495021455',
  role: 'teacher',
  rumi_user_id: 'u-nameless',
  coaching_sessions: '2',
  observations: '1',
  lesson_plans: '4',
  last_analysis_data: null,
  last_session_at: '2026-08-28T06:00:00Z',
  school_name: 'IMSG (I-V) Humak',
  school_ext_id: 'niete:1234',
};

/** The measured majority: a multi-word `name` beside a one-word first_name. */
const NAMED = {
  teacher_ext_id: '923001234567',
  first_name: 'Irene',
  last_name: null,
  name: 'Irene Khan',
  phone: '923001234567',
  role: 'teacher',
  rumi_user_id: 'u-named',
  coaching_sessions: '1',
  observations: '0',
  lesson_plans: '0',
  last_analysis_data: null,
  last_session_at: null,
  school_name: 'IMSG (I-V) Humak',
  school_ext_id: 'niete:1234',
};

/** first + last, no `name` — the 26 rows for which concatenation is needed. */
const FIRST_LAST = {
  ...NAMED, teacher_ext_id: '923007777777', phone: '923007777777',
  rumi_user_id: 'u-fl', first_name: 'Asad', last_name: 'Amanat Ali', name: null,
};

/** A principal with nothing at all — the label must say which role. */
const NAMELESS_PRINCIPAL = {
  ...NAMELESS, teacher_ext_id: '923338889999', phone: '923338889999',
  rumi_user_id: 'u-principal', role: 'principal', last_name: null,
};

function fakeQuery(rows) {
  const calls = [];
  const fn = async (sql, params) => { calls.push({ sql, params }); return { rows }; };
  fn.calls = calls;
  return fn;
}

const byId = (list, id) => list.find((t) => t.rumiUserId === id);

describe('the SQL hands JS everything the name chain needs', () => {
  test('it selects name and last_name, not first_name alone', () => {
    expect(PATCH_TEACHERS_SQL).toMatch(/u\.last_name/);
    expect(PATCH_TEACHERS_SQL).toMatch(/u\.name/);
    expect(PATCH_TEACHERS_SQL).not.toMatch(/u\.first_name\s+AS\s+teacher_name/i);
  });
});

describe('a teacher with no first name is still findable', () => {
  test('her row carries a readable, identifying label — never a blank', async () => {
    const out = await getPatchTeachers(fakeQuery([NAMELESS]), 'coach-1');
    const her = byId(out, 'u-nameless');
    expect(her).toBeDefined();
    expect(typeof her.name).toBe('string');
    expect(her.name.trim()).not.toBe('');
    expect(her.name).toContain('1455');       // the tail of her own number
    expect(her.name).toMatch(/teacher/i);     // reads as a label, not as a name
  });

  test('the row says plainly that this is not her real name', async () => {
    const out = await getPatchTeachers(fakeQuery([NAMELESS, NAMED]), 'coach-1');
    expect(byId(out, 'u-nameless').hasName).toBe(false);
    expect(byId(out, 'u-named').hasName).toBe(true);
  });

  test('the label names the ROLE, so a principal is not mistaken for a teacher', async () => {
    const out = await getPatchTeachers(fakeQuery([NAMELESS_PRINCIPAL]), 'coach-1');
    expect(byId(out, 'u-principal').name).toMatch(/principal/i);
  });

  test('no name is invented, and the whole number is never used as one', async () => {
    const out = await getPatchTeachers(fakeQuery([NAMELESS]), 'coach-1');
    const her = byId(out, 'u-nameless');
    expect(her.name).not.toContain('923495021455');
    expect(her.name).not.toMatch(/samia|maqsood/i);
  });
});

describe('the measured chain is preserved, not replaced', () => {
  test('users.name leads — a one-word first_name never beats a multi-word name', async () => {
    const out = await getPatchTeachers(fakeQuery([NAMED]), 'coach-1');
    expect(byId(out, 'u-named').name).toBe('Irene Khan');
    expect(byId(out, 'u-named').hasName).toBe(true);
  });

  test('first + last is still the fallback when there is no name column', async () => {
    const out = await getPatchTeachers(fakeQuery([FIRST_LAST]), 'coach-1');
    expect(byId(out, 'u-fl').name).toBe('Asad Amanat Ali');
    expect(byId(out, 'u-fl').hasName).toBe(true);
  });

  test('everything else on the row is untouched', async () => {
    const out = await getPatchTeachers(fakeQuery([NAMELESS]), 'coach-1');
    const her = byId(out, 'u-nameless');
    expect(her.onRumi).toBe(true);
    expect(her.coachingSessions).toBe(2);
    expect(her.observations).toBe(1);
    expect(her.lessonPlans).toBe(4);
    expect(her.phone).toBe('923495021455');
    expect(her.schoolName).toBe('IMSG (I-V) Humak');
    expect(her.emis).toBe('1234');
    expect(her.isPrincipal).toBe(false);
  });
});
