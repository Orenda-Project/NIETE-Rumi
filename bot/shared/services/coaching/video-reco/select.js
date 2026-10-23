'use strict';
/**
 * The pick (bd-gzfdu9, SPEC §3.5): ONE completeJson call on the bot's own LLM path, under its own job
 * name (coaching.videoReco, model-registry), and the validation every answer passes before it is stored.
 * The teacher-facing reason comes from the model; this code only checks it.
 */
const { modelFor, JOBS } = require('../../../config/model-registry');
const { resolveUx, clampLanguage } = require('../../../config/ux-strings');
const { redactNames, ROLE_STOP } = require('./redact-names');
const { fallbackSubjectOk } = require('./shortlist');
const { stripBidi } = require('./copy');

const JOB = 'coaching.videoReco';
const LLM_TIMEOUT_MS = 45000; // lead-converge 18:48Z: measured 22–33 s at the default effort; the report itself never waits on it

/** The job's reasoning effort: VIDEO_RECO_REASONING, else the registry default ('low'). */
function reasoningEffort(env = process.env) {
  const r = (JOBS[JOB] && JOBS[JOB].reasoning) || {};
  return String((r.env && env[r.env]) || r.default || '').trim() || undefined;
}

async function pick({ prompt, deps = {}, timeoutMs = LLM_TIMEOUT_MS }) {
  const call = deps.completeJson
    || ((p, o) => require('../../gpt5-mini.service').completeJson(p, o)); // eslint-disable-line global-require
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`videoReco LLM timeout after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    // 4000 = completeJson's own default: gpt-5-mini spends its budget on hidden reasoning before the answer, and at 700
    // the first real call came back finish_reason=length with empty content (evals, 18:16Z).
    const res = await Promise.race([call(prompt, { job: JOB, maxTokens: 4000, label: 'videoReco', reasoningEffort: reasoningEffort(deps.env) }), timeout]);
    const result = (res && res.result) || null;
    const empty = !result || typeof result !== 'object' || !Object.keys(result).length;
    return { pick: result, usage: (res && res.usage) || {}, model: modelFor(JOB), truncated: (res && res.finishReason === 'length') || empty };
  } finally {
    clearTimeout(timer);
  }
}

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u;

// Format characters (bidi isolates/marks, ZWNJ) are dropped first: a name glued to an isolate is still a name (red7 A11/A12).
function norm(text) {
  return String(text || '').replace(/\p{Cf}/gu, '').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function bigrams(s) {
  const out = new Map();
  const cps = [...s.replace(/ /g, '')];
  for (let i = 0; i < cps.length - 1; i++) {
    const g = cps[i] + cps[i + 1];
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

function dice(a, b) {
  const A = bigrams(a);
  const Bm = bigrams(b);
  let na = 0;
  let nb = 0;
  let both = 0;
  for (const v of A.values()) na += v;
  for (const v of Bm.values()) nb += v;
  for (const [g, v] of A) both += Math.min(v, Bm.get(g) || 0);
  return na + nb ? (2 * both) / (na + nb) : 0;
}

const MOMENT_AT = /^\d{1,2}:\d{2}$/;
// Teacher-facing copy never names the hidden scorer, a score or a placeholder (lead-review 19:37Z, 19:40Z, 19:41Z).
// Latin words match whole ("demonstrated" is not "rated"); سکور also covers سکورر and اسکورر.
const BANNED_COPY = /\bscor(?:e|es|ed|er|ers|ing)\b|\brated\b|\bN\/A\b|\bnot applicable\b|سکور/i;
const CLIP_ID = /\b\d{1,3}-s\d+\b/;
const PLACEHOLDERS = /\[(?:a student|child|teacher)\]/gi;
const QUOTED = /"[^"]*"|“[^”]*”|«[^»]*»/g;
const LATIN_WORD = /^[A-Za-z][A-Za-z'’-]*[.,;:!?]*$/;

/** Words left in a quote once the name placeholders are removed (a quote of placeholders tells the teacher nothing). */
function realWords(quote) {
  return String(quote || '').replace(LINE_PREFIX, '').replace(PLACEHOLDERS, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The longest run of consecutive Latin-letter words in Urdu copy, outside quoted text (Roman Urdu, lead-review 19:40Z). */
function latinRun(text) {
  let run = 0;
  let best = 0;
  for (const w of String(text || '').replace(QUOTED, ' ').split(/\s+/).filter(Boolean)) {
    run = LATIN_WORD.test(w) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}
// A leading excerpt-line prefix the model copied with the quote: "[04:17] Teacher:" (§3.5 [v1.3] b), or a bare speaker
// label with no stamp, any case, with an opening quote mark after it ("Student (UR): …", "teacher: \"…") (red7 074627).
const LINE_PREFIX = /^\s*(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*[^:\n]{0,40}|(?:teacher|students?|speaker|coach)(?:\s*\([a-z]{2}\))?)\s*:\s*["“«]?/i;

/** The index of the excerpt line the quote appears in, allowing for spacing, punctuation and case (Dice ≥ 0.8); -1 if none. */
function quoteLine(quote, excerpts) {
  const q = norm(String(quote || '').replace(LINE_PREFIX, '').replace(/\[a student\]/gi, ' '));
  const qw = q.split(' ').filter(Boolean);
  if (qw.length < 2 && [...q].length < 6) return -1;
  for (const [n, line] of (excerpts || []).entries()) {
    const l = norm(line);
    if (l.includes(q)) return n;
    const lw = l.split(' ');
    for (let size = Math.max(1, qw.length - 1); size <= qw.length + 1; size++) {
      for (let i = 0; i + size <= lw.length; i++) {
        if (dice(q, lw.slice(i, i + size).join(' ')) >= 0.8) return n;
      }
    }
  }
  return -1;
}

const quoteFound = (quote, excerpts) => quoteLine(quote, excerpts) >= 0;

/**
 * The quote is a line of the whole transcript; `fullLines` is a thunk (redacted lines). Not given (a caller that does
 * not check) → not judged; given but empty → no line can be the moment (scale-run 081240: "No transcript recorded.").
 */
function inTranscript(quote, fullLines) {
  if (fullLines === null || fullLines === undefined) return true;
  const lines = typeof fullLines === 'function' ? fullLines() : fullLines;
  return Array.isArray(lines) && lines.length > 0 && quoteFound(quote, lines);
}

const CHILD_PH = /\[a student\]/gi;
/** The word before each [a student] in a text ('' at the start): how a quote's placeholder is found in its line. */
const wordsBefore = (text) => [...String(text).matchAll(CHILD_PH)].map((m) => norm(text.slice(Math.max(0, m.index - 40), m.index)).split(' ').pop() || '');

/**
 * bd-8hhqhf (ped-review 21:23Z, lead-final 21:24Z): a [a student] in the quote where the RAW transcript line had no
 * name — the strict excerpt redactor masked a subject word (میڈین, میگنیٹ) only because it is outside the lessons'
 * vocabulary. Re-runs the excerpt's own redaction on the raw line with a trace; a placeholder whose masked word was
 * caught by the vocabulary rule alone ('oov') is unfounded. No raw line (the scorer's quote) → not judged here.
 */
function unfoundedPlaceholder(quote, excerpts, raw, teacherName) {
  const q = String(quote || '');
  const want = wordsBefore(q);
  if (!want.length || !Array.isArray(raw)) return false;
  const i = quoteLine(q, excerpts);
  if (i < 0 || typeof raw[i] !== 'string') return false;
  const trace = [];
  redactNames(raw[i], { teacher: teacherName || null, placeholders: { child: '[a student]' }, trace });
  const masked = trace.filter((t) => t.rep === '[a student]');
  const have = wordsBefore(excerpts[i]);
  const used = new Set();
  return want.some((w) => {
    let j = have.findIndex((h, k) => !used.has(k) && h === w);
    if (j < 0) j = have.findIndex((h, k) => !used.has(k));
    if (j < 0 || !masked[j]) return true; // a placeholder the line never had
    used.add(j);
    return masked[j].why === 'oov';
  });
}

/**
 * A teacher-facing line must not carry the teacher's own name (red-team H8; child names: the prompt rule).
 * Role words and honorifics in users.name ("Teacher", "Test", "Miss", ٹیچر) are not the name (bd-8hhqhf).
 */
function namesIn(text, name) {
  const words = new Set(norm(text).split(' '));
  return norm(name).split(' ').some((w) => [...w].length >= 3 && !ROLE_STOP.has(w) && words.has(w));
}

/** Arabic-script share of the letters, after removing quoted text and [a student] (§3.5 [v1.3] a: English terms are the prompt's rule 3). */
function arabicShare(text) {
  const rest = String(text || '').replace(QUOTED, ' ').replace(/\[a student\]/gi, ' ');
  const letters = rest.match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  return letters.filter((c) => ARABIC.test(c)).length / letters.length;
}

/**
 * @param {object} opts {stepIndicator, indicators, source, catalog, teacherName, scorerQuote, textRoute}
 * @returns {{ok:boolean, none:null|'llm_none'|'validation:<why>', confidence:number, momentSource:'transcript'|'scorer'|null}}
 *   <why> (lead-review 19:40Z, so evals and red-team can count them): shape | candidate | quote | moment_at | placeholder |
 *   scorer | id | name | length | urdu | roman | step | error
 */
function validate(p, shortlist, excerpts, opts) {
  const { stepIndicator = null, indicators = null, source = null, catalog = null, teacherName = null, scorerQuote = '', textRoute = false, rawExcerpts = null, fullLines = null } = opts || {};
  const bad = (why) => ({ ok: false, none: `validation:${why}`, confidence: 0, momentSource: null });
  try {
    if (!p || typeof p !== 'object') return bad('shape');
    const c = Number(p.confidence);
    const confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
    if (p.seg_id === null || p.seg_id === undefined || p.seg_id === '') return { ok: false, none: 'llm_none', confidence, momentSource: null };
    const cand = ((shortlist && shortlist.candidates) || []).find((x) => x.seg_id === String(p.seg_id));
    if (!cand) return bad('candidate');
    const quote = p.moment && p.moment.quote;
    // red7 074501: a quote of fewer than 3 real words (a speaker label does not count) is no moment, found or not.
    if (quote && realWords(quote) < 3) return bad('placeholder');
    let momentSource = null;
    if (quote && quoteFound(quote, excerpts)) momentSource = 'transcript';
    // red7 074627: the scorer's "Quote:" can be a summary; a scorer-path quote must also be a line of the transcript.
    else if (quote && scorerQuote && quoteFound(quote, [scorerQuote]) && inTranscript(quote, fullLines)) momentSource = 'scorer';
    if (!momentSource) return bad('quote');
    if (!MOMENT_AT.test(String(p.moment.at || '').trim())) return bad('moment_at'); // never "unknown", "N/A" or "[00:30]"
    if (realWords(quote) < 3) return bad('placeholder');
    if (momentSource === 'transcript' && unfoundedPlaceholder(quote, excerpts, rawExcerpts, teacherName)) return bad('placeholder');
    const reasons = [p.reason_en, p.reason_ur].map((x) => String(x || ''));
    if (reasons.some((x) => BANNED_COPY.test(x))) return bad('scorer');
    if (reasons.some((x) => CLIP_ID.test(x))) return bad('id');
    if (namesIn(p.moment.quote, teacherName) || namesIn(p.reason_en, teacherName) || namesIn(p.reason_ur, teacherName)) return bad('name');
    const en = [...reasons[0].trim()].length;
    if (en < 20 || en > 400) return bad('length');
    if (arabicShare(p.reason_ur) < 0.6) return bad('urdu');
    if (latinRun(p.reason_ur) > 2) return bad('roman');
    // Indicator path: every candidate is for the step; a pick outside the step's chapters is refused (SPEC v1.2 §3.5).
    // When the step-text route ran (label / hole / unknown / unscored / empty target, v1.3 R4) any listed candidate is valid.
    if ((source === 'step' || source === 'card') && stepIndicator && !textRoute) {
      const hit = catalog && catalog.segment(cand.seg_id);
      const ids = hit ? [...(hit.segment.fico || []).map((f) => f.indicator), ...(hit.segment.fico_main37 || [])] : [];
      const step = indicators && indicators.length ? indicators : [stepIndicator];
      if (!step.includes(cand.indicator) && !step.some((id) => ids.includes(id))) return bad('step');
    }
    return { ok: true, none: null, confidence, momentSource };
  } catch (e) {
    return bad('error');
  }
}

/** ⛔9 (SPEC v1.3c §3.5 a): what is stored and sent passes the non-strict redactor; a text with no name is unchanged. */
function postRedact(text, teacherName, vocab = []) {
  if (typeof text !== 'string' || !text) return text;
  return redactNames(text, { teacher: teacherName || null, strict: false, placeholders: { child: '[a student]' }, vocab });
}

// bd-8hhqhf (lead-final 21:24Z): maths/science loanwords a teacher says in Urdu script, never a child's name: the output
// redactor's vocabulary. Topic words are NOT in it: a topic can name a person ("حضرت علی کی سیرت"), and in the non-strict
// output redactor the vocabulary only ever decides an address slot (red7 070504/070505, COS 070543).
const SUBJECT_TERMS = ('میڈین موڈ مین رینج اوسط میگنیٹ مقناطیس رگڑا رگڑ چارج کرنٹ سرکٹ بلب بیٹری وولٹیج فورس گریویٹی انرجی '
  + 'ایٹم مالیکیول الیکٹران پروٹان نیوٹران آکسیجن کاربن ہائیڈروجن فریکشن نیومریٹر ڈینومینیٹر ڈیسیمل پرسنٹیج فیکٹر ملٹیپل '
  + 'اینگل ٹرائینگل سرکل اسکوائر ریکٹینگل ایریا پیرامیٹر والیوم ریڈیس ڈایامیٹر').split(' ');

/** The output redactor's vocabulary: SUBJECT_TERMS (a topic argument is ignored, see above). */
function subjectVocab() {
  return SUBJECT_TERMS;
}

// The validation rules that leave the pick on a shortlisted, code-gated chapter. Not candidate/shape (no such chapter),
// not step (a code gate: the chapter is not for the step), not error.
const FALLBACK_RULES = new Set(['quote', 'moment_at', 'placeholder', 'scorer', 'id', 'name', 'length', 'urdu', 'roman']);
const FALLBACK_MAX = 300; // code points of each composed reason (en and ur)
const MIN_WORDS = 3; // a trimmed card sentence keeps at least this many words, else the none stands

/** The sentence whole if it fits `room` code points, else cut after its last whole word that fits, plus "…"; null if < MIN_WORDS. */
function fitWords(sentence, room) {
  const c = [...sentence];
  if (c.length <= room) return sentence;
  if (room < 2) return null;
  let head = c.slice(0, room - 1).join('');
  if (!/\s/.test(c[room - 1])) head = head.replace(/\S*$/u, '');
  head = head.replace(/[\s\p{P}]+$/u, '');
  return realWords(head) >= MIN_WORDS ? `${head}…` : null;
}
// prod card actions open with the teacher's name; a child placeholder is stripped only as an address (with its comma),
// never as the sentence's subject ("[a student] reads …" keeps the none).
const LEADING_ADDRESS = /^(\s*\[TEACHER\]\s*)+[،,:]?\s*|^\s*\[(a student|CHILD)\]\s*[،,:]\s*/;
// [v1.3c-5] the card's vocative, stripped BEFORE redaction: an Urdu-script name the redactor cannot map to a Latin
// users.name would otherwise be masked as the child placeholder and open the sentence.
const LEADING_VOCATIVE = /^\s*\S{2,30}\s*[،,:]\s*/;
const UNSHOWABLE = /\[(TEACHER|COACH|SCHOOL|URL|EMAIL|NUMBER)\]/;

/**
 * The card-sentence fallback (SPEC v1.3c §3.5 b): when the retry also failed on a validation rule but the model's
 * seg_id is one of the shortlist's candidates, the clip keeps a quote-free reason built from the report's own
 * "Try this tomorrow" sentence. No LLM call. → {reason_en, reason_ur} | null (the none stands).
 * @param {object} a {none, segId, shortlist, sentence, startS, endS, language, teacherName, module, subject, vocab}
 */
function cardFallback({ none, segId, shortlist, sentence, startS, endS, language, teacherName, module, subject, vocab } = {}) {
  try {
    const m = /^validation:(.+)$/.exec(String(none || ''));
    if (!m || !FALLBACK_RULES.has(m[1])) return null;
    if (!((shortlist && shortlist.candidates) || []).some((c) => c.seg_id === String(segId))) return null;
    if (!fallbackSubjectOk(module, subject)) return null; // [v1.3c-2] ⛔4: no literacy clip on a science lesson
    const bare = stripBidi(String(sentence || '')).replace(LEADING_VOCATIVE, '');
    const s = String(postRedact(bare, teacherName, vocab) || '').replace(LEADING_ADDRESS, '').trim();
    if (!s || s.startsWith('[') || UNSHOWABLE.test(s)) return null; // [v1.3c-5] a placeholder never opens it
    const n = Math.round(Number(endS) - Number(startS));
    if (!Number.isFinite(n) || n <= 0) return null;
    // bd-8hhqhf: a long card sentence is trimmed at a word boundary to fit, in each language (session 077b8021:
    // 224 cp → 308 cp composed in ur, and no clip was sent). The teacher's language must fit; the other one is
    // trimmed when it can be and otherwise stored whole, as before.
    const out = {};
    for (const l of ['en', 'ur']) {
      const whole = resolveUx('videoRecoCardFallbackReason', { language: l, params: { sentence: s, n } });
      const fit = fitWords(s, FALLBACK_MAX - ([...whole].length - [...s].length));
      if (!fit && l === clampLanguage(language)) return null;
      out[`reason_${l}`] = !fit || fit === s ? whole : resolveUx('videoRecoCardFallbackReason', { language: l, params: { sentence: fit, n } });
    }
    return out;
  } catch (e) {
    return null;
  }
}

module.exports = { pick, validate, quoteFound, reasoningEffort, cardFallback, postRedact, subjectVocab, JOB, LLM_TIMEOUT_MS };
