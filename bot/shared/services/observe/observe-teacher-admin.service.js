/**
 * A coach adds or removes a teacher at one of her schools, from WhatsApp.
 *
 * On the derived model this is ONE write. A coach's people are
 * `leader_schools × users.school_id`, so putting a teacher on her list means
 * setting that teacher's school, and taking her off means clearing it. There is
 * no assignment row to create and none to tombstone.
 *
 * Operator, 2026-08-28: "when we add a new teacher by their phone number, just
 * let the coach know this already exists and you are adding them to xyz school.
 * That's fine." So the confirm names the person, where they are, and where they
 * are going — no coach-by-coach accounting.
 *
 * Two branches the old leader_teachers version needed and this one does not:
 *
 *   · The ambiguity refusal. `users.phone_number` is UNIQUE (9,634 rows, 9,634
 *     distinct on production), so one number is one person. The old "this
 *     number carries two teachers" case existed only because leader_teachers
 *     allowed duplicate phones.
 *   · Soft delete. Nothing is tombstoned; the previous school is preserved in
 *     `leader_roster_audit`, which is the history the tombstone stood in for.
 *
 * What it gains: an authorisation check. A coach may only add to, or remove
 * from, a school she actually holds — otherwise she could move any teacher in
 * the district into a school she has nothing to do with.
 */

const { clampLanguage } = require('../../config/ux-strings');

// ── the number the coach types ─────────────────────────────────────────

/**
 * One canonical identity from whatever she types.
 *
 * Fails CLOSED. Every PK mobile is 92 + 3XX + 7 digits; anything else returns
 * null rather than a guess, because a guessed number reaches a real person who
 * is not the teacher. Production carries `33355494779` in the old raw phone
 * column, which a looser normaliser turned into a stranger's dialable number.
 */
function normaliseTeacherPhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `92${d.slice(1)}`;
  else if (d.startsWith('3')) d = `92${d}`;
  return /^923\d{9}$/.test(d) ? d : null;
}

// ── the db port ────────────────────────────────────────────────────────

function _supabaseDb() {
  const supabase = require('../../config/supabase');
  return {
    /** The school, but ONLY if this coach holds it. Null is a refusal. */
    async myschool(leaderUserId, schoolExtId) {
      const { data: mine } = await supabase.from('leader_schools')
        .select('school_ext_id').eq('leader_user_id', leaderUserId)
        .eq('school_ext_id', schoolExtId).limit(1);
      if (!mine || !mine[0]) return null;
      const emis = String(schoolExtId).split(':').pop();
      const { data: s } = await supabase.from('schools').select('id, name, emis').eq('emis', emis).limit(1);
      if (!s || !s[0]) return null;
      return {
        school_ext_id: schoolExtId, school_id: s[0].id,
        school_name: s[0].name, emis: String(s[0].emis),
      };
    },

    async schoolOf(schoolId) {
      if (!schoolId) return null;
      const { data } = await supabase.from('schools').select('id, name, emis').eq('id', schoolId).limit(1);
      if (!data || !data[0]) return null;
      return {
        school_id: data[0].id, school_name: data[0].name,
        emis: String(data[0].emis), school_ext_id: `niete:${data[0].emis}`,
      };
    },

    async userByPhone(phone) {
      const { data } = await supabase.from('users')
        .select('id, phone_number, first_name, role, school_id').eq('phone_number', phone).limit(1);
      return (data && data[0]) || null;
    },

    async userById(userId) {
      if (!userId) return null;
      const { data } = await supabase.from('users')
        .select('id, phone_number, first_name, role, school_id').eq('id', userId).limit(1);
      return (data && data[0]) || null;
    },

    /**
     * The single write. An 'unregistered' person becomes a teacher, because a
     * coach putting someone on a school register is exactly that assertion; a
     * principal stays a principal.
     */
    async setUserSchool({ userId, schoolId, promoteToTeacher }) {
      const patch = { school_id: schoolId };
      if (promoteToTeacher) patch.role = 'teacher';
      const { error } = await supabase.from('users').update(patch).eq('id', userId);
      return !error;
    },

    async createTeacher({ phone, name, schoolId, role }) {
      const { data, error } = await supabase.from('users')
        .insert({ phone_number: phone, first_name: name, role: role || 'teacher', school_id: schoolId })
        .select('id').limit(1);
      if (error) throw new Error(`createTeacher: ${error.message}`);
      return (data && data[0]) || null;
    },

    /** Only 'upcoming'. A 'done' row IS the record of who was observed. */
    async cancelUpcoming({ schoolExtId, teacherExtId }) {
      if (!teacherExtId) return 0;
      const { data, error } = await supabase.from('observation_schedules')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('school_ext_id', schoolExtId).eq('teacher_ext_id', teacherExtId)
        .eq('status', 'upcoming').select('id');
      if (error) return 0;                    // a lost booking must not fail the change
      return (data || []).length;
    },

    async writeAudit(rows) {
      if (!rows || !rows.length) return 0;
      const { error } = await supabase.from('leader_roster_audit').insert(rows);
      if (error) throw new Error(`writeAudit: ${error.message}`);
      return rows.length;
    },
  };
}

const _deps = (d = {}) => ({ db: d.db || _supabaseDb() });

const _auditRow = (over) => ({
  action: null, actor_user_id: null, affected_leader_user_id: null,
  teacher_ext_id: null, teacher_phone_e164: null, teacher_name: null,
  from_school_ext_id: null, to_school_ext_id: null, detail: null, ...over,
});

// ── planning: reads only ───────────────────────────────────────────────

/**
 * What WOULD happen, for the screen the coach reads before confirming.
 *
 * `commitAdd` re-plans rather than trusting this: the confirm is a separate
 * data_exchange round trip and the teacher can move in between.
 */
async function planAdd({ actorLeaderUserId, schoolExtId, rawPhone }, deps = {}) {
  const { db } = _deps(deps);

  const phone = normaliseTeacherPhone(rawPhone);
  if (!phone) return { outcome: 'invalid_phone' };

  const target = await db.myschool(actorLeaderUserId, schoolExtId);
  if (!target) return { outcome: 'not_my_school' };

  const u = await db.userByPhone(phone);
  if (!u) return { outcome: 'new', phone, toSchoolName: target.school_name, target };
  if (u.role === 'coach') return { outcome: 'is_coach', phone, person: { name: u.first_name } };

  const person = {
    userId: u.id, name: u.first_name, role: u.role, isPrincipal: u.role === 'principal',
  };
  if (u.school_id && u.school_id === target.school_id) {
    return { outcome: 'already_here', phone, person, toSchoolName: target.school_name, target };
  }

  // A teacher with no school at all takes the same path: she is being placed.
  const from = await db.schoolOf(u.school_id);
  return {
    outcome: 'move',
    phone,
    person,
    fromSchoolExtId: from ? from.school_ext_id : null,
    fromSchoolName: from ? from.school_name : null,
    toSchoolName: target.school_name,
    target,
  };
}

// ── the copy ───────────────────────────────────────────────────────────

const ADD_TEMPLATES = {
  en: {
    move: '*{name}*{who} is already on our records at *{from}*.\n\nAdding {them} to *{to}*.',
    move_noschool: '*{name}*{who} is already on our records, with no school set.\n\nAdding {them} to *{to}*.',
    new: 'We do not know {phone} yet.\n\nAdding *{name}* to *{to}* as a new teacher.',
    already_here: '*{name}*{who} is already at *{to}*. Nothing to change.',
  },
  ur: {
    move: '*{name}*{who} پہلے سے ہمارے ریکارڈ میں *{from}* پر موجود ہیں۔\n\nانہیں *{to}* میں شامل کیا جا رہا ہے۔',
    move_noschool: '*{name}*{who} پہلے سے ہمارے ریکارڈ میں ہیں، اسکول درج نہیں۔\n\nانہیں *{to}* میں شامل کیا جا رہا ہے۔',
    new: '{phone} ہمارے ریکارڈ میں نہیں ہے۔\n\n*{name}* کو نئی ٹیچر کے طور پر *{to}* میں شامل کیا جا رہا ہے۔',
    already_here: '*{name}*{who} پہلے ہی *{to}* میں موجود ہیں۔ کچھ تبدیل کرنے کی ضرورت نہیں۔',
  },
};

// A principal landing in a teacher list is a surprise unless it is said aloud.
const WHO = { en: { principal: ' (Principal)', teacher: '' }, ur: { principal: ' (پرنسپل)', teacher: '' } };
const THEM = { en: 'them', ur: 'انہیں' };

function addPlanAck(lang, plan = {}) {
  const l = clampLanguage(lang);
  const t = ADD_TEMPLATES[l] || ADD_TEMPLATES.en;
  const person = plan.person || {};
  const key = (plan.outcome === 'move' && !plan.fromSchoolName) ? 'move_noschool' : plan.outcome;
  const body = t[key] || t.move;
  const who = (WHO[l] || WHO.en)[person.isPrincipal ? 'principal' : 'teacher'];
  return body
    .replace('{name}', String(person.name || plan.name || '').trim() || 'that teacher')
    .replace('{who}', who)
    .replace('{phone}', String(plan.phone || ''))
    .replace('{from}', String(plan.fromSchoolName || '').trim())
    .replace('{to}', String(plan.toSchoolName || '').trim())
    .replace('{them}', THEM[l] || THEM.en);
}

const REMOVED_TEMPLATES = {
  en: 'Removed *{name}* from *{school}*.\n\nTheir account and full history are kept — they can be added to another school later.',
  ur: '*{name}* کو *{school}* سے ہٹا دیا۔\n\nان کا اکاؤنٹ اور پورا ریکارڈ محفوظ ہے — انہیں بعد میں کسی اور اسکول میں شامل کیا جا سکتا ہے۔',
};

function removedTeacherAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  return (REMOVED_TEMPLATES[l] || REMOVED_TEMPLATES.en)
    .replace('{name}', String(opts.name || '').trim() || 'that teacher')
    .replace('{school}', String(opts.schoolName || '').trim() || 'that school');
}

const REFUSALS = {
  en: {
    invalid_phone: 'That does not look like a mobile number. Type it as 03001234567 and try again.',
    not_my_school: 'That school is not on your list, so you cannot change its teachers.',
    is_coach: 'That number belongs to a coach, so it cannot be added as a teacher.',
    name_required: 'We do not know this number yet, so we need a name to add them.',
    not_found: 'They are not at that school, so there is nothing to remove.',
    cancelled: 'Nothing was changed.',
    failed: 'That did not go through. Nothing was changed — please try again.',
  },
  ur: {
    invalid_phone: 'یہ موبائل نمبر نہیں لگتا۔ اسے 03001234567 کی طرح لکھ کر دوبارہ کوشش کریں۔',
    not_my_school: 'یہ اسکول آپ کی فہرست میں نہیں، اس لیے آپ اس کے ٹیچرز تبدیل نہیں کر سکتیں۔',
    is_coach: 'یہ نمبر ایک کوچ کا ہے، اسے ٹیچر کے طور پر شامل نہیں کیا جا سکتا۔',
    name_required: 'یہ نمبر ہمارے ریکارڈ میں نہیں، انہیں شامل کرنے کے لیے نام درکار ہے۔',
    not_found: 'وہ اس اسکول میں نہیں ہیں، اس لیے ہٹانے کو کچھ نہیں۔',
    cancelled: 'کچھ تبدیل نہیں کیا گیا۔',
    failed: 'یہ مکمل نہیں ہو سکا۔ کچھ تبدیل نہیں ہوا — دوبارہ کوشش کریں۔',
  },
};

function refusalBody(lang, key) {
  const t = REFUSALS[clampLanguage(lang)] || REFUSALS.en;
  return t[key] || t.failed;
}

// ── committing ─────────────────────────────────────────────────────────

/** Put someone on one of the coach's schools. One write, then the record. */
async function commitAdd({ actorLeaderUserId, schoolExtId, rawPhone, name }, deps = {}) {
  const { db } = _deps(deps);
  const plan = await planAdd({ actorLeaderUserId, schoolExtId, rawPhone }, { db });

  if (['invalid_phone', 'not_my_school', 'is_coach'].includes(plan.outcome)) return plan;
  if (plan.outcome === 'already_here') return { ...plan, wrote: false };

  const target = plan.target;

  if (plan.outcome === 'new') {
    const clean = String(name || '').trim();
    if (!clean) return { outcome: 'name_required', phone: plan.phone };
    // role is explicit at the call site: this creates a TEACHER, and that is a
    // decision worth reading here rather than buried in the port.
    const created = await db.createTeacher({
      phone: plan.phone, name: clean, schoolId: target.school_id, role: 'teacher',
    });
    await db.writeAudit([_auditRow({
      action: 'add', actor_user_id: actorLeaderUserId, affected_leader_user_id: actorLeaderUserId,
      teacher_ext_id: plan.phone, teacher_phone_e164: plan.phone, teacher_name: clean,
      to_school_ext_id: schoolExtId,
      detail: { via: 'observe_flow', createdUser: (created && created.id) || null },
    })]);
    return { outcome: 'new', wrote: true, name: clean, phone: plan.phone, toSchoolName: target.school_name };
  }

  await db.setUserSchool({
    userId: plan.person.userId,
    schoolId: target.school_id,
    // A coach putting someone on a school register is asserting they teach there.
    promoteToTeacher: !['teacher', 'principal'].includes(plan.person.role),
  });
  await db.writeAudit([_auditRow({
    action: 'move', actor_user_id: actorLeaderUserId, affected_leader_user_id: actorLeaderUserId,
    teacher_ext_id: plan.phone, teacher_phone_e164: plan.phone, teacher_name: plan.person.name,
    from_school_ext_id: plan.fromSchoolExtId, to_school_ext_id: schoolExtId,
    detail: { via: 'observe_flow', wasRole: plan.person.role },
  })]);
  return { ...plan, wrote: true };
}

/**
 * Take someone off a school. Their `users` row, coaching sessions and completed
 * observations are untouched — only the school is cleared, which is what
 * removes them from every patch that contained them.
 */
async function commitRemoval({ actorLeaderUserId, schoolExtId, userId, reason }, deps = {}) {
  const { db } = _deps(deps);

  const school = await db.myschool(actorLeaderUserId, schoolExtId);
  if (!school) return { ok: false, reason: 'not_my_school' };

  const person = db.userById ? await db.userById(userId) : null;
  const phone = (person && person.phone_number) || null;
  const visitsCancelled = await db.cancelUpcoming({ schoolExtId, teacherExtId: phone });

  await db.setUserSchool({ userId, schoolId: null });
  await db.writeAudit([_auditRow({
    action: 'remove', actor_user_id: actorLeaderUserId, affected_leader_user_id: actorLeaderUserId,
    teacher_ext_id: phone, teacher_phone_e164: phone,
    teacher_name: (person && person.first_name) || null,
    from_school_ext_id: schoolExtId, to_school_ext_id: null,
    detail: { via: 'observe_flow', reason: reason || null, visitsCancelled },
  })]);

  return {
    ok: true, visitsCancelled, schoolName: school.school_name,
    name: (person && person.first_name) || null,
  };
}

/**
 * Where a "what next?" tap after a teacher change sends the coach.
 *
 * Both loop options reopen at MENU (screen null => data_exchange => the
 * endpoint builds the screen) rather than navigating back to TEACHER_SCHOOL.
 * One extra tap, and it avoids the declared-key trap: those screens declare
 * `options`, navigate mode has no endpoint round trip to fill them, and the
 * screen then fails with no visible error — the same silent-failure class that
 * made removing a school look like a no-op.
 */
function rosterTeacherNextTarget(next) {
  switch (next) {
    case 'teacher_add':
    case 'teacher_remove':
    case 'menu':
      return { reopen: true, screen: null };
    default:
      return { reopen: false, screen: null };   // 'done' and anything stale
  }
}

module.exports = {
  rosterTeacherNextTarget,
  normaliseTeacherPhone,
  planAdd,
  commitAdd,
  commitRemoval,
  addPlanAck,
  removedTeacherAck,
  refusalBody,
};
