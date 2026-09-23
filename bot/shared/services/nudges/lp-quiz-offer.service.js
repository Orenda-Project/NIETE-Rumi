'use strict';
/**
 * THE AFTERNOON QUIZ OFFER — a quiz written from the lessons a teacher
 * PLANNED today, with no recording anywhere in it.
 *
 * At 15:00 PKT the sweeper asks this module to build the day's cohort: every
 * teacher who took a K-5 lesson plan that counts for today, grouped by the
 * class they took it for. Each teacher gets exactly one `teacher_nudges` row —
 * `pending` when they are going to be asked, `skipped` with a reason when they
 * are not, so the funnel can count the teachers we deliberately left alone as well
 * as the ones we reached.
 *
 * THE THREE RULES THAT ARE NOT OBVIOUS FROM THE CODE
 *
 *  1. A lesson taken after 14:00 PKT counts for the NEXT school day (D2). A
 *     teacher planning tomorrow's lesson at 16:00 has not taught it yet, so
 *     quizzing their class on it this afternoon asks children about a lesson
 *     that has not happened. Friday afternoon therefore lands on Monday.
 *  2. Assessment segments (`_seg995`) are excluded and revision segments
 *     (`_seg990`) are included (D9). An assessment day already has its own
 *     paper; a revision day is exactly when a quiz is worth having.
 *  3. The answer key that rides along with an assessment is a separate
 *     download row pointing at an `asset_kind='answer_key'` asset. It is never
 *     a quiz source — a quiz written from the marking scheme hands children
 *     the answers.
 *
 * IDEMPOTENCE. The build is safe on every sweeper tick and on every replica:
 * a cheap count keyed on `nudge_date` short-circuits the work, and the real
 * guarantee is the `teacher_nudges` UNIQUE (user_id, nudge_date, kind) — a
 * second insert comes back `created:false` rather than a second offer.
 *
 * FLAG-GATED, read at call time: `LP_QUIZ_OFFER_ENABLED`. Unset, nothing is
 * read and nothing is written.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { pagedRows } = require('../../utils/postgrest-paged');
const PktTime = require('./pkt-time');
const { flagOn } = require('./flags');
const Store = require('./teacher-nudges.store');
const WhatsAppService = require('../whatsapp.service');
const { resolveUx } = require('../../config/ux-strings');
const { normalizeSubject, SUBJECT_NAMES_UR } = require('../../config/lp612-subject-order');
const { teacherLanguageFor, needsLanguageAsk, quizLanguageFor } = require('../quiz/transcript-quiz-language');
const Catalog = require('../lp-v8-catalog.service');
const { LP_V8 } = require('../quiz/quiz-sources');

/** The `teacher_nudges.kind` this module owns. */
const KIND = 'lp_quiz_offer';

/** Segments that are an assessment paper, not a lesson (D9). */
const ASSESSMENT_SUFFIX = '_seg995';

/**
 * PostgREST puts an `.in()` list in the URL, so it is chunked rather than sent
 * as one filter of unbounded length. 200 uuids ≈ 7.4 KB, comfortably inside
 * every proxy's request-line limit.
 */
const IN_CHUNK = 200;

/**
 * How far back the download window reaches. The cohort can only contain
 * lessons from today (before the cutoff) or from the previous school day
 * (after it) — and the longest gap between two school days is Friday to
 * Monday, three calendar days. Four is that plus a day of slack; the JS
 * `cohortRuleDate` filter, not this bound, decides what actually counts.
 */
const WINDOW_DAYS = 4;

/**
 * The order pre-checks run in, and the only reasons this module can record.
 * Order matters for the funnel: a teacher outside the pilot sectors should be
 * counted as "not piloted", not as "had no lesson", whichever is also true.
 */
const SKIP_REASONS_USED = [
  'not_school_day',
  'sector_not_piloted',
  'no_lesson',
  'coaching_yes_today',
  'coached_today',
  'offered_today',
  'sent_today',
  'window_closed',
];

// ─── flags ───────────────────────────────────────────────────────────────────

function enabled() {
  return flagOn('LP_QUIZ_OFFER_ENABLED');
}

/** An unreadable value falls back to the documented default rather than NaN. */
function intEnv(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

const sendHour = () => intEnv('LP_QUIZ_OFFER_SEND_HOUR_PKT', 15);
const sendMinute = () => intEnv('LP_QUIZ_OFFER_SEND_MINUTE_PKT', 0);
const cutoffHour = () => intEnv('LP_QUIZ_OFFER_CUTOFF_HOUR_PKT', 14);

/** Empty means every sector — that is the sandbox default (D10). */
function pilotSectors() {
  const raw = (process.env.LP_QUIZ_OFFER_SECTORS || '').trim();
  if (!raw) return null;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? new Set(list) : null;
}

// ─── pure rules ──────────────────────────────────────────────────────────────

/**
 * Which day's offer a lesson taken at `deliveredAt` belongs to (D2).
 * @param {Date|string} deliveredAt
 * @returns {string} a PKT calendar date, `YYYY-MM-DD`
 */
function cohortRuleDate(deliveredAt) {
  const at = deliveredAt instanceof Date ? deliveredAt : new Date(deliveredAt);
  const day = PktTime.pktDate(at);
  return PktTime.pktHour(at) < cutoffHour() ? day : PktTime.nextSchoolDay(day);
}

/**
 * The stable id for one class within one offer. It rides in a WhatsApp list
 * row id (`lpquiz_pick_<nudgeId>_<classKey>` — the nudge id is a uuid, which
 * has no underscore, so the parser splits on the first one) and it is stored
 * as the choice `class:<key>`, which the store admits only as [A-Za-z0-9_].
 * A hyphen here made recordAnswer throw on the very tap it records.
 */
function classKey(grade, subject) {
  const g = String(grade === null || grade === undefined ? '' : grade)
    .trim().replace(/[^0-9a-zA-Z]+/g, '').toLowerCase() || '0';
  const s = String(subject === null || subject === undefined ? '' : subject)
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'lesson';
  return `g${g}_${s}`;
}

/**
 * lesson_id → catalog topic, built once. The catalog is static (2,038 K-5 lessons).
 *
 * `topic` first: it is the clean name the lesson PDF's own caption prints
 * ("Comparing & ordering unlike fractions"). `topic_short` is the row's run-on
 * sub-headings cut at 80 code points ("Comparing / Ordering Unlike Fractions /
 * Discovery / Skill Sharpener — Comparing…") — a name the teacher never saw on
 * the lesson they took. It is only the fallback. The 72-code-point list-row cap
 * is held by `rowDescription`'s clip, not by the choice of name.
 */
let topicIndex = null;
function catalogTopic(lessonId) {
  if (!topicIndex) {
    topicIndex = new Map();
    try {
      for (const book of Catalog.catalog().books || []) {
        for (const chapter of book.chapters || []) {
          for (const lesson of chapter.lessons || []) {
            topicIndex.set(lesson.lesson_id, lesson.topic || lesson.topic_short || null);
          }
        }
      }
    } catch (err) {
      // No catalog means no topic in the copy, never no offer.
      logToFile('lp quiz offer: catalog unreadable — offers will name the class, not the lesson', { error: err.message }, 'error');
    }
  }
  return topicIndex.get(lessonId) || null;
}

/**
 * The lesson fields an offer and the quiz it makes both need. The topic is
 * resolved here, at build time, so the send and the quiz row read the same
 * words the teacher saw on the lesson they picked.
 */
function lessonOf(row) {
  return {
    lesson_id: row.lesson_id,
    asset_id: row.asset_id,
    version_stamp: row.version_stamp,
    content_hash: row.content_hash,
    delivered_at: row.created_at,
    topic: catalogTopic(row.lesson_id),
  };
}

/**
 * Download rows → one entry per teacher, their classes, each class's lessons
 * oldest first. A lesson taken twice (a resend) appears once.
 *
 * @param {object[]} rows
 * @returns {{userId: string, classes: {key: string, grade: *, subject: *, lessons: object[]}[]}[]}
 */
function groupLessons(rows) {
  const byTeacher = new Map();
  for (const row of rows || []) {
    if (!row || !row.user_id) continue;
    if (!byTeacher.has(row.user_id)) byTeacher.set(row.user_id, new Map());
    const classes = byTeacher.get(row.user_id);
    const key = classKey(row.grade, row.subject);
    if (!classes.has(key)) classes.set(key, { key, grade: row.grade, subject: row.subject, lessons: [] });
    const cls = classes.get(key);
    if (cls.lessons.some((l) => l.lesson_id === row.lesson_id)) continue;
    cls.lessons.push(lessonOf(row));
  }
  const out = [];
  for (const [userId, classes] of byTeacher) {
    const list = [...classes.values()].sort((a, b) => a.key.localeCompare(b.key));
    for (const cls of list) {
      cls.lessons.sort((a, b) => new Date(a.delivered_at) - new Date(b.delivered_at));
    }
    out.push({ userId, classes: list });
  }
  return out.sort((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * The one place that decides whether a teacher is asked. Pure, so the same
 * function runs at build time over the day's facts and again at send time over
 * fresher ones — a teacher coached between 15:00 and the send is not asked.
 *
 * @returns {string|null} the first reason that fails, or null
 */
function preChecks({
  isSchoolDay = true, sectorAllowed = true, lessonCount = 0,
  coachingYesToday = false, coachedToday = false, offeredToday = false,
  sentToday = false, windowOpen = true,
} = {}) {
  if (!isSchoolDay) return 'not_school_day';
  if (!sectorAllowed) return 'sector_not_piloted';
  if (!lessonCount) return 'no_lesson';
  if (coachingYesToday) return 'coaching_yes_today';
  if (coachedToday) return 'coached_today';
  if (offeredToday) return 'offered_today';
  if (sentToday) return 'sent_today';
  if (!windowOpen) return 'window_closed';
  return null;
}

// ─── reads ───────────────────────────────────────────────────────────────────

function chunks(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Has today's cohort already been built? One count, before any paging. */
async function alreadyBuilt(nudgeDate) {
  const { count, error } = await supabase
    .from('teacher_nudges')
    .select('id', { count: 'exact', head: true })
    .eq('kind', KIND)
    .eq('nudge_date', nudgeDate);
  if (error) {
    // Not fatal: the UNIQUE is the real guarantee, this read only saves work.
    logToFile('lp quiz offer: cohort count failed, building anyway', { nudgeDate, error: error.message }, 'error');
    return false;
  }
  return (count || 0) > 0;
}

/** Every `sent` v8 download whose rule date could be `nudgeDate`. */
async function downloadsFor(nudgeDate) {
  const upper = PktTime.atPkt(nudgeDate, cutoffHour(), 0);
  const lower = new Date(PktTime.atPkt(nudgeDate, 0, 0).getTime() - WINDOW_DAYS * 86400000);
  const rows = await pagedRows('lp quiz offer: downloads', () => supabase
    .from('niete_lp_downloads')
    .select('user_id, lesson_id, asset_id, version_stamp, content_hash, grade, subject, chapter_number, segment_index, created_at')
    .eq('status', 'sent')
    .gte('created_at', lower.toISOString())
    .lt('created_at', upper.toISOString()));
  return rows.filter((r) => r.asset_id && cohortRuleDate(r.created_at) === nudgeDate);
}

/** The asset ids that are a LESSON — an answer key is never a quiz source. */
async function lessonAssetIds(assetIds) {
  const found = new Set();
  for (const part of chunks([...new Set(assetIds)])) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await pagedRows('lp quiz offer: assets', () => supabase
      .from('niete_lp_assets')
      .select('id, asset_kind')
      .in('id', part));
    for (const row of rows) if (row.asset_kind === 'lesson') found.add(row.id);
  }
  return found;
}

async function teachersById(userIds) {
  const byId = new Map();
  for (const part of chunks(userIds)) {
    // eslint-disable-next-line no-await-in-loop
    // `*`, not a column list: `deleted_at` is live on some environments and not
    // in the repo schema, and a select naming a column the table lacks makes
    // PostgREST refuse the WHOLE read. A missing column reads as undefined here.
    const rows = await pagedRows('lp quiz offer: teachers', () => supabase
      .from('users')
      .select('*')
      .in('id', part)
      .eq('role', 'teacher'));
    // `is_test_user` is filtered HERE, not with `.neq('is_test_user', true)`:
    // neq is SQL `<>`, which drops NULL rows, and the column is null for most
    // real teachers. A neq would quietly empty the cohort.
    for (const row of rows) if (row.is_test_user !== true && !row.deleted_at) byId.set(row.id, row);
  }
  return byId;
}

async function sectorsBySchool(schoolIds) {
  const bySchool = new Map();
  if (!schoolIds.length) return bySchool;
  for (const part of chunks(schoolIds)) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await pagedRows('lp quiz offer: schools', () => supabase
      .from('schools')
      .select('id, region')
      .in('id', part));
    for (const row of rows) bySchool.set(row.id, row.region);
  }
  return bySchool;
}

/** `users.school_id` → `schools.region`, falling back to `users.region`. */
function sectorFor(user, bySchool) {
  const viaSchool = user.school_id ? bySchool.get(user.school_id) : null;
  return viaSchool || user.region || null;
}

async function idsWithRowToday(table, column, ids, sinceIso) {
  const found = new Set();
  for (const part of chunks(ids)) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await pagedRows(`lp quiz offer: ${table}`, () => supabase
      .from(table)
      .select(column)
      .in(column, part)
      .gte('created_at', sinceIso));
    for (const row of rows) found.add(row[column]);
  }
  return found;
}

async function coachingYesToday(ids, nudgeDate) {
  const found = new Set();
  for (const part of chunks(ids)) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await pagedRows('lp quiz offer: coaching ask', () => supabase
      .from('teacher_nudges')
      .select('user_id')
      .in('user_id', part)
      .eq('kind', 'coaching_after_lp')
      .eq('nudge_date', nudgeDate)
      .eq('choice', 'yes'));
    for (const row of rows) found.add(row.user_id);
  }
  return found;
}

// ─── the build ───────────────────────────────────────────────────────────────

/**
 * Build one school day's cohort. Safe to call on every tick and from every
 * replica.
 *
 * @param {{nudgeDate: string, now: Date}} args
 * @returns {Promise<{inserted: number, skipped: Object<string, number>, built: boolean}>}
 */
async function buildCohort({ nudgeDate, now }) {
  const skipped = {};
  const bump = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };

  if (!enabled()) {
    return { inserted: 0, skipped: { disabled: 1 }, built: false };
  }
  if (!PktTime.isSchoolDay(nudgeDate)) {
    return { inserted: 0, skipped: { not_school_day: 1 }, built: false };
  }
  if (await alreadyBuilt(nudgeDate)) {
    return { inserted: 0, skipped: {}, built: false };
  }

  const downloads = await downloadsFor(nudgeDate);
  if (!downloads.length) {
    logEvent('lp_quiz.cohort_built', { nudgeDate, candidates: 0, inserted: 0 });
    return { inserted: 0, skipped: {}, built: true };
  }

  const lessonAssets = await lessonAssetIds(downloads.map((r) => r.asset_id));
  const quizzable = downloads.filter((r) => lessonAssets.has(r.asset_id)
    && !String(r.lesson_id || '').endsWith(ASSESSMENT_SUFFIX));

  // The candidate set is the RAW download rows: a teacher whose only lesson
  // was an assessment still earns a `no_lesson` row, which is how the funnel
  // sees that teacher at all.
  const candidateIds = [...new Set(downloads.map((r) => r.user_id).filter(Boolean))];
  const teachers = await teachersById(candidateIds);
  const ids = [...teachers.keys()];
  if (!ids.length) {
    logEvent('lp_quiz.cohort_built', { nudgeDate, candidates: candidateIds.length, inserted: 0 });
    return { inserted: 0, skipped: {}, built: true };
  }

  const sectors = pilotSectors();
  const bySchool = sectors
    ? await sectorsBySchool([...new Set(ids.map((id) => teachers.get(id).school_id).filter(Boolean))])
    : new Map();

  const dayStart = PktTime.atPkt(nudgeDate, 0, 0).toISOString();
  const coached = await idsWithRowToday('coaching_sessions', 'user_id', ids, dayStart);
  const offered = await idsWithRowToday('quizzes', 'teacher_id', ids, dayStart);
  const saidYes = await coachingYesToday(ids, nudgeDate);

  const byTeacher = new Map(groupLessons(quizzable).map((g) => [g.userId, g.classes]));
  const scheduledAt = PktTime.deferQuietHours(PktTime.atPkt(nudgeDate, sendHour(), sendMinute()));

  let inserted = 0;
  for (const userId of ids) {
    const user = teachers.get(userId);
    const classes = byTeacher.get(userId) || [];
    const sector = sectorFor(user, bySchool);
    const reason = preChecks({
      isSchoolDay: true,
      sectorAllowed: !sectors || (sector !== null && sectors.has(sector)),
      lessonCount: classes.reduce((n, c) => n + c.lessons.length, 0),
      coachingYesToday: saidYes.has(userId),
      coachedToday: coached.has(userId),
      offeredToday: offered.has(userId),
    });

    // eslint-disable-next-line no-await-in-loop
    const { row, created } = await Store.schedule({
      userId,
      kind: KIND,
      nudgeDate,
      scheduledAt,
      context: { classes, sector, built_at: new Date(now || Date.now()).toISOString() },
    });
    if (!created) continue;                 // another replica got here first
    if (reason) {
      // eslint-disable-next-line no-await-in-loop
      await Store.markSkipped(row.id, reason, { classes: classes.length });
      bump(reason);
      continue;
    }
    inserted += 1;
  }

  logEvent('lp_quiz.cohort_built', {
    nudgeDate, candidates: candidateIds.length, inserted, skipped,
  });
  return { inserted, skipped, built: true };
}

/**
 * The sweeper's per-kind hook. Called on every tick; builds at most once a day.
 * @param {{now?: Date}} args
 */
async function prepare({ now } = {}) {
  const at = now ? new Date(now) : new Date();
  if (!enabled()) return { built: false, inserted: 0, reason: 'disabled' };
  const nudgeDate = PktTime.pktDate(at);
  const due = PktTime.pktHour(at) > sendHour()
    || (PktTime.pktHour(at) === sendHour() && PktTime.pktMinute(at) >= sendMinute());
  if (!due) return { built: false, inserted: 0, reason: 'before_send_time' };
  return buildCohort({ nudgeDate, now: at });
}

// ─── the send (the sweeper's handler for this kind) ──────────────────────────

/** The free-form window a teacher opens by writing to the bot (D3). */
const WINDOW_MS = 24 * 60 * 60 * 1000;
/** WhatsApp: 10 list rows in total, so nine classes plus "Not today". */
const MAX_CLASS_ROWS = 9;
/** WhatsApp field caps, in code points. */
const CAPS = Object.freeze({ rowTitle: 24, rowDesc: 72, button: 20, footer: 60 });
const QUIZ_SOURCE = LP_V8;            // never 'lesson_plan', the column default
/** A language's own digits, where its prose uses them (Urdu: U+06F0–06F9, never ٠١٢٣). */
const NATIVE_DIGITS = Object.freeze({ ur: '۰۱۲۳۴۵۶۷۸۹' });
/** A language's own subject names, keyed on the lp612 canonical name. English is the name itself. */
const SUBJECT_NAMES = Object.freeze({ ur: SUBJECT_NAMES_UR });

const cps = (s) => [...String(s == null ? '' : s)].length;

function digitsFor(n, language) {
  const str = String(n == null ? '' : n);
  const digits = NATIVE_DIGITS[language];
  return digits ? str.replace(/[0-9]/g, (d) => digits[Number(d)]) : str;
}

const titleCase = (s) => String(s || '').split(' ').filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** When the full English name would overflow a 24-code-point row title. */
const EN_SHORT = Object.freeze({
  'general science': 'Science',
  'general knowledge': 'Gen. Knowledge',
  'social studies': 'Social Studies',
  'pakistan studies': 'Pak Studies',
});

/**
 * A subject as the teacher reads it. Download rows carry the catalog key
 * (`math`, `general_science`); the lp612 folding maps every spelling to one
 * canonical name, which is what the Urdu table is keyed on.
 */
function subjectName(subject, language, { short = false } = {}) {
  const canon = normalizeSubject(String(subject == null ? '' : subject).replace(/_/g, ' '));
  const local = SUBJECT_NAMES[language];
  if (local && local[canon]) return local[canon];
  if (short && EN_SHORT[canon]) return EN_SHORT[canon];
  return titleCase(canon) || 'Lesson';
}

/** "Grade 4 · Mathematics", fitted to the 24-code-point list row title. */
function rowTitle(cls, language) {
  const grade = digitsFor(cls.grade, language);
  const make = (short) => resolveUx('lpQuizOfferRowTitle', {
    language, params: { grade, subject: subjectName(cls.subject, language, { short }) },
  });
  let title = make(false);
  if (cps(title) > CAPS.rowTitle) title = make(true);
  return Catalog.clip(title, CAPS.rowTitle);
}

/** The topics of a class's lessons, fitted to the 72-code-point description. */
function rowDescription(cls, language) {
  const topics = (cls.lessons || []).map((l) => l.topic).filter(Boolean).join(' · ');
  if (!topics) return null;
  const overhead = cps(resolveUx('lpQuizOfferRowDesc', { language, params: { topics: '' } }));
  return resolveUx('lpQuizOfferRowDesc', {
    language, params: { topics: Catalog.clip(topics, CAPS.rowDesc - overhead) },
  });
}

function shapeOf(classes) {
  if (classes.length > 1) return 'list';
  return classes[0].lessons.length > 1 ? 'class' : 'one';
}

function yesNoButtons(nudgeId, language) {
  return [
    { id: `lpquiz_yes_${nudgeId}`, title: resolveUx('lpQuizYes', { language }) },
    { id: `lpquiz_no_${nudgeId}`, title: resolveUx('lpQuizNo', { language }) },
  ];
}

async function teacherById(userId) {
  const { data, error } = await supabase.from('users')
    .select('*')              // see teachersById: never name deleted_at
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`lp quiz offer: user read failed — ${error.message}`);
  if (!data || !data.phone_number || data.deleted_at) {
    throw new Error(`lp quiz offer: user ${userId} not found`);
  }
  return data;
}

async function hasRowSince(table, column, userId, sinceIso) {
  const { data, error } = await supabase.from(table)
    .select('id')
    .eq(column, userId)
    .gte('created_at', sinceIso)
    .limit(1);
  if (error) throw new Error(`lp quiz offer: ${table} read failed — ${error.message}`);
  return (data || []).length > 0;
}

/**
 * The facts `preChecks` needs, read fresh at send time: the cohort was built at
 * 15:00 and the day can have moved since (a coaching session, a yes to the
 * coaching ask, a closed window).
 */
async function sendTimeFacts(row, user, at) {
  const since = PktTime.atPkt(row.nudge_date, 0, 0).toISOString();
  const last = user.last_message_at ? new Date(user.last_message_at).getTime() : NaN;
  const [coachedToday, offeredToday, coachingRow, todays] = await Promise.all([
    hasRowSince('coaching_sessions', 'user_id', row.user_id, since),
    hasRowSince('quizzes', 'teacher_id', row.user_id, since),
    Store.todayRow(row.user_id, 'coaching_after_lp', row.nudge_date),
    Store.rowsFor(row.user_id, { kind: KIND, fromDate: row.nudge_date, toDate: row.nudge_date }),
  ]);
  return {
    windowOpen: Number.isFinite(last) && at.getTime() - last < WINDOW_MS,
    coachedToday,
    offeredToday,
    coachingYesToday: Boolean(coachingRow && coachingRow.choice === 'yes'),
    sentToday: (todays || []).some((r) => r.id !== row.id && r.status === 'sent'),
  };
}

/**
 * Deliver one claimed `lp_quiz_offer` row. The sweeper records the outcome —
 * this function never marks the row itself, or every row would be written twice.
 *
 * @returns {Promise<{sent:true, messageIds:string[], context:Object}|{skipped:string}>}
 * @throws when the teacher is gone or WhatsApp refuses — the sweeper marks the
 *   row failed, which is a defect to look at, never a quiet success.
 */
async function send(row, { now } = {}) {
  const at = now ? new Date(now) : new Date();
  const skip = (reason) => {
    logEvent('lp_quiz.offer_skipped', { nudgeId: row.id, userId: row.user_id, reason, at: 'send' });
    return { skipped: reason };
  };

  if (!enabled()) return skip('disabled');
  const classes = ((row.context && row.context.classes) || []).filter((c) => c && (c.lessons || []).length);
  const lessonCount = classes.reduce((n, c) => n + c.lessons.length, 0);
  if (!lessonCount) return skip('no_lesson');

  const user = await teacherById(row.user_id);
  const reason = preChecks({
    isSchoolDay: true, sectorAllowed: true, lessonCount, ...(await sendTimeFacts(row, user, at)),
  });
  if (reason) return skip(reason);

  const language = teacherLanguageFor({ preferredLanguage: user.preferred_language });
  const shape = shapeOf(classes);
  const to = user.phone_number;
  const context = { shape, class_count: classes.length, language };
  // Meta's message id, kept on the row (context.message_ids) so "did this
  // teacher get the offer?" can be matched to a delivery webhook. Reported by
  // the send; the boolean it returns stays the delivery verdict.
  const messageIds = [];
  const sendOpts = { onMessageId: (id) => messageIds.push(id) };
  let ok;

  if (shape === 'list') {
    const shown = classes.slice(0, MAX_CLASS_ROWS);
    const dropped = classes.slice(MAX_CLASS_ROWS).map((c) => c.key);
    const rows = shown.map((cls) => {
      const description = rowDescription(cls, language);
      return {
        id: `lpquiz_pick_${row.id}_${cls.key}`,
        title: rowTitle(cls, language),
        ...(description ? { description } : {}),
      };
    });
    rows.push({ id: `lpquiz_none_${row.id}`, title: resolveUx('lpQuizOfferNone', { language }) });
    const list = {
      body: { text: resolveUx('lpQuizOfferListBody', { language, params: { n: digitsFor(classes.length, language) } }) },
      action: {
        button: resolveUx('lpQuizOfferListButton', { language }),
        sections: [{ rows }],
      },
    };
    if (dropped.length) {
      list.footer = Catalog.clip(resolveUx('lpQuizOfferMore', {
        language, params: { n: digitsFor(dropped.length, language) },
      }), CAPS.footer);
      context.dropped_classes = dropped;
    }
    ok = await WhatsAppService.sendInteractiveMessage(to, list, sendOpts);
  } else {
    const cls = classes[0];
    const first = cls.lessons[0];
    const grade = digitsFor(cls.grade, language);
    const subject = subjectName(cls.subject, language);
    let body;
    if (shape === 'class') {
      body = resolveUx('lpQuizOfferClass', {
        language,
        params: { n: digitsFor(cls.lessons.length, language), grade, subject, topic: first.topic || subject },
      });
    } else if (first.topic) {
      body = resolveUx('lpQuizOfferOne', { language, params: { topic: first.topic } });
    } else {
      body = resolveUx('lpQuizOfferOneUntitled', { language, params: { grade, subject } });
    }
    ok = await WhatsAppService.sendInteractiveButtons(to, { body, buttons: yesNoButtons(row.id, language) }, sendOpts);
  }

  if (!ok) {
    logToFile('❌ lp quiz offer: WhatsApp refused the offer', { nudgeId: row.id, shape }, 'error');
    throw new Error(`lp quiz offer: WhatsApp refused the ${shape} offer`);
  }
  logEvent('lp_quiz.offer_sent', {
    nudgeId: row.id, userId: row.user_id, shape, classes: classes.length,
    dropped: (context.dropped_classes || []).length, language,
  });
  return { sent: true, messageIds, context };
}

// ─── the answer ──────────────────────────────────────────────────────────────

// A nudge id is a uuid (no underscore), so the first `_` after it starts the
// class key — which itself may contain underscores (`g5_general_science`).
const BUTTON_RX = /^lpquiz_(yes|no)_([^_]+)$/;
const PICK_RX = /^lpquiz_pick_([^_]+)_([a-z0-9_]+)$/;
const NONE_RX = /^lpquiz_none_([^_]+)$/;

async function reply(to, key, language) {
  const ok = await WhatsAppService.sendMessage(to, resolveUx(key, { language }));
  if (!ok) logToFile('❌ lp quiz offer: reply not delivered', { key }, 'error');
}

/**
 * The row a tap answers, or why it cannot be answered. A tap belongs to the
 * teacher the row was sent to, on a row that was sent, within a day of it.
 */
async function answerable(nudgeId, user, at) {
  const row = await Store.byId(nudgeId);
  if (!row || row.kind !== KIND) return { state: 'expired', row: null };
  if (user && user.id && row.user_id !== user.id) return { state: 'expired', row: null };
  if (row.quiz_id) return { state: 'already', row };
  if (row.status !== 'sent') return { state: 'expired', row };
  const sentAt = new Date(row.sent_at || row.scheduled_at).getTime();
  if (!Number.isFinite(sentAt) || at.getTime() - sentAt > WINDOW_MS) return { state: 'expired', row };
  return { state: 'open', row };
}

/**
 * The quizzes row for an LP-born quiz, exactly as PLAN_R8 §2.3 names it.
 *
 * `askLanguage`: the teacher has still to choose the quiz language, so the row
 * waits `offered` at `awaiting_language` — the state the transcript quiz's ask
 * leaves its own row in, which is what its tq_lang_ handler flips.
 */
async function insertQuiz(row, cls, { askLanguage = false } = {}) {
  const lessons = cls.lessons.map((l) => ({
    lesson_id: l.lesson_id,
    asset_id: l.asset_id,
    version_stamp: l.version_stamp,
    content_hash: l.content_hash,
    delivered_at: l.delivered_at,
  }));
  const first = cls.lessons[0];
  const { data, error } = await supabase.from('quizzes')
    .insert({
      teacher_id: row.user_id,
      quiz_source: QUIZ_SOURCE,
      coaching_session_id: null,
      lesson_plan_id: null,
      topic: first.topic || `${subjectName(cls.subject, 'en')} lesson`,
      grade: cls.grade == null ? null : String(cls.grade),
      subject: cls.subject || null,
      status: askLanguage ? 'offered' : 'generating',
      meta: {
        step: askLanguage ? 'awaiting_language' : 'digest',
        ...(askLanguage ? { awaiting_language: true } : {}),
        source: 'lp_offer',
        nudge_id: row.id,
        lessons,
        class: { grade: cls.grade, subject: cls.subject },
        lesson_date: row.nudge_date,
        claimed_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`lp quiz offer: quiz insert failed — ${error ? error.message : 'no row'}`);
  return data.id;
}

async function accept(nudgeId, key, from, user, at) {
  const language = teacherLanguageFor({ preferredLanguage: user && user.preferred_language });
  const { state, row } = await answerable(nudgeId, user, at);
  if (state === 'already') {
    await reply(from, 'tqAlreadyMaking', language);
    return true;
  }
  const classes = (row && row.context && row.context.classes) || [];
  const cls = state === 'open'
    ? (key ? classes.find((c) => c.key === key) : (classes.length === 1 ? classes[0] : null))
    : null;
  if (!cls || !(cls.lessons || []).length) {
    logEvent('lp_quiz.offer_answered', { nudgeId, choice: 'expired', state });
    await reply(from, 'lpQuizExpired', language);
    return true;
  }

  const choice = key ? `class:${key}` : 'yes';
  await Store.recordAnswer(row.id, { choice });
  logEvent('lp_quiz.offer_answered', { nudgeId, userId: row.user_id, choice });

  // The quiz language is the teacher's to choose, exactly as on the quiz born
  // from a recording: every subject but Urdu and Islamiyat is asked first.
  const askLanguage = needsLanguageAsk(cls.subject);
  const quizId = await insertQuiz(row, cls, { askLanguage });
  if (!(await Store.claimQuiz(row.id, quizId))) {
    // Another tap (or replica) claimed this offer first; its quiz is the one.
    const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
    if (error) logToFile('❌ lp quiz offer: could not remove the losing quiz row', { quizId, error: error.message }, 'error');
    logEvent('lp_quiz.quiz_claimed', { nudgeId, quizId, won: false });
    await reply(from, 'tqAlreadyMaking', language);
    return true;
  }

  // The quiz's own state machine: the ask, its answer, and the one place an
  // lp_v8 quiz is queued. Required here, never the other way round.
  const TranscriptQuizOffer = require('../quiz/transcript-quiz-offer.service');
  if (askLanguage) {
    // The transcript quiz's own ask and buttons (tq_lang_<code>_<quizId>); its
    // handler generates this row once the teacher answers. Nothing is queued
    // until then. The subject rule is the first, easy tap.
    // No digest yet (the author digests the planned lesson after the answer):
    // the ask's examples fit the class's subject.
    await TranscriptQuizOffer.sendLanguageAsk(quizId, from, language, quizLanguageFor(cls.subject, null), {
      subject: cls.subject,
    });
    logEvent('lp_quiz.language_asked', { nudgeId, quizId, userId: row.user_id, class: cls.key });
  } else if (!(await TranscriptQuizOffer.queueLpQuiz({ quizId, nudgeId: row.id, phone: from, language }))) {
    return true;
  }
  logEvent('lp_quiz.quiz_claimed', {
    nudgeId, quizId, won: true, userId: row.user_id, class: cls.key, lessons: cls.lessons.length, quiz_source: QUIZ_SOURCE,
    awaiting_language: askLanguage,
  });
  return true;
}

async function decline(nudgeId, from, user, at) {
  const language = teacherLanguageFor({ preferredLanguage: user && user.preferred_language });
  const { state, row } = await answerable(nudgeId, user, at);
  if (state === 'already') {
    await reply(from, 'tqAlreadyMaking', language);
    return true;
  }
  if (state !== 'open') {
    logEvent('lp_quiz.offer_answered', { nudgeId, choice: 'expired', state });
    await reply(from, 'lpQuizExpired', language);
    return true;
  }
  await Store.recordAnswer(row.id, { choice: 'no' });
  logEvent('lp_quiz.offer_answered', { nudgeId, userId: row.user_id, choice: 'no' });
  await reply(from, 'lpQuizDeclined', language);
  return true;
}

/** `lpquiz_yes_<id>` / `lpquiz_no_<id>`. False when the id is not ours. */
async function handleButton(buttonId, from, user, { now } = {}) {
  const m = BUTTON_RX.exec(buttonId || '');
  if (!m) return false;
  const at = now ? new Date(now) : new Date();
  return m[1] === 'yes' ? accept(m[2], null, from, user, at) : decline(m[2], from, user, at);
}

/** `lpquiz_pick_<id>_<classKey>` / `lpquiz_none_<id>`. False when the id is not ours. */
async function handleListPick(rowId, from, user, { now } = {}) {
  const at = now ? new Date(now) : new Date();
  const pick = PICK_RX.exec(rowId || '');
  if (pick) return accept(pick[1], pick[2], from, user, at);
  const none = NONE_RX.exec(rowId || '');
  if (none) return decline(none[1], from, user, at);
  return false;
}

// Registered at load: the worker requires this module, and the sweeper claims
// only kinds something in the process has registered. A failure here must not
// break the require chain (the webhook loads this module for the taps), so it
// is logged at error level: an unregistered kind is never claimed, silently.
try {
  require('./teacher-nudges.sweeper').register(KIND, (row, opts) => send(row, opts), { prepare });
} catch (err) {
  logToFile('lp quiz offer: sweeper registration failed — no offers will be sent', { error: err.message }, 'error');
}

module.exports = {
  KIND,
  SKIP_REASONS_USED,
  ASSESSMENT_SUFFIX,
  enabled,
  sendHour,
  sendMinute,
  cutoffHour,
  pilotSectors,
  cohortRuleDate,
  classKey,
  groupLessons,
  preChecks,
  sectorFor,
  buildCohort,
  prepare,
  send,
  rowTitle,
  handleButton,
  handleListPick,
};
