'use strict';
/**
 * roundsReadyForPhone(device_ref, dayPkt) — the reminder's payload (PLAN §3.2; switch `web_quiz_evening_round`).
 * Re-exported from web-quiz-class-link.js, where the reminders lane requires it.
 *
 *   -> [{ class_link_code, class_id, teacher_ref, class_label_en, class_label_ur, round_code, ready_at
 *         (, kids: [{ student_id (, first, first_ur) }] with { withKids: true }) }]
 *
 * Only what is still WAITING on this phone: a child who finished tonight's round (a completed quiz_sessions row on the
 * round's share code) is not listed, and a class whose phone-children all finished is left out.
 *
 * device -> the children it played as (quiz_sessions.device_ref) or a hub trusted it with (HubDevice.deviceKids;
 * a class-link high pick writes it too) -> their active classes (class_enrollments) -> the class's live standing link
 * -> the class's ready round for the day (Redis per class, written when the round is ready; the DB for the rest).
 * Reads per phone: one quiz_sessions, one Redis GET, one class_enrollments, one class_links, the round cache (one
 * GET per class), one quiz_sessions for the finished sittings when a round is there, and with { withKids: true } the
 * naming switch and (only when it is on) one students read. Off, an unknown phone, or any failure -> [].
 *
 * `kids` is included ONLY with { withKids: true }: each waiting child's student_id, and its first names (first,
 * first_ur) ONLY while app_settings web_quiz_push_name_children is JSON true; missing or anything else: no child's
 * name is read at all.
 * `teacher_ref` is a one-way key of the round's teacher (never the id). Labels fit 24 code points.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Flags = require('./web-quiz-evening-round-flags');

const CODE_RX = /^[A-Za-z0-9_-]{3,32}$/;
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const LABEL_MAX = 24;
const IN_CHUNK = 200;
const NAMES_KEY = 'web_quiz_push_name_children';
const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urDigits = (s) => String(s).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]);
const cut = (s) => [...String(s)].slice(0, LABEL_MAX).join('');

/**
 * The ONE class label a parent or child sees (the reminder's title, the /j/ link preview, the teacher page's rounds):
 * "Class 3 A" / «کلاس ۳ A» from classes.grade_code ('grade_3') and section — Urdu digits in Urdu, the section as
 * stored after a space; no section -> "Class 3" / «کلاس ۳»; null without a grade. At most 24 code points.
 */
function classLabels(gradeCode, section) {
  const m = /(\d+)/.exec(String(gradeCode || ''));
  if (!m) return { en: null, ur: null };
  const sec = String(section || '').trim();
  const tail = sec ? ` ${sec}` : '';
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

const kidIdsOf = (found, kidsIn) => [...new Set(found.flatMap((x) => kidsIn(x.id)))];

/** "share_code_id|student_id" of each finished sitting on these rounds by these children: one read (IN-chunked). */
async function finishedOn(shareCodeIds, studentIds) {
  const codes = [...new Set(shareCodeIds.filter(Boolean).map(String))];
  const out = new Set();
  if (!codes.length || !studentIds.length) return out;
  for (let i = 0; i < studentIds.length; i += IN_CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('quiz_sessions').select('share_code_id, student_id')
      .in('share_code_id', codes).in('student_id', studentIds.slice(i, i + IN_CHUNK)).not('completed_at', 'is', null);
    if (error) throw new Error(`finished sittings: ${error.message}`);
    (data || []).forEach((r) => out.add(`${r.share_code_id}|${r.student_id}`));
  }
  return out;
}

/** app_settings web_quiz_push_name_children (read as the reminders lane reads it: JSON true only; missing = off). */
async function namesOn() {
  const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', NAMES_KEY);
  if (error) return false;
  return ((data || []).find((r) => r && r.key === NAMES_KEY) || {}).value === true;
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
    const kidsIn = (classId) => [...new Set((enr || []).filter((e) => e.class_id === classId).map((e) => String(e.student_id)))];
    const found = classIds.map((id) => ({ id, link: (links || []).find((l) => l.class_id === id), round: rounds.get(String(id)) }))
      .filter((x) => x.link && x.round && CODE_RX.test(String(x.link.code)) && CODE_RX.test(String(x.round.round_code || '')));
    if (!found.length) return [];
    // Only what is still WAITING on this phone: a child who finished tonight's round (a completed sitting on its share
    // code) is not waiting, and a class whose phone-children all finished is left out. One read for every round.
    const finished = await finishedOn(found.map((x) => x.round.share_code_id), kidIdsOf(found, kidsIn));
    const ready = found.map((x) => ({ ...x, waiting: kidsIn(x.id).filter((id) => !finished.has(`${x.round.share_code_id}|${id}`)) }))
      .filter((x) => x.waiting.length);
    if (!ready.length) return [];
    // Children's first names only with the reminders' naming switch on (web_quiz_push_name_children); off or missing:
    // no students row is read at all, and each child is its student_id only.
    const want = withKids && (await namesOn()) ? [...new Set(ready.flatMap((x) => x.waiting))] : [];
    const { data: students } = want.length ? await supabase.from('students').select('id, student_name, student_name_urdu').in('id', want) : { data: null };
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
        out.kids = x.waiting.map((id) => {
          if (!students) return { student_id: id };
          const st = students.find((r) => String(r.id) === id);
          return { student_id: id, first: st ? firstOf(st.student_name) : null, first_ur: st ? firstOf(st.student_name_urdu) : null };
        });
      }
      return out;
    });
  } catch (err) {
    logToFile('⚠️ evening round: roundsReadyForPhone unavailable', { error: err.message });
    return [];
  }
}

module.exports = { roundsReadyForPhone, classLabels, teacherRef };
