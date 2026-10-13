'use strict';
/**
 * Which K-5 lesson plans did a teacher TAKE — on any surface.
 *
 * A lesson plan reaches a teacher two ways, and each leaves its own record:
 *
 *   niete_lp_downloads  status 'sent'   the PDF was delivered on WhatsApp
 *   niete_lp_opens      plan_kind 'k5'  she opened it in the teacher app — in the app's
 *                                       viewer ('viewer') or as a link handed to another
 *                                       app ('external'). Every source value counts, so a
 *                                       new one needs no change here.
 *
 * The 15:00 lesson-plan quiz offer and the /quiz "from my lesson plan" list both ask this
 * module, so the two can never disagree about which lessons she took.
 *
 * THE SWITCH. The app half is behind app_settings `lp_quiz_app_lessons`, read on every call
 * (no cache: one primary-key read, against a once-a-day build and a hand-sent command).
 * Absent, false, or unreadable → OFF, and an unreadable switch is logged at error level.
 * OFF, every function here returns exactly the WhatsApp rows the callers read before this
 * module existed — same query, same rows, same order — and niete_lp_opens is never read.
 *
 * WHAT AN APP OPEN BECOMES. The same row shape a download carries, resolved to what the app
 * served her:
 *   grade, subject, chapter_number, segment_index   from the v8 catalogue (lessonById) — the
 *       very fields lp-v8-delivery writes on a download (book.grade, book.subject_key), so a
 *       teacher who took one lesson on each surface gets ONE class, not two.
 *   asset_id, version_stamp, content_hash           the LESSON asset the app's Open picked for
 *       her AT opened_at (lp-v8-browse lessonPdfUrl → lp-ab-ch310): her A/B group's August
 *       version, else the row current at that moment (created_at ≤ opened_at, not superseded
 *       by then — niete_lp_assets.superseded_at). Picked with lp-ab-ch310's pickAsset over a
 *       batch read — no presigning, no per-lesson query. An answer key is never resolved (the portal records an answer-key
 *       open under the same plan_ref, and an answer key is never a quiz source); a lesson with
 *       no lesson asset for her is dropped, as the app could not have served it.
 *   created_at                                      opened_at, the moment she took it.
 * A version pushed between her open and the 15:00 read does not replace the one she saw (pushes
 * do land inside school hours). The assets read covers every row of the opened lessons, so it
 * is resolved over the whole window before the caller's `keep` runs; the window is small.
 *
 * ONE LESSON, ONE ROW (switch on). Per (teacher, lesson): the WhatsApp row if there is one
 * (it records the exact version delivered), dated by the EARLIEST surface time. `surface` says
 * where it came from: 'wa', 'app' or 'both'. The caller's `keep` predicate runs on each raw
 * row BEFORE this, so the cohort's day rule picks the rows first and an older take of the same
 * lesson on another day cannot pull today's lesson out of today.
 *
 * LOAD (Class R). Window reads: niete_lp_downloads as before; niete_lp_opens by plan_kind +
 * opened_at window, paged 1,000 at a time (no index leads with opened_at — measured and
 * proposed separately, never added here). Then three chunked .in() reads of at most 200 ids
 * (users.school_id and niete_lp_ab_assignment only while the A/B flag is on; niete_lp_assets
 * for the opened lessons and their day-1 twins). Per teacher: one indexed read per table
 * (idx_lp_downloads_user_time, idx_lp_opens_user_recent), each capped.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { pagedRows, PAGE, MAX_PAGES } = require('../../utils/postgrest-paged');
const Catalog = require('../lp-v8-catalog.service');
const LpAb = require('../lp-ab-ch310.service');

const SWITCH_KEY = 'lp_quiz_app_lessons';
const IN_CHUNK = 200;
const OPEN_SELECT = 'id, user_id, plan_ref, opened_at';
const ASSET_SELECT = 'id, lesson_id, asset_kind, version_stamp, content_hash, is_current, superseded_at, created_at';
/** What the 15:00 cohort has always read from a download — unchanged. */
const WINDOW_DOWNLOAD_SELECT = 'user_id, lesson_id, asset_id, version_stamp, content_hash, grade, subject, chapter_number, segment_index, created_at';
/** What the /quiz list has always read from a download — unchanged. */
const TEACHER_DOWNLOAD_SELECT = 'id, user_id, lesson_id, asset_id, version_stamp, content_hash, grade, subject, status, created_at';

function chunks(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** PostgREST's answer for a table this database does not have (PGRST205 / 42P01). */
function isMissingTable(error) {
  const code = String((error && error.code) || '');
  return code === 'PGRST205' || code === '42P01'
    || /does not exist|schema cache/i.test(String((error && error.message) || ''));
}

/** A read error as a thrown Error that remembers whether the table is simply not there. */
function readError(label, error) {
  const err = new Error(`${label}: ${error.message || error}`);
  err.missingTable = isMissingTable(error);
  return err;
}

function isOn(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  if (v === true) return true;
  if (v && typeof v === 'object' && v.enabled === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

/** Is the app half on? Read at call time; absent or unreadable → false. Never throws. */
async function appLessonsOn() {
  try {
    const { data, error } = await supabase
      .from('app_settings').select('key, value').eq('key', SWITCH_KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    return Boolean(data && isOn(data.value));
  } catch (err) {
    logToFile(`lessons taken: ${SWITCH_KEY} unreadable — app lessons OFF`, { error: err.message }, 'error');
    return false;
  }
}

/** pagedRows, but a failed read throws instead of returning a short set. */
async function pagedOrThrow(label, buildQuery) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw readError(label, error);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
  logToFile('lessons taken: hit the page ceiling — the set may be incomplete', { label, collected: all.length }, 'error');
  return all;
}

// ─── resolving an app open ──────────────────────────────────────────────────

/**
 * niete_lp_opens rows → download-shaped rows, each resolved to the lesson asset the app serves
 * her. Unknown lessons and lessons with nothing to serve her are dropped (counted in the log).
 */
async function resolveOpens(opens) {
  const hits = [];
  let unknown = 0;
  for (const o of opens || []) {
    const hit = o && o.plan_ref ? Catalog.lessonById(o.plan_ref) : null;
    if (!hit) { unknown += 1; continue; }
    hits.push({ open: o, hit });
  }
  if (!hits.length) {
    if (unknown) logToFile('lessons taken: app opens of lessons the catalogue does not know', { unknown });
    return [];
  }

  const groups = await LpAb.groupsForUsers([...new Set(hits.map((h) => h.open.user_id))]);
  const groupOf = ({ open, hit }) => (LpAb.inScope({ grade: Number(hit.book.grade), chapter: Number(hit.chapter.number) })
    ? groups.get(open.user_id) || null
    : null);

  const lessonIds = new Set();
  for (const h of hits) {
    lessonIds.add(h.open.plan_ref);
    if (groupOf(h) === 'A') lessonIds.add(h.open.plan_ref.replace(/(seg\d+)b$/, '$1'));
  }
  const assets = [];
  for (const part of chunks([...lessonIds])) {
    // eslint-disable-next-line no-await-in-loop
    assets.push(...await pagedOrThrow('lessons taken: assets', () => supabase
      .from('niete_lp_assets').select(ASSET_SELECT)
      .in('lesson_id', part)
      .eq('asset_kind', 'lesson')));
  }

  const out = [];
  let unserved = 0;
  for (const h of hits) {
    const a = LpAb.pickAsset({
      group: groupOf(h), lessonId: h.open.plan_ref, assetKind: 'lesson', assets, at: h.open.opened_at,
    });
    if (!a) { unserved += 1; continue; }
    out.push({
      id: h.open.id,
      surface: 'app',
      user_id: h.open.user_id,
      lesson_id: h.open.plan_ref,
      asset_id: a.id,
      version_stamp: a.version_stamp,
      content_hash: a.content_hash,
      grade: h.hit.book.grade,
      subject: h.hit.book.subject_key,
      chapter_number: h.hit.chapter.number,
      segment_index: h.hit.lesson.segment_index,
      created_at: h.open.opened_at,
    });
  }
  if (unknown || unserved) logToFile('lessons taken: app opens left out', { unknown, unserved });
  return out;
}

/**
 * One row per (teacher, lesson): the WhatsApp row when there is one, dated by the earliest
 * surface time, with `surface` 'wa' | 'app' | 'both'. Order: earliest first.
 */
function mergeTaken(waRows, appRows) {
  const byKey = new Map();
  const time = (r) => new Date(r.created_at).getTime();
  for (const r of [...(waRows || []).map((w) => ({ ...w, surface: 'wa' })), ...(appRows || [])]) {
    if (!r || !r.user_id || !r.lesson_id) continue;
    const key = `${r.user_id}|${r.lesson_id}`;
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, { row: r, earliest: r.created_at, surfaces: new Set([r.surface]) }); continue; }
    cur.surfaces.add(r.surface);
    if (time(r) < new Date(cur.earliest).getTime()) cur.earliest = r.created_at;
    const preferNew = (r.surface === 'wa' && cur.row.surface !== 'wa')
      || (r.surface === cur.row.surface && time(r) < time(cur.row));
    if (preferNew) cur.row = r;
  }
  return [...byKey.values()]
    .map(({ row, earliest, surfaces }) => ({
      ...row,
      created_at: earliest,
      surface: surfaces.size > 1 ? 'both' : [...surfaces][0],
    }))
    .sort((a, b) => time(a) - time(b));
}

/** Teachers by where their lessons came from — the cohort's per-surface log line. */
function surfaceMix(rows) {
  const byTeacher = new Map();
  for (const r of rows || []) {
    if (!r || !r.user_id) continue;
    if (!byTeacher.has(r.user_id)) byTeacher.set(r.user_id, new Set());
    const s = byTeacher.get(r.user_id);
    if (r.surface === 'both') { s.add('wa'); s.add('app'); } else s.add(r.surface || 'wa');
  }
  const mix = { wa: 0, app: 0, both: 0, teachers: byTeacher.size };
  for (const s of byTeacher.values()) {
    if (s.size > 1) mix.both += 1; else if (s.has('app')) mix.app += 1; else mix.wa += 1;
  }
  return mix;
}

// ─── the two questions ──────────────────────────────────────────────────────

/**
 * Every teacher's lessons taken in [from, to) — the 15:00 cohort's read.
 *
 * @param {{from: Date|string, to: Date|string, keep?: (row) => boolean}} args
 *   `keep` runs on each raw row of either surface before rows are merged.
 * @returns {Promise<{rows: object[], appLessons: boolean}>}
 *   Switch off: rows are exactly the `sent` downloads with an asset that `keep` accepts.
 */
async function takenInWindow({ from, to, keep = () => true }) {
  const lower = new Date(from).toISOString();
  const upper = new Date(to).toISOString();
  const wa = (await pagedRows('lp quiz offer: downloads', () => supabase
    .from('niete_lp_downloads')
    .select(WINDOW_DOWNLOAD_SELECT)
    .eq('status', 'sent')
    .gte('created_at', lower)
    .lt('created_at', upper)))
    .filter((r) => r.asset_id && keep(r));

  const appLessons = await appLessonsOn();
  if (!appLessons) return { rows: wa, appLessons };

  let app = [];
  try {
    const opens = await pagedOrThrow('lessons taken: opens', () => supabase
      .from('niete_lp_opens')
      .select(OPEN_SELECT)
      .eq('plan_kind', 'k5')
      .gte('opened_at', lower)
      .lt('opened_at', upper));
    app = (await resolveOpens(opens)).filter((r) => keep(r));
  } catch (err) {
    // WhatsApp lessons still count; the app ones are missing, and that is said where it is seen.
    logToFile('❌ lessons taken: app opens could not be read — WhatsApp lessons only', { error: err.message }, 'error');
  }
  return { rows: mergeTaken(wa, app), appLessons };
}

/**
 * One teacher's lessons taken since `since`, newest first — the /quiz list's read.
 * Each surface is capped at `limit` rows. Throws (with `.missingTable`) when the WhatsApp
 * ledger cannot be read, exactly as the list's own read did; an app read that fails costs
 * only the app rows, at error level.
 *
 * @returns {Promise<object[]>} switch off: the download rows, exactly as read before
 */
async function takenByTeacher(userId, { since, limit = 200 }) {
  const fromIso = new Date(since).toISOString();
  const { data, error } = await supabase.from('niete_lp_downloads')
    .select(TEACHER_DOWNLOAD_SELECT)
    .eq('user_id', userId).eq('status', 'sent').gte('created_at', fromIso)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw readError('lp lesson provider: downloads', error);
  const wa = data || [];
  if (!(await appLessonsOn())) return wa;

  let app = [];
  try {
    const { data: opens, error: openError } = await supabase.from('niete_lp_opens')
      .select(OPEN_SELECT)
      .eq('user_id', userId).eq('plan_kind', 'k5').gte('opened_at', fromIso)
      .order('opened_at', { ascending: false })
      .limit(limit);
    if (openError) throw readError('lessons taken: opens', openError);
    app = await resolveOpens(opens || []);
  } catch (err) {
    logToFile('❌ lessons taken: app opens could not be read — WhatsApp lessons only', { userId, error: err.message }, 'error');
  }
  return mergeTaken(wa, app).reverse();
}

/**
 * One taken lesson by its row id — a download id, or (switch on) an app open id. Owner-filtered
 * in the query. Null when it is neither hers nor taken.
 */
async function takenById(userId, ref) {
  const { data, error } = await supabase.from('niete_lp_downloads')
    .select(TEACHER_DOWNLOAD_SELECT)
    .eq('id', ref).eq('user_id', userId).eq('status', 'sent')
    .maybeSingle();
  if (error) throw new Error(`lp lesson provider: download read failed — ${error.message || error}`);
  if (data) return data;
  if (!(await appLessonsOn())) return null;

  const { data: o, error: openError } = await supabase.from('niete_lp_opens')
    .select(OPEN_SELECT)
    .eq('id', ref).eq('user_id', userId).eq('plan_kind', 'k5')
    .maybeSingle();
  if (openError) throw new Error(`lessons taken: open read failed — ${openError.message || openError}`);
  if (!o) return null;
  const [row] = await resolveOpens([o]);
  return row || null;
}

module.exports = {
  SWITCH_KEY,
  appLessonsOn,
  takenInWindow,
  takenByTeacher,
  takenById,
  surfaceMix,
  isMissingTable,
  // exported for the tests of the merge rule
  mergeTaken,
};
