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
 * rank_src 'rand') · ctrl 10 % (today's order for the surface: the lantern where there is one, else the first
 * candidate as the surface builds them; rank_src 'ctrl'). Rules 1, 2 and 1b hold in every arm.
 * Every slot carries `source` (pinned | ranked | fallback: what the page reports on next_shown) and the arm and
 * score_v (the alts too).
 *
 *   rank(ctx, candidates, state, weights)   pure: { next, meta } or null when nothing is offerable
 *   nextFor({ ctx, studentId, candidates, lang, live })  the impure wrapper: switches, per-child state, the `next_set`
 *                                           line; `live` (from the caller's deadline) false -> nothing written, no line
 *   noteTap(studentId, offer)               a tap on an offer resets its "shown, not tapped" streak
 *
 * Fail closed: a settings or Redis error is "switch off" / "no state"; nothing here ever throws to the caller.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const FILE_WEIGHTS = require('./next-offer-weights.json');
// the slot's own keys, the events switch and the per-child state live in a leaf the quiz service's relay requires
// (web-quiz-next-offer-state.js), so the relay never closes a require loop through the challenge and the home
const Leaf = require('./web-quiz-next-offer-state');

// This module's own keys. Two more are read through their owners' readers (never parsed here, so the slot and the
// screen always agree): the counted-passage pool (web-quiz-challenge.js v2On/poolOn), so a stop the draw would answer
// "on its way" is never offered; the v3 home (web-quiz-hub-home.js flags), whose own player starts a video for a
// child with no class quiz (watch-only: nothing minted).
const { KEYS } = Leaf;
const PKT_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PIN_DAYS = 7;
const MONTH_OPENS = 2;
const DROP_AFTER = 2;
const ALTS_MAX = 2;
const KINDS = ['story', 'game', 'quiz', 'video', 'storybook', 'invite', 'sticker'];
// The fields of a candidate the page sees (the next object); everything else is the ranker's.
const PUBLIC = ['kind', 'variant', 'id', 'href', 'title', 'title_ur', 'sub', 'sub_ur', 'minutes', 'art', 'tag', 'tag_ur'];
const EVIDENCE = new Set(['significant', 'prior']);
let derived = null;   // { raw, s }: the switches for the leaf's cached raw read (one parse and one owner read per cache life)

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

// The table's names for the same thing in another context (the home's rows name the hub's picks: a teacher quiz is
// `teacher`, play again is `last`, a library video `library`/`recommended`).
const VARIANT_ALIAS = Object.freeze({ new: ['new', 'teacher'], again: ['again', 'last'], teacher: ['teacher', 'new'], recommended: ['recommended', 'library'], library: ['library', 'recommended'], chapter: ['chapter', 'recommended', 'library'],
  // the quiz after a watched video (the door's quiz-after) is a new quiz, never "play again"
  after_video: ['after_video', 'new'] });

/** The scores row for a candidate: kind + variant (or its alias), else the kind's variant-less row, else its first. */
function rowFor(rows, c) {
  const same = rows.filter((r) => r && r.kind === c.kind);
  const names = c.variant ? (VARIANT_ALIAS[c.variant] || [c.variant]) : [];
  for (const v of names) {
    const hit = same.find((r) => r.variant === v);
    if (hit) return hit;
  }
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
  // An unscored kind ranks as a lift of 0 ("no different from stopping", the honest prior): a kind that measurably
  // loses children goes after it, one that keeps them before it. Two unscored rows keep the table's own order.
  const lift = (x) => (x.score == null ? 0 : x.score);
  scored.sort((a, b) => {
    if (lift(a) !== lift(b)) return lift(b) - lift(a);
    if (a.score == null && b.score == null && a.at !== b.at) return a.at - b.at;
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

// source: the page's word for the slot (next_shown.source): a teacher's pin, today's order (ctrl), else the ranker's
const sourceOf = (rankSrc) => (rankSrc === 'pinned' ? 'pinned' : rankSrc === 'ctrl' ? 'fallback' : 'ranked');

function slot(x, ctx, rankSrc, extra) {
  const out = {};
  PUBLIC.forEach((k) => { if (x.c[k] != null) out[k] = x.c[k]; });
  return { ...out, ctx, rank_src: rankSrc, source: sourceOf(rankSrc), score: x.score == null ? null : x.score, ...extra };
}

/**
 * The next object for a context. `state`: { arm, seed, now, monthOpens, resumeToday, streak:{id,n}|null, has_root }.
 * Returns { next: {...slot, arm, score_v, alts:[...]}, meta: { rule, arm, score_v, order, kinds } } or null.
 */
function rank(ctx, candidates, state = {}, weights = FILE_WEIGHTS) {
  const nowMs = Number.isFinite(Date.parse(state.now)) ? Date.parse(state.now) : Date.now();
  const arm = ['rank', 'rand', 'ctrl'].includes(state.arm) ? state.arm : 'rank';
  const scoreV = (weights && weights.v) || null;
  // after a weak read or one with almost nothing read (tried), never another read-aloud
  const weak = ctx === 'after_read_weak' || ctx === 'after_read_tried';
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
    // today's order: the lantern where the surface has one, else the first candidate as built (never the ranked head)
    head = order.find((x) => x.c.lantern) || [...order].sort((a, b) => a.i - b.i)[0];
    src = 'ctrl';
  } else {
    head = order[0];
    src = srcOfRow(head.row);
  }
  const tail = order.filter((x) => x !== head);
  // Alternatives: a different kind from the primary first (two of the same on a card read as one door twice).
  const alts = [...tail.filter((x) => x.c.kind !== head.c.kind), ...tail.filter((x) => x.c.kind === head.c.kind)]
    .filter((x, i, a) => a.findIndex((y) => y.c.id === x.c.id) === i && x.c.id !== head.c.id)
    .slice(0, ALTS_MAX)
    .map((x) => slot(x, ctx, srcOfRow(x.row), { arm, score_v: scoreV }));
  const next = { ...slot(head, ctx, src, { arm, score_v: scoreV }), alts };
  return {
    next,
    // elig: the kinds the rand arm could draw from (its denominator: the draw is uniform over THIS child's set), in
    // the kit's kind order (KINDS)
    meta: { rule, arm, score_v: scoreV, order: [head, ...tail].map((x) => x.c.id), kinds: [next, ...alts].map((x) => x.kind), elig: KINDS.filter((k) => order.some((x) => x.c.kind === k)) },
  };
}

// ── switches and the weights (app_settings, 30 s cache, fail closed) ─────────────────────────────────

/** An owner's own switch reader (its cache, its parsing); a throw is off. */
async function ownerOn(read) {
  try { return (await read()) === true; } catch (_) { return false; }
}

/** One scores row as the file has it (a kit kind, a finite or null score, evidence significant|prior), else null. */
function rowOf(r) {
  if (!r || typeof r !== 'object' || !KINDS.includes(r.kind)) return null;
  if (!(r.score === null || Number.isFinite(r.score)) || !EVIDENCE.has(r.evidence)) return null;
  if (r.variant != null && typeof r.variant !== 'string') return null;
  if (r.ci != null && !(Array.isArray(r.ci) && r.ci.length === 2 && r.ci.every(Number.isFinite))) return null;
  return r;
}

/**
 * A VALUE override, validated per context: each context it names that has at least one valid row replaces the file's
 * table for that context (its invalid rows dropped); every other context keeps the file's. Null when nothing in it is
 * usable (malformed JSON, no `contexts`, no valid row): the file stands.
 */
function weightsOf(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v) || !v.contexts || typeof v.contexts !== 'object' || Array.isArray(v.contexts)) return null;
  const own = {};
  for (const [ctx, rows] of Object.entries(v.contexts)) {
    if (!Array.isArray(rows)) continue;
    const ok = rows.map(rowOf).filter(Boolean);
    if (ok.length) own[ctx] = ok;
  }
  if (!Object.keys(own).length) return null;
  const vv = typeof v.v === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(v.v) ? v.v : 'override';
  return { v: vv, contexts: { ...FILE_WEIGHTS.contexts, ...own } };
}

const OFF = Object.freeze({ on: false, events: false, pool: false, watch: false, weights: FILE_WEIGHTS });

async function switches(now = Date.now()) {
  const raw = await Leaf.raw(now);
  if (derived && derived.raw === raw) return derived.s;
  const Challenge = () => require('./web-quiz-challenge');
  // read side by side (each from its owner's 30 s cache, which the hub has usually just filled)
  const [v2, poolKey, watch] = raw.on ? await Promise.all([ownerOn(() => Challenge().v2On()), ownerOn(() => Challenge().poolOn()),
    ownerOn(async () => (await require('./web-quiz-hub-home').flags()).home)]) : [false, false, false];
  const s = raw.on || raw.events || raw.weights != null
    ? { on: raw.on, events: raw.events, pool: v2 && poolKey, watch, weights: weightsOf(raw.weights) || FILE_WEIGHTS }
    : OFF;
  derived = { raw, s };
  return s;
}

// ── the per-child state (Redis, 40 days): month opens, the primary's "shown, not tapped" streak, resume day ──

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

// Another surface's own key (a teacher home's tk) keeps its state apart from every child's: never one Redis key for both.
const OWN_KEY = /^[0-9a-f]{16}$/;

const { loadState, saveState, noteTap } = Leaf;

function offerId() { return crypto.randomBytes(8).toString('base64url').slice(0, 10); }

/**
 * The `next` object for a child in a context, or null (switch off, no child, nothing offerable, any failure: the
 * caller adds no key). `candidates` from the builders below; `hasRoot` = the child has a class quiz (videos need one).
 */
async function nextFor({ ctx, studentId, candidates, hasRoot = false, lang = 'en', now = Date.now(), key: ownKey = null, live = null } = {}) {
  // live: the caller's deadline token; once it is false (the field has been given up) nothing is written or logged —
  // a tile no child was shown never spends a month open, a streak step or a next_set line
  const alive = () => !live || live.on !== false;
  try {
    const s = await switches();
    if (!s.on || !(studentId || ownKey) || !Array.isArray(candidates) || !candidates.length) return null;
    // key: another surface's own keyed id (a teacher home's tk: exactly 16 hex) for its arm, seed and state (under
    // its own prefix); else the child's
    const own = typeof ownKey === 'string' && OWN_KEY.test(ownKey);
    const key = own ? ownKey : childKey(studentId);
    if (!key) return null;
    const sk = own ? `o:${key}` : key;
    const day = pktDay(now);
    const month = pktMonth(now);
    const st = await loadState(sk);
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
    if (!alive()) return null;
    await saveState(sk, {
      m: month, o: opens,
      s: st.s && st.s.id === next.id ? { id: next.id, n: (Number(st.s.n) || 0) + 1 } : { id: next.id, n: 1 },
      rd: r.meta.rule === 'resume' ? day : st.rd || null,
      of: Object.fromEntries(keep.map((k) => [k, offers[k]])),
    });
    if (s.events && alive()) {
      const pinnedK = candidates.filter((c) => c && c.rule === 'teacher_quiz').length;
      require('./web-quiz-events-v3').emit3('web_quiz.next_set', {
        ctx, offer: next.offer, kinds: r.meta.kinds.join('|'), rank_src: next.rank_src, arm: r.meta.arm,
        score_v: r.meta.score_v, pinned_k: pinnedK, rule: r.meta.rule, elig: r.meta.elig.join('|'), lang,
      }, { canonicalId: studentId }).catch(() => {});
    }
    return next;
  } catch (err) {
    logToFile('⚠️ web quiz next offer: unavailable', { error: err.message });
    return null;
  }
}

const { eventsV3Now } = Leaf;

module.exports = {
  eventsV3Now,
  rank, armOf, pktDay, pktMonth, switches, weightsOf, rowOf, nextFor, noteTap, childKey, KEYS, FILE_WEIGHTS, KINDS,
  _resetCache: () => { derived = null; Leaf._resetCache(); },
};
