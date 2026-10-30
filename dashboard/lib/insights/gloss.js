'use strict';
/**
 * COACHIP nightly job, the moment's one line (bd-sex15q.14; NIGHTLY_JOB §6, §4 stage 9; ANALYSES §2.1). The prompt
 * reads only the allow-listed grader strings (never `evidence`, never a stamped quote, never a name field); five code
 * gates run on every answer; a failure gets one retry, then `blocked`, and the card shows the clip with no line.
 * The name lexicon lives in memory: it is never stored, logged or echoed in a gate result.
 */
const M = require('./model');

const GLOSS_PROMPT_VERSION = 'gloss_v2';
const RECHECK_PROMPT = 'gloss_recheck_v1';
const LIMITS = Object.freeze({ modelEn: 70, modelUr: 55, storedEn: 90, storedUr: 70 });
const RECHECK_SHARE = 0.05;
const RECHECK_MIN = 5;
const PAUSE_MIN_JUDGED = 50;
const PAUSE_FAITHFUL_SHARE = 0.90;

const cp = (s) => [...s].length;
const DIACRITICS = '\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640';
const DIACRITIC_RE = new RegExp(`[${DIACRITICS}]`, 'g');
const FOLD = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ه': 'ہ', 'ھ': 'ہ', 'ة': 'ہ', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا' };
const VARIANTS = { 'ی': 'یيى', 'ک': 'کك', 'ہ': 'ہهھة', 'ا': 'اأإآ' };
const STAMP = /\[\s*(?:\d{1,3}:)?\d{1,3}:\d{2}\s*\]/g;

const norm = (s) => s.normalize('NFC').replace(DIACRITIC_RE, '').replace(/[يىكهھةأإآ]/g, (c) => FOLD[c]).toLowerCase();
const escape = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regex per lexicon token: case-, diacritic- and letter-variant-insensitive, whole words only, Latin or Urdu script. */
function lexiconPatterns(lexicon) {
  const out = [];
  const tokens = new Set();
  for (const entry of lexicon || []) {
    if (typeof entry !== 'string') continue;
    for (const t of entry.split(/\s+/)) {
      const n = norm(t).replace(/[^\p{L}\p{N}]/gu, '');
      if (cp(n) >= 2) tokens.add(n);
    }
  }
  for (const t of tokens) {
    const body = [...t].map((ch) => `${VARIANTS[ch] ? `[${VARIANTS[ch]}]` : escape(ch)}[${DIACRITICS}]*`).join('');
    out.push(new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu'));
  }
  return out;
}

function clean(s, pats) {
  if (typeof s !== 'string') return null;
  let t = s.normalize('NFC').replace(STAMP, ' ');
  for (const p of pats) t = t.replace(p, ' ');
  t = t.replace(/[ \t]{2,}/g, ' ').trim();
  return t || null;
}

/**
 * The exact object gloss_v2 receives. Reads only glossMove.text / .evidenceTranslation / .rationale (allowlist.js's
 * `gloss.moves[id]`) and the narrative. An optional lexicon removes a name already in the notes.
 */
function buildGlossInput({ wId, phase = null, glossMove, verdict, narrative, lexicon }) {
  const pats = lexiconPatterns(lexicon);
  const mv = glossMove || {};
  return {
    W: typeof wId === 'string' ? wId : null,
    phase: typeof phase === 'string' ? phase : null,
    plan_move: clean(mv.text, pats),
    verdict: typeof verdict === 'string' ? verdict : null,
    evidence_translation: clean(mv.evidenceTranslation, pats),
    rationale: clean(mv.rationale, pats),
    narrative: clean(narrative, pats),
  };
}

const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urDigits = (n) => String(n).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]);

/**
 * COPY s4.gloss.at: "At minute {m}:" / "{m}ویں منٹ پر:", written by the server only (ruling B, lead-final 223945): m is
 * the clock minute + 1, the minute a person counts (0:24 → 1, 18:42 → 19). Every reader (S4, the pair card, the re-check)
 * shows the stored text as is.
 */
function prefix(minuteS) {
  const m = Math.max(0, Math.floor((Number(minuteS) || 0) / 60)) + 1;
  return { en: `At minute ${m}:`, ur: `${urDigits(m)}ویں منٹ پر:` };
}

// Gate 2. Gate 5 is COPY §6 / lint_copy.py's rule (UR_SING_VERB, UR_HON_VERB, انہوں نے), with Python's Unicode \b
// written as a lookahead because JS's \b is ASCII-only.
const EN_PRONOUN = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
const END = '(?![\\p{L}\\p{M}\\p{N}])';
const START = '(?<![\\p{L}\\p{M}\\p{N}])';
const GAP = (n) => `(?:(?!کہ | اور | جب | جو )[^۔«»]){0,${n}}?`;
const UR_SING_VERB = new RegExp(`(استاد|کوچ|آر ایم|بچہ|بچی|ٹیچر|معلم|معلمہ|والد|والدہ|ماں|باپ)${GAP(80)}\\S+(تا|تی) (ہے|تھا|تھی)${END}`, 'u');
const UR_HON_VERB = new RegExp(`(استاد|کوچ|آر ایم|بچہ|بچی|ٹیچر|معلم|معلمہ)${GAP(60)}\\S+تے (ہیں|تھے)${END}`, 'u');
const UR_THEY_ERG = new RegExp(`${START}انہوں نے${END}`, 'u');

function urVerbAgrees(s) {
  const body = s.replace(/«[^»]*»|"[^"]*"/g, '«»');
  return UR_SING_VERB.test(body) || UR_HON_VERB.test(body) || UR_THEY_ERG.test(body);
}

function latinMajority(s) {
  const outside = s.replace(/⁦[^⁩]*⁩/g, '');
  const L = (outside.match(/[A-Za-z]/g) || []).length;
  const U = (s.match(/[؀-ۿ]/g) || []).length;
  return U === 0 || L > U;
}

/** The five gates on the model's text (before the prefix). → { ok, failed: [gate names] }; never echoes a token. */
function gateGloss(gloss, lexicon) {
  const en = gloss && typeof gloss.en === 'string' ? gloss.en.trim() : '';
  const ur = gloss && typeof gloss.ur === 'string' ? gloss.ur.trim() : '';
  if (!en || !ur) return { ok: false, failed: ['shape'] };
  const failed = [];
  const pats = lexiconPatterns(lexicon);
  const enN = en.normalize('NFC');
  const urN = ur.normalize('NFC');
  if (pats.some((p) => { p.lastIndex = 0; const a = p.test(enN); p.lastIndex = 0; const b = p.test(urN); p.lastIndex = 0; return a || b; })) failed.push('names');
  if (EN_PRONOUN.test(en)) failed.push('pronouns');
  if (latinMajority(ur)) failed.push('script');
  if (cp(en) > LIMITS.modelEn || cp(ur) > LIMITS.modelUr) failed.push('length');
  if (urVerbAgrees(urN)) failed.push('ur_verb_agreement');
  return { ok: failed.length === 0, failed };
}

const asPair = (o) => ({ en: o && o.gloss_en, ur: o && o.gloss_ur });

function storedText(moment, pair) {
  const p = prefix(moment.moment_s != null ? moment.moment_s : moment.from_s);
  const en = `${p.en} ${pair.en.trim()}`;
  const ur = `${p.ur} ${pair.ur.trim()}`;
  return cp(en) <= LIMITS.storedEn && cp(ur) <= LIMITS.storedUr ? { en, ur } : null;
}

const patchOf = (status, text = null, runId = null) => ({
  gloss_en: text ? text.en : null,
  gloss_ur: text ? text.ur : null,
  gloss_status: status,
  gloss_model_run_id: runId,
});

function mergeUsage(a, b) {
  return {
    ...b,
    tokens_in: a.tokens_in + b.tokens_in,
    tokens_out: a.tokens_out + b.tokens_out,
    cost_usd: Math.round((a.cost_usd + b.cost_usd) * 1e5) / 1e5,
  };
}

/**
 * Gloss one moment: one call (with the Haiku fallback), the gates, one retry on a gate failure, else `blocked`.
 * → { patch, runs, runForPatch, dryRun? }. `patch` is the coachip_moments gloss columns; the store sets
 * `gloss_model_run_id` from `runForPatch` once that row has its id (it is filled here only when a stored row is reused).
 * deps: model.callModel's deps plus { sessionId, target, dryRun?, glossPaused? }.
 */
async function glossMoment({ moment, input, lexicon, ledger, deps }) {
  const d = { ...(deps || {}), ledger };
  const m = moment || {};
  if (d.glossPaused) return { patch: patchOf('paused'), runs: [], runForPatch: null };
  if (m.confidence === 'none') return { patch: patchOf('not_applicable'), runs: [], runForPatch: null };

  const args = { prompt: M.loadPrompt(GLOSS_PROMPT_VERSION), input, analysis: 'gloss', target: d.target || '-', sessionId: d.sessionId,
    promptVersion: GLOSS_PROMPT_VERSION, deps: d };
  const first = await M.callGlossModel(args);
  let runs = first.rows.slice();
  let run = first.row;
  let output = first.output;

  if (first.reused) {
    const text = run.status === 'ok' && output ? storedText(m, asPair(output)) : null;
    const status = run.status === 'ok' && !text ? 'blocked' : run.status;
    return finish({ status, text, run, runs: [], reusedId: run.id || null, d });
  }
  if (run.status !== 'ok') return finish({ status: run.status, run, runs, d });

  let gate = gateGloss(asPair(output), lexicon);
  let text = gate.ok ? storedText(m, asPair(output)) : null;
  if (gate.ok && !text) gate = { ok: false, failed: ['length'] };
  if (!gate.ok) {
    const again = await M.callModel({ ...args, model: run.model, purpose: run.purpose, deps: { ...d, findRun: null } });
    run = mergeUsage(run, again.row);
    runs = [...runs.slice(0, -1), run];
    if (again.row.status !== 'ok') return finish({ status: again.row.status, run, runs, d });
    output = again.output;
    gate = gateGloss(asPair(output), lexicon);
    text = gate.ok ? storedText(m, asPair(output)) : null;
    if (gate.ok && !text) gate = { ok: false, failed: ['length'] };
  }
  if (!gate.ok) {
    run = { ...run, status: 'blocked', failure_class: 'gate', output: { gates_failed: gate.failed } };
    runs = [...runs.slice(0, -1), run];
    return finish({ status: 'blocked', run, runs, d });
  }
  run = { ...run, output: { gloss_en: output.gloss_en.trim(), gloss_ur: output.gloss_ur.trim() } };
  runs = [...runs.slice(0, -1), run];
  return finish({ status: 'ok', text, run, runs, d });
}

function finish({ status, text = null, run, runs, reusedId = null, d }) {
  if (d.dryRun) {
    const scrubbed = runs.map((r) => ({ ...r, output: null }));
    return { patch: patchOf(status), runs: scrubbed, runForPatch: null, dryRun: { gated: 1, passed: status === 'ok' ? 1 : 0 } };
  }
  // A reused call is already stored: its id is in the patch, and there is no new row for the store to number (bd-sex15q.40).
  return { patch: patchOf(status, status === 'ok' ? text : null, reusedId), runs, runForPatch: reusedId ? null : run };
}

/** A random 5% of tonight's ok glosses, at least 5 (all of them when fewer). */
function pickRecheck(okGlosses, rand = Math.random) {
  const a = (okGlosses || []).slice();
  const n = Math.min(a.length, Math.max(RECHECK_MIN, Math.ceil(a.length * RECHECK_SHARE)));
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function recheckVerdict(output) {
  if (!output || typeof output !== 'object' || typeof output.faithful !== 'boolean') return 'unreadable';
  return output.faithful ? 'faithful' : 'unfaithful';
}

/** < 90% faithful over the last 7 nights, judged ≥ 50 → pause every gloss until a person signs off. */
function shouldPause(last7NightsJudged) {
  let f = 0;
  let u = 0;
  for (const v of last7NightsJudged || []) {
    const x = typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'faithful' : 'unfaithful') : recheckVerdict(v);
    if (x === 'faithful') f += 1;
    else if (x === 'unfaithful') u += 1;
  }
  const judged = f + u;
  return judged >= PAUSE_MIN_JUDGED && f / judged < PAUSE_FAITHFUL_SHARE;
}

/**
 * One re-check on the reference model (purpose = recheck). The stored prompt_version is gloss_v2 because the schema CHECK
 * admits only (gloss|phonics|homework)_vN; the judge prompt's own version is inside the hashed input, so changing it
 * writes new rows. Only the verdict is stored.
 */
async function recheckGloss({ input, gloss, ledger, deps }) {
  const d = { ...(deps || {}), ledger };
  const caption = { gloss_en: gloss && (gloss.gloss_en || gloss.en), gloss_ur: gloss && (gloss.gloss_ur || gloss.ur) };
  const out = await M.callModel({
    model: M.MODELS.reference, prompt: M.loadPrompt(RECHECK_PROMPT), input: { judge: RECHECK_PROMPT, inputs: input, caption },
    userMessage: `${JSON.stringify({ inputs: input, caption })}\n\nReturn the JSON.`, purpose: 'recheck', analysis: 'gloss',
    target: d.target || '-', sessionId: d.sessionId, promptVersion: GLOSS_PROMPT_VERSION, costKey: 'gloss_recheck', deps: d,
  });
  const verdict = out.row.status === 'ok' ? recheckVerdict(out.output) : null;
  const row = out.row.status === 'ok' && !out.reused
    ? { ...out.row, output: verdict === 'unreadable' ? null : { faithful: verdict === 'faithful' } }
    : out.row;
  return { verdict, row, reused: !!out.reused };
}

module.exports = {
  GLOSS_PROMPT_VERSION, RECHECK_PROMPT, LIMITS, buildGlossInput, prefix, gateGloss, glossMoment, pickRecheck, recheckVerdict,
  shouldPause, recheckGloss, lexiconPatterns,
};
