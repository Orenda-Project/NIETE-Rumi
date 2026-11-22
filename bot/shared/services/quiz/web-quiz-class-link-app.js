'use strict';
/**
 * The teacher app's Home card for the standing class link (switch `web_quiz_class_link` with its parents; tonight's
 * line also `web_quiz_evening_round`; OFF by default). Served by the bot's internal class-link routes
 * (POST /api/internal/wq/cl/app and /app/tap), which the portal's /api/portal/class-link calls with the signed-in
 * teacher. Nothing here sends a message.
 *
 *   forApp(teacherId, {now})  null while off; else {classes, reportHref}. One entry per active class the teacher
 *                             teaches (class_teachers) that is inside the canary scope (web-quiz-class-link-canary.js,
 *                             asked BEFORE any mint: a class outside it is never minted) and has an enrolled roster:
 *                             {classId, grade, section, url, sendHref, sent, round}. `sendHref` is the wa.me link the
 *                             report card's Forward builds (forwardHref: the URL only, ?f=1). `sent`: the class's link
 *                             was sent or copied from the app this term. `round` (evening round on, a READY round
 *                             today): {lesson, played} — `played` counts children (each once) with a finished sitting;
 *                             never a name. `reportHref`: the teacher report's "Evening rounds" section, once a child
 *                             has played.
 *   tap({teacherId, classId, how})  Send ('forward') or Copy ('copy') from the card: forwardHref logs the forward
 *                             lane's quiz_forward_tap{surface 'class_link'} exactly as the report card does, and the
 *                             class is remembered as sent for the rest of the term. null (404) when off, outside the
 *                             canary, or not this teacher's class; nothing is logged or remembered then.
 *
 * "Sent this term" lives in Redis (one key per class per term, kept until the term ends): quiz_forward_tap is a log
 * line, not a row, so there is nothing in the database to read it back from. Losing the key only unfolds the card.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const CL = require('./web-quiz-class-link');
const Flags = require('./web-quiz-class-link-flags');

const IN_CHUNK = 200;
const FALLBACK_TOPIC = 'Lesson'; // the round writer's topic when its lesson has none (web-quiz-evening-round.js writeOne)

/**
 * The canary scope's helper, when this build has it. Absent (not deployed yet) → no restriction. Its answer must be
 * a literal true; a throw or anything else leaves the class out (fail closed).
 */
function canaryHelper() {
  try {
    return require('./web-quiz-class-link-canary');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('web-quiz-class-link-canary')) return null;
    throw err;
  }
}
async function inCanary(cls) {
  const C = canaryHelper();
  if (!C || typeof C.inCanary !== 'function') return true;
  try {
    return (await C.inCanary({ classId: cls.id, schoolId: cls.school_id || null })) === true;
  } catch (err) {
    logToFile('⚠️ class link app: canary check failed — class left out', { error: err.message });
    return false;
  }
}

const gradeOf = (gradeCode) => {
  const m = /(\d+)/.exec(String(gradeCode || ''));
  return m ? Number(m[1]) : null;
};
const sectionOf = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);
const sendHrefOf = (url) => `https://wa.me/?text=${encodeURIComponent(`${url}?f=1`)}`;

async function readIn(table, cols, col, ids, extra = (q) => q) {
  const out = [];
  const uniq = [...new Set((ids || []).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await extra(supabase.from(table).select(cols).in(col, uniq.slice(i, i + IN_CHUNK)));
    if (error) throw new Error(`class link app: ${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

/** The teacher's active classes (class_teachers → classes), canary scope applied, in grade then section order. */
async function teacherClasses(teacherId) {
  const { data: ct, error } = await supabase.from('class_teachers').select('class_id').eq('teacher_user_id', teacherId).eq('is_active', true);
  if (error) throw new Error(`class link app: class_teachers: ${error.message}`);
  const ids = [...new Set((ct || []).map((r) => r.class_id).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await readIn('classes', 'id, school_id, grade_code, section, is_active', 'id', ids, (q) => q.eq('is_active', true));
  const kept = [];
  for (const cls of rows) {
    if (gradeOf(cls.grade_code) == null) continue; // no grade, no "Class N" to show
    // eslint-disable-next-line no-await-in-loop
    if (await inCanary(cls)) kept.push(cls);
  }
  return kept.sort((a, b) => (gradeOf(a.grade_code) - gradeOf(b.grade_code)) || String(a.section || '').localeCompare(String(b.section || '')));
}

/** Tonight's READY rounds of these classes: classId -> {lesson, played}. {} while the evening round is off. */
async function roundsTonight(classIds, now) {
  const out = new Map();
  if (!classIds.length || !(await require('./web-quiz-evening-round-flags').eveningRoundOn())) return out;
  const day = require('../nudges/pkt-time').pktDate(now);
  const ready = await require('./web-quiz-evening-round').roundsForClasses(classIds, day);
  const rounds = [...ready.values()].filter((s) => s && s.quiz_id && s.share_code_id);
  if (!rounds.length) return out;
  const [quizzes, sittings] = await Promise.all([
    readIn('quizzes', 'id, topic', 'id', rounds.map((s) => s.quiz_id)),
    readIn('quiz_sessions', 'share_code_id, student_id, status, completed_at', 'share_code_id', rounds.map((s) => s.share_code_id), (q) => q.eq('status', 'completed')),
  ]);
  for (const s of rounds) {
    const topic = ((quizzes.find((q) => q.id === s.quiz_id) || {}).topic || '').trim();
    const kids = new Set(sittings.filter((x) => x.share_code_id === s.share_code_id && x.student_id && x.completed_at).map((x) => String(x.student_id)));
    out.set(String(s.class_id), { lesson: topic && topic !== FALLBACK_TOPIC ? topic : null, played: kids.size });
  }
  return out;
}

function reportHrefFor(teacherId) {
  const urls = require('./teacher-report-gate').reportUrls({ teacherId });
  return urls && urls.live ? `${urls.live}?tab=class#evening-rounds` : null;
}

async function forApp(teacherId, { now = new Date() } = {}) {
  if (!teacherId || !(await Flags.classLinkOn())) return null;
  const classes = await teacherClasses(teacherId);
  const cards = [];
  for (const cls of classes) {
    // eslint-disable-next-line no-await-in-loop
    const m = await CL.mint({ teacherId, classId: cls.id, now });
    const url = m && m.ok ? CL.linkUrl(m.code) : null;
    if (!url) continue;
    cards.push({
      classId: cls.id, grade: gradeOf(cls.grade_code), section: sectionOf(cls.section), url, sendHref: sendHrefOf(url),
      // eslint-disable-next-line no-await-in-loop
      sent: await CL.wasSent(cls.id, m.term_code), round: null,
    });
  }
  let rounds = new Map();
  try {
    rounds = await roundsTonight(cards.map((c) => c.classId), now);
  } catch (err) {
    logToFile('⚠️ class link app: tonight\'s rounds unreadable — no round line', { error: err.message });
  }
  cards.forEach((c) => { c.round = rounds.get(String(c.classId)) || null; });
  const reportHref = cards.some((c) => c.round && c.round.played > 0) ? reportHrefFor(teacherId) : null;
  return { classes: cards, reportHref };
}

async function tap({ teacherId, classId, how = 'forward' } = {}) {
  if (!teacherId || !classId || !(await Flags.classLinkOn())) return null;
  const { data: cls } = await supabase.from('classes').select('id, school_id').eq('id', classId).eq('is_active', true).maybeSingle();
  if (!cls || !(await inCanary(cls))) return null;
  const copy = how === 'copy';
  // The Copy's own answer is the report's class tab address; the app copied the link itself, so only the log counts.
  const href = await CL.forwardHref({ teacherId, classId, how: copy ? 'copy' : 'forward', reportBase: copy ? '/r' : null });
  if (!href) return null;
  // forwardHref remembers the class as sent this term (the same for the report's class tab), which folds this card.
  return copy ? { ok: true } : { ok: true, href };
}

module.exports = { forApp, tap, sentKey: CL.sentKey, _sendHrefOf: sendHrefOf };
