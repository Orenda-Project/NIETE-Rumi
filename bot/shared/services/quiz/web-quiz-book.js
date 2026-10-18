'use strict';
/**
 * JUGNU'S BOOK — the child's own page of what they have done with Jugnu (app_settings `web_quiz_challenge_book`,
 * effective only with `web_quiz_challenge_v2`, `web_quiz_challenge` and `web_quiz_hub` on; fails closed), and the
 * class lights line (`web_quiz_class_wall`, effective only with the Book on).
 *
 *   bookFor({hub, kid, device, lang})  the Book's JSON for the child a hub chip names on a trusted phone
 *   hubBits({studentId})               {} with the Book off; else {book_on: true, class_lights?} for the hub payload
 *
 * Everything here is READ from rows the server already wrote; nothing is decided for the child on the page:
 *   - lamps come from `child_rungs` only (the rung job writes it). No table, no row, an error -> 0 lamps. A run row
 *     that "would" meet a rung never lights a lamp here.
 *   - next_outline: one unlabelled outline per ladder after the lit lamps; none after rung 5; none for grade 1.
 *   - trail stickers: the stops of this PKT month with a final record row (any outcome, 0 words included).
 *   - story stickers: the first finish (a `scored` row: the child reached the end card) of each passage, keyed on
 *     passage_id; a swept (`failed`) run keeps its Trail sticker but gives no story sticker.
 *   - days this week: 7 booleans Mon..Sun PKT, a finished stop or story that day.
 *   - class lights: one light = one first finish by a child of the class in the term; shown only with >= 5 distinct
 *     children in the term; "+n this week" only when n >= 5 and from >= 3 children; never a name, never who has not
 *     played.
 *   - levelup: the newest lamp set this period ({ladder, rung, opens}), a lamp a scored run set before one a swept run
 *     set (child_rungs.row_id names the run); the page shows it once.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const HUB_KEY = 'web_quiz_hub';
const CHALLENGE_KEY = 'web_quiz_challenge';
const V2_KEY = 'web_quiz_challenge_v2';
const BOOK_KEY = 'web_quiz_challenge_book';
const WALL_KEY = 'web_quiz_class_wall';
// Story Time (parent _v2): every room a new lamp opens is there, so `opens` is named only while it is on.
const STORY_KEY = 'web_quiz_challenge_story';
const TTL_MS = 30 * 1000;
const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 86400000;
// Final rows only (a swept run is written `failed`); `served`, `scoring` and `abandoned` rows never light anything.
const FINAL = new Set(['scored', 'failed']);
// The four Trail stops by their stop id (the warm-up is `missing`, anchor block A1).
const STOPS = ['missing', 'read', 'listen', 'bigger'];
const MIN_CHILDREN = 5;
const MIN_WEEK = 5;
const MIN_WEEK_CHILDREN = 3;
const TOP_RUNG = 5;
let cache = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** {book, wall}: each effective only with its parents on. Fails closed. */
async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [HUB_KEY, CHALLENGE_KEY, V2_KEY, BOOK_KEY, WALL_KEY, STORY_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const v2 = isTrue(by[HUB_KEY]) && isTrue(by[CHALLENGE_KEY]) && isTrue(by[V2_KEY]);
    const book = v2 && isTrue(by[BOOK_KEY]);
    cache = { at: now, book, wall: book && isTrue(by[WALL_KEY]), story: v2 && isTrue(by[STORY_KEY]) };
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz book: settings lookup failed — book off', { error: err.message });
    return { book: false, wall: false, story: false };
  }
}

// ─── PKT calendar (pure) ──────────────────────────────────────────────────────────────────────────────

const pkt = (ms) => new Date(ms + PKT_MS);
const pktMidnightUtc = (y, m, d) => Date.UTC(y, m, d) - PKT_MS;
function periodOf(ms) { const p = pkt(ms); return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`; }
function weekStart(ms) {
  const p = pkt(ms);
  const back = (p.getUTCDay() + 6) % 7; // Monday = 0
  return pktMidnightUtc(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() - back);
}
/** 1 April - 30 September and 1 October - 31 March, PKT. */
function termStart(ms) {
  const p = pkt(ms);
  const y = p.getUTCFullYear();
  const m = p.getUTCMonth();
  if (m >= 3 && m <= 8) return pktMidnightUtc(y, 3, 1);
  return m >= 9 ? pktMidnightUtc(y, 9, 1) : pktMidnightUtc(y - 1, 9, 1);
}
const rowAt = (r) => Date.parse(r.scored_at || r.created_at || '') || 0;
// A run the teacher's class round served (mode or via): the Book follows the child's voluntary stops only (SAMPLING_RULING NC4).
const roundRow = (r) => r.mode === 'class_round' || r.via === 'class_round';

// ─── reads (each fails closed) ────────────────────────────────────────────────────────────────────────

const V2_COLS = 'id, student_id, canonical_id, exercise, status, mode, record, period_id, passage_id, item_set_id, class_id, exposure_no, via, created_at, scored_at';
const BASE_COLS = 'id, student_id, exercise, status, created_at, scored_at';

/** The child's runs, newest first: the v2 columns when they exist, else today's columns ({rows, v2}). */
async function childRuns(studentId) {
  try {
    const v2 = await supabase.from('web_quiz_challenge_runs').select(V2_COLS).eq('student_id', studentId).order('created_at', { ascending: false }).limit(500);
    if (!v2.error) return { rows: v2.data || [], v2: true };
    const base = await supabase.from('web_quiz_challenge_runs').select(BASE_COLS).eq('student_id', studentId).order('created_at', { ascending: false }).limit(500);
    return { rows: base.error ? [] : base.data || [], v2: false };
  } catch (err) {
    logToFile('⚠️ web quiz book: runs unavailable', { error: err.message });
    return { rows: [], v2: false };
  }
}

/** The child's rung rows (child_rungs, append-only). No table or an error: none. */
async function rungRows(canonicalId) {
  try {
    const { data, error } = await supabase.from('child_rungs').select('ladder, rung, period_id, set_at, row_id').eq('canonical_id', canonicalId);
    return error ? [] : (data || []).filter((r) => (r.ladder === 'reading' || r.ladder === 'numbers') && Number.isFinite(Number(r.rung)));
  } catch (_) {
    return [];
  }
}

async function fixedGrade(canonicalId, fallback) {
  try {
    const { data, error } = await supabase.from('child_identity').select('fixed_grade').eq('canonical_id', canonicalId).maybeSingle();
    const g = !error && data && Number(data.fixed_grade);
    if (g) return g;
  } catch (_) { /* the hub's grade */ }
  const n = Number(String(fallback == null ? '' : fallback).replace(/\D+/g, ''));
  return n || null;
}

// The passage FILE's title in the child's language (one title home: web-quiz-passage-title.js;
// Urdu ur → en, English en); '' when the file has none (the Book prints its generic).
async function titlesOf(passageIds, lang) {
  if (!passageIds.length) return new Map();
  const { titleFor } = require('./web-quiz-passage-title');
  return new Map(passageIds.map((id) => [id, titleFor(id, lang) || '']));
}

async function classOf(studentId, rows) {
  const hit = rows.find((r) => r.class_id);
  if (hit) return hit.class_id;
  try {
    const { data, error } = await supabase.from('class_enrollments').select('class_id').eq('student_id', studentId).eq('is_active', true);
    const r = !error && (data || []).find((x) => x.class_id);
    return r ? r.class_id : null;
  } catch (_) {
    return null;
  }
}

// ─── the parts (pure) ─────────────────────────────────────────────────────────────────────────────────

function lampsOf(rungs) {
  const top = (ladder) => rungs.filter((r) => r.ladder === ladder).reduce((m, r) => Math.max(m, Math.min(TOP_RUNG, Number(r.rung) || 0)), 0);
  return { reading: top('reading'), numbers: top('numbers') };
}

function outlineOf(lamps, grade) {
  if (grade === 1) return { reading: false, numbers: false };
  return { reading: lamps.reading < TOP_RUNG, numbers: lamps.numbers < TOP_RUNG };
}

/**
 * THE TRAIL ADAPTER: the stops of this period with a final record row (any outcome, 0 words included), read from the
 * runs directly. One function, so the draw module's trailStateFor(canonicalId, periodId) can replace it in one place.
 */
function trailStickersFor(rows, v2, period) {
  const done = new Set();
  rows.forEach((r) => {
    if (!FINAL.has(r.status) || !STOPS.includes(r.exercise)) return;
    if (v2 && r.mode != null) {
      if (r.mode !== 'check' || r.record !== true || r.period_id !== period) return;
    } else if (periodOf(rowAt(r)) !== period) return;
    done.add(r.exercise);
  });
  return STOPS.filter((s) => done.has(s));
}

function daysOf(rows, now) {
  const start = weekStart(now);
  const days = [false, false, false, false, false, false, false];
  rows.forEach((r) => {
    const at = rowAt(r);
    if (!FINAL.has(r.status) || roundRow(r) || noiseRow(r) || at < start || at >= start + 7 * DAY_MS) return;
    days[Math.floor((at - start) / DAY_MS)] = true;
  });
  return days;
}

// A check the scorer judged not a reading (implausible: scored, record lost) earns no story sticker and lights no day.
const noiseRow = (r) => r.status === 'scored' && r.record === false && r.mode === 'check';

function storyIdsOf(rows) {
  const first = new Map();
  rows.forEach((r) => {
    if (!r.passage_id || !FINAL.has(r.status) || roundRow(r) || noiseRow(r)) return;
    const at = rowAt(r);
    if (r.status !== 'scored') return; // a finish only: a swept (failed) run keeps its Trail sticker, no story sticker
    if (!first.has(r.passage_id) || at < first.get(r.passage_id)) first.set(r.passage_id, at);
  });
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

/**
 * The class lights from the class's rows in the term (pure; BADGES §4.1). `self` is the child looking: under 5
 * children the line says "your class is playing too", which is only true when some OTHER child has a light; with
 * nobody else, `none: true` and the page prints nothing. A class round run lights nothing (roundRow).
 */
function lightsOf(rows, now, self = null) {
  const week = weekStart(now);
  const keys = new Map();
  rows.forEach((r) => {
    if (!FINAL.has(r.status) || (r.exposure_no != null && Number(r.exposure_no) !== 1)) return;
    if (roundRow(r) || noiseRow(r)) return;
    const child = r.canonical_id || r.student_id;
    if (!child) return;
    const thing = r.passage_id || r.item_set_id || (r.exercise ? `${r.exercise}|${r.period_id || periodOf(rowAt(r))}` : null);
    if (!thing) return;
    const key = `${child}|${thing}`;
    const at = rowAt(r);
    if (!keys.has(key) || at < keys.get(key).at) keys.set(key, { child, at });
  });
  const lights = [...keys.values()];
  const children = new Set(lights.map((l) => l.child));
  if (children.size < MIN_CHILDREN) {
    // the looking child under either id (a row keys a child by canonical_id || student_id)
    const me = new Set(self ? [String(self)] : []);
    if (self) rows.forEach((r) => { if (String(r.student_id) === String(self) && r.canonical_id) me.add(String(r.canonical_id)); });
    return [...children].some((c) => !me.has(String(c))) ? { shown: false } : { shown: false, none: true };
  }
  const thisWeek = lights.filter((l) => l.at >= week);
  const weekKids = new Set(thisWeek.map((l) => l.child));
  const out = { shown: true, term_total: lights.length };
  if (thisWeek.length >= MIN_WEEK && weekKids.size >= MIN_WEEK_CHILDREN) out.week_n = thisWeek.length;
  return out;
}

async function classLights(studentId, rows, now) {
  const cls = await classOf(studentId, rows);
  if (!cls) return null;
  try {
    const { data, error } = await supabase.from('web_quiz_challenge_runs').select(V2_COLS).eq('class_id', cls).gte('created_at', new Date(termStart(now)).toISOString()).limit(5000);
    if (error) return null;
    return lightsOf(data || [], now, studentId);
  } catch (_) {
    return null;
  }
}

// What a rung opened (BADGES §2.4), as a `jg.opens.*` key; null when it opens nothing.
function opensOf(ladder, rung, grade) {
  if (ladder === 'reading') {
    if (rung === 3) return 'longer';
    if (rung === 5 && grade && grade <= 3) return 'longer';
    return null;
  }
  if (rung === 2) return 'two_digit';
  if (rung === 4) return 'hundreds';
  return null;
}

// The Story Time band a reading lamp opens (BADGES §2.4): R3 -> U = the entry band + 1 (grades 2-3: 2, grades 4-5: 3);
// R5 for grades 2-3 -> 3. Null for anything else (numbers rooms are not served yet, so a numbers lamp names none).
function openedBand(ladder, rung, grade) {
  if (ladder !== 'reading' || !grade) return null;
  if (rung === 3) return grade <= 3 ? 2 : grade <= 5 ? 3 : null;
  if (rung === 5 && grade <= 3) return 3;
  return null;
}
const RESERVE_ID = /\.reserve\d+$/;
// Whether at least one released, reviewed practice story exists in that band and language (the registry; never the
// reserve story, never a withdrawn one). Any read failure is false: a lamp never promises a room it cannot show.
async function storyStock(band, lang, now) {
  try {
    const { data, error } = await supabase.from('challenge_passages')
      .select('passage_id, lang, band, pool, status, released_at, withdrawn_at')
      .eq('pool', 'practice').eq('lang', require('../../config/ux-strings').clampLanguage(lang)).eq('band', band);
    if (error || !Array.isArray(data)) return false;
    return data.some((r) => r && r.pool === 'practice' && Number(r.band) === band && r.status === 'reviewed' && !r.withdrawn_at
      && Number.isFinite(Date.parse(r.released_at)) && Date.parse(r.released_at) <= now && !RESERVE_ID.test(String(r.passage_id)));
  } catch (_) {
    return false;
  }
}

/**
 * The newest lamp lit this period, or null (the page shows it once). `runs` (the child's rows) names each rung row's run
 * by row_id: a lamp a swept run set (a known run whose status is not `scored`) comes after any other lamp of the period.
 */
function levelupOf(rungs, period, grade, storyOn = false, runs = []) {
  const status = new Map(runs.map((r) => [r.id, r.status]));
  const swept = (r) => (r.row_id != null && status.has(r.row_id) && status.get(r.row_id) !== 'scored' ? 1 : 0);
  const mine = rungs.filter((r) => r.period_id === period).sort((a, b) => swept(a) - swept(b) || String(b.set_at || '').localeCompare(String(a.set_at || '')) || Number(b.rung) - Number(a.rung));
  if (!mine.length) return null;
  const top = mine[0];
  const rung = Math.min(TOP_RUNG, Number(top.rung));
  const opens = storyOn ? opensOf(top.ladder, rung, grade) : null;
  return opens ? { ladder: top.ladder, rung, opens } : { ladder: top.ladder, rung };
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const bandOf = (g) => (g === 1 ? 'G1' : g >= 2 && g <= 3 ? 'G2-3' : g >= 4 && g <= 5 ? 'G4-5' : null);
const fail = (status, error) => { const { WqError } = require('./web-quiz.service'); throw new WqError(status, { error }); };

// ─── the Book ─────────────────────────────────────────────────────────────────────────────────────────

async function bookFor({ hub, kid, device, lang } = {}, now = Date.now()) {
  const f = await flags();
  if (!f.book) fail(503, 'book_off');
  const who = await require('./web-quiz-hub').kidFromHub(hub, kid, device);
  if (!who) fail(401, 'bad_token');
  const { data: row } = await supabase.from('students').select('id, student_name, student_name_urdu').eq('id', who.studentId).maybeSingle();
  const { rows, v2 } = await childRuns(who.studentId);
  const canonical = (rows.find((r) => r.canonical_id) || {}).canonical_id || who.studentId;
  const [rungs, grade] = await Promise.all([rungRows(canonical), fixedGrade(canonical, who.grade)]);
  const period = periodOf(now);
  const lamps = lampsOf(rungs);
  const storyIds = v2 ? storyIdsOf(rows) : [];
  const titles = await titlesOf(storyIds, lang);
  const name = row ? firstName(lang === 'ur' && row.student_name_urdu && String(row.student_name_urdu).trim() ? row.student_name_urdu : row.student_name) : '';
  const out = {
    name,
    trail_stickers: trailStickersFor(rows, v2, period),
    story_stickers: storyIds.map((id) => ({ passage_id: id, title: titles.get(id) || '' })),
    lamps,
    next_outline: outlineOf(lamps, grade),
    days_this_week: daysOf(rows, now),
    class_lights: f.wall ? await classLights(who.studentId, rows, now) : null,
    grade_band: bandOf(grade),
  };
  const up = levelupOf(rungs, period, grade, f.story, rows);
  // RULING #59: the room is named only when its shelf has a released story in that band and the child's language.
  if (up && up.opens) {
    const band = openedBand(up.ladder, up.rung, grade);
    if (!band || !(await storyStock(band, lang, now))) delete up.opens;
  }
  if (up) out.levelup = up;
  return out;
}

/** The hub payload's Book bits: {} with the Book off (the payload stays today's). Never throws. */
async function hubBits({ studentId } = {}, now = Date.now()) {
  try {
    const f = await flags();
    if (!f.book || !studentId) return {};
    const out = { book_on: true };
    if (f.wall) {
      const { rows } = await childRuns(studentId);
      out.class_lights = await classLights(studentId, rows, now);
    }
    return out;
  } catch (err) {
    logToFile('⚠️ web quiz book: hub bits unavailable', { error: err.message });
    return {};
  }
}

module.exports = {
  bookFor, hubBits, flags, lightsOf, lampsOf, outlineOf, trailStickersFor, daysOf, storyIdsOf, levelupOf, periodOf, weekStart, termStart,
  BOOK_KEY, WALL_KEY, V2_KEY, _resetCache: () => { cache = null; },
};
