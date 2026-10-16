'use strict';
/**
 * PROVEN CONFIDENCE for the read side of the web quiz Challenge (the weekly strip, web-quiz-strip.js). Counts only.
 *
 * A run row's id_confidence is written at serve time, and a hub-route row is written 'high' even for a child on no
 * roster list (a forced new, unverified child). So the read side does not trust the column alone:
 *   PROOF_RULE                   a row is high confidence only when the column says 'high' AND the student row
 *                                proves it: the canonical student is on a roster list (list_id) or joined to a
 *                                roster row (merged_into)
 *   loadStudents(ids)            Map(id -> { list_id, merged_into, status, first }) from `students`, ≤ 200 ids a read
 *   loadListMates(listIds)       Map(list_id -> Map(first -> active students)) from `students`
 *   provenHigh(row, students)    the rule above, keyed by the row's canonical_id (else student_id)
 *   driftCounts(rows)            two provenance invariants over v2 rows (id_src set), each should read 0:
 *                                  high_unproven   rows written 'high' whose student is on no list and not merged
 *                                  homonym_missed  rows written homonym_in_list = false whose student is on a list
 *                                                  holding ANOTHER active student with the same canonical first name
 *                                                  (canonFirst, web-quiz-homonym.js: the rule the page uses)
 *                                { high_unproven, homonym_missed, n }, or null when `students` cannot be read
 * A name (students.student_name) is read only to fold it to `first` for the comparison: it is never returned, logged or written. A missing
 * table or a read error is null (logged once, code only), never a throw.
 */
const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');
const { canonFirst } = require('./web-quiz-homonym');

const STUDENTS = 'students';
const CHUNK = 200;
const PAGE = 1000;
const PROOF_RULE = "id_confidence = 'high' AND the canonical student is on a roster list (list_id) or merged into a roster row (merged_into)";

const childOf = (r) => (r && (r.canonical_id || r.student_id)) || null;
const failed = (what, error) => logError('web_quiz.provenance_read_failed', { what, code: (error && error.code) || null });

/** Every students row of one `.in(col, chunk)` read, a page at a time on id (no silent cap). Rows, or { error }. */
async function readIn(cols, col, chunk) {
  const out = [];
  let cursor = null;
  for (;;) {
    let q = supabase.from(STUDENTS).select(cols).in(col, chunk);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
    if (error) return { error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) return { rows: out };
    cursor = data[data.length - 1].id;
  }
}

/** Map(id -> { list_id, merged_into, status, first }) for the given student ids; null when `students` cannot be read. */
async function loadStudents(ids) {
  const want = [...new Set([...(ids || [])].filter(Boolean))];
  const by = new Map();
  for (let i = 0; i < want.length; i += CHUNK) {
    const got = await readIn('id, list_id, merged_into, status, student_name', 'id', want.slice(i, i + CHUNK));
    if (got.error) { failed(STUDENTS, got.error); return null; }
    for (const s of got.rows) by.set(s.id, { list_id: s.list_id == null ? null : s.list_id, merged_into: s.merged_into == null ? null : s.merged_into, status: s.status == null ? null : s.status, first: canonFirst(s.student_name) });
  }
  return by;
}

/** Map(list_id -> Map(first -> count of active students on it)); null when `students` cannot be read. */
async function loadListMates(listIds) {
  const want = [...new Set([...(listIds || [])].filter(Boolean))];
  const by = new Map();
  for (let i = 0; i < want.length; i += CHUNK) {
    const got = await readIn('id, list_id, status, student_name', 'list_id', want.slice(i, i + CHUNK));
    if (got.error) { failed(STUDENTS, got.error); return null; }
    for (const s of got.rows) {
      if (s.status !== 'active') continue;
      const first = canonFirst(s.student_name);
      if (!first) continue;
      if (!by.has(s.list_id)) by.set(s.list_id, new Map());
      const m = by.get(s.list_id);
      m.set(first, (m.get(first) || 0) + 1);
    }
  }
  return by;
}

/** PROOF_RULE: the column says 'high' and the student row proves it (on a list, or merged). */
function provenHigh(row, students) {
  if (!row || row.id_confidence !== 'high' || !students) return false;
  const s = students.get(childOf(row));
  return !!s && (s.list_id != null || s.merged_into != null);
}

/** The two provenance invariants over the v2 rows (id_src set): { high_unproven, homonym_missed, n }, or null. */
async function driftCounts(rows) {
  const v2 = (rows || []).filter((r) => r && r.id_src != null);
  if (!v2.length) return { high_unproven: 0, homonym_missed: 0, n: 0 };
  const students = await loadStudents(v2.map(childOf));
  if (!students) return null;
  const listed = (r) => { const s = students.get(childOf(r)); return s && s.list_id != null ? s : null; };
  const mates = await loadListMates(v2.filter((r) => r.homonym_in_list === false).map((r) => (listed(r) || {}).list_id));
  if (!mates) return null;
  let highUnproven = 0;
  let homonymMissed = 0;
  for (const r of v2) {
    if (r.id_confidence === 'high' && !provenHigh(r, students)) highUnproven += 1;
    const s = r.homonym_in_list === false ? listed(r) : null;
    if (!s || !s.first) continue;
    const same = (mates.get(s.list_id) || new Map()).get(s.first) || 0;
    if (same - (s.status === 'active' ? 1 : 0) >= 1) homonymMissed += 1;   // ANOTHER active child, not the child itself
  }
  return { high_unproven: highUnproven, homonym_missed: homonymMissed, n: v2.length };
}

module.exports = { loadStudents, loadListMates, provenHigh, driftCounts, PROOF_RULE };
