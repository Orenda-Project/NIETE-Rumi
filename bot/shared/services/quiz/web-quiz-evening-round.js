'use strict';
/**
 * THE EVENING ROUND — a ~5-minute round behind the class's standing link /j/<code> (switch `web_quiz_evening_round`,
 * OFF by default; effective only with `web_quiz_class_link` effective). Written at 16:00 PKT on a school day from the
 * lesson plan a teacher of the class took for that day (the offers' 14:00 cohort rule), plus TWO recall items per
 * child: questions this child got wrong 2-3 PKT days earlier, rewritten as NEW questions on the same skill.
 * Nothing here sends a message of any kind: no teacher WhatsApp, no PDF, no report.
 *
 *   writeRounds({ now, classIds, max, enqueue })  one round per class per PKT day: a quizzes row (lp_v8, status
 *                          generating, meta.source 'evening_round', class_id, round_day, class_link_code) and a
 *                          quiz_generate job with no phone. Idempotent: a Redis lock per class per day AND the
 *                          partial unique index of qfix_class_link_evening_round.sql. Logs one summary per call.
 *   tick({ now })          the worker's 16:00-19:59 PKT school-day tick (workers/evening-round-schedule.js)
 *   afterGenerate({ quiz, quizId, meta })  the generate step's hand-off for a round, IN PLACE of the teacher hand-off:
 *                          mints the round's share code (class_id set, no report), marks the lesson items and the
 *                          reading items, writes the recall pool (one model call per class), caches the class's
 *                          round for the day. No send, no PDF, no report.
 *   selectRoundItems(questions, { studentId })  pure: the 5 lesson items + the 2 recall items whose originals THIS
 *                          child missed (else the class's most-missed); any non-round set is returned as it is.
 *   isRoundShareCode(shareCodeId)  does this code belong to a round (the report's scheduler skips it)
 *   roundCandidate({ token, chosenId, history, lang })  the hub's "Tonight's round" tile for a child of the class
 *   viaOf(query) / classLinkOpen(...)   web_quiz.class_link_open{class_link_code, via}
 *   roundsReadyForPhone   in web-quiz-evening-round-phone.js (re-exported from web-quiz-class-link.js)
 *
 * Multi-teacher class: the lesson of whichever class teacher took one for the day; two -> the earlier delivered;
 * two subjects -> the earlier. Logged on web_quiz.round_written as teachers_with_lp / subjects_with_lp / chosen.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Flags = require('./web-quiz-evening-round-flags');
const Recall = require('./web-quiz-evening-round-recall');

const ROUND_SOURCE = 'evening_round';
// The generate step's phone for a round: never a number, so its failure lines are never sent (tellTeacherFailed).
const NO_SEND = 'evening_round:no_send';
const LP_V8 = 'lp_v8';
const LESSON_ITEMS = 5;
const RECALL_ITEMS = 2;
const TICK_FROM_H = 16;
const TICK_TO_H = 20;
const LOCK_TTL_S = 2 * 86400;
const CACHE_TTL_S = 36 * 3600;
const NONE_TTL_S = 10 * 60;
const IN_CHUNK = 200;
const LINK_CODE_RX = /^[A-Za-z0-9_-]{3,32}$/;
const maxPerTick = () => {
  const n = Number.parseInt(String(process.env.EVENING_ROUND_MAX_PER_TICK || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
};
const considerPerTick = () => Math.max(maxPerTick(), 200);

const lockKey = (classId, day) => `wq:er:lock:${classId}:${day}`;
const seenKey = (day) => `wq:er:seen:${day}`;
const roundKeyOf = (classId, day) => `${classId}|${day}`;
const cacheKey = (day, classId) => `wq:er:r:${day}:${classId}`;
const chunks = (xs, n = IN_CHUNK) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

const PktTime = () => require('../nudges/pkt-time');
const redisUp = () => {
  try {
    const r = require('../cache/railway-redis.service');
    return r && typeof r.isAvailable === 'function' && r.isAvailable() ? r : null;
  } catch (_) { return null; }
};

function isEveningRound(quiz) {
  return Boolean(quiz && quiz.meta && quiz.meta.source === ROUND_SOURCE);
}

// ── the lesson a class's teachers took for the day (the offers' rule) ───────────────────────────

const SUBJECT_CANON = {
  math: 'maths', maths: 'maths', mathematics: 'maths',
  science: 'science', general_science: 'science',
  english: 'english', urdu: 'urdu', islamiyat: 'islamiyat', islamiat: 'islamiyat',
  social_studies: 'social_studies', general_knowledge: 'general_knowledge',
};
const subjectCanon = (s) => {
  const k = String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return SUBJECT_CANON[k] || k;
};
const gradeOfCode = (code) => { const m = /(\d+)/.exec(String(code || '')); return m ? Number(m[1]) : null; };

/** One teacher's answer from the offers' export as a list of classes ([] when none). */
function classesOf(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((c) => c && Array.isArray(c.lessons));
  if (Array.isArray(v.classes)) return v.classes.filter((c) => c && Array.isArray(c.lessons));
  return [];
}

/**
 * teacher id -> [{ key, grade, subject, lessons:[{lesson_id, asset_id, version_stamp, content_hash, delivered_at, topic}] }]
 * for the plans whose cohort rule date is `day`. The offers lane's export first, in this order:
 *   lp-quiz-offer.service lpTakenFor(ids, day) -> Map | lpTakenToday(id, day) per teacher (in parallel);
 *   nudges/lp-taken the same names; else this module's own read of the same two sources (ownLpTaken).
 * Returns { by: Map, src }.
 */
async function lpTakenFor(teacherIds, day) {
  const ids = [...new Set((teacherIds || []).filter(Boolean).map(String))];
  const by = new Map();
  if (!ids.length) return { by, src: 'none' };
  for (const path of ['../nudges/lp-quiz-offer.service', '../nudges/lp-taken']) {
    let M = null;
    // eslint-disable-next-line global-require, import/no-dynamic-require
    try { M = require(path); } catch (_) { M = null; }
    if (!M) continue;
    if (typeof M.lpTakenFor === 'function') {
      const got = await M.lpTakenFor(ids, day);
      const entries = got instanceof Map ? [...got.entries()] : Object.entries(got || {});
      entries.forEach(([id, v]) => by.set(String(id), classesOf(v)));
      return { by, src: `${path.split('/').pop()}:lpTakenFor` };
    }
    if (typeof M.lpTakenToday === 'function') {
      const got = [];
      for (const part of chunks(ids, 20)) {
        // eslint-disable-next-line no-await-in-loop
        got.push(...await Promise.all(part.map((id) => Promise.resolve(M.lpTakenToday(id, day)).catch(() => []))));
      }
      ids.forEach((id, i) => by.set(id, classesOf(got[i])));
      return { by, src: `${path.split('/').pop()}:lpTakenToday` };
    }
  }
  return { by: await ownLpTaken(ids, day), src: 'own' };
}

/**
 * The fallback read, the same two sources and rule as the offers' downloadsFor: `sent` v8 downloads and the teacher
 * app's viewer opens (lp-app-opens.store viewerOpensAsDownloads, `external` opens excluded there), a lesson asset only,
 * whose cohortRuleDate is `day` (before the cutoff hour on the day, or after it on the previous school day).
 * Grouped by the offers' groupLessons (one class per grade+subject, lessons oldest first).
 */
async function ownLpTaken(ids, day) {
  const Offer = require('../nudges/lp-quiz-offer.service');
  const P = PktTime();
  const upper = P.atPkt(day, Offer.cutoffHour(), 0);
  const lower = new Date(P.atPkt(day, 0, 0).getTime() - 4 * 86400000);
  const want = new Set(ids);
  const rows = [];
  for (const part of chunks(ids)) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('niete_lp_downloads')
      .select('user_id, lesson_id, asset_id, version_stamp, content_hash, grade, subject, chapter_number, segment_index, created_at')
      .eq('status', 'sent').in('user_id', part).gte('created_at', lower.toISOString()).lt('created_at', upper.toISOString());
    if (error) throw new Error(`evening round: downloads: ${error.message}`);
    rows.push(...(data || []));
  }
  let opened = [];
  try {
    opened = (await require('./lp-app-opens.store').viewerOpensAsDownloads(lower.toISOString(), upper.toISOString())).filter((r) => want.has(String(r.user_id)));
  } catch (err) {
    logToFile('⚠️ evening round: app opens unreadable — WhatsApp downloads only', { error: err.message });
  }
  const taken = [...rows, ...opened].filter((r) => r.asset_id && Offer.cohortRuleDate(r.created_at) === day);
  const by = new Map();
  Offer.groupLessons(taken).forEach((t) => by.set(String(t.userId), t.classes));
  return by;
}

/**
 * The lesson for one class: among its teachers' lessons for the day whose grade is the class's (and, where the
 * teacher's subjects for this class are recorded, whose subject is one of them), the one delivered EARLIEST.
 * Returns { teacherId, grade, subject, lessons, teachers_with_lp, subjects_with_lp } or null.
 */
function chooseLesson({ grade, teachers = [], by }) {
  const options = [];
  for (const t of teachers) {
    const subjects = new Set((t.subjects || []).map(subjectCanon));
    for (const c of by.get(String(t.teacherId)) || []) {
      if (grade != null && Number(c.grade) !== grade) continue;
      if (subjects.size && !subjects.has(subjectCanon(c.subject))) continue;
      const lessons = (c.lessons || []).filter((l) => l && l.lesson_id && l.asset_id);
      if (!lessons.length) continue;
      const first = Math.min(...lessons.map((l) => Date.parse(l.delivered_at) || Infinity));
      options.push({ teacherId: String(t.teacherId), grade: c.grade, subject: c.subject, lessons, first });
    }
  }
  if (!options.length) return null;
  options.sort((a, b) => (a.first - b.first) || a.teacherId.localeCompare(b.teacherId));
  return {
    ...options[0],
    teachers_with_lp: new Set(options.map((o) => o.teacherId)).size,
    subjects_with_lp: new Set(options.map((o) => subjectCanon(o.subject))).size,
  };
}

// ── the writer ────────────────────────────────────────────────────────────────────────────────

async function liveLinks(now, classIds) {
  let q = supabase.from('class_links').select('code, class_id, teacher_id, expires_at, revoked_at').is('revoked_at', null)
    .gt('expires_at', now.toISOString());
  if (Array.isArray(classIds) && classIds.length) q = q.in('class_id', classIds.slice(0, IN_CHUNK));
  const { data, error } = await q;
  if (error) throw new Error(`evening round: links: ${error.message}`);
  const byClass = new Map();
  (data || []).forEach((l) => { if (!byClass.has(l.class_id)) byClass.set(l.class_id, l); });
  return byClass;
}

async function roundsOn(day, classIds = null) {
  // Every round of the day (one per class at most: the partial unique index), paged past PostgREST's max rows.
  const want = Array.isArray(classIds) && classIds.length ? new Set(classIds.map(String)) : null;
  const out = [];
  for (let from = 0; ; from += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('quizzes').select('id, status, meta')
      .eq('meta->>source', ROUND_SOURCE).eq('meta->>round_day', day).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`evening round: rounds: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return want ? out.filter((q) => q.meta && want.has(String(q.meta.class_id))) : out;
}

async function readIn(table, cols, col, ids, extra = (q) => q) {
  const out = [];
  for (const part of chunks([...new Set(ids)])) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await extra(supabase.from(table).select(cols).in(col, part));
    if (error) throw new Error(`evening round: ${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

async function seenOf(day) {
  const r = redisUp();
  if (!r) return new Set();
  try { const v = await r.get(seenKey(day)); return new Set(Array.isArray(v) ? v.map(String) : []); } catch (_) { return new Set(); }
}
async function addSeen(day, ids) {
  const r = redisUp();
  if (!r || !ids.length) return;
  try { const s = await seenOf(day); ids.forEach((id) => s.add(String(id))); await r.set(seenKey(day), [...s], LOCK_TTL_S); } catch (_) { /* next tick re-checks */ }
}

async function queueGenerate(quizId) {
  const SQS = require('../queue');
  await SQS.queueJob(quizId, 'quiz_generate', { quizId, source: ROUND_SOURCE }, { delaySeconds: 0 });
}

/** Writes one class's round. Returns 'queued' | 'locked' | 'exists' | 'failed'. */
async function writeOne({ cls, link, choice, enrolled, teacherIds, day, now, enqueue }) {
  const redis = redisUp();
  if (redis) {
    let got = true;
    try { got = await redis.setNX(lockKey(cls.id, day), { at: now.getTime() }, LOCK_TTL_S); } catch (_) { got = true; }
    if (!got) return 'locked';
  }
  const release = async () => { try { if (redis) await redis.delete(lockKey(cls.id, day)); } catch (_) { /* expires */ } };
  let misses = [];
  try {
    misses = await Recall.missesFor({ classId: cls.id, day, enrolled, teacherIds });
  } catch (err) {
    // No recall this evening (logged); the round still goes out with its lesson items.
    logToFile('⚠️ evening round: misses unreadable — no recall items tonight', { error: err.message });
  }
  const first = choice.lessons[0];
  const lessons = choice.lessons.map((l) => ({
    lesson_id: l.lesson_id, asset_id: l.asset_id, version_stamp: l.version_stamp, content_hash: l.content_hash, delivered_at: l.delivered_at,
  }));
  const { data: made, error } = await supabase.from('quizzes').insert({
    teacher_id: choice.teacherId,
    quiz_source: LP_V8,
    coaching_session_id: null,
    lesson_plan_id: null,
    topic: (first && first.topic) || 'Lesson',
    grade: choice.grade == null ? null : String(choice.grade),
    subject: choice.subject || null,
    status: 'generating',
    meta: {
      step: 'digest',
      source: ROUND_SOURCE,
      class_id: cls.id,
      round_day: day,
      class_link_code: link.code,
      lessons,
      class: { grade: choice.grade, subject: choice.subject },
      lesson_date: day,
      teachers_with_lp: choice.teachers_with_lp,
      subjects_with_lp: choice.subjects_with_lp,
      chosen: 'earliest',
      recall_src: misses.map((m) => ({
        qid: m.question.id, n: m.n, kids: m.missedBy, subject: (m.quiz && m.quiz.subject) || null, grade: (m.quiz && m.quiz.grade) || null,
      })),
      queued_at: now.toISOString(),
    },
  }).select('id').single();
  if (error || !made) {
    if (error && error.code === '23505') return 'exists';
    await release();
    logToFile('⚠️ evening round: quiz insert failed', { error: error ? error.message : 'no row' });
    return 'failed';
  }
  try {
    await (enqueue || queueGenerate)(made.id);
  } catch (err) {
    await supabase.from('quizzes').update({ status: 'failed', meta: { source: ROUND_SOURCE, class_id: cls.id, round_day: day, step: 'failed', error: 'queue_failed' } }).eq('id', made.id);
    await release();
    logToFile('⚠️ evening round: generate could not be queued', { quizId: made.id, error: err.message });
    return 'failed';
  }
  logEvent('web_quiz.round_queued', {
    quizId: made.id, class_link_code: link.code, n_recall_src: misses.length, teachers_with_lp: choice.teachers_with_lp,
    subjects_with_lp: choice.subjects_with_lp, chosen: 'earliest',
  });
  return 'queued';
}

/**
 * Write tonight's rounds. `classIds` limits the run (the manager's direct trigger); `max` caps the writes (default
 * EVENING_ROUND_MAX_PER_TICK, 30); at most 200 classes are considered per call and the rest wait for the next call
 * (`more`). `enqueue(quizId)` replaces the SQS job (a local run generates in-process). One summary line per call.
 */
async function writeRounds({ now = new Date(), classIds = null, max = maxPerTick(), enqueue = null } = {}) {
  const out = { day: null, considered: 0, queued: 0, exists: 0, locked: 0, no_lp: 0, no_roster: 0, failed: 0, more: false, lp_src: null };
  try {
    if (!(await Flags.eveningRoundOn())) { out.skipped = 'off'; return out; }
    const P = PktTime();
    const day = P.pktDate(now);
    out.day = day;
    if (!P.isSchoolDay(day)) { out.skipped = 'not_school_day'; return out; }
    const links = await liveLinks(now, classIds);
    const done = new Set((await roundsOn(day, classIds)).map((q) => q.meta && q.meta.class_id).filter(Boolean));
    const seen = Array.isArray(classIds) && classIds.length ? new Set() : await seenOf(day);
    const todo = [...links.keys()].filter((id) => !done.has(id) && !seen.has(id)).sort();
    out.exists = [...links.keys()].filter((id) => done.has(id)).length;
    const batch = todo.slice(0, considerPerTick());
    out.more = todo.length > batch.length;
    out.considered = batch.length;
    if (!batch.length) return out;
    const [classes, cts, enr] = await Promise.all([
      readIn('classes', 'id, grade_code, section, is_active', 'id', batch),
      readIn('class_teachers', 'id, class_id, teacher_user_id', 'class_id', batch, (q) => q.eq('is_active', true)),
      readIn('class_enrollments', 'class_id, student_id', 'class_id', batch, (q) => q.eq('is_active', true)),
    ]);
    const subj = await readIn('class_teacher_subjects', 'class_teacher_id, subject_code', 'class_teacher_id', cts.map((c) => c.id));
    const { by, src } = await lpTakenFor(cts.map((c) => c.teacher_user_id), day);
    out.lp_src = src;
    const finished = [];
    for (const classId of batch) {
      if (out.queued >= max) { out.more = true; break; }
      finished.push(classId);
      const cls = classes.find((c) => c.id === classId);
      if (!cls || cls.is_active === false) { out.no_roster += 1; continue; }
      const enrolled = enr.filter((e) => e.class_id === classId).map((e) => e.student_id);
      if (!enrolled.length) { out.no_roster += 1; continue; }
      const teachers = cts.filter((c) => c.class_id === classId).map((c) => ({
        teacherId: c.teacher_user_id, subjects: subj.filter((s) => s.class_teacher_id === c.id).map((s) => s.subject_code),
      }));
      const choice = chooseLesson({ grade: gradeOfCode(cls.grade_code), teachers, by });
      if (!choice) { out.no_lp += 1; continue; }
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await writeOne({ cls, link: links.get(classId), choice, enrolled, teacherIds: teachers.map((t) => t.teacherId), day, now, enqueue });
        out[r] = (out[r] || 0) + 1;
      } catch (err) {
        out.failed += 1;
        logToFile('⚠️ evening round: one class failed', { error: err.message });
      }
    }
    if (!(Array.isArray(classIds) && classIds.length)) await addSeen(day, finished);
    return out;
  } catch (err) {
    out.failed += 1;
    out.error = err.message;
    logToFile('⚠️ evening round: writer failed', { error: err.message });
    return out;
  } finally {
    logEvent('web_quiz.round_tick', out);
  }
}

/** The worker's tick: school days, 16:00-19:59 PKT only; else a logged skip. */
async function tick({ now = new Date(), enqueue = null } = {}) {
  const P = PktTime();
  const h = P.pktHour(now);
  if (h < TICK_FROM_H || h >= TICK_TO_H) {
    logToFile('evening round tick: outside 16:00-19:59 PKT', { pktHour: h });
    return { skipped: 'hours', pktHour: h };
  }
  return writeRounds({ now, enqueue });
}

// ── after generation: the round's code, its marks and its recall items (no send) ───────────────

/** The class round's summary, as the phone and the hub read it (cached per class per day). */
function summaryOf(quiz, meta, code, classRow) {
  return {
    quiz_id: quiz.id || null,
    class_id: meta.class_id,
    round_day: meta.round_day,
    class_link_code: meta.class_link_code,
    teacher_id: quiz.teacher_id,
    share_code_id: meta.share_code_id,
    round_code: code,
    ready_at: meta.round_ready_at,
    n_items: meta.n_items,
    n_recall: meta.n_recall,
    grade_code: classRow ? classRow.grade_code : null,
    section: classRow ? classRow.section : null,
  };
}

async function cacheRound(summary) {
  const r = redisUp();
  if (!r || !summary || !summary.class_id || !summary.round_day) return;
  try { await r.set(cacheKey(summary.round_day, summary.class_id), summary, CACHE_TTL_S); } catch (_) { /* the DB answers */ }
}

const ROUND_ROW_COLS = 'id, external_id, sort_order, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, media';

/** A recall item as a web item (media.web, single choice), so its read.* (and read.self) reach the page as stored. */
function asWebItem(row) {
  const opts = [row.option_a, row.option_b, row.option_c, row.option_d].filter((o) => o != null && String(o).trim());
  const SL = ['A', 'B', 'C', 'D'];
  const options = opts.map((t, i) => ({ slot: SL[i], text: String(t), name: String(t) }));
  const self = Boolean(row.media && row.media.self_read);
  return {
    ...row,
    media: {
      ...row.media,
      web: {
        v: 2, type: 'single', stem: row.question_text, options, key: row.correct_option, why: row.explanation || null, fb_right: null, wa: { from: 'same' },
        read: { stem: row.question_text, opts: options.map((o) => o.name), ...(self ? { self: true } : {}) },
      },
    },
  };
}

/**
 * The round's hand-off (transcript-quiz-generate.service calls it instead of the teacher's). Idempotent per step on a
 * redelivered job: the share code is reused when meta has one, the recall pool is written once (meta.recall_done).
 * `deps` = the boundaries a test or a local run replaces: { complete (the model call), mintCode }.
 */
async function afterGenerate({ quiz, quizId, meta: metaIn = null } = {}, deps = {}) {
  const T = require('./web-quiz-token');
  const { data: fresh } = await supabase.from('quizzes').select('id, teacher_id, subject, grade, language, status, meta').eq('id', quizId).maybeSingle();
  const row = fresh || quiz || {};
  let meta = { ...(row.meta || {}), ...(metaIn || {}) };
  meta.source = ROUND_SOURCE;
  const language = row.language || (quiz && quiz.language) || 'en';
  const roundKey = roundKeyOf(meta.class_id, meta.round_day);

  // 1. the round's share code: the class set, the chosen teacher's, minted once.
  let sc = null;
  if (meta.share_code_id) {
    const { data } = await supabase.from('quiz_share_codes').select('id, code').eq('id', meta.share_code_id).maybeSingle();
    sc = data || null;
  }
  if (!sc) {
    const mint = deps.mintCode || require('./video-quiz-share.service').mintCode;
    sc = await mint({ quizId, userId: row.teacher_id, videoId: null, language, classId: meta.class_id });
    if (!sc || !sc.id) throw new Error('evening round: share code not minted');
    meta.share_code_id = sc.id;
    meta.round_code = sc.code;
    await supabase.from('quizzes').update({ meta }).eq('id', quizId);
  }
  meta.round_code = sc.code;
  const ref = { cl: meta.class_link_code || null, rc: sc.code };

  // 2. the lesson items: marked as the round's, reading items marked shown-not-spoken.
  const { data: stored } = await supabase.from('quiz_questions').select(ROUND_ROW_COLS).eq('quiz_id', quizId).order('sort_order', { ascending: true });
  const lessonRows = (stored || []).filter((r) => !(r.media && r.media.round === 'recall'));
  let reading = 0;
  for (const r of lessonRows) {
    let next = { ...r, media: { ...(r.media || {}), round: 'lesson', round_key: roundKey, round_ref: ref } };
    if (Recall.isReadingItem(next, row.subject)) { next = Recall.markReading(next); reading += 1; }
    // eslint-disable-next-line no-await-in-loop
    await supabase.from('quiz_questions').update({ media: next.media }).eq('id', r.id);
  }

  // 3. the recall pool: one rewrite call for the class, written once.
  let nRecall = (stored || []).filter((r) => r.media && r.media.round === 'recall').length;
  if (!meta.recall_done) {
    const src = Array.isArray(meta.recall_src) ? meta.recall_src : [];
    let items = [];
    let spent = { costUsd: 0, model: null, usage: null, dropped: 0 };
    if (src.length) {
      const { data: qs } = await supabase.from('quiz_questions')
        .select('id, quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, media').in('id', src.map((s) => s.qid));
      const originals = src.map((s) => {
        const q = (qs || []).find((x) => x.id === s.qid);
        return q ? { question: q, quiz: { subject: s.subject, grade: s.grade }, missedBy: s.kids || [], n: s.n } : null;
      }).filter(Boolean);
      const complete = deps.complete || require('./transcript-quiz-llm').completeJson;
      spent = await Recall.rewrite({ originals, language, complete });
      items = spent.items;
    }
    const rows = Recall.recallRows({
      quizId, items, roundKey, subject: row.subject, chipOf: (id) => T.chipId(sc.id, id),
    }).map((r) => asWebItem({ ...r, media: { ...r.media, round_ref: ref } }));
    if (rows.length) {
      const { error } = await supabase.from('quiz_questions').insert(rows);
      if (error) throw new Error(`evening round: recall insert failed: ${error.message}`);
    }
    nRecall = rows.length;
    reading += rows.filter((r) => r.media && r.media.self_read).length;
    meta.recall_done = true;
    meta.recall_cost_usd = spent.costUsd || 0;
    meta.recall_model = spent.model || null;
    meta.recall_dropped = spent.dropped || 0;
    if (spent.usage) meta.recall_usage = { prompt_tokens: spent.usage.prompt_tokens || null, completion_tokens: spent.usage.completion_tokens || null };
    meta.cost_usd = (Number(meta.cost_usd) || 0) + (spent.costUsd || 0);
  }

  // 4. ready: the round's facts on its row (status stays 'ready': nothing is ever sent).
  meta = {
    ...meta, step: 'ready', round_ready_at: meta.round_ready_at || new Date().toISOString(),
    n_items: Math.min(LESSON_ITEMS, lessonRows.length) + Math.min(RECALL_ITEMS, nRecall), n_lesson: lessonRows.length, n_recall: nRecall, n_reading: reading,
  };
  await supabase.from('quizzes').update({ status: 'ready', meta }).eq('id', quizId);

  // 5. never a 12 h report: the report lane's own predicate, when it exports one, must agree.
  try {
    const Report = require('./video-quiz-report.service');
    if (typeof Report.isReportableShareCode === 'function' && (await Report.isReportableShareCode(sc.code))) {
      logToFile('⚠️ evening round: the report service calls this round reportable', { quizId });
      logEvent('web_quiz.round_reportable', { class_link_code: ref.cl, round_code: sc.code });
    }
  } catch (_) { /* the scheduler's own skip (isRoundShareCode) still holds */ }
  markRoundCode(sc.id, true);

  const { data: classRow } = await supabase.from('classes').select('id, grade_code, section').eq('id', meta.class_id).maybeSingle();
  await cacheRound(summaryOf({ ...row, id: quizId }, meta, sc.code, classRow));
  logEvent('web_quiz.round_written', {
    quizId, class_link_code: ref.cl, round_code: sc.code, n_items: meta.n_items, n_recall: nRecall, n_reading: reading,
    teachers_with_lp: meta.teachers_with_lp || null, subjects_with_lp: meta.subjects_with_lp || null, chosen: meta.chosen || 'earliest',
    recall_cost_usd: meta.recall_cost_usd || 0,
  });
  return { ok: true, quizId, code: sc.code, round: true };
}

// ── serving: which items this child plays ─────────────────────────────────────────────────────

const roundOf = (q) => (q && q.media && (q.media.round === 'lesson' || q.media.round === 'recall') ? q.media.round : null);
const sortOf = (q) => (q && Number.isFinite(Number(q.sort_order)) ? Number(q.sort_order) : Infinity);
const rankOf = (q) => Number((q.media.recall && q.media.recall.rank) || 99);

/**
 * The child's set of a round: the first LESSON_ITEMS lesson items (sort order) and RECALL_ITEMS recall items whose
 * originals THIS child missed (most-missed first), filled from the class's most-missed. Pure (no read): the children
 * who missed each original are stored on the item at write time. Questions that are not a round's come back as they
 * are (the same array). `studentId` absent -> the class's most-missed; `k` (the page's chip on the round's code)
 * picks like the id.
 */
function selectRoundItems(questions, { studentId = null, k = null } = {}) {
  if (!Array.isArray(questions) || !questions.some(roundOf)) return questions;
  const lesson = questions.filter((q) => roundOf(q) !== 'recall').sort((a, b) => sortOf(a) - sortOf(b)).slice(0, LESSON_ITEMS);
  const pool = questions.filter((q) => roundOf(q) === 'recall').sort((a, b) => rankOf(a) - rankOf(b));
  const missed = (q) => {
    const r = q.media.recall || {};
    if (studentId && Array.isArray(r.kids) && r.kids.includes(Recall.kidKey(q.media.round_key, studentId))) return true;
    return Boolean(k && Array.isArray(r.chips) && r.chips.includes(k));
  };
  const mine = pool.filter(missed);
  const chosen = [...mine, ...pool.filter((q) => !mine.includes(q))].slice(0, RECALL_ITEMS);
  return [...lesson, ...chosen];
}

/** The round's event fields from its served items, or null for any other quiz. */
function roundFields(questions) {
  const q = (questions || []).find(roundOf);
  if (!q) return null;
  const ref = q.media.round_ref || {};
  const set = questions.filter(roundOf);
  return { class_link_code: ref.cl || null, round_code: ref.rc || null, n_items: set.length, n_recall: set.filter((x) => roundOf(x) === 'recall').length };
}

/** web_quiz.round_started / round_done for a round's sitting (the shuffle seam's start and finish call it). */
function noteRound(stage, questions) {
  const f = roundFields(questions);
  if (!f || !['started', 'done'].includes(stage)) return false;
  logEvent(`web_quiz.round_${stage}`, f);
  return true;
}

// ── the report never fires for a round ───────────────────────────────────────────────────────

const ROUND_CODES = new Map(); // share code id -> boolean (a fact that never changes)
const ROUND_CODES_MAX = 5000;
function markRoundCode(id, v) {
  if (!id) return;
  if (ROUND_CODES.size >= ROUND_CODES_MAX) ROUND_CODES.delete(ROUND_CODES.keys().next().value);
  ROUND_CODES.set(id, v);
}

/** Is this share code an evening round's? Cached per process; a failed read is "no" (the report keeps today's rule). */
async function isRoundShareCode(shareCodeId) {
  if (!shareCodeId) return false;
  if (ROUND_CODES.has(shareCodeId)) return ROUND_CODES.get(shareCodeId);
  try {
    const { data: sc, error } = await supabase.from('quiz_share_codes').select('id, quiz_id').eq('id', shareCodeId).maybeSingle();
    if (error || !sc || !sc.quiz_id) return false;
    const { data: q, error: qErr } = await supabase.from('quizzes').select('id, meta').eq('id', sc.quiz_id).maybeSingle();
    if (qErr) return false;
    const yes = isEveningRound(q);
    markRoundCode(shareCodeId, yes);
    return yes;
  } catch (_) {
    return false;
  }
}

// ── the hub's tile ─────────────────────────────────────────────────────────────────────────────

// copy.v2.json / ux-strings.js qfix_class_link_round_title (EN + UR); the literal is the fallback when the key is absent.
const TILE_FALLBACK = { title: "Tonight's round", title_ur: 'آج شام کا راؤنڈ' };
function tileWords() {
  try {
    const { UX_STRINGS } = require('../../config/ux-strings');
    const t = UX_STRINGS && UX_STRINGS.qfix_class_link_round_title;
    if (t && t.en && t.ur) return { title: t.en, title_ur: t.ur };
  } catch (_) { /* the fallback */ }
  return TILE_FALLBACK;
}

/**
 * Today's ready rounds for these classes: classId -> summary. Redis first (written by afterGenerate), the DB for the
 * rest (one query), a short "none" for a class with no round yet.
 */
async function roundsForClasses(classIds, day) {
  const out = new Map();
  const ids = [...new Set((classIds || []).filter(Boolean).map(String))];
  if (!ids.length) return out;
  const r = redisUp();
  const miss = [];
  for (const id of ids) {
    let v = null;
    try { v = r ? await r.get(cacheKey(day, id)) : null; } catch (_) { v = null; }
    if (v && typeof v === 'object' && v.round_code) out.set(id, v);
    else if (!(v && v.none)) miss.push(id);
  }
  if (!miss.length) return out;
  const rows = (await roundsOn(day, miss)).filter((q) => q.status === 'ready' && q.meta && q.meta.round_code && q.meta.share_code_id);
  const classRows = rows.length ? await readIn('classes', 'id, grade_code, section', 'id', rows.map((q) => q.meta.class_id)) : [];
  const { data: owners } = rows.length ? await supabase.from('quizzes').select('id, teacher_id').in('id', rows.map((q) => q.id)) : { data: [] };
  for (const q of rows) {
    const s = summaryOf({ id: q.id, teacher_id: ((owners || []).find((o) => o.id === q.id) || {}).teacher_id }, q.meta, q.meta.round_code,
      classRows.find((c) => c.id === q.meta.class_id));
    out.set(String(q.meta.class_id), s);
    await cacheRound(s);
  }
  if (r) {
    for (const id of miss.filter((x) => !out.has(x))) {
      // eslint-disable-next-line no-await-in-loop
      try { await r.set(cacheKey(day, id), { none: true }, NONE_TTL_S); } catch (_) { /* read again next time */ }
    }
  }
  return out;
}

/**
 * The hub's "Tonight's round" candidate for a child of the class (the pinned primary, rule 'evening_round'), or null:
 * switch off, no class, no round today, or the child has already finished it. The class: the CHILD's active
 * enrollments (a shared phone's children may be in different classes), the pick's class only when there is none. href = the round's code with the child's chip on it.
 */
async function roundCandidate({ token = null, chosenId = null, history = [], lang = 'en', now = new Date() } = {}) {
  try {
    if (!chosenId || !(await Flags.eveningRoundOn())) return null;
    const T = require('./web-quiz-token');
    // The CHILD's classes (class_enrollments), never the link's: two children of two classes share one phone and one
    // link, and each child's own class round is theirs. The pick's class (cl.c) is only a fallback for a child with no
    // active enrollment row (it was picked from that class's roster).
    const { data } = await supabase.from('class_enrollments').select('class_id').eq('student_id', chosenId).eq('is_active', true);
    let classIds = (data || []).map((e) => e.class_id).filter(Boolean);
    if (!classIds.length) {
      const p = typeof token === 'string' ? T.verify(token, 'h') : null;
      classIds = p && p.cl && typeof p.cl.c === 'string' ? [p.cl.c] : [];
    }
    if (!classIds.length) return null;
    const day = PktTime().pktDate(now);
    const rounds = await roundsForClasses(classIds, day);
    const s = classIds.map((id) => rounds.get(String(id))).find(Boolean);
    if (!s || !s.share_code_id) return null;
    if ((history || []).some((e) => e && e.code === s.round_code && e.latest)) return null;
    const k = T.chipId(s.share_code_id, chosenId);
    if (!k) return null;
    const qk = require('./web-quiz-kid').qk(s.quiz_id) || crypto.createHash('sha256').update(`er|${s.quiz_id}`).digest('hex').slice(0, 10);
    return {
      kind: 'quiz', variant: 'evening_round', id: qk, href: `/q/${encodeURIComponent(s.round_code)}?k=${encodeURIComponent(k)}`,
      ...tileWords(), minutes: 5, art: '/wq/jugnu/thinking.webp', tag: 'New', tag_ur: 'نیا',
      rule: 'evening_round', sent_at: s.ready_at || null,
      round: { class_link_code: s.class_link_code, round_code: s.round_code, n_items: s.n_items, n_recall: s.n_recall },
      lang,
    };
  } catch (err) {
    logToFile('⚠️ evening round: hub tile unavailable', { error: err.message });
    return null;
  }
}

/** web_quiz.round_shown: the hub's next slot named the round as its primary. */
function noteShown(next, candidate) {
  if (!next || !candidate || next.id !== candidate.id || !candidate.round) return false;
  logEvent('web_quiz.round_shown', { ...candidate.round });
  return true;
}

// ── the standing link's open ───────────────────────────────────────────────────────────────────

const VIAS = new Set(['forward', 'reminder', 'hub', 'remembered']);
/** The landing's marker -> via: ?f=1 / ?from=fwd forward, ?from=push reminder, ?from=hub hub; else null (unmarked). */
function viaOf(q = {}) {
  const from = typeof q.from === 'string' ? q.from : null;
  if (from === 'push') return 'reminder';
  if (from === 'hub') return 'hub';
  if (q.f === '1' || q.f === 1 || from === 'fwd') return 'forward';
  return null;
}
/** web_quiz.class_link_open{class_link_code, via}: a code and a word, never a name or a phone. */
function classLinkOpen(code, via) {
  if (!LINK_CODE_RX.test(String(code || '')) || !VIAS.has(via)) return false;
  logEvent('web_quiz.class_link_open', { class_link_code: code, via });
  return true;
}

module.exports = {
  ROUND_SOURCE, NO_SEND, LESSON_ITEMS, RECALL_ITEMS, tileWords,
  isEveningRound, lpTakenFor, ownLpTaken, chooseLesson, subjectCanon, gradeOfCode, classesOf,
  writeRounds, tick, afterGenerate, asWebItem, selectRoundItems, roundFields, noteRound, isRoundShareCode,
  roundsForClasses, roundCandidate, noteShown, viaOf, classLinkOpen, cacheKey, lockKey,
  _resetCache: () => { ROUND_CODES.clear(); },
};
