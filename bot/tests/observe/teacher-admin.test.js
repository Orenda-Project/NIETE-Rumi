/**
 * Coaches add and remove individual TEACHERS at a school (TDD, red-first).
 *
 * Operator, 2026-08-28:
 *   · the coach types a NUMBER; we match it. If she exists we say so; if not we
 *     add her. If she is at a different school we REPLACE that school for her —
 *     "and be loud and clear to the coach what we are about to do".
 *   · removing a teacher takes her off that school, but her account and her
 *     history remain, and she may be added to another school later.
 *
 * Live shape this is written against (queried against NIETE prod
 * `ihzciabopbttygxxgrkm` on 2026-08-28, not assumed):
 *   · `leader_teachers` (8,095 rows / 401 schools / 71 coaches) is a per-COACH
 *     assignment table — one row means "coach C observes teacher T at school S".
 *     1,155 (school,teacher) pairs are held by more than one coach, so removing
 *     a teacher from a school is N rows, never one.
 *   · 6,607 distinct phones; 6,604 resolve to a `users` row, so phone is a
 *     near-perfect identity key — but NOT a unique one in this table: 2 phones
 *     carry more than one `teacher_ext_id` (one is the operator's own number
 *     holding 5 `name:test-*` teachers). A phone lookup returning N > 1 is a
 *     LIVE state and must never silently pick one.
 *   · 92 teachers are already held at TWO schools at once (max 2). Those
 *     violate the one-school rule before we start, so the classifier has to
 *     name the ambiguity rather than guess which school she is "really" at.
 *   · `users.school_id` -> `schools.id` (94% populated) is the school truth;
 *     `leader_teachers.school_ext_id` is the coach's view. They disagree on 230
 *     rows, which is what a move is for.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  normaliseTeacherPhone,
  classifyAdd,
  movePlanAck,
  removedTeacherAck,
} = require('../../shared/services/observe/observe-teacher-admin.service');

// ── the number the coach types ─────────────────────────────────────────

describe('normaliseTeacherPhone · one canonical identity from whatever she types', () => {
  it('accepts the four shapes a PK coach actually types', () => {
    for (const raw of ['03001234567', '3001234567', '923001234567', '+92 300 1234567']) {
      expect(normaliseTeacherPhone(raw)).toBe('923001234567');
    }
  });

  it('survives punctuation — dashes, spaces, brackets', () => {
    for (const raw of ['92-300-123-4567', '0300 123 4567', '(0300) 1234567']) {
      expect(normaliseTeacherPhone(raw)).toBe('923001234567');
    }
  });

  it('strips a 00 international prefix rather than reading it as digits', () => {
    expect(normaliseTeacherPhone('00923001234567')).toBe('923001234567');
  });

  it('is idempotent — a value already normalised comes back unchanged', () => {
    expect(normaliseTeacherPhone(normaliseTeacherPhone('03001234567'))).toBe('923001234567');
  });

  it('refuses what is not a PK mobile rather than inventing one', () => {
    // A landline, a truncated entry, junk, and empty. Guessing here is how a
    // teacher gets filed under a number that reaches nobody.
    for (const raw of ['', null, undefined, '   ', 'abcdefg', '12345', '9251111111', '92300123456789']) {
      expect(normaliseTeacherPhone(raw)).toBeNull();
    }
  });

  it('refuses the live malformed value that silently became a STRANGER\'s number', () => {
    // Prod carries `33355494779` in teacher_phone. The import's looser
    // normalisation turned it into 923335549477 — a dialable Pakistani mobile
    // belonging to someone who is not this teacher. Fail closed instead.
    expect(normaliseTeacherPhone('33355494779')).toBeNull();
  });
});

// ── what we are about to do ────────────────────────────────────────────

const T = (over = {}) => ({
  teacher_ext_id: '923001234567',
  teacher_name: 'Tahira Manzoor',
  teacher_phone_e164: '923001234567',
  school_ext_id: 'niete:273',
  school_name: 'IMS(I-V) No.2 G-10/2',
  leader_user_id: 'coach-a',
  ...over,
});

describe('classifyAdd · the decision the coach must be shown before it happens', () => {
  it('nobody on that number -> a brand new teacher', () => {
    const plan = classifyAdd({ existing: [], targetSchoolExtId: 'niete:916' });
    expect(plan.outcome).toBe('new');
  });

  it('already at this school -> a no-op, never a "moved from X to X"', () => {
    const plan = classifyAdd({ existing: [T()], targetSchoolExtId: 'niete:273' });
    expect(plan.outcome).toBe('already_here');
    expect(plan.fromSchoolExtId).toBeUndefined();
  });

  it('at one other school -> a MOVE, naming what she leaves', () => {
    const plan = classifyAdd({ existing: [T()], targetSchoolExtId: 'niete:916' });
    expect(plan.outcome).toBe('move');
    expect(plan.fromSchoolExtId).toBe('niete:273');
    expect(plan.fromSchoolName).toBe('IMS(I-V) No.2 G-10/2');
    expect(plan.teacherName).toBe('Tahira Manzoor');
  });

  it('counts every coach who loses her, because up to 4 hold one school', () => {
    const plan = classifyAdd({
      existing: [T(), T({ leader_user_id: 'coach-b' }), T({ leader_user_id: 'coach-c' })],
      targetSchoolExtId: 'niete:916',
    });
    expect(plan.outcome).toBe('move');
    expect(plan.coachesLosingHer).toBe(3);
  });

  it('already at this school under one coach, and elsewhere under another -> still a move', () => {
    // 92 teachers are live in exactly this shape. Being on the target school
    // already does NOT make the other school disappear.
    const plan = classifyAdd({
      existing: [T({ school_ext_id: 'niete:916' }), T({ leader_user_id: 'coach-b' })],
      targetSchoolExtId: 'niete:916',
    });
    expect(plan.outcome).toBe('move');
    expect(plan.fromSchoolExtId).toBe('niete:273');
  });

  it('REFUSES when one number carries two different people', () => {
    // Live: 923365709413 holds 5 `name:test-*` teachers. Picking one silently
    // would move a teacher nobody named.
    const plan = classifyAdd({
      existing: [T({ teacher_ext_id: 'name:ayesha', teacher_name: 'Ayesha Khan' }),
        T({ teacher_ext_id: 'name:bilal', teacher_name: 'Bilal Ahmed' })],
      targetSchoolExtId: 'niete:916',
    });
    expect(plan.outcome).toBe('ambiguous');
    expect(plan.candidates).toHaveLength(2);
  });

  it('one person spelled two ways is NOT ambiguous — same ext id, same phone', () => {
    // Live: 'Mehnaz Akhtar' / 'Mehnaz Akhter' across 3 coaches, one ext id.
    const plan = classifyAdd({
      existing: [T({ teacher_name: 'Mehnaz Akhtar' }),
        T({ teacher_name: 'Mehnaz Akhter', leader_user_id: 'coach-b' })],
      targetSchoolExtId: 'niete:916',
    });
    expect(plan.outcome).toBe('move');
  });
});

// ── "be loud and clear about what we are about to do" ──────────────────

describe('movePlanAck · the confirm the coach reads before anything is written', () => {
  const plan = {
    outcome: 'move',
    teacherName: 'Tahira Manzoor',
    phone: '923001234567',
    fromSchoolName: 'IMS(I-V) No.2 G-10/2',
    toSchoolName: 'IMCG, G-10/2',
    coachesLosingHer: 3,
  };

  it('names her, both schools, and the coaches who lose her', () => {
    const text = movePlanAck('en', plan);
    for (const bit of ['Tahira Manzoor', 'IMS(I-V) No.2 G-10/2', 'IMCG, G-10/2', '3']) {
      expect(text).toContain(bit);
    }
  });

  it('is written in Urdu for an Urdu coach, not English with Urdu chrome', () => {
    const text = movePlanAck('ur', plan);
    expect(text).toMatch(/[؀-ۿ]/);
    expect(text).toContain('Tahira Manzoor');   // her name is never translated
  });

  it('does not claim a move when she is already there', () => {
    const text = movePlanAck('en', { ...plan, outcome: 'already_here' });
    expect(text).not.toMatch(/mov(e|ing)/i);
  });
});

describe('removedTeacherAck · removal is from the SCHOOL, and says what survives', () => {
  it('says she is off the school and that her history is kept', () => {
    const text = removedTeacherAck('en', { teacherName: 'Tahira Manzoor', schoolName: 'IMCG, G-10/2' });
    expect(text).toContain('Tahira Manzoor');
    expect(text).toContain('IMCG, G-10/2');
    expect(text).toMatch(/history|record/i);
  });

  it('has an Urdu form', () => {
    expect(removedTeacherAck('ur', { teacherName: 'X', schoolName: 'Y' })).toMatch(/[؀-ۿ]/);
  });
});

// ── who already holds her is not the same question as where she is ─────

describe('classifyAdd · "at this school" and "on MY list" are different facts', () => {
  it('at the target school but under ANOTHER coach -> the caller still gains a row', () => {
    // 1,155 (school,teacher) pairs are co-held live, so this is the normal way
    // a second coach picks up a teacher. Treating it as a no-op would leave her
    // invisible to the coach who just asked for her.
    const plan = classifyAdd({
      existing: [T({ leader_user_id: 'coach-b' })],
      targetSchoolExtId: 'niete:273',
      actorLeaderUserId: 'coach-a',
    });
    expect(plan.outcome).toBe('already_here');
    expect(plan.callerHoldsHer).toBe(false);
  });

  it('at the target school under the caller herself -> genuinely nothing to do', () => {
    const plan = classifyAdd({
      existing: [T({ leader_user_id: 'coach-a' })],
      targetSchoolExtId: 'niete:273',
      actorLeaderUserId: 'coach-a',
    });
    expect(plan.outcome).toBe('already_here');
    expect(plan.callerHoldsHer).toBe(true);
  });

  it('a move also reports whether the caller already had her', () => {
    const plan = classifyAdd({
      existing: [T({ leader_user_id: 'coach-b' })],
      targetSchoolExtId: 'niete:916',
      actorLeaderUserId: 'coach-a',
    });
    expect(plan.outcome).toBe('move');
    expect(plan.callerHoldsHer).toBe(false);
  });
});

// ── number agreement, in both languages ────────────────────────────────

describe('removalPlanAck · a count of one does not read as a plural', () => {
  const { removalPlanAck } = require('../../shared/services/observe/observe-teacher-admin.service');
  const base = { teacherName: 'Tahira Manzoor', schoolName: 'IMCG, G-10/2', coachesAffected: 1 };

  it('English: 1 visit, 2 visits', () => {
    expect(removalPlanAck('en', { ...base, upcomingVisits: 1 })).toContain('1 visit already');
    expect(removalPlanAck('en', { ...base, upcomingVisits: 2 })).toContain('2 visits already');
  });

  it('Urdu uses the house word for a scheduled visit, not a transliteration', () => {
    // observe-strings calls one 'شیڈول شدہ مشاہدہ'. 'وزٹ' is a borrowing the
    // rest of the observe copy does not use.
    const t = removalPlanAck('ur', { ...base, upcomingVisits: 2 });
    expect(t).toContain('مشاہدے');
    expect(t).not.toContain('وزٹ');
  });

  it('Urdu singular is مشاہدہ, not the plural form', () => {
    const one = removalPlanAck('ur', { ...base, upcomingVisits: 1 });
    expect(one).toContain('1 مشاہدہ');
    expect(one).not.toContain('مشاہدے');
  });

  it('no visits booked -> the sentence is simply absent', () => {
    for (const l of ['en', 'ur']) {
      expect(removalPlanAck(l, { ...base, upcomingVisits: 0 })).not.toMatch(/مشاہد|visit/);
    }
  });
});
