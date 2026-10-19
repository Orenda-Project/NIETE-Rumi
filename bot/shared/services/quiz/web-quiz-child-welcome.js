'use strict';
/**
 * The child's first open of the home, "Jugnu says hello" (app_settings `web_quiz_child_welcome`, default OFF, JSON true
 * only; only with `web_quiz_home_v3` on; it rides the home's one settings read, web-quiz-home-flags.js). The page's half
 * is dashboard wq-welcome.js; the flow and its rules: design/ftue_child/DESIGN.md.
 *
 *   field({ chosenId })                       {} | { welcome: { v, attempt } } for the hub answer: while on, for a chosen
 *                                             child who has not finished or skipped version V and was shown it fewer
 *                                             than SHOW_MAX times; { welcome: { v, replay: 1 } } once they have (the
 *                                             greeting's Jugnu replays step 4, the grown-ups row re-arms it). Off: {} and
 *                                             nothing is read. No Redis: {} (once per child cannot be kept without it).
 *                                             Never throws.
 *   record({ token, kid, device, outcome })   the page's one write (POST /hub/:token/welcome): shown | done | skipped,
 *                                             or reset (the grown-ups row "Show Jugnu's hello again": shown afresh),
 *                                             for the child a hub chip names on a phone the hub trusts. The SHOW_MAX-th
 *                                             show is written done at once, so a child who always leaves early is never
 *                                             shown it again. {ok: true}; 400 bad outcome, 403 not this link's child or
 *                                             another phone, 404 off.
 *
 * Kept per child in Redis `wq:welcome:<sha256(id)>` = { s: done|skipped|null, v, n: shows } for 400 days (never the raw
 * id). The page keeps its own copy too (localStorage), so a lost write never replays it on that phone.
 * The voice: each line has a key (VOICE_KEYS); the clips are the one voice's recording of the reviewed lines
 * (dashboard/public/wq/voice/welcome/<set>-<lang>/welcome-<key>.mp3, recorded by record-welcome-lines.js). The answer
 * names the folder in the hub's own language (`voice`) and its version (`voice_v`: the folder's hash,
 * record-one-voice-shared-lines.js setHash), since /wq is cached for a year; a re-record changes the hash here. A clip
 * that fails leaves the caption; never the phone's own voice.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');

const V = 1;                      // bump on purpose when the welcome's content changes: every child sees it once more
const SHOW_MAX = 2;
const TTL_S = 400 * 24 * 3600;
const OUTCOMES = Object.freeze(['shown', 'done', 'skipped', 'reset']);
// the page's clips under the one-voice set path: <path>welcome-<key>.mp3 (step 2 full / short, 3, 4, the step-4 nudge)
const VOICE_KEYS = Object.freeze(['2', '2s', '3', '4', '4n', '5']);
const VOICE = Object.freeze({
  en: Object.freeze({ voice: '/wq/voice/welcome/sx-reyna-68567f-en/', voice_v: 'f18a655d' }),
  ur: Object.freeze({ voice: '/wq/voice/welcome/sx-reyna-68567f-ur/', voice_v: 'edb3c4ac' }),
});

const keyOf = (id) => `wq:welcome:${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 32)}`;
const fail = (status, error) => { const { WqError } = require('./web-quiz.service'); throw new WqError(status, { error }); };

async function on() {
  try {
    const f = await require('./web-quiz-home-flags').flags();
    return Boolean(f.home && f.welcome);
  } catch (_) { return false; }
}

/** The child's state for this version: { s, n }; another version's is a fresh start. Null without Redis. */
async function stateOf(id) {
  const redis = require('../cache/railway-redis.service');
  if (!redis.isAvailable()) return null;
  let st = await redis.get(keyOf(id));
  if (typeof st === 'string') { try { st = JSON.parse(st); } catch (_) { st = null; } }
  return st && st.v === V ? { s: st.s || null, n: Number(st.n) || 0 } : { s: null, n: 0 };
}

async function field({ chosenId, lang = 'en' } = {}) {
  try {
    if (!chosenId || !(await on())) return {};
    const st = await stateOf(chosenId);
    if (!st) return {};
    const voice = VOICE[lang === 'ur' ? 'ur' : 'en'];
    if (st.s || st.n >= SHOW_MAX) return { welcome: { v: V, replay: 1, ...voice } };
    return { welcome: { v: V, attempt: st.n + 1, ...voice } };
  } catch (err) {
    logToFile('⚠️ web quiz welcome: state unavailable — not shown', { error: err.message });
    return {};
  }
}

async function record({ token, kid, device, outcome } = {}) {
  if (!(await on())) fail(404, 'not_found');
  if (!OUTCOMES.includes(outcome)) fail(400, 'bad_outcome');
  const { who } = await require('./web-quiz-grade-change').guardedChild(token, kid, device);
  const st = await stateOf(who.studentId);
  if (!st) fail(503, 'unavailable');
  if (outcome === 'reset') {
    await require('../cache/railway-redis.service').set(keyOf(who.studentId), { s: null, v: V, n: 0 }, TTL_S);
    return { ok: true };
  }
  const n = outcome === 'shown' ? st.n + 1 : st.n;
  const s = st.s || (outcome === 'shown' ? (n >= SHOW_MAX ? 'done' : null) : outcome);
  await require('../cache/railway-redis.service').set(keyOf(who.studentId), { s, v: V, n }, TTL_S);
  return { ok: true };
}

module.exports = { field, record, on, V, SHOW_MAX, VOICE_KEYS, VOICE, KEY: require('./web-quiz-home-flags').WELCOME_KEY };
