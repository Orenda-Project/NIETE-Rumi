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
const CONTENT_TERMS = require('./content-terms');
const LEX = require('./name-lexicon');
const { childTurnNear, imperative, routineLine, echoReading, notTeaching, isClosure, earlyForClosure, levelsNear } = require('./silence');
const { leadingVocative, quotedVocative, genderedUrdu, systemNote, unshownClaim, childFreeCard, sceneClaim, recallMislabel, pointerNoLine, recallLeft, namesGap, notGapLine, auditWords, closedQuestion, urduSlip } = require('./copy-rules');

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

const OTHER_SCRIPT = /[\u0400-\u04FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/u; // Cyrillic, Devanagari, CJK, Hangul
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
    const l = norm(String(line || '').replace(/\[a student\]/gi, ' ')); // R7f (Q066): the line's own placeholder, as the quote's
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

const BARE_STAMP = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/;
// For STORAGE only (red7 093352): an optional stamp, then a real speaker label (en or ur) and its colon. LINE_PREFIX
// takes any text before a colon after a stamp, which is right for counting words but eats words when stored.
const STORE_PREFIX = /^\s*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)?(?:teacher|students?|speaker|coach|ٹیچر|استاد|استانی|طالب علم)(?:\s*\([a-z]{2}\))?\s*:\s*["“«]?/i;
const TRAILING_STAMP = /\s*[([]\d{1,2}:\d{2}(?::\d{2})?[)\]]\s*$/;
const QUOTE_WRAP = /^["“«]([\s\S]*)["”»]$/;

/**
 * The moment as stored and shown on /v (red7 091238): a leading stamp / speaker label, a trailing "(mm:ss)" and one
 * wrapping pair of quote marks (or an orphaned closing one) go, until none is left; what stays is a verbatim stretch of
 * the line (a [a student] placeholder in it is kept, as the redactor wrote it). Nothing left → the quote as given.
 */
function storedQuote(quote) {
  const given = String(quote || '').trim();
  let s = given;
  let prev;
  do {
    prev = s;
    s = s.replace(STORE_PREFIX, '').replace(BARE_STAMP, '').replace(TRAILING_STAMP, '').trim();
    const w = QUOTE_WRAP.exec(s);
    if (w) s = w[1].trim();
    else if ((/"$/.test(s) && (s.match(/"/g) || []).length % 2 === 1) || (/[”»]$/.test(s) && !/[“«]/.test(s))) s = s.slice(0, -1).trim();
  } while (s !== prev);
  return s || given;
}

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
function unfoundedPlaceholder(quote, excerpts, raw, teacherName, vocab = [], oovVocab = []) {
  const q = String(quote || '');
  const want = wordsBefore(q);
  if (!want.length || !Array.isArray(raw)) return false;
  const i = quoteLine(q, excerpts);
  if (i < 0 || typeof raw[i] !== 'string') return false;
  const trace = [];
  redactNames(raw[i], { teacher: teacherName || null, placeholders: { child: '[a student]' }, vocab, oovVocab, trace }); // = prompt.redact
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

// R7d (⛔9, panel Q086): the teacher's own class roster as a people check, in any position. Everyday and lesson words
// (the lexicon's common lists and vocabulary, the subject terms, role words) are never taken from it: a father named
// «Noor» must not refuse every card that says «نور».
const normWord = (w) => String(w || '').toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ةه]/g, 'ہ').replace(/[\u064B-\u0670\u0640\u200C\u200D]/g, '');
let commonWords = null;

/** The roster's name words, normalised, minus every word a lesson or a card uses. */
function rosterSet(names) {
  commonWords = commonWords || new Set([...LEX.urCommon, ...LEX.latCommon, ...LEX.vocab, ...SUBJECT_TERMS].map(normWord));
  const out = new Set();
  for (const w of names || []) {
    const n = normWord(w);
    if ([...n].length >= 3 && !commonWords.has(n) && !ROLE_STOP.has(n)) out.add(n);
  }
  return out;
}

/** A word of the text is a roster name. */
function rosterIn(text, roster) {
  if (!roster || !roster.size) return false;
  return String(text || '').replace(/\p{Cf}/gu, '').split(/[^\p{L}\p{M}]+/u).some((w) => roster.has(normWord(w)));
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
 *   scorer | id | name | length | urdu | roman | gender | step | unshown | scene | recall | no_line | no_gap | not_gap | no_evidence |
 *   no_child_turn | not_moment | closure_early | urdu_form | error. A not_moment from a line spoken while no lesson is happening also
 *   carries `lessonless: true` (R7f: only such a line takes the card fallback away, engine.js).
 */
function validate(p, shortlist, excerpts, opts) {
  const { stepIndicator = null, indicators = null, source = null, catalog = null, teacherName = null, scorerQuote = '', textRoute = false, rawExcerpts = null, fullLines = null, vocab = [], oovVocab = [], roster = null, topic = null, grade = null, cardIndicator = null, labelClosed = false, reader = null } = opts || {};
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
    // red7 085115: a placeholder no teacher may see ([TEACHER] from the excerpt redactor, [URL] …) in the quote or a
    // reason → refused; the retry or the card fallback takes it ([v1.3c-5], until now only on the fallback path).
    if ([quote, p.reason_en, p.reason_ur].some((x) => UNSHOWABLE.test(String(x || '')))) return bad('placeholder');
    if (momentSource === 'transcript' && unfoundedPlaceholder(quote, excerpts, rawExcerpts, teacherName, vocab, oovVocab)) return bad('placeholder');
    // R7c (Q031 Q061 Q063 Q072 Q084 Q170 …): a greeting, a page call, an order about the room or the lesson's announcement is
    // no moment. Not a fallback rule: the retry may find a real one, else the none stands (Q063, Q170 → silence, as ruled). Before every
    // reason rule, so a routine line is never rescued by the fallback a reason fault would allow.
    if (routineLine(storedQuote(quote), { topic })) return bad('not_moment');
    // R7g (COS 002603 1a; panel Z199 ⛔2, Z025 right): a subject label let through for its open-question sentence answers a
    // closed question; any other cited line (a page announcement, a why already asked) is no moment for it
    if (labelClosed && !closedQuestion(storedQuote(quote))) return bad('not_moment');
    // R7d (Q038 Q056): in Grade 1–2 a line the children read back is echo reading, not the gap
    const lines = momentSource === 'transcript' ? excerpts : (() => { const l = typeof fullLines === 'function' ? fullLines() : fullLines; return Array.isArray(l) ? l : []; })();
    if (echoReading(lines, quoteLine(quote, lines), grade)) return bad('not_moment');
    // R7e (COS 202042; Q063 Q170): before the class is greeted (the phone, the observer), or in a test period, read on the
    // whole transcript: a window of it cannot show where the lesson starts
    const full = typeof fullLines === 'function' ? fullLines() : fullLines;
    const whole = Array.isArray(full) && full.length ? full : null;
    const at = whole ? quoteLine(quote, whole) : -1;
    if (whole && notTeaching(whole, at)) return { ...bad('not_moment'), lessonless: true };
    // R7e (panel §6.2: Q117 Q136 Q197): a closure chapter on a line from the first two thirds of the lesson. Not routine:
    // the retry may find a late line, else the card fallback carries the closure card
    const picked = catalog && catalog.segment(cand.seg_id);
    // the stamp of the line the quote was found on (the model's moment.at can name another line, red7 200255)
    const said = at >= 0 ? (/^\s*\[([\d:]+)\]/.exec(String(whole[at])) || [])[1] : null;
    if (picked && isClosure(picked.segment) && earlyForClosure(said || p.moment.at, whole || lines)) return bad('closure_early');
    // R7f (COS 223858 1a; panel Q191 ⛔2, Q166): a differentiation pick (a B6 card, or a chapter kept only for a mixed-level
    // task) needs the mixed-level line at the moment. Not a fallback rule: else silence, as the levels rule already does.
    if ((cardIndicator === 'B6' || (picked && picked.segment.keep_with_caveat === 'mixed_level_task')) && !levelsNear(lines, quoteLine(quote, lines))) return bad('no_evidence');
    const reasons = [p.reason_en, p.reason_ur].map((x) => String(x || ''));
    if (reasons.some((x) => BANNED_COPY.test(x) || auditWords(x))) return bad('scorer');
    if ([quote, ...reasons].some(systemNote)) return bad('scorer'); // R7b (P005): «No student activity recorded» is no lesson
    if (reasons.some((x) => CLIP_ID.test(x))) return bad('id');
    if (namesIn(p.moment.quote, teacherName) || namesIn(p.reason_en, teacherName) || namesIn(p.reason_ur, teacherName)) return bad('name');
    if (reasons.some(quotedVocative)) return bad('name'); // R7b (P165, red7 N1/N3): a quoted card still opening with a name
    if ([quote, ...reasons].some((x) => rosterIn(x, roster))) return bad('name'); // R7d: a child on the teacher's roster
    const en = [...reasons[0].trim()].length;
    if (en < 20 || en > 400) return bad('length');
    if (arabicShare(p.reason_ur) < 0.6 || OTHER_SCRIPT.test(reasons.join(' ').replace(QUOTED, ' '))) return bad('urdu'); // R7c: «факт» (Q097)
    if (latinRun(p.reason_ur) > 2) return bad('roman');
    if (genderedUrdu(p.reason_ur)) return bad('gender'); // R7b (26 panel rows): a teacher is plural in Urdu
    if (reader === 'ur' && urduSlip(p.reason_ur)) return bad('urdu_form'); // R7g 1b (Z091 Z019): tense and voice, the reader's line
    // Indicator path: every candidate is for the step; a pick outside the step's chapters is refused (SPEC v1.2 §3.5).
    // When the step-text route ran (label / hole / unknown / unscored / empty target, v1.3 R4) any listed candidate is valid.
    if ((source === 'step' || source === 'card') && stepIndicator && !textRoute) {
      const hit = catalog && catalog.segment(cand.seg_id);
      const ids = hit ? [...(hit.segment.fico || []).map((f) => f.indicator), ...(hit.segment.fico_main37 || [])] : [];
      const step = indicators && indicators.length ? indicators : [stepIndicator];
      if (!step.includes(cand.indicator) && !step.some((id) => ids.includes(id))) return bad('step');
    }
    // R7b (≥ 36 panel rows): what the reason says the clip shows has a word for it in the chapter's own text
    const chosen = catalog && catalog.segment(cand.seg_id);
    if (chosen && unshownClaim(p.reason_en, chosen.segment)) return bad('unshown');
    // R7c §5: a conversation, talk, slides or animation never "shows a teacher"; a cited why/how line is never "recall"
    if (chosen && sceneClaim(p.reason_en, p.reason_ur, chosen.module)) return bad('scene');
    if (recallMislabel(quote, p.reason_en, p.reason_ur) || recallLeft(quote, p.reason_en, p.reason_ur)) return bad('recall');
    if (pointerNoLine(p.reason_en)) return bad('no_line'); // R7e (panel §6.7): "said that line" with no line
    // R7f (COS 223858 1b): the reason names what was missing, and the cited line shows the pattern the chapter answers
    if (!namesGap(p.reason_en)) return bad('no_gap');
    if (chosen && notGapLine(quote, lines[quoteLine(quote, lines)], chosen.segment)) return bad('not_gap');
    // R7b (panel P183, P076), checked last so every other rule names its own fault first: the moment's line or a line
    // beside it is a child's turn, else it is talk with no class in it.
    if (!childTurnNear(lines, quoteLine(quote, lines))) return bad('no_child_turn');
    return { ok: true, none: null, confidence, momentSource };
  } catch (e) {
    return bad('error');
  }
}

// R7d §6 (COS 184404; panel §4: the clip-misdescription class, 46 rows): the clip half of a reason is the chapter's own
// title, never the model's account of it (the card's script, an invented example). The lesson half is the model's text
// before its first clip sentence, cut at a sentence end. A reason that opens with the clip is left whole (validated as is).
const CLIP_AT = {
  en: /(?:^|(?<=[.!?;۔؟؛]["'”»\u2069]?\s+|["'”»\u2069]\s+))(?:This|this|The|the|In this|in this|In the|in the) (?:clip|video|chapter)\b/,
  ur: /(?:یہ|اس|ایک) (?:کلپ|ویڈیو)|(?:کلپ|ویڈیو) (?:میں|سے)/u,
};
const SENTENCE_END = { en: /[.!?;۔؟؛]["'”»)\u2069]*$|["”»\u2069]$/u, ur: /[۔؟!.؛;]["'”»)\u2069]*$|["”»\u2069]$/u };
// a clause the clip half followed after a semicolon now ends the reason's first part
const CLOSE = { en: (h) => h.replace(/\s*[;؛]$/u, '.'), ur: (h) => h.replace(/\s*[;؛]$/u, '۔') };

/** One reason with its clip half replaced by the chapter's title line; unchanged when no lesson half precedes the clip. */
function groundReason(text, l, segment) {
  const s = String(text || '');
  const m = CLIP_AT[l].exec(s);
  if (!m || !segment) return s;
  let head = s.slice(0, m.index).trim();
  while (head && !SENTENCE_END[l].test(head)) {
    const cut = Math.max(...[...head.matchAll(/[.!?;۔؟؛]["'”»)\u2069]*\s/gu)].map((x) => x.index + x[0].length - 1), -1);
    head = cut > 0 ? head.slice(0, cut).trim() : '';
  }
  if (!/\p{L}/u.test(head)) return s;
  const title = String((l === 'ur' && segment.title_ur) || segment.title_en || '').trim();
  if (!title) return s;
  const line = resolveUx('videoRecoClipLine', { language: l, params: { title } });
  // red7 194127 nit: a title that ends in its own mark («…today?») takes no second one
  return `${CLOSE[l](head)} ${/[?؟!.۔]["'”»]?$/u.test(title) ? line.replace(/[.۔]$/u, '') : line}`;
}

/** The pick with both reasons grounded on its chapter (a pick without a listed chapter is returned as it is). */
function groundReasons(p, catalog) {
  if (!p || typeof p !== 'object' || !p.seg_id || !catalog) return p;
  const hit = catalog.segment(String(p.seg_id));
  if (!hit) return p;
  return { ...p, reason_en: groundReason(p.reason_en, 'en', hit.segment), reason_ur: groundReason(p.reason_ur, 'ur', hit.segment) };
}

/**
 * R7f (COS 223858 e; Q090 Q179): the pick's quote is a line spoken while no lesson is happening (before the class is
 * greeted, or in a test period), whatever rule refused the pick. Only such a line takes the card fallback away: a greeting
 * or an announcement cited by a retry says nothing about whether the lesson had a moment.
 */
function lessonlessQuote(p, fullLines) {
  const q = p && p.moment && p.moment.quote;
  const lines = typeof fullLines === 'function' ? fullLines() : fullLines;
  if (!q || !Array.isArray(lines) || !lines.length) return false;
  const at = quoteLine(storedQuote(String(q)), lines);
  return at >= 0 && !!notTeaching(lines, at);
}

/** red7 194127 (Q170): the pick's quote is a routine line, whatever rule refused the pick (a placeholder is checked first). */
function routineQuote(p, topic = null) {
  const q = p && p.moment && p.moment.quote;
  return !!q && routineLine(storedQuote(String(q).replace(PLACEHOLDERS, ' ').replace(UNSHOWABLE_G, ' ')), { topic });
}

/** ⛔9 (SPEC v1.3c §3.5 a): what is stored and sent passes the non-strict redactor; a text with no name is unchanged. */
function postRedact(text, teacherName, vocab = []) {
  if (typeof text !== 'string' || !text) return text;
  return redactNames(text, { teacher: teacherName || null, strict: false, placeholders: { child: '[a student]' }, vocab });
}

// bd-8hhqhf (lead-final 21:24Z): maths/science loanwords a teacher says in Urdu script, never a child's name: the output
// redactor's vocabulary. Topic words are NOT in it: a topic can name a person ("حضرت علی کی سیرت"), and in the non-strict
// output redactor the vocabulary only ever decides an address slot (red7 070504/070505, COS 070543).
const SUBJECT_TERMS = [...('میڈین موڈ مین رینج اوسط میگنیٹ مقناطیس رگڑا رگڑ چارج کرنٹ سرکٹ بلب بیٹری وولٹیج فورس گریویٹی انرجی '
  + 'ایٹم مالیکیول الیکٹران پروٹان نیوٹران آکسیجن کاربن ہائیڈروجن فریکشن نیومریٹر ڈینومینیٹر ڈیسیمل پرسنٹیج فیکٹر ملٹیپل '
  + 'اینگل ٹرائینگل سرکل اسکوائر ریکٹینگل ایریا پیرامیٹر والیوم ریڈیس ڈایامیٹر').split(' '), ...CONTENT_TERMS];

/** The output redactor's vocabulary: SUBJECT_TERMS (a topic argument is ignored, see above). */
function subjectVocab() {
  return SUBJECT_TERMS;
}

/** The topic's words: the PROMPT-side redactor's vocabulary rule only (never an address slot, never a lexicon name). */
function topicVocab(topic) {
  return String(topic || '').split(/[^\p{L}]+/u).filter((w) => [...w].length >= 3);
}

// The validation rules that leave the pick on a shortlisted, code-gated chapter. Not candidate/shape (no such chapter),
// not step (a code gate: the chapter is not for the step), not error.
// R7f: closure_early (Q117: the card names the closing move the chapter shows), no_gap and not_gap (ask 1b: the card frame
// is 96.9% right/acceptable on v5) take it too; no_evidence (1a) never does.
const FALLBACK_RULES = new Set(['quote', 'moment_at', 'placeholder', 'scorer', 'id', 'name', 'length', 'urdu', 'roman', 'gender', 'unshown', 'scene', 'recall', 'no_child_turn', 'closure_early', 'no_gap', 'not_gap', 'urdu_form']);
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
// R7b (panel §1, COS 073531 guard): a long card sentence is trimmed at a CLAUSE boundary, never before the clause the
// clip serves (P033, P037, P040: the "…" cut off the Think-Pair-Share / feedback part the clip shows).
const CLAUSE = /(?<=[،؛;,:—۔.])\s+/u;
const STOP = new Set('the and for with your you that this then each one two when after before ask اور کے کی کا میں سے کو پر ایک جب تو ہر یہ وہ'.split(' '));
const wordsOf = (t) => (String(t || '').toLowerCase().match(/[\p{L}]{3,}/gu) || []).filter((w) => !STOP.has(w));

/** The words a clause shares with the chapter's own title, summary, keywords and moves. */
function servesClip(clause, segment) {
  if (!segment) return 0;
  const doc = new Set(wordsOf([segment.title_en, segment.summary_en, ...(segment.keywords || []), ...(segment.moves || []).map((m) => String(m).replace(/_/g, ' '))].join(' ')));
  return wordsOf(clause).filter((w) => doc.has(w)).length;
}

/**
 * The sentence whole if it fits `room` code points; else its leading whole clauses + "…" when they hold the clause the
 * clip serves (or no clause serves it); else that clause (and what follows, while it fits) between "…" marks; a word
 * boundary only when no clause fits. null under MIN_WORDS.
 */
function fitClauses(sentence, room, segment) {
  if ([...sentence].length <= room) return sentence;
  const parts = sentence.split(CLAUSE).filter(Boolean);
  const cps = (t) => [...t].length;
  const tidy = (t) => t.replace(/[\s\p{P}]+$/u, '');
  let pre = '';
  let k = 0;
  for (; k < parts.length; k++) {
    const next = pre ? `${pre} ${parts[k]}` : parts[k];
    if (cps(tidy(next)) > room - 1) break;
    pre = next;
  }
  const score = parts.map((x) => servesClip(x, segment));
  const top = Math.max(0, ...score);
  const best = top > 0 ? score.indexOf(top) : -1;
  if (pre && (best < 0 || best < k) && realWords(tidy(pre)) >= MIN_WORDS) return `${tidy(pre)}…`;
  if (best >= 0) {
    let mid = parts[best];
    let j = best + 1;
    while (j < parts.length && cps(tidy(`${mid} ${parts[j]}`)) <= room - 2) { mid = `${mid} ${parts[j]}`; j++; }
    const tail = j < parts.length ? '…' : '';
    // R7c (Q172): the sentence's own opening stays in front of the clause the clip serves, as much of it as fits, so the
    // teacher reads when to do it, not only the card's tail
    for (let p = Math.min(k, best); p >= 1; p--) {
      const lead = parts.slice(0, p).join(' ').replace(/[\s،؛;,:—۔.]+$/u, ''); // a closing bracket or quote stays
      const both = `${lead}… ${tail ? tidy(mid) : mid}${tail}`;
      const open = (t, a, b) => (t.split(a).length - t.split(b).length);
      const balanced = !open(lead, '(', ')') && !open(lead, '‘', '’') && (lead.split("'").length - 1) % 2 === 0;
      if (balanced && cps(both) <= room && realWords(lead) >= MIN_WORDS) return both;
    }
    if (cps(tidy(mid)) + 1 + tail.length <= room && realWords(mid) >= MIN_WORDS) return `…${tail ? tidy(mid) : mid}${tail}`;
    const cut = fitWords(mid, room - 1);
    if (cut) return `…${cut}`;
  }
  return fitWords(sentence, room);
}
// prod card actions open with the teacher's name; a child placeholder is stripped only as an address (with its comma),
// never as the sentence's subject ("[a student] reads …" keeps the none).
const LEADING_ADDRESS = /^(\s*\[TEACHER\]\s*)+[،,:]?\s*|^\s*\[(a student|CHILD)\]\s*[،,:]\s*/;
const UNSHOWABLE = /\[(TEACHER|COACH|SCHOOL|URL|EMAIL|NUMBER)\]/;
const UNSHOWABLE_G = /\[(?:TEACHER|COACH|SCHOOL|URL|EMAIL|NUMBER)\]/g;
// R7b (P036, P042, P046, P135, P178): the labels the panel named are report jargon, never a move to quote to a teacher.
// Only these: an ordinary indicator name («Student-to-Student Interaction») in a template card was a right pick
// (P003, P015, P051, P056, P062; scale-run 161526).
const LABEL_TEXT = /Subject-Specific|Real-World Connections|Depth of Explanation|Pedagogy:/i;

/** The card's own double quotes become single ones inside the template's quote marks (P109, P135, P154, P156). */
const singleQuotes = (t) => t.replace(/"([^"]*)"/g, '‘$1’').replace(/“([^”]*)”/g, '‘$1’').replace(/["“”]/g, '’');

/**
 * The card-sentence fallback (SPEC v1.3c §3.5 b): when the retry also failed on a validation rule but the model's
 * seg_id is one of the shortlist's candidates, the clip keeps a quote-free reason built from the report's own
 * "Try this tomorrow" sentence. No LLM call. → {reason_en, reason_ur} | null (the none stands).
 * @param {object} a {none, segId, shortlist, sentence, startS, endS, language, teacherName, module, subject, vocab, oovVocab, segment, labels}
 */
function cardFallback(a = {}) {
  const m = /^validation:(.+)$/.exec(String(a.none || ''));
  if (!m || !FALLBACK_RULES.has(m[1])) return null;
  if (!((a.shortlist && a.shortlist.candidates) || []).some((c) => c.seg_id === String(a.segId))) return null;
  return cardFrame(a);
}

/** The card frame for a chapter (the fallback's text, no rule or list gate): {reason_en, reason_ur} | null. */
function cardFrame({ sentence, startS, endS, language, teacherName, module, subject, vocab, oovVocab = [], segment, labels = [], roster = null, plainIfNamed = false } = {}) {
  try {
    if (!fallbackSubjectOk(module, subject)) return null; // [v1.3c-2] ⛔4: no literacy clip on a science lesson
    // [v1.3c-5] + R7b (P165, red7 V1–V10): the card's vocative goes BEFORE redaction, found by its shape (copy-rules.js)
    const raw = stripBidi(String(sentence || ''));
    const bare = raw.slice(leadingVocative(raw));
    let s = String(postRedact(bare, teacherName, vocab) || '').replace(LEADING_ADDRESS, '').trim();
    if (!s || s.startsWith('[') || UNSHOWABLE.test(s)) return null; // [v1.3c-5] a placeholder never opens it
    if (!imperative(s)) return null; // R7b (P123, P161): a diagnosis fragment is not a move to try
    if (LABEL_TEXT.test(s) || labels.some((x) => x && s.toLowerCase().includes(String(x).toLowerCase()))) return null;
    const n = Math.round(Number(endS) - Number(startS));
    if (!Number.isFinite(n) || n <= 0) return null;
    // R7c ⛔9 (Q168, Q174; Q181, Q193): a child named inside the sentence → the comparison goes. R7g (COS 002603 1e; panel Z036
    // Z100, R/A sends in v5): a name that cannot go → the plain frame, the sentence not quoted (was: no clip at all)
    const plain = () => ({ reason_en: resolveUx('videoRecoCardFallbackReasonPlain', { language: 'en', params: { n } }), reason_ur: resolveUx('videoRecoCardFallbackReasonPlain', { language: 'ur', params: { n } }) });
    s = childFreeCard(s, { teacher: teacherName, vocab, oovVocab });
    if (!s || rosterIn(s, roster)) return plainIfNamed ? plain() : null; // R7d (Q086): a roster name in any position, a quoted title included
    s = singleQuotes(s).replace(/^[a-z]/, (c) => c.toUpperCase()); // P109: no lower-case start after the strip
    // bd-8hhqhf: a long card sentence is trimmed to fit, in each language (session 077b8021: 224 cp → 308 cp composed in
    // ur, and no clip was sent). The teacher's language must fit; the other one is trimmed when it can be and otherwise
    // stored whole, as before.
    const out = {};
    // R7c §6: the reader's line quotes the sentence; the other language's line quotes it only when it is in that language
    const reader = clampLanguage(language);
    const script = (/[\u0600-\u06FF]/.test(s) && (s.match(/[\u0600-\u06FF]/g) || []).length >= (s.match(/[A-Za-z]/g) || []).length) ? 'ur' : 'en';
    for (const l of ['en', 'ur']) {
      if (l !== reader && l !== script) { out[`reason_${l}`] = resolveUx('videoRecoCardFallbackReasonPlain', { language: l, params: { n } }); continue; }
      const whole = resolveUx('videoRecoCardFallbackReason', { language: l, params: { sentence: s, n } });
      const fit = fitClauses(s, FALLBACK_MAX - ([...whole].length - [...s].length), segment);
      if (!fit && l === reader) return null;
      out[`reason_${l}`] = !fit || fit === s ? whole : resolveUx('videoRecoCardFallbackReason', { language: l, params: { sentence: fit, n } });
    }
    return out;
  } catch (e) {
    return null;
  }
}

// R7g (COS 002603 1c; panel Z040 Z077 Z135, list A's only wrong rows): the card frame says "this clip shows one way to do
// it", so one of the chapter's moves must be named in the card's sentence. Moves with no entry are not judged.
const MOVE_WORDS = Object.freeze({
  think_pair_share: /student[- ]to[- ]student|think[- ]pair|\bpairs?\b|\bpartners?\b|\bneighbou?rs?\b|turn[- ](?:and|to)[- ](?:talk|tell|your)|جوڑ|جوڑی|ساتھی|پیئر|پارٹنر/iu,
  open_questions: /\bwhy\b|\bhow\b|open[- ]ended|open questions?|کیوں|کیسے|کھلے سوال|کھلا سوال|اوپن/iu,
  ask_for_reasoning: /\bwhy\b|\bhow\b|\bexplain|\breasons?\b|کیوں|کیسے|وجہ|وضاحت|سمجھا/iu,
  follow_up_probe: /\bwhy\b|\bhow\b|follow[- ]up|probe|کیوں|کیسے|مزید سوال/iu,
  explain_why: /\bwhy\b|\bexplain|\breasons?\b|کیوں|وجہ|وضاحت/iu,
  wait_time: /\bwait|\bpause|seconds|سیکنڈ|انتظار/iu,
  specific_feedback: /feedback|\bpraise|\bspecific|['‘"]good['’"]|well done|فیڈبیک|تعریف|شاباش|نصیحت/iu,
  next_step_feedback: /feedback|\bpraise|next step|well done|فیڈبیک|تعریف|شاباش|نصیحت|اگلا قدم/iu,
  concrete_pictorial_abstract: /concrete|counters|\bobjects\b|manipulative|pictures?|pictorial|\bdraw|bottle caps|ٹھوس|تصویر|اشیا|ڈھکن|کاؤنٹر/iu,
  student_explains_in_own_words: /own words|sentence (?:starters?|stems?|frames?)|اپنے الفاظ|اپنی زبان/iu, // not a bare "explain" (Z077)
  closure_check: /exit (?:ticket|slip)|what (?:did )?(?:we|you|they) learn|summar|recap|key points?|at the end|end of (?:the )?(?:lesson|class)|کیا سیکھا|خلاصہ|نکات|اپنی زبان میں|اپنے الفاظ میں|آخر میں|اختتام/iu,
  differentiate_tasks: /\blevel(?:s|led|ed)?\b|\btiers?\b|tiered|\beasy\b|\bhard\b|challenge|support|stretch|سطح|لیول|آسان|مشکل|چیلنج|گروپ/iu,
  group_work: /\bgroups?\b|\btogether\b|\bpairs?\b|\bpartners?\b|student[- ]to[- ]student|گروپ|ٹولی|جوڑ|ساتھی/iu,
  student_choice: /\bchoice|\bchoose|\bvoice\b|\bagency\b|انتخاب|پسند/iu,
  group_by_level: /\blevels?\b|\btiers?\b|\bgroups?\b|سطح|لیول|گروپ/iu,
  peer_self_assessment: /assess|checklist|rubric|self[- ]check|review each other|جانچ|چیک لسٹ|روبرک|جائزہ/iu,
});

/**
 * The card's sentence names one of the chapter's moves. A chapter none of whose moves has an entry is not judged (true),
 * unless `strict` (the plain frame for a card that names a child needs the move named, R7g 1e: Z078 stays silent).
 */
function cardMoveOk(sentence, segment, { strict = false } = {}) {
  const known = ((segment && segment.moves) || []).map((m) => MOVE_WORDS[m]).filter(Boolean);
  if (!known.length) return !strict;
  const s = stripBidi(String(sentence || ''));
  return known.some((rx) => rx.test(s));
}

/** R7g 1b: a model-written Urdu line that passes every Urdu check (script, Roman Urdu, gender, tense and voice). */
function urduLineOk(text) {
  const t = String(text || '');
  return arabicShare(t) >= 0.6 && latinRun(t) <= 2 && !OTHER_SCRIPT.test(t.replace(QUOTED, ' ')) && !genderedUrdu(t) && !urduSlip(t);
}

module.exports = { cardFrame, cardMoveOk, urduLineOk, routineQuote, lessonlessQuote, groundReasons, rosterSet, rosterIn, pick, validate, quoteFound, storedQuote, reasoningEffort, cardFallback, postRedact, subjectVocab, topicVocab, JOB, LLM_TIMEOUT_MS };
