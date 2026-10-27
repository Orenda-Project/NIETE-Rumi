'use strict';
/**
 * THE PRACTICE HOME THAT PLAYS (app_settings `web_quiz_practice_play`, default OFF, only the JSON true turns it on,
 * 30 s cache, a failed read is off).
 *
 * A grown-up's preview of the child home (a hub token `{k:'h', ids:[], pr:1, g:<1-5>}`, web-quiz-hub-home.js
 * practiceOf) names no child. Off, every content route refuses it (401) and the practice home is look-only, as today.
 * On, the content routes answer it READ-ONLY for its grade: the storybook shelf and a book's pages and voices, the
 * games list and a game screen, Jugnu's read-along and listening stories, the video library and a video. Nothing is
 * written under any child: no students row, no session, no binding, no run row, no story event, no Redis key that
 * names a child. A game is scored in this process and forgotten; a story event is answered and dropped.
 *
 *   on()                 the switch (cached)
 *   practiceOf(token)    {g, lang, bk, tu?} for a genuine practice hub token, or null (pure; the switch aside); `tu` the
 *                        teacher it belongs to, when the link was minted for one
 *   of(token)            {g, lang, bk} for a practice hub token while the switch is on; null for every other token (no
 *                        read at all for a token that is not a practice one) or with the switch off
 *   who(token)           the content routes' "who" for it: {studentId: null, practice: true, grade, rootId: null, lang,
 *                        teacherId?}
 *   isPractice(token)    is this a practice hub token at all (pure; the switch aside): the refusal log's flag
 *   note(route, extra)   web_quiz.practice_play {route, role:'practice', practice:1, ...}: one line per answer (no id)
 *   refused(route, tok)  web_quiz.content_refused {route, why, practice:0|1}: a content route's 401, flagged when the
 *                        token was a grown-up's preview, so "adults hitting the preview wall" can be counted
 *   token({grade, lang, back, teacher})  a practice hub token for a grade, or null
 *   homePath({grade, lang, back, teacher})  '/h/<practice token>?from=door' for a grade (a teacher's "I want to play"), or null
 *   gamePath({grade, lang, stop})  '/c/<practice token>?kid=#<stop>': one number game of a grade, played as practice
 *   signRun({...}) / runOf(ct)     a practice game's run token {k:'c', pr:1, ex, g, l, f, r, p?, a?} (no student id,
 *                        so the counted challenge code, which needs one, never accepts it) and its check
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const { clampLanguage } = require('../../config/ux-strings');

const KEY = 'web_quiz_practice_play';
const TTL_MS = 30 * 1000;
const HOME_PATH = '/h/';
const BACK_RX = /^\/quiz\/teacher\/[A-Za-z0-9._~-]{1,600}$/;
const PID_RX = /^(en|ur)\.(read|listen)\.([1-5])\.[a-z0-9_-]+$/i;
// the teacher a preview belongs to (`tu`, a users id; bd-5gyspy.5): their taught grades and their own quizzes
const TU_RX = /^[A-Za-z0-9-]{1,64}$/;
const STOP_RX = /^[a-z0-9_-]{1,24}$/;
let cache = null;

/** The switch: only the JSON boolean true turns it on; a failed read is off. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  let v = false;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    v = Boolean(data && data[0] && data[0].value === true);
  } catch (err) {
    logToFile('⚠️ web quiz practice play: settings lookup failed — off', { error: err.message });
    v = false;
  }
  cache = { at: now, on: v };
  return v;
}

/**
 * The practice fields of a genuine hub token, or null (pure): pr:1, no child named, a grade 1-5; `bk` only a same-site
 * teacher-home path. The one home of this rule (web-quiz-hub-home.js practiceOf answers through it), kept in this
 * leaf module so nothing that asks "is this a preview?" pulls the hub's modules in.
 */
function practiceOf(token) {
  const tok = T.verify(token, 'h');
  if (!tok || tok.pr !== 1 || !Array.isArray(tok.ids) || tok.ids.length) return null;
  const g = Number(tok.g);
  if (!Number.isInteger(g) || g < 1 || g > 5) return null;
  return { g, lang: clampLanguage(tok.lang || tok.l), bk: typeof tok.bk === 'string' && BACK_RX.test(tok.bk) ? tok.bk : null,
    ...(typeof tok.tu === 'string' && TU_RX.test(tok.tu) ? { tu: tok.tu } : {}) };
}

/** Is this a practice hub token at all (signature, pr:1, no child, a grade 1-5)? Pure: the switch is not read. */
function isPractice(token) {
  try { return Boolean(practiceOf(token)); } catch (_) { return false; }
}

/** {g, lang, bk} for a practice hub token while the switch is on, else null (no read for any other token). */
async function of(token) {
  let pr = null;
  try { pr = practiceOf(token); } catch (_) { pr = null; }
  if (!pr) return null;
  return (await on()) ? pr : null;
}

const whoOf = (pr) => ({ studentId: null, practice: true, grade: pr.g, rootId: null, lang: pr.lang, ...(pr.tu ? { teacherId: pr.tu } : {}) });

/** The content routes' "who" for a practice token (switch on), else null. */
async function who(token) {
  const pr = await of(token);
  return pr ? whoOf(pr) : null;
}

/** One line per answer to a practice token: the route and its grade, never an id. Never throws. */
function note(route, extra = {}) {
  try { logEvent('web_quiz.practice_play', { route, role: 'practice', practice: 1, ...extra }); } catch (_) { /* logging never fails a page */ }
}

/** A content route refused a token: whether that token was a grown-up's preview link. Never throws. */
function refused(route, token, why = 'bad_token') {
  try { logEvent('web_quiz.content_refused', { route, why, practice: isPractice(token) ? 1 : 0 }); } catch (_) { /* as note */ }
}

/**
 * A practice token for a grade (1-5), in en|ur, with Back to a teacher home path and the teacher it belongs to (`tu`);
 * null for a grade outside 1-5 or without a signing secret.
 */
function token({ grade, lang, back = null, teacher = null } = {}) {
  const g = Number(grade);
  if (!Number.isInteger(g) || g < 1 || g > 5) return null;
  return T.sign({ k: 'h', ids: [], pr: 1, g, lang: clampLanguage(lang), ...(typeof back === 'string' && BACK_RX.test(back) ? { bk: back } : {}),
    ...(typeof teacher === 'string' && TU_RX.test(teacher) ? { tu: teacher } : {}), exp: Math.floor(Date.now() / 1000) + T.HUB_TTL_S });
}

/** The practice home for a grade (1-5), in en|ur, with Back to a teacher home path; null without a signing secret. */
function homePath({ grade, lang, back = null, from = 'door', teacher = null } = {}) {
  const t = token({ grade, lang, back, teacher });
  return t ? `${HOME_PATH}${t}?from=${encodeURIComponent(from)}` : null;
}

/**
 * One number game of a grade played as a practice (read-only, kept nowhere): '/c/<practice token>?kid=#<stop>' (the
 * games page's own address, as a door row builds it), or null. Another grade's games under «All grades» open this way,
 * for a child or a preview alike (bd-5gyspy.5).
 */
function gamePath({ grade, lang, stop, teacher = null } = {}) {
  if (!STOP_RX.test(String(stop || ''))) return null;
  const t = token({ grade, lang, teacher });
  return t ? `/c/${t}?kid=#${stop}` : null;
}

/** A practice game's run token: no student id (the counted code needs one and refuses it). */
function signRun({ ex, g, lang, form, runId, pid = null, anchor = null }) {
  return T.sign({ k: 'c', pr: 1, ex, g, l: clampLanguage(lang), f: String(form), r: runId, ...(pid ? { p: pid } : {}), ...(anchor ? { a: anchor } : {}),
    exp: Math.floor(Date.now() / 1000) + T.CHALLENGE_TTL_S });
}

/** The payload of a genuine practice run token, else null (pure: the caller reads the switch). */
function runOf(ct) {
  const c = T.verify(ct, 'c');
  if (!c || c.pr !== 1 || c.sid || typeof c.r !== 'string' || typeof c.ex !== 'string') return null;
  const g = Number(c.g);
  if (!Number.isInteger(g) || g < 1 || g > 5) return null;
  if (c.p != null && !PID_RX.test(String(c.p))) return null;
  return c;
}

module.exports = { on, of, who, whoOf, practiceOf, isPractice, note, refused, token, homePath, gamePath, signRun, runOf, KEY, PID_RX, _reset: () => { cache = null; } };
