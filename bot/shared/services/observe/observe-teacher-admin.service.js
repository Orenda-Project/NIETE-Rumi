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
        .select('id, phone_number, role, school_id, name').eq('phone_number', phone).limit(1);
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
        .insert({ phone_number: phone, name: name, role: role || 'teacher', school_id: schoolId })
        .select('id').limit(1);
      if (error) throw new Error(`createTeacher: ${error.message}`);
      return (data && data[0]) || null;
    },

    /**
     * The three writes a removal makes, set-based.
     *
     * Not an optimisation for its own sake: thirty teachers down a
     * single-teacher path is ~120 round trips inside a data_exchange Meta
     * times out at ~10s. These three are flat in N.
     */
    async usersByIds(ids) {
      if (!ids || !ids.length) return [];
      const { data } = await supabase.from('users')
        .select('id, phone_number, role, school_id, name').in('id', ids);
      return data || [];
    },

    async cancelUpcomingMany({ schoolExtId, teacherExtIds }) {
      const phones = (teacherExtIds || []).filter(Boolean);
      if (!phones.length) return 0;
      const { data, error } = await supabase.from('observation_schedules')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('school_ext_id', schoolExtId).in('teacher_ext_id', phones)
        .eq('status', 'upcoming').select('id');
      if (error) return 0;                    // a lost booking must not fail the change
      return (data || []).length;
    },

    async clearSchoolForUsers(ids) {
      if (!ids || !ids.length) return false;
      const { error } = await supabase.from('users').update({ school_id: null }).in('id', ids);
      return !error;
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
  if (u.role === 'coach') return { outcome: 'is_coach', phone, person: { name: u.name } };

  const person = {
    userId: u.id, name: u.name, role: u.role, isPrincipal: u.role === 'principal',
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

// ── removing several at once ───────────────────────────────────────────

/**
 * How many may come off in one pass.
 *
 * THIS SCREEN'S NUMBER ONLY. It is mirrored by `max-selected-items` on
 * TEACHER_PICK's CheckboxGroup and by nothing else — every other multi-select
 * in the product carries its own cap for its own reason (12 chapters, 6
 * question types, 100 students), and none of them should ever be folded into
 * this constant.
 *
 * It is NOT `LIST_CAP`. That one bounds how many names the picker DISPLAYS
 * (200) and is shared by four screens; this bounds how many may be TICKED.
 */
const REMOVE_BATCH_MAX = 30;

const _names = (list, fallback) => {
  const clean = (list || []).map((n) => String(n == null ? '' : n).trim()).filter(Boolean);
  return clean.length ? clean : [fallback];
};

const PLAN_TEMPLATES = {
  en: {
    one: '*{name}* will come off *{school}*.\n\nTheir account and full history are kept — they can be added to another school later.',
    many: '{n} people will come off *{school}*:\n{names}\n\nTheir accounts and full history are kept — they can be added to another school later.',
  },
  ur: {
    one: '*{name}* کو *{school}* سے ہٹایا جائے گا۔\n\nان کا اکاؤنٹ اور پورا ریکارڈ محفوظ رہے گا — انہیں بعد میں کسی اور اسکول میں شامل کیا جا سکتا ہے۔',
    many: '{n} افراد کو *{school}* سے ہٹایا جائے گا:\n{names}\n\nان کے اکاؤنٹس اور پورا ریکارڈ محفوظ رہے گا — انہیں بعد میں کسی اور اسکول میں شامل کیا جا سکتا ہے۔',
  },
};

/**
 * What the confirm screen says BEFORE anything is written.
 *
 * It used to reuse `removedTeacherAck`, so the screen greeted the coach with
 * "Removed Tahira Manzoor from IMCG, G-10/2." above a button reading "Yes,
 * remove them" — announcing, in the past tense, something that had not
 * happened. The screen's own `__example__` in the Flow JSON has always read
 * "…will come off…"; this is that sentence.
 */
function removalPlanAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const t = PLAN_TEMPLATES[l] || PLAN_TEMPLATES.en;
  const school = String(opts.schoolName || '').trim() || (l === 'ur' ? 'اس اسکول' : 'that school');
  const names = _names(opts.names, l === 'ur' ? 'وہ ٹیچر' : 'that teacher');

  if (names.length === 1) return t.one.replace('{name}', names[0]).replace('{school}', school);
  return t.many
    .replace('{n}', String(names.length))
    .replace('{school}', school)
    .replace('{names}', names.map((n) => `• ${n}`).join('\n'));
}

const REMOVED_MANY_TEMPLATES = {
  en: {
    body: 'Removed {n} people from *{school}*:\n{names}\n\nTheir accounts and full history are kept — they can be added to another school later.',
    visits: '\n\n{v} booked visits were cancelled.',
    skipped: '\n\n{s} could not be removed and are still on the list. Please try those again.',
  },
  ur: {
    body: '{n} افراد کو *{school}* سے ہٹا دیا:\n{names}\n\nان کے اکاؤنٹس اور پورا ریکارڈ محفوظ ہیں — انہیں بعد میں کسی اور اسکول میں شامل کیا جا سکتا ہے۔',
    visits: '\n\n{v} طے شدہ وزٹ منسوخ کر دیے گئے۔',
    skipped: '\n\n{s} کو نہیں ہٹایا جا سکا اور وہ اب بھی فہرست میں ہیں۔ براہِ کرم دوبارہ کوشش کریں۔',
  },
};

/**
 * What the done screen says after the write.
 *
 * A partial batch is named out loud. Silence about the two that did not come
 * off reads as success, and the coach walks away believing a register is clean
 * when it is not.
 */
function removedTeachersAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const names = _names(opts.names, l === 'ur' ? 'وہ ٹیچر' : 'that teacher');
  if (names.length === 1 && !opts.skippedCount) {
    const one = removedTeacherAck(l, { name: names[0], schoolName: opts.schoolName });
    return opts.visitsCancelled
      ? one + REMOVED_MANY_TEMPLATES[l].visits.replace('{v}', String(opts.visitsCancelled))
      : one;
  }

  const t = REMOVED_MANY_TEMPLATES[l] || REMOVED_MANY_TEMPLATES.en;
  let body = t.body
    .replace('{n}', String(names.length))
    .replace('{school}', String(opts.schoolName || '').trim() || (l === 'ur' ? 'اس اسکول' : 'that school'))
    .replace('{names}', names.map((n) => `• ${n}`).join('\n'));
  if (opts.visitsCancelled) body += t.visits.replace('{v}', String(opts.visitsCancelled));
  if (opts.skippedCount) body += t.skipped.replace('{s}', String(opts.skippedCount));
  return body;
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
 * Take one or SEVERAL people off a school in a single pass.
 *
 * Their `users` rows, coaching sessions and completed observations are
 * untouched — only the school is cleared, which is what removes them from
 * every patch that contained them.
 *
 * A coach removing a whole transferred group used to walk the four screens
 * once per person, re-picking the school each time, because the picker
 * returned one id. This replaces the single-teacher `commitRemoval` outright
 * rather than looping it, for two reasons:
 *
 *   · Authorisation is checked ONCE, against the school — then every id is
 *     checked against THAT school's roll. The picker is a screen and a service
 *     that trusts a screen has no authorisation at all: a replayed payload
 *     naming anyone in the district would otherwise go straight through.
 *   · The writes are set-based. Thirty teachers through the single path is
 *     ~120 round trips inside a data_exchange Meta cuts off at ~10s; this is
 *     four, whatever N is.
 *
 * The audit trail does NOT collapse: one `leader_roster_audit` row per teacher,
 * carrying her own phone, her own name and the shared reason, exactly as a
 * one-at-a-time removal would have written it.
 */
async function commitRemovals({ actorLeaderUserId, schoolExtId, userIds, reason }, deps = {}) {
  const { db } = _deps(deps);

  const asked = [...new Set((userIds || [])
    .map((x) => String(x == null ? '' : x).trim())
    .filter((x) => x && x !== 'none'))];
  if (!asked.length) return { ok: false, reason: 'not_found', removed: [], skipped: [] };

  // The client cap is a screen attribute, and a screen is not a guard — the
  // same payload can arrive from a replay or from an older published asset.
  const ids = asked.slice(0, REMOVE_BATCH_MAX);
  const overflow = asked.slice(REMOVE_BATCH_MAX);

  const school = await db.myschool(actorLeaderUserId, schoolExtId);
  if (!school) return { ok: false, reason: 'not_my_school', removed: [], skipped: [] };

  const people = await db.usersByIds(ids);
  const byId = new Map((people || []).map((p) => [p.id, p]));
  // Only people actually AT this school come off it.
  const here = ids.map((id) => byId.get(id)).filter((p) => p && p.school_id === school.school_id);
  const skipped = [...ids.filter((id) => !here.some((p) => p.id === id)), ...overflow];

  if (!here.length) return { ok: false, reason: 'not_found', removed: [], skipped };

  const phones = here.map((p) => p.phone_number).filter(Boolean);
  const visitsCancelled = await db.cancelUpcomingMany({ schoolExtId, teacherExtIds: phones });

  const wrote = await db.clearSchoolForUsers(here.map((p) => p.id));
  if (!wrote) return { ok: false, reason: 'failed', removed: [], skipped };

  await db.writeAudit(here.map((p) => _auditRow({
    action: 'remove', actor_user_id: actorLeaderUserId, affected_leader_user_id: actorLeaderUserId,
    teacher_ext_id: p.phone_number || null, teacher_phone_e164: p.phone_number || null,
    teacher_name: p.name || null,
    from_school_ext_id: schoolExtId, to_school_ext_id: null,
    detail: { via: 'observe_flow', reason: reason || null, batch: here.length },
  })));

  return {
    ok: true,
    reason: null,
    removed: here.map((p) => ({ userId: p.id, name: p.name || null, phone: p.phone_number || null })),
    skipped,
    visitsCancelled,
    schoolName: school.school_name,
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

// ── the confirm screen's payload ───────────────────────────────────────

const FOUND = {
  en: {
    heading_found: "We found this teacher's account",
    heading_new: 'No account on this number yet',
    heading_move: 'This teacher is at another school',
    name: 'Name', school: 'School', no_school: 'not set',
    to: 'Adding them to *{to}*.',
    already: 'They are already at *{to}*. Nothing to change.',
    confirm: 'Yes, go ahead', confirm_new: 'Add them',
  },
  ur: {
    heading_found: 'یہ اکاؤنٹ مل گیا',
    heading_new: 'اس نمبر پر کوئی اکاؤنٹ نہیں',
    heading_move: 'یہ استاد کسی اور اسکول میں ہیں',
    name: 'نام', school: 'اسکول', no_school: 'درج نہیں',
    to: 'انہیں *{to}* میں شامل کیا جا رہا ہے۔',
    already: 'وہ پہلے ہی *{to}* میں ہیں۔ کچھ تبدیل کرنے کی ضرورت نہیں۔',
    confirm: 'جی، آگے بڑھیں', confirm_new: 'شامل کریں',
  },
};

/**
 * What TEACHER_CONFIRM renders, composed here rather than in the screen.
 *
 * The operator's shape: show the account we matched — name and current school —
 * set apart from the sentence about what happens next, so the coach can check
 * they have the right person before agreeing to move them.
 *
 * Every value is a WHOLE data field. Flow substitutes `${data.x}` only when it
 * is the entire property value; a reference inside a sentence is printed
 * verbatim, which is how "${data.school_name}" reached a coach.
 */
function foundAccountScreen(lang, plan = {}, schoolExtId = '') {
  const l = clampLanguage(lang);
  const t = FOUND[l] || FOUND.en;
  const person = plan.person || {};
  const isNew = plan.outcome === 'new';
  const name = String(person.name || plan.name || '').trim();
  const role = person.isPrincipal ? ` (${l === 'ur' ? 'پرنسپل' : 'Principal'})` : '';
  const at = String(plan.fromSchoolName || '').trim() || t.no_school;

  const details = isNew
    ? `${t.name}: ${name}`
    : `${t.name}: ${name}${role}\n${t.school}: ${at}`;

  const tail = plan.outcome === 'already_here'
    ? t.already.replace('{to}', String(plan.toSchoolName || ''))
    : t.to.replace('{to}', String(plan.toSchoolName || ''));

  // Name the move at the point of commitment. The old school is already on the
  // details line, so the move was inferable; saying it outright is what the
  // coach who reported "there is no way to transfer a teacher" needed to read.
  const heading = isNew ? t.heading_new
    : (plan.outcome === 'move' && t.heading_move) ? t.heading_move
      : t.heading_found;

  return {
    found_heading: heading,
    found_details: details,
    plan: tail,
    school_ext_id: schoolExtId,
    phone: String(plan.phone || ''),
    name,
    confirm_label: (isNew ? t.confirm_new : t.confirm).slice(0, 20),
  };
}

module.exports = {
  foundAccountScreen,
  rosterTeacherNextTarget,
  normaliseTeacherPhone,
  planAdd,
  commitAdd,
  commitRemovals,
  REMOVE_BATCH_MAX,
  addPlanAck,
  removedTeacherAck,
  removalPlanAck,
  removedTeachersAck,
  refusalBody,
};
