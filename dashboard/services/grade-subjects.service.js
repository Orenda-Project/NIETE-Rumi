'use strict';
/**
 * bd-fmf24g.3 — her grade·subject pairs, for the picker every teacher v2 feature opens with
 * (Lesson Plans, Digital Coaching, Assessment, Attendance): GET /api/portal/me/grade-subjects.
 *
 *   { combos: [{ grade, gradeCode, subject, subjectKey, source: 'class' | 'history' }] }
 *
 * WHERE THE PAIRS COME FROM
 * -------------------------
 *   1. Her CLASSES — class_teachers.grade_code × class_teacher_subjects.subject_code, read through
 *      the bot's /api/internal/classes/list: the same read the My Classes page uses, so the two
 *      cannot disagree about which classes she has. In her class order.
 *   2. Only when her classes give no pair (no classes yet, or a class with no subjects): her
 *      HISTORY, newest first — lesson plans she used (lp-activity, named by the bot), Digital
 *      Coaching lessons whose grade AND subject were resolved (analysis_data.subject_resolution,
 *      confidence above none), and papers she made. One pair once.
 *
 * Every spelling goes through subject-vocabulary.service (one key per subject), and the name is in
 * HER language (preferred_language; NIETE's offer is flat en/ur).
 *
 * FAILURE POLICY
 * --------------
 * A class read that fails THROWS: an empty list would tell her she has no classes. A history
 * source that fails loses only itself (logged at error level) — history is a convenience, and
 * two good sources are a better picker than none.
 *
 * ?feature= (withFeatureKeys) adds, per pair, the key that feature's catalogue wants back
 * (K-5 subject_key, the 6-12 corpus name, the assessment subject_key) and whether it has the
 * subject at all for that grade.
 */

const { subjectKey, subjectName, matchCatalogue, gradeOf } = require('./subject-vocabulary.service');

const FEATURES = Object.freeze(['lessons', 'assessment']);
const HISTORY_LIMIT = 50;

/** One pair, or null when the grade or the subject is not usable. */
function pair(gradeRaw, subjectRaw, source, lang) {
  const g = gradeOf(gradeRaw);
  const key = subjectKey(subjectRaw);
  if (!g || !key) return null;
  return { grade: g.grade, gradeCode: g.gradeCode, subject: subjectName(key, lang), subjectKey: key, source };
}

function dedupe(pairs) {
  const seen = new Set();
  return pairs.filter((p) => {
    if (!p) return false;
    const k = `${p.gradeCode}\u0000${p.subjectKey}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const HISTORY_SOURCES = [
  ['lessons', 'lpHistory'],
  ['coaching', 'coachingHistory'],
  ['assessment', 'assessmentHistory'],
];

async function fromHistory(userId, deps, lang) {
  const settled = await Promise.allSettled(HISTORY_SOURCES.map(([, fn]) => deps[fn](userId)));
  const rows = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      rows.push(...(r.value || []));
    } else {
      console.error('❌ grade-subjects: a history source failed', {
        source: HISTORY_SOURCES[i][0], error: r.reason && r.reason.message,
      });
    }
  });
  const time = (r) => { const t = Date.parse(r && r.at); return Number.isFinite(t) ? t : 0; };
  rows.sort((a, b) => time(b) - time(a));
  return dedupe(rows.map((r) => pair(r.grade, r.subject, 'history', lang)));
}

/**
 * @param {string} userId the SESSION's teacher
 * @param {{listClasses, lpHistory, coachingHistory, assessmentHistory, language}} deps
 */
async function gradeSubjects(userId, deps) {
  const [classes, lang] = await Promise.all([deps.listClasses(userId), deps.language(userId)]);
  const fromClasses = dedupe((classes || []).flatMap((c) => (c.subjects || [])
    .map((s) => pair(c.gradeCode, s && s.code, 'class', lang))));
  if (fromClasses.length) return { combos: fromClasses };
  return { combos: await fromHistory(userId, deps, lang) };
}

/**
 * Each pair with that feature's own key. `catalogue(grade)` → [{ key, name }]; read once per
 * grade. A read that fails throws — the picker cannot open anything without the keys.
 */
async function withFeatureKeys(combos, catalogue) {
  const grades = [...new Set(combos.map((c) => c.grade).filter((g) => g != null))];
  const entries = new Map(await Promise.all(grades.map(async (g) => [g, await catalogue(g)])));
  return combos.map((c) => {
    const hit = c.grade == null ? null : matchCatalogue(c.subjectKey, entries.get(c.grade));
    return { ...c, featureKey: hit ? hit.key : null, available: Boolean(hit) };
  });
}

/* ── the real sources ──────────────────────────────────────────────────── */

function botConfig() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

/** Her classes, from the bot — the read GET /api/portal/classes makes. Throws on any failure. */
async function listClassesFromBot(userId) {
  const axios = require('axios');
  const { baseUrl, apiKey } = botConfig();
  if (!baseUrl || !apiKey) throw new Error('classes API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  const res = await axios.post(`${baseUrl}/api/internal/classes/list`, { userId }, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  if (!res || !res.data || res.data.success !== true) throw new Error('classes/list returned failure');
  return res.data.classes || [];
}

/** DC lessons whose grade and subject were both resolved (confidence above none). */
const COACHING_HISTORY_SQL = `
  SELECT created_at AS at,
         analysis_data->'subject_resolution'->>'grade' AS grade,
         analysis_data->'subject_resolution'->>'code' AS subject
    FROM coaching_sessions
   WHERE user_id = $1::uuid
     AND analysis_data->'subject_resolution'->>'code' IS NOT NULL
     AND analysis_data->'subject_resolution'->>'grade' IS NOT NULL
   ORDER BY created_at DESC
   LIMIT $2`;

/** The real sources, over the portal's pool. */
function defaultDeps(query) {
  const LpActivity = require('./lp-activity.service');
  const LpCatalogue = require('./lp-catalogue.service');
  const Assessment = require('./assessment.service');
  return {
    listClasses: listClassesFromBot,
    async lpHistory(userId) {
      const plans = await LpActivity.plansUsed(query, userId, { limit: HISTORY_LIMIT, describe: LpCatalogue.describePlans });
      return plans.map((p) => ({ grade: p.grade, subject: p.subject, at: p.lastUsedAt }));
    },
    async coachingHistory(userId) {
      const { rows } = await query(COACHING_HISTORY_SQL, [userId, HISTORY_LIMIT]);
      return rows || [];
    },
    async assessmentHistory(userId) {
      const { papers } = await Assessment.listPapers(userId, { pageSize: HISTORY_LIMIT });
      return (papers || []).map((p) => ({ grade: p.grade, subject: p.subject_key, at: p.ready_at }));
    },
    async language(userId) {
      try {
        const { rows } = await query('SELECT preferred_language FROM users WHERE id = $1::uuid', [userId]);
        return rows && rows[0] && rows[0].preferred_language === 'ur' ? 'ur' : 'en';
      } catch (error) {
        // The floor, not a guess: a name in English is still her subject.
        console.error('❌ grade-subjects: language read failed', { error: error && error.message });
        return 'en';
      }
    },
  };
}

/** A feature's catalogue as grade → [{ key, name }]. */
function catalogueFor(feature) {
  if (feature === 'assessment') {
    const Assessment = require('./assessment.service');
    return async (grade) => {
      const data = await Assessment.options({ grade });
      return (data.subjects || []).map((s) => ({ key: s.subject_key, name: s.subject }));
    };
  }
  // lessons: grades 1-5 and 6-12 are two services; which one a grade is in is read off their
  // grade lists, never inferred from the number (the client's rule too, lessonPlansApi.ts).
  const LpCatalogue = require('./lp-catalogue.service');
  const Lp612 = require('./lp612.service');
  let lanes = null;
  const laneMap = () => {
    lanes = lanes || Promise.allSettled([LpCatalogue.listGrades(), Lp612.listGrades()]).then(([k5, g612]) => {
      if (k5.status === 'rejected' && g612.status === 'rejected') throw k5.reason;
      const map = new Map();
      const add = (r, lane) => {
        if (r.status !== 'fulfilled') return;
        for (const g of r.value || []) {
          const n = Number(g && g.grade);
          if (Number.isInteger(n) && !map.has(n)) map.set(n, lane);
        }
      };
      add(k5, 'k5');
      add(g612, 'g612');
      return map;
    });
    return lanes;
  };
  return async (grade) => {
    const lane = (await laneMap()).get(grade);
    if (lane === 'k5') {
      return (await LpCatalogue.listSubjects(grade)).map((s) => ({ key: String(s.subject_key), name: s.subject }));
    }
    if (lane === 'g612') {
      // 6-12 has no subject_key: its display name IS the key it wants back.
      return (await Lp612.listSubjects(grade)).map((s) => ({ key: String(s.subject), name: s.subject }));
    }
    return [];
  };
}

module.exports = {
  FEATURES,
  HISTORY_LIMIT,
  COACHING_HISTORY_SQL,
  gradeSubjects,
  withFeatureKeys,
  defaultDeps,
  catalogueFor,
};
