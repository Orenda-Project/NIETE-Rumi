'use strict';
/**
 * The children's own rows read once per hub answer (app_settings web_quiz_hub_child_memo, default off; only the JSON
 * boolean true is on). One hub answer asks for the same children's rows several times: the identity lookup, the hub's
 * own rows and lists, the challenge's grade, the teacher card's classes, the Book's class and the pick record each read
 * students / class_enrollments / student_lists for the same ids. On: the first ask reads them, with every column any of
 * those parts selects, and every later ask in the same answer shares that read, given back with only the columns it
 * asked for (so each part sees what it saw before, and the answer is the same, byte for byte).
 *
 *   run(fn)                    fn() inside one answer's shared reads (the hub calls it while the switch is on)
 *   inside()                   whether an answer's shared reads are open here
 *   read(table, ids, cols, own, { single })
 *                              the rows of `table` for these ids (students and student_lists by id, class_enrollments
 *                              by student_id, active ones only), as { data, error }; `single` gives one row or null,
 *                              like maybeSingle(). Outside an answer: own(), the caller's read, exactly as today.
 *                              A shared read that failed or threw is never shared: the caller reads its own, as today.
 *
 * Nothing is kept past the answer (LIFE_MS at most, for a timer an answer started), so no child waits on a stale row.
 */
const { AsyncLocalStorage } = require('async_hooks');
const { read: dbRead } = require('./web-quiz-db-deadline');

// Every column the hub's parts select from each table (the union), and the column each table is asked by.
const COLS = Object.freeze({
  students: 'id, student_name, student_name_urdu, father_name, self_reported_class, list_id, is_active, merged_into, status',
  class_enrollments: 'id, student_id, class_id, is_active',
  student_lists: 'id, user_id, class_name, section, class_id',
});
const BY = Object.freeze({ students: 'id', class_enrollments: 'student_id', student_lists: 'id' });
const LIFE_MS = 10 * 1000; // the portal's budget for one answer

const als = new AsyncLocalStorage();

function store() {
  const s = als.getStore();
  return s && Date.now() - s.at < LIFE_MS ? s : null;
}

const inside = () => Boolean(store());

/** fn() with this answer's shared reads; a nested run joins the one already open. */
function run(fn) {
  if (store()) return fn();
  return als.run({ at: Date.now(), rows: new Map() }, fn);
}

function readMany(table, ids) {
  return dbRead(`childRows:${table}:1`, (db) => {
    const q = db.from(table).select(COLS[table]).in(BY[table], ids);
    return table === 'class_enrollments' ? q.eq('is_active', true) : q;
  });
}

const pick = (row, cols) => Object.fromEntries(cols.map((c) => [c, row[c] === undefined ? null : row[c]]).filter(([c]) => c in row));

/** The shared rows for these ids, or null when there is no answer open or the shared read did not answer. */
async function shared(table, ids, cols) {
  const s = store();
  if (!s || !COLS[table]) return null;
  const key = (id) => `${table}:${id}`;
  const missing = [...new Set(ids.map(String))].filter((id) => !s.rows.has(key(id)));
  if (missing.length) {
    const p = Promise.resolve().then(() => readMany(table, missing))
      .then((res) => (res && !res.error ? res.data || [] : null), () => null);
    missing.forEach((id) => s.rows.set(key(id), p.then((all) => (all ? all.filter((r) => String(r[BY[table]]) === id) : null))));
  }
  const parts = await Promise.all(ids.map((id) => s.rows.get(key(String(id)))));
  if (parts.some((p) => p === null)) return null;
  const want = String(cols).split(',').map((c) => c.trim()).filter(Boolean);
  const seen = new Set();
  return parts.flat().filter((r) => !seen.has(r) && seen.add(r)).map((r) => pick(r, want));
}

function read(table, ids, cols, own, { single = false } = {}) {
  if (!store()) return own();
  return shared(table, ids, cols).then((rows) => {
    if (!rows) return own();
    return { data: single ? rows[0] || null : rows, error: null };
  });
}

module.exports = { run, inside, read, COLS, LIFE_MS };
