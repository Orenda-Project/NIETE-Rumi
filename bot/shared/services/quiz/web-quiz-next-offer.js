'use strict';
/**
 * THE NEXT THING — one ranked offer (+ up to 2 alternatives) on the hub boot JSON and on every result JSON
 * (app_settings `web_quiz_next_offer`, default OFF: no `next` key anywhere, today's lantern untouched).
 *
 * The order, server-side (the page never decides):
 *   1.  a teacher quiz sent in the last 7 days that this child has not finished       rank_src 'pinned'
 *   2.  in the first 2 home opens of a PKT month, a Trail stop not played this month   rank_src 'rule'
 *       (never one the server would answer "on its way")
 *   1b. a half-finished storybook / a video watched < 90 %, at most once a PKT day     rank_src 'rule'
 *   3.  the rest, by the scores table for this context (next-offer-weights.json; the VALUE key
 *       `web_quiz_next_offer_weights` overrides it without a deploy): scored kinds first, ties -> newest unseen,
 *       the top two rotate when their CIs overlap (seeded by child + day), a primary shown twice and not tapped
 *       drops one place. rank_src 'significant' only when the row beats stopping on the data; else 'prior'.
 * The arm (per child per PKT day): rank 70 % · rand 20 % (the primary's kind drawn among the eligible kinds,
 * rank_src 'rand') · ctrl 10 % (today's lantern). Rules 1, 2 and 1b hold in every arm.
 *
 *   rank(ctx, candidates, state, weights)   pure: { next, meta } or null when nothing is offerable
 *   nextFor({ ctx, studentId, candidates, lang })  the impure wrapper: switches, per-child state, the `next_set` line
 *   noteTap(studentId, offer)               a tap on an offer resets its "shown, not tapped" streak
 *
 * Fail closed: a settings or Redis error is "switch off" / "no state"; nothing here ever throws to the caller.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const FILE_WEIGHTS = require('./next-offer-weights.json');

// pool: the counted-passage pool (web-quiz-challenge.js), read so a stop the draw would answer "on its way" is never offered.
const KEYS = { on: 'web_quiz_next_offer', weights: 'web_quiz_next_offer_weights', events: 'web_quiz_events_v3', v2: 'web_quiz_challenge_v2', pool: 'web_quiz_challenge_pool' };
const TTL_MS = 30 * 1000;
const PKT_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PIN_DAYS = 7;
const MONTH_OPENS = 2;
const DROP_AFTER = 2;
const ALTS_MAX = 2;
const STATE_TTL_S = 40 * 24 * 60 * 60;
const KINDS = ['story', 'game', 'quiz', 'video', 'storybook', 'invite', 'sticker'];
// The fields of a candidate the page sees (the next object); everything else is the ranker's.
const PUBLIC = ['kind', 'variant', 'id', 'href', 'title', 'title_ur', 'sub', 'sub_ur', 'minutes', 'art'];
let cache = null;

// ── pure ─────────────────────────────────────────────────────────────────────────────────────────────

function pktDay(ms) { return Math.floor((ms + PKT_MS) / DAY_MS); }
function pktMonth(ms) { const d = new Date(ms + PKT_MS); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
function h32(s) { return crypto.createHash('sha256').update(String(s)).digest().readUInt32BE(0); }

/** The arm for a child key on a PKT day: hash mod 10 -> 0-6 rank, 7-8 rand, 9 ctrl. */
function armOf(key, day) {
  const b = h32(`arm|${key}|${day}`) % 10;
  return b <= 6 ? 'rank' : b <= 8 ? 'rand' : 'ctrl';
}

const offerable = (c) => c && KINDS.includes(c.kind) && c.id && typeof c.href === 'string' && c.href && c.title;

/** The scores row for a candidate in a table: kind + variant, else the kind's variant-less row, else its first row. */
function rowFor(rows, c) {
  const same = rows.filter((r) => r && r.kind === c.kind);
  return same.find((r) => (r.variant || null) === (c.variant || null)) || same.find((r) => !r.variant) || same[0] || null;
}

function tableFor(weights, ctx) {
  const ctxs = (weights && weights.contexts) || {};
  return Array.isArray(ctxs[ctx]) ? ctxs[ctx] : Array.isArray(ctxs.home) ? ctxs.home : [];
}

const overlap = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2 && a[0] <= b[1] && b[0] <= a[1];

/** The ranked list for a context: score desc (null after scored, in the table's own order), then unseen, newest. */
function ranked(ctx, list, state, weights) {
  const rows = tableFor(weights, ctx);
  const scored = list.map((c, i) => {
    const row = rowFor(rows, c);
    const score = row && Number.isFinite(row.score) ? row.score : null;
    return { c, row, score, at: row ? rows.indexOf(row) : rows.length, i };
  });
  const rel = (x) => (Number.isFinite(Date.parse(x.c.released_at)) ? Date.parse(x.c.released_at) : -Infinity);
  scored.sort((a, b) => {
    if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score;
    if ((a.score == null) !== (b.score == null)) return a.score == null ? 1 : -1;
    if (a.score == null && a.at !== b.at) return a.at - b.at;
    if (Boolean(a.c.seen) !== Boolean(b.c.seen)) return a.c.seen ? 1 : -1;
    if (rel(a) !== rel(b)) return rel(b) - rel(a);
    return a.i - b.i;
  });
  // The top two rotate (stable within a day) when their CIs overlap: the cheapest experiment on the slot.
  if (scored.length > 1 && overlap(scored[0].row && scored[0].row.ci, scored[1].row && scored[1].row.ci)
    && h32(`rot|${state.seed}`) % 2 === 1) {
    [scored[0], scored[1]] = [scored[1], scored[0]];
  }
  // A primary shown twice in a row and never tapped drops one place, so the tile moves.
  const s = state.streak;
  if (scored.length > 1 && s && s.id === scored[0].c.id && Number(s.n) >= DROP_AFTER) [scored[0], scored[1]] = [scored[1], scored[0]];
  return scored;
}

const srcOfRow = (row) => (row && row.evidence === 'significant' ? 'significant' : 'prior');

function slot(x, ctx, rankSrc, extra) {
  const out = {};
  PUBLIC.forEach((k) => { if (x.c[k] != null) out[k] = x.c[k]; });
  return { ...out, ctx, rank_src: rankSrc, score: x.score == null ? null : x.score, ...extra };
}

/**
 * The next object for a context. `state`: { arm, seed, now, monthOpens, resumeToday, streak:{id,n}|null, has_root }.
 * Returns { next: {...slot, arm, score_v, alts:[...]}, meta: { rule, arm, score_v, order, kinds } } or null.
 */
function rank(ctx, candidates, state = {}, weights = FILE_WEIGHTS) {
  const nowMs = Number.isFinite(Date.parse(state.now)) ? Date.parse(state.now) : Date.now();
  const arm = ['rank', 'rand', 'ctrl'].includes(state.arm) ? state.arm : 'rank';
  const scoreV = (weights && weights.v) || null;
  const weak = ctx === 'after_read_weak';
  const eligible = (Array.isArray(candidates) ? candidates : []).filter((c) => offerable(c)
    && !c.on_its_way
    && !(c.kind === 'video' && c.needs_root && !state.has_root)
    // after a weak read, never another read-aloud: a listening story, a video or a game the child can finish.
    && !(weak && c.read_aloud));
  if (!eligible.length) return null;

  const pinned = eligible.filter((c) => c.rule === 'teacher_quiz' && Number.isFinite(Date.parse(c.sent_at))
    && nowMs - Date.parse(c.sent_at) <= PIN_DAYS * DAY_MS)
    .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
  // Opens counted this month (the home's own open included); 0 on a result card before any home open this month.
  const stop = (Number(state.monthOpens) || 0) <= MONTH_OPENS ? eligible.find((c) => c.rule === 'month_stop') : null;
  const resume = state.resumeToday ? null : eligible.find((c) => c.rule === 'resume');

  let primary = null;
  let rule = 'none';
  let src = null;
  if (pinned.length) { primary = pinned[0]; rule = 'teacher_quiz'; src = 'pinned'; }
  else if (stop) { primary = stop; rule = 'month_stop'; src = 'rule'; }
  else if (resume) { primary = resume; rule = 'resume'; src = 'rule'; }

  // An old teacher quiz (past the pin window) competes as a new quiz; a fixed-rule item already chosen does not repeat.
  const rest = eligible.filter((c) => c !== primary);
  const order = ranked(ctx, rest, { ...state, seed: state.seed || '' }, weights);
  const rows = tableFor(weights, ctx);
  let head = null;
  if (primary) {
    const row = rowFor(rows, primary);
    head = { c: primary, row, score: null };
  } else if (arm === 'rand') {
    const kinds = [...new Set(order.map((x) => x.c.kind))];
    const kind = kinds[h32(`rand|${state.seed}`) % kinds.length];
    head = order.find((x) => x.c.kind === kind);
    src = 'rand';
  } else if (arm === 'ctrl') {
    head = order.find((x) => x.c.lantern) || order[0];
    src = head.c.lantern ? 'rule' : srcOfRow(head.row);
  } else {
    head = order[0];
    src = srcOfRow(head.row);
  }
  const tail = order.filter((x) => x !== head);
  // Alternatives: a different kind from the primary first (two of the same on a card read as one door twice).
  const alts = [...tail.filter((x) => x.c.kind !== head.c.kind), ...tail.filter((x) => x.c.kind === head.c.kind)]
    .filter((x, i, a) => a.findIndex((y) => y.c.id === x.c.id) === i && x.c.id !== head.c.id)
    .slice(0, ALTS_MAX)
    .map((x) => slot(x, ctx, srcOfRow(x.row), {}));
  const next = { ...slot(head, ctx, src, { arm, score_v: scoreV }), alts };
  return {
    next,
    meta: { rule, arm, score_v: scoreV, order: [head, ...tail].map((x) => x.c.id), kinds: [next, ...alts].map((x) => x.kind) },
  };
}

// ── switches and the weights (app_settings, 30 s cache, fail closed) ─────────────────────────────────

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** A VALUE override that has the file's shape (a `contexts` object of arrays), else null. */
function weightsOf(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
  if (!v || typeof v !== 'object' || !v.contexts || typeof v.contexts !== 'object') return null;
  if (!Object.values(v.contexts).every(Array.isArray)) return null;
  return { v: String(v.v || 'override'), contexts: v.contexts };
}

const OFF = Object.freeze({ on: false, events: false, pool: false, weights: FILE_WEIGHTS });

async function switches(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.s;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', Object.values(KEYS));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const s = { on: isTrue(by[KEYS.on]), events: isTrue(by[KEYS.events]), pool: isTrue(by[KEYS.v2]) && isTrue(by[KEYS.pool]), weights: weightsOf(by[KEYS.weights]) || FILE_WEIGHTS };
    cache = { at: now, s };
    return s;
  } catch (err) {
    logToFile('⚠️ web quiz next offer: settings lookup failed — off', { error: err.message });
    return OFF;
  }
}

// ── the per-child state (Redis, 40 days): month opens, the primary's "shown, not tapped" streak, resume day ──

const redisOf = () => require('../cache/railway-redis.service');

/** The child's key for the arm, the rotation seed and the state: the events kid when the key is set, else a keyed
 *  hash of the id under the token secret (never logged). Null without either. */
function childKey(studentId) {
  if (!studentId) return null;
  const kid = require('./web-quiz-kid').kid(studentId);
  if (kid) return kid;
  try {
    return crypto.createHmac('sha256', require('./web-quiz-token').secret()).update(`next|${studentId}`).digest('hex').slice(0, 16);
  } catch (_) {
    return null;
  }
}

const stateKey = (key) => `wq:next:${key}`;

async function loadState(key) {
  try {
    const st = await redisOf().get(stateKey(key));
    return st && typeof st === 'object' ? st : {};
  } catch (_) {
    return {};
  }
}

async function saveState(key, st) {
  try { await redisOf().set(stateKey(key), st, STATE_TTL_S); } catch (_) { /* no state: rules still hold */ }
}

function offerId() { return crypto.randomBytes(8).toString('base64url').slice(0, 10); }

/**
 * The `next` object for a child in a context, or null (switch off, no child, nothing offerable, any failure: the
 * caller adds no key). `candidates` from the builders below; `hasRoot` = the child has a class quiz (videos need one).
 */
async function nextFor({ ctx, studentId, candidates, hasRoot = false, lang = 'en', now = Date.now() } = {}) {
  try {
    const s = await switches();
    if (!s.on || !studentId || !Array.isArray(candidates) || !candidates.length) return null;
    const key = childKey(studentId);
    if (!key) return null;
    const day = pktDay(now);
    const month = pktMonth(now);
    const st = await loadState(key);
    const opens = (st.m === month ? Number(st.o) || 0 : 0) + (ctx === 'home' ? 1 : 0);
    const r = rank(ctx, candidates, {
      arm: module.exports.armOf(key, day), seed: `${key}|${day}`, now: new Date(now).toISOString(), monthOpens: opens,
      resumeToday: st.rd === day, streak: st.s || null, has_root: Boolean(hasRoot),
    }, s.weights);
    if (!r) return null;
    const next = { ...r.next, offer: offerId(), alts: r.next.alts.map((a) => ({ ...a, offer: offerId() })) };
    const offers = { ...(st.of || {}) };
    [next, ...next.alts].forEach((x) => { offers[x.offer] = x.id; });
    const keep = Object.keys(offers).slice(-9);
    await saveState(key, {
      m: month, o: opens,
      s: st.s && st.s.id === next.id ? { id: next.id, n: (Number(st.s.n) || 0) + 1 } : { id: next.id, n: 1 },
      rd: r.meta.rule === 'resume' ? day : st.rd || null,
      of: Object.fromEntries(keep.map((k) => [k, offers[k]])),
    });
    if (s.events) {
      const pinnedK = candidates.filter((c) => c && c.rule === 'teacher_quiz').length;
      await require('./web-quiz-events-v3').emit3('web_quiz.next_set', {
        ctx, offer: next.offer, kinds: r.meta.kinds.join('|'), rank_src: next.rank_src, arm: r.meta.arm,
        score_v: r.meta.score_v, pinned_k: pinnedK, rule: r.meta.rule, lang,
      }, { canonicalId: studentId });
    }
    return next;
  } catch (err) {
    logToFile('⚠️ web quiz next offer: unavailable', { error: err.message });
    return null;
  }
}

/** A tap on an offer (the page's next_tap, through the event relay, by the child's kid): its streak starts again. */
async function noteTap(kid, offer) {
  try {
    if (!kid || typeof offer !== 'string') return false;
    const st = await loadState(kid);
    const id = st.of && st.of[offer];
    if (!id || !st.s || st.s.id !== id) return false;
    await saveState(kid, { ...st, s: { id, n: 0 } });
    return true;
  } catch (_) {
    return false;
  }
}

/** The events v3 switch from the cache, synchronously (the page relay is synchronous); a stale cache refreshes behind. */
function eventsV3Now(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) switches(now).catch(() => {});
  return Boolean(cache && cache.s && cache.s.events);
}

module.exports = {
  eventsV3Now,
  rank, armOf, pktDay, pktMonth, switches, weightsOf, nextFor, noteTap, childKey, KEYS, FILE_WEIGHTS, KINDS,
  _resetCache: () => { cache = null; },
};
