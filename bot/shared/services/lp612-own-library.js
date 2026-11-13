'use strict';
/**
 * the shared library's two sources, side by side: standard plans and plans a teacher made
 * ("Made by a teacher"). An own plan is listed only once the AI reviewer passed it (library_eligible, gate v2:
 * judge >= 85, no check rated 1, key checks >= 3) AND a person approved it (library_decision = 'approved', V1.10.1,
 * bd-snkn32.42 — lp612-own-approval), and never with her user id or her answers: the pool takes the plan, not the
 * person.
 *
 * listShelf: the portal's "Made by a teacher" shelf for the chapter she is browsing (its lesson ids).
 * shelfStatus: opens a shelf plan through the same 6-12 status read as her own plans (lp612-browse renderStatus).
 * The read is injected (createOwnLibrary) so it is testable alone.
 */

const SOURCES = Object.freeze({
  standard: Object.freeze({ en: 'Standard', ur: 'معیاری' }),
  teacher: Object.freeze({ en: 'Made by a teacher', ur: 'ایک استاد کا بنایا ہوا' }),
});
const LIBRARY_READ = 'id, segment_id, lesson_id, lang, template_version, r2_key, review_score, reviewed_at, completed_at';
const SHELF_READ = 'id, segment_id, lesson_id, lang';
const SHELF_STATUS_READ = 'id, segment_id, lesson_id, status, r2_key, error_code, lang, started_at, completed_at, '
  + 'library_eligible, library_decision';
const SHELF_LIMIT = 30;

/** Listed = the AI passed it, a person approved it, and it is ready. */
const listed = (r) => !!r && r.library_eligible === true && r.library_decision === 'approved' && r.status === 'ready';

/** Standard rows and own rows as one list, each carrying `source` and its tag. */
function tagLibrary(standard, own) {
  return [
    ...(standard || []).map((r) => ({ ...r, source: 'standard', tag: SOURCES.standard })),
    ...(own || []).map((r) => ({ ...r, source: 'teacher', tag: SOURCES.teacher })),
  ];
}

function createOwnLibrary(deps) {
  const d = deps;
  async function listLibraryOwnPlans({ limit = 50 } = {}) {
    const { data, error } = await d.from('niete_lp612_own_plans')
      .select(LIBRARY_READ)
      .eq('library_eligible', true)
      .eq('library_decision', 'approved')
      .eq('status', 'ready')
      .order('reviewed_at', { ascending: false })
      .limit(limit);
    if (error) {
      d.log('LP own library: read failed', { error: error.message });
      return [];
    }
    return tagLibrary([], (data || []).map(({ user_id, answers, ...rest }) => rest)); // eslint-disable-line no-unused-vars
  }

  /** The approved plans on these lessons (grades 1-5 lesson ids or 6-12 segment ids), never her id or answers. */
  async function listShelf({ keys } = {}) {
    const clean = require('./lp-own-mine').cleanKeys((Array.isArray(keys) ? keys : []).join(','));
    if (!clean.length) return [];
    const list = clean.join(',');
    const { data, error } = await d.from('niete_lp612_own_plans')
      .select(SHELF_READ)
      .eq('library_eligible', true)
      .eq('library_decision', 'approved')
      .eq('status', 'ready')
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
    if (!listed(data)) return null;
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
    live = createOwnLibrary({ from: (t) => supabase.from(t), log: (m, x) => logToFile(m, x) });
  }
  return live;
}

module.exports = {
  createOwnLibrary,
  tagLibrary,
  listLibraryOwnPlans: (args) => liveLibrary().listLibraryOwnPlans(args),
  listShelf: (args) => liveLibrary().listShelf(args),
  shelfStatus: (id) => liveLibrary().shelfStatus(id),
  SOURCES,
};
