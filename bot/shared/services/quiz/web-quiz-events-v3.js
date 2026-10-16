'use strict';
/**
 * Events v3 (app_settings `web_quiz_events_v3`, default OFF: no v3 line is ever written): the v2 envelope plus the
 * sitting id, for the lines that measure what a child does next.
 *
 *   envelope3(fields, { kid, sit })           { w:'s', ev_v:3, kid_v, kid|null, sit|null, v3:1, ...fields } — with a
 *                                              kid present, every id that joins a row back to a phone, a share code
 *                                              or a session is removed (web-quiz-kid.js stripIds)
 *   sitOf(kid)                                 the child's current sitting id: a random 10-char id held in Redis keyed
 *                                              by the kid, 30-minute sliding life; a new sitting starts after 30 minutes
 *                                              with no line. Random, carries no identity. Null without a kid or Redis.
 *   emit3(name, fields, { canonicalId })        one v3 server line (callers check the switch)
 *   relayed(e)                                 is this page event a v3 line (next_shown, next_tap, home_view, door_tap
 *                                              with a v3 door, door_row_tap, video_open, video_watched)? The relay (web-quiz.service.js events) hands
 *                                              it to `relay` only with `web_quiz_events_v3` on; off, today's path.
 *   relay(e, body, device, { onTap })          the page line, cleaned by the v3 rules (EVENTS v3 §2), keyed by the
 *                                              child (the hub token + chip, else the quiz session), its sitting id, and
 *                                              a next_tap's offer goes to onTap(kid, offer) (the slot's streak reset).
 */
const crypto = require('crypto');
const { logEvent } = require('../../utils/structured-logger');
const K = require('./web-quiz-kid');

const SIT_TTL_S = 30 * 60;
const SIT_LEN = 10;
const SIT_ALPHA = 'abcdefghijkmnopqrstuvwxyz23456789';

function mint() {
  const b = crypto.randomBytes(SIT_LEN);
  let s = '';
  for (let i = 0; i < SIT_LEN; i += 1) s += SIT_ALPHA[b[i] % SIT_ALPHA.length];
  return s;
}

const valid = (v) => typeof v === 'string' && v.length === SIT_LEN;
// One read per child at a time in this process (a batch's lines are relayed together), and SET NX across processes,
// so the lines of one sitting never get two ids.
const inflight = new Map();

async function readSit(kid) {
  const redis = require('../cache/railway-redis.service');
  if (!redis.isAvailable()) return null;
  const key = `wq:sit:${kid}`;
  const had = await redis.get(key);
  if (valid(had)) {
    await redis.set(key, had, SIT_TTL_S);   // sliding: 30 minutes from this line
    return had;
  }
  const mine = mint();
  if (await redis.setNX(key, mine, SIT_TTL_S)) return mine;
  const won = await redis.get(key);
  return valid(won) ? won : mine;
}

async function sitOf(kid) {
  if (!kid) return null;
  if (inflight.has(kid)) return inflight.get(kid);
  const p = readSit(kid).catch(() => null).finally(() => inflight.delete(kid));
  inflight.set(kid, p);
  return p;
}

function envelope3(fields = {}, { kid = null, sit = null } = {}) {
  const out = { w: 's', ev_v: 3, kid_v: K.kidV(), kid, sit, v3: 1, ...fields };
  return out.kid ? K.stripIds(out) : out;
}

async function emit3(name, fields = {}, { canonicalId = null } = {}) {
  const kid = canonicalId ? K.kid(canonicalId) : null;
  const sit = await sitOf(kid);
  logEvent(name, envelope3(fields, { kid, sit }));
}

// ── the page's slot lines (EVENTS v3 §2) ──────────────────────────────────────────────────────────────

const CTX = /^(home|after_quiz|after_quiz_low|after_read|after_read_weak|after_game|after_video|after_story|ftue|teacher_home)$/;
const RULES = Object.freeze({
  ctx: CTX,
  kind: /^(story|game|quiz|video|storybook|invite|sticker|none)$/,
  id: /^[a-z0-9._:-]{1,64}$/i,
  rank_src: /^(significant|prior|rule|pinned|rand)$/,
  offer: /^[A-Za-z0-9_-]{10}$/,
  arm: /^(rank|rand|ctrl)$/,
  score_v: /^[A-Za-z0-9._-]{1,32}$/,
  source: /^(ranked|pinned|fallback)$/,
  door: /^(stories|games|videos)$/,
  src: /^(door|home|link|quiz|who)$/,
  lang: /^(en|ur)$/,
});
// The door screens' lines (a row of a door, a video played from it): their own keys, scoped to the name.
const ITEM = /^[a-z0-9._:-]{1,64}$/i;
const BY_NAME = Object.freeze({
  door_row_tap: { door: RULES.door, kind: /^(passage|listen|game|quiz|again|subject|video|storybook)$/, item: ITEM, lang: RULES.lang },
  video_open: { item: ITEM, via: /^(hub_door|next_offer|library|deep)$/, lang: RULES.lang },
  video_watched: { item: ITEM, via: /^(hub_door|next_offer|library|deep)$/, lang: RULES.lang },
});
const POS_MAX = { door_row_tap: 99 };
const NAMES = new Set(['next_shown', 'next_tap', 'home_view', 'door_tap', ...Object.keys(BY_NAME)]);

function relayed(e) {
  const n = String((e && e.n) || '');
  if (!NAMES.has(n)) return false;
  return n !== 'door_tap' || (typeof e.door === 'string' && RULES.door.test(e.door));
}

/** The kept fields of a v3 slot line (pure): only the v3 keys, each by its rule; pos 0-3; ms_to_tap a whole number. */
function clean3(e) {
  const out = {};
  const rules = BY_NAME[e.n] || RULES;
  for (const [k, rx] of Object.entries(rules)) if (typeof e[k] === 'string' && rx.test(e[k])) out[k] = e[k];
  const max = POS_MAX[e.n] || 3;
  if (Number.isInteger(e.pos) && e.pos >= 0 && e.pos <= max) out.pos = e.pos;
  const num = (k) => Number.isFinite(Number(e[k])) && e[k] !== null && e[k] !== '' && typeof e[k] !== 'boolean' && Number(e[k]) >= 0;
  if (num('ms_to_tap')) out.ms_to_tap = Math.round(Number(e.ms_to_tap));
  if (e.n === 'video_watched' && num('ms')) out.ms = Math.round(Number(e.ms));
  return out;
}

/** The batch's child: the hub token + the picked chip (as the door lines), else the quiz session's child. Never throws. */
async function childOf(body = {}) {
  const T = require('./web-quiz-token');
  try {
    if (typeof body.ht === 'string' && typeof body.chip === 'string' && body.chip) {
      const tok = T.verify(body.ht, 'h');
      const raw = tok && Array.isArray(tok.ids) ? tok.ids.map(String) : [];
      const id = raw.find((x) => T.chipId('h', x) === body.chip);
      if (id) return id;
      // the hub shows a folded child by the id they are known by (web_quiz_identity_canon): its chip names that id
      if (raw.length) {
        const canon = await require('./web-quiz-identity-roster').canonicalStudentIds(raw);
        const known = [...new Set(raw.map((x) => canon.get(x) || x))].find((x) => T.chipId('h', x) === body.chip);
        if (known) return known;
      }
    }
    const st = typeof body.st === 'string' ? T.verify(body.st, 's') : null;
    if (st && st.sid) {
      const { read: dbRead } = require('./web-quiz-db-deadline');
      const { data } = await dbRead('ev3Kid:quiz_sessions:1', (db) => db.from('quiz_sessions').select('student_id').eq('id', st.sid).maybeSingle());
      if (data && data.student_id) return require('./web-quiz-identity-roster').canonicalStudentId(String(data.student_id));
    }
  } catch (_) { /* no child */ }
  return null;
}

/** One page slot line, relayed (fire and forget from the synchronous relay). Never throws. */
async function relay(e, body = {}, device = null, { onTap = null } = {}) {
  try {
    const fields = { ...clean3(e), w: 'p' };
    const studentId = await childOf(body);
    const kid = studentId ? K.kid(studentId) : null;
    const sit = await sitOf(kid);
    logEvent(`web_quiz.${e.n}`, envelope3({ ...fields, dk: K.dk(device || body.dr) }, { kid, sit }));
    // the caller's tap hook (the next-thing slot's streak): passed in, so this module needs nothing from the slot's
    if (e.n === 'next_tap' && kid && fields.offer && typeof onTap === 'function') await onTap(kid, fields.offer);
  } catch (_) { /* a lost line, never a lost page */ }
}

module.exports = { envelope3, sitOf, emit3, relayed, relay, clean3, SIT_TTL_S };
