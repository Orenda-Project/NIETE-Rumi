'use strict';
/**
 * NO GRADE FORBIDS ANYTHING ON ANY SHELF (bd-5gyspy.5). The Stories shelf, the video library and the Games list show
 * every grade to everyone; a grade is only the DEFAULT selection, with «All grades» and every other grade one tap away.
 *
 *   defaults   a child: their own grade (the class's, else the one they gave), or none
 *              a grown-up's preview: the grades the teacher teaches (users.grades_taught, those the shelves serve),
 *              else the preview token's own grade
 *              none at all: «All grades»
 *   pick(asked, defaults, within)   the selection a shelf serves: `asked` is the page's ?g= ('all', a grade, or grades
 *                                   'a,b'), else the defaults, else all. -> {all, grades, first}: `grades` the grades
 *                                   served in their order (the defaults first, then the rest in `within`'s order),
 *                                   `first` the defaults that are on this shelf. Every value a string (a shelf's own
 *                                   grade names: '1'..'5' for stories and games, the bank's for the library).
 *   single(p)                       the one grade a selection is, or null (all, or several)
 *   selOf(p, asNumber)              the answer's `sel`: 'all' or the grades
 *   note(tab, p, lang, n)           web_quiz.shelf {tab, sel, lang, n}: one line per shelf answer, never an id
 *   taughtOf(raw)                   the grade numbers a users.grades_taught value names (JSON text, an array, or a list)
 *   teacherGrades(userId)           those of 1-5 for one teacher (one small read, held 60 s); [] on any failure
 *
 * Pure but for teacherGrades' read and note's log line; never throws.
 */
const supabase = require('../../config/supabase');
const { logEvent } = require('../../utils/structured-logger');

const ALL = 'all';
const SHELF_GRADES = Object.freeze(['1', '2', '3', '4', '5']);
const HOLD_MS = 60 * 1000;
const ASK_RX = /^\s*[A-Za-z0-9]{1,8}(\s*,\s*[A-Za-z0-9]{1,8}){0,11}\s*$/;
const held = new Map();

const up = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** The grade numbers a users.grades_taught value names: '["grade_3","grade_4"]', ['3', 'Grade 4'], '3, 4'. Never throws. */
function taughtOf(raw) {
  let items = raw;
  if (typeof raw === 'string') {
    try { items = JSON.parse(raw); } catch (_) { items = raw.split(/[,;|]/); }
  }
  if (!Array.isArray(items)) items = items == null ? [] : [items];
  const out = [];
  items.forEach((x) => {
    const m = /\d{1,2}/.exec(String(x == null ? '' : x));
    const n = m ? Number(m[0]) : null;
    if (n && n >= 1 && n <= 12 && !out.includes(n)) out.push(n);
  });
  return out.sort((a, b) => a - b);
}

/** The selection a shelf serves (see the header). `within`: the shelf's grades in their natural order. */
function pick(asked, defaults, within = SHELF_GRADES) {
  const names = (within || []).map(up);
  const first = [];
  (defaults || []).map(up).forEach((g) => { if (names.includes(g) && !first.includes(g)) first.push(g); });
  const ordered = (list) => list.slice().sort((a, b) => rank(a) - rank(b));
  const rank = (g) => { const i = first.indexOf(g); return i >= 0 ? i : first.length + names.indexOf(g); };
  const a = up(asked);
  const want = a && a !== ALL.toUpperCase() && ASK_RX.test(a) ? [...new Set(a.split(',').map((x) => x.trim()).filter((g) => names.includes(g)))] : [];
  // all when asked for, or when nothing asked is on this shelf and there is no default; else what was asked, else the defaults
  const grades = a === ALL.toUpperCase() ? null : want.length ? want : first.length ? first.slice() : null;
  if (grades === null) return { all: true, grades: ordered(names), first };
  return { all: false, grades: ordered(grades), first };
}

/** The one grade a selection is, or null. */
function single(p) {
  return p && !p.all && p.grades.length === 1 ? p.grades[0] : null;
}

/** The answer's `sel`: 'all', or the grades (as numbers for a shelf whose grades are numbers). */
function selOf(p, asNumber = false) {
  if (!p || p.all) return ALL;
  return asNumber ? p.grades.map(Number) : p.grades.slice();
}

/** One line per shelf answer: which shelf, the selection, the language and how many rows. Never an id. Never throws. */
function note(tab, p, lang, n) {
  try { logEvent('web_quiz.shelf', { tab, sel: !p || p.all ? ALL : p.grades.join(','), lang: lang || null, n: Number(n) || 0 }); } catch (_) { /* never a page's */ }
}

/** The grades 1-5 a teacher teaches (users.grades_taught), held 60 s; [] with no id, no row, or a failed read. */
async function teacherGrades(userId, now = Date.now()) {
  const id = typeof userId === 'string' ? userId : '';
  if (!id) return [];
  const h = held.get(id);
  if (h && now - h.at < HOLD_MS) return h.v;
  let v = [];
  try {
    const { data, error } = await supabase.from('users').select('id, grades_taught').eq('id', id).maybeSingle();
    if (!error && data) v = taughtOf(data.grades_taught).filter((g) => g >= 1 && g <= 5);
  } catch (_) { v = []; }
  held.set(id, { at: now, v });
  return v;
}

/**
 * A visitor's default grades (numbers): a preview's teacher's grades (else its own grade); a child's own grade. [] = none
 * (the shelf opens on «All grades»). `own` is the child's grade the caller already has (or a promise of it).
 */
async function defaultsOf(who, own = null) {
  if (who && who.practice) {
    const taught = who.teacherId ? await teacherGrades(who.teacherId) : [];
    if (taught.length) return taught;
    return Number.isInteger(Number(who.grade)) && who.grade ? [Number(who.grade)] : [];
  }
  const g = Number(await own);
  return Number.isInteger(g) && g >= 1 ? [g] : [];
}

module.exports = { pick, single, selOf, note, taughtOf, teacherGrades, defaultsOf, ALL, SHELF_GRADES, _reset: () => held.clear() };
