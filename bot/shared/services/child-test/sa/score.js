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
 * sa_scoring → sa_retry:<n> → the marks, or sa_score_failed:<reason>), so the older recovery sweep, which skips a
 * final failure (recovery.js verdict), never takes an SA row — not on this host, not on another build sharing the DB.
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
 * Numbers at the top of the marks are what the results page shows (sa-api.service numbersOf); the rest is nested.
 * No prompt carries a name: item text and audio only.
 */

const { logToFile, logError } = require('../../../utils/logger');

const PARKED = 'final:sa_score_later';
const SCORING = 'final:sa_scoring';
const RETRY = 'final:sa_retry:';
const FAILED = 'final:sa_score_failed:';
const VERSION = 'sa-marks-v1';
const SA_MARK = 'sa-battery';
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 5 * 60 * 1000;
const WAIT_FOR_CLIPS_MS = 2 * 60 * 1000;   // a questions task whose session ended this long ago is scored with what came
const INTERVAL_MS = 20 * 1000;
const PER_TICK = 4;
const SECONDS = 60;
const TASK_RE = /^[a-z]{2}\.[a-z0-9_]{1,40}$/;

const isOn = () => process.env.CHILD_TEST_SA_SCORER === 'on';
const sinceHours = () => Number(process.env.CHILD_TEST_SA_SCORER_SINCE_H) || 48;
const ownEnv = () => process.env.CHILD_TEST_R2_ENV || process.env.RAILWAY_ENVIRONMENT || 'local';
const envOf = (key) => { const m = /^child-test\/([^/]+)\//.exec(String(key || '')); return m ? m[1] : null; };
const round1 = (x) => Math.round(x * 10) / 10;
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

const UR_NAMES = () => require('../scoring/tasks/prompts').UR_NAMES || {}; // eslint-disable-line global-require

function lettersPrompt({ grade, lang, items, perRow, sound }) {
  const ur = lang === 'ur';
  const names = ur ? UR_NAMES() : {};
  const card = items.map((L, i) => `${i + 1}: ${L}${ur && names[L] ? ` (${names[L]})` : ''}`).join(' ');
  const rule = sound
    ? `the child says each letter's SOUND${ur ? ' (e.g. "بَ" for ب)' : ' (e.g. /b/ for b)'}; a letter NAME said instead of its sound is WRONG`
    : `the child says each letter's NAME${ur ? ' (e.g. الف، بے، جیم; "یے" alone is acceptable for ی and ے, "ہمزہ" for ء)' : ' (upper or lower case is the same letter)'}; a clear letter SOUND for that letter also counts`;
  return `A child in a Pakistani government school (grade ${grade}) is doing the timed ${ur ? 'Urdu' : 'English'} LETTER ${sound ? 'SOUND' : 'NAME'} task of an EGRA reading test ALONE on a phone, wearing headphones. The phone showed a card of ${items.length} letters, ${perRow} per row, read ${ur ? 'right to left' : 'left to right'} row by row, and recorded the child for up to 60 seconds. There is no adult in the clip; the phone's own voice may be faintly heard.
Marking rules: ${rule}. A self-correction counts as correct. A letter said wrongly, or passed over while the child keeps going, is WRONG. Every position after the last letter the child reached is SKIPPED.
The printed card in reading order (position: letter${ur ? ' (its name)' : ''}):
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
    clipOf: async (key) => {
      const file = await media.downloadToTemp(key, 'webm');
      try {
        const dur = (await media.probeDuration(file)) || (await media.decodedDuration(file)) || SECONDS + 5;
        const clip = await media.cutClip(file, 0, dur, 'mp3');
        media.cleanup(clip.path);
        return { base64: clip.base64, durationSec: dur };
      } finally { media.cleanup(file); }
    },
    bank: loadBank(),
  };
  /* eslint-enable global-require */
}

/** The time the child used, seconds (the phone's clock), 1–60. */
function usedSeconds(res) {
  const ms = Number(res && res.time_used_ms);
  if (!Number.isFinite(ms) || ms <= 0) return SECONDS;
  return Math.max(1, Math.min(SECONDS, ms / 1000));
}

async function call(deps, calls, { prompt, schema, clip, job }) {
  const model = deps.model();
  const r = await deps.chatJSON({ model, prompt, schema, audio: { data: clip.base64, format: 'mp3' }, job, maxTokens: 12000 });
  calls.push({ job, model, cost: r.cost == null ? null : Math.round(r.cost * 1e5) / 1e5, seconds: round1(r.seconds || 0), error: r.error || null });
  if (!r.json) { const e = new Error('model_failed'); e.reason = 'model_failed'; throw e; }
  return r.json;
}

/** Timed rows from per-position verdicts; a gap before the last reached item is wrong (EGRA: skipped = incorrect). */
function timedRows(refs, verdictOf) {
  const v = refs.map((_, k) => verdictOf(k));
  let last = 0;
  v.forEach((x, k) => { if (x.verdict !== 'not_reached') last = k + 1; });
  return refs.map((ref, k) => ({ i: k + 1, ref, verdict: v[k].verdict === 'not_reached' && k < last ? 'wrong' : v[k].verdict, heard: v[k].heard || '', conf: v[k].conf }));
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
  const clip = await deps.clipOf(row.audio_r2_key);
  const letters = /letter/.test(task.subtask || task.task);
  const LV = { c: 'correct', w: 'wrong', s: 'not_reached', n: 'not_reached' };
  let rows;
  if (letters) {
    const json = await call(deps, calls, { prompt: lettersPrompt({ grade, lang: task.lang, items, perRow, sound: /sound/.test(task.subtask || task.task) }), schema: LETTERS_SCHEMA(), clip, job: 'child_test.sa_letters' });
    const by = new Map((json.items || []).map((it, j) => [Number(it.i) || j + 1, it]));
    rows = timedRows(items, (k) => { const it = by.get(k + 1) || {}; return { verdict: LV[it.v] || 'not_reached', heard: String(it.heard || ''), conf: conf01(it.conf) }; });
  } else {
    rows = await storyRows(items, task.lang, clip, deps, calls, 'child_test.sa_words');
  }
  const stopped = (rec.stop || {}).type === 'first_row' && firstRowStopped(rows, Number(rec.stop.n) || perRow);
  return { numbers: timedNumbers(rows, res, { stopped }), rows, stopped, durationSec: clip.durationSec };
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
  const clip = await deps.clipOf(row.audio_r2_key);
  const rows = await storyRows(tokens, task.lang, clip, deps, calls, 'child_test.sa_story');
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
  if (keys.length) {
    for (const q of qs) {
      const k = keys.find((x) => x.i === q.id);
      if (!k) continue; // no clip for this question: no answer heard
      const clip = await deps.clipOf(k.key);
      const json = await call(deps, calls, { prompt: questionsPrompt({ lang: task.lang, task, questions: [q], passage, single: false }), schema: QUESTIONS_SCHEMA, clip, job: 'child_test.sa_questions' });
      const got = (json.questions || [])[0];
      if (got) marked.set(q.id, got);
    }
  } else if (row.audio_r2_key) {
    const clip = await deps.clipOf(row.audio_r2_key);
    const json = await call(deps, calls, { prompt: questionsPrompt({ lang: task.lang, task, questions: qs, passage, single: true }), schema: QUESTIONS_SCHEMA, clip, job: 'child_test.sa_questions' });
    for (const g of json.questions || []) marked.set(g.id, g);
  }
  const rows = qs.map((q, k) => {
    const g = marked.get(q.id);
    return { i: k + 1, id: q.id, verdict: g ? g.verdict : 'no_answer', heard: g ? String(g.answer || '') : '', conf: g ? conf01(g.confidence) : null, clip: keys.some((x) => x.i === q.id) || Boolean(row.audio_r2_key) };
  });
  return { numbers: { correct: rows.filter((r) => r.verdict === 'correct').length, of: rows.length }, rows, stopped: false };
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
 * One SA task's row → marks. { ok: true, marks } | { ok: false, reason, retry }.
 * `wait` (not an error): a questions task whose clips are still arriving.
 */
async function scoreRow(row, session, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const res = resultOf(row);
  const found = specFor(d.bank, session, row);
  if (!found) return { ok: false, reason: 'task_not_in_bank', retry: false };
  const { spec: task, variant } = found;
  const rec = task.record || {};
  const calls = [];
  const started = Date.now();
  try {
    let out;
    if (task.kind === 'grid') out = await scoreGrid(task, rec, row, res, d, calls, Number(session.grade) || 3);
    else if (task.kind === 'passage') out = await scorePassage(task, rec, row, res, d, calls);
    else if (Array.isArray(rec.questions)) out = await scoreQuestions(task, rec, row, res, d, calls);
    else return { ok: false, reason: 'no_scorer_for_kind', retry: false };
    const confidence = mean(out.rows.map((r) => r.conf));
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
          ...(out.tapped != null ? { last_word_tapped: out.tapped } : {}),
          confidence,
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
  if (!['oral'].includes(row.response_mode) || row.audio_r2_key) return true;
  const asked = Array.isArray(res.asked) ? res.asked : [];
  const keys = keysOf(row);
  if (asked.length && asked.every((id) => keys.some((k) => k.i === id))) return true;
  const ended = Date.parse(session.finished_at || session.client_finished_at || '') || Date.parse(row.updated_at || '') || 0;
  return ended > 0 && nowMs - ended > WAIT_FOR_CLIPS_MS;
}

function attemptOf(reason) {
  const m = new RegExp(`^${RETRY}(\\d+)$`).exec(String(reason || ''));
  return m ? Number(m[1]) : 0;
}

// ------------------------------------------------------------------ the database side

function db() { return require('../../../config/supabase'); } // eslint-disable-line global-require

const COLS = 'id, session_id, block, response_mode, responses, audio_r2_key, audio_r2_keys, ai_status, ai_reason, ai_marks, updated_at';

async function candidates({ sessionId = null, now = new Date(), supabase = db() } = {}) {
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
    return r.ai_reason === SCORING && nowMs - Date.parse(r.updated_at || 0) > STALE_CLAIM_MS;
  });
}

/** Every question id the phone asked in this session: which passage variant the child read. */
async function askedOf(sessionId, supabase) {
  const { data } = await supabase.from('child_test_blocks').select('responses').eq('session_id', sessionId);
  return (data || []).flatMap((r) => { const res = resultOf(r); return res && Array.isArray(res.asked) ? res.asked : []; });
}

/** Compare-and-set on ai_reason: one process scores one row. */
async function claim(row, supabase = db()) {
  const { data, error } = await supabase.from('child_test_blocks').update({ ai_reason: SCORING })
    .eq('id', row.id).eq('ai_status', 'failed').eq('ai_reason', row.ai_reason).is('ai_marks', null).select('id');
  if (error) { logError('child_test.sa_score.claim_failed', { block: row.block, error: error.message }); return false; }
  return Array.isArray(data) && data.length === 1;
}

async function finish(row, got, supabase = db()) {
  let patch;
  if (got.ok) patch = { ai_marks: got.marks, ai_status: 'scored', ai_reason: null, ai_scored_at: new Date().toISOString() };
  else {
    const n = attemptOf(row.ai_reason) + 1;
    patch = { ai_reason: got.retry && n < MAX_ATTEMPTS ? `${RETRY}${n}` : `${FAILED}${got.reason}` };
  }
  const { error } = await supabase.from('child_test_blocks').update(patch).eq('id', row.id).eq('ai_reason', SCORING).is('ai_marks', null);
  if (error) logError('child_test.sa_score.write_failed', { block: row.block, error: error.message });
  return !error;
}

let running = false;

async function sweepOnce({ sessionId = null, now = new Date(), deps = {} } = {}) {
  if (!isOn()) return { skipped: 'off' };
  if (running && !sessionId) return { skipped: 'running' };
  if (!sessionId) running = true;
  const out = { found: 0, scored: 0, failed: 0, waiting: 0 };
  try {
    const supabase = deps.supabase || db();
    const rows = await candidates({ sessionId, now, supabase });
    out.found = rows.length;
    const sessions = new Map();
    let started = 0;
    for (const row of rows) {
      if (started >= PER_TICK) break;
      if (!sessions.has(row.session_id)) {
        const { data } = await supabase.from('child_test_sessions').select('id, grade, form, item_bank_version, status, finished_at, client_finished_at').eq('id', row.session_id).limit(1);
        const s = (data || [])[0] || null;
        if (s) s.asked = await askedOf(row.session_id, supabase);
        sessions.set(row.session_id, s);
      }
      const session = sessions.get(row.session_id);
      if (!session || session.item_bank_version !== SA_MARK) continue;
      if (!ready(row, session, now.getTime())) { out.waiting += 1; continue; }
      const had = { ...row }; // the reason before the claim: the retry count lives in it
      if (!(await claim(had, supabase))) continue;
      started += 1;
      const got = await scoreRow(had, session, deps);
      await finish(had, got, supabase);
      if (got.ok) out.scored += 1; else out.failed += 1;
      logToFile('child_test.sa_scored', { block: row.block, ok: got.ok, reason: got.ok ? null : got.reason, cost_usd: got.ok ? got.marks.meta.cost_usd : null });
    }
    return out;
  } catch (e) {
    logError('child_test.sa_score.sweep_failed', { error: e.message });
    return out;
  } finally {
    if (!sessionId) running = false;
  }
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
  isOn, scoreRow, sweepOnce, kick, start, stop, specFor, ready, hash,
  __internals: { PARKED, SCORING, RETRY, FAILED, candidates, claim, finish, timedNumbers, firstRowStopped, usedSeconds, lettersPrompt, questionsPrompt },
};
