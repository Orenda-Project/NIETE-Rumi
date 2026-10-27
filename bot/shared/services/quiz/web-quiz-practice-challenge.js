'use strict';
/**
 * Jugnu's games page for a grown-up's preview (app_settings `web_quiz_practice_play`, web-quiz-practice-play.js): the
 * practice hub token (no child, a grade) opens the games page a child of that grade sees, and every game PLAYS — served
 * from the item bank, scored in this process and forgotten. Nothing is written: no run row, no draw row, no identity,
 * no rung, no binding, no speech key. web-quiz-challenge.js hands a practice token (or a practice run token) here before
 * it looks for a child, so with the switch off this file is never reached and the page is today's.
 *
 *   menu(pr, {lang})                          the grade's games: the number games (the Trail's rule) and "Listen and
 *                                             answer" when a practice listening story is ready; never the counted read
 *                                             aloud (it needs the microphone and is counted against a child's own day)
 *   exercise(pr, ex, {lang, room, passageId}) a game's page: missing / bigger / the grade-1 numbers game; a listening
 *                                             story; a read-along story (Story Time's room only: Jugnu reads, the words
 *                                             light; no microphone). Every page says practice_round, teacher_preview
 *                                             (the banner "Practice: nothing counts on a teacher's phone") and
 *                                             practice_play (the page offers no microphone)
 *   submit(c, body)                           the game's score from its taps, the same rules as a child's, kept nowhere
 *   questions(c) / answer(c, q, pick)         a listening story's questions and each tap's check, kept nowhere
 *   words(c)                                  "Show me the words" after a listening story
 *   hubOf(token) / runOf(ct)                  the practice token / run token while the switch is on, else null
 */
const crypto = require('crypto');
const { WqError } = require('./web-quiz-error');
const { clampLanguage } = require('../../config/ux-strings');
const Practice = require('./web-quiz-practice-play');

const fail = (status, error) => { throw new WqError(status, { error }); };
const kit = () => require('./web-quiz-challenge')._practiceKit;
const langOf = (v, own) => (v === 'en' || v === 'ur' ? v : clampLanguage(own));
const PREVIEW = Object.freeze({ practice_round: true, mode: 'practice', teacher_preview: true, practice_play: 1, draw: { outcome: 'served' } });

/** The practice hub token's fields while the switch is on, else null (no read for any other token). */
const hubOf = (token) => Practice.of(token);
/** A practice run token's payload while the switch is on, else null. */
async function runOf(ct) {
  const c = Practice.runOf(ct);
  return c && (await Practice.on()) ? c : null;
}

// The grade's form, the challenge being on (as a child's page asks it).
async function formOf(pr) {
  const K = kit();
  if (!(await K.challengeOn())) fail(503, 'challenge_off');
  const form = await K.formForChild(pr.g);
  if (!form) fail(403, 'not_eligible');
  return form;
}

// Story Time's practice stories a child of this grade could be shown first: the grade's entry band (no reading rung).
function bandsOf(g) { return require('./web-quiz-hub-play').openBands(g, 0); }

/** The practice passage for a story room's id: released, reviewed, practice pool, this kind and language, an open band. */
async function storyPassage(pr, kind, lang, pid) {
  const K = kit();
  const { Bank } = K.childTest();
  const own = typeof Bank.getPassage === 'function' ? Bank.getPassage(pid) : null;
  const D = K.Draw();
  const row = own ? D.storyPassageFor({ rows: await D.registryPassages(), pid, kind, lang, bands: bandsOf(pr.g), reserve: own.reserve === true, now: new Date() }) : null;
  if (!row) fail(400, 'story_pid');
  const p = K.passageFor(row.passage_id, Bank);
  if (!p) fail(503, 'unavailable');
  return p;
}

/** The newest practice listening story the grade's shelf shows (the Trail's listen stop on the preview), or null. */
async function newestListen(pr, lang) {
  try {
    const Play = require('./web-quiz-hub-play');
    if (!(await Play.switches()).story) return null;
    const { live } = await Play.passagesOf(lang, new Date().toISOString(), bandsOf(pr.g));
    const K = kit();
    const { Bank } = K.childTest();
    const rows = live.filter((r) => r.kind === 'listen').sort((a, b) => Date.parse(b.released_at) - Date.parse(a.released_at));
    for (const r of rows) { const p = K.passageFor(r.passage_id, Bank); if (p && p.text) return p; }
    return null;
  } catch (_) { return null; }
}

async function timedOf(lang, p) {
  const K = kit();
  try { return await require('./web-quiz-readalong').readAlong({ settingOn: K.settingOn }).forPassage({ lang, passageId: p.id, text: p.text }); } catch (_) { return null; }
}

async function menu(pr, { lang } = {}) {
  const K = kit();
  const form = await formOf(pr);
  const l = langOf(lang, pr.lang);
  const rt = await K.Tel.flag();
  Practice.note('challenge_menu', { grade: pr.g, form });
  if (form === K.Grade1.FORM) {
    return { form: 'G1', lang: l, exercises: [{ id: K.Grade1.EXERCISE, copy_keys: require('./web-quiz-challenge-grade1').COPY_KEYS, mins: 2, done: false, last: null, anchor_block: K.Grade1.BLOCK }],
      record: true, rt, practice_play: 1 };
  }
  const rules = await K.rulesOf();
  // "Listen and answer" only when a practice listening story for the grade is recorded (asking for its clip starts it)
  const story = (await K.listenOn()) ? await newestListen(pr, l) : null;
  const listenOk = Boolean(story && (await K.storyClip(l, story.text)));
  const order = rules.pool ? K.TRAIL_ORDER.slice() : K.EXERCISES.map((e) => e.id);
  const ids = order.filter((id) => id !== 'read' && (id !== 'listen' || listenOk) && (id !== 'missing' || rules.missing));
  const ui = await require('./web-quiz-ur-polish').ui();
  return {
    form: `G${form}`,
    lang: l,
    exercises: ids.map((id) => ({ id, name: K.nameOf(id, l), mins: (K.byId(id) || {}).mins || 2, done: false, last: null,
      ...(rules.trail ? { badge: false } : {}), ...(rules.pool && id === 'missing' ? { anchor_block: 'A1' } : {}) })),
    ...(rules.record ? { record: true } : {}),
    ...(rules.trail ? { trail: true, trail_copy: K.trailCopy(l) } : {}),
    rt,
    ...(ui ? { ui: require('./web-quiz-ur-polish').lite({ ur2: true }) } : {}),
    ...((await require('./web-quiz-juice').field()) ? { juice: true } : {}),
    // the Trail page (v2) and Story Time's room; no microphone notice (there is no child and no microphone here)
    ...(await K.TrailPage.bits({ studentId: null, lang: l })),
    practice_play: 1,
  };
}

async function exercise(pr, ex, { lang, room, passageId } = {}) {
  const K = kit();
  const form = await formOf(pr);
  const l = langOf(lang, pr.lang);
  const runId = crypto.randomUUID();
  const story = room === 'story' && typeof passageId === 'string' && passageId ? passageId : null;
  Practice.note('challenge_game', { ex, grade: pr.g, form, ...(story ? { room: 'story' } : {}) });
  const { Bank } = K.childTest();
  if (form === K.Grade1.FORM || ex === K.Grade1.EXERCISE) {
    if (form !== K.Grade1.FORM || ex !== K.Grade1.EXERCISE) fail(404, 'not_found');
    const items = Bank.anchorBlock(K.Grade1.BLOCK).map((i) => ({ item_id: i.item_id, n: i.n, layout: i.layout, tiles: i.tiles.slice() }));
    return { ex, form: 'G1', lang: l, ct: Practice.signRun({ ex, g: pr.g, lang: l, form, runId }), copy_keys: require('./web-quiz-challenge-grade1').COPY_KEYS,
      items, anchor_block: K.Grade1.BLOCK, stop_after: 0, per_item_s: require('./web-quiz-challenge-grade1').PER_ITEM_S, show_timer: false, sound_off_safe: true, record: false, ...PREVIEW };
  }
  const def = K.byId(ex);
  if (!def) fail(404, 'not_found');
  // the counted read aloud is the microphone's: a preview reads along with Jugnu in Story Time's room only
  if (ex === 'read' && !story) fail(404, 'not_found');
  const rules = await K.rulesOf();
  if (ex === 'missing' && !rules.missing) fail(503, 'missing_off');
  if (ex === 'listen' && !(await K.listenOn())) fail(503, 'listen_off');
  if (story && !rules.pool) fail(400, 'story_pid');
  const base = (extra = {}) => ({ ex, name: K.nameOf(ex, l), lang: l, clips: null, ...K.ruleFlags(rules), ...(rules.guard ? { copy: K.copyFor(l) } : {}),
    ...(rules.trail ? { trail: true, trail_copy: K.trailCopy(l) } : {}), ...PREVIEW, ...extra });
  const clips = await K.clipsFor(ex, l);
  if (ex === 'missing') {
    const a1 = rules.pool;
    const spec = Bank.getTaskSpec({ grade: Number(form), set: 'A', task: 'ma.missing' });
    const p3 = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.missing' });
    const items = a1 ? Bank.anchorBlock('A1').map((i) => ({ item_id: i.item_id, seq: i.seq.slice(), answer: i.answer })) : spec.items.map((i) => ({ seq: i.seq.slice(), answer: i.answer }));
    return { ...base({ clips }), ct: Practice.signRun({ ex, g: pr.g, lang: l, form, runId, anchor: a1 ? 'A1' : null }), items,
      practice: ((a1 ? p3 : spec).practice || []).map((i) => ({ seq: i.seq.slice(), answer: i.answer })),
      stop_after: a1 ? 0 : ((spec.stop && spec.stop.n) || 4), first_key_s: K.MISSING_FIRST_KEY_S, ...(a1 ? { anchor_block: 'A1' } : {}) };
  }
  if (ex === 'bigger') {
    const spec = Bank.getTaskSpec({ grade: Number(form), set: 'A', task: 'ma.discrimination' });
    return { ...base({ clips }), ct: Practice.signRun({ ex, g: pr.g, lang: l, form, runId }), items: K.servePairs(spec.items, form, rules.record),
      practice: (spec.practice || []).map((i) => ({ a: i.a, b: i.b, answer: i.answer })), per_item_s: K.PER_ITEM_S, stop_after: (spec.stop && spec.stop.n) || 4 };
  }
  // a story: the room's id, or (the Trail's listen stop) the newest practice listening story of the grade
  const p = story ? await storyPassage(pr, ex, l, story) : await newestListen(pr, l);
  if (!p) fail(503, 'getting_ready');
  const title = K.titleOf(p);
  const timed = await timedOf(l, p);
  const ct = Practice.signRun({ ex, g: pr.g, lang: l, form, runId, pid: p.id });
  if (ex === 'listen') {
    const url = await K.storyClip(l, p.text);
    if (!url) fail(503, 'getting_ready');
    return { ...base({ clips }), ct, read_times: 2, story_clip: { url }, ...(title ? { title } : {}), ...(timed ? { show_words: true } : {}) };
  }
  // read along: Jugnu's voice with the words lit; the page offers no microphone (practice_play)
  return { ...base({ clips }), ct, secs: K.READ_SECS, live: false, questions_on: false, story: { text: p.text, tokens: p.tokens, lines: p.lines, dir: p.direction },
    ...(title ? { title } : {}), story_clip: { url: await K.readAlongClip(l, p.text) }, ...(timed ? { readalong: timed } : {}) };
}

async function submit(c, body = {}) {
  const K = kit();
  const { Bank } = K.childTest();
  const form = String(c.f);
  Practice.note('challenge_result', { ex: c.ex, grade: c.g });
  if (c.ex === K.Grade1.EXERCISE) {
    const items = Bank.anchorBlock(K.Grade1.BLOCK).map((i) => ({ item_id: i.item_id, n: i.n, layout: i.layout, tiles: i.tiles.slice() }));
    return { score: require('./web-quiz-challenge-grade1').scoreNumberId(items, body.taps).score, practice_play: 1 };
  }
  if (c.ex === 'missing') {
    const a1 = c.a === 'A1';
    const spec = Bank.getTaskSpec({ grade: Number(form), set: 'A', task: 'ma.missing' });
    const items = a1 ? Bank.anchorBlock('A1') : spec.items;
    const { score } = K.scoreMissing(items, body.answers, { stopAfter: a1 ? 0 : ((spec.stop && spec.stop.n) || 4) });
    return { score, practice_play: 1 };
  }
  if (c.ex === 'bigger') {
    const spec = Bank.getTaskSpec({ grade: Number(form), set: 'A', task: 'ma.discrimination' });
    return { score: K.scoreBigger(spec.items, body.taps, { stopAfter: (spec.stop && spec.stop.n) || 4 }), previous: null, practice_play: 1 };
  }
  // a story has no recording to score (the microphone is never asked for on a preview)
  return fail(400, 'bad_request');
}

function passageOfRun(c) {
  const K = kit();
  if (c.ex !== 'listen' && c.ex !== 'read') fail(400, 'bad_request');
  const p = c.p ? K.passageFor(c.p, K.childTest().Bank) : null;
  if (!p) fail(404, 'not_found');
  return p;
}

async function questions(c, { lang } = {}) {
  const K = kit();
  if (c.ex !== 'listen') fail(400, 'bad_request');
  const p = passageOfRun(c);
  const l = langOf(lang, c.l);
  const optAudio = await K.optionAudioOn();
  const out = [];
  for (const q of p.questions || []) {
    if (out.length >= K.QA_MAX) break;
    const t = K.tapOptions(q, l, c.r);
    if (!t) continue;
    const k = q.id.split('.').pop();
    const item = { id: q.id, prompt: q.prompt, options: t.options, clip: { url: await K.clipUrl(K.clipKey('listen', k, l, q.prompt), q.prompt, l) } };
    if (optAudio) item.option_clips = await Promise.all(t.options.map(async (o) => ({ url: await K.clipUrl(K.clipKey('listen', `${k}-opt`, l, o), o, l) })));
    out.push(item);
  }
  Practice.note('challenge_questions', { n: out.length });
  return { questions: out };
}

async function answer(c, { q, pick, lang } = {}) {
  const K = kit();
  if (c.ex !== 'listen') fail(400, 'bad_request');
  const p = passageOfRun(c);
  const bq = (p.questions || []).find((x) => x.id === q);
  const n = Number(pick);
  if (!bq || !Number.isInteger(n) || n < 0 || n > 2) fail(400, 'bad_request');
  const t = K.tapOptions(bq, langOf(lang, c.l), c.r);
  if (!t) fail(400, 'bad_request');
  return { ok: t.options[n] === t.right, answer: t.right };
}

async function words(c, { lang } = {}) {
  if (c.ex !== 'listen') fail(400, 'bad_request');
  const p = passageOfRun(c);
  const t = await timedOf(langOf(lang, c.l), p);
  if (!t) fail(404, 'no_words');
  return { readalong: t };
}

module.exports = { hubOf, runOf, menu, exercise, submit, questions, answer, words };
