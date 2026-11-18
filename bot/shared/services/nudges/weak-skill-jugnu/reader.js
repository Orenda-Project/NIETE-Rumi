'use strict';
/**
 * bd-ptl6x9.7 — the reads behind the weak-skill Jugnu nudge. Existing tables only; nothing here writes.
 *
 *   teachers({testOnly})   teachers with an active Jugnu class list tied to a class: live, a phone, role teacher;
 *                          test accounts only while testOnly. (No governed teacher → grade map exists, bd-ptl6x9.12;
 *                          the teacher's own class lists are the reach.)
 *   listsOf(userId)        that teacher's active lists with their class's school and grade (1–5 only), by label.
 *   groupResults({schoolId, grade, sinceIso, untilIso, includeTestCoaches})
 *                          per maths task the knowledge graph links to a game: children scored, children passing, for
 *                          completed sa-battery child tests of that school+grade in the window. One child counts once
 *                          per task: the latest scored attempt decides (the governed card's rule, rule v0.42.1).
 *                          Test coaches' tests count only while the nudge is for test accounts.
 *
 * Counts never leave the process: the picker turns them into a skill name or nothing. Any read error THROWS — a
 * nudge built on a half-read would name the wrong skill.
 */

const supabase = require('../../../config/supabase');
const LINKS = require('./links.json');

const BANK = 'sa-battery';
const PASS = 0.75; // the results page's PROPOSED per-child benchmark
const GRADE_OF = { grade_1: 1, grade_2: 2, grade_3: 3, grade_4: 4, grade_5: 5 };
const MAX = { lists: 5000, users: 5000, sessions: 3000, blocks: 10000 };
const CHUNK = 200;

function check(what, { data, error }) {
  if (error) throw new Error(`weak-skill jugnu: ${what} read failed — ${error.message}`);
  return data || [];
}

const ITEMS = Object.fromEntries(LINKS.links.map((l) => [l.egma, l.items]));

/** How many items a block got right, read the way the governed card reads it; null when it is not scored. */
function correctOf(b) {
  const m = b.ai_marks || {};
  const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  if (b.response_mode === 'tap') return n(m.tap_correct);
  if (b.response_mode === 'keypad' || b.response_mode === 'keyboard') return n(m.keypad_correct);
  return b.ai_status === 'scored' ? n(m.correct) : null;
}

/** Pure: sessions + their blocks → [{egma, scored, passing}] over distinct children. */
function countResults(sessions, blocks) {
  const sessionOf = new Map(sessions.map((s) => [s.id, s]));
  const latest = new Map(); // `${task}|${child}` → { at, passed }
  for (const b of blocks) {
    const s = sessionOf.get(b.session_id);
    const items = ITEMS[b.block];
    if (!s || !items) continue;
    const correct = correctOf(b);
    if (correct === null) continue;
    const key = `${b.block}|${s.student_id}`;
    const at = String(s.created_at || '');
    const prev = latest.get(key);
    if (!prev || at > prev.at) latest.set(key, { at, passed: correct / items >= PASS });
  }
  const out = new Map(LINKS.links.map((l) => [l.egma, { egma: l.egma, scored: 0, passing: 0 }]));
  for (const [key, v] of latest) {
    const r = out.get(key.split('|')[0]);
    r.scored += 1;
    if (v.passed) r.passing += 1;
  }
  return [...out.values()];
}

async function teachers({ testOnly = true } = {}) {
  const lists = check('class lists', await supabase.from('student_lists')
    .select('user_id, class_id').eq('is_active', true).not('class_id', 'is', null).limit(MAX.lists));
  const ids = [...new Set(lists.map((l) => l.user_id).filter(Boolean))];
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const users = check('teachers', await supabase.from('users')
      .select('id, phone_number, is_test_user').in('id', ids.slice(i, i + CHUNK))
      .eq('role', 'teacher').is('deleted_at', null).limit(MAX.users));
    for (const u of users) {
      if (!u.phone_number) continue;
      if (testOnly ? u.is_test_user === true : u.is_test_user !== true) out.push(u.id);
    }
  }
  return out;
}

async function listsOf(userId) {
  const lists = check('own lists', await supabase.from('student_lists')
    .select('id, class_name, section, class_id').eq('user_id', userId).eq('is_active', true).not('class_id', 'is', null));
  if (!lists.length) return [];
  const classes = check('classes', await supabase.from('classes')
    .select('id, school_id, grade_code, is_active').in('id', [...new Set(lists.map((l) => l.class_id))]));
  const byId = new Map(classes.filter((c) => c.is_active !== false).map((c) => [c.id, c]));
  return lists
    .map((l) => ({ listId: l.id, label: `${l.class_name || ''} ${l.section || ''}`.trim(), classId: l.class_id, cls: byId.get(l.class_id) }))
    .filter((l) => l.cls && GRADE_OF[l.cls.grade_code])
    .map((l) => ({ listId: l.listId, label: l.label, classId: l.classId, schoolId: l.cls.school_id, grade: GRADE_OF[l.cls.grade_code] }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function groupResults({ schoolId, grade, sinceIso, untilIso, includeTestCoaches = false }) {
  const sessions = check('child tests', await supabase.from('child_test_sessions')
    .select('id, student_id, coach_user_id, created_at')
    .eq('school_id', schoolId).eq('grade', grade).eq('item_bank_version', BANK).eq('status', 'completed')
    .gte('created_at', sinceIso).lt('created_at', untilIso)
    .limit(MAX.sessions));
  let kept = sessions;
  if (!includeTestCoaches && sessions.length) {
    const coaches = [...new Set(sessions.map((s) => s.coach_user_id))];
    const test = new Set(check('coaches', await supabase.from('users').select('id, is_test_user').in('id', coaches))
      .filter((u) => u.is_test_user === true).map((u) => u.id));
    kept = sessions.filter((s) => !test.has(s.coach_user_id));
  }
  const blocks = [];
  const ids = kept.map((s) => s.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    blocks.push(...check('child test tasks', await supabase.from('child_test_blocks')
      .select('session_id, block, response_mode, ai_status, ai_marks')
      .in('session_id', ids.slice(i, i + CHUNK)).in('block', Object.keys(ITEMS)).limit(MAX.blocks)));
  }
  return countResults(kept, blocks);
}

/** The teacher the nudge is addressed to, read at send time (language may have changed). */
async function teacher(userId) {
  const { data, error } = await supabase.from('users')
    .select('id, name, phone_number, preferred_language, is_test_user').eq('id', userId).is('deleted_at', null).maybeSingle();
  if (error) check('teacher', { error });
  return data || null;
}

module.exports = { teachers, listsOf, groupResults, teacher, countResults, correctOf, GRADE_OF };
