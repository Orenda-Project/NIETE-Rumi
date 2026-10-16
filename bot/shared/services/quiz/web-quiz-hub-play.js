'use strict';
/**
 * The hub's Jugnu corner: the Jugnu card first when the last quiz is finished, the lantern (one "next thing"
 * line), the Story Time shelf with its NEW tags, and the install prompt's switch. Its own switch reads
 * (app_settings, 30 s cache, fail CLOSED), like web-quiz-hub-flags.js; every switch is effective only with its parent on.
 *
 * `playFor(...)` returns null when every switch here is off: the hub payload then carries no `play` key and the
 * hub page is today's, byte for byte. The page never decides what comes next: `nextThing` does, here, on the server.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEYS = {
  hub: 'web_quiz_hub',
  challenge: 'web_quiz_challenge',
  first: 'web_quiz_hub_challenge_first',
  v2: 'web_quiz_challenge_v2',
  story: 'web_quiz_challenge_story',
  book: 'web_quiz_challenge_book',
  install: 'web_quiz_install_prompt',
  events: 'web_quiz_events_v2',
};
const TTL_MS = 30 * 1000;
const PKT_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// A passage the practice shelf may show: reviewed or better, never a draft or a retired one.
const LIVE_STATUS = ['reviewed', 'provisional', 'calibrated'];
const RESERVE_ID = /\.reserve\d+$/;
// A run row's final statuses (a record row that closes a Trail stop).
const FINAL = ['scored', 'failed'];
// The route that brought the child to the hub (EVENTS §1 row 3 `hub_open.src`): read by the hub_open emit as `opts.src`.
const SRC_VALUES = ['card', 'home', 'door', 'wa', 'link', 'hs', 'class_link', 'guest', 'friend'];
let cache = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

const OFF = Object.freeze({ first: false, v2: false, story: false, book: false, install: false, events: false });

/** The effective switches (each only with its parent on). Fails closed: a read error is every switch off. */
async function switches(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.s;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', Object.values(KEYS));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, isTrue(r.value)]));
    const hub = Boolean(by[KEYS.hub]);
    const challenge = hub && Boolean(by[KEYS.challenge]);
    const v2 = challenge && Boolean(by[KEYS.v2]);
    const s = {
      first: challenge && Boolean(by[KEYS.first]),
      v2,
      story: v2 && Boolean(by[KEYS.story]),
      book: v2 && Boolean(by[KEYS.book]),
      install: hub && Boolean(by[KEYS.install]),
      events: hub && Boolean(by[KEYS.events]),
    };
    cache = { at: now, s };
    return s;
  } catch (err) {
    logToFile('⚠️ web quiz hub play: settings lookup failed — off', { error: err.message });
    return OFF;
  }
}

// ── the resolver (BADGES §6, verbatim) ───────────────────────────────────────────────────────────────

function pktDay(ms) { return Math.floor((ms + PKT_MS) / DAY_MS); }

/** 'tomorrow' if t is tomorrow in PKT, else its PKT weekday name; null when there is no buffered release. */
function dayOf(t, nowMs) {
  const ms = t ? Date.parse(t) : NaN;
  if (!Number.isFinite(ms)) return null;
  if (pktDay(ms) === pktDay(nowMs) + 1) return 'tomorrow';
  return WEEKDAYS[new Date(ms + PKT_MS).getUTCDay()];
}

/**
 * The "next thing": trail -> newest unseen live story -> numbers (+day) -> day. Pure. A title is returned only for a
 * passage already live (released_at <= now): the input should already exclude the rest; this re-filters.
 */
function nextThing(input = {}) {
  const nowMs = Number.isFinite(Date.parse(input.now)) ? Date.parse(input.now) : Date.now();
  const trail = Array.isArray(input.trail_waiting) ? input.trail_waiting : [];
  if (trail.length) return { kind: 'trail', stops: trail.length };
  const live = (Array.isArray(input.unseen_stories) ? input.unseen_stories : [])
    .filter((s) => s && s.title && Number.isFinite(Date.parse(s.released_at)) && Date.parse(s.released_at) <= nowMs)
    .sort((a, b) => Date.parse(b.released_at) - Date.parse(a.released_at));
  if (live.length) {
    const bandOne = input.read_along_first ? live.filter((s) => Number(s.band) === 1) : [];
    return { kind: 'story', title: (bandOne[0] || live[0]).title };
  }
  const day = dayOf(input.next_release, nowMs);
  return input.numbers_fresh ? { kind: 'numbers', day } : { kind: 'day', day };
}

// ── the inputs, read on the server (never throw) ────────────────────────────────────────────────────

function periodOf(nowMs) {
  const d = new Date(nowMs + PKT_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** This child's run rows with the v2 columns, or null when they cannot be read (missing columns/table: fail closed). */
async function runsOf(childId, cols) {
  try {
    const { data, error } = await supabase.from('web_quiz_challenge_runs').select(cols).eq('student_id', childId).limit(500);
    if (error) return null;
    return data || [];
  } catch (_) {
    return null;
  }
}

/**
 * The adapter for "this period's stops with no record row" (BADGES §6 `trail_waiting`): swap its body for the draw
 * module's `trailStateFor(canonicalId, periodId)` once it ships. Reads the v2 columns (`mode='check'`, `record=true`,
 * `period_id`); when they cannot be read, falls back to the list's own `exercises[].done` (absent: every stop waits).
 */
async function trailWaiting(childId, periodId, exercises) {
  const list = Array.isArray(exercises) ? exercises : [];
  const runs = await runsOf(childId, 'exercise, status, mode, record, period_id');
  if (!runs) return list.filter((e) => !e.done).map((e) => e.id);
  // Only a FINAL record row closes a stop: a `served` or `abandoned` row (or one still scoring) leaves it waiting.
  const done = (r, id) => r.exercise === id && r.mode === 'check' && r.record === true && r.period_id === periodId && FINAL.includes(r.status);
  return list.map((e) => e.id).filter((id) => !runs.some((r) => done(r, id)));
}

/** The passages this child has met: any run row of any mode or status (a story sticker is a story run row); null if unknown. */
async function seenPassages(childId) {
  const runs = await runsOf(childId, 'passage_id');
  return runs ? new Set(runs.map((r) => r.passage_id).filter(Boolean)) : null;
}

/** The practice passages for this language: live (released) ones and the earliest buffered release. Never throws. */
async function passagesOf(lang, nowIso, bands) {
  try {
    const { data, error } = await supabase.from('challenge_passages')
      .select('passage_id, twin_of, lang, band, kind, pool, status, released_at, title_en, title_ur')
      .eq('pool', 'practice').eq('lang', lang).in('status', LIVE_STATUS).not('released_at', 'is', null);
    if (error) return { live: [], next: null };
    // The reserve story is the draw's fall-through only: never on the shelf, never NEW, never a lantern title. The
    // registry marks it by its id (<lang>.read.<band>.reserveNN, web_quiz_challenge_stock_seed.sql); it has no params column.
    const reserve = (r) => RESERVE_ID.test(String(r.passage_id));
    const rows = (data || []).filter((r) => r && r.passage_id && Number.isFinite(Date.parse(r.released_at)) && !reserve(r) && bands.has(Number(r.band)));
    const nowMs = Date.parse(nowIso);
    const live = rows.filter((r) => Date.parse(r.released_at) <= nowMs);
    const later = rows.filter((r) => Date.parse(r.released_at) > nowMs).sort((a, b) => Date.parse(a.released_at) - Date.parse(b.released_at));
    return { live, next: later.length ? later[0].released_at : null };
  } catch (_) {
    return { live: [], next: null };
  }
}

/**
 * The bands open to this child (never a passage above them): band 1 for every child; the entry band L from the grade
 * (2-3 -> 1, 4-5 -> 2); L+1 once the reading rung is >= 3; band 3 for grades 2-3 once it is >= 5.
 */
function openBands(grade, readingRung) {
  const g = Number(grade);
  const rung = Number(readingRung) || 0;
  const open = new Set([1]);
  const L = g >= 2 && g <= 3 ? 1 : g >= 4 && g <= 5 ? 2 : null;
  if (!L) return open;
  open.add(L);
  if (rung >= 3 && L + 1 <= 3) open.add(L + 1);
  if (g <= 3 && rung >= 5) open.add(3);
  return open;
}

/** The child's reading rung from `child_rungs` (append-only, up-only: the highest row). 0 when unreadable (fail closed). */
async function readingRungOf(childId) {
  try {
    const { data, error } = await supabase.from('child_rungs').select('rung').eq('canonical_id', childId).eq('ladder', 'reading');
    if (error) return 0;
    return (data || []).reduce((m, r) => Math.max(m, Number(r.rung) || 0), 0);
  } catch (_) {
    return 0;
  }
}

const isSeenOf = (ids) => (r) => ids.has(r.passage_id) || Boolean(r.twin_of && ids.has(r.twin_of));
// The child-facing title is the passage FILE's (one title home: web-quiz-passage-title.js):
// Urdu ur → en, English en; a file with none (a Set A pointer) gives null.
const titleOf = (r, lang) => require('./web-quiz-passage-title').titleFor(r.passage_id, lang);

/**
 * The Story Time shelf: this week's story, a story to listen to, numbers, more stories. NEW iff the passage is in
 * `unseenPids`, the same set the lantern's resolver reads, so a NEW tag and a story lantern always come together.
 */
function shelfOf(live, unseenPids) {
  const newest = (kind) => live.filter((r) => r.kind === kind).sort((a, b) => Date.parse(b.released_at) - Date.parse(a.released_at))[0] || null;
  const tile = (id, r) => (r ? { id, pid: r.passage_id, nx: unseenPids.has(r.passage_id) ? 'new' : 'seen' } : null);
  const read = newest('read');
  const listen = newest('listen');
  // The warm-up (numbers) and the older stories' list are never new.
  return [tile('week_story', read), tile('listen', listen), { id: 'numbers', nx: 'seen' },
    live.length > 1 ? { id: 'older', nx: 'seen' } : null].filter(Boolean);
}

/**
 * The hub's play block for the chosen child, or null when every switch here is off (no `play` key: golden).
 * `challenge` is the hub's own challenge tile (null when the child's grade has no challenge); `stopsOf()` the stop ids
 * this child's Trail has (the hub's, from the challenge menu's rule), read only when the lantern is.
 */
async function playFor({ chosenId, last, lang, now, challenge, grade, stopsOf } = {}) {
  const s = await switches();
  if (!s.first && !s.v2 && !s.install && !s.events) return null;
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const tile = Boolean(challenge && challenge.on);
  const doors = [];
  if (s.events) {
    doors.push('hub_first');
    if (s.book) doors.push('next');
    if (s.story) doors.push('tomorrow', 'shelf');
    if (s.install) doors.push('install');
  }
  const out = {
    first: Boolean(s.first && tile && (!last || last.state === 'done')),
    lantern: null, shelf: null, install: s.install, doors,
  };
  if (!s.v2 || !tile || !chosenId) return out;

  const stops = typeof stopsOf === 'function' ? await stopsOf() : [];
  const trail = await trailWaiting(chosenId, periodOf(nowMs), stops.map((id) => ({ id })));
  const seenIds = s.story ? await seenPassages(chosenId) : null;
  const bands = seenIds ? openBands(grade, await readingRungOf(chosenId)) : null;
  const p = seenIds ? await passagesOf(require('../../config/ux-strings').clampLanguage(lang), nowIso, bands) : { live: [], next: null };
  // Unseen: no run row of any mode or status on the passage or its twin (seenIds null: unknown, so nothing is new),
  // and a title in the child's language (a story the lantern cannot name is never NEW on the shelf either).
  const unseen = (seenIds ? p.live.filter((r) => !isSeenOf(seenIds)(r)) : [])
    .map((r) => ({ pid: r.passage_id, title: titleOf(r, lang), released_at: r.released_at, band: r.band }))
    .filter((u) => u.title);
  const nx = nextThing({
    trail_waiting: trail, unseen_stories: unseen, numbers_fresh: s.story, next_release: s.story ? p.next : null,
    read_along_first: false, now: nowIso,
  });
  // Story, numbers and day lines are Story Time's; with it off only the trail line shows.
  if (nx.kind === 'trail' || s.story) {
    out.lantern = nx.kind === 'story' ? { ...nx, pid: (unseen.find((u) => u.title === nx.title) || {}).pid || null } : nx;
  }
  if (seenIds) out.shelf = shelfOf(p.live, new Set(unseen.map((u) => u.pid)));
  return out;
}

/** `{play}` for the hub payload, or `{}` (every switch off, or any failure: the hub is today's). Never throws. */
async function playField(input) {
  try {
    const play = await playFor({ now: new Date().toISOString(), ...input });
    return play ? { play } : {};
  } catch (err) {
    logToFile('⚠️ web quiz hub play: unavailable', { error: err.message });
    return {};
  }
}

/** The hub_open route value from a request's `from`/`src`, or undefined. */
function srcOf(v) { return typeof v === 'string' && SRC_VALUES.includes(v) ? v : undefined; }

module.exports = { playFor, playField, trailWaiting, openBands, nextThing, dayOf, switches, srcOf, SRC_VALUES, KEYS, _resetCache: () => { cache = null; } };
