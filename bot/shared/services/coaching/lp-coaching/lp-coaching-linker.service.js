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
 * Resolve a selected corpus-LP asset_id to its fidelity version keys (lesson_id, version_stamp,
 * content_hash), from niete_lp_assets (id is unique). Returns null for a non-corpus id (e.g. a legacy
 * lesson_plans id), so the caller falls back to the lesson_plans path. Client injectable for tests.
 * @returns {Promise<{lesson_id, version_stamp, content_hash}|null>}
 */
async function resolveCorpusRef(assetId, client = supabase) {
  if (!assetId) return null;
  const { data, error } = await client
    .from('niete_lp_assets')
    .select('lesson_id, version_stamp, content_hash')
    .eq('id', assetId)
    .maybeSingle();
  if (error || !data || !data.lesson_id) return null;
  return { lesson_id: data.lesson_id, version_stamp: data.version_stamp, content_hash: data.content_hash };
}

/**
 * Handle an LP selection response from the teacher.
 *
 * @param {string} coachingSessionId - Session UUID
 * @param {string} selectionId - Button/list row ID
 * @returns {Promise<{linked_lesson_plan_id: string|null, lesson_plan_link_method: string, lesson_plan_content: object|null, awaiting_upload: boolean}>}
 */
async function handleLPSelection(coachingSessionId, selectionId) {
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
  // Fidelity path: the recent-LP list is now sourced from niete_lp_downloads, so lpId is the
  // download's asset_id. Resolve it to the LP VERSION keys and stash them so the fidelity pass can
  // score against the exact version she downloaded. Non-blocking — falls back to the lesson_plans path.
  try {
    const corpusRef = await resolveCorpusRef(lpId);
    if (corpusRef) {
      const { data: cs } = await supabase
        .from('coaching_sessions')
        .select('lesson_plan_structured')
        .eq('id', coachingSessionId)
        .maybeSingle();
      const merged = { ...(cs && cs.lesson_plan_structured ? cs.lesson_plan_structured : {}), _fidelity_ref: corpusRef };
      await supabase
        .from('coaching_sessions')
        .update({ lesson_plan_link_method: 'selected_recent', has_lesson_plan: true, lesson_plan_structured: merged })
        .eq('id', coachingSessionId);
      logToFile('LP (corpus) linked with fidelity ref', { coachingSessionId, lesson_id: corpusRef.lesson_id });
      return {
        linked_lesson_plan_id: null,
        lesson_plan_link_method: 'selected_recent',
        lesson_plan_content: null,
        awaiting_upload: false,
        fidelity_ref: corpusRef,
      };
    }
  } catch (refErr) {
    logToFile('corpus ref resolution failed (non-blocking, falling back to lesson_plans)', { lpId, error: refErr.message });
  }

  // Fallback: the LP is a lesson_plans row (legacy selection) — fetch and link it.
  try {
    const { data: lp, error } = await supabase
      .from('lesson_plans')
      .select('id, topic, grade, subject, content')
      .eq('id', lpId)
      .single();

    if (error || !lp) {
      logToFile('LP not found for linking', { lpId, error: error?.message });
      return {
        linked_lesson_plan_id: null,
        lesson_plan_link_method: 'none',
        lesson_plan_content: null,
        awaiting_upload: false,
      };
    }

    await supabase
      .from('coaching_sessions')
      .update({
        linked_lesson_plan_id: lp.id,
        lesson_plan_link_method: 'selected_recent',
        has_lesson_plan: true,
      })
      .eq('id', coachingSessionId);

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
  } catch (error) {
    logToFile('Error linking LP to session', { error: error.message, lpId });
    return {
      linked_lesson_plan_id: null,
      lesson_plan_link_method: 'none',
      lesson_plan_content: null,
      awaiting_upload: false,
    };
  }
}

module.exports = { handleLPSelection, parseSelectionId, resolveCorpusRef };
