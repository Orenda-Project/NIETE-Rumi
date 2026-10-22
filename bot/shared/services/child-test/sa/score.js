'use strict';
/**
 * The self-administered battery's spoken tasks, scored in the bot process (CHILD_TEST_SA_SCORER=on; OFF by default).
 *
 * Until this, nothing scored them: saRegister parks every recording as `final:sa_score_later` (sa-store.js), and the
 * only scorer (conversation/recovery.js → scoreBlock) knows the coach-recorded v3 tasks and the v3 passage, not the
 * SA task ids or the passage variant the phone showed. So a coach who finished a battery saw "scored later" for ever.
 *
 *   scoreRow(row, session, deps)  one task's row → marks (never throws: { ok, marks } | { ok: false, reason, retry })
 *   sweepOnce({ sessionId? })     parked rows in THIS deployment's R2 tree: claim → score → write once
 *   kick(sessionId)               saRegister's nudge: that session's rows now, not at the next tick
 *   start() / stop()              the sweep, every 20 s, only with the switch on
 *
 * Claims never use `pending`/`scoring`: every state this file writes stays under `final:` (sa_score_later →
 * sa_scoring:<process> → sa_retry:<n> (or sa_wait_bank:<n>, a task this build does not know) → the marks, or
 * sa_score_failed:<reason>), so the older recovery sweep, which
 * skips a final failure (recovery.js verdict), never takes an SA row — not on this host, not on another build sharing
 * the DB. A claim names its process, so the compare-and-set changes the value and only the owner writes the marks. A
 * restart mid-score leaves a claim behind: it is taken again after 2 min, and at once by the new process's first sweep.
 *
 * What is marked, with the printed text the child saw (the bank's task, its passage variant from the phone's own
 * rotation — sa-page.js rotate, seeded with the result's session_id):
 *   grid       letters / words, one 60-s clip: per item c / w / s (Gemini 3.8 Flash; words with the study's STORY
 *              prompt verbatim, letters with the R8 letters prompt, self-administered, sound OR name per subtask);
 *              EGRA's first-row stop; attempted to the last item reached; correct per minute on the time used
 *   passage    the 60-s reading: STORY prompt; attempted to the last word the child tapped (RULING #2), else the
 *              model's last word; words correct per minute on the time used
 *   questions  comprehension, listening, segmentation: one clip per asked item (or one clip for all), each marked
 *              against its accept / reject / rubric
 * EGRA's stop rules (app_settings sa_stop_rules, OFF by default; the off path is unchanged): a W3 letters / words task
 * with no stop of its own takes the first-row rule (10 letters / 5 words, or the whole task when shorter), and the
 * questions after a passage stopped on its first line are not reached (EGRA does not ask them): 0, flagged, no model
 * call. Those questions wait while their passage is still being scored.
 * Numbers at the top of the marks are what the results page shows (sa-api.service numbersOf); the rest is nested.
 * No prompt carries a name: item text and audio only.
 *
 * Two switches, both OFF by default (the off path is the one above, unchanged):
 *   CHILD_TEST_SA_CLIP_WAIT_S=<s>     a questions task whose asked clips have not all come is scored once its row has
 *                                     had no new clip for <s> seconds (else: 2 min after the session's end). A question
 *                                     tapped through before Jugnu finished reading it has no clip and never will, so
 *                                     the last task of a battery waited past the coach's look at Results. A clip that
 *                                     comes after the marks joins the row's keys (sa-store setAudio; the marks are
 *                                     written once), so the independent scorers still hear it.
 *   CHILD_TEST_SA_SPEECH_GATE=on      every clip goes to STT (Soniox) first. No word heard, or the model's own
 *                                     found:false, and the clip is "no response": each of its items is not reached /
 *                                     no answer, conf 0, no_speech: true, never correct (a tone scored 4/4 before).
 *                                     STT puts a stray word on a near-silent clip, so "no word" alone let a 0.7-s
 *                                     comprehension clip through, and the model gave back the expected answer as heard.
 *                                     So, with the same switch: a clip shorter than CHILD_TEST_SA_MIN_SPEECH_S (0.8 s;
 *                                     a one-word answer took 0.9 s on sandbox, the echoed sentences 0.5-0.6 s)
 *                                     holds no answer and is not sent anywhere; and a question the model marks correct
 *                                     with the expected answer as heard, which STT did not hear, is no answer (echo).
 *   CHILD_TEST_SA_SECOND_VOICE=on     every clip is also asked, in its own small call beside the scoring, whether
 *                                     another person (an adult, another child) is heard speaking in it. The task's
 *                                     detail says second_voice (and each item from a flagged clip), and Results
 *                                     caveats the score. A flag, never a change of mark; the scoring prompts are not
 *                                     touched. A check that fails is "not checked", never a failed row.
 *
 * One recording per section (the phone's sa_section_recording, battery ui; OFF by default): an oral task is recorded
 * once, from Begin to its end, so an answer given early or late is never cut. Its row has one audio_r2_key, and the
 * result says rec_section: true with rec_marks [{ item_id, ask_ms, answer_ms, end_ms }] (ms from the recording's start).
 * Each item's stretch is cut from that one clip, from 1 s before its answer window opens to the next item's ask (the
 * last: 2.5 s after its screen moved on), and marked as a per-item clip is (the gate, the echo check, one item per
 * call). An item with no mark is no answer. Without usable marks the clip is scored whole. Rows without rec_section
 * are unchanged.
 */

const { logToFile, logError } = require('../../../utils/logger');
const stopRulesSwitch = require('../app/stop-rules-switch');

const PARKED = 'final:sa_score_later';
const SCORING = 'final:sa_scoring';
const RETRY = 'final:sa_retry:';
const FAILED = 'final:sa_score_failed:';
// A task this build does not know (recorded on a newer build, e.g. a grade its bank lacks) waits and is tried again,
// 1, 2, 4 … min apart, at most an hour, and fails for good only after 24 h: a build skew heals itself.
const WAIT_BANK = 'final:sa_wait_bank:';
const BANK_CAP_MS = 24 * 3600 * 1000;
const VERSION = 'sa-marks-v1';
const SA_MARK = 'sa-battery';
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 2 * 60 * 1000;
const WAIT_FOR_CLIPS_MS = 2 * 60 * 1000;   // a questions task whose session ended this long ago is scored with what came
const INTERVAL_MS = 20 * 1000;
const PER_TICK = 8;   // rows claimed per tick, scored side by side: one child's spoken tasks in about a minute
const SECONDS = 60;
// Every outbound await is bounded: one model, STT or R2 call that never answered kept `running` set, and every later
// tick was skipped without a word. A timed-out call is a retry (reason 'timeout'); a sweep past its deadline clears
// `running`, logs the stage it reached and changes this process's claim token, so its abandoned claims go stale and are
// taken again like a dead process's. deps.limits (ms) overrides these in tests.
const LIMITS = { model: 60 * 1000, stt: 60 * 1000, r2: 30 * 1000, sweep: 90 * 1000 };
const SKIP_LOG_MS = 60 * 1000;
const TASK_RE = /^[a-z]{2}\.[a-z0-9_]{1,40}$/;
const SECTION_LEAD_MS = 1000;   // a section stretch starts this long before the item's answer window opens
const SECTION_TAIL_MS = 2500;   // the last stretch ends this long after its screen moved on

const isOn = () => process.env.CHILD_TEST_SA_SCORER === 'on';
// this process's claim token; `swept` turns true after its first full sweep
const bootId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let MINE = `${SCORING}:${bootId()}`;
let swept = false;
const gateOn = () => process.env.CHILD_TEST_SA_SPEECH_GATE === 'on';
const voiceOn = () => process.env.CHILD_TEST_SA_SECOND_VOICE === 'on';
const minSpeechS = () => { const s = Number(process.env.CHILD_TEST_SA_MIN_SPEECH_S); return s >= 0 && process.env.CHILD_TEST_SA_MIN_SPEECH_S ? s : 0.8; };
const clipWaitMs = () => { const s = Number(process.env.CHILD_TEST_SA_CLIP_WAIT_S); return s > 0 ? s * 1000 : null; };
const sinceHours = () => Number(process.env.CHILD_TEST_SA_SCORER_SINCE_H) || 48;
const ownEnv = () => process.env.CHILD_TEST_R2_ENV || process.env.RAILWAY_ENVIRONMENT || 'local';
const envOf = (key) => { const m = /^child-test\/([^/]+)\//.exec(String(key || '')); return m ? m[1] : null; };
const round1 = (x) => Math.round(x * 10) / 10;
const band = (c) => (c == null ? null : c >= 0.8 ? 'high' : c >= 0.5 ? 'mid' : 'low');
const conf01 = (c) => { const n = Number(c); return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 100) / 100)) : null; };
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null; };
const resultOf = (r) => (Array.isArray(r.responses) && r.responses.find((x) => x && x.kind === 'result')) || null;
const keysOf = (r) => (Array.isArray(r.audio_r2_keys) ? r.audio_r2_keys.filter((k) => k && k.key) : []);
const hasAudio = (r) => Boolean(r.audio_r2_key || keysOf(r).length);

/** sa-page.js hash: FNV-1a, so the server picks the variant the phone did. */
function hash(s) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x;
}

function loadBank() {
  try { return require('../../../data/child-test/item-bank.sa.v1.json'); } catch (_) { return null; } // eslint-disable-line global-require
}

/** The task spec the child saw: the session's form (else Form A), the variant the phone's rotation chose. */
function specFor(bank, session, row) {
  const forms = (bank && bank.forms) || {};
  const formId = [`coach.G${session.grade}.${session.form}`, `coach.G${session.grade}.A`].find((f) => forms[f]);
  const base = formId && bank.tasks[`${formId}/${row.block}`];
  if (!base) return null;
  if (!Array.isArray(base.variants) || !base.variants.length) return { spec: base, variant: null };
  const res = resultOf(row) || {};
  // the asked ids name the variant outright (ur.story2.q1 → the variant whose task is ur.story2_comp); a passage
  // has none, so it takes the same index as its questions task's variant (sa-page rotate: one index per n)
  const asked = Array.isArray(res.asked) && res.asked.length ? res.asked : (Array.isArray(session.asked) ? session.asked : []);
  const askedIn = (t) => t && t.record && Array.isArray(t.record.questions) && asked.length
    && asked.some((id) => t.record.questions.some((q) => q.id === id));
  const comp = base.kind === 'passage' ? bank.tasks[`${formId}/${row.block}_comp`] : base;
  const at = comp && Array.isArray(comp.variants) && comp.variants.length === base.variants.length
    ? comp.variants.findIndex((x) => askedIn(x.task)) : -1;
  let v = at >= 0 ? base.variants[at] : null;
  if (!v && typeof res.session_id === 'string') v = base.variants[hash(res.session_id) % base.variants.length];
  if (!v) v = base.variants[0];
  return { spec: v.task || base, variant: { id: v.id, src: v.src || null } };
}

function isW3(bank, session, row) {
  const forms = (bank && bank.forms) || {};
  const formId = [`coach.G${session.grade}.${session.form}`, `coach.G${session.grade}.A`].find((f) => forms[f]);
  const t = formId && bank.tasks[`${formId}/${row.block}`];
  return !!(t && t.w3);
}

const PHONE_FILES = new Map();
/** The battery the phone was served (data/child-test/sa/sa.coach.G<g>.<form>.<lang>.json), null when absent. */
function phoneBattery(grade, form, lang) {
  const name = `sa.coach.G${grade}.${form}.${lang}.json`;
  if (!PHONE_FILES.has(name)) {
    let b = null;
    try { b = require(`../../../data/child-test/sa/${name}`); } catch (_) { /* no such form */ } // eslint-disable-line global-require
    PHONE_FILES.set(name, b);
  }
  return PHONE_FILES.get(name);
}

/**
 * A task as the phone ran it (the W3 forms: letters / words / numbers / sums one at a time, the passage with its own
 * punctuation), in the bank's shape so the scorers below read one shape. The variant is the phone's rotation: the one
 * whose questions were asked in this session, else hash(the phone's session id) mod n (sa-page.js rotate).
 */
function phoneSpecFor(session, row, load = phoneBattery) {
  const lang = /^(ur|en)\./.test(row.block) ? row.block.slice(0, 2) : (row.lang === 'en' ? 'en' : 'ur');
  const b = load(session.grade, session.form, lang) || load(session.grade, 'A', lang);
  const tasks = (b && Array.isArray(b.tasks)) ? b.tasks : [];
  let t = tasks.find((x) => x && x.id === row.block);
  if (!t) return null;
  let variant = null;
  if (Array.isArray(t.variants) && t.variants.length) {
    const res = resultOf(row) || {};
    const asked = Array.isArray(res.asked) && res.asked.length ? res.asked : (Array.isArray(session.asked) ? session.asked : []);
    const comp = t.kind === 'passage' ? tasks.find((x) => x && x.depends_on && x.depends_on.task === t.id && Array.isArray(x.variants)) : t;
    let at = comp && comp.variants.length === t.variants.length
      ? comp.variants.findIndex((v) => (v.items || []).some((q) => asked.includes(q.id))) : -1;
    if (at < 0 && typeof res.session_id === 'string') at = hash(res.session_id) % t.variants.length;
    const v = t.variants[Math.max(0, at)];
    t = { ...t, items: v.items || t.items, passage: v.passage || t.passage, stop: v.stop || t.stop };
    variant = { id: v.id, src: v.src || null };
  }
  const items = Array.isArray(t.items) ? t.items : [];
  const one = t.present === 'one_at_a_time';
  const stop = t.stop || {};
  const record = {
    // each item's own show next to its own answer (never zipped against a separately ordered grid)
    grid: items.length && items.every((x) => x.show != null) ? items.map((x) => String(x.show)) : (t.grid || []),
    answers: items.map((x) => (x.answer == null ? null : String(x.answer))),
    per_row: one ? items.length : Number(t.per_row) || 10,
    stop: stop.type ? stop : (stop.first_line_n ? { type: t.kind === 'passage' ? 'first_line' : 'first_row', n: stop.first_line_n } : {}),
    passage: t.passage ? { ...t.passage, words: items } : undefined,
    questions: t.kind === 'questions' || t.kind === 'listen_questions' ? items : undefined,
    items,
    time_limit_s: t.time_limit_s || null,
  };
  return { spec: { task: t.id, kind: t.kind, subtask: t.subtask, lang: t.lang || row.lang || lang, present: t.present || null, record }, variant };
}

const UR_NAMES = () => require('../scoring/tasks/prompts').UR_NAMES || {}; // eslint-disable-line global-require

function lettersPrompt({ grade, lang, items, perRow, sound, answers = [], one = false }) {
  const ur = lang === 'ur';
  const names = ur ? UR_NAMES() : {};
  const said = (L, i) => answers[i] || (ur && names[L]) || '';
  const card = items.map((L, i) => `${i + 1}: ${L}${said(L, i) ? ` (${said(L, i)})` : ''}`).join(' ');
  const rule = sound
    ? `the child says each letter's SOUND${ur ? ' (e.g. "بَ" for ب)' : ' (e.g. /b/ for b)'}; a letter NAME said instead of its sound is WRONG`
    : `the child says each letter's NAME${ur ? ' (e.g. الف، بے، جیم; "یے" alone is acceptable for ی and ے, "ہمزہ" for ء)' : ' (upper or lower case is the same letter)'}; a clear letter SOUND for that letter also counts`;
  return `A child in a Pakistani government school (grade ${grade}) is doing the timed ${ur ? 'Urdu' : 'English'} LETTER ${sound ? 'SOUND' : 'NAME'} task of an EGRA reading test ALONE on a phone, wearing headphones. ${one ? `The phone showed ${items.length} letters ONE AT A TIME, in this order, each for a few seconds,` : `The phone showed a card of ${items.length} letters, ${perRow} per row, read ${ur ? 'right to left' : 'left to right'} row by row,`} and recorded the child for up to 60 seconds. There is no adult in the clip; the phone's own voice may be faintly heard.
Marking rules: ${rule}. A self-correction counts as correct. A letter said wrongly, or passed over while the child keeps going, is WRONG. Every position after the last letter the child reached is SKIPPED.
${answers.length ? 'The printed letters in order (position: letter (what a correct child says)):' : `The printed card in reading order (position: letter${ur ? ' (its name)' : ''}):`}
${card}
For EVERY position 1-${items.length} return v = "c" (correct), "w" (wrong) or "s" (skipped / not reached), heard = what the child said for that letter ("" if skipped), and conf = your confidence 0-1 in that verdict. found = whether the clip contains the child saying letters from this card at all.
Return ONLY JSON: {"found": true, "last_attempted": <int>, "letters_correct": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}`;
}

function questionsPrompt({ lang, task, questions, passage, single }) {
  const L = lang === 'ur' ? 'Urdu' : 'English';
  const what = task.subtask === 'phoneme_segmentation'
    ? 'says the separate SOUNDS of a word it heard (each sound on its own; the whole word is WRONG)'
    : task.kind === 'listen_questions' ? 'answers questions about a short story the phone read aloud to the child'
      : 'answers questions about a passage the child has just read on the phone';
  const ctx = passage ? `The ${task.kind === 'listen_questions' ? 'story the child heard' : 'passage'}:\n${passage}\n` : '';
  const list = questions.map((q, i) => `${i + 1}. [${q.id}] ${(q.prompt && q.prompt.text) || q.word || ''}\n   accept: ${(q.accept || []).join(' | ') || '-'}\n   reject: ${(q.reject || []).join(' | ') || '-'}\n   rubric: ${q.rubric || (q.phonemes ? `the sounds ${q.phonemes.join(' ')}` : '-')}`).join('\n');
  return `A child in a Pakistani government school (grade 1-5), alone with a phone and wearing headphones, ${what}, in an ${L} EGRA task. ${single ? 'The clip holds the child\'s answers to the questions below, in order.' : 'The clip holds the child\'s spoken answer to ONE question, the one listed.'} Judge the meaning, in any language or wording: CORRECT if it gives the right information, WRONG if it is incorrect or the child says they do not know, NO_ANSWER if nothing audible is said. Use each item's accepted and rejected answers and rubric.
${ctx}ITEMS:
${list}
Return ONLY JSON: {"questions":[{"id":"<id>","answer":"<the child's answer as heard>","verdict":"correct|wrong|no_answer","confidence":<0-1>}]}`;
}

const QUESTIONS_SCHEMA = {
  name: 'sa_questions',
  schema: {
    type: 'object', additionalProperties: false, required: ['questions'],
    properties: { questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'answer', 'verdict', 'confidence'],
      properties: { id: { type: 'string' }, answer: { type: 'string' }, verdict: { type: 'string', enum: ['correct', 'wrong', 'no_answer'] }, confidence: { type: 'number' } } } } },
  },
};

function defaultDeps() {
  /* eslint-disable global-require */
  const media = require('../scoring/media');
  return {
    chatJSON: require('../scoring/llm').chatJSON,
    model: () => require('../scoring/models').modelFor('counts'),
    clipOf: async (key, signal) => {
      const file = await media.downloadToTemp(key, 'webm', signal);
      try {
        const dur = (await media.probeDuration(file)) || (await media.decodedDuration(file)) || SECONDS + 5;
        const clip = await media.cutClip(file, 0, dur, 'mp3');
        media.cleanup(clip.path);
        return { base64: clip.base64, durationSec: dur };
      } finally { media.cleanup(file); }
    },
    // the speech gate: STT on the clip the model hears; words = how many words it heard
    speechOf: async (clip, lang, signal) => {
      const fs = require('fs');
      const file = media.tmpFile('mp3');
      fs.writeFileSync(file, Buffer.from(clip.base64, 'base64'));
      try {
        const r = await require('../scoring/stt').transcribe(file, lang === 'en' ? 'en' : 'ur', clip.durationSec, { signal });
        const words = r.words || [];
        return { words: words.length, text: words.map((w) => w.raw).join(' '), model: r.model, cost: r.cost, seconds: r.seconds };
      } finally { media.cleanup(file); }
    },
    // one recording per section: download once, cut each item's stretch
    sliceOf: async (key, windows, signal) => {
      const file = await media.downloadToTemp(key, 'webm', signal);
      try {
        const out = [];
        for (const w of windows) {
          const clip = await media.cutClip(file, w.from_s, w.to_s, 'mp3');
          media.cleanup(clip.path);
          out.push({ base64: clip.base64, durationSec: Math.max(0.5, w.to_s - w.from_s) });
        }
        return out;
      } finally { media.cleanup(file); }
    },
    bank: loadBank(),
    phoneBattery,
  };
  /* eslint-enable global-require */
}

/**
 * run(signal), bounded: rejects with reason 'timeout' (and the stage) once `ms` pass, whether or not the callee
 * honours the signal. A callee that does (the model client, R2, STT) also stops its own request.
 */
function bounded(stage, ms, run) {
  const signal = AbortSignal.timeout(ms);
  return new Promise((resolve, reject) => {
    const fail = () => { const e = new Error(`${stage}_timeout`); e.reason = 'timeout'; e.stage = stage; reject(e); };
    signal.addEventListener('abort', fail, { once: true });
    Promise.resolve().then(() => run(signal)).then(resolve, reject).finally(() => signal.removeEventListener('abort', fail));
  });
}
const limitOf = (deps, k) => Number((deps.limits || {})[k]) || LIMITS[k];
const clipOf = (deps, key) => bounded('r2', limitOf(deps, 'r2'), (signal) => deps.clipOf(key, signal));
const sec = (ms) => Math.round(Math.max(0, ms) / 100) / 10;

/**
 * sa_section_recording: each marked item's stretch of the task's one clip, in recording order, as
 * [{ item_id, from_s, to_s }]; null when the row is not a section recording or has no usable marks.
 */
function sectionWindows(row, res) {
  if (!res || res.rec_section !== true || !row.audio_r2_key || !Array.isArray(res.rec_marks)) return null;
  const n = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));
  const marks = res.rec_marks.filter((m) => m && typeof m.item_id === 'string' && Number.isFinite(n(m.answer_ms)))
    .sort((a, b) => (Number.isFinite(n(a.ask_ms)) ? n(a.ask_ms) : n(a.answer_ms)) - (Number.isFinite(n(b.ask_ms)) ? n(b.ask_ms) : n(b.answer_ms)));
  if (!marks.length) return null;
  return marks.map((m, k) => {
    const from = Math.max(0, n(m.answer_ms) - SECTION_LEAD_MS);
    const next = marks[k + 1];
    const end = Number.isFinite(n(m.end_ms)) ? n(m.end_ms) : n(m.answer_ms);
    let to = next && Number.isFinite(n(next.ask_ms)) ? n(next.ask_ms) : end + SECTION_TAIL_MS;
    if (to <= from) to = Math.max(end + SECTION_TAIL_MS, from + 500);
    return { item_id: m.item_id, from_s: sec(from), to_s: sec(to) };
  });
}

/** The section's stretches by item id, cut from one download; null when the row is not a section recording. */
async function sectionClips(deps, row, res) {
  const windows = sectionWindows(row, res);
  if (!windows) return null;
  const clips = await bounded('r2', 2 * limitOf(deps, 'r2'), (signal) => deps.sliceOf(row.audio_r2_key, windows, signal));
  return new Map(windows.map((w, k) => [w.item_id, clips[k]]).filter(([, c]) => c));
}

/** The time the child used, seconds (the phone's clock), 1–60. */
function usedSeconds(res) {
  const ms = Number(res && res.time_used_ms);
  if (!Number.isFinite(ms) || ms <= 0) return SECONDS;
  return Math.max(1, Math.min(SECONDS, ms / 1000));
}

async function call(deps, calls, { prompt, schema, clip, job }) {
  const model = deps.model();
  let r;
  try {
    r = await bounded('model', limitOf(deps, 'model'), (signal) => deps.chatJSON({ model, prompt, schema, audio: { data: clip.base64, format: 'mp3' }, job, maxTokens: 12000, signal }));
  } catch (e) {
    calls.push({ job, model, cost: null, seconds: round1(limitOf(deps, 'model') / 1000), error: e.reason || 'model_failed' });
    throw e;
  }
  calls.push({ job, model, cost: r.cost == null ? null : Math.round(r.cost * 1e5) / 1e5, seconds: round1(r.seconds || 0), error: r.error || null });
  if (!r.json) { const e = new Error('model_failed'); e.reason = 'model_failed'; throw e; }
  return r.json;
}

/**
 * The speech gate (CHILD_TEST_SA_SPEECH_GATE): true when the clip is shorter than the minimum speech duration or STT
 * hears no word in it, false when it hears some, null when it cannot say (switch off, STT failed): then the model's
 * verdicts stand as they are. `heard` (when given) gets what STT heard, for the echo check.
 */
async function silent(deps, calls, clip, lang, heard = null) {
  if (!gateOn()) return null;
  const dur = Number(clip && clip.durationSec);
  if (Number.isFinite(dur) && dur < minSpeechS()) {
    calls.push({ job: 'child_test.sa_speech_gate', model: 'duration', cost: 0, seconds: 0, error: null, words: 0, clip_s: round1(dur) });
    return true;
  }
  if (!deps.speechOf) return null;
  try {
    const s = await bounded('stt', limitOf(deps, 'stt'), (signal) => deps.speechOf(clip, lang, signal));
    calls.push({ job: 'child_test.sa_speech_gate', model: s.model || 'stt', cost: s.cost == null ? null : Math.round(s.cost * 1e5) / 1e5, seconds: round1(s.seconds || 0), error: null, words: s.words });
    if (heard && typeof s.text === 'string') heard.text = s.text;
    return Number.isInteger(s.words) ? s.words === 0 : null;
  } catch (e) {
    calls.push({ job: 'child_test.sa_speech_gate', model: 'stt', cost: null, seconds: 0, error: String((e && e.message) || e).slice(0, 120) });
    if (e && e.reason === 'timeout') throw e; // no answer is not "STT cannot say": the row is retried
    return null;
  }
}

// the echo check: letters only (no harakat, punctuation or spaces), compared as character pairs
const bare = (t) => String(t || '').toLowerCase().normalize('NFC').replace(/[\u064B-\u065F\u0670\u06EA-\u06ED]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
const pairs = (t) => { const b = bare(t); const out = []; for (let i = 0; i + 1 < b.length; i += 1) out.push(b.slice(i, i + 2)); return b.length === 1 ? [b] : out; };
const arabic = (t) => (String(t).match(/[\u0600-\u06FF]/g) || []).length > (String(t).match(/[a-z]/gi) || []).length;
/** Share of a's character pairs that are also in b (0–1). */
function within(a, b) {
  const A = pairs(a); const B = new Set(pairs(b));
  return A.length ? A.filter((x) => B.has(x)).length / A.length : 0;
}
/**
 * A "correct" to distrust: the model's heard text is the expected answer (an accept, near word for word) and STT, in
 * the same script, heard little of it. A model echoes the answer it was given when the clip holds none.
 */
function echoed(q, g, sttText) {
  if (!g || g.verdict !== 'correct' || typeof sttText !== 'string') return false;
  const said = String(g.answer || '');
  if (!bare(said) || (bare(sttText) && arabic(said) !== arabic(sttText))) return false;
  const isAccept = (q.accept || []).some((a) => within(said, a) >= 0.8 && within(a, said) >= 0.8);
  return isAccept && within(said, sttText) < 0.5;
}

/** A clip with no speech: each of its items is not reached (timed) / no answer (questions), conf 0, never correct. */
const MUTE = { verdict: 'not_reached', heard: '', conf: 0, no_speech: true };

/** Timed rows from per-position verdicts; a gap before the last reached item is wrong (EGRA: skipped = incorrect). */
function timedRows(refs, verdictOf) {
  const v = refs.map((_, k) => verdictOf(k));
  let last = 0;
  v.forEach((x, k) => { if (x.verdict !== 'not_reached') last = k + 1; });
  return refs.map((ref, k) => ({ i: k + 1, ref, verdict: v[k].verdict === 'not_reached' && k < last ? 'wrong' : v[k].verdict, heard: v[k].heard || '', conf: v[k].conf, ...(v[k].no_speech ? { no_speech: true } : {}) }));
}

function firstRowStopped(rows, n) {
  if (!(n > 0) || rows.length < n) return false;
  return rows.slice(0, n).every((r) => r.verdict !== 'correct');
}

function timedNumbers(rows, res, { stopped, attemptedTo = null }) {
  let attempted = 0;
  rows.forEach((r) => { if (r.verdict !== 'not_reached') attempted = r.i; });
  if (attemptedTo != null) attempted = attemptedTo;
  const correct = stopped ? 0 : rows.filter((r) => r.i <= attempted && r.verdict === 'correct').length;
  const used = usedSeconds(res);
  return { correct, attempted, per_minute: correct ? round1((correct / used) * SECONDS) : 0, seconds_used: round1(used) };
}

async function scoreGrid(task, rec, row, res, deps, calls, grade) {
  const items = (rec.grid || []).map(String);
  const perRow = Number(rec.per_row) || 10;
  const clip = await clipOf(deps, row.audio_r2_key);
  const letters = /letter/.test(task.subtask || task.task);
  const LV = { c: 'correct', w: 'wrong', s: 'not_reached', n: 'not_reached' };
  let rows;
  const mute = await silent(deps, calls, clip, task.lang);
  if (mute) rows = timedRows(items, () => MUTE);
  else if (letters) {
    const json = await call(deps, calls, { prompt: lettersPrompt({ grade, lang: task.lang, items, perRow, sound: /sound/.test(task.subtask || task.task), answers: rec.answers || [], one: task.present === 'one_at_a_time' }), schema: LETTERS_SCHEMA(), clip, job: 'child_test.sa_letters' });
    const by = new Map((json.items || []).map((it, j) => [Number(it.i) || j + 1, it]));
    rows = gateOn() && json.found === false ? timedRows(items, () => MUTE)
      : timedRows(items, (k) => { const it = by.get(k + 1) || {}; return { verdict: LV[it.v] || 'not_reached', heard: String(it.heard || ''), conf: conf01(it.conf) }; });
  } else {
    rows = await storyRows(items, task.lang, clip, deps, calls, 'child_test.sa_words');
  }
  const stopped = (rec.stop || {}).type === 'first_row' && firstRowStopped(rows, Number(rec.stop.n) || perRow);
  return { numbers: timedNumbers(rows, res, { stopped, attemptedTo: reachedOf(task, res, items.length) }), rows, stopped, durationSec: clip.durationSec };
}

/** One item at a time: the phone knows the last cell the child reached (cells[] / last_item_index). */
function reachedOf(task, res, n) {
  if (task.present !== 'one_at_a_time' || !res) return null;
  if (Array.isArray(res.cells) && res.cells.length) return Math.min(n, res.cells.length);
  return Number.isInteger(res.last_item_index) ? Math.min(n, res.last_item_index + 1) : null;
}

function oralPrompt({ lang, task, items, one }) {
  const what = /fluency/.test(task.subtask || '') ? 'quick sums, as many as it can in one minute'
    : /number_id/.test(task.subtask || '') ? 'the NAME of each number shown (e.g. "forty-five" / «پینتالیس» for 45)'
      : 'the answer to each sum shown, worked out in its head';
  const list = items.map((x, i) => `${i + 1}: shown "${x.show}" → correct answer ${x.answer}`).join('\n');
  return `A child in a Pakistani government school (grade 3-5), alone with a phone and wearing headphones, is doing an EGMA maths task: it says aloud ${what}. ${one ? 'The phone showed the items ONE AT A TIME, in this order.' : 'The phone showed the items in this order.'} The child may answer in Urdu, English or a mix (e.g. «انیس», "nineteen", "unees"); judge the NUMBER said. The phone's own voice may be faintly heard; ignore it.
Marking rules: "c" if the child's final answer for that item is the correct number (a self-correction counts), "w" if it says a different number or "I don't know", "s" if it never reached the item or said nothing for it.
ITEMS (position: what was shown → the correct answer):
${list}
For EVERY position 1-${items.length} return v = "c", "w" or "s", heard = the number the child said ("" if none), conf = your confidence 0-1.
Return ONLY JSON: {"found": true, "last_attempted": <int>, "letters_correct": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}`;
}

/** Spoken maths (W3: number identification, mental + − ×, one-minute fluency): one clip for the task, or one per item. */
async function scoreOral(task, rec, row, res, deps, calls) {
  const items = rec.items || [];
  const LV = { c: 'correct', w: 'wrong', s: 'not_reached', n: 'not_reached' };
  const one = task.present === 'one_at_a_time';
  const got = new Map();
  const keys = keysOf(row);
  const section = await sectionClips(deps, row, res);
  const parts = section ? items.map((x, k) => ({ list: [x], at: [k], clip: section.get(x.id) })).filter((p) => p.clip)
    : keys.length ? items.map((x, k) => ({ list: [x], at: [k], key: (keys.find((y) => y.i === x.id) || {}).key })).filter((p) => p.key)
    : (row.audio_r2_key ? [{ list: items, at: items.map((_, k) => k), key: row.audio_r2_key }] : []);
  let durationSec = null;
  for (const p of parts) {
    const clip = p.clip || await clipOf(deps, p.key);
    durationSec = (durationSec || 0) + (clip.durationSec || 0);
    if (await silent(deps, calls, clip, task.lang)) { p.at.forEach((k) => got.set(k, { mute: true })); continue; }
    const json = await call(deps, calls, { prompt: oralPrompt({ lang: task.lang, task, items: p.list, one }), schema: LETTERS_SCHEMA(), clip, job: 'child_test.sa_oral_maths' });
    const by = new Map((json.items || []).map((it, j) => [Number(it.i) || j + 1, it]));
    const none = gateOn() && json.found === false;
    p.at.forEach((k, j) => got.set(k, none ? { mute: true } : by.get(j + 1) || {}));
  }
  const rows = timedRows(items.map((x) => String(x.show)), (k) => { const it = got.get(k) || {}; return it.mute ? MUTE : { verdict: LV[it.v] || 'not_reached', heard: String(it.heard || ''), conf: conf01(it.conf) }; });
  rows.forEach((r, k) => { r.id = items[k].id; r.answer = items[k].answer; });
  const timed = Number(rec.time_limit_s) > 0;
  const attemptedTo = reachedOf(task, res, items.length);
  const numbers = timed ? timedNumbers(rows, res, { stopped: false, attemptedTo })
    : { correct: rows.filter((r) => r.verdict === 'correct').length, of: rows.length };
  return { numbers, rows, stopped: false, durationSec, section: Boolean(section) };
}

async function storyRows(tokens, lang, clip, deps, calls, job) {
  /* eslint-disable global-require */
  const prompts = require('../scoring/prompts');
  const { verdictsFrom } = require('../scoring/story');
  /* eslint-enable global-require */
  const json = await call(deps, calls, { prompt: prompts.STORY({ lang: lang === 'ur' ? 'urdu' : 'english', tokens }), schema: prompts.STORY_SCHEMA, clip, job });
  const v = verdictsFrom(json, tokens.length);
  const VV = { correct: 'correct', wrong: 'wrong', skipped: 'not_reached' };
  return timedRows(tokens, (k) => ({ verdict: VV[v[k]] || 'not_reached', heard: '', conf: null }));
}

async function scorePassage(task, rec, row, res, deps, calls) {
  const p = rec.passage || {};
  const tokens = Array.isArray(p.words) && p.words.length ? p.words.map((w) => String(w.target)) : String(p.text || '').split(/\s+/).filter(Boolean);
  const clip = await clipOf(deps, row.audio_r2_key);
  const rows = (await silent(deps, calls, clip, task.lang)) ? timedRows(tokens, () => MUTE)
    : await storyRows(tokens, task.lang, clip, deps, calls, 'child_test.sa_story');
  // RULING #2: the child taps the last word read; words after it were not attempted
  const tapped = res && Number.isInteger(res.last_word_index) ? Math.min(tokens.length, res.last_word_index + 1) : null;
  const line1 = (p.lines || [])[0];
  const stopped = (rec.stop || {}).type === 'first_line' && line1 ? firstRowStopped(rows, line1.to - line1.from + 1) : false;
  return { numbers: timedNumbers(rows, res, { stopped, attemptedTo: tapped }), rows, stopped, durationSec: clip.durationSec, tapped };
}

async function scoreQuestions(task, rec, row, res, deps, calls) {
  const all = rec.questions || [];
  const asked = res && Array.isArray(res.asked) && res.asked.length ? res.asked : all.map((q) => q.id);
  const qs = asked.map((id) => all.find((q) => q.id === id)).filter(Boolean);
  const passage = (rec.passage && rec.passage.text) || null;
  const marked = new Map();
  const keys = keysOf(row);
  const section = await sectionClips(deps, row, res);
  if (section || keys.length) {
    for (const q of qs) {
      const k = section ? null : keys.find((x) => x.i === q.id);
      if (!(section ? section.has(q.id) : k)) continue; // no clip (or stretch) for this question: no answer heard
      const clip = section ? section.get(q.id) : await clipOf(deps, k.key);
      const stt = {};
      if (await silent(deps, calls, clip, task.lang, stt)) { marked.set(q.id, { mute: true }); continue; }
      const json = await call(deps, calls, { prompt: questionsPrompt({ lang: task.lang, task, questions: [q], passage, single: false }), schema: QUESTIONS_SCHEMA, clip, job: 'child_test.sa_questions' });
      const got = (json.questions || [])[0];
      if (got) marked.set(q.id, echoed(q, got, stt.text) ? { mute: true, echo: true } : got);
    }
  } else if (row.audio_r2_key) {
    const clip = await clipOf(deps, row.audio_r2_key);
    const stt = {};
    if (await silent(deps, calls, clip, task.lang, stt)) qs.forEach((q) => marked.set(q.id, { mute: true }));
    else {
      const json = await call(deps, calls, { prompt: questionsPrompt({ lang: task.lang, task, questions: qs, passage, single: true }), schema: QUESTIONS_SCHEMA, clip, job: 'child_test.sa_questions' });
      for (const g of json.questions || []) {
        const q = qs.find((x) => x.id === g.id);
        marked.set(g.id, q && echoed(q, g, stt.text) ? { mute: true, echo: true } : g);
      }
    }
  }
  const rows = qs.map((q, k) => {
    const g = marked.get(q.id);
    const clip = keys.some((x) => x.i === q.id) || Boolean(row.audio_r2_key);
    if (g && g.mute) return { i: k + 1, id: q.id, verdict: 'no_answer', heard: '', conf: 0, no_speech: true, clip, ...(g.echo ? { echo: true } : {}) };
    return { i: k + 1, id: q.id, verdict: g ? g.verdict : 'no_answer', heard: g ? String(g.answer || '') : '', conf: g ? conf01(g.confidence) : null, clip };
  });
  return { numbers: { correct: rows.filter((r) => r.verdict === 'correct').length, of: rows.length }, rows, stopped: false, section: Boolean(section) };
}

const VOICE_SCHEMA = {
  name: 'sa_second_voice',
  schema: {
    type: 'object', additionalProperties: false, required: ['second_voice', 'who', 'confidence'],
    properties: { second_voice: { type: 'boolean' }, who: { type: 'string', enum: ['adult', 'child', 'unsure', 'none'] }, confidence: { type: 'number' } },
  },
};
const VOICE_PROMPT = `This is a recording from a phone on which a child in a Pakistani government school (grade 1-5) is doing a reading or maths test, wearing headphones. The phone's own recorded voice (the app's narrator) may be faintly heard. Besides the child being tested and the phone's own voice, is ANOTHER PERSON clearly heard speaking in the clip: an adult (a teacher, a coach, a parent) or another child, e.g. saying the items, prompting, giving answers or talking to the child? Distant background chatter whose words cannot be made out, and noise, do not count.
Return ONLY JSON: {"second_voice": true|false, "who": "adult|child|unsure|none", "confidence": <0-1>}`;

/** CHILD_TEST_SA_SECOND_VOICE: is another person heard in this clip? { key, heard: true | false | null (not checked) }. */
async function voiceOf(deps, calls, clip, key) {
  const dur = Number(clip && clip.durationSec);
  if (Number.isFinite(dur) && dur < minSpeechS()) return { key, heard: false };
  const model = deps.model();
  try {
    const r = await bounded('model', limitOf(deps, 'model'), (signal) => deps.chatJSON({ model, prompt: VOICE_PROMPT, schema: VOICE_SCHEMA, audio: { data: clip.base64, format: 'mp3', key }, job: 'child_test.sa_second_voice', maxTokens: 200, signal }));
    const heard = r.json && typeof r.json.second_voice === 'boolean' ? r.json.second_voice : null;
    calls.push({ job: 'child_test.sa_second_voice', model, cost: r.cost == null ? null : Math.round(r.cost * 1e5) / 1e5, seconds: round1(r.seconds || 0), error: r.error || null, second_voice: heard, who: (r.json && r.json.who) || null });
    return { key, heard };
  } catch (e) {
    calls.push({ job: 'child_test.sa_second_voice', model, cost: null, seconds: 0, error: (e && e.reason) || 'model_failed' });
    return { key, heard: null };
  }
}

let LETTERS_SCHEMA_CACHE = null;
function LETTERS_SCHEMA() {
  if (!LETTERS_SCHEMA_CACHE) {
    const s = require('../scoring/tasks/prompts').LETTERS_SCHEMA; // eslint-disable-line global-require
    LETTERS_SCHEMA_CACHE = { ...s, name: 'sa_letters' };
  }
  return LETTERS_SCHEMA_CACHE;
}

/** The passage a questions task follows: ur.story_comp_w3 → ur.story_w3, ur.story_comp → ur.story. */
const passageOf = (block) => String(block || '').replace('_comp', '');

/**
 * EGRA's first row (sa_stop_rules) for a letters / words grid that carries no stop of its own, only when the grid is
 * longer than the window (10 letters / 5 words). The short RDF tasks (5 letters, 4 words) are always finished, so a 0
 * there is "all wrong", not "stopped early" (panel G-12 §4); timed maths has no stop rule.
 */
function withFirstRow(task, rec) {
  if (task.kind !== 'grid' || (rec.stop || {}).type || !Array.isArray(rec.grid) || !rec.grid.length) return rec;
  if (!/^(ur|en)\./.test(String(task.task || ''))) return rec;
  const row = /letter/.test(task.subtask || task.task) ? 10 : 5;
  if (rec.grid.length <= row) return rec;
  return { ...rec, stop: { type: 'first_row', n: row } };
}

// RWP's comprehension gate (G-12 §3): the questions are asked only if the passage was read to at least this many words
const COMP_MIN_WORDS = 10;
const SUMS = ['ma.add2i', 'ma.sub2i'];
const MUL = 'ma.mul2i';

/**
 * Questions after a passage that failed RWP's gate (stopped on its first line, or fewer than 10 words attempted): not
 * asked by EGRA, so not reached, 0, flagged with why.
 */
function notReached(rec, res, why = 'first_line') {
  const all = rec.questions || [];
  const asked = res && Array.isArray(res.asked) && res.asked.length ? res.asked : all.map((q) => q.id);
  const qs = asked.map((id) => all.find((q) => q.id === id)).filter(Boolean);
  const rows = qs.map((q, k) => ({ i: k + 1, id: q.id, verdict: 'not_reached', heard: '', conf: null, stop_rule: true }));
  return { numbers: { correct: 0, of: rows.length }, rows, stopped: true, stopDetail: 'comprehension', why, asked: 0 };
}

/** A passage that fails RWP's comprehension gate: why, or null when the questions count. */
function compGate(passage) {
  if (!passage) return null;
  if (passage.stopped) return 'first_line';
  return Number.isFinite(passage.attempted) && passage.attempted < COMP_MIN_WORDS ? 'under_10_words' : null;
}

/** × after no right + / − answer (G-12 §2): the raw marks stay in detail; the score is 0, each item not reached. */
function gateMul(out) {
  const raw = { ...out.numbers };
  const rows = out.rows.map((r) => ({ ...r, raw_verdict: r.verdict, verdict: 'not_reached', stop_rule: true, gated: true }));
  return { ...out, numbers: { ...out.numbers, correct: 0 }, rows, stopDetail: 'multiplication', gated: true, raw };
}

/**
 * One SA task's row → marks. { ok: true, marks } | { ok: false, reason, retry }.
 * `wait` (not an error): a questions task whose clips are still arriving.
 */
async function scoreRow(row, session, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const res = resultOf(row);
  // A W3 task (w3: true in the bank) is scored from the battery the phone ran: its items carry show + answer.
  const byBank = specFor(d.bank, session, row);
  const found = (byBank && !isW3(d.bank, session, row) ? byBank : null) || phoneSpecFor(session, row, d.phoneBattery) || byBank;
  if (!found) return { ok: false, reason: 'task_not_in_bank', retry: true };
  const { spec: task, variant } = found;
  const stops = d.stopRules === true;
  const rec = stops ? withFirstRow(task, task.record || {}) : (task.record || {});
  const passage = stops && Array.isArray(rec.questions) && session.passages ? session.passages.get(passageOf(row.block)) : null;
  const calls = [];
  const started = Date.now();
  // the second-voice check runs beside the scoring, one per clip the scorer fetched
  const voices = voiceOn() ? [] : null;
  if (voices) {
    const fetch = d.clipOf;
    d.clipOf = async (key, signal) => { const clip = await fetch(key, signal); voices.push(voiceOf(d, calls, clip, key)); return clip; };
    // a section recording is cut per item for the marks; the voice check hears it whole, once
    const cut = d.sliceOf;
    if (cut) {
      d.sliceOf = async (key, windows, signal) => {
        const clips = await cut(key, windows, signal);
        voices.push(fetch(key, signal).then((clip) => voiceOf(d, calls, clip, key), () => ({ key, heard: null })));
        return clips;
      };
    }
  }
  try {
    let out;
    const gate = compGate(passage);   // null unless sa_stop_rules
    if (gate) out = notReached(rec, res, gate);
    else if (task.kind === 'grid') out = await scoreGrid(task, rec, row, res, d, calls, Number(session.grade) || 3);
    else if (task.kind === 'passage') out = await scorePassage(task, rec, row, res, d, calls);
    else if (task.kind === 'oral' && !Array.isArray(rec.questions)) out = await scoreOral(task, rec, row, res, d, calls);
    else if (Array.isArray(rec.questions)) out = await scoreQuestions(task, rec, row, res, d, calls);
    else return { ok: false, reason: 'no_scorer_for_kind', retry: false };
    if (stops && row.block === MUL && session.sums && session.sums.known && !session.sums.right) out = gateMul(out);
    const confidence = mean(out.rows.map((r) => r.conf));
    const mutes = out.rows.filter((r) => r.no_speech).length;
    const heard = voices ? await Promise.all(voices) : null;
    if (heard) {
      const flagged = new Set(heard.filter((v) => v.heard === true).map((v) => v.key));
      const byItem = keysOf(row);
      out.rows.forEach((r) => {
        const k = byItem.find((x) => x.i === r.id);
        if (k ? flagged.has(k.key) : flagged.has(row.audio_r2_key)) r.second_voice = true;
      });
    }
    return {
      ok: true,
      marks: {
        version: VERSION,
        task: row.block,
        ...out.numbers,
        detail: {
          kind: task.kind,
          subtask: task.subtask || null,
          variant,
          stopped_by_rule: !!out.stopped,
          ...(stops && out.stopDetail ? { stop_detail: out.stopDetail } : {}),
          ...(stops && out.why ? { stop_why: out.why } : {}),
          ...(stops && out.gated ? { gated: true, raw: out.raw } : {}),
          ...(stops && Array.isArray(rec.questions) ? { of_all: rec.questions.length, of_asked: out.asked ?? out.rows.length } : {}),
          ...(out.tapped != null ? { last_word_tapped: out.tapped } : {}),
          ...(out.section ? { section: true } : {}),
          confidence,
          ...(heard ? { second_voice: heard.some((v) => v.heard === true), second_voice_clips: heard.filter((v) => v.heard === true).length, second_voice_checked: heard.filter((v) => v.heard !== null).length } : {}),
          ...(gateOn() ? { confidence_band: mutes ? 'low' : band(confidence), no_speech: mutes > 0 && mutes === out.rows.length, no_speech_items: mutes } : {}),
          items: out.rows,
        },
        model_versions: { counts: d.model() },
        meta: { seconds: round1((Date.now() - started) / 1000), cost_usd: Math.round(calls.reduce((a, c) => a + (Number(c.cost) || 0), 0) * 1e5) / 1e5, calls },
      },
    };
  } catch (e) {
    return { ok: false, reason: (e && e.reason) || 'internal_error', retry: true, detail: String((e && e.message) || '').slice(0, 200), calls };
  }
}

/** A questions task is ready once every asked item has its clip, or its session has ended a while ago. */
function ready(row, session, nowMs) {
  const res = resultOf(row);
  if (!res) return false;
  // sa_stop_rules: questions wait for their passage's marks (a passage stopped on line 1 means they were not reached)
  // a row never waits on itself: only a `_comp` names another block (its passage)
  const own = passageOf(row.block) === row.block;
  const passage = !own && session.stopRules === true && session.passages ? session.passages.get(passageOf(row.block)) : null;
  if (passage && passage.pending) return false;
  // sa_stop_rules: × waits for the + / − marks (none right means × is not counted)
  if (session.stopRules === true && row.block === MUL && session.sums && session.sums.pending) return false;
  if (!['oral'].includes(row.response_mode) || row.audio_r2_key) return true;
  const asked = Array.isArray(res.asked) ? res.asked : [];
  const keys = keysOf(row);
  if (asked.length && asked.every((id) => keys.some((k) => k.i === id))) return true;
  const quiet = clipWaitMs();
  const touched = Date.parse(row.updated_at || '') || 0;
  if (quiet != null && touched > 0) return nowMs - touched > quiet;
  const ended = Date.parse(session.finished_at || session.client_finished_at || '') || Date.parse(row.updated_at || '') || 0;
  return ended > 0 && nowMs - ended > WAIT_FOR_CLIPS_MS;
}

function attemptOf(reason, prefix = RETRY) {
  const m = new RegExp(`^${prefix}(\\d+)$`).exec(String(reason || ''));
  return m ? Number(m[1]) : 0;
}
const bankBackoffMs = (n) => Math.min(2 ** (n - 1), 60) * 60 * 1000;
/** How long a row at wait n has waited in all (the backoffs 1..n). */
const bankWaitedMs = (n) => { let t = 0; for (let k = 1; k <= n; k += 1) t += bankBackoffMs(k); return t; };

// ------------------------------------------------------------------ the database side

function db() { return require('../../../config/supabase'); } // eslint-disable-line global-require

const COLS = 'id, session_id, block, response_mode, responses, audio_r2_key, audio_r2_keys, ai_status, ai_reason, ai_marks, updated_at';

async function candidates({ sessionId = null, now = new Date(), supabase = db(), afterBoot = false } = {}) {
  let q = supabase.from('child_test_blocks').select(COLS).is('ai_marks', null).eq('ai_status', 'failed').like('ai_reason', 'final:sa_%')
    .gte('updated_at', new Date(now.getTime() - sinceHours() * 3600 * 1000).toISOString())
    .order('updated_at', { ascending: true }).limit(50);
  if (sessionId) q = q.eq('session_id', sessionId);
  const { data, error } = await q;
  if (error) { logError('child_test.sa_score.scan_failed', { error: error.message }); return []; }
  const nowMs = now.getTime();
  return (data || []).filter((r) => {
    if (!TASK_RE.test(String(r.block || '')) || !hasAudio(r)) return false;
    if (envOf(r.audio_r2_key || (keysOf(r)[0] || {}).key) !== ownEnv()) return false;
    if (r.ai_reason === PARKED || r.ai_reason.startsWith(RETRY)) return true;
    if (r.ai_reason.startsWith(WAIT_BANK)) return nowMs - Date.parse(r.updated_at || 0) >= bankBackoffMs(attemptOf(r.ai_reason, WAIT_BANK));
    if (!r.ai_reason.startsWith(SCORING) || r.ai_reason === MINE) return false;
    return afterBoot || nowMs - Date.parse(r.updated_at || 0) > STALE_CLAIM_MS;
  });
}

/** Every question id the phone asked in this session: which passage variant the child read. */
async function askedOf(sessionId, supabase) {
  const { data } = await supabase.from('child_test_blocks').select('responses').eq('session_id', sessionId);
  return (data || []).flatMap((r) => { const res = resultOf(r); return res && Array.isArray(res.asked) ? res.asked : []; });
}

/**
 * sa_stop_rules: each recorded passage of the session → { stopped (its marks say the first-line rule stopped it),
 * pending (parked or being scored: no marks yet) }. A passage that failed for good is neither. Passages only: a
 * scored row by its marks' kind, an unscored one by having a questions row (`<passage>_comp…`) in the session. Every
 * other parked row in this map made each row wait on its own marks, so nothing was ever scored.
 */
async function passagesOf(sessionId, supabase) {
  const { data } = await supabase.from('child_test_blocks').select('block, ai_marks, ai_status, ai_reason').eq('session_id', sessionId);
  const out = new Map();
  const followed = new Set((data || []).map((r) => r.block).filter((b) => passageOf(b) !== b).map(passageOf));
  for (const r of data || []) {
    const m = r.ai_marks;
    const kind = m && m.detail ? m.detail.kind : null;
    if (m ? kind !== 'passage' : !followed.has(r.block)) continue;
    const reason = String(r.ai_reason || '');
    const pending = !m && reason.startsWith('final:sa_') && !reason.startsWith(FAILED);
    if (m || pending) out.set(r.block, { stopped: Boolean(m && m.detail.stopped_by_rule), pending, attempted: m && Number.isFinite(Number(m.attempted)) ? Number(m.attempted) : null });
  }
  return out;
}

/**
 * sa_stop_rules: the session's + / − rows (ma.add2i, ma.sub2i) → { known (the child took them and they have marks or
 * are being scored), pending (one still has no marks), right (any item right) }. Failed for good: not known.
 */
async function sumsOf(sessionId, supabase) {
  const { data } = await supabase.from('child_test_blocks').select('block, ai_marks, ai_status, ai_reason').eq('session_id', sessionId);
  const rows = (data || []).filter((r) => SUMS.includes(r.block));
  const live = rows.filter((r) => r.ai_marks || (String(r.ai_reason || '').startsWith('final:sa_') && !String(r.ai_reason).startsWith(FAILED)));
  return {
    known: live.length > 0,
    pending: live.some((r) => !r.ai_marks),
    right: live.some((r) => r.ai_marks && Number(r.ai_marks.correct) > 0),
  };
}

/** Compare-and-set on ai_reason: one process scores one row. */
async function claim(row, supabase = db()) {
  const { data, error } = await supabase.from('child_test_blocks').update({ ai_reason: MINE, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('ai_status', 'failed').eq('ai_reason', row.ai_reason).is('ai_marks', null).select('id');
  if (error) { logError('child_test.sa_score.claim_failed', { block: row.block, error: error.message }); return false; }
  return Array.isArray(data) && data.length === 1;
}

function finishPatch(row, got) {
  if (got.ok) return { ai_marks: got.marks, ai_status: 'scored', ai_reason: null, ai_scored_at: new Date().toISOString() };
  if (got.retry && got.reason === 'task_not_in_bank') {
    const waited = attemptOf(row.ai_reason, WAIT_BANK);
    if (bankWaitedMs(waited) >= BANK_CAP_MS) return { ai_reason: `${FAILED}${got.reason}` };
    return { ai_reason: `${WAIT_BANK}${waited + 1}`, updated_at: new Date().toISOString() };   // the backoff runs from now
  }
  const n = attemptOf(row.ai_reason) + 1;
  return { ai_reason: got.retry && n < MAX_ATTEMPTS ? `${RETRY}${n}` : `${FAILED}${got.reason}` };
}

async function finish(row, got, supabase = db()) {
  const patch = finishPatch(row, got);
  const { error } = await supabase.from('child_test_blocks').update(patch).eq('id', row.id).eq('ai_reason', MINE).is('ai_marks', null);
  if (error) logError('child_test.sa_score.write_failed', { block: row.block, error: error.message });
  return !error;
}

let running = null;   // the running global sweep's token, null when none
let skipLogged = 0;

async function sweepOnce({ sessionId = null, now = new Date(), deps = {} } = {}) {
  if (!isOn()) return { skipped: 'off' };
  if (running && !sessionId) {
    if (Date.now() - skipLogged >= SKIP_LOG_MS) {
      skipLogged = Date.now();
      logToFile('child_test.sa_score.sweep_skipped', { reason: 'running', running_s: round1((Date.now() - running.at) / 1000) });
    }
    return { skipped: 'running' };
  }
  const me = { at: Date.now() };
  if (!sessionId) running = me;
  const out = { found: 0, scored: 0, failed: 0, waiting: 0 };
  const at = { stage: 'start' };
  let deadline = null;
  const late = new Promise((resolve) => {
    deadline = setTimeout(() => resolve('timeout'), limitOf(deps, 'sweep'));
    if (deadline.unref) deadline.unref();
  });
  try {
    const done = await Promise.race([sweepBody({ sessionId, now, deps, out, at }), late]);
    if (done === 'timeout') {
      // the body still runs: its claims go stale under a new token and are taken again; its late writes do not land
      MINE = `${SCORING}:${bootId()}`;
      logError('child_test.sa_score.sweep_timeout', { stage: at.stage, after_s: round1(limitOf(deps, 'sweep') / 1000), session: Boolean(sessionId), ...out });
      return { ...out, timeout: at.stage };
    }
    return out;
  } catch (e) {
    logError('child_test.sa_score.sweep_failed', { error: e.message, stage: at.stage });
    return out;
  } finally {
    clearTimeout(deadline);
    if (!sessionId && running === me) { running = null; swept = true; }
  }
}

async function sweepBody({ sessionId, now, deps, out, at }) {
  const supabase = deps.supabase || db();
  at.stage = 'switch';
  const stopRules = await stopRulesSwitch.enabled(deps);
  at.stage = 'candidates';
  const rows = await candidates({ sessionId, now, supabase, afterBoot: !swept });
  out.found = rows.length;
  const sessions = new Map();
  const claimed = [];
  for (const row of rows) {
    if (claimed.length >= PER_TICK) break;
    if (!sessions.has(row.session_id)) {
      at.stage = 'session';
      const { data } = await supabase.from('child_test_sessions').select('id, grade, form, item_bank_version, status, finished_at, client_finished_at').eq('id', row.session_id).limit(1);
      const s = (data || [])[0] || null;
      if (s) s.asked = await askedOf(row.session_id, supabase);
      if (s && stopRules) { s.stopRules = true; s.passages = await passagesOf(row.session_id, supabase); s.sums = await sumsOf(row.session_id, supabase); }
      sessions.set(row.session_id, s);
    }
    const session = sessions.get(row.session_id);
    if (!session || session.item_bank_version !== SA_MARK) continue;
    if (!ready(row, session, now.getTime())) { out.waiting += 1; continue; }
    const had = { ...row }; // the reason before the claim: the retry count lives in it
    at.stage = 'claim';
    if (!(await claim(had, supabase))) continue;
    claimed.push({ had, session });
  }
  at.stage = 'score';
  await Promise.all(claimed.map(async ({ had, session }) => {
    const got = await scoreRow(had, session, { ...deps, stopRules });
    await finish(had, got, supabase);
    if (got.ok) out.scored += 1; else out.failed += 1;
    logToFile('child_test.sa_scored', { block: had.block, ok: got.ok, reason: got.ok ? null : got.reason, cost_usd: got.ok ? got.marks.meta.cost_usd : null });
  }));
  at.stage = 'done';
  return out;
}

/** saRegister's nudge: never awaited by the caller, never throws. */
function kick(sessionId) {
  if (!isOn()) return;
  setTimeout(() => { sweepOnce({ sessionId }).catch(() => {}); }, 1500);
}

let timer = null;
function start() {
  if (!isOn() || timer) return false;
  timer = setInterval(() => { sweepOnce().catch(() => {}); }, INTERVAL_MS);
  if (timer.unref) timer.unref();
  setTimeout(() => { sweepOnce().catch(() => {}); }, 5000);
  logToFile('child_test.sa_score_sweep_started', { every_s: INTERVAL_MS / 1000, env: ownEnv() });
  return true;
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = {
  isOn, scoreRow, sweepOnce, kick, start, stop, specFor, phoneSpecFor, ready, hash,
  __internals: { sectionWindows, echoed, within, PARKED, SCORING, RETRY, FAILED, resetBoot: () => { MINE = `${SCORING}:${bootId()}`; swept = false; running = null; skipLogged = 0; }, candidates, claim, finish, finishPatch, bankBackoffMs, timedNumbers, firstRowStopped, usedSeconds, lettersPrompt, questionsPrompt },
};
