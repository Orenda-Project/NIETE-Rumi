'use strict';
/**
 * The Jugnu card on the scorecard: right after a teacher's quiz, a class child in grades 2-5 is offered Jugnu's
 * challenge first under the score. app_settings web_quiz_challenge_card, effective only with web_quiz_challenge on
 * (its parent) and web_quiz_hub on (the challenge page opens with a hub token); read like web-quiz-hub-flags
 * (30 s cache, fail closed). Off: finish()'s payload and the scorecard are today's.
 *
 *   field(s)        finish()'s {jugnu_card: true} (+ jugnu_ev: true with web_quiz_events_v2 on, so the page writes
 *                   door_shown / door_tap) for a child's own finished run in grades 2-5, else {}.
 *   go({st}, Err)   POST /hubdoor {st, jugnu: 1}: {href: '/c/<hub token>?kid=<chip>&via=quiz_card', animal} for THIS
 *                   session's child, checked exactly as the hub door is (the session, an own finished run, the phone
 *                   that played): the link never names the child, and a forwarded copy meets the hub's lock.
 * The page asks "<name>'s turn" before it calls go(): never straight into a run (the identity step).
 * Err is web-quiz.service's WqError, passed in by the route (no require cycle).
 */
const supabase = require('../../config/supabase');
const { read: dbRead } = require('./web-quiz-db-deadline');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const Device = require('./web-quiz-hub-device');

const CARD_KEY = 'web_quiz_challenge_card';
const CHALLENGE_KEY = 'web_quiz_challenge';
const HUB_KEY = 'web_quiz_hub';
const EVENTS_V2_KEY = 'web_quiz_events_v2';
const TTL_MS = 30 * 1000;
let cache = null; // { at, card, ev }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** {card, ev}: the card with both parents on; its door events with web_quiz_events_v2 on too. Never throws. */
async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [CARD_KEY, CHALLENGE_KEY, HUB_KEY, EVENTS_V2_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const card = isTrue(by[CARD_KEY]) && isTrue(by[CHALLENGE_KEY]) && isTrue(by[HUB_KEY]);
    cache = { at: now, card, ev: card && isTrue(by[EVENTS_V2_KEY]) };
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz card: settings lookup failed — card off', { error: err.message });
    return { card: false, ev: false };
  }
}

// A class child's own run (web-quiz-hub-door.js ownRun): never the teacher's test run, an invited friend's, or no child.
function ownRun(s) {
  return Boolean(s && s.student_id && !s.user_id && !(s.invited_by_student_id && s.invited_by_student_id !== s.student_id));
}

// The challenge's grade rule (web-quiz-hub.js challengeGrade): grades 2-5 have a form; required on use.
async function challengeGrade(studentId) {
  try {
    const Challenge = require('./web-quiz-challenge');
    return Boolean(Challenge.formFor(await Challenge.gradeOf({ studentId })));
  } catch (err) {
    logToFile('⚠️ web quiz card: challenge grade unavailable', { error: err.message });
    return false;
  }
}

async function canonicalId(studentId) {
  try {
    const out = await require('./web-quiz-identity-roster').canonicalStudentId(studentId);
    return out ? String(out) : studentId;
  } catch (_) {
    return studentId;
  }
}

async function field(s) {
  try {
    // finish() calls this for the run it has just completed (as the hub door's field does).
    if (!ownRun(s)) return {};
    const f = await flags();
    if (!f.card || !(await challengeGrade(s.student_id))) return {};
    return f.ev ? { jugnu_card: true, jugnu_ev: true } : { jugnu_card: true };
  } catch (_) {
    return {};
  }
}

async function go(body = {}, Err = Error) {
  const fail = (status, error) => {
    const e = new Err(status, { error });
    if (!(e.status && e.body)) Object.assign(e, { status, body: { error } });
    throw e;
  };
  const tok = T.verify(body.st, 's');
  if (!tok || !tok.sid || !tok.d) fail(401, 'bad_token');
  const { data: s } = await dbRead('card:quiz_sessions:1', (db) => db.from('quiz_sessions')
    .select('id, student_id, user_id, invited_by_student_id, status, share_code_id').eq('id', tok.sid).maybeSingle());
  if (!s || s.share_code_id !== tok.sc) fail(401, 'bad_token');
  if (!(await flags()).card) fail(404, 'no_door');
  if (!ownRun(s) || s.status !== 'completed') fail(404, 'no_door');
  if (!(await challengeGrade(s.student_id))) fail(404, 'no_door');
  // The one id this child is known by (web-quiz-identity-roster, the one fold writer); the raw id on any failure.
  const id = await canonicalId(s.student_id);
  const token = T.signHub([id]);
  if (!token) fail(404, 'no_door');
  const bound = await Device.deviceTrusted(token, tok.d);
  if (!bound.ok) fail(404, 'no_door');
  // The hub's own chip for this child (hub.js B.kid): the challenge page resolves it against the token's ids.
  const kid = T.chipId('h', id);
  return { href: `/c/${token}?kid=${encodeURIComponent(kid)}&via=quiz_card`, animal: T.animalFor(id) };
}

module.exports = { field, go, flags, ownRun, CARD_KEY, _resetCache: () => { cache = null; } };
