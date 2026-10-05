'use strict';
/**
 * Who is playing, by roll number — the teacher's class list on the web quiz.
 *
 * A teacher who keeps a class list (student_lists + students, from /roster or
 * attendance) already knows every child's roll number, and the children know
 * theirs. So instead of picking a name from a wall of classmates' names, the
 * child types a roll number, the server answers "Are you <first name>?", and a
 * confirmed child plays AS their roster row: the teacher's report then shows the
 * roster's name and class, and the one-attempt rule keys on the real child.
 *
 * Behind app_settings `web_quiz_roster_id` (default off, fails closed). The page
 * never receives the roster: a lookup returns at most MAX_CANDIDATES first names
 * with their animal, never a surname, a father's name or a roll list.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const FLAG_KEY = 'web_quiz_roster_id';
const TTL_MS = 30 * 1000;
const MAX_CANDIDATES = 3;
const ROLL_MAX = 999;

let cache = null;

function isTrue(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  return x === true || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}

/** True when roster identity is switched on. Never throws; fails closed. */
async function rosterOn(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === FLAG_KEY);
    cache = { at: now, on: Boolean(row) && isTrue(row.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz roster: settings lookup failed — no roster identity', { error: err.message });
    return false;
  }
}

const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const listLabel = (l) => [String(l.class_name || '').trim(), String(l.section || '').trim()].filter(Boolean).join('-');

/**
 * The teacher's active class lists and their active children. Null when the
 * switch is off, the teacher keeps no list, or the read fails (the page then
 * falls back to today's name chips).
 */
async function loadRoster(teacherUserId) {
  if (!teacherUserId || !(await rosterOn())) return null;
  try {
    const { data: lists, error } = await supabase.from('student_lists')
      .select('id, class_name, section').eq('user_id', teacherUserId).eq('is_active', true);
    if (error) throw new Error(error.message);
    if (!lists || !lists.length) return null;
    const { data: kids, error: kErr } = await supabase.from('students')
      .select('id, list_id, roll_number, student_name, student_name_urdu, status')
      .in('list_id', lists.map((l) => l.id)).eq('is_active', true);
    if (kErr) throw new Error(kErr.message);
    const live = (kids || []).filter((k) => !k.status || k.status === 'active');
    if (!live.length) return null;
    return {
      lists: lists.map((l) => ({ id: l.id, label: listLabel(l), grade: digits(l.class_name) })),
      kids: live,
    };
  } catch (err) {
    logToFile('⚠️ web quiz roster: class list read failed — name chips instead', { error: err.message });
    return null;
  }
}

/** A roll number the child typed: 1..999, or null. */
function cleanRoll(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= ROLL_MAX ? n : null;
}

/**
 * The children with this roll number. The quiz's grade picks the class when it
 * names exactly one of the teacher's lists and that list has the number; then
 * no class label is needed. Otherwise every class's child with that number is a
 * candidate, each labelled with its class when the teacher keeps 2+ lists.
 */
function byRoll(roster, roll, quizGrade) {
  if (!roster) return [];
  const hits = roster.kids.filter((k) => Number(k.roll_number) === roll);
  const g = digits(quizGrade);
  const gradeLists = g ? roster.lists.filter((l) => l.grade === g) : [];
  if (gradeLists.length === 1) {
    const inGrade = hits.filter((k) => k.list_id === gradeLists[0].id);
    if (inGrade.length) return inGrade.slice(0, MAX_CANDIDATES).map((k) => ({ kid: k, label: null }));
  }
  const labelOf = (k) => (roster.lists.length > 1 ? (roster.lists.find((l) => l.id === k.list_id) || {}).label || null : null);
  return hits.slice(0, MAX_CANDIDATES).map((k) => ({ kid: k, label: labelOf(k) }));
}

// ─── near names ─────────────────────────────────────────────────────────────

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-z]/;
const scriptOf = (s) => (ARABIC.test(s) ? 'arabic' : LATIN.test(s) ? 'latin' : 'other');
const letters = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}]/gu, '');

function editDistance(a, b) {
  const m = a.length; const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Could these two first names be the same child's? Same script only (we do not
 * transliterate Urdu to English), at least 3 letters each, and one typo apart
 * (two for names of 7+ letters: "Muhammad" / "Mohammed").
 */
function nearName(a, b) {
  const x = letters(a); const y = letters(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 3 || y.length < 3 || scriptOf(x) !== scriptOf(y)) return false;
  const allowed = Math.min(x.length, y.length) >= 7 ? 2 : 1;
  return editDistance(x, y) <= allowed;
}

/** Roster children whose first name is near the typed first name. */
function byName(roster, typedFirst) {
  if (!roster || !typedFirst) return [];
  const firstOf = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const labelOf = (k) => (roster.lists.length > 1 ? (roster.lists.find((l) => l.id === k.list_id) || {}).label || null : null);
  // A child may type their name in either script; the list may hold an Urdu spelling too.
  return roster.kids.filter((k) => nearName(firstOf(k.student_name), typedFirst) || nearName(firstOf(k.student_name_urdu), typedFirst))
    .slice(0, MAX_CANDIDATES).map((k) => ({ kid: k, label: labelOf(k) }));
}

/** The name a child is asked about: the list's Urdu spelling on an Urdu quiz, when the list has one. */
function displayName(kid, lang) {
  return lang === 'ur' && kid.student_name_urdu && String(kid.student_name_urdu).trim() ? kid.student_name_urdu : kid.student_name;
}

/** The class label of a roster child (for the session's student_class). */
function classOf(roster, kid) {
  const l = roster && kid ? roster.lists.find((x) => x.id === kid.list_id) : null;
  return l ? l.label || null : null;
}

module.exports = {
  FLAG_KEY, MAX_CANDIDATES,
  rosterOn, loadRoster, cleanRoll, byRoll, byName, nearName, classOf, displayName,
  _resetCache: () => { cache = null; },
};
