'use strict';
/**
 * The teacher's Jugnu tab — the data behind /r/<token>?tab=jugnu (switch web_quiz_teacher_jugnu).
 *
 *   jugnuTab(teacherId, { listId, lang, now })  one of the teacher's class lists: one row per active
 *       child of that class (first name, the father's first name for a homonym), the stops done this
 *       period, "stopped early" / "waiting for a microphone", stickers, lamps (highest rung per ladder),
 *       days this week, "saved on WhatsApp"; the coverage line; this week's story for the forward.
 *   confirmQueue(teacherId, tab)  the teacher-confirm queue rows for that class (the join-queue
 *       service's rows + this teacher's still-standing "Same child" decisions, for Undo).
 *
 * "Done" = a RECORD row of this period (record true, never mode 'practice') that reached a final status
 * (scored, or failed other than the no-microphone path). 'served' and 'abandoned' rows show nothing.
 * "Started" (the coverage line) = any record row of this period, whatever its status.
 * Runs are joined on the child (canonical_id, else student_id), never on runs.class_id: a share-code
 * run of an enrolled child carries no class and still counts for that child.
 *
 * Tables of later trains (runs v2 columns, child_rungs, child_phone_bindings, class_links,
 * challenge_passages, merge_log) are read defensively: a failed read empties that column only, logged
 * once per process. Nothing here writes. Names leave this module as first names only; a phone never
 * leaves the database (the bindings read selects no phone column).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Roster = require('./web-quiz-roster');
const { listLabel } = require('./teacher-report.data');

const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const STOPS = [['missing', 'warm'], ['read', 'read'], ['listen', 'listen'], ['bigger', 'bigger']];
const STOP_OF = Object.fromEntries(STOPS);
const RUN_COLS = 'id, student_id, canonical_id, exercise, status, mode, record, period_id, passage_id, wcpm, meta, created_at, scored_at';
const LADDER = { reading: 'r', numbers: 'n' };

const warned = new Set();
function warnOnce(what, err) {
  if (warned.has(what)) return;
  warned.add(what);
  logToFile('⚠️ teacher jugnu tab: a read failed — that part renders empty', { what, error: err && err.message }, 'warn');
}

/** Rows of a query, or null when the read failed (a missing table or column on this environment). */
async function rowsOr(what, query) {
  try {
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'read failed');
    return data || [];
  } catch (err) {
    warnOnce(what, err);
    return null;
  }
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const foldKey = (s) => String(s || '').normalize('NFKD').replace(/[̀-ًͯ-ٰٟ]/g, '').toLowerCase();

/** PKT calendar month 'YYYY-MM' and the PKT week's Monday 00:00 (as UTC ms). */
function periodOf(now) {
  const d = new Date(now + PKT_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function weekStartOf(now) {
  const d = new Date(now + PKT_MS);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnight - ((d.getUTCDay() + 6) % 7) * DAY_MS - PKT_MS;
}

const isRecord = (r) => r.record === true && r.mode !== 'practice';
const noMic = (r) => r.status === 'failed' && Boolean(r.meta && r.meta.reason === 'no_mic');
const isFinal = (r) => (r.status === 'scored' || r.status === 'failed') && !noMic(r);
const whenOf = (r) => Date.parse(r.scored_at || r.created_at || '');

/** The teacher's active lists, sorted by label; the asked one when it is the teacher's, else the first. */
async function pickList(teacherId, listId) {
  const lists = await rowsOr('student_lists', supabase.from('student_lists')
    .select('id, class_name, section, class_id').eq('user_id', teacherId).eq('is_active', true));
  if (!lists || !lists.length) return null;
  const sorted = lists.map((l) => ({ id: l.id, label: listLabel(l), classId: l.class_id || null, grade: (String(l.class_name || '').match(/\d+/) || [''])[0] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return sorted.find((l) => l.id === listId) || sorted[0];
}

/** The class's active children: active enrolments of the list's class, else the list's own active children. */
async function rosterOf(list) {
  let ids = null;
  if (list.classId) {
    const enr = await rowsOr('class_enrollments', supabase.from('class_enrollments')
      .select('student_id').eq('class_id', list.classId).eq('is_active', true));
    if (enr) ids = [...new Set(enr.map((e) => e.student_id))];
  }
  const cols = 'id, list_id, student_name, student_name_urdu, father_name, is_active, merged_into';
  const kids = ids
    ? (ids.length ? await rowsOr('students', supabase.from('students').select(cols).in('id', ids).eq('is_active', true)) : [])
    : await rowsOr('students', supabase.from('students').select(cols).eq('list_id', list.id).eq('is_active', true));
  return (kids || []).filter((k) => !k.merged_into);
}

async function runsOf(ids) {
  if (!ids.length) return [];
  const [a, b] = await Promise.all([
    rowsOr('web_quiz_challenge_runs', supabase.from('web_quiz_challenge_runs').select(RUN_COLS).in('canonical_id', ids)),
    rowsOr('web_quiz_challenge_runs', supabase.from('web_quiz_challenge_runs').select(RUN_COLS).in('student_id', ids)),
  ]);
  if (!a && !b) return null;
  const byId = new Map();
  [...(a || []), ...(b || [])].forEach((r) => byId.set(r.id, r));
  const inClass = new Set(ids);
  return [...byId.values()].map((r) => ({ ...r, child: inClass.has(r.canonical_id) ? r.canonical_id : r.student_id }))
    .filter((r) => inClass.has(r.child));
}

/** This week's released story (released this PKT week, not in the future), when the class has a live link. */
async function weekStory(list, now) {
  if (!list.classId) return null;
  const nowIso = new Date(now).toISOString();
  const links = await rowsOr('class_links', supabase.from('class_links')
    .select('class_id, expires_at, revoked_at').eq('class_id', list.classId).is('revoked_at', null));
  if (!links || !links.some((l) => !l.expires_at || l.expires_at > nowIso)) return null;
  const from = new Date(weekStartOf(now)).toISOString();
  const passages = await rowsOr('challenge_passages', supabase.from('challenge_passages')
    .select('passage_id, title_en, title_ur, released_at').gte('released_at', from));
  const live = (passages || []).filter((p) => p.released_at && p.released_at <= nowIso)
    .sort((x, y) => String(y.released_at).localeCompare(String(x.released_at)));
  const p = live[0];
  return p ? { en: p.title_en || null, ur: p.title_ur || p.title_en || null } : null;
}

/**
 * @returns {Promise<null | {list, kids: object[], coverage: {n, total}|null, story: {en, ur}|null, period}>}
 */
async function jugnuTab(teacherId, { listId = null, lang = 'en', now = Date.now() } = {}) {
  const list = await pickList(teacherId, listId);
  if (!list) return null;
  const roster = await rosterOf(list);
  const ids = roster.map((k) => k.id);
  const period = periodOf(now);
  const weekStart = weekStartOf(now);
  const [runs, rungs, binds, story] = await Promise.all([
    runsOf(ids),
    ids.length ? rowsOr('child_rungs', supabase.from('child_rungs').select('canonical_id, ladder, rung').in('canonical_id', ids)) : [],
    // Never a phone column: the tab says "saved", nothing more.
    ids.length ? rowsOr('child_phone_bindings', supabase.from('child_phone_bindings').select('canonical_id, revoked_at, expires_at').in('canonical_id', ids)) : [],
    weekStory(list, now),
  ]);
  const nowIso = new Date(now).toISOString();
  const saved = new Set((binds || []).filter((b) => !b.revoked_at && (!b.expires_at || b.expires_at > nowIso)).map((b) => b.canonical_id));

  const kids = roster.map((k) => {
    const mine = (runs || []).filter((r) => r.child === k.id);
    const rec = mine.filter((r) => isRecord(r) && r.period_id === period);
    const doneStops = new Set(rec.filter(isFinal).map((r) => STOP_OF[r.exercise]).filter(Boolean));
    // Trail stickers (a stop finished in a period, all time) + story stickers (a passage finished, all time).
    const trail = new Set(mine.filter((r) => isRecord(r) && isFinal(r) && STOP_OF[r.exercise]).map((r) => `${r.period_id}|${r.exercise}`));
    const stories = new Set(mine.filter((r) => r.status === 'scored' && r.passage_id).map((r) => r.passage_id));
    const days = [0, 0, 0, 0, 0, 0, 0];
    mine.filter(isFinal).forEach((r) => {
      const i = Math.floor((whenOf(r) - weekStart) / DAY_MS);
      if (i >= 0 && i < 7) days[i] = 1;
    });
    const lamps = {};
    (rungs || []).filter((g) => g.canonical_id === k.id && LADDER[g.ladder]).forEach((g) => {
      const key = LADDER[g.ladder];
      lamps[key] = Math.max(lamps[key] || 0, Number(g.rung) || 0);
    });
    const name = Roster.displayName(k, lang);
    return {
      id: k.id,
      first: firstName(name),
      father: firstName(k.father_name),
      started: rec.length > 0,
      stops: STOPS.map(([, key]) => ({ key, done: doneStops.has(key) })),
      stopped: rec.some((r) => r.exercise === 'read' && r.status === 'scored' && r.wcpm != null && Number(r.wcpm) === 0),
      mic: rec.some(noMic) && !doneStops.has('read'),
      stickers: runs ? trail.size + stories.size : null,
      lamps: rungs ? lamps : null,
      days: runs ? days : null,
      saved: saved.has(k.id),
    };
  });
  // Homonyms on the teacher's own page: the father's first name, when the list has it (IDENTITY §2 (a)).
  const count = new Map();
  kids.forEach((k) => count.set(foldKey(k.first), (count.get(foldKey(k.first)) || 0) + 1));
  kids.forEach((k) => { k.homonym = count.get(foldKey(k.first)) > 1; if (!k.homonym) k.father = ''; });
  // First name only — never by lamps, stickers or anything earned.
  kids.sort((a, b) => foldKey(a.first).localeCompare(foldKey(b.first)) || foldKey(a.father).localeCompare(foldKey(b.father)) || a.id.localeCompare(b.id));
  return {
    list, kids, period, story,
    coverage: runs ? { n: kids.filter((k) => k.started).length, total: kids.length } : null,
  };
}

/** The join-queue service (identity), when deployed; null otherwise. */
function queueService() {
  try {
    // eslint-disable-next-line global-require
    return require('./web-quiz-join-queue');
  } catch (err) {
    warnOnce('web-quiz-join-queue', err);
    return null;
  }
}

/**
 * The confirm queue for the tab's class: open pairs from the service + this teacher's "Same child"
 * decisions still standing (latest merge_log row of the pair), for Undo. First names only.
 */
async function confirmQueue(teacherId, tab, lang = 'en') {
  const Q = queueService();
  if (!Q || typeof Q.candidatesFor !== 'function' || !tab || !tab.list) return null;
  let open = [];
  try {
    open = (await Q.candidatesFor(teacherId)) || [];
  } catch (err) {
    warnOnce('candidatesFor', err);
    open = [];
  }
  const classId = tab.list.classId;
  const rows = open.filter((r) => r && r.loose_id && r.candidate_id && (!classId || !r.class_id || r.class_id === classId))
    .map((r) => ({ looseId: r.loose_id, candidateId: r.candidate_id, first: firstName(r.first_name), candidateFirst: firstName(r.candidate_first_name), grade: r.grade != null ? String(r.grade) : tab.list.grade, decided: false }));
  const log = await rowsOr('merge_log', supabase.from('merge_log')
    .select('loose_id, candidate_id, decision, decided_at').eq('teacher_id', teacherId).eq('source', 'queue'));
  const latest = new Map();
  (log || []).sort((a, b) => String(a.decided_at).localeCompare(String(b.decided_at)))
    .forEach((m) => latest.set(`${m.loose_id}|${m.candidate_id}`, m));
  const inClass = new Map(tab.kids.map((k) => [k.id, k]));
  const decided = [...latest.values()].filter((m) => m.decision === 'same' && inClass.has(m.candidate_id));
  if (decided.length) {
    const loose = await rowsOr('students', supabase.from('students').select('id, student_name, student_name_urdu').in('id', decided.map((m) => m.loose_id)));
    const names = new Map((loose || []).map((s) => [s.id, firstName(Roster.displayName(s, lang))]));
    decided.forEach((m) => rows.push({
      looseId: m.loose_id, candidateId: m.candidate_id, first: names.get(m.loose_id) || '', candidateFirst: inClass.get(m.candidate_id).first, grade: tab.list.grade, decided: true,
    }));
  }
  return rows.filter((r) => r.first && r.candidateFirst);
}

module.exports = { jugnuTab, confirmQueue, queueService, periodOf, weekStartOf, firstName, _resetWarnings: () => warned.clear() };
