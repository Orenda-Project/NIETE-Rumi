/**
 * Coaches add and remove individual TEACHERS at a school, from WhatsApp.
 *
 * Operator, 2026-08-28: the coach types a NUMBER and we match it. If she is
 * already known we say so; if she is at a different school we REPLACE that
 * school for her; if she is unknown we add her — and we are "loud and clear to
 * the coach what we are about to do" BEFORE anything is written. Removing a
 * teacher takes her off that school; her account and her history remain, and
 * another coach may add her to another school later.
 *
 * Live shape this is written against (queried against NIETE prod
 * `ihzciabopbttygxxgrkm` on 2026-08-28, not assumed):
 *
 *   · `leader_teachers` (8,095 rows / 401 schools / 71 coaches) is a per-COACH
 *     assignment table: one row means "coach C observes teacher T at school S".
 *     There is no school->teacher roster table. 1,155 (school,teacher) pairs are
 *     held by more than one coach, so taking a teacher off a school is N rows,
 *     never one, and a removal by one coach necessarily reaches the others.
 *
 *   · Phone is the identity key and a good one — 6,604 of 6,607 distinct roster
 *     phones resolve to a `users` row — but it is NOT unique in this table.
 *     TWO phones carry more than one `teacher_ext_id`; one of them is the
 *     operator's own number holding 5 `name:test-*` teachers. So a lookup that
 *     returns several PEOPLE is a live state, and `classifyAdd` refuses it
 *     rather than picking one. Several ROWS for one person (co-assignment, or
 *     the 9 phones whose name is spelled differently by different coaches —
 *     'Mehnaz Akhtar' / 'Mehnaz Akhter') is the normal case and resolves fine.
 *
 *   · 92 teachers are ALREADY held at two schools at once. They violate the
 *     one-school rule before this feature exists, so being on the target school
 *     does not by itself mean there is nothing to move.
 *
 *   · `users.school_id` -> `schools.id` (94% populated) is the school truth and
 *     nothing in the product writes it — registration writes free text to
 *     `users.school_name`. It disagrees with the coach's view on 230 rows. A
 *     move writes it, which makes /observe its first live writer.
 *
 * The pure matchers/classifier/copy below are unit-tested; the supabase calls
 * stay thin, in the shape observe-school-admin.service.js established.
 */

const { clampLanguage } = require('../../config/ux-strings');

const ROW_SOURCE = 'niete_ict';        // the only value the CHECK constraint allows

// ── the number the coach types ─────────────────────────────────────────

/**
 * One canonical identity from whatever she types.
 *
 * Deliberately NOT observe-school-admin's `normalisePhoneTerm`, which drops a
 * number to a comparable local TAIL so a partial search can match. This is the
 * opposite job: an exact identity to write to a row and to join against
 * `users.phone_number`. Confusing the two would file a teacher under a key that
 * matches nobody.
 *
 * Fails CLOSED. Every PK mobile is 92 + 3XX + 7 digits; anything that is not
 * that shape returns null rather than a guess, because a guessed number reaches
 * a real person who is not the teacher.
 */
function normaliseTeacherPhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);          // 0092… — an intl prefix, not digits
  if (d.startsWith('0')) d = `92${d.slice(1)}`;    // 03001234567 -> 923001234567
  else if (d.startsWith('3')) d = `92${d}`;        // 3001234567  -> 923001234567
  return /^923\d{9}$/.test(d) ? d : null;
}

// ── what we are about to do ────────────────────────────────────────────

/**
 * Decide the outcome of an add BEFORE writing anything, so the coach can be
 * shown it and can back out.
 *
 * `existing` is every live `leader_teachers` row carrying this phone, across
 * ALL coaches — not just the caller's. Scoping it to her own rows is how a move
 * would silently strip a teacher from someone else's list without either coach
 * seeing it.
 *
 * Four outcomes, and the difference between the last two is the whole point:
 *   'new'          — nobody holds this number. Add her.
 *   'already_here' — every row is at the target school. A no-op, and it must
 *                    not render as "moved from X to X".
 *   'move'         — she is at another school. Name it, count who loses her.
 *   'ambiguous'    — the number carries more than one PERSON. Refuse.
 */
function classifyAdd({ existing, targetSchoolExtId, actorLeaderUserId } = {}) {
  const rows = Array.isArray(existing) ? existing.filter(Boolean) : [];
  if (!rows.length) return { outcome: 'new', callerHoldsHer: false };

  // "She is at this school" and "she is on MY list" are different facts, and
  // conflating them is a silent no-op. 1,155 (school,teacher) pairs are co-held
  // live, so a second coach picking up a teacher already at her school is the
  // NORMAL way that happens — returning 'already_here' and writing nothing
  // would leave her invisible to the coach who just asked for her.
  const callerHoldsHer = rows.some(
    (r) => r.leader_user_id === actorLeaderUserId && r.school_ext_id === targetSchoolExtId,
  );

  // More than one ext id on one number means more than one person, which is a
  // live state (the operator's test rows). Picking one would move a teacher
  // nobody named, so hand the candidates back and let a human choose.
  const byExtId = new Map();
  for (const r of rows) {
    const key = r.teacher_ext_id || r.teacher_phone_e164;
    if (!byExtId.has(key)) byExtId.set(key, r);
  }
  if (byExtId.size > 1) {
    return {
      outcome: 'ambiguous',
      callerHoldsHer,
      candidates: [...byExtId.values()].map((r) => ({
        teacherExtId: r.teacher_ext_id,
        teacherName: r.teacher_name,
        schoolExtId: r.school_ext_id,
        schoolName: r.school_name,
      })),
    };
  }

  const elsewhere = rows.filter((r) => r.school_ext_id !== targetSchoolExtId);
  const sample = rows[0];
  const teacherName = sample.teacher_name || null;
  const teacherExtId = sample.teacher_ext_id || sample.teacher_phone_e164 || null;

  if (!elsewhere.length) {
    return {
      outcome: 'already_here',
      teacherName,
      teacherExtId,
      callerHoldsHer,
      coachesHolding: new Set(rows.map((r) => r.leader_user_id)).size,
    };
  }

  const from = elsewhere[0];
  return {
    outcome: 'move',
    teacherName,
    teacherExtId,
    callerHoldsHer,
    phone: sample.teacher_phone_e164 || null,
    fromSchoolExtId: from.school_ext_id,
    fromSchoolName: from.school_name || null,
    // Every coach who loses her. Up to 4 hold one school, and none of them is
    // the person tapping "confirm".
    coachesLosingHer: new Set(elsewhere.map((r) => r.leader_user_id).filter(Boolean)).size,
  };
}

// ── "be loud and clear about what we are about to do" ──────────────────

const MOVE_TEMPLATES = {
  en: {
    move: '⚠️ About to move *{name}* ({phone}) from *{from}* to *{to}*.\n\nShe comes off {n} — they will no longer see her. Her account and her full history stay with her.',
    already_here: '✅ *{name}* is already at *{to}*. Nothing to change.',
    new: '➕ About to add *{name}* ({phone}) to *{to}*. Nobody holds this number yet.',
  },
  ur: {
    move: '⚠️ *{name}* ({phone}) کو *{from}* سے *{to}* میں منتقل کیا جا رہا ہے۔\n\nوہ {n} کی فہرست سے ہٹ جائیں گی۔ ان کا اکاؤنٹ اور پورا ریکارڈ محفوظ رہے گا۔',
    already_here: '✅ *{name}* پہلے ہی *{to}* میں موجود ہیں۔ کچھ تبدیل کرنے کی ضرورت نہیں۔',
    new: '➕ *{name}* ({phone}) کو *{to}* میں شامل کیا جا رہا ہے۔ یہ نمبر ابھی کسی کے پاس نہیں۔',
  },
};

function _coaches(lang, n) {
  if (lang === 'ur') return `${n} کوچز`;
  return n === 1 ? "1 coach's list" : `${n} coaches' lists`;
}

/**
 * The confirm screen's body — read by the coach BEFORE the write.
 *
 * Her name is never translated. The school names are never translated either:
 * they are the register's own spelling, and a coach matches what she reads here
 * against what she reads on the school gate.
 */
function movePlanAck(lang, plan = {}) {
  const l = clampLanguage(lang);
  const t = MOVE_TEMPLATES[l] || MOVE_TEMPLATES.en;
  const body = t[plan.outcome] || t.move;
  return body
    .replace('{name}', String(plan.teacherName || '').trim() || 'that teacher')
    .replace('{phone}', String(plan.phone || ''))
    .replace('{from}', String(plan.fromSchoolName || '').trim() || 'her school')
    .replace('{to}', String(plan.toSchoolName || '').trim() || 'this school')
    .replace('{n}', _coaches(l, Number(plan.coachesLosingHer) || 0));
}

const REMOVED_TEMPLATES = {
  en: '🗑 Removed *{name}* from *{school}*.\n\nHer account and her full history are kept — she can be added to another school later.',
  ur: '🗑 *{name}* کو *{school}* سے ہٹا دیا۔\n\nان کا اکاؤنٹ اور پورا ریکارڈ محفوظ ہے — انہیں بعد میں کسی اور اسکول میں شامل کیا جا سکتا ہے۔',
};

function removedTeacherAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const t = REMOVED_TEMPLATES[l] || REMOVED_TEMPLATES.en;
  return t
    .replace('{name}', String(opts.teacherName || '').trim() || 'that teacher')
    .replace('{school}', String(opts.schoolName || '').trim() || 'that school');
}

// ── the db port ────────────────────────────────────────────────────────

/**
 * Every table touch this service makes, behind one small surface.
 *
 * The point is not abstraction for its own sake — it is that the ORDER and the
 * FAN-OUT of these writes is the whole correctness story (tombstone the old
 * school, cancel the visits, insert the new row, stamp the school truth, audit
 * once per affected coach), and none of that is provable against a live
 * database in a unit test. Tests inject a recording fake; production gets this.
 */
function _supabaseDb() {
  const supabase = require('../../config/supabase');
  const LIVE = 'id, leader_user_id, teacher_ext_id, teacher_name, teacher_phone_e164, teacher_phone, level, school_ext_id';

  return {
    /** Every LIVE row carrying this phone, across all coaches. */
    async liveRowsByPhone(phone) {
      const { data } = await supabase.from('leader_teachers')
        .select(LIVE).eq('teacher_phone_e164', phone).is('deleted_at', null);
      return await _withSchoolNames(supabase, data || []);
    },

    /** Every LIVE row for one teacher at one school, across all coaches. */
    async liveRowsAtSchool(schoolExtId, teacherExtId) {
      const { data } = await supabase.from('leader_teachers')
        .select(LIVE).eq('school_ext_id', schoolExtId).eq('teacher_ext_id', teacherExtId)
        .is('deleted_at', null);
      return await _withSchoolNames(supabase, data || []);
    },

    /**
     * The school, from the master first and the assignment table second — the
     * same two-source dance addSchoolForCoach does, because `schools.emis`
     * exists on prod but NOT on staging (42703 there).
     */
    async resolveSchool(schoolExtId) {
      const emis = String(schoolExtId || '').split(':').pop();
      try {
        const { data, error } = await supabase.from('schools').select('id, name, emis').eq('emis', emis).limit(1);
        if (!error && data && data[0]) {
          return { school_ext_id: schoolExtId, school_name: data[0].name, emis, school_id: data[0].id };
        }
      } catch (_) { /* fall through */ }
      const { data } = await supabase.from('leader_schools')
        .select('school_name, emis').eq('school_ext_id', schoolExtId).limit(1);
      if (data && data[0]) return { school_ext_id: schoolExtId, school_name: data[0].school_name, emis: data[0].emis || emis };
      return null;
    },

    async userByPhone(phone) {
      const { data } = await supabase.from('users')
        .select('id, phone_number, first_name, preferred_language').eq('phone_number', phone).limit(1);
      return (data && data[0]) || null;
    },

    async insertAssignment(rowToWrite) {
      const { data, error } = await supabase.from('leader_teachers').insert(rowToWrite).select('id').limit(1);
      if (error) throw new Error(`insertAssignment: ${error.message}`);
      return (data && data[0]) || null;
    },

    /** Tombstone, never DELETE. `by` is who performed it, not whose row it is. */
    async softDeleteRows(ids, by) {
      if (!ids || !ids.length) return 0;
      const { error } = await supabase.from('leader_teachers')
        .update({ deleted_at: new Date().toISOString(), deleted_by: by || null }).in('id', ids);
      if (error) throw new Error(`softDeleteRows: ${error.message}`);
      return ids.length;
    },

    /**
     * Cancel, never delete: 43 of the 45 live upcoming visits are backed by a
     * roster row, and a 'done' row IS the record of who was observed, so only
     * 'upcoming' is ever touched.
     */
    async cancelUpcoming({ schoolExtId, teacherExtId }) {
      const { data, error } = await supabase.from('observation_schedules')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('school_ext_id', schoolExtId).eq('teacher_ext_id', teacherExtId)
        .eq('status', 'upcoming').select('id');
      if (error) return 0;                       // a lost booking must not fail the move
      return (data || []).length;
    },

    /**
     * The school truth. `users.school_id` is a real FK that 94% of teachers
     * carry and NOTHING in the product writes — this makes /observe its first
     * live writer, which is why it also clears the stale free-text copy.
     */
    async setUserSchool({ phone, schoolExtId, schoolName }) {
      const emis = String(schoolExtId || '').split(':').pop();
      const { data } = await supabase.from('schools').select('id').eq('emis', emis).limit(1);
      const schoolId = data && data[0] && data[0].id;
      if (!schoolId) return false;               // staging has no emis column; skip rather than guess
      const { error } = await supabase.from('users')
        .update({ school_id: schoolId, school_name: schoolName || null }).eq('phone_number', phone);
      return !error;
    },

    /** How many upcoming visits a removal WOULD cancel — the warning, not the act. */
    async countUpcoming({ schoolExtId, teacherExtId }) {
      const { count } = await supabase.from('observation_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('school_ext_id', schoolExtId).eq('teacher_ext_id', teacherExtId)
        .eq('status', 'upcoming');
      return Number(count) || 0;
    },

    /** This coach's own live teachers at one school — what she may remove. */
    async myTeachersAtSchool(leaderUserId, schoolExtId) {
      const { data } = await supabase.from('leader_teachers')
        .select('teacher_ext_id, teacher_name, teacher_phone_e164, level')
        .eq('leader_user_id', leaderUserId).eq('school_ext_id', schoolExtId)
        .is('deleted_at', null).order('teacher_name');
      return data || [];
    },

    async writeAudit(rows) {
      if (!rows || !rows.length) return 0;
      const { error } = await supabase.from('leader_roster_audit').insert(rows);
      if (error) throw new Error(`writeAudit: ${error.message}`);
      return rows.length;
    },
  };
}

/** School names for a set of rows, one round trip. Cosmetic — never throws. */
async function _withSchoolNames(supabase, rows) {
  try {
    const ids = [...new Set(rows.map((r) => r.school_ext_id).filter(Boolean))];
    if (!ids.length) return rows;
    const { data } = await supabase.from('leader_schools').select('school_ext_id, school_name').in('school_ext_id', ids);
    const byId = new Map((data || []).map((r) => [r.school_ext_id, r.school_name]));
    return rows.map((r) => ({ ...r, school_name: byId.get(r.school_ext_id) || null }));
  } catch (_) { return rows; }
}

// ── telling the coaches who did not do this ────────────────────────────

/**
 * A coach who loses a teacher gets a TEMPLATE, not a free-form message.
 *
 * She may not have messaged the bot in 24 hours, and outside that window Meta
 * drops free-form sends silently — which would make "we told her" false. So
 * this is presence-gated on ROSTER_CHANGE_TEMPLATE the way every other optional
 * feature here is: no template configured, no send, and the caller is told how
 * many sends did not happen rather than being allowed to assume they did.
 */
function _templateNotifier() {
  const templateName = process.env.ROSTER_CHANGE_TEMPLATE || '';
  return {
    async send({ leaderUserId, teacherName, schoolName }) {
      if (!templateName) return false;
      const supabase = require('../../config/supabase');
      const WhatsAppService = require('../whatsapp.service');
      const { data } = await supabase.from('users')
        .select('phone_number, preferred_language').eq('id', leaderUserId).limit(1);
      const coach = data && data[0];
      if (!coach || !coach.phone_number) return false;
      return WhatsAppService.sendTemplate(
        // clampLanguage already resolves to the market's offer (en/ur here).
        // Re-clamping inline is exactly the drift the language guard catches.
        coach.phone_number, templateName, clampLanguage(coach.preferred_language),
        [{ type: 'body', parameters: [
          { type: 'text', text: String(teacherName || 'A teacher') },
          { type: 'text', text: String(schoolName || 'her school') },
        ] }],
      );
    },
  };
}

// ── committing ─────────────────────────────────────────────────────────

const _deps = (d = {}) => ({ db: d.db || _supabaseDb(), notify: d.notify || _templateNotifier() });

/** Fan the template out, and never let a Meta failure undo a written change. */
async function _notifyAll(notify, leaderIds, payload) {
  let failed = 0;
  for (const leaderUserId of leaderIds) {
    try {
      const ok = await notify.send({ leaderUserId, ...payload });
      if (!ok) failed += 1;
    } catch (_) { failed += 1; }
  }
  return failed;
}

const _auditRow = (over) => ({
  action: null, actor_user_id: null, affected_leader_user_id: null,
  teacher_ext_id: null, teacher_phone_e164: null, teacher_name: null,
  from_school_ext_id: null, to_school_ext_id: null, detail: null, ...over,
});

/**
 * Add a teacher to a school, having already shown the coach what will happen.
 *
 * Re-plans from the database rather than trusting whatever the Flow round-tripped:
 * the confirm screen is a separate data_exchange, and between the two another
 * coach may have moved the same teacher.
 */
async function commitAdd({ actorLeaderUserId, schoolExtId, rawPhone, teacherName, level }, deps = {}) {
  const { db, notify } = _deps(deps);

  const phone = normaliseTeacherPhone(rawPhone);
  if (!phone) return { outcome: 'invalid_phone' };

  const live = await db.liveRowsByPhone(phone);
  const plan = classifyAdd({ existing: live, targetSchoolExtId: schoolExtId, actorLeaderUserId });

  // One number, two people. Refuse before touching anything.
  if (plan.outcome === 'ambiguous') return plan;

  const target = await db.resolveSchool(schoolExtId);
  if (!target) return { outcome: 'school_not_found' };

  const known = live[0] || null;
  const name = String(teacherName || (known && known.teacher_name) || '').trim();
  if (!name) return { outcome: 'name_required' };
  const teacherExtId = (known && known.teacher_ext_id) || phone;

  const newRow = {
    leader_user_id: actorLeaderUserId, school_ext_id: schoolExtId,
    teacher_ext_id: teacherExtId, teacher_name: name,
    teacher_phone_e164: phone, teacher_phone: (known && known.teacher_phone) || phone,
    level: level || (known && known.level) || null, source: ROW_SOURCE,
  };

  // ── already at this school ───────────────────────────────────────────
  if (plan.outcome === 'already_here') {
    if (plan.callerHoldsHer) return { ...plan, wrote: false };
    await db.insertAssignment(newRow);
    await db.writeAudit([_auditRow({
      action: 'add', actor_user_id: actorLeaderUserId, affected_leader_user_id: actorLeaderUserId,
      teacher_ext_id: teacherExtId, teacher_phone_e164: phone, teacher_name: name,
      to_school_ext_id: schoolExtId,
      detail: { via: 'observe_flow', coHeld: true },
    })]);
    return { ...plan, wrote: true, schoolName: target.school_name };
  }

  // ── a brand new teacher ──────────────────────────────────────────────
  if (plan.outcome === 'new') {
    await db.insertAssignment(newRow);
    await db.setUserSchool({ phone, schoolExtId, schoolName: target.school_name });
    await db.writeAudit([_auditRow({
      action: 'add', actor_user_id: actorLeaderUserId, affected_leader_user_id: actorLeaderUserId,
      teacher_ext_id: teacherExtId, teacher_phone_e164: phone, teacher_name: name,
      to_school_ext_id: schoolExtId,
      detail: { via: 'observe_flow', newToRoster: true, onRumi: !!(await db.userByPhone(phone)) },
    })]);
    return { outcome: 'new', wrote: true, teacherName: name, schoolName: target.school_name };
  }

  // ── a move ───────────────────────────────────────────────────────────
  const elsewhere = live.filter((r) => r.school_ext_id !== schoolExtId);
  const losers = [...new Set(elsewhere.map((r) => r.leader_user_id).filter(Boolean))];

  await db.softDeleteRows(elsewhere.map((r) => r.id), actorLeaderUserId);
  const visitsCancelled = await db.cancelUpcoming({
    schoolExtId: plan.fromSchoolExtId, teacherExtId,
  });
  if (!plan.callerHoldsHer) await db.insertAssignment(newRow);
  await db.setUserSchool({ phone, schoolExtId, schoolName: target.school_name });

  const affected = [...new Set([...losers, actorLeaderUserId])];
  await db.writeAudit(affected.map((leaderId) => _auditRow({
    action: 'move', actor_user_id: actorLeaderUserId, affected_leader_user_id: leaderId,
    teacher_ext_id: teacherExtId, teacher_phone_e164: phone, teacher_name: name,
    from_school_ext_id: plan.fromSchoolExtId, to_school_ext_id: schoolExtId,
    detail: { via: 'observe_flow', visitsCancelled, lostHer: leaderId !== actorLeaderUserId },
  })));

  // Everyone who lost her, never the coach who did it.
  const notifyFailed = await _notifyAll(notify, losers, {
    teacherName: name, schoolName: plan.fromSchoolName,
  });

  return {
    ...plan, wrote: true, schoolName: target.school_name,
    visitsCancelled, coachesNotified: losers.length - notifyFailed, notifyFailed,
  };
}

/**
 * Take a teacher off a school. Her `users` row, her coaching_sessions and her
 * completed observations are untouched — only the assignment rows are
 * tombstoned, and only for THIS school.
 *
 * `users.school_id` is deliberately NOT cleared: she still works somewhere, and
 * blanking it would destroy the one field that says where.
 */
async function commitRemoval({ actorLeaderUserId, schoolExtId, teacherExtId, reason }, deps = {}) {
  const { db, notify } = _deps(deps);

  const rows = await db.liveRowsAtSchool(schoolExtId, teacherExtId);
  if (!rows.length) return { ok: false, reason: 'not_found' };

  const sample = rows[0];
  const holders = [...new Set(rows.map((r) => r.leader_user_id).filter(Boolean))];

  await db.softDeleteRows(rows.map((r) => r.id), actorLeaderUserId);
  const visitsCancelled = await db.cancelUpcoming({ schoolExtId, teacherExtId });

  await db.writeAudit(holders.map((leaderId) => _auditRow({
    action: 'remove', actor_user_id: actorLeaderUserId, affected_leader_user_id: leaderId,
    teacher_ext_id: teacherExtId, teacher_phone_e164: sample.teacher_phone_e164,
    teacher_name: sample.teacher_name,
    from_school_ext_id: schoolExtId, to_school_ext_id: null,
    detail: {
      via: 'observe_flow', visitsCancelled, reason: reason || null,
      lostHer: leaderId !== actorLeaderUserId,
    },
  })));

  const others = holders.filter((id) => id !== actorLeaderUserId);
  const notifyFailed = await _notifyAll(notify, others, {
    teacherName: sample.teacher_name, schoolName: sample.school_name,
  });

  return {
    ok: true,
    teacherName: sample.teacher_name,
    schoolName: sample.school_name,
    coachesAffected: holders.length,
    visitsCancelled,
    coachesNotified: others.length - notifyFailed,
    notifyFailed,
  };
}

// ── planning (reads only — the confirm screen's source of truth) ───────

/**
 * What WOULD happen, for the screen the coach reads before confirming.
 *
 * Shares `classifyAdd` with `commitAdd` on purpose: the confirm text and the
 * write must never be able to disagree about the outcome. commitAdd re-plans
 * anyway, because the two are separate data_exchange round trips and another
 * coach can move the same teacher in between.
 */
async function planAdd({ actorLeaderUserId, schoolExtId, rawPhone }, deps = {}) {
  const { db } = _deps(deps);
  const phone = normaliseTeacherPhone(rawPhone);
  if (!phone) return { outcome: 'invalid_phone' };

  const live = await db.liveRowsByPhone(phone);
  const plan = classifyAdd({ existing: live, targetSchoolExtId: schoolExtId, actorLeaderUserId });
  const target = await db.resolveSchool(schoolExtId);
  const known = live[0] || null;

  return {
    ...plan,
    phone,
    teacherName: plan.teacherName || (known && known.teacher_name) || null,
    toSchoolExtId: schoolExtId,
    toSchoolName: (target && target.school_name) || null,
  };
}

/** What a removal would cost, including the visits it takes down with it. */
async function planRemoval({ schoolExtId, teacherExtId }, deps = {}) {
  const { db } = _deps(deps);
  const rows = await db.liveRowsAtSchool(schoolExtId, teacherExtId);
  if (!rows.length) return { ok: false, reason: 'not_found' };
  return {
    ok: true,
    teacherName: rows[0].teacher_name,
    schoolName: rows[0].school_name,
    coachesAffected: new Set(rows.map((r) => r.leader_user_id).filter(Boolean)).size,
    upcomingVisits: await db.countUpcoming({ schoolExtId, teacherExtId }),
  };
}

/** This coach's own teachers at one school — the remove picker's options. */
async function listTeachersAtSchool(leaderUserId, schoolExtId, deps = {}) {
  const { db } = _deps(deps);
  return db.myTeachersAtSchool(leaderUserId, schoolExtId);
}

// ── the removal confirm, and the refusals ──────────────────────────────

const REMOVAL_PLAN = {
  en: {
    base: 'About to take *{name}* off *{school}*.',
    coaches: ' She comes off {n} in total.',
    visits: ' {v} already booked will be cancelled.',
    tail: '\n\nHer account and her full history stay. She can be added to another school later.',
  },
  ur: {
    base: '*{name}* کو *{school}* سے ہٹایا جا رہا ہے۔',
    coaches: ' وہ کل {n} کی فہرست سے ہٹ جائیں گی۔',
    visits: ' پہلے سے طے شدہ {v} منسوخ ہو جائیں گی۔',
    tail: '\n\nان کا اکاؤنٹ اور پورا ریکارڈ محفوظ رہے گا۔ انہیں بعد میں کسی اور اسکول میں شامل کیا جا سکتا ہے۔',
  },
};

function _visits(lang, n) {
  if (lang === 'ur') return `${n} وزٹس`;
  return n === 1 ? '1 visit' : `${n} visits`;
}

/**
 * The removal confirm. Names the visits it will cancel, because a coach who
 * loses a booking she made should have been told before, not after.
 */
function removalPlanAck(lang, plan = {}) {
  const l = clampLanguage(lang);
  const t = REMOVAL_PLAN[l] || REMOVAL_PLAN.en;
  let out = t.base
    .replace('{name}', String(plan.teacherName || '').trim() || 'that teacher')
    .replace('{school}', String(plan.schoolName || '').trim() || 'that school');
  const n = Number(plan.coachesAffected) || 0;
  if (n > 1) out += t.coaches.replace('{n}', _coaches(l, n));
  const v = Number(plan.upcomingVisits) || 0;
  if (v > 0) out += t.visits.replace('{v}', _visits(l, v));
  return out + t.tail;
}

const REFUSALS = {
  en: {
    invalid_phone: 'That does not look like a mobile number. Type it as 03001234567 and try again.',
    ambiguous: 'That number is on our records for more than one teacher, so we cannot tell which one you mean. Tell the team and they will sort the number out.',
    school_not_found: 'We could not find that school. Tell the team.',
    name_required: 'We do not know this teacher yet, so we need her name to add her.',
    not_found: 'She is not on that school’s list, so there is nothing to remove.',
    cancelled: 'Nothing was changed.',
    failed: 'That did not go through. Nothing was changed — please try again.',
  },
  ur: {
    invalid_phone: 'یہ موبائل نمبر نہیں لگتا۔ اسے 03001234567 کی طرح لکھ کر دوبارہ کوشش کریں۔',
    ambiguous: 'یہ نمبر ایک سے زیادہ ٹیچرز کے ریکارڈ میں ہے، اس لیے ہم نہیں بتا سکتے کہ آپ کس کی بات کر رہی ہیں۔ ٹیم کو بتائیں، وہ نمبر درست کر دیں گے۔',
    school_not_found: 'یہ اسکول نہیں مل سکا۔ ٹیم کو بتائیں۔',
    name_required: 'ہم اس ٹیچر کو ابھی نہیں جانتے، انہیں شامل کرنے کے لیے ان کا نام درکار ہے۔',
    not_found: 'وہ اس اسکول کی فہرست میں نہیں ہیں، اس لیے ہٹانے کو کچھ نہیں۔',
    cancelled: 'کچھ تبدیل نہیں کیا گیا۔',
    failed: 'یہ مکمل نہیں ہو سکا۔ کچھ تبدیل نہیں ہوا — دوبارہ کوشش کریں۔',
  },
};

function refusalBody(lang, key) {
  const l = clampLanguage(lang);
  const t = REFUSALS[l] || REFUSALS.en;
  return t[key] || t.failed;
}

module.exports = {
  planAdd,
  planRemoval,
  listTeachersAtSchool,
  removalPlanAck,
  refusalBody,
  commitAdd,
  commitRemoval,
  normaliseTeacherPhone,
  classifyAdd,
  movePlanAck,
  removedTeacherAck,
  ROW_SOURCE,
};
