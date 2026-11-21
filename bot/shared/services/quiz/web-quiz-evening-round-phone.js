'use strict';
/**
 * roundsReadyForPhone(device_ref, dayPkt) — the reminder's payload (PLAN §3.2; switch `web_quiz_evening_round`).
 * Re-exported from web-quiz-class-link.js, where the reminders lane requires it.
 *
 *   -> [{ class_link_code, class_id, teacher_ref, class_label_en, class_label_ur, round_code, ready_at
 *         (, kids: [{ first, first_ur }] with { withKids: true }) }]
 *
 * device -> the children it played as (quiz_sessions.device_ref) or a hub trusted it with (HubDevice.deviceKids;
 * a class-link high pick writes it too) -> their active classes (class_enrollments) -> the class's live standing link
 * -> the class's ready round for the day (Redis per class, written when the round is ready; the DB for the rest).
 * Reads per phone: one quiz_sessions, one Redis GET, one class_enrollments, one class_links, the round cache (one
 * GET per class), and one students read only when a round is there. Off, an unknown phone, or any failure -> [].
 *
 * `kids` (first names only) is included ONLY with { withKids: true }: the reminders lane asks for it while its
 * naming policy switch (web_quiz_push_name_children) is on; by default no child's name is read at all.
 * `teacher_ref` is a one-way key of the round's teacher (never the id). Labels fit 24 code points.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Flags = require('./web-quiz-evening-round-flags');

const CODE_RX = /^[A-Za-z0-9_-]{3,32}$/;
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const LABEL_MAX = 24;
const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urDigits = (s) => String(s).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]);
const cut = (s) => [...String(s)].slice(0, LABEL_MAX).join('');

/** "Class 3-B" / «کلاس ۳-B» from classes.grade_code ('grade_3') and section; null without a grade. */
function classLabels(gradeCode, section) {
  const m = /(\d+)/.exec(String(gradeCode || ''));
  if (!m) return { en: null, ur: null };
  const sec = String(section || '').trim();
  const tail = sec ? `-${sec}` : '';
  return { en: cut(`Class ${m[1]}${tail}`), ur: cut(`کلاس ${urDigits(m[1])}${tail}`) };
}

function teacherRef(teacherId) {
  if (!teacherId) return null;
  try {
    return require('./web-quiz-token').chipId('teacher_ref', teacherId) || crypto.createHash('sha256').update(`tr|${teacherId}`).digest('hex').slice(0, 16);
  } catch (_) {
    return crypto.createHash('sha256').update(`tr|${teacherId}`).digest('hex').slice(0, 16);
  }
}

async function roundsReadyForPhone(deviceRef, dayPkt, { withKids = false } = {}) {
  try {
    const T = require('./web-quiz-token');
    const d = T.cleanDeviceRef(deviceRef);
    if (!d || !DAY_RX.test(String(dayPkt || ''))) return [];
    if (!(await Flags.eveningRoundOn())) return [];
    const HubDevice = require('./web-quiz-hub-device');
    const [{ data: played }, hubKids] = await Promise.all([
      supabase.from('quiz_sessions').select('student_id').eq('device_ref', d).limit(50),
      HubDevice.deviceKids(d),
    ]);
    const kidIds = [...new Set([...(played || []).map((r) => r.student_id), ...(hubKids || [])].filter(Boolean).map(String))];
    if (!kidIds.length) return [];
    const { data: enr } = await supabase.from('class_enrollments').select('class_id, student_id').in('student_id', kidIds).eq('is_active', true);
    const classIds = [...new Set((enr || []).map((e) => e.class_id).filter(Boolean))];
    if (!classIds.length) return [];
    const Round = require('./web-quiz-evening-round');
    const now = new Date();
    const [{ data: links }, rounds] = await Promise.all([
      supabase.from('class_links').select('code, class_id, teacher_id, expires_at, revoked_at').in('class_id', classIds).is('revoked_at', null).gt('expires_at', now.toISOString()),
      Round.roundsForClasses(classIds, dayPkt),
    ]);
    const ready = classIds.map((id) => ({ id, link: (links || []).find((l) => l.class_id === id), round: rounds.get(String(id)) }))
      .filter((x) => x.link && x.round && CODE_RX.test(String(x.link.code)) && CODE_RX.test(String(x.round.round_code || '')));
    if (!ready.length) return [];
    const kidsIn = (classId) => (enr || []).filter((e) => e.class_id === classId).map((e) => String(e.student_id));
    // Children's names are read only when asked for (the reminders lane asks while its naming policy switch is on).
    const want = withKids ? [...new Set(ready.flatMap((x) => kidsIn(x.id)))] : [];
    const { data: students } = want.length ? await supabase.from('students').select('id, student_name, student_name_urdu').in('id', want) : { data: [] };
    const CL = require('./web-quiz-class-link');
    const firstOf = (name) => (name ? CL.firstNameOf(name).shown || null : null);
    return ready.map((x) => {
      const labels = classLabels(x.round.grade_code, x.round.section);
      const out = {
        class_link_code: x.link.code,
        class_id: x.id,
        teacher_ref: teacherRef(x.round.teacher_id || x.link.teacher_id),
        class_label_en: labels.en,
        class_label_ur: labels.ur,
        round_code: x.round.round_code,
        ready_at: x.round.ready_at || null,
      };
      if (withKids) {
        out.kids = kidsIn(x.id).map((id) => (students || []).find((s) => String(s.id) === id)).filter(Boolean)
          .map((s) => ({ first: firstOf(s.student_name), first_ur: firstOf(s.student_name_urdu) }));
      }
      return out;
    });
  } catch (err) {
    logToFile('⚠️ evening round: roundsReadyForPhone unavailable', { error: err.message });
    return [];
  }
}

module.exports = { roundsReadyForPhone, classLabels, teacherRef };
