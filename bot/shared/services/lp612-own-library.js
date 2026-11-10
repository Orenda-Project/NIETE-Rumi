'use strict';
/**
 * the shared library's two sources, side by side: standard plans and plans a teacher made
 * ("Made by a teacher"). An own plan is listed only once the AI reviewer passed it (library_eligible, gate v2:
 * judge >= 85, no check rated 1, key checks >= 3), and never with her user id or her answers: the pool takes the
 * plan, not the person.
 *
 * Internal only (no teacher-facing route yet); the read is injected (createOwnLibrary) so it is testable alone.
 */

const SOURCES = Object.freeze({
  standard: Object.freeze({ en: 'Standard', ur: 'معیاری' }),
  teacher: Object.freeze({ en: 'Made by a teacher', ur: 'ایک استاد کا بنایا ہوا' }),
});
const LIBRARY_READ = 'id, segment_id, lesson_id, lang, template_version, r2_key, review_score, reviewed_at, completed_at';

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
      .eq('status', 'ready')
      .order('reviewed_at', { ascending: false })
      .limit(limit);
    if (error) {
      d.log('LP own library: read failed', { error: error.message });
      return [];
    }
    return tagLibrary([], (data || []).map(({ user_id, answers, ...rest }) => rest)); // eslint-disable-line no-unused-vars
  }
  return { listLibraryOwnPlans };
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
  SOURCES,
};
