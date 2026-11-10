// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
/**
 * bd-snkn32 — "Make my own" lesson plan: the request, and the status read.
 *
 * WHAT IT IS. A teacher's five answers about her class rewrite the chapter's 6-12 plan for her room. The rewrite is
 * the existing edit lane (lp612-author reviseLessonPlan) applied to the STORED shared document, and the result is a
 * FORK under lp612/{tv}/{lang}/edits/ — the shared render, which has no user dimension, is never written. Her row in
 * niete_lp612_own_plans says she holds it.
 *
 * THE SHARED PLAN COMES FIRST. A fork needs the shared document to start from. When it has not been written yet, it
 * is asked for exactly as her tapping that plan would ask (Serving.requestLesson, surface portal), and her job waits
 * for it (lp612-own.worker). No new step for her.
 *
 * ENGLISH ONLY in this phase: the fork starts from the English document, because an Urdu document carries an overlay
 * the rewrite would leave stale. Urdu is a follow-up.
 *
 * STATUS RIDES THE 6-12 POLL. Her fork's id is answered by the same /lp612/status and /lp612/file the portal already
 * uses (lp612-browse renderStatus falls back here on a miss), so the waiting page, the viewer and the PDF relay need
 * no second path. The read is by id AND her user id, so nobody else's fork is ever answered.
 *
 * GRADES 1–5 (bd-snkn32.4). A `lessonId` (a grades 1–5 day) instead of a segment: the parent is that day's own stored
 * plan (its slide script), so nothing is asked for first, and the row carries `lesson_id` and the BOOK's language (an
 * Urdu book's plan is rewritten in Urdu). Same table (V1.9.7 widens it), same job type, same status poll.
 *
 * Dependencies are injected (createOwnService) so the rules are testable without Supabase, R2 or a queue.
 */

const { parseOwnAnswers } = require('./lp612-own-instruction');
const { parseK5Pages } = require('./lp-k5-own-pages');

const OWN_TABLE = 'niete_lp612_own_plans';
const OWN_JOB_TYPE = 'lp612_own';
const OWN_LANG = 'en';
/** The template of a grades 1–5 fork: the stored slide script, rewritten (lp-k5-own) and printed (lp-k5-own-render). */
const K5_TV = 'k5_own_v1';
/** Her status read. Plus the AI reviewer's library verdict (V1.9.9). */
const OWN_READ = 'id, user_id, segment_id, lesson_id, status, r2_key, error_code, lang, started_at, completed_at, '
  + 'library_eligible, review_score';

function createOwnService(deps) {
  const d = deps;

  async function queue(row, key, correlationId) {
    try {
      await d.queueJob(key, OWN_JOB_TYPE, { ownId: row.id, correlationId }, {
        // Volatile parts first, as lp612-serving's enqueue does: the clock keeps a retry from deduping away.
        deduplicationId: `${Date.now()}-${OWN_JOB_TYPE}-${row.id}`.slice(0, 128),
      });
    } catch (err) {
      d.log('LP 6-12 own: could not enqueue', { ownId: row.id, key, error: err.message, correlationId });
      await d.patchOwn(row.id, {
        status: 'failed', error_code: 'ENQUEUE_FAILED', error_detail: err.message, completed_at: new Date().toISOString(),
      });
      return { outcome: 'error' };
    }
    return { outcome: 'queued', ownId: row.id };
  }

  /** bd-snkn32.4 — a grades 1–5 day: its own stored plan is the parent, in its book's language. */
  async function requestK5({ userId, lessonId, answers, pages, correlationId }) {
    const lesson = await d.k5Lesson(lessonId);
    if (!lesson) return { outcome: 'not_found' };
    // bd-snkn32.17 — her own page range, checked against the day's pages; kept in her answers (JSONB, no new column).
    const p = parseK5Pages(pages, lesson.pages || null);
    if (!p.ok) return { outcome: 'bad_request', error: p.error };
    if (p.pages) answers = { ...answers, pages: p.pages };
    const row = await d.insertOwn({
      user_id: userId,
      lesson_id: lessonId,
      lang: lesson.lang, // already clamped to the book's language (lp-k5-own-source)
      template_version: K5_TV,
      status: 'authoring',
      answers,
      correlation_id: correlationId,
    });
    if (!row || !row.id) return { outcome: 'error' };
    return queue(row, lessonId, correlationId);
  }

  async function requestOwn({ userId, segmentId, lessonId, answers, correlationId = null } = {}) {
    if (!userId || (!segmentId === !lessonId)) {
      return { outcome: 'bad_request', error: 'userId and one of segmentId or lessonId are required' };
    }
    const parsed = parseOwnAnswers(answers);
    if (!parsed.ok) return { outcome: 'bad_request', error: parsed.error };
    if (lessonId) return requestK5({ userId, lessonId, answers: parsed.answers, pages: answers.pages, correlationId });
    if (!(await d.segmentExists(segmentId))) return { outcome: 'not_found' };

    const tv = d.templateVersion();
    const parent = await d.readStoredDoc({ segmentId, lang: OWN_LANG, tv, correlationId });
    if (!parent) {
      const asked = await d.requestParent({ segmentId, userId, lang: OWN_LANG, surface: 'portal', correlationId });
      const outcome = asked && asked.outcome;
      if (outcome === 'held' || outcome === 'not_found') return { outcome };
      if (outcome === 'error' || outcome === 'deliver_failed') return { outcome: 'error' };
    }

    const row = await d.insertOwn({
      user_id: userId,
      segment_id: segmentId,
      lang: OWN_LANG,
      template_version: tv,
      status: 'authoring',
      answers: parsed.answers,
      correlation_id: correlationId,
    });
    if (!row || !row.id) return { outcome: 'error' };

    return queue(row, segmentId, correlationId);
  }

  /** Her fork in the render row's shape (renderStatus), or null — never someone else's, never a throw. */
  async function ownStatus(ownId, userId) {
    if (!ownId || !userId) return null;
    let r;
    try {
      r = await d.selectOwn(ownId, userId);
    } catch (err) {
      d.log('LP 6-12 own: status read failed', { ownId, error: err.message });
      return null;
    }
    if (!r || r.user_id !== userId) return null;
    return {
      id: r.id,
      segment_id: r.segment_id || r.lesson_id || null, // bd-snkn32.4: a grades 1–5 fork names its day
      status: r.status,
      r2_key: r.r2_key,
      one_screen: null,
      error_code: r.error_code,
      lang: r.lang,
      started_at: r.started_at,
      completed_at: r.completed_at,
      library_eligible: r.library_eligible === true, // library only; never gates her plan
      review_score: r.review_score ?? null,
    };
  }

  return { requestOwn, ownStatus };
}

function logInsertFailed(log, row, err) {
  log('LP 6-12 own: insert failed', { segment: row.segment_id, reason: err.message });
}

/** Is this segment in the catalogue? (A plain function: the schema guards read `.from()` calls written this way.) */
async function segmentExists(supabase, segmentId) {
  const { data, error } = await supabase
    .from('niete_lp612_segments')
    .select('segment_id')
    .eq('segment_id', segmentId)
    .maybeSingle();
  return !error && !!data;
}

/** The real wiring. Lazy requires: the queue pulls the AWS SDK, and root suites run before bot/ npm ci. */
function liveDeps() {
  const supabase = require('../config/supabase');
  const { logToFile } = require('../utils/logger');
  const Serving = require('./lp612-serving.service');
  const { templateVersion } = require('../config/lp612-flags');
  return {
    templateVersion,
    segmentExists: (segmentId) => segmentExists(supabase, segmentId),
    readStoredDoc: (args) => Serving.readStoredDoc(args),
    k5Lesson: (lessonId) => require('./lp-k5-own-source').k5Lesson(lessonId),
    requestParent: (args) => Serving.requestLesson(args),
    insertOwn: async (row) => {
      const out = await supabase.from('niete_lp612_own_plans').insert(row).select('id').single();
      if (out.error) logInsertFailed(logToFile, row, out.error);
      return out.error ? null : out.data;
    },
    patchOwn: async (id, fields) => {
      await supabase.from('niete_lp612_own_plans').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    },
    queueJob: (...args) => require('./queue').queueJob(...args),
    selectOwn: async (id, userId) => {
      const { data, error } = await supabase
        .from('niete_lp612_own_plans')
        .select(OWN_READ)
        .eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    log: (msg, meta) => logToFile(msg, meta),
  };
}

let live = null;
const service = () => { live = live || createOwnService(liveDeps()); return live; };

module.exports = {
  createOwnService,
  requestOwn: (args) => service().requestOwn(args),
  ownStatus: (id, userId) => service().ownStatus(id, userId),
  OWN_TABLE,
  OWN_JOB_TYPE,
  OWN_LANG,
  K5_TV,
  OWN_READ,
};
