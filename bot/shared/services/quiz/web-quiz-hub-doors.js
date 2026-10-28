'use strict';
/**
 * The v3 child home's door screens (app_settings `web_quiz_home_v3`, the home's own switch): what is behind Stories and
 * Games beyond the hub boot's few ids, fetched when a door opens so the home itself stays light.
 *
 *   door(token, {kid, d, device, lang, g})   d = 'stories' -> {stories: [], shelf}   d = 'games' -> {games: [...]}
 *                                         g (games): one grade, 'a,b' or 'all'; another form's number games then carry
 *                                         {g, form, href} (a practice play), and the answer {sel, first} (byGrades)
 *                                         a failed read adds err: 1 (web_quiz_list_states on only)
 *                                         404 home_off with the switch off; 401 for a token/phone that is not this child's
 *                                         a grown-up's preview link (web_quiz_practice_play): its grade's rows (practiceDoor)
 *   seededOrder(items, seed)              a stable shuffle (pure): the same seed, the same order
 *   daySeed(childId, now)                 the seed for one child on one Pakistan day (pure)
 *
 * Stories: the storybooks' door. Its content is the storybook shelf (`shelf: true`), drawn by the stories reader under
 * its own switch (web_quiz_stories); no Jugnu passage is listed here (they open from the Games door and the home's
 * Next tile), so nothing is read about passages and no clip is asked for or recorded. `stories` stays an empty list.
 * Games: the number games this child's grade has (the Trail's own rule: the grade-1 form's one game; else the warm-up /
 * missing number with its switches, and which is bigger), each opened by its id on /c/<token>#<id>; then Jugnu's
 * passages (this week's read passage and the newest listening story, opened in the story room by id, each only when it
 * would open) and the games page's counted read aloud when the day's cap allows; the teacher's
 * quizzes come with the hub boot (doors.games), not from here. Nothing here is a count about the child.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const { clampLanguage } = require('../../config/ux-strings');
const SaGameDoor = require('./sa-game-door'); // sa_game: the big flight's row (off: the answer untouched)

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

/** A recorded clip of a row's words, when there is one in time (null otherwise: the page says it another way). */
async function sayAll(texts, lang, waitMs = SAY_WAIT_MS) {
  let Challenge;
  try { Challenge = require('./web-quiz-challenge'); } catch (_) { return texts.map(() => null); }
  if (typeof Challenge.sayClip !== 'function') return texts.map(() => null);
  const all = Promise.all(texts.map((t) => Challenge.sayClip(t, lang).catch(() => null)));
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  try {
    return (await Promise.race([all, late])) || texts.map(() => null);
  } finally { clearTimeout(timer); }
}

async function storiesDoor(list) {
  const storiesOn = await require('./web-quiz-home-flags').flags().then((f) => f.stories).catch(() => (list ? null : false));
  // web_quiz_list_states: a shelf switch that could not be read is a failed read, not "the shelf is off"
  return storiesOn === null ? { stories: [], shelf: false, err: 1 } : { stories: [], shelf: storiesOn };
}

// A grade or form read that failed: rethrown under web_quiz_list_states (the door answers err: 1), else today's null.
async function formFailed(err) {
  if (await require('./web-quiz-home-flags').flags().then((f) => f.list).catch(() => false)) throw err;
  return null;
}

// seen: told the child's grade as read here (the «All grades» rows need it; never a second read)
async function gamesDoor(who, lang, now, seen = {}) {
  if (require('./web-quiz-wait-ux').on()) return gamesDoorTogether(who, lang, now, seen);
  const Hub = require('./web-quiz-hub');
  if (!(await Hub.flags()).challenge) return { games: [] };
  const Challenge = require('./web-quiz-challenge');
  const G1 = require('./web-quiz-challenge-grade1');
  // web_quiz_list_states: a form read that failed is a failed door (the page offers a retry), not a child with no games
  const grade = await Challenge.gradeOf({ studentId: who.studentId });
  seen.grade = grade;
  const form = await Challenge.formForChild(grade).catch(formFailed);
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
  const reads = form === G1.FORM ? [] : await readRows(Challenge, who, lang, now);
  const say = await sayAll([...names.map((n) => n || ''), ...reads.map((r) => r.name || r.title)], lang);
  return { games: [
    ...ids.map((id, i) => ({ kind: 'numbers', stop: id, ...(id === 'missing' && warm ? { warm: true } : {}), ...(names[i] ? { name: names[i] } : {}), ...(say[i] ? { say: say[i] } : {}) })),
    ...reads.map((r, j) => ({ ...r, ...(say[ids.length + j] ? { say: say[ids.length + j] } : {}) })),
  ] };
}

// web_quiz_wait_ux on: the same rows as gamesDoor, but every read that does not need another's answer starts at once
// (the grade, the read cap, the passages' switch and the child's rung, once the challenge is known to be on), and the
// spoken labels are waited for at most WaitUx.SAY_WAIT_MS (a label late here is recorded in the background and ready on
// the next open). Each read is awaited where gamesDoor awaits it, so a read that fails fails the door as it does there
// (and one gamesDoor would not have asked for is never awaited, so its failure is ignored, as its read was there).
async function gamesDoorTogether(who, lang, now, seen = {}) {
  const Hub = require('./web-quiz-hub');
  if (!(await Hub.flags()).challenge) return { games: [] };
  const Challenge = require('./web-quiz-challenge');
  const G1 = require('./web-quiz-challenge-grade1');
  const Play = require('./web-quiz-hub-play');
  const WaitUx = require('./web-quiz-wait-ux');
  // started now, awaited later: the no-op catch only keeps a read that is never awaited from being an unhandled rejection
  const early = (fn) => { const p = Promise.resolve().then(fn); p.catch(() => {}); return p; };
  const gradeP = early(() => Challenge.gradeOf({ studentId: who.studentId }));
  const recordP = early(() => Challenge.recordOn());
  const missingP = early(() => Challenge.missingOn());
  const poolP = early(() => Challenge.poolOn());
  const swP = early(() => Play.switches());
  const rungP = early(() => Play.readingRungOf(who.studentId));
  const aloudP = early(() => require('./web-quiz-challenge-budget').readOpen()).catch(() => false);
  // web_quiz_list_states: as gamesDoor, a grade or form read that failed is a failed door, not a child with no games
  const form = await gradeP.then((g) => { seen.grade = g; return Challenge.formForChild(g); }).catch(formFailed);
  if (!form) return { games: [] };
  const ids = form === G1.FORM ? [G1.EXERCISE] : [...((await recordP) && (await missingP) ? ['missing'] : []), 'bigger'];
  const warm = ids.includes('missing') && (await poolP);
  const names = ids.map((id) => (id === 'missing' && warm ? null : safeName(Challenge, id, lang)));
  const reads = form === G1.FORM ? [] : await readRowsFrom(Challenge, who, lang, now, { swP, rungP, aloudP });
  const say = await sayAll([...names.map((n) => n || ''), ...reads.map((r) => r.name || r.title)], lang, WaitUx.SAY_WAIT_MS);
  return { games: [
    ...ids.map((id, i) => ({ kind: 'numbers', stop: id, ...(id === 'missing' && warm ? { warm: true } : {}), ...(names[i] ? { name: names[i] } : {}), ...(say[i] ? { say: say[i] } : {}) })),
    ...reads.map((r, j) => ({ ...r, ...(say[ids.length + j] ? { say: say[ids.length + j] } : {}) })),
  ] };
}

// readRows with its switch, rung and read cap already started (gamesDoorTogether): the same rows in the same order,
// each awaited where readRows reads it.
async function readRowsFrom(Challenge, who, lang, now, { swP, rungP, aloudP }) {
  const found = { read: null, listen: null };
  const Play = require('./web-quiz-hub-play');
  if ((await swP).story) {
    const { live } = await Play.passagesOf(lang, new Date(now).toISOString(), Play.openBands(who.grade, await rungP));
    pickPassages(live, lang, found);
  }
  let aloud = null;
  if (await aloudP) {
    const name = (() => { try { return typeof Challenge.nameOf === 'function' ? Challenge.nameOf('read', lang) || null : null; } catch (_) { return null; } })();
    if (name) aloud = { kind: 'read', stop: 'read', name };
  }
  return [found.read, aloud, found.listen].filter(Boolean);
}

// Jugnu's passages beside the games (the Stories door shows storybooks only): this week's read passage (read along, in
// the story room) and the newest listening story, each only when its text is in the bank (no clip is asked here: the
// listen's clip is asked when the child opens it, as the story room does), and the games page's counted read aloud
// when the day's cap allows.
async function readRows(Challenge, who, lang, now) {
  const found = { read: null, listen: null };
  const Play = require('./web-quiz-hub-play');
  if ((await Play.switches()).story) {
    const bands = Play.openBands(who.grade, await Play.readingRungOf(who.studentId));
    const { live } = await Play.passagesOf(lang, new Date(now).toISOString(), bands);
    pickPassages(live, lang, found);
  }
  let aloud = null;
  if (await require('./web-quiz-challenge-budget').readOpen().catch(() => false)) {
    const name = (() => { try { return typeof Challenge.nameOf === 'function' ? Challenge.nameOf('read', lang) || null : null; } catch (_) { return null; } })();
    if (name) aloud = { kind: 'read', stop: 'read', name };
  }
  // read along, read aloud, listen
  return [found.read, aloud, found.listen].filter(Boolean);
}

// The newest read and listen whose words are in the bank, each with its child-facing title (into found).
function pickPassages(live, lang, found) {
  const { titleFor } = require('./web-quiz-passage-title');
  for (const kind of ['read', 'listen']) {
    const rows = live.filter((r) => r.kind === kind).sort((x, y) => Date.parse(y.released_at) - Date.parse(x.released_at));
    for (const r of rows) {
      const title = titleFor(r.passage_id, lang);
      if (title && opens(r)) { found[kind] = { kind: kind === 'listen' ? 'listen' : 'passage', id: r.passage_id, title }; break; }
    }
  }
}

function bank() {
  try { return require('../child-test/item-bank'); } catch (_) { return null; }
}

/** A read or a listen opens when its text is in the item bank (a door open asks for no clip). */
function opens(row) {
  const B = bank();
  const p = B && typeof B.getPassage === 'function' ? B.getPassage(row.passage_id) : null;
  return Boolean(p && p.text);
}

function safeName(Challenge, id, lang) {
  try { return (id === 'bigger' || id === 'missing') && typeof Challenge.nameOf === 'function' ? Challenge.nameOf(id, lang) || null : null; } catch (_) { return null; }
}

/**
 * A grown-up's preview (web_quiz_practice_play): the door a child of the token's grade sees, read-only. Stories: the
 * shelf. Games: the grade's number games (the Trail's rule) and Jugnu's read-along and listening stories for the
 * grade's entry band (no reading rung: nobody has read yet), each opened in the practice games page. Never the counted
 * read aloud (it needs the microphone and is counted against a child's own day) and never the big flight (a child's
 * test). Nothing about any child is read.
 */
async function practiceDoor(d, who, lang, now, list) {
  require('./web-quiz-practice-play').note('doors', { d, grade: who.grade, lang });
  if (d === 'stories') return storiesDoor(list);
  const Hub = require('./web-quiz-hub');
  if (!(await Hub.flags()).challenge) return { games: [] };
  const Challenge = require('./web-quiz-challenge');
  const G1 = require('./web-quiz-challenge-grade1');
  const form = await Challenge.formForChild(Number(who.grade)).catch(formFailed);
  if (!form) return { games: [] };
  let ids;
  if (form === G1.FORM) ids = [G1.EXERCISE];
  else ids = [...((await Challenge.recordOn()) && (await Challenge.missingOn()) ? ['missing'] : []), 'bigger'];
  const warm = ids.includes('missing') && (await Challenge.poolOn());
  const names = ids.map((id) => (id === 'missing' && warm ? null : safeName(Challenge, id, lang)));
  const found = { read: null, listen: null };
  const Play = require('./web-quiz-hub-play');
  if (form !== G1.FORM && (await Play.switches()).story) {
    const { live } = await Play.passagesOf(lang, new Date(now).toISOString(), Play.openBands(Number(who.grade), 0));
    pickPassages(live, lang, found);
  }
  const reads = [found.read, found.listen].filter(Boolean);
  const say = await sayAll([...names.map((n) => n || ''), ...reads.map((r) => r.title)], lang);
  return { games: [
    ...ids.map((id, i) => ({ kind: 'numbers', stop: id, ...(id === 'missing' && warm ? { warm: true } : {}), ...(names[i] ? { name: names[i] } : {}), ...(say[i] ? { say: say[i] } : {}) })),
    ...reads.map((r, j) => ({ ...r, ...(say[ids.length + j] ? { say: say[ids.length + j] } : {}) })),
  ] };
}

/**
 * NO GRADE FORBIDS A GAME (bd-5gyspy.5). The Games door's rows for a selection of grades (`g`: one, several 'a,b', or
 * 'all'; none asked: the visitor's own grade(s), a preview's its teacher's taught grades, nobody's: every grade). The
 * visitor's own rows (`rows`, today's answer) stay as they are when their own grade is selected; every OTHER maths form
 * the selection reaches adds its number games, each opened as a practice play of a grade of that form (read-only,
 * nothing kept: Practice.gamePath), only while the practice play is on (web_quiz_practice_play; off: no such row).
 * Groups in the selection's order (the defaults first). Grade 1's form only where its own switches allow it
 * (Challenge.formForChild, unchanged). The own grade alone (the default for a child with a grade): today's answer, byte
 * for byte. Every answer logs one web_quiz.shelf line. Never fails the door: a failed extra read adds nothing.
 */
async function byGrades(rows, { who, own, asked, lang, known = true }) {
  const GradePick = require('./web-quiz-grade-pick');
  const ownG = Number(own) >= 1 && Number(own) <= 5 ? Number(own) : null;
  let p = GradePick.pick(asked, ownG ? [String(ownG)] : []);
  const done = (out) => { GradePick.note('games', p, lang, (out.games || []).length); return out; };
  try {
    if (who.practice) p = GradePick.pick(asked, (await GradePick.defaultsOf(who)).map(String));
    // a failed read (rows.err), or a child whose grade read never answered (it failed, or the challenge is off):
    // today's answer, byte for byte
    if (rows.err || !known) return done(rows);
    if (ownG && GradePick.single(p) === String(ownG)) return done(rows);
    const Hub = require('./web-quiz-hub');
    if (!(await Hub.flags()).challenge) return done(rows);
    const Challenge = require('./web-quiz-challenge');
    const Practice = require('./web-quiz-practice-play');
    const G1 = require('./web-quiz-challenge-grade1');
    const ownForm = ownG ? await Challenge.formForChild(ownG) : null;
    const play = await Practice.on();
    const groups = [];
    const forms = new Set(ownForm ? [ownForm] : []);
    for (const [rank, gs] of p.grades.entries()) {
      const gr = Number(gs);
      if (gr === ownG) { groups.push({ rank, rows: rows.games || [] }); continue; }
      if (!play) continue;
      const form = await Challenge.formForChild(gr);
      if (!form || forms.has(form)) continue;
      forms.add(form);
      const ids = form === G1.FORM ? [G1.EXERCISE] : [...((await Challenge.recordOn()) && (await Challenge.missingOn()) ? ['missing'] : []), 'bigger'];
      const warm = ids.includes('missing') && (await Challenge.poolOn());
      const list = ids.map((id) => {
        const href = Practice.gamePath({ grade: gr, lang, stop: id, teacher: who.teacherId || null });
        const name = id === 'missing' && warm ? null : safeName(Challenge, id, lang);
        return href ? { kind: 'numbers', stop: id, ...(id === 'missing' && warm ? { warm: true } : {}), ...(name ? { name } : {}), g: gr, form, href } : null;
      }).filter(Boolean);
      groups.push({ rank, rows: list });
    }
    // the own rows that are not number games (the read-along, the big flight) stay with the own grade's group
    const games = groups.sort((a, b) => a.rank - b.rank).flatMap((x) => x.rows);
    return done({ ...rows, games, sel: GradePick.selOf(p, true), first: p.first.map(Number) });
  } catch (err) {
    logToFile('⚠️ web quiz doors: other grades unavailable', { error: err.message });
    return done(rows);
  }
}

/** One door's rows for the child a hub chip names on this phone. */
async function door(token, opts = {}) {
  // web_quiz_kid_together: this answer's child rows are read once and shared (web-quiz-hub-child-rows.js)
  const ChildRows = require('./web-quiz-hub-child-rows');
  if (require('./web-quiz-hub-flags').kidTogetherNow() && !ChildRows.inside()) return ChildRows.run(() => door(token, opts));
  const { kid, d, device, lang, g = null, now = Date.now() } = opts;
  const T = require('./web-quiz-token');
  if (!T.secret()) fail(503, 'web_quiz_off');
  // web_quiz_practice_play: a grown-up's preview link (no child) opens its grade's doors, read-only
  const Practice = require('./web-quiz-practice-play');
  const preview = await Practice.who(String(token || ''));
  // web_quiz_games_together (the hub's switch cache): the child's reads start beside the door's switches
  const whoOf = () => require('./web-quiz-hub').kidFromHub(String(token || ''), kid == null ? null : String(kid), device == null ? undefined : String(device), d === 'games' ? { warm: ['class_enrollments'] } : undefined);
  const whoP = !preview && (d === 'stories' || d === 'games') && require('./web-quiz-hub-flags').nowOf('gamesTogether') ? whoOf() : null;
  if (whoP) whoP.catch(() => {});
  const homeFlags = await require('./web-quiz-home-flags').flags();
  if (!homeFlags.home) fail(404, 'home_off');
  if (d !== 'stories' && d !== 'games') fail(400, 'bad_request');
  // the games door's grade reads the child's enrolments: started with the child's own reads (web_quiz_kid_together)
  const who = preview || await (whoP || whoOf());
  if (!who || !(who.studentId || who.practice)) { Practice.refused('doors', token); fail(401, 'bad_token'); }
  const l = clampLanguage(lang);
  try {
    if (preview) {
      const rows = await practiceDoor(d, who, l, now, homeFlags.list);
      return d === 'games' ? await byGrades(rows, { who, own: who.grade, asked: g, lang: l }) : rows;
    }
    if (d === 'stories') return await storiesDoor(homeFlags.list);
    const seen = {};
    const rows = SaGameDoor.addRow(await gamesDoor(who, l, now, seen), who, { token, kid, lang: l });
    return await byGrades(rows, { who, own: seen.grade, asked: g, lang: l, known: 'grade' in seen });
  } catch (err) {
    if (err && err.status) throw err;
    logToFile('⚠️ web quiz doors: unavailable', { door: d, error: err.message });
    // web_quiz_list_states: the page tells a failed read from an empty one (a retry, never "nothing here")
    const list = await require('./web-quiz-home-flags').flags().then((f) => f.list).catch(() => false);
    return { ...(d === 'stories' ? { stories: [], shelf: false } : { games: [] }), ...(list ? { err: 1 } : {}) };
  }
}

module.exports = { door, seededOrder, daySeed };
