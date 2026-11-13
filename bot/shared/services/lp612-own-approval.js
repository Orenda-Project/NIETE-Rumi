'use strict';
/**
 * bd-snkn32.42 — the human check before a teacher's own plan is listed on the "Made by a teacher" shelf.
 *
 * The AI reviewer (lp612-own-reviewer, gate v2) decides only whether a plan MAY be listed (library_eligible). A
 * person then approves or rejects it (V1.10.1 library_decision). The shelf (lp612-own-library) lists a plan only
 * when both said yes. Who may decide: staff named on app_settings portal_lp_own_reviewers (a list of users.id),
 * enforced by the portal route; the reviewer id stored here is that session user's.
 *
 *   listQueue   — AI-passed, ready, undecided plans, oldest first, with the score and the checks rated 2 or below
 *                 (and those the reviewer could not assess). Never her user id or her answers.
 *   decide      — approve / reject (a reason required, kept to 500 characters). Only an undecided, AI-passed,
 *                 ready row is written, in the update's own filter, so two reviewers cannot both decide one plan.
 *                 → { outcome: ok | bad_request | not_found | error }
 *   reviewKey   — the PDF key of an AI-passed ready plan, for the reviewer to read (decided or not); else null.
 *
 * The read/write is injected (createOwnApproval) so it is testable alone.
 */
const { CHECKS } = require('./lp612-own-review');

const OWN_TABLE = 'niete_lp612_own_plans';
const QUEUE_READ = 'id, segment_id, lesson_id, lang, review_score, review_items, reviewed_at';
const KEY_READ = 'id, r2_key, status, library_eligible';
const QUEUE_LIMIT = 50;
const REASON_MAX = 500;
const DECISIONS = { approve: 'approved', reject: 'rejected' };
const NAMES = new Map(CHECKS.map((c) => [c.id, c.name]));

/** Pure: the reviewer's per-check ratings → the checks below the standard (rated 1 or 2) and the null ones. */
function summariseItems(items) {
  const entries = Object.entries(items || {}).filter(([id]) => NAMES.has(id)).sort(([a], [b]) => a.localeCompare(b));
  return {
    below: entries.filter(([, r]) => Number.isInteger(r) && r <= 2).map(([id, rating]) => ({ id, name: NAMES.get(id), rating })),
    notAssessed: entries.filter(([, r]) => r === null).map(([id]) => id),
  };
}

function createOwnApproval(deps) {
  const d = deps;

  async function listQueue({ limit = QUEUE_LIMIT } = {}) {
    const { data, error } = await d.from(OWN_TABLE)
      .select(QUEUE_READ)
      .eq('library_eligible', true)
      .eq('status', 'ready')
      .is('library_decision', null)
      .order('reviewed_at', { ascending: true })
      .limit(limit);
    if (error) {
      d.log('LP own approval: queue read failed', { error: error.message });
      return [];
    }
    return (data || []).map((r) => ({
      ownId: r.id,
      lesson: r.segment_id || r.lesson_id,
      band: r.lesson_id ? 'k5' : 'g612',
      lang: r.lang,
      score: r.review_score,
      reviewedAt: r.reviewed_at,
      ...summariseItems(r.review_items),
    }));
  }

  async function decide({ ownId, reviewerId, decision, reason } = {}) {
    const value = DECISIONS[decision];
    const why = typeof reason === 'string' ? reason.trim().slice(0, REASON_MAX) : '';
    if (!ownId || !reviewerId || !value || (value === 'rejected' && !why)) return { outcome: 'bad_request' };
    const at = d.now();
    const { data, error } = await d.from(OWN_TABLE)
      .update({
        library_decision: value,
        library_decided_by: reviewerId,
        library_decided_at: at,
        library_reject_reason: value === 'rejected' ? why : null,
        updated_at: at,
      })
      .eq('id', ownId)
      .eq('library_eligible', true)
      .eq('status', 'ready')
      .is('library_decision', null)
      .select('id');
    if (error) {
      d.log('LP own approval: decision not saved', { ownId, error: error.message });
      return { outcome: 'error' };
    }
    if (!data || !data.length) return { outcome: 'not_found' };
    d.log('LP own approval: decided', { ownId, reviewerId, decision: value });
    return { outcome: 'ok', decision: value };
  }

  async function reviewKey(ownId) {
    if (!ownId) return null;
    const { data, error } = await d.from(OWN_TABLE).select(KEY_READ).eq('id', ownId).maybeSingle();
    if (error) {
      d.log('LP own approval: file read failed', { ownId, error: error.message });
      return null;
    }
    if (!data || data.library_eligible !== true || data.status !== 'ready' || !data.r2_key) return null;
    return data.r2_key;
  }

  return { listQueue, decide, reviewKey };
}

let live = null;
function liveApproval() {
  if (!live) {
    const supabase = require('../config/supabase');
    const { logToFile } = require('../utils/logger');
    live = createOwnApproval({
      from: (t) => supabase.from(t), log: (m, x) => logToFile(m, x), now: () => new Date().toISOString(),
    });
  }
  return live;
}

module.exports = {
  createOwnApproval,
  summariseItems,
  listQueue: (args) => liveApproval().listQueue(args),
  decide: (args) => liveApproval().decide(args),
  reviewKey: (id) => liveApproval().reviewKey(id),
};
