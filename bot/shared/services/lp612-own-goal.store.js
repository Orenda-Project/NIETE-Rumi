'use strict';
/**
 * bd-snkn32.56 (queue #134 E) — the two reads "Start from a learning goal or topic" needs. Plain functions over a passed
 * client (the bot's or the dashboard's), so the schema guards can read the `.from()` calls.
 *
 *   goalStartOn  — portal_lp_own_goal_start is LIST-ONLY while it is tested with a few teachers: a JSON list of
 *                  users.id names who has it; true, "teachers", absent, anything else or a failed read = off.
 *   goalRows     — the current catalogue lessons of one grade+subject (ICT's when it has any, else whichever
 *                  curriculum has them), with what lp612-own-goal needs: outcome text, titles and book order.
 *                  Grades 1–5 (bd-snkn32.57): the official outcomes of the curriculum matrix (assessment_topics, ICT,
 *                  current), each mapped onto its day of her book (the default ICT shelf), by lp-k5-own-goal.
 */
const { matrixSubject, k5GoalRows } = require('./lp-k5-own-goal');

const GOAL_START_KEY = 'portal_lp_own_goal_start';
const GOAL_COLUMNS = 'segment_id, curriculum, chapter_number, chapter_title, order_index, menu_title, subtopic_title, slo_descriptions';
const MAX_ROWS = 1000;
const MATRIX_COLUMNS = 'chapter_number, chapter_title, name, sort_order, pages, days, slo_codes, slo_descriptions';

function listOf(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { return []; } }
  return Array.isArray(x) ? x : [];
}

/** Is the goal start on for this user? Never throws. */
async function goalStartOn(supabase, userId) {
  if (typeof userId !== 'string' || !userId) return false;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', GOAL_START_KEY).maybeSingle();
    if (error || !data) return false;
    return listOf(data.value).includes(userId);
  } catch (_) {
    return false;
  }
}

/** Grades 1–5: the matrix's official outcomes for her book's subject, as goal rows; [] for a subject it lacks. */
async function k5Rows(supabase, { grade, subject }) {
  const book = require('./lp-v8-catalog.service').bookFor(grade, subject);
  const wanted = book && matrixSubject(subject);
  if (!wanted) return [];
  const { data, error } = await supabase
    .from('assessment_topics')
    .select(MATRIX_COLUMNS)
    .eq('is_current', true)
    .eq('curriculum', 'ict')
    .eq('grade', grade)
    .eq('subject', wanted)
    .limit(MAX_ROWS);
  if (error || !Array.isArray(data)) return [];
  return k5GoalRows(data, book);
}

/** The grade+subject's current lessons (grades 6-12) or official outcomes (1-5), one curriculum's; [] on any failure. */
async function goalRows(supabase, { grade, subject }) {
  if (!Number.isInteger(grade) || grade < 1 || grade > 12 || typeof subject !== 'string' || !subject) return [];
  if (grade <= 5) return k5Rows(supabase, { grade, subject });
  const { data, error } = await supabase
    .from('niete_lp612_segments')
    .select(GOAL_COLUMNS)
    .eq('is_current', true)
    .eq('grade', grade)
    .eq('subject', subject)
    .limit(MAX_ROWS);
  if (error || !Array.isArray(data)) return [];
  const ict = data.filter((r) => r.curriculum === 'ict');
  if (ict.length) return ict;
  const first = data[0] && data[0].curriculum;
  return data.filter((r) => r.curriculum === first);
}

module.exports = { goalStartOn, goalRows, GOAL_START_KEY, GOAL_COLUMNS };
