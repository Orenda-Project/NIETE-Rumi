// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
/**
 * LP Coaching Linker Service
 *
 * Handles LP selection responses from the interactive list.
 * Links selected LP to coaching session, fetches LP content
 * for analysis, or triggers upload flow.
 *
 * Bead: (Phase 1C-D)
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { parseCorpusLessonId } = require('../subject-resolution');

/**
 * Parse the LP selection button ID to determine action and LP id.
 *
 * Button ID formats:
 *   lp_select_{lpId}_{sessionId} → select a recent LP
 *   lp_upload_{sessionId}        → upload new
 *   lp_none_{sessionId}          → no LP
 *
 * @param {string} buttonId
 * @returns {{ action: 'select'|'upload'|'none', lpId: string|null }}
 */
function parseSelectionId(buttonId) {
  if (buttonId.startsWith('lp_select_')) {
    // lp_select_{lpId}_{sessionId} — lpId is between 'lp_select_' and last '_sessionId'
    const withoutPrefix = buttonId.slice('lp_select_'.length);
    const lastUnderscore = withoutPrefix.lastIndexOf('_');
    const lpId = withoutPrefix.slice(0, lastUnderscore);
    return { action: 'select', lpId };
  }
  if (buttonId.startsWith('lp_upload_')) {
    return { action: 'upload', lpId: null };
  }
  if (buttonId.startsWith('lp_none_')) {
    return { action: 'none', lpId: null };
  }
  return { action: 'none', lpId: null };
}

/**
 * bd-r2uzg1.18.6 — a database error on a pick is NOT "this plan does not exist". On 28 Oct a PostgREST
 * schema-cache outage (PGRST002) failed the corpus lookup, the lesson_plans fallback failed the same way, and
 * the linker answered 'none': the coach had tapped Yes on the teacher's plan and the report scored no plan.
 * Every read and write on the pick path now goes through withDbRetry: a database error is retried
 * (LINK_RETRY_DELAYS_MS), and if it does not clear the linker THROWS an LP_LINK_DB_ERROR, so the caller can
 * stop the step and ask for the tap again instead of carrying on without the plan. "No row" is not an error.
 */
const LINK_RETRY_DELAYS_MS = [500, 1500];
const NO_ROWS = 'PGRST116'; // .single() on zero rows: the plan is not in that table — an answer, not a failure

function linkDbError(step, error) {
  const err = new Error(`lesson-plan link failed at ${step}: ${(error && error.message) || error}`);
  err.code = 'LP_LINK_DB_ERROR';
  err.step = step;
  err.dbCode = (error && error.code) || null;
  return err;
}

/** Run a PostgREST call; retry while it returns (or throws) a database error; throw LP_LINK_DB_ERROR after. */
async function withDbRetry(step, run, deps = {}) {
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const delays = deps.retryDelaysMs || LINK_RETRY_DELAYS_MS;
  let lastError = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    let res;
    try {
      res = await run();
    } catch (thrown) {
      lastError = thrown;
      continue;
    }
    const error = res && res.error;
    if (!error || error.code === NO_ROWS) return res || {};
    lastError = error;
  }
  logToFile('LP link: database error did not clear after retries', {
    step, attempts: delays.length + 1, code: (lastError && lastError.code) || null, error: lastError && lastError.message,
  });
  throw linkDbError(step, lastError);
}

function corpusRefFrom(data) {
  if (!data || !data.lesson_id) return null;
  // The ref is the ONLY thing a corpus-linked session carries where the plan's
  // structure would otherwise be: `lesson_plan_structured` is REPLACED by
  // `{_fidelity_ref: …}`, so every consumer reading `lesson_plan_structured.subject`
  // read null on the corpus path. The subject is not a new fact to fetch — the
  // lesson_id encodes it — it just has to be carried forward here.
  // niete_lp_assets holds no subject/grade column, so nothing is added to the query.
  const parsed = parseCorpusLessonId(data.lesson_id);
  return {
    lesson_id: data.lesson_id,
    version_stamp: data.version_stamp,
    content_hash: data.content_hash,
    subject: parsed ? parsed.subject : null,
    grade: parsed ? parsed.grade : null,
  };
}

const assetQuery = (assetId, client) => () => client
  .from('niete_lp_assets')
  .select('lesson_id, version_stamp, content_hash')
  .eq('id', assetId)
  .maybeSingle();

/**
 * Resolve a selected corpus-LP asset_id to its fidelity version keys (lesson_id, version_stamp,
 * content_hash), from niete_lp_assets (id is unique). Returns null for a non-corpus id (e.g. a legacy
 * lesson_plans id), so the caller falls back to the lesson_plans path. Client injectable for tests.
 * Best-effort (null on a read error too); the pick path uses the retrying read in handleLPSelection.
 * @returns {Promise<{lesson_id, version_stamp, content_hash}|null>}
 */
async function resolveCorpusRef(assetId, client = supabase) {
  if (!assetId) return null;
  const { data, error } = await assetQuery(assetId, client)();
  if (error) return null;
  return corpusRefFrom(data);
}

/**
 * A deliberate pick from the lesson-plan list is linked (the "Yes" tap, or the portal's list): the one plan
 * Section B is scored against. Nothing that arrives later at the plan step may clear it (bd-r2uzg1.18.6).
 * @param {{lesson_plan_link_method?: string}|null} row a coaching_sessions row (only the link method is read)
 */
function hasConfirmedListPick(row) {
  return !!(row && row.lesson_plan_link_method === 'selected_recent');
}

/**
 * Handle an LP selection response from the teacher.
 *
 * @param {string} coachingSessionId - Session UUID
 * @param {string} selectionId - Button/list row ID
 * @param {{sleep?: Function, retryDelaysMs?: number[]}} [deps] test seams for the retry
 * @returns {Promise<{linked_lesson_plan_id: string|null, lesson_plan_link_method: string, lesson_plan_content: object|null, awaiting_upload: boolean}>}
 */
async function handleLPSelection(coachingSessionId, selectionId, deps = {}) {
  const { action, lpId } = parseSelectionId(selectionId);

  if (action === 'none') {
    try {
      await supabase
        .from('coaching_sessions')
        .update({
          linked_lesson_plan_id: null,
          lesson_plan_link_method: 'none',
          has_lesson_plan: false,
        })
        .eq('id', coachingSessionId);
    } catch (error) {
      logToFile('Error updating session for no LP', { error: error.message });
    }

    logToFile('LP selection: none', { coachingSessionId });
    return {
      linked_lesson_plan_id: null,
      lesson_plan_link_method: 'none',
      lesson_plan_content: null,
      awaiting_upload: false,
    };
  }

  if (action === 'upload') {
    try {
      await supabase
        .from('coaching_sessions')
        .update({ lesson_plan_link_method: 'uploaded' })
        .eq('id', coachingSessionId);
    } catch (error) {
      logToFile('Error updating session for LP upload', { error: error.message });
    }

    logToFile('LP selection: upload new', { coachingSessionId });
    return {
      linked_lesson_plan_id: null,
      lesson_plan_link_method: 'uploaded',
      lesson_plan_content: null,
      awaiting_upload: true,
    };
  }

  // action === 'select'
  if (!lpId) {
    logToFile('LP not found for linking', { lpId, reason: 'empty id' });
    return { linked_lesson_plan_id: null, lesson_plan_link_method: 'none', lesson_plan_content: null, awaiting_upload: false };
  }
  // Fidelity path: the recent-LP list is sourced from niete_lp_downloads, so lpId is the download's
  // asset_id. Resolve it to the LP VERSION keys and stash them so the fidelity pass can score against the
  // exact version she downloaded. An id that is not a corpus asset falls back to the lesson_plans path.
  // bd-r2uzg1.18.6: a database error anywhere below is retried and then THROWN (LP_LINK_DB_ERROR) — never
  // read as "not found", never answered with 'none': this is a plan the coach confirmed.
  const { data: asset } = await withDbRetry('corpus_ref', assetQuery(lpId, supabase), deps);
  const corpusRef = corpusRefFrom(asset);
  if (corpusRef) {
    const { data: cs } = await withDbRetry('session_read', () => supabase
      .from('coaching_sessions')
      .select('lesson_plan_structured')
      .eq('id', coachingSessionId)
      .maybeSingle(), deps);
    const merged = { ...(cs && cs.lesson_plan_structured ? cs.lesson_plan_structured : {}), _fidelity_ref: corpusRef };
    await withDbRetry('link_write', () => supabase
      .from('coaching_sessions')
      .update({ lesson_plan_link_method: 'selected_recent', has_lesson_plan: true, lesson_plan_structured: merged })
      .eq('id', coachingSessionId), deps);
    logToFile('LP (corpus) linked with fidelity ref', { coachingSessionId, lesson_id: corpusRef.lesson_id });
    return {
      linked_lesson_plan_id: null,
      lesson_plan_link_method: 'selected_recent',
      lesson_plan_content: null,
      awaiting_upload: false,
      fidelity_ref: corpusRef,
    };
  }

  // Fallback: the LP is a lesson_plans row (legacy selection) — fetch and link it.
  const { data: lp } = await withDbRetry('lesson_plans_read', () => supabase
    .from('lesson_plans')
    .select('id, topic, grade, subject, content')
    .eq('id', lpId)
    .single(), deps);

  if (!lp) {
    // In neither table: nothing to link. The flow carries on without a plan, as before.
    logToFile('LP not found for linking', { lpId });
    return {
      linked_lesson_plan_id: null,
      lesson_plan_link_method: 'none',
      lesson_plan_content: null,
      awaiting_upload: false,
    };
  }

  await withDbRetry('link_write', () => supabase
    .from('coaching_sessions')
    .update({
      linked_lesson_plan_id: lp.id,
      lesson_plan_link_method: 'selected_recent',
      has_lesson_plan: true,
    })
    .eq('id', coachingSessionId), deps);

  logToFile('LP linked to coaching session', {
    coachingSessionId,
    lpId: lp.id,
    topic: lp.topic,
  });

  return {
    linked_lesson_plan_id: lp.id,
    lesson_plan_link_method: 'selected_recent',
    lesson_plan_content: lp,
    awaiting_upload: false,
  };
}

module.exports = { handleLPSelection, parseSelectionId, resolveCorpusRef, hasConfirmedListPick, withDbRetry, LINK_RETRY_DELAYS_MS };
