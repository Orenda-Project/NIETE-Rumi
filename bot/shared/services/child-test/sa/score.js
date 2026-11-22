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
 * sa_scoring:<process><sweep> → sa_retry:<n> (or sa_wait_bank:<n>, a task this build does not know) → the marks, or
 * sa_score_failed:<reason>), so the older recovery sweep, which
 * skips a final failure (recovery.js verdict), never takes an SA row — not on this host, not on another build sharing
 * the DB. A claim names its SWEEP (this process's id plus the sweep's own number), so the compare-and-set changes the
 * value and only that sweep writes the marks. Many sweeps run at once in one process (every register kicks one), so a
 * sweep that passes its deadline gives up only ITS OWN claims: they are taken again once stale (2 min), never at once,
 * and another sweep's marks are never touched. A row a sweep of this process still holds is never taken by another of
 * its sweeps. A restart mid-score leaves a claim behind: it is taken again after 2 min, and at once by the new
 * process's first sweep (the boot rule; never a claim this process made itself).
 * At most CHILD_TEST_SA_SCORE_MAX_INFLIGHT rows (default 24) are being scored at once in the process: a sweep stops
 * claiming at the cap and the rest stay parked for the next tick or kick (a claimed row is never queued).
 *
 * What is marked, with the printed text the child saw (the bank's task, its passage variant from the phone's own
 * rotation — sa-page.js rotate, seeded with the result's session_id):
 *   grid       letters / words, one 60-s clip: per item c / w / s (Gemini 3.8 Flash; words with the study's STORY
 *              prompt verbatim, letters with the R8 letters prompt, self-administered, sound OR name per subtask);
 *              EGRA's first-row stop; attempted to the last item reached; correct per minute on the time used
 *              (app_settings sa_r28_words_prompt ON: familiar words get their own one-at-a-time word-list prompt with
 *              EGRA's accent rule instead of STORY; the gate, rows and numbers are the same)
 *   passage    the 60-s reading: STORY prompt; attempted to the last word the child tapped (RULING #2), else the
 *              model's last word; words correct per minute on the time used
 *              (app_settings sa_r28_story_minute ON: the time used counts only when the child reached the passage's
 *              last printed line; otherwise the rate is taken over the whole minute; detail.minute says which)
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
 * A stricter voice check (app_settings sa_r26_voice_strict, OFF by default; read by the sweep): the model alone raised
 * the flag on clips where speech-to-text heard no word, and reported an adult in noise-only clips about half the time.
 * ON, the check also gives the other person's words, and the flag stands only when speech-to-text heard words in the
 * same clip and those words are among them (corroborated(); the switch's value is true, or the share of the quote
 * that must be heard, 0.2-0.9). When the first transcript cannot back the quote (no word heard, or not the quote), a
 * plain second transcript (both language hints, no classroom context) gets one chance: the usual call heard no word
 * at all on some real recordings that hold an adult clearly. No word heard in either, no words given, or words
 * neither transcript holds: the flag is cleared. Transcripts that could not be made leave the model's answer as it
 * was. The gate and the check share one speech-to-text call per clip. The quoted words are never kept (they can hold a name);
 * the call record says why the flag stood or went (voice_check). Still a flag, never a change of mark.
 *
 * Help, not support (app_settings sa_r28_voice_help, OFF by default; read by the sweep; sa/voice-help.js): a coach
 * saying "louder" or "press next" is another voice, and the flag went up on most real tests while hand checks found
 * someone helping in a few. ON (in place of the audio check and of sa_r26_voice_strict), each clip gets one plain
 * speech-to-text pass split by speaker; no word heard is none. Else a text model reads the transcript beside the task's
 * items and answers and labels it help / other_child / support / unclear / none, and only help and other_child flag,
 * when the other person's quoted words are in the transcript (else unclear). The detail adds second_voice_kind,
 * second_voice_reason (the task's own words the quote holds, in the task's spelling: an English word the transcript
 * wrote in Urdu script or spelled in Urdu letter names reads as that word), second_voice_items (the ids of the items
 * touched; a per-item clip's own item), other_voice
 * ('support' | 'unclear' | null: logged, never a flag) and voice_check: 'r28'. A clip with no word heard makes no
 * model call, and its call row's model says 'skipped_no_words'. Still a flag, never a change of mark.
 *
 * One recording per section (the phone's sa_section_recording, battery ui; OFF by default): an oral task is recorded
 * once, from Begin to its end, so an answer given early or late is never cut. Its row has one audio_r2_key, and the
 * result says rec_section: true with rec_marks [{ item_id, ask_ms, answer_ms, end_ms }] (ms from the recording's start).
 * Each item's stretch is cut from that one clip, from 1 s before its answer window opens to the next item's ask (the
 * last: 2.5 s after its screen moved on), and marked as a per-item clip is (the gate, the echo check, one item per
 * call). An item with no mark is no answer. Without usable marks the clip is scored whole. Rows without rec_section
 * are unchanged.
 *
 * The coach confirms the last word read (the phone's sa_coach_last_word; OFF by default): a passage whose result says
 * last_word_how ('confirm' | 'tap') takes words attempted from the recording, the last word the model heard read; the
 * coach's word is the cross-check (last_word_check 'differ' when they are more than one line apart). A recording with
 * no speech falls back to the coach's word, flagged. Without last_word_how the coach's tap counts (RULING #2).
 * RDF auto (round 5): the child taps and the phone sends no last_word_how; when sa_coach_last_word is on for the
 * session's coach (the sweep reads it), the recording gives the last word there too and the child's tap is the check.
 * RDF auto with no last-word step (round 7, the phone's sa_auto_no_last_word): the result says last_word_skipped and
 * the recording gives the last word whatever sa_coach_last_word says.
 */

const { logToFile, logError } = require('../../../utils/logger');
const stopRulesSwitch = require('../app/stop-rules-switch');
const coachLastWord = require('../app/coach-last-word-switch');
const variantWaitSwitch = require('../app/variant-wait-switch');
const voiceStrictSwitch = require('../app/voice-strict-switch');
const letterGateSwitch = require('../app/letter-gate-switch');
const { voiceActivity } = require('./voice-activity');
const voiceHelpSwitch = require('../app/voice-help-switch');
const VH = require('./voice-help');
const noEchoUrSwitch = require('../app/no-echo-ur-switch');
const childOnlySwitch = require('../app/child-only-answer-switch');
const ceilingSwitch = require('../app/ceiling-switch');
const mcqSwitch = require('../app/mcq-switch');
const wordsPromptSwitch = require('../app/words-prompt-switch');
const storyMinuteSwitch = require('../app/story-minute-switch');
const { ensureNoDevanagari } = require('../../../utils/devanagari-guard');
const { isSetAside } = require('./set-aside');

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
// sa_r8_variant_wait: a rotated passage waits this long for its questions row (the variant the phone showed), then guesses
const VARIANT_WAIT_MS = 10 * 60 * 1000;
const WAIT_FOR_CLIPS_MS = 2 * 60 * 1000;   // a questions task whose session ended this long ago is scored with what came
const INTERVAL_MS = 20 * 1000;
const PER_TICK = 8;   // rows claimed per tick, scored side by side: one child's spoken tasks in about a minute
const SECONDS = 60;
// Every outbound await is bounded: one model, STT or R2 call that never answered kept `running` set, and every later
// tick was skipped without a word. A timed-out call is a retry (reason 'timeout'); a sweep past its deadline clears
// `running`, logs the stage it reached and changes this process's claim token, so its abandoned claims go stale and are
// taken again like a dead process's. deps.limits (ms) overrides these in tests.
const LIMITS = { model: 60 * 1000, stt: 60 * 1000, r2: 30 * 1000, vad: 30 * 1000, sweep: 90 * 1000 };
const SKIP_LOG_MS = 60 * 1000;
const TASK_RE = /^[a-z]{2}\.[a-z0-9_]{1,40}$/;
const SECTION_LEAD_MS = 1000;   // a section stretch starts this long before the item's answer window opens
const SECTION_TAIL_MS = 2500;   // the last stretch ends this long after its screen moved on

const isOn = () => process.env.CHILD_TEST_SA_SCORER === 'on';
// this process's id; each sweep claims with its own token (PROC + the sweep's number); MINE is the token of a direct
// claim()/finish() call (no sweep); `swept` turns true after its first full sweep
const bootId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let PROC = bootId();
let sweepNo = 0;
let MINE = `${SCORING}:${PROC}0`;
let swept = false;
const nextToken = () => { sweepNo += 1; return `${SCORING}:${PROC}${sweepNo.toString(36)}`; };
const isOwn = (reason) => String(reason || '').startsWith(`${SCORING}:${PROC}`);
// the tokens of this process's sweeps still inside their deadline: their rows are never taken by another sweep here
let LIVE = new Set();
// the rows this process is scoring right now (claimed, not yet settled), one entry per row
let INFLIGHT = new Set();
// Rows scored at once in the process. An rdf_auto child records 15 tasks, and a row takes ~10-20 s (one R2 read,
// ffmpeg, one STT call, 1-N model calls, the second-voice check). 24 at once is ~70-140 rows a minute (several
// children a minute) while bounding the ffmpeg processes and vendor calls inside the process that answers the portal.
const MAX_INFLIGHT_DEFAULT = 24;
const maxInflight = () => {
  const n = Number(process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT);
  return Number.isInteger(n) && n > 0 ? n : MAX_INFLIGHT_DEFAULT;
};
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
function specFor(bank, session, row, shown = null) {
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
  if (shown && shown.from !== 'guess' && shown.id == null) return { spec: base, variant: null };
  const pinned = shown && shown.from !== 'guess' ? base.variants.findIndex((x) => x.id === shown.id) : -1;
  let v = pinned >= 0 ? base.variants[pinned] : at >= 0 ? base.variants[at] : null;
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

/** A row's language: its block's prefix, else its own lang. */
const rowLang = (row) => (/^(ur|en)\./.test(row.block) ? row.block.slice(0, 2) : (row.lang === 'en' ? 'en' : 'ur'));

const { countsTask } = require('./counts');

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
 * sa_r8_variant_wait: which rotation variant of a passage the phone showed, from what the phone left behind. The phone's
 * own word on its result wins ({ from: 'phone', id }, id null: the passage without rotation); else the passage's
 * questions row, whose asked ids name the variant ({ from: 'questions', id }); a questions row that asked nothing, or a
 * passage with no questions task, gives nothing to go on ({ from: 'guess' }: hash). undefined: its questions row has not
 * come yet (wait). null: not a passage with variants (nothing to decide).
 */
function shownVariant(session, row, load = phoneBattery) {
  const lang = rowLang(row);
  const b = load(session.grade, session.form, lang) || load(session.grade, 'A', lang);
  const tasks = (b && Array.isArray(b.tasks)) ? b.tasks : [];
  const t = tasks.find((x) => x && x.id === row.block);
  if (!t || t.kind !== 'passage' || !Array.isArray(t.variants) || !t.variants.length) return null;
  const res = resultOf(row) || {};
  if (Object.prototype.hasOwnProperty.call(res, 'variant')) {
    const id = res.variant && typeof res.variant === 'object' ? res.variant.id : res.variant;
    return { from: 'phone', id: typeof id === 'string' && id ? id : null };
  }
  const comp = tasks.find((x) => x && x.depends_on && x.depends_on.task === t.id && Array.isArray(x.variants));
  if (!comp || comp.variants.length !== t.variants.length) return { from: 'guess' };
  if (!(session.askedBy instanceof Map) || !session.askedBy.has(comp.id)) return undefined;
  const asked = session.askedBy.get(comp.id) || [];
  const at = comp.variants.findIndex((v) => (v.items || []).some((q) => asked.includes(q.id)));
  return at >= 0 ? { from: 'questions', id: t.variants[at].id } : { from: 'guess' };
}

/**
 * sa_r8_counts (round 8 item 35): the battery file is today's form and the switch is applied as it is served, so the
 * task the phone ran is the counts form when the result names an item only that form carries (a one-at-a-time cell, a
 * per-item clip, a marked answer), or reached more cells than today's form has. Else the task as it is.
 */
function ranCounts(battery, t, row) {
  const c = countsTask(battery, t);
  if (c === t || c.items.length === t.items.length) return t;
  const res = resultOf(row) || {};
  const own = new Set(t.items.map((x) => x.id));
  const seen = [].concat(
    (Array.isArray(res.cells) ? res.cells : []).map((x) => x && x.item_id),
    (Array.isArray(res.rec_marks) ? res.rec_marks : []).map((x) => x && x.item_id),
    keysOf(row).map((x) => x.i),
  ).filter((id) => typeof id === 'string');
  const more = seen.some((id) => !own.has(id)) || (Array.isArray(res.cells) && res.cells.length > t.items.length);
  return more ? c : t;
}

/**
 * sa_r28_ceiling (C-2, C-8): the base the child was SERVED, which the phone records on its result (base_n: 5 words when
 * sa_r8_counts served the spare, 4 when not); a result without it was served the committed task's base.
 */
function servedBase(t, row) {
  const res = resultOf(row) || {};
  return Number(res.base_n) > 0 ? Number(res.base_n) : Number(t.base_n);
}

/**
 * sa_r28_ceiling (C-2, C-10): the committed task keeps today's items, grid and stop and carries the extension beside
 * them (base_n, ext_items, ext_stop); the route serves items + ext_items only with the switch ON. A run whose cells go
 * past base_n (and past the counts form's own N, sa_r8_counts) ran the extended list: the task as it ran (items + ext_items, the grid rebuilt, ext_stop as its stop).
 * Any other run (every OFF run, an ON run that stopped inside today's items) is today's task, byte for byte. null: not
 * extended.
 */
function extendedOf(t, row, ran = 0) {
  const base = servedBase(t, row);
  if (!(base > 0) || !Array.isArray(t.ext_items) || !t.ext_items.length) return null;
  const res = resultOf(row) || {};
  // the phone's own base says what was served (its counts form included); else the counts form's N is inferred
  const served = Number(res.base_n) > 0;
  if (!(Array.isArray(res.cells) && res.cells.length > (served ? base : Math.max(base, ran)))) return null;
  const items = (t.items || []).concat(t.ext_items);
  const out = { ...t, items, base_n: base };
  if (Array.isArray(t.grid)) out.grid = items.map((x) => x.show);
  if (t.ext_stop) out.stop = t.ext_stop;
  return out;
}

/**
 * A task as the phone ran it (the W3 forms: letters / words / numbers / sums one at a time, the passage with its own
 * punctuation), in the bank's shape so the scorers below read one shape. The variant is the phone's rotation: the one
 * whose questions were asked in this session, else hash(the phone's session id) mod n (sa-page.js rotate).
 */
function phoneSpecFor(session, row, load = phoneBattery, shown = null) {
  const lang = rowLang(row);
  const b = load(session.grade, session.form, lang) || load(session.grade, 'A', lang);
  const tasks = (b && Array.isArray(b.tasks)) ? b.tasks : [];
  let t = tasks.find((x) => x && x.id === row.block);
  if (!t) return null;
  // the counts form (sa_r8_counts) first: a run of exactly its N cells is that form, not the extension
  const asRun = ranCounts(b, t, row);
  const extended = extendedOf(t, row, asRun.items.length);
  t = extended ? ranCounts(b, extended, row) : asRun;
  let variant = null;
  const base = shown && shown.from !== 'guess' && shown.id == null; // the phone showed the passage without rotation
  if (!base && Array.isArray(t.variants) && t.variants.length) {
    const res = resultOf(row) || {};
    const asked = Array.isArray(res.asked) && res.asked.length ? res.asked : (Array.isArray(session.asked) ? session.asked : []);
    const comp = t.kind === 'passage' ? tasks.find((x) => x && x.depends_on && x.depends_on.task === t.id && Array.isArray(x.variants)) : t;
    const pinned = shown && shown.from !== 'guess' ? t.variants.findIndex((v) => v.id === shown.id) : -1;
    let at = pinned >= 0 ? pinned : comp && comp.variants.length === t.variants.length
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
    // sa_r28_ceiling: a run past today's N items is scored on the extended list (base_n marks today's N)
    ...(extended ? { base_n: Number(t.base_n) } : {}),
    ...(Array.isArray(t.ext_items) || extended ? { extends: true } : {}),
  };
  return { spec: { task: t.id, kind: t.kind, subtask: t.subtask, lang: t.lang || row.lang || lang, present: t.present || null, record }, variant };
}

const UR_NAMES = () => require('../scoring/tasks/prompts').UR_NAMES || {}; // eslint-disable-line global-require

// sa_r28_letter_gate, the letter-SOUNDS prompt ON ("variant B"): the card without the expected answers, plus these two
// sentences (OFF, the prompt is unchanged)
const LETTER_SOUNDS_BARE = 'The clip may hold bare letter sounds (a consonant said on its own, with no vowel), which a speech-to-text engine often does not register: judge from the audio itself.';
const LETTER_SOUNDS_NO_CHILD = 'If the clip holds only noise, silence or the phone\'s own voice, and no child saying letters, return found: false and every v = "s".';
/** The R8 letters prompt; `variantB` (sa_r28_letter_gate ON, letter sounds) is the card without the expected answers. */
function lettersPrompt({ grade, lang, items, perRow, sound, answers = [], one = false, variantB = false }) {
  const ur = lang === 'ur';
  const names = ur ? UR_NAMES() : {};
  const said = (L, i) => (variantB ? '' : answers[i] || (ur && names[L]) || '');
  const card = items.map((L, i) => `${i + 1}: ${L}${said(L, i) ? ` (${said(L, i)})` : ''}`).join(' ');
  const rule = sound
    ? `the child says each letter's SOUND${ur ? ' (e.g. "بَ" for ب)' : ' (e.g. /b/ for b)'}; a letter NAME said instead of its sound is WRONG`
    : `the child says each letter's NAME${ur ? ' (e.g. الف، بے، جیم; "یے" alone is acceptable for ی and ے, "ہمزہ" for ء)' : ' (upper or lower case is the same letter)'}; a clear letter SOUND for that letter also counts`;
  return `A child in a Pakistani government school (grade ${grade}) is doing the timed ${ur ? 'Urdu' : 'English'} LETTER ${sound ? 'SOUND' : 'NAME'} task of an EGRA reading test ALONE on a phone, wearing headphones. ${one ? `The phone showed ${items.length} letters ONE AT A TIME, in this order, each for a few seconds,` : `The phone showed a card of ${items.length} letters, ${perRow} per row, read ${ur ? 'right to left' : 'left to right'} row by row,`} and recorded the child for up to 60 seconds. There is no adult in the clip; the phone's own voice may be faintly heard.${variantB ? ` ${LETTER_SOUNDS_BARE}` : ''}
Marking rules: ${rule}. A self-correction counts as correct. A letter said wrongly, or passed over while the child keeps going, is WRONG. Every position after the last letter the child reached is SKIPPED.${variantB ? ` ${LETTER_SOUNDS_NO_CHILD}` : ''}
${variantB ? 'The printed letters in order (position: letter):' : answers.length ? 'The printed letters in order (position: letter (what a correct child says)):' : `The printed card in reading order (position: letter${ur ? ' (its name)' : ''}):`}
${card}
For EVERY position 1-${items.length} return v = "c" (correct), "w" (wrong) or "s" (skipped / not reached), heard = what the child said for that letter ("" if skipped), and conf = your confidence 0-1 in that verdict. found = whether the clip contains the child saying letters from this card at all.
Return ONLY JSON: {"found": true, "last_attempted": <int>, "letters_correct": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}`;
}

// sa_r28_words_prompt: the familiar-word tasks' own prompt ("prompt C"; OFF, words keep prompts.STORY). The phone shows the
// words ONE AT A TIME, so the card is a numbered word list (the letters card shape, one word per line) and the model
// answers per position (LETTERS_SCHEMA). WORDS_ACCENT is EGRA's accent rule as psychometrics signed it, word for word.
const WORDS_SUBTASK = 'familiar_word_reading';
const WORDS_ACCENT = 'A local accent or regional pronunciation that keeps it the same word is correct (the accepted forms listed with each word count as that word); a change that makes a different word, or a letter name, is wrong.';
/** Prompt C. `accepts[k]` (an item's `accept` list, when the bank carries one) is shown beside its word as "(also: …)". */
function wordsPrompt({ grade, lang, items, accepts = [] }) {
  const also = (k) => (Array.isArray(accepts[k]) ? accepts[k].map((a) => String(a == null ? '' : a).trim()).filter(Boolean) : []);
  const card = items.map((w, k) => `${k + 1}: ${w}${also(k).length ? ` (also: ${also(k).join(', ')})` : ''}`).join('\n');
  return `A child in a Pakistani government school (grade ${grade}) is doing the timed ${lang === 'ur' ? 'Urdu' : 'English'} FAMILIAR WORDS task of an EGRA reading test on a phone, wearing headphones. The phone showed ${items.length} separate words ONE AT A TIME, in this order, each for a few seconds (a word list, not a story), and recorded the child reading each word aloud. The phone's own voice may be faintly heard; ignore it.
Marking rules: a word is correct if the child says that word. ${WORDS_ACCENT} A self-correction counts as correct. A different word, a sounded-out word never put together, or a word passed over while the child keeps going is WRONG. Every position after the last word the child reached is SKIPPED.
The printed words in order (position: word):
${card}
For EVERY position 1-${items.length} return v = "c" (correct), "w" (wrong) or "s" (skipped / not reached), heard = what the child said for that word ("" if skipped), and conf = your confidence 0-1.
Return ONLY JSON: {"found": true, "last_attempted": <int>, "letters_correct": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}`;
}

// sa_r28_no_echo_ur: the one sentence an Urdu questions prompt gains with the switch ON (OFF, the prompt is unchanged)
const NO_ECHO_UR = 'A repetition of the question, or of the phone\'s own words, is not an answer: if that is all the child says, mark it NO_ANSWER.';
/** `noEcho` (sa_r28_no_echo_ur ON) adds NO_ECHO_UR to an Urdu prompt; English is unchanged. */
function questionsPrompt({ lang, task, questions, passage, single, noEcho = false }) {
  const L = lang === 'ur' ? 'Urdu' : 'English';
  const what = task.subtask === 'phoneme_segmentation'
    ? 'says the separate SOUNDS of a word it heard (each sound on its own; the whole word is WRONG)'
    : task.kind === 'listen_questions' ? 'answers questions about a short story the phone read aloud to the child'
      : 'answers questions about a passage the child has just read on the phone';
  const ctx = passage ? `The ${task.kind === 'listen_questions' ? 'story the child heard' : 'passage'}:\n${passage}\n` : '';
  const list = questions.map((q, i) => `${i + 1}. [${q.id}] ${(q.prompt && q.prompt.text) || q.word || ''}\n   accept: ${(q.accept || []).join(' | ') || '-'}\n   reject: ${(q.reject || []).join(' | ') || '-'}\n   rubric: ${q.rubric || (q.phonemes ? `the sounds ${q.phonemes.join(' ')}` : '-')}`).join('\n');
  return `A child in a Pakistani government school (grade 1-5), alone with a phone and wearing headphones, ${what}, in an ${L} EGRA task. ${single ? 'The clip holds the child\'s answers to the questions below, in order.' : 'The clip holds the child\'s spoken answer to ONE question, the one listed.'} Judge the meaning, in any language or wording: CORRECT if it gives the right information, WRONG if it is incorrect or the child says they do not know, NO_ANSWER if nothing audible is said. Use each item's accepted and rejected answers and rubric.${noEcho && lang === 'ur' ? ` ${NO_ECHO_UR}` : ''}
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
        // said: the wrapper's speaker-labelled text, always in Urdu script; text: every word heard (it can be longer:
        // the labelled text can drop words). The stricter voice check looks for the other person's words in both.
        return { words: words.length, text: words.map((w) => w.raw).join(' '), said: r.text || '', model: r.model, cost: r.cost, seconds: r.seconds };
      } finally { media.cleanup(file); }
    },
    // sa_r28_letter_gate's voice check: the clip the model hears, as 16 kHz mono PCM
    pcmOf: (clip, signal) => require('./voice-activity').pcmOf(clip, signal),
    // sa_r26_voice_strict's second pass: both language hints, no classroom context (scoring/stt transcribePlain)
    speechPlainOf: async (clip, signal) => {
      const fs = require('fs');
      const file = media.tmpFile('mp3');
      fs.writeFileSync(file, Buffer.from(clip.base64, 'base64'));
      try {
        return await require('../scoring/stt').transcribePlain(file, clip.durationSec, { signal });
      } finally { media.cleanup(file); }
    },
    // sa_r28_voice_help: the plain pass with the speaker split, as turns the help check reads
    speechTurnsOf: async (clip, signal) => {
      const fs = require('fs');
      const file = media.tmpFile('mp3');
      fs.writeFileSync(file, Buffer.from(clip.base64, 'base64'));
      try {
        return await require('../scoring/stt').transcribePlain(file, clip.durationSec, { signal, diarize: true });
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

async function call(deps, calls, { prompt, schema, clip, job, name = null }) {
  const model = deps.model();
  let r;
  try {
    r = await bounded('model', limitOf(deps, 'model'), (signal) => deps.chatJSON({ model, prompt, schema, audio: { data: clip.base64, format: 'mp3' }, job, maxTokens: 12000, signal }));
  } catch (e) {
    calls.push({ job, model, cost: null, seconds: round1(limitOf(deps, 'model') / 1000), error: e.reason || 'model_failed', ...(name ? { prompt: name } : {}) });
    throw e;
  }
  calls.push({ job, model, cost: r.cost == null ? null : Math.round(r.cost * 1e5) / 1e5, seconds: round1(r.seconds || 0), error: r.error || null, ...(name ? { prompt: name } : {}) });
  if (!r.json) { const e = new Error('model_failed'); e.reason = 'model_failed'; throw e; }
  return r.json;
}

/**
 * The speech gate (CHILD_TEST_SA_SPEECH_GATE), as a reason: 'duration' when the clip is shorter than the minimum speech
 * duration, 'no_words' when STT hears no word in it, false when it hears some, null when it cannot say (switch off, STT
 * failed): then the model's verdicts stand as they are. Every caller mutes on any truthy reason. `heard` (when given)
 * gets what STT heard, for the echo check. `vad` (sa_r28_letter_gate, letter sounds): no STT call; an energy
 * voice-activity check on the clip (voice-activity.js) decides instead: 'no_voice' when it fails, false when it passes;
 * the call record says model 'skipped_r28' with the check's numbers, and `heard.vad` gets them. A check that cannot run
 * leaves the decision to the STT gate as before (never to the model alone).
 */
async function silent(deps, calls, clip, lang, heard = null, { vad = false } = {}) {
  if (!gateOn()) return null;
  const dur = Number(clip && clip.durationSec);
  if (Number.isFinite(dur) && dur < minSpeechS()) {
    calls.push({ job: 'child_test.sa_speech_gate', model: 'duration', cost: 0, seconds: 0, error: null, words: 0, clip_s: round1(dur) });
    return 'duration';
  }
  if (vad) {
    const clipS = Number.isFinite(dur) ? { clip_s: round1(dur) } : {};
    const t0 = Date.now();
    try {
      const pcm = await bounded('vad', limitOf(deps, 'vad'), (signal) => deps.pcmOf(clip, signal));
      const a = voiceActivity(pcm.samples, pcm.rate);
      calls.push({ job: 'child_test.sa_speech_gate', model: 'skipped_r28', cost: 0, seconds: round1((Date.now() - t0) / 1000), error: null, ...clipS, vad_voiced_ms: a.voiced_ms, vad_share: a.share, vad_floor_db: a.floor_db, vad_margin_db: a.margin_db, vad_pass: a.pass });
      if (heard) heard.vad = a;
      return a.pass ? false : 'no_voice';
    } catch (e) {
      calls.push({ job: 'child_test.sa_speech_gate', model: 'skipped_r28', cost: 0, seconds: round1((Date.now() - t0) / 1000), error: `vad_failed: ${String((e && e.message) || e).slice(0, 100)}`, ...clipS });
      if (e && e.reason === 'timeout') throw e;
    }
  }
  if (!deps.speechOf) return null;
  try {
    const s = await bounded('stt', limitOf(deps, 'stt'), (signal) => deps.speechOf(clip, lang, signal));
    calls.push({ job: 'child_test.sa_speech_gate', model: s.model || 'stt', cost: s.cost == null ? null : Math.round(s.cost * 1e5) / 1e5, seconds: round1(s.seconds || 0), error: null, words: s.words });
    if (heard && typeof s.text === 'string') heard.text = s.text;
    if (heard && Number.isInteger(s.words)) heard.words = s.words;
    return Number.isInteger(s.words) ? (s.words === 0 ? 'no_words' : false) : null;
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

/**
 * E-11 (behind the r28 switches): what a gate override leaves on the item: the clip's length and how many words STT heard
 * in it, when STT ran. The transcript itself (stt_text, cut to 80 code points) is kept ONLY where `text` is asked for: the
 * echo override, where it is the phone's own question by construction. A speech-gate mute or the model's found:false on a
 * coach-led clip never stores it (an adult's words, a child's name). The model's own answer is added by the caller
 * (raw_verdict, raw_heard).
 */
const sttNote = (heard, clip, { text = false } = {}) => ({
  ...(clip && Number.isFinite(Number(clip.durationSec)) ? { clip_s: round1(Number(clip.durationSec)) } : {}),
  ...(heard && Number.isInteger(heard.words) ? { stt_words: heard.words, ...(text ? { stt_text: Array.from(String(heard.text || '')).slice(0, 80).join('') } : {}) } : {}),
});

/**
 * Timed rows from per-position verdicts; a gap before the last reached item is wrong (EGRA: skipped = incorrect).
 * `presented` (sa_r28_ceiling, an extended grid): the cells the phone presented and counts attempted. A presented cell
 * with no answer heard is attempted and wrong (EGRA's no-response), reason 'no_response', never not_reached; a no-voice
 * mute (no_speech) stays not_reached. null (switch OFF, or a task that does not extend): today's rows.
 */
function timedRows(refs, verdictOf, { presented = null } = {}) {
  const v = refs.map((_, k) => verdictOf(k));
  let last = 0;
  v.forEach((x, k) => { if (x.verdict !== 'not_reached') last = k + 1; });
  const silentPass = (x, k) => presented != null && k < presented && x.verdict === 'not_reached' && !x.no_speech;
  return refs.map((ref, k) => ({ i: k + 1, ref, verdict: (v[k].verdict === 'not_reached' && k < last) || silentPass(v[k], k) ? 'wrong' : v[k].verdict, ...(silentPass(v[k], k) ? { reason: 'no_response' } : {}), heard: v[k].heard || '', conf: v[k].conf, ...(v[k].no_speech ? { no_speech: true } : {}), ...(v[k].gate || {}) }));
}

function firstRowStopped(rows, n) {
  if (!(n > 0) || rows.length < n) return false;
  return rows.slice(0, n).every((r) => r.verdict !== 'correct');
}

function timedNumbers(rows, res, { stopped, attemptedTo = null, pending = false, fullMinute = false }) {
  let attempted = 0;
  rows.forEach((r) => { if (r.verdict !== 'not_reached') attempted = r.i; });
  if (attemptedTo != null) attempted = attemptedTo;
  const correct = stopped ? 0 : rows.filter((r) => r.i <= attempted && r.verdict === 'correct').length;
  // sa_r28_ceiling (C-5): no phone clock → no rate until it is known, never an assumed minute
  if (pending) return { correct, attempted, per_minute: null, seconds_used: null };
  // sa_r28_story_minute: a story run that stopped before the last line is rated on the whole minute
  const used = fullMinute ? SECONDS : usedSeconds(res);
  return { correct, attempted, per_minute: correct ? round1((correct / used) * SECONDS) : 0, seconds_used: round1(used) };
}

// sa_r28_letter_gate's scope: letter SOUNDS, by subtask name, never /letter/ (letter names keep the STT gate; a future
// letter_pick recording is not letters)
const LETTER_GATE_SUBTASK = 'letter_sound_identification';

/** The phone's clock is missing (or 0): usedSeconds would assume the minute. */
const noClock = (res) => { const ms = Number(res && res.time_used_ms); return !Number.isFinite(ms) || ms <= 0; };

/**
 * sa_r28_ceiling (C-5, SPEC v2.1: every timed task): ON, no clock → no rate (rate_pending); OFF, the minute is assumed
 * as today and the marks say so (seconds_assumed). A result with its clock gets no key.
 */
const clockPending = (deps, res) => deps.ceiling === true && noClock(res);
function clockDetail(pending, res) {
  if (pending) return { rate_pending: true };
  return noClock(res) ? { seconds_assumed: true } : null;
}

/**
 * sa_r28_ceiling (C-7): a task built with base_n carries the whole published grid; the model is given the items the
 * child reached, never fewer than today's N (a run that stopped inside today's items is prompted exactly as before).
 * A task without base_n: the whole list, as today.
 */
function shownOf(rec, list, reached) {
  const base = Number(rec.base_n);
  if (!(base > 0)) return list;
  return list.slice(0, Math.max(reached == null ? list.length : reached, base));
}

/**
 * sa_r28_ceiling (C.4, C-8): what an extended run's marks add beside today's numbers. of_all: items reached;
 * of_base / correct_base: today's first N, the fixed anchor the Results ladder reads; seconds_assumed: the phone left
 * no clock and the minute was assumed. rate_pending (switch ON, C-5): no clock, so no rate. A run that did not go past
 * today's N gets no new key unless its rate is pending (its marks are today's).
 */
function ceilingDetail(rec, rows, numbers, { stopped, pending, res }) {
  const base = Number(rec.base_n);
  const extra = pending ? { rate_pending: true } : {};
  if (!(base > 0)) return clockDetail(pending, res);
  const right = (r) => !stopped && r.i <= numbers.attempted && r.verdict === 'correct';
  return {
    of_all: numbers.attempted,
    of_base: base,
    correct_base: rows.filter((r) => r.i <= base && right(r)).length,
    ...(pending ? extra : noClock(res) ? { seconds_assumed: true } : {}),
  };
}

async function scoreGrid(task, rec, row, res, deps, calls, grade, { letterGate = false, wordsC = false } = {}) {
  const grid = (rec.grid || []).map(String);
  const reached = reachedOf(task, res, grid.length);
  const items = shownOf(rec, grid, reached);
  // sa_r28_ceiling ON, an extended grid: the cells presented (the 500 ms final-cell rule already applied by reachedOf)
  const presented = deps.ceiling === true && Number(rec.base_n) > 0 && reached != null ? Math.min(reached, items.length) : null;
  const perRow = Number(rec.per_row) || 10;
  const clip = await clipOf(deps, row.audio_r2_key);
  const letters = /letter/.test(task.subtask || task.task);
  const LV = { c: 'correct', w: 'wrong', s: 'not_reached', n: 'not_reached' };
  let rows;
  // sa_r28_letter_gate ON, letter sounds: bare sounds are no word, so a voice-activity check replaces STT's word count;
  // each item carries the gate's numbers (and the mute's reason) so the cut can be re-made from the stored marks
  const r28 = letterGate === true && task.subtask === LETTER_GATE_SUBTASK;
  const heard = {};
  const mute = await silent(deps, calls, clip, task.lang, heard, { vad: r28 });
  const gate = r28 ? {
    ...(Number.isFinite(Number(clip.durationSec)) ? { clip_s: round1(Number(clip.durationSec)) } : {}),
    ...(heard.vad ? { vad_voiced_ms: heard.vad.voiced_ms, vad_share: heard.vad.share, vad_floor_db: heard.vad.floor_db, vad_margin_db: heard.vad.margin_db, vad_pass: heard.vad.pass } : {}),
  } : null;
  // E-11 (sa_r28_letter_gate ON, every other grid task): a mute keeps its reason, the clip's length and STT's words
  const note = letterGate === true && !r28 ? sttNote(heard, clip) : null;
  if (mute) rows = timedRows(items, () => (gate || note ? { ...MUTE, gate: { ...(gate || note), reason: mute } } : MUTE));
  else if (letters) {
    const json = await call(deps, calls, { prompt: lettersPrompt({ grade, lang: task.lang, items, perRow, sound: /sound/.test(task.subtask || task.task), answers: rec.answers || [], one: task.present === 'one_at_a_time', variantB: r28 }), schema: LETTERS_SCHEMA(), clip, job: 'child_test.sa_letters' });
    const by = new Map((json.items || []).map((it, j) => [Number(it.i) || j + 1, it]));
    // E-11: the model's own found:false overrides its marks; ON, each item keeps the model's verdict and what it heard,
    // under its own reason ('found_false': the third mute cause beside 'duration' and 'no_voice' / 'no_words')
    const raw = (k) => { const it = by.get(k + 1) || {}; return { raw_verdict: LV[it.v] || 'not_reached', raw_heard: String(it.heard || '') }; };
    rows = gateOn() && json.found === false ? timedRows(items, (k) => (letterGate === true ? { ...MUTE, gate: { ...(gate || note), reason: 'found_false', ...raw(k) } } : MUTE))
      : timedRows(items, (k) => { const it = by.get(k + 1) || {}; return { verdict: LV[it.v] || 'not_reached', heard: String(it.heard || ''), conf: conf01(it.conf), ...(gate ? { gate } : {}) }; }, { presented });
  } else if (wordsC === true && task.subtask === WORDS_SUBTASK) {
    // sa_r28_words_prompt ON: prompt C, per-position answers; the same job (cost / precision series), the prompt named
    const accepts = items.map((_, k) => ((rec.items || [])[k] || {}).accept);
    const json = await call(deps, calls, { prompt: wordsPrompt({ grade, lang: task.lang, items, accepts }), schema: LETTERS_SCHEMA(), clip, job: 'child_test.sa_words', name: 'words_c' });
    const by = new Map((json.items || []).map((it, j) => [Number(it.i) || j + 1, it]));
    rows = timedRows(items, (k) => { const it = by.get(k + 1) || {}; return { verdict: LV[it.v] || 'not_reached', heard: String(it.heard || ''), conf: conf01(it.conf) }; }, { presented });
  } else {
    rows = await storyRows(items, task.lang, clip, deps, calls, 'child_test.sa_words', { presented });
  }
  const stopped = (rec.stop || {}).type === 'first_row' && firstRowStopped(rows, Number(rec.stop.n) || perRow);
  const pending = clockPending(deps, res);
  const numbers = timedNumbers(rows, res, { stopped, attemptedTo: reached == null ? null : Math.min(reached, items.length), pending });
  return { numbers, rows, stopped, durationSec: clip.durationSec, ceiling: ceilingDetail(rec, rows, numbers, { stopped, pending, res }), ...(r28 ? { letterGate: true } : {}) };
}

// sa_r28_ceiling (C-7, red team C9): a final cell on show for less than this at time up was presented, not attempted
const SHORT_LAST_MS = 500;

/**
 * The phone left its final cell out of what was attempted (sa_r28_ceiling: closed by the clock under 500 ms, so its
 * last_item_index names the cell before it, null when it was the first). The phone's own word decides, so the
 * scorer's attempted always equals the phone's; a phone without the rule names the final cell, as today.
 */
function shortLast(res) {
  const c = res.cells[res.cells.length - 1];
  if (!c || c.how !== 'time_up' || !(Number(c.ms) < SHORT_LAST_MS)) return false;
  if (!Object.prototype.hasOwnProperty.call(res, 'last_item_index')) return false;
  return res.last_item_index !== c.i;
}

/** One item at a time: the phone knows the last cell the child reached (cells[] / last_item_index). */
function reachedOf(task, res, n) {
  if (task.present !== 'one_at_a_time' || !res) return null;
  if (Array.isArray(res.cells) && res.cells.length) return Math.min(n, res.cells.length - (shortLast(res) ? 1 : 0));
  return Number.isInteger(res.last_item_index) ? Math.min(n, res.last_item_index + 1) : null;
}

// sa_r28_child_only_answer: the one sentence the spoken-maths prompt gains with the switch ON (OFF, unchanged). An answer
// that follows an adult's SUPPORT ("louder", "next") keeps its credit; only a number another person said, or a change to
// it, is discounted, and the item is then marked from what the child said before (the ladder reads as a human grader's).
const CHILD_ONLY = 'Mark only the child\'s own answer for each item (a self-correction by the child counts). Ignore every other speaker, adult or child: a number said by another person is never the child\'s answer, and a number the child repeats or changes to after another person has said it is not either; mark such an item from what the child said before the other person spoke ("w" if a different number, "s" if nothing). Other words from another person (instructions, encouragement) do not change the mark.';
/** `childOnly` (sa_r28_child_only_answer ON) adds CHILD_ONLY after the phone's-voice sentence. */
function oralPrompt({ lang, task, items, one, childOnly = false }) {
  const what = /fluency/.test(task.subtask || '') ? 'quick sums, as many as it can in one minute'
    : /number_id/.test(task.subtask || '') ? 'the NAME of each number shown (e.g. "forty-five" / «پینتالیس» for 45)'
      : 'the answer to each sum shown, worked out in its head';
  const list = items.map((x, i) => `${i + 1}: shown "${x.show}" → correct answer ${x.answer}`).join('\n');
  return `A child in a Pakistani government school (grade 3-5), alone with a phone and wearing headphones, is doing an EGMA maths task: it says aloud ${what}. ${one ? 'The phone showed the items ONE AT A TIME, in this order.' : 'The phone showed the items in this order.'} The child may answer in Urdu, English or a mix (e.g. «انیس», "nineteen", "unees"); judge the NUMBER said. The phone's own voice may be faintly heard; ignore it.${childOnly ? ` ${CHILD_ONLY}` : ''}
Marking rules: "c" if the child's final answer for that item is the correct number (a self-correction counts), "w" if it says a different number or "I don't know", "s" if it never reached the item or said nothing for it.
ITEMS (position: what was shown → the correct answer):
${list}
For EVERY position 1-${items.length} return v = "c", "w" or "s", heard = the number the child said ("" if none), conf = your confidence 0-1.
Return ONLY JSON: {"found": true, "last_attempted": <int>, "letters_correct": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}`;
}

/** Spoken maths (W3: number identification, mental + − ×, one-minute fluency): one clip for the task, or one per item. */
async function scoreOral(task, rec, row, res, deps, calls, { childOnlyAnswer = false, letterGate = false } = {}) {
  const list = rec.items || [];
  const reached = reachedOf(task, res, list.length);
  const items = shownOf(rec, list, reached);
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
    const heard = {};
    const mute = await silent(deps, calls, clip, task.lang, heard);
    // E-11 (sa_r28_letter_gate ON): an override keeps its reason, the clip's length, STT's words and the model's answer
    const note = letterGate === true ? sttNote(heard, clip) : null;
    if (mute) { p.at.forEach((k) => got.set(k, { mute: true, ...(note ? { gate: { ...note, reason: mute } } : {}) })); continue; }
    const json = await call(deps, calls, { prompt: oralPrompt({ lang: task.lang, task, items: p.list, one, childOnly: childOnlyAnswer === true }), schema: LETTERS_SCHEMA(), clip, job: 'child_test.sa_oral_maths' });
    const by = new Map((json.items || []).map((it, j) => [Number(it.i) || j + 1, it]));
    const none = gateOn() && json.found === false;
    p.at.forEach((k, j) => {
      const it = by.get(j + 1) || {};
      got.set(k, none ? { mute: true, ...(note ? { gate: { ...note, reason: 'found_false', raw_verdict: LV[it.v] || 'not_reached', raw_heard: String(it.heard || '') } } : {}) } : it);
    });
  }
  const rows = timedRows(items.map((x) => String(x.show)), (k) => { const it = got.get(k) || {}; return it.mute ? (it.gate ? { ...MUTE, gate: it.gate } : MUTE) : { verdict: LV[it.v] || 'not_reached', heard: String(it.heard || ''), conf: conf01(it.conf) }; });
  rows.forEach((r, k) => { r.id = items[k].id; r.answer = items[k].answer; });
  const timed = Number(rec.time_limit_s) > 0;
  const attemptedTo = reached == null ? null : Math.min(reached, items.length);
  const pending = timed && clockPending(deps, res);
  const numbers = timed ? timedNumbers(rows, res, { stopped: false, attemptedTo, pending })
    : { correct: rows.filter((r) => r.verdict === 'correct').length, of: rows.length };
  const ceiling = timed ? ceilingDetail(rec, rows, numbers, { stopped: false, pending, res }) : null;
  return { numbers, rows, stopped: false, durationSec, section: Boolean(section), ceiling };
}

async function storyRows(tokens, lang, clip, deps, calls, job, { presented = null } = {}) {
  /* eslint-disable global-require */
  const prompts = require('../scoring/prompts');
  const { verdictsFrom } = require('../scoring/story');
  /* eslint-enable global-require */
  const json = await call(deps, calls, { prompt: prompts.STORY({ lang: lang === 'ur' ? 'urdu' : 'english', tokens }), schema: prompts.STORY_SCHEMA, clip, job });
  const v = verdictsFrom(json, tokens.length);
  const VV = { correct: 'correct', wrong: 'wrong', skipped: 'not_reached' };
  return timedRows(tokens, (k) => ({ verdict: VV[v[k]] || 'not_reached', heard: '', conf: null }), { presented });
}

async function scorePassage(task, rec, row, res, deps, calls, { letterGate = false, storyMinute = false } = {}) {
  const p = rec.passage || {};
  const tokens = Array.isArray(p.words) && p.words.length ? p.words.map((w) => String(w.target)) : String(p.text || '').split(/\s+/).filter(Boolean);
  const clip = await clipOf(deps, row.audio_r2_key);
  const heard = {};
  const mute = await silent(deps, calls, clip, task.lang, heard);
  // E-11 (sa_r28_letter_gate ON): a mute keeps its reason, the clip's length and STT's words
  const note = mute && letterGate === true ? { ...sttNote(heard, clip), reason: mute } : null;
  const rows = mute ? timedRows(tokens, () => (note ? { ...MUTE, gate: note } : MUTE))
    : await storyRows(tokens, task.lang, clip, deps, calls, 'child_test.sa_story');
  // RULING #2: the child taps the last word read; words after it were not attempted
  const tapped = res && Number.isInteger(res.last_word_index) ? Math.min(tokens.length, res.last_word_index + 1) : null;
  const line1 = (p.lines || [])[0];
  const stopped = (rec.stop || {}).type === 'first_line' && line1 ? firstRowStopped(rows, line1.to - line1.from + 1) : false;
  // the coach's word (RDF manual: last_word_how) or, with sa_coach_last_word on, the child's tap (RDF auto) is the check;
  // RDF auto with no last-word step (the phone's sa_auto_no_last_word: last_word_skipped) has only the recording
  const fromRecording = deps.lastWordFromRecording === true || (res && res.last_word_skipped === true);
  const tapper = res && typeof res.last_word_how === 'string' ? 'coach' : fromRecording ? 'child' : null;
  const lastWord = tapper ? lastWordOf(rows, tapped, p.lines, tapper) : null;
  const attemptedTo = lastWord ? lastWord.attempted : tapped;
  const pending = clockPending(deps, res);
  let numbers = timedNumbers(rows, res, { stopped, attemptedTo, pending });
  const minute = storyMinute === true ? minuteOf(numbers, res, p.lines, tokens.length, { stopped, pending }) : null;
  // a time-up run already used the minute: its clock stands, exactly as before
  if (minute === 'full_60' && res.stop_reason !== 'time_up') numbers = timedNumbers(rows, res, { stopped, attemptedTo, pending, fullMinute: true });
  const clock = clockDetail(pending, res);
  return { numbers, rows, stopped, durationSec: clip.durationSec, tapped, lastWord, ceiling: minute ? { ...(clock || {}), minute } : clock };
}

/**
 * sa_r28_story_minute: the first word (1-based) of the passage's last printed line, from the variant's own line table
 * ({ from, to } word ranges, 0-based). Without a table, the convention lastWordOf uses: 10 words a line.
 */
function lastLineStart(lines, n) {
  const last = Array.isArray(lines) && lines.length ? lines[lines.length - 1] : null;
  if (last && Number.isInteger(last.from) && last.from >= 0) return last.from + 1;
  return n > 0 ? Math.floor((n - 1) / 10) * 10 + 1 : 1;
}

/**
 * sa_r28_story_minute: which minute a story run is rated on. 'last_line_reached': the scorer's attempted count reaches
 * the last line's first word, or the phone's last-word index (0-based) does; the phone's clock is used.
 * 'full_60': neither does, so the rate is taken over the whole minute. null (no stamp, nothing changes): a run without a
 * rate (the clock pending, or no clock at all), a first-line stop (by the phone or by the scorer: no words count).
 * A time-up run keeps its clock, which is the minute, and is stamped 'full_60'.
 */
function minuteOf(numbers, res, lines, n, { stopped, pending }) {
  const why = res && res.stop_reason;
  if (pending || noClock(res) || stopped || why === 'early_stop_first_line') return null;
  if (why === 'time_up') return 'full_60';
  const L = lastLineStart(lines, n);
  const tappedTo = res && Number.isInteger(res.last_word_index) ? res.last_word_index : -1;
  return numbers.attempted >= L || tappedTo >= L - 1 ? 'last_line_reached' : 'full_60';
}

/**
 * sa_coach_last_word: the last word read, from the recording (the model's last word not "not reached"); the tapped
 * word (the coach's, or the child's in RDF auto: `tapper`) is the cross-check. A recording with no speech uses the
 * tapped word. 'differ' when the two are more than one line apart (lines: the passage's { from, to } word ranges,
 * 0-based; without them, 10 words a line).
 */
function lastWordOf(rows, tapped, lines, tapper = 'coach') {
  let heard = 0;
  rows.forEach((r) => { if (r.verdict !== 'not_reached') heard = r.i; });
  const mute = rows.length > 0 && rows.every((r) => r.no_speech);
  const lineOf = (n) => {
    if (!(n > 0)) return 0;
    const at = (lines || []).findIndex((l) => n - 1 >= l.from && n - 1 <= l.to);
    return at >= 0 ? at + 1 : Math.ceil(n / 10);
  };
  const differ = tapped == null ? false : (mute ? heard !== tapped : Math.abs(lineOf(heard) - lineOf(tapped)) > 1);
  const useCoach = mute && tapped != null;
  return { attempted: useCoach ? tapped : heard, heard, source: useCoach ? tapper : 'recording', check: tapped == null ? null : differ ? 'differ' : 'agree' };
}

async function scoreQuestions(task, rec, row, res, deps, calls, { noEchoUr = false, letterGate = false } = {}) {
  // sa_r28_no_echo_ur ON, an Urdu task: no echo check (the prompt asks the model to judge a repeated question)
  const noEcho = noEchoUr === true && task.lang === 'ur';
  const echo = (q, g, text) => !noEcho && echoed(q, g, text);
  // E-11: a mute (sa_r28_letter_gate ON) or an echo zero (sa_r28_no_echo_ur ON) keeps what was overridden
  const muteNote = (why, stt, clip) => (letterGate === true ? { gate: { ...sttNote(stt, clip), reason: why } } : {});
  const echoNote = (g, stt, clip) => (noEchoUr === true ? { gate: { raw_verdict: g.verdict, raw_heard: String(g.answer || ''), ...sttNote(stt, clip, { text: true }) } } : {});
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
      const why = await silent(deps, calls, clip, task.lang, stt);
      if (why) { marked.set(q.id, { mute: true, ...muteNote(why, stt, clip) }); continue; }
      const json = await call(deps, calls, { prompt: questionsPrompt({ lang: task.lang, task, questions: [q], passage, single: false, noEcho }), schema: QUESTIONS_SCHEMA, clip, job: 'child_test.sa_questions' });
      const got = (json.questions || [])[0];
      if (got) marked.set(q.id, echo(q, got, stt.text) ? { mute: true, echo: true, ...echoNote(got, stt, clip) } : got);
    }
  } else if (row.audio_r2_key) {
    const clip = await clipOf(deps, row.audio_r2_key);
    const stt = {};
    const why = await silent(deps, calls, clip, task.lang, stt);
    if (why) qs.forEach((q) => marked.set(q.id, { mute: true, ...muteNote(why, stt, clip) }));
    else {
      const json = await call(deps, calls, { prompt: questionsPrompt({ lang: task.lang, task, questions: qs, passage, single: true, noEcho }), schema: QUESTIONS_SCHEMA, clip, job: 'child_test.sa_questions' });
      for (const g of json.questions || []) {
        const q = qs.find((x) => x.id === g.id);
        marked.set(g.id, q && echo(q, g, stt.text) ? { mute: true, echo: true, ...echoNote(g, stt, clip) } : g);
      }
    }
  }
  const rows = qs.map((q, k) => {
    const g = marked.get(q.id);
    const clip = keys.some((x) => x.i === q.id) || Boolean(row.audio_r2_key);
    if (g && g.mute) return { i: k + 1, id: q.id, verdict: 'no_answer', heard: '', conf: 0, no_speech: true, clip, ...(g.echo ? { echo: true } : {}), ...(g.gate || {}) };
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

// The reply is three fields, but a thinking model spends its budget reasoning first: at 200 tokens about half the prod
// checks ended before any JSON (no_json). The cap leaves room for that; the reply itself stays small.
const VOICE_MAX_TOKENS = 2000;

// sa_r26_voice_strict: the same question, and the other person's words as heard, so the transcript can back them up
const VOICE_STRICT_SCHEMA = {
  name: 'sa_second_voice',
  schema: {
    ...VOICE_SCHEMA.schema,
    required: [...VOICE_SCHEMA.schema.required, 'words'],
    properties: { ...VOICE_SCHEMA.schema.properties, words: { type: 'string' } },
  },
};
const VOICE_STRICT_PROMPT = `${VOICE_PROMPT.slice(0, VOICE_PROMPT.indexOf('\nReturn ONLY JSON:'))}
If another person is heard, also give THAT person's words exactly as heard, in the script they were spoken in (Urdu in Urdu script, English in English letters). Only words you can actually make out; not the tested child's answers, not the phone's own voice. "" if you cannot make out any.
Return ONLY JSON: {"second_voice": true|false, "who": "adult|child|unsure|none", "confidence": <0-1>, "words": "<the other person's words, or \\"\\">"}`;

// the default share of the quote's character pairs that must be in what speech-to-text heard in the same clip (the
// switch can set another, 0.2-0.9). Set on replays of 48 hand-checked real recordings: a quote of words the child alone
// said, or of words nobody said, reached at most 0.32 (two replays); real adult prompting mostly 0.6-1.0. With the plain
// second pass, 0.4 kept no false alarm and 14-16 of 16 real adults; 0.35 kept 15-16 with no false alarm but only 0.03
// above the highest; 0.3 kept all 16 and let one false alarm back.
const QUOTE_MIN = 0.4;
// sa_r28_voice_help: the model copies its quote from the transcript it was given, so it must be there almost whole
// (replays over 311 hand-labelled transcripts: the true help quotes all matched at 0.6 and above)
const HELP_QUOTE_MIN = 0.6;

/**
 * sa_r26_voice_strict: do the other person's words, as the model gave them, stand in what speech-to-text heard in the
 * same clip? { ok: true | false | null (cannot tell: no transcript), why }. Both sides in Urdu script (a Devanagari
 * quote or transcript is written in Urdu first), letters only, as the echo check compares.
 */
function corroborated(quote, stt, min = QUOTE_MIN) {
  if (!stt || !Number.isInteger(stt.words)) return { ok: null, why: 'stt_unavailable' };
  if (stt.words === 0) return { ok: false, why: 'no_words' };
  const q = ensureNoDevanagari(String(quote || ''));
  if (bare(q).length < 2) return { ok: false, why: 'not_corroborated' };
  // the labelled text and the plain word list: the labelled text can drop words, the word list can be Devanagari
  const heard = [stt.said, stt.text].filter((t) => typeof t === 'string' && t).map((t) => ensureNoDevanagari(t));
  return heard.some((h) => within(q, h) >= min) ? { ok: true, why: 'words_heard' } : { ok: false, why: 'not_corroborated' };
}

/**
 * The first transcript could not back the quote: a second, plain transcript (both language hints, no classroom
 * context) gets one chance. It can only keep a flag the model raised, never raise one; a failed second pass leaves the
 * first verdict as it was.
 */
function withSecondPass(quote, first, second, min = QUOTE_MIN) {
  if (!second || !Number.isInteger(second.words)) return first;
  const c2 = corroborated(quote, second, min);
  if (c2.ok === true) return { ok: true, why: 'words_heard_second' };
  if (first.ok === null) return c2;                       // the first pass failed: the second one decides
  if (first.why === 'no_words' && c2.why === 'not_corroborated') return c2;   // words now, just not the quote
  return first;
}

/**
 * CHILD_TEST_SA_SECOND_VOICE: is another person heard in this clip? { key, heard: true | false | null (not checked) }.
 * strict (sa_r26_voice_strict): a "yes" stands only when corroborated() says so; `speech` gives the clip's transcript
 * (the one the speech gate made, when it made one), `speechPlain` the plain second pass, asked only when the first
 * transcript cannot back a quote. The quote itself is never kept.
 */
async function voiceOf(deps, calls, clip, key, { strict = false, speech = null, speechPlain = null, min = QUOTE_MIN } = {}) {
  const dur = Number(clip && clip.durationSec);
  if (Number.isFinite(dur) && dur < minSpeechS()) return { key, heard: false };
  const model = deps.model();
  let r;
  try {
    r = await bounded('model', limitOf(deps, 'model'), (signal) => deps.chatJSON({ model, prompt: strict ? VOICE_STRICT_PROMPT : VOICE_PROMPT, schema: strict ? VOICE_STRICT_SCHEMA : VOICE_SCHEMA, audio: { data: clip.base64, format: 'mp3', key }, job: 'child_test.sa_second_voice', maxTokens: VOICE_MAX_TOKENS, signal }));
  } catch (e) {
    calls.push({ job: 'child_test.sa_second_voice', model, cost: null, seconds: 0, error: (e && e.reason) || 'model_failed' });
    return { key, heard: null };
  }
  const said = r.json && typeof r.json.second_voice === 'boolean' ? r.json.second_voice : null;
  const rec = { job: 'child_test.sa_second_voice', model, cost: r.cost == null ? null : Math.round(r.cost * 1e5) / 1e5, seconds: round1(r.seconds || 0), error: r.error || null, second_voice: said, who: (r.json && r.json.who) || null, ...(r.detail ? { detail: r.detail } : {}) };
  calls.push(rec);
  if (!strict || said !== true) return { key, heard: said };
  let stt = null;
  try { stt = speech ? await speech() : null; } catch (_) { stt = null; }
  let c = corroborated(r.json.words, stt, min);
  if (stt && Number.isInteger(stt.words)) rec.stt_words = stt.words;
  if (c.ok !== true && speechPlain && bare(ensureNoDevanagari(String(r.json.words || ''))).length >= 2) {
    let plain = null;
    try { plain = await speechPlain(); } catch (_) { plain = null; }
    rec.stt2_words = plain && Number.isInteger(plain.words) ? plain.words : null;
    c = withSecondPass(r.json.words, c, plain, min);
  }
  rec.model_second_voice = true;
  rec.voice_check = c.why;
  if (c.ok === false) rec.second_voice = false;
  return { key, heard: rec.second_voice };
}

/**
 * sa_r28_voice_help: did anyone but the child HELP in this clip? { key, heard: true | false | null (not checked),
 * label, kind, reason }. One plain diarized transcript; no word heard: none, no model call. Else a text model labels
 * the transcript beside the task (sa/voice-help.js); help / other_child stand only when their quote is in the
 * transcript. The call record keeps the label, kind and why, never the quote.
 */
async function voiceHelpOf(deps, calls, clip, key, { task, turns } = {}) {
  const dur = Number(clip && clip.durationSec);
  if (Number.isFinite(dur) && dur < minSpeechS()) return { key, heard: false, label: 'none' };
  const model = deps.model();
  const rec = { job: 'child_test.sa_second_voice', model, cost: null, seconds: 0, error: null, voice_check: null, label: null };
  let tx;
  try {
    tx = await turns();
  } catch (e) {
    calls.push({ ...rec, error: (e && e.reason) || 'stt_failed' });
    return { key, heard: null };
  }
  rec.stt_words = tx && Number.isInteger(tx.words) ? tx.words : null;
  if (tx && Number.isFinite(tx.cost)) rec.stt_cost = tx.cost;
  if (!tx || !tx.words) {
    // no model was called: the row says so rather than naming one
    calls.push({ ...rec, model: 'skipped_no_words', label: 'none', second_voice: false, voice_check: 'no_words' });
    return { key, heard: false, label: 'none' };
  }
  let r;
  try {
    r = await bounded('model', limitOf(deps, 'model'), (signal) => deps.chatJSON({ model, prompt: VH.promptOf(task, tx.turns || tx.text), schema: VH.SCHEMA, job: 'child_test.sa_second_voice', maxTokens: VOICE_MAX_TOKENS, signal }));
  } catch (e) {
    calls.push({ ...rec, error: (e && e.reason) || 'model_failed' });
    return { key, heard: null };
  }
  const heardText = [tx.turns, tx.text].filter((t) => typeof t === 'string' && t).map((t) => ensureNoDevanagari(t));
  const quoteHeard = (q) => bare(ensureNoDevanagari(q)).length >= 2 && heardText.some((h) => within(ensureNoDevanagari(q), h) >= HELP_QUOTE_MIN);
  const d = VH.decide(r.json, quoteHeard);
  Object.assign(rec, { cost: r.cost == null ? null : Math.round(r.cost * 1e5) / 1e5, seconds: round1(r.seconds || 0), error: r.error || null, ...(r.detail ? { detail: r.detail } : {}), label: d.label, kind: d.kind || null, who: (r.json && r.json.who) || null, second_voice: d.flag, voice_check: d.why });
  calls.push(rec);
  if (d.flag === null) return { key, heard: null };
  if (!d.flag) return { key, heard: false, label: d.label, kind: d.kind, reason: '' };
  // the reason is the item's own word when the quote points at one (in the task's spelling, also from another
  // script), else the task's words the quote holds
  const hit = VH.matchedItems(r.json.evidence, task);
  const reason = hit.items.length ? hit.words : (VH.matchedWords(r.json.evidence, task) || hit.words);
  return { key, heard: true, label: d.label, kind: d.kind, reason: VH.tidy(reason), items: hit.items };
}

let LETTERS_SCHEMA_CACHE = null;
function LETTERS_SCHEMA() {
  if (!LETTERS_SCHEMA_CACHE) {
    const s = require('../scoring/tasks/prompts').LETTERS_SCHEMA; // eslint-disable-line global-require
    LETTERS_SCHEMA_CACHE = { ...s, name: 'sa_letters' };
  }
  return LETTERS_SCHEMA_CACHE;
}

/**
 * The passage a questions task follows: ur.story_comp_w3 → ur.story_w3, ur.story_comp → ur.story; sa_r28_mcq: the
 * story's questions picked from four follow it too (ur.story_mcq_w3 → ur.story_w3).
 */
const passageOf = (block) => String(block || '').replace(/_(comp|mcq)/, '');
/** sa_r28_mcq: the story's questions picked from four (a tap task the phone counts; only served with the switch ON). */
const isMcq = (block) => /_mcq/.test(String(block || ''));

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
 * sa_r28_mcq: the story's questions picked from four take the oral questions' reading floor. Their marks are the
 * phone's count (sa-store.js phoneMarks), written here once the passage's marks are known so the gate can be applied:
 *   gated (compGate: 'first_line' | 'under_10_words'): not reached, 0 of the questions, as the oral questions; the
 *     phone's answers kept whole in detail.raw and per question in raw_verdict ('correct' | 'wrong')
 *   passed: the phone's marks stand, with gate_checked: true and stop_why: null (checked, not gated)
 *   no passage marks (none recorded, or failed for good): the phone's marks stand, gate_checked: false
 *   unrated (too few questions presented): the phone's marks, never gated (an unrated part is absent from the ladder)
 */
function mcqMarks(row, session) {
  const res = resultOf(row) || {};
  const phone = require('../sa-store').phoneMarks({ ...res, mode: 'tap' }); // eslint-disable-line global-require
  const answers = (row.responses || []).filter((x) => x && x.kind === 'answer').map(({ kind, ...a }) => a); // eslint-disable-line no-unused-vars
  const ofAll = Number.isFinite(res.of_all) ? res.of_all : null;
  const of = ofAll === null ? null : Math.max(0, ofAll - (Number(res.unavailable) || 0));
  const asked = Array.isArray(res.asked) ? res.asked.filter((q) => typeof q === 'string') : [];
  const base = { version: VERSION, task: row.block };
  if (res.unrated === true) return { ...base, ...phone, detail: { kind: 'mcq', unrated: true, of_all: ofAll } };
  const passage = session.passages ? session.passages.get(passageOf(row.block)) : null;
  const known = Boolean(passage) && !passage.pending;
  const why = known ? compGate(passage) : null;
  if (!why) {
    return { ...base, correct: phone.tap_correct, of, ...phone, detail: { kind: 'mcq', stopped_by_rule: false, gate_checked: known, stop_why: null, of_all: ofAll, of_asked: asked.length } };
  }
  const verdictOf = (id) => { const a = answers.find((x) => x.item_id === id); return a ? (a.ok === true ? 'correct' : 'wrong') : null; };
  return {
    ...base,
    correct: 0,
    of,
    tap_correct: 0,
    tap_attempted: phone.tap_attempted,
    options_n: phone.options_n,
    chance_corrected: phone.chance_corrected === null ? null : 0,
    stop_reason: phone.stop_reason,
    detail: {
      kind: 'mcq',
      stopped_by_rule: true,
      stop_detail: 'comprehension',
      stop_why: why,
      gated: true,
      of_all: ofAll,
      of_asked: 0,
      items: asked.map((id, k) => ({ i: k + 1, id, verdict: 'not_reached', heard: '', conf: null, stop_rule: true, gated: true, raw_verdict: verdictOf(id) })),
      raw: { tap_correct: phone.tap_correct, tap_attempted: phone.tap_attempted, answers },
    },
  };
}

/**
 * sa_r28_voice_help's fields beside second_voice: the first flagged clip's kind ('help' | 'other_child') and its matched
 * item words; second_voice_items the ids of the items the help touched (every flagged clip; [] when the quote names
 * none); other_voice the strongest non-flag label heard ('unclear' over 'support'; null when none); voice_check.
 */
function helpDetail(heard, byItem = []) {
  const flagged = heard.find((v) => v.heard === true);
  const rest = heard.filter((v) => v.heard === false).map((v) => v.label);
  // the items the help touched: a per-item clip's own item, else the items its quote names
  const items = [...new Set(heard.filter((v) => v.heard === true).flatMap((v) => {
    const own = byItem.find((x) => x.key === v.key);
    return own && typeof own.i === 'string' ? [own.i] : (v.items || []);
  }))];
  return {
    ...(flagged ? { second_voice_kind: flagged.label === 'other_child' ? 'other_child' : 'help', second_voice_reason: flagged.reason || '', second_voice_items: items } : {}),
    other_voice: rest.includes('unclear') ? 'unclear' : rest.includes('support') ? 'support' : null,
    voice_check: 'r28',
  };
}

/**
 * One SA task's row → marks. { ok: true, marks } | { ok: false, reason, retry }.
 * `wait` (not an error): a questions task whose clips are still arriving.
 */
async function scoreRow(row, session, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const res = resultOf(row);
  // sa_r28_mcq: the questions picked from four are the phone's count through the oral questions' reading floor
  if (isMcq(row.block) && res && res.mode === 'tap') return { ok: true, marks: { ...mcqMarks(row, session), meta: { seconds: 0, cost_usd: 0, calls: [] } } };
  // A W3 task (w3: true in the bank) is scored from the battery the phone ran: its items carry show + answer.
  // sa_r8_variant_wait: the variant the phone showed, when it left word of it (null: the switch is off or no variants)
  const shown = session.variantWait === true ? shownVariant(session, row, d.phoneBattery) : null;
  const byBank = specFor(d.bank, session, row, shown);
  const found = (byBank && !isW3(d.bank, session, row) ? byBank : null) || phoneSpecFor(session, row, d.phoneBattery, shown) || byBank;
  if (!found) return { ok: false, reason: 'task_not_in_bank', retry: true };
  const { spec: task, variant } = found;
  const stops = d.stopRules === true;
  const rec = stops ? withFirstRow(task, task.record || {}) : (task.record || {});
  const passage = stops && Array.isArray(rec.questions) && session.passages ? session.passages.get(passageOf(row.block)) : null;
  const calls = [];
  const started = Date.now();
  // the second-voice check runs beside the scoring, one per clip the scorer fetched
  const voices = voiceOn() ? [] : null;
  // sa_r26_voice_strict: a "yes" needs the other person's words in the clip's transcript. The speech gate and the
  // check share one speech-to-text call per clip (the gate's, when it ran; else the check makes its own).
  // the switch's value: true (the default bar) or a number from 0.2 to 0.9 (that bar)
  const strictValue = voiceStrictSwitch.valueOf(d.voiceStrict);
  // sa_r28_letter_gate (the sweep reads the setting; true only)
  const letterGate = letterGateSwitch.valueOf(d.letterGate);
  // sa_r28_voice_help: help, not support; it takes the place of the audio check and of the stricter one
  const help = Boolean(voices) && voiceHelpSwitch.valueOf(d.voiceHelp) && Boolean(d.speechTurnsOf);
  // sa_r28_no_echo_ur (the sweep reads the setting; true only)
  const noEchoUr = noEchoUrSwitch.valueOf(d.noEchoUr);
  // sa_r28_child_only_answer (the sweep reads the setting; true only)
  const childOnlyAnswer = childOnlySwitch.valueOf(d.childOnlyAnswer);
  // sa_r28_words_prompt (the sweep reads the setting; true only)
  const wordsC = wordsPromptSwitch.valueOf(d.wordsPrompt);
  // sa_r28_story_minute (the sweep reads the setting; true only)
  const storyMinute = storyMinuteSwitch.valueOf(d.storyMinute);
  const strict = Boolean(voices) && !help && strictValue !== false;
  if (strict && d.speechOf) {
    const heard = new WeakMap();
    const stt = d.speechOf;
    d.speechOf = (clip, lang, signal) => { if (!heard.has(clip)) heard.set(clip, stt(clip, lang, signal)); return heard.get(clip); };
  }
  const voiceOpts = (clip) => (strict
    ? {
      strict: true,
      min: typeof strictValue === 'number' ? strictValue : QUOTE_MIN,
      speech: d.speechOf ? () => bounded('stt', limitOf(d, 'stt'), (signal) => d.speechOf(clip, task.lang, signal)) : null,
      speechPlain: d.speechPlainOf ? () => bounded('stt', limitOf(d, 'stt'), (signal) => d.speechPlainOf(clip, signal)) : null,
    }
    : {});
  if (voices) {
    const fetch = d.clipOf;
    const check = (clip, key) => (help
      ? voiceHelpOf(d, calls, clip, key, { task, turns: () => bounded('stt', limitOf(d, 'stt'), (signal) => d.speechTurnsOf(clip, signal)) })
      : voiceOf(d, calls, clip, key, voiceOpts(clip)));
    d.clipOf = async (key, signal) => { const clip = await fetch(key, signal); voices.push(check(clip, key)); return clip; };
    // a section recording is cut per item for the marks; the voice check hears it whole, once
    const cut = d.sliceOf;
    if (cut) {
      d.sliceOf = async (key, windows, signal) => {
        const clips = await cut(key, windows, signal);
        voices.push(fetch(key, signal).then((clip) => check(clip, key), () => ({ key, heard: null })));
        return clips;
      };
    }
  }
  try {
    let out;
    const gate = compGate(passage);   // null unless sa_stop_rules
    if (gate) out = notReached(rec, res, gate);
    else if (task.kind === 'grid') out = await scoreGrid(task, rec, row, res, d, calls, Number(session.grade) || 3, { letterGate, wordsC });
    else if (task.kind === 'passage') out = await scorePassage(task, rec, row, res, d, calls, { letterGate, storyMinute });
    else if (task.kind === 'oral' && !Array.isArray(rec.questions)) out = await scoreOral(task, rec, row, res, d, calls, { childOnlyAnswer, letterGate });
    else if (Array.isArray(rec.questions)) out = await scoreQuestions(task, rec, row, res, d, calls, { noEchoUr, letterGate });
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
          ...(shown !== null ? { variant_from: shown ? shown.from : 'guess' } : {}),
          stopped_by_rule: !!out.stopped,
          ...(stops && out.stopDetail ? { stop_detail: out.stopDetail } : {}),
          ...(stops && out.why ? { stop_why: out.why } : {}),
          ...(stops && out.gated ? { gated: true, raw: out.raw } : {}),
          ...(stops && Array.isArray(rec.questions) ? { of_all: rec.questions.length, of_asked: out.asked ?? out.rows.length } : {}),
          ...(out.tapped != null ? { last_word_tapped: out.tapped } : {}),
          ...(out.lastWord ? { last_word_source: out.lastWord.source, last_word_heard: out.lastWord.heard, ...(out.lastWord.check ? { last_word_check: out.lastWord.check } : {}) } : {}),
          ...(out.section ? { section: true } : {}),
          ...(out.letterGate ? { letter_gate: 'r28' } : {}),
          ...(out.ceiling || {}),
          confidence,
          ...(heard ? { second_voice: heard.some((v) => v.heard === true), second_voice_clips: heard.filter((v) => v.heard === true).length, second_voice_checked: heard.filter((v) => v.heard !== null).length } : {}),
          ...(heard && help ? helpDetail(heard, keysOf(row)) : {}),
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
  // a row never waits on itself: only a `_comp` (or, sa_r28_mcq, an `_mcq`) names another block (its passage)
  const own = passageOf(row.block) === row.block;
  // sa_r28_mcq: the questions picked from four wait for their passage's marks too (the reading floor is applied on them)
  const waits = session.stopRules === true || (session.mcqFloor === true && isMcq(row.block));
  const passage = !own && waits && session.passages ? session.passages.get(passageOf(row.block)) : null;
  if (passage && passage.pending) {
    // sa_r28_mcq: a passage whose recording never came (not parked) is awaited only until a while after the LATER of the
    // session's end and this row's own arrival (an offline session synced hours later still waits from its sync)
    const ended = Date.parse(session.finished_at || session.client_finished_at || '') || 0;
    const anchor = ended > 0 ? Math.max(ended, Date.parse(row.updated_at || '') || 0) : 0;
    if (!(passage.unparked && anchor > 0 && nowMs - anchor > WAIT_FOR_CLIPS_MS)) return false;
  }
  // sa_r8_variant_wait: a rotated passage waits for its questions row (the variant the phone showed), not past the
  // session's end or VARIANT_WAIT_MS
  if (session.variantWait === true && own && shownVariant(session, row) === undefined) {
    const ended = Date.parse(session.finished_at || session.client_finished_at || '') || 0;
    const touched = Date.parse(row.updated_at || '') || 0;
    if (!ended && !(touched > 0 && nowMs - touched > VARIANT_WAIT_MS)) return false;
  }
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
    // sa_r28_mcq: the questions picked from four have no recording (a tap task); the store parks them for the floor only
    // with the switch ON, so a parked one is admitted whatever the switch reads now (a flip to OFF never strands it)
    const tapMcq = isMcq(r.block) && !hasAudio(r);
    if (!TASK_RE.test(String(r.block || '')) || !(hasAudio(r) || tapMcq)) return false;
    if (!tapMcq && envOf(r.audio_r2_key || (keysOf(r)[0] || {}).key) !== ownEnv()) return false;
    if (r.ai_reason === PARKED || r.ai_reason.startsWith(RETRY)) return true;
    if (r.ai_reason.startsWith(WAIT_BANK)) return nowMs - Date.parse(r.updated_at || 0) >= bankBackoffMs(attemptOf(r.ai_reason, WAIT_BANK));
    if (!r.ai_reason.startsWith(SCORING) || LIVE.has(r.ai_reason) || r.ai_reason === MINE) return false;
    // the boot rule takes another process's claim at once; this process's own (a sweep that gave up) only once stale
    return (afterBoot && !isOwn(r.ai_reason)) || nowMs - Date.parse(r.updated_at || 0) > STALE_CLAIM_MS;
  });
}

/** Every question id the phone asked in this session: which passage variant the child read. */
async function askedOf(sessionId, supabase) {
  return [...(await askedByOf(sessionId, supabase)).values()].flat();
}

/** The same, by block: each row's asked ids ([] for a row that asked nothing), so a passage finds its own questions row. */
async function askedByOf(sessionId, supabase) {
  const { data } = await supabase.from('child_test_blocks').select('block, responses').eq('session_id', sessionId);
  const out = new Map();
  // round 7b: a restarted child's ended attempt (set aside) may have read another variant
  for (const r of (data || []).filter((x) => !isSetAside(x.block))) {
    const res = resultOf(r);
    out.set(r.block, [...(out.get(r.block) || []), ...(res && Array.isArray(res.asked) ? res.asked : [])]);
  }
  return out;
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
  // sa_r28_mcq: the passages a questions-picked-from-four row follows
  const byMcq = new Set((data || []).map((r) => r.block).filter(isMcq).map(passageOf));
  for (const r of data || []) {
    const m = r.ai_marks;
    const kind = m && m.detail ? m.detail.kind : null;
    if (m ? kind !== 'passage' : !followed.has(r.block)) continue;
    const reason = String(r.ai_reason || '');
    const pending = !m && reason.startsWith('final:sa_') && !reason.startsWith(FAILED);
    // sa_r28_mcq: an MCQ's passage is awaited before its recording has arrived too (not parked yet), so the MCQ is
    // never marked ahead of the marks its floor reads; ready() bounds that wait by the session's end
    const unparked = !m && !pending && byMcq.has(r.block) && !reason.startsWith(FAILED) && r.ai_status !== 'failed';
    if (m || pending || unparked) out.set(r.block, { stopped: Boolean(m && m.detail.stopped_by_rule), pending: pending || unparked, attempted: m && Number.isFinite(Number(m.attempted)) ? Number(m.attempted) : null, ...(unparked ? { unparked: true } : {}) });
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

/** Compare-and-set on ai_reason: one sweep scores one row (`token`: the sweep's own; MINE for a direct call). */
async function claim(row, supabase = db(), token = MINE) {
  const { data, error } = await supabase.from('child_test_blocks').update({ ai_reason: token, updated_at: new Date().toISOString() })
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

/** The marks, written only while the row still carries the token it was claimed with (`token`; MINE for a direct call). */
async function finish(row, got, supabase = db(), token = MINE) {
  const patch = finishPatch(row, got);
  const { error } = await supabase.from('child_test_blocks').update(patch).eq('id', row.id).eq('ai_reason', token).is('ai_marks', null);
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
  // this sweep's own claim token: a sweep that gives up never touches another sweep's claims or marks
  const ctx = { token: nextToken(), abandoned: false, live: LIVE };
  ctx.live.add(ctx.token);
  const out = { found: 0, scored: 0, failed: 0, waiting: 0 };
  const at = { stage: 'start' };
  let deadline = null;
  const late = new Promise((resolve) => {
    deadline = setTimeout(() => resolve('timeout'), limitOf(deps, 'sweep'));
    if (deadline.unref) deadline.unref();
  });
  try {
    const done = await Promise.race([sweepBody({ sessionId, now, deps, out, at, ctx }), late]);
    if (done === 'timeout') {
      // the body still runs: it claims nothing more, its late writes do not land, and its claims (this sweep's token
      // only) are taken again once stale; every other sweep's claims and marks are untouched
      ctx.abandoned = true;
      ctx.live.delete(ctx.token);
      logError('child_test.sa_score.sweep_timeout', { stage: at.stage, after_s: round1(limitOf(deps, 'sweep') / 1000), session: Boolean(sessionId), ...out });
      return { ...out, timeout: at.stage };
    }
    return out;
  } catch (e) {
    logError('child_test.sa_score.sweep_failed', { error: e.message, stage: at.stage });
    return out;
  } finally {
    clearTimeout(deadline);
    ctx.live.delete(ctx.token);
    if (!sessionId && running === me) { running = null; swept = true; }
  }
}

async function sweepBody({ sessionId, now, deps, out, at, ctx }) {
  const supabase = deps.supabase || db();
  at.stage = 'switch';
  const stopRules = await stopRulesSwitch.enabled(deps);
  const variantWait = await variantWaitSwitch.enabled(deps);
  const voiceStrict = await voiceStrictSwitch.enabled(deps);
  const letterGate = await letterGateSwitch.enabled(deps);
  const voiceHelp = await voiceHelpSwitch.enabled(deps);
  const noEchoUr = await noEchoUrSwitch.enabled(deps);
  const childOnlyAnswer = await childOnlySwitch.enabled(deps);
  const ceiling = await ceilingSwitch.enabled(deps);
  const mcqFloor = await mcqSwitch.enabled(deps);
  const wordsPromptOn = await wordsPromptSwitch.enabled(deps);
  const storyMinuteOn = await storyMinuteSwitch.enabled(deps);
  at.stage = 'candidates';
  const rows = await candidates({ sessionId, now, supabase, afterBoot: !swept });
  out.found = rows.length;
  const sessions = new Map();
  const claimed = [];
  const slots = INFLIGHT;
  for (const row of rows) {
    if (claimed.length >= PER_TICK || ctx.abandoned) break;
    if (slots.size >= maxInflight()) { out.capped = true; break; }
    if (!sessions.has(row.session_id)) {
      at.stage = 'session';
      const { data } = await supabase.from('child_test_sessions').select('id, grade, form, item_bank_version, status, finished_at, client_finished_at, coach_user_id').eq('id', row.session_id).limit(1);
      const s = (data || [])[0] || null;
      if (s) { s.askedBy = await askedByOf(row.session_id, supabase); s.asked = [...s.askedBy.values()].flat(); s.variantWait = variantWait; }
      if (s) s.lastWordFromRecording = await coachLastWord.enabled(deps, s.coach_user_id || null, supabase);
      if (s && stopRules) { s.stopRules = true; s.passages = await passagesOf(row.session_id, supabase); s.sums = await sumsOf(row.session_id, supabase); }
      // sa_r28_mcq: the questions picked from four read their passage's marks (the reading floor), stop rules or not; a
      // parked MCQ row in the queue is proof the switch was ON at its sync, so its session waits the same way
      const parkedMcq = rows.some((r) => r.session_id === row.session_id && isMcq(r.block) && !hasAudio(r));
      if (s && (mcqFloor || parkedMcq)) { s.mcqFloor = true; if (!s.passages) s.passages = await passagesOf(row.session_id, supabase); }
      sessions.set(row.session_id, s);
    }
    const session = sessions.get(row.session_id);
    if (!session || session.item_bank_version !== SA_MARK) continue;
    if (!ready(row, session, now.getTime())) { out.waiting += 1; continue; }
    const had = { ...row }; // the reason before the claim: the retry count lives in it
    at.stage = 'claim';
    // the slot is taken before the claim's await, so two sweeps cannot both pass the cap
    if (ctx.abandoned) break;
    if (slots.size >= maxInflight()) { out.capped = true; break; }
    const slot = { block: had.block };
    slots.add(slot);
    let won = false;
    try { won = await claim(had, supabase, ctx.token); } finally { if (!won) slots.delete(slot); }
    if (!won) continue;
    claimed.push({ had, session, slot });
  }
  at.stage = 'score';
  await Promise.all(claimed.map(async ({ had, session, slot }) => {
    try {
      const got = await scoreRow(had, session, { ...deps, stopRules, voiceStrict, letterGate, voiceHelp, lastWordFromRecording: session.lastWordFromRecording === true, noEchoUr, childOnlyAnswer, ceiling, wordsPrompt: wordsPromptOn, storyMinute: storyMinuteOn });
      if (ctx.abandoned) {
        // this sweep gave up at its deadline: the row is taken again once its claim is stale
        logToFile('child_test.sa_score.late_result_dropped', { block: had.block, ok: got.ok }, 'warn');
        return;
      }
      await finish(had, got, supabase, ctx.token);
      if (got.ok) out.scored += 1; else out.failed += 1;
      logToFile('child_test.sa_scored', { block: had.block, ok: got.ok, reason: got.ok ? null : got.reason, cost_usd: got.ok ? got.marks.meta.cost_usd : null });
    } finally {
      slots.delete(slot);
    }
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
  __internals: { askedOf, askedByOf, shownVariant, sectionWindows, echoed, within, PARKED, SCORING, RETRY, FAILED, resetBoot: () => { PROC = bootId(); sweepNo = 0; MINE = `${SCORING}:${PROC}0`; LIVE = new Set(); INFLIGHT = new Set(); swept = false; running = null; skipLogged = 0; }, maxInflight, candidates, claim, finish, finishPatch, bankBackoffMs, timedNumbers, firstRowStopped, usedSeconds, lettersPrompt, LETTER_SOUNDS_BARE, LETTER_SOUNDS_NO_CHILD, silent, questionsPrompt, voiceOf, voiceHelpOf, corroborated, keysOf, defaultDeps, NO_ECHO_UR, oralPrompt, CHILD_ONLY, reachedOf, shownOf, extendedOf, passageOf, passagesOf, mcqMarks, wordsPrompt, WORDS_ACCENT, lastLineStart, minuteOf },
};
