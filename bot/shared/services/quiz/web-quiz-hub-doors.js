'use strict';
/**
 * The v3 child home's door screens (app_settings `web_quiz_home_v3`, the home's own switch): what is behind Stories and
 * Games beyond the hub boot's few ids, fetched when a door opens so the home itself stays light.
 *
 *   door(token, {kid, d, device, lang})   d = 'stories' -> {stories: [...], shelf}   d = 'games' -> {games: [...]}
 *                                         404 home_off with the switch off; 401 for a token/phone that is not this child's
 *   seededOrder(items, seed)              a stable shuffle (pure): the same seed, the same order
 *   daySeed(childId, now)                 the seed for one child on one Pakistan day (pure)
 *
 * Stories: this week's story first (it is the door's one primary), then every other story this child can open now —
 * the practice passages already released in the child's open bands, read and listen, shuffled per child per PKT day
 * (no fixed order on a child's shelf, so `pos` rides on every row and the tap logs it), the ones already met last.
 * A row is listed only when it would open: a read needs its text in the item bank, a listen needs its recorded clip
 * (asking records a missing one in the background, so it appears on a later open) — never a tile that answers "on its
 * way". The storybook shelf (`shelf: true`) is drawn by the stories reader under its own switch (web_quiz_stories).
 * Games: the number games this child's grade has (the Trail's own rule: the grade-1 form's one game; else the warm-up /
 * missing number with its switches, and which is bigger), each opened by its id on /c/<token>#<id>; the teacher's
 * quizzes come with the hub boot (doors.games), not from here. Nothing here is a count about the child.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const { clampLanguage } = require('../../config/ux-strings');

const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 86400000;
const SAY_WAIT_MS = 600;

const fail = (status, error) => { const { WqError } = require('./web-quiz.service'); throw new WqError(status, { error }); };

/** The seed for one child on one Pakistan calendar day (pure). */
function daySeed(childId, now = Date.now()) {
  return crypto.createHash('sha256').update(`${childId}|${Math.floor((now + PKT_MS) / DAY_MS)}`).digest('hex').slice(0, 8);
}

/** A stable shuffle (pure): mulberry32 seeded by 8 hex characters, Fisher-Yates over a copy. */
function seededOrder(items, seed) {
  let a = parseInt(String(seed || '0').slice(0, 8), 16) >>> 0;
  const rnd = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = (items || []).slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function bank() {
  try { return require('../child-test/item-bank'); } catch (_) { return null; }
}

/** A read opens when its text is in the item bank; a listen when its clip is recorded (a missing one starts recording). */
async function opens(row, lang) {
  const B = bank();
  const p = B && typeof B.getPassage === 'function' ? B.getPassage(row.passage_id) : null;
  if (!p || !p.text) return false;
  if (row.kind !== 'listen') return true;
  try {
    const Challenge = require('./web-quiz-challenge');
    // the capped ask: a Stories open never takes the last half of the day's paid recordings
    const clip = typeof Challenge.storyClipCapped === 'function' ? Challenge.storyClipCapped : Challenge.storyClip;
    return typeof clip === 'function' && Boolean(await clip(lang, p.text));
  } catch (_) {
    return false;
  }
}

/** A recorded clip of a row's words, when there is one in time (null otherwise: the page says it another way). */
async function sayAll(texts, lang) {
  let Challenge;
  try { Challenge = require('./web-quiz-challenge'); } catch (_) { return texts.map(() => null); }
  if (typeof Challenge.sayClip !== 'function') return texts.map(() => null);
  const all = Promise.all(texts.map((t) => Challenge.sayClip(t, lang).catch(() => null)));
  const late = new Promise((resolve) => setTimeout(() => resolve(null), SAY_WAIT_MS));
  return (await Promise.race([all, late])) || texts.map(() => null);
}

async function storiesDoor(who, lang, now) {
  const Play = require('./web-quiz-hub-play');
  const s = await Play.switches();
  const storiesOn = await require('./web-quiz-home-flags').flags().then((f) => f.stories).catch(() => false);
  // The Story Time room serves a practice story only with its switch (wq-trail.js storyRoom: m.v2.story).
  if (!s.story) return { stories: [], shelf: storiesOn };
  const seen = await Play.seenPassages(who.studentId);
  const bands = Play.openBands(who.grade, await Play.readingRungOf(who.studentId));
  const { live } = await Play.passagesOf(lang, new Date(now).toISOString(), bands);
  const { titleFor } = require('./web-quiz-passage-title');
  const titled = live.map((r) => ({ r, title: titleFor(r.passage_id, lang) })).filter((x) => x.title);
  const ok = await Promise.all(titled.map((x) => opens(x.r, lang)));
  const rows = titled.filter((_, i) => ok[i]);
  const met = (r) => Boolean(seen && (seen.has(r.passage_id) || (r.twin_of && seen.has(r.twin_of))));
  const newest = rows.filter((x) => x.r.kind === 'read').sort((a, b) => Date.parse(b.r.released_at) - Date.parse(a.r.released_at))[0] || null;
  const rest = rows.filter((x) => x !== newest);
  const seed = daySeed(who.studentId, now);
  const ordered = [
    ...(newest ? [newest] : []),
    ...seededOrder(rest.filter((x) => !met(x.r)), seed),
    ...seededOrder(rest.filter((x) => met(x.r)), seed),
  ];
  const say = await sayAll(ordered.map((x) => x.title), lang);
  const stories = ordered.map((x, i) => ({
    kind: x.r.kind === 'listen' ? 'listen' : 'passage', id: x.r.passage_id, title: x.title, pos: i,
    ...(x === newest ? { week: true } : {}), ...(met(x.r) ? { done: true } : { fresh: true }), ...(say[i] ? { say: say[i] } : {}),
  }));
  return { stories, shelf: storiesOn };
}

async function gamesDoor(who, lang) {
  const Hub = require('./web-quiz-hub');
  if (!(await Hub.flags()).challenge) return { games: [] };
  const Challenge = require('./web-quiz-challenge');
  const G1 = require('./web-quiz-challenge-grade1');
  const form = await Challenge.formForChild(await Challenge.gradeOf({ studentId: who.studentId })).catch(() => null);
  if (!form) return { games: [] };
  let ids;
  if (form === G1.FORM) ids = [G1.EXERCISE];
  else {
    const missing = (await Challenge.recordOn()) && (await Challenge.missingOn());
    ids = [...(missing ? ['missing'] : []), 'bigger'];
  }
  // Under the pool the missing-number stop opens as the Number warm-up (wq-trail.js isWarmup: its anchor block).
  const warm = ids.includes('missing') && (await Challenge.poolOn());
  const names = ids.map((id) => (id === 'missing' && warm ? null : safeName(Challenge, id, lang)));
  const say = await sayAll(names.map((n) => n || ''), lang);
  return { games: ids.map((id, i) => ({ kind: 'numbers', stop: id, ...(id === 'missing' && warm ? { warm: true } : {}), ...(names[i] ? { name: names[i] } : {}), ...(say[i] ? { say: say[i] } : {}) })) };
}

function safeName(Challenge, id, lang) {
  try { return (id === 'bigger' || id === 'missing') && typeof Challenge.nameOf === 'function' ? Challenge.nameOf(id, lang) || null : null; } catch (_) { return null; }
}

/** One door's rows for the child a hub chip names on this phone. */
async function door(token, { kid, d, device, lang, now = Date.now() } = {}) {
  const T = require('./web-quiz-token');
  if (!T.secret()) fail(503, 'web_quiz_off');
  if (!(await require('./web-quiz-home-flags').flags()).home) fail(404, 'home_off');
  if (d !== 'stories' && d !== 'games') fail(400, 'bad_request');
  const who = await require('./web-quiz-hub').kidFromHub(String(token || ''), kid == null ? null : String(kid), device == null ? undefined : String(device));
  if (!who || !who.studentId) fail(401, 'bad_token');
  const l = clampLanguage(lang);
  try {
    return d === 'stories' ? await storiesDoor(who, l, now) : await gamesDoor(who, l);
  } catch (err) {
    if (err && err.status) throw err;
    logToFile('⚠️ web quiz doors: unavailable', { door: d, error: err.message });
    return d === 'stories' ? { stories: [], shelf: false } : { games: [] };
  }
}

module.exports = { door, seededOrder, daySeed };
