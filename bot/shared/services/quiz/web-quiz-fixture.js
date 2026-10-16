'use strict';
/**
 * TEST CHILDREN, one rule in one place. A test (fixture) child never counts in a measured number. The weekly strip
 * (web-quiz-strip.js) drops their rows with it, and scripts/web-quiz/fixture-students.js prints the same set as JSON
 * for a reader outside the bot. A child is a test child when, checked in this order:
 *   1 meta.test     a run row says so: meta.test === true (the serve writes it from isTestName, web-quiz-challenge.js)
 *   2 name          the child's name ends in "Testwala" (isTestName: the one regex; the serve imports it from here)
 *   3 list          the child is on a configured seed student list (students.list_id)
 *   4 teacher       the child is in a class of a configured test teacher: an active class_teachers row
 *                   (teacher_user_id, the table the class-link mint reads) and an active class_enrollments row; a
 *                   run row played in such a class (class_id) counts too
 * The configured ids are data, never code: app_settings `web_quiz_fixture_rule` =
 * {"student_lists": [...], "teachers": [...]}. Absent, unreadable or malformed → empty sets (rules 1-2 still apply).
 * Read-only; no switch (a data rule, the same on every tier).
 *
 *   isTestName(name)                    rule 2
 *   isFixtureRow(row, ids?)             rule 1 on the row, or its child (canonical_id, else student_id) in `ids`
 *   fixtureConfig()                     { student_lists: Set, teachers: Set }
 *   fixtureStudentIds({ ids, rows, config })
 *                                       Set of test-child ids. With `ids`, only those children are checked (the
 *                                       students rows read ≤ 200 ids a read); with no `ids`, the whole population
 *                                       (Testwala names, the seed lists, the test teachers' classes). `rows` (run
 *                                       rows) add rule 1 (every id of a child with a meta.test row) and a row's
 *                                       class for rule 4. The Set carries `counts` {meta_test, name, list, teacher}
 *                                       (each child once, under the first rule that holds) and `unreadable` (the
 *                                       tables that could not be read). An unreadable table is logged (code only;
 *                                       a missing one only noted) and treated as unknown: it excludes nothing
 *                                       extra, never throws.
 * A name is read only to test rule 2: it is never returned, logged or written.
 */
const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');
const { chunks, IN_CHUNK } = require('./web-quiz-in-chunks');

const SETTING = 'web_quiz_fixture_rule';
const RULES = ['meta_test', 'name', 'list', 'teacher'];
const PAGE = 1000;
// A table not there yet is noted (`unreadable`), not logged as a failure: the strip's own rule for a missing table.
const isMissingTable = (e) => !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));

// A test child ("<Name> Testwala"): the row says so, so no filter has to guess.
const isTestName = (name) => /testwala\s*$/i.test(String(name || ''));

const childOf = (r) => (r && (r.canonical_id || r.student_id)) || null;
const idsOf = (r) => [r && r.student_id, r && r.canonical_id].filter(Boolean);
const marked = (r) => !!(r && r.meta && typeof r.meta === 'object' && r.meta.test === true);

/** Rule 1 on the row itself, or the row's child on the given fixture set. */
function isFixtureRow(row, ids) {
  if (marked(row)) return true;
  if (!ids || !row) return false;
  return idsOf(row).some((id) => ids.has(id));
}

const strings = (v) => new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

/** The configured seed lists and test teachers; empty sets when the key is absent, unreadable or malformed. */
async function fixtureConfig() {
  const empty = { student_lists: new Set(), teachers: new Set() };
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', SETTING);
    if (error) { logError('web_quiz.fixture_read_failed', { what: 'app_settings', code: error.code || null }); return empty; }
    if (!data || !data.length) return empty;
    let v = data[0].value;
    if (typeof v === 'string') v = JSON.parse(v);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return empty;
    return { student_lists: strings(v.student_lists), teachers: strings(v.teachers) };
  } catch (_) {
    return empty;
  }
}

/** Every row of one query, a page at a time on id (no silent cap). `make()` builds a fresh query. Rows, or { error }. */
async function pages(make) {
  const out = [];
  let cursor = null;
  for (;;) {
    let q = make();
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
    if (error) return { error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) return { rows: out };
    cursor = data[data.length - 1].id;
  }
}

/** pages() over `.in(col, chunk)`, ≤ 200 values a read. Rows, or { error }. */
async function pagesIn(make, col, values) {
  const out = [];
  for (const part of chunks([...values], IN_CHUNK)) {
    const got = await pages(() => make().in(col, part));
    if (got.error) return got;
    out.push(...got.rows);
  }
  return { rows: out };
}

/** The classes of the configured test teachers, then the children enrolled in them. { classes, children } or null. */
async function teacherChildren(teachers) {
  const ct = await pagesIn(() => supabase.from('class_teachers').select('id, class_id').eq('is_active', true), 'teacher_user_id', teachers);
  if (ct.error) return { error: ct.error, what: 'class_teachers' };
  const classes = new Set(ct.rows.map((r) => r.class_id).filter(Boolean));
  const en = await pagesIn(() => supabase.from('class_enrollments').select('id, student_id').eq('is_active', true), 'class_id', classes);
  if (en.error) return { error: en.error, what: 'class_enrollments' };
  return { classes, children: new Set(en.rows.map((r) => r.student_id).filter(Boolean)) };
}

/** The test children (see the header): a Set of ids with `counts` and `unreadable`. */
async function fixtureStudentIds({ ids, rows, config } = {}) {
  const cfg = config || await fixtureConfig();
  const runs = Array.isArray(rows) ? rows : [];
  const all = ids === undefined || ids === null;
  const want = new Set([...(all ? [] : ids), ...runs.flatMap(idsOf)].filter(Boolean));
  const hit = new Map();                      // id -> the first rule that holds
  const unreadable = [];
  const failed = (what, error) => {
    unreadable.push(what);
    if (!isMissingTable(error)) logError('web_quiz.fixture_read_failed', { what, code: (error && error.code) || null });
  };
  const mark = (id, rule) => { if (id && !hit.has(id)) hit.set(id, rule); };

  // rule 1: every id of a child with a run row the serve marked
  for (const r of runs) if (marked(r)) idsOf(r).forEach((id) => mark(id, 'meta_test'));

  // rules 2-3: the students rows
  if (all || want.size) {
    const cols = 'id, student_name, list_id';
    const got = all
      ? await (async () => {
        const named = await pages(() => supabase.from('students').select(cols).ilike('student_name', '%testwala%'));
        if (named.error || !cfg.student_lists.size) return named;
        const listed = await pagesIn(() => supabase.from('students').select(cols), 'list_id', cfg.student_lists);
        return listed.error ? listed : { rows: [...named.rows, ...listed.rows] };
      })()
      : await pagesIn(() => supabase.from('students').select(cols), 'id', want);
    if (got.error) failed('students', got.error);
    else {
      for (const s of got.rows) if (isTestName(s.student_name)) mark(s.id, 'name');
      for (const s of got.rows) if (s.list_id != null && cfg.student_lists.has(s.list_id)) mark(s.id, 'list');
    }
  }

  // rule 4: the test teachers' classes
  if (cfg.teachers.size && (all || want.size)) {
    const got = await teacherChildren(cfg.teachers);
    if (got.error) failed(got.what, got.error);
    else {
      for (const id of got.children) if (all || want.has(id)) mark(id, 'teacher');
      for (const r of runs) if (r && r.class_id != null && got.classes.has(r.class_id)) idsOf(r).forEach((id) => mark(id, 'teacher'));
    }
  }

  // a child known by two ids (student and canonical) is one child: the rest of its ids follow it
  for (const r of runs) {
    const first = idsOf(r).find((id) => hit.has(id));
    if (first) idsOf(r).forEach((id) => mark(id, hit.get(first)));
  }

  // counts: each child once (its ids on one run row are one child), under the first rule in order
  const key = new Map();
  for (const r of runs) idsOf(r).forEach((id) => { if (!key.has(id)) key.set(id, childOf(r)); });
  const per = new Map();
  for (const [id, rule] of hit) {
    const k = key.get(id) || id;
    if (!per.has(k) || RULES.indexOf(rule) < RULES.indexOf(per.get(k))) per.set(k, rule);
  }
  const out = new Set(hit.keys());
  out.counts = Object.fromEntries(RULES.map((r) => [r, 0]));
  for (const rule of per.values()) out.counts[rule] += 1;
  out.unreadable = unreadable;
  return out;
}

module.exports = { isTestName, isFixtureRow, fixtureConfig, fixtureStudentIds, SETTING, RULES };
