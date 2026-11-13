'use strict';
/**
 * the shared library's two sources, side by side: standard plans and plans a teacher made
 * ("Made by a teacher"). Who lists an own plan is a switch, app_settings lp_own_library_rule (bd-snkn32.46):
 *   'ai' (the default; also any missing, unreadable or unknown value): the AI reviewer passed it (library_eligible,
 *        gate v2: judge >= 85, no check rated 1, key checks >= 3) and nobody rejected it. A person may still Reject
 *        on the check page (lp612-own-approval), which takes it off the shelf.
 *   'ai_and_person': the AI passed it AND a person approved it (library_decision = 'approved', V1.10.1, bd-snkn32.42).
 * Never with her user id or her answers: the pool takes the plan, not the person.
 *
 * listShelf: the portal's "Made by a teacher" shelf for the chapter she is browsing (its lesson ids).
 * shelfStatus: opens a shelf plan through the same 6-12 status read as her own plans (lp612-browse renderStatus).
 * The read is injected (createOwnLibrary) so it is testable alone.
 */

const SOURCES = Object.freeze({
  standard: Object.freeze({ en: 'Standard', ur: 'معیاری' }),
  teacher: Object.freeze({ en: 'Made by a teacher', ur: 'ٹیچر کا بنایا ہوا' }),
});
const LIBRARY_READ = 'id, segment_id, lesson_id, lang, template_version, r2_key, review_score, reviewed_at, completed_at';
const SHELF_READ = 'id, segment_id, lesson_id, lang';
const SHELF_STATUS_READ = 'id, segment_id, lesson_id, status, r2_key, error_code, lang, started_at, completed_at, '
  + 'library_eligible, library_decision';
const SHELF_LIMIT = 30;
const RULE_KEY = 'lp_own_library_rule';
const RULE_TTL_MS = 60 * 1000;
const NOT_REJECTED = 'library_decision.is.null,library_decision.neq.rejected';

/** The setting's value → 'ai_and_person' only when it says so exactly; anything else is 'ai'. */
const libraryRule = (v) => (v === 'ai_and_person' ? 'ai_and_person' : 'ai');

/** Listed = the AI passed it, it is ready, and (by the rule) a person approved it or nobody rejected it. */
const listed = (r, rule) => !!r && r.library_eligible === true && r.status === 'ready'
  && (rule === 'ai_and_person' ? r.library_decision === 'approved' : r.library_decision !== 'rejected');

/** The person part of the filter, on a query that already asks for eligible, ready rows. */
const byRule = (q, rule) => (rule === 'ai_and_person' ? q.eq('library_decision', 'approved') : q.or(NOT_REJECTED));

/** Standard rows and own rows as one list, each carrying `source` and its tag. */
function tagLibrary(standard, own) {
  return [
    ...(standard || []).map((r) => ({ ...r, source: 'standard', tag: SOURCES.standard })),
    ...(own || []).map((r) => ({ ...r, source: 'teacher', tag: SOURCES.teacher })),
  ];
}

function createOwnLibrary(deps) {
  const d = deps;
  async function rule() {
    if (!d.rule) return 'ai';
    try { return libraryRule(await d.rule()); } catch { return 'ai'; }
  }

  async function listLibraryOwnPlans({ limit = 50 } = {}) {
    const { data, error } = await byRule(d.from('niete_lp612_own_plans')
      .select(LIBRARY_READ)
      .eq('library_eligible', true)
      .eq('status', 'ready'), await rule())
      .order('reviewed_at', { ascending: false })
      .limit(limit);
    if (error) {
      d.log('LP own library: read failed', { error: error.message });
      return [];
    }
    return tagLibrary([], (data || []).map(({ user_id, answers, ...rest }) => rest)); // eslint-disable-line no-unused-vars
  }

  /** The listed plans on these lessons (grades 1-5 lesson ids or 6-12 segment ids), never her id or answers. */
  async function listShelf({ keys } = {}) {
    const clean = require('./lp-own-mine').cleanKeys((Array.isArray(keys) ? keys : []).join(','));
    if (!clean.length) return [];
    const list = clean.join(',');
    const { data, error } = await byRule(d.from('niete_lp612_own_plans')
      .select(SHELF_READ)
      .eq('library_eligible', true)
      .eq('status', 'ready'), await rule())
      .or(`segment_id.in.(${list}),lesson_id.in.(${list})`)
      .order('reviewed_at', { ascending: false })
      .limit(SHELF_LIMIT);
    if (error) {
      d.log('LP own shelf: read failed', { error: error.message });
      return [];
    }
    return (data || []).map((r) => ({
      ownId: r.id, lesson: r.segment_id || r.lesson_id, band: r.lesson_id ? 'k5' : 'g612', lang: r.lang,
    }));
  }

  /** A listed plan, by id, in the render-row shape the status route reads; anything else null. Never her id. */
  async function shelfStatus(id) {
    if (!id) return null;
    const { data, error } = await d.from('niete_lp612_own_plans').select(SHELF_STATUS_READ).eq('id', id).maybeSingle();
    if (error) {
      d.log('LP own shelf: status read failed', { id, error: error.message });
      return null;
    }
    if (!listed(data, await rule())) return null;
    return {
      id: data.id, segment_id: data.segment_id || data.lesson_id, status: data.status, r2_key: data.r2_key,
      one_screen: null, error_code: data.error_code, lang: data.lang, started_at: data.started_at,
      completed_at: data.completed_at,
    };
  }

  return { listLibraryOwnPlans, listShelf, shelfStatus };
}

let live = null;
function liveLibrary() {
  if (!live) {
    const supabase = require('../config/supabase');
    const { logToFile } = require('../utils/logger');
    const { cachedSwitch } = require('./settings/switch-cache');
    const sw = cachedSwitch({
      ttlMs: RULE_TTL_MS,
      off: 'ai',
      log: (err) => logToFile('LP own library: rule read failed, using ai', { error: err && err.message }),
      read: async () => {
        const { data, error } = await supabase.from('app_settings').select('value').eq('key', RULE_KEY).maybeSingle();
        if (error) throw new Error(error.message);
        return libraryRule(data && data.value);
      },
    });
    live = createOwnLibrary({ from: (t) => supabase.from(t), log: (m, x) => logToFile(m, x), rule: () => sw.get() });
  }
  return live;
}

module.exports = {
  createOwnLibrary,
  tagLibrary,
  libraryRule,
  RULE_KEY,
  listLibraryOwnPlans: (args) => liveLibrary().listLibraryOwnPlans(args),
  listShelf: (args) => liveLibrary().listShelf(args),
  shelfStatus: (id) => liveLibrary().shelfStatus(id),
  SOURCES,
};
