'use strict';
/**
 * Transcript quiz — THE LESSON SUMMARY IS TRUE BY THE SUBJECT.
 *
 * The teacher's PDF opens with what the lesson covered: the "What you taught"
 * line (the author's `lesson_summary_short`, else the first sentence of its
 * `lesson_summary`), the "What this quiz checks" line, and — on every question
 * card — the objective (the digest's SLO statement). All of them are written
 * from a recording of the class, and a recording can hold a mistake: a lesson
 * that called 4/8 not a proper fraction, or Earth the largest planet. Both
 * writers were asked to record what was SAID, so the mistake came back to the
 * teacher in the second person as what they taught ("you taught that the
 * largest planet is Earth") while the quiz under it — whose keys are checked
 * against the subject — said the opposite. Measured on the 136 production
 * quizzes that carried a wrong key: one in five printed the class's wrong fact
 * as correct somewhere on the sheet.
 *
 * The operator's decision (option B): the sheet never presents the wrong fact
 * as correct. Not a correction note, not a message to anyone — the line simply
 * stops asserting it. This module is the guarantee, the way the context-free
 * second solve is for the keys: every teacher-facing line is shown to the
 * verify model with NOTHING about the lesson, so a mistake made in class
 * cannot vouch for itself. A line it names as false comes back with a minimal
 * rewrite; CODE — never the model — decides whether that rewrite is taken
 * (same script, similar length, no blame word, no gendered teacher form), and a
 * rewrite that is not taken drops the line instead.
 *
 * Pure except the one LLM call: no DB, no WhatsApp, no R2. The caller
 * (transcript-quiz-generate runSummaryTruth) fails open on a throw.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { todaysModel } = require('../../config/model-registry');
const { addressForms } = require('./transcript-quiz-address');
const { genderedTeacherForms } = require('./transcript-quiz-pedagogy');

const LABEL = 'transcript_quiz.summary_truth';
/** The verify model's own job and spend line — the same model that solves the keys. */
const JOB = 'quiz.keyVerify';
const LINE_MAX = 600;
const CLAIM_MAX = 160;
const HINT_MAX = 200;
const HINTS_MAX = 12;

const cp = (s) => [...String(s ?? '')].length;
const line = (v) => String(v ?? '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (cp(s) > n ? `${[...String(s)].slice(0, n - 1).join('')}…` : String(s));

/** Sentence ends in either script, the same split the PDF's "What you taught" line uses. */
function sentences(text) {
  return String(text || '').trim().split(/(?<=[.!?۔؟])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Is this an Urdu line? Any real run of Arabic-script letters says so: an Urdu
 * line keeps its English terms in English letters («آپ نے Proper Fraction
 * پڑھایا…» is more Latin than Urdu by letter count), and an English line has
 * none at all. The language a rewrite must keep.
 */
function isUrduLine(text) {
  return (String(text || '').match(/\p{Script=Arabic}/gu) || []).length >= 4;
}

// Words that turn a summary into a correction note. Option C (telling the
// teacher a fact to check) was NOT approved, so a rewrite that brings one in is
// refused — unless the line already carried the word (an objective can be about
// choosing "the correct article").
const BLAME = [
  /\b(?:incorrect(?:ly)?|wrong(?:ly)?|mistaken?|mistakes?|actually|in fact|correct(?:ed|ion)|misconceptions?|not true|errors?|inaccurate(?:ly)?)\b/i,
  /(?:غلط|غلطی|درست نہیں|صحیح نہیں|دراصل|اصل میں|تصحیح|حقیقت میں)/,
];
const blameWords = (s) => BLAME.flatMap((re) => String(s || '').match(new RegExp(re.source, `${re.flags}g`)) || []);

/**
 * THE CONTRACT FOR A REWRITE, in code (root rule 24c). Returns the reason it is
 * refused, or null when it may replace the line.
 */
function rewriteRefusal(original, rewrite, { maxWords = null } = {}) {
  const r = line(rewrite);
  const o = line(original);
  if (!r) return 'empty';
  if (r === o) return 'unchanged';
  if (cp(r) < 8) return 'too_short';
  if (cp(r) > Math.max(Math.round(cp(o) * 1.5), cp(o) + 40)) return 'too_long';
  if (maxWords && r.split(/\s+/).length > maxWords) return 'too_many_words';
  const urOriginal = isUrduLine(o);
  if (urOriginal !== isUrduLine(r)) return 'script_changed';
  const had = new Set(blameWords(o).map((w) => w.toLowerCase()));
  if (blameWords(r).some((w) => !had.has(w.toLowerCase()))) return 'blame_word';
  if (urOriginal || /\p{Script=Arabic}/u.test(r)) {
    const before = genderedTeacherForms(o, 'ur').length + addressForms(o, { kind: 'explanation' }).length;
    const after = genderedTeacherForms(r, 'ur').length + addressForms(r, { kind: 'explanation' }).length;
    if (after > before) return 'gendered';
  } else if (genderedTeacherForms(r, 'en').length > genderedTeacherForms(o, 'en').length) {
    return 'gendered';
  }
  return null;
}

/**
 * Every teacher-facing line, once per distinct text, each with the places it
 * is printed. An SLO whose `statement` and `statement_en` are the same words is
 * checked once and fixed in both.
 *
 * @returns {{id:string, text:string, kind:string, targets:object[]}[]}
 */
function collectLines({ lessonSummary, extras, slos }) {
  const out = [];
  const byText = new Map();
  const add = (kind, text, target) => {
    const t = line(text);
    if (!t) return;
    const key = `${kind === 'slo' ? 'slo' : 'prose'}|${t}`;
    if (byText.has(key)) { byText.get(key).targets.push(target); return; }
    const entry = { id: `L${out.length + 1}`, text: t, kind, targets: [target] };
    byText.set(key, entry);
    out.push(entry);
  };
  if (extras && extras.lesson_summary_short) add('short', extras.lesson_summary_short, { field: 'short' });
  sentences(lessonSummary).forEach((s, i) => add('summary', s, { field: 'summary', index: i }));
  if (extras && extras.checks_summary) add('checks', extras.checks_summary, { field: 'checks' });
  (Array.isArray(slos) ? slos : []).forEach((s, i) => {
    ['statement', 'statement_en', 'statement_ur'].forEach((f) => {
      if (s && typeof s[f] === 'string') add('slo', s[f], { field: 'slo', index: i, key: f });
    });
  });
  return out;
}

/**
 * THE PROMPT. Nothing about the lesson reaches it: not the transcript, not the
 * digest, not the questions. Only the lines, the subject, the grade — and the
 * facts the quiz's own blind solve noted where it disagreed with a key (it
 * answers by the subject; its note names the fact the lesson may have got
 * wrong, e.g. "the first step of long division is divide"). A hint helps the
 * check see a line that repeats the lesson's version; it never decides one.
 */
function buildTruthPrompt({
  lines, subject = null, grade = null, hints = [],
}) {
  const listed = lines.map((l) => `[${l.id}] (${l.kind === 'slo' ? 'an objective' : 'says what the lesson covered'}) ${cut(l.text, LINE_MAX)}`).join('\n');
  const found = (Array.isArray(hints) ? hints : []).map((h) => cut(line(h), HINT_MAX)).filter(Boolean).slice(0, HINTS_MAX);
  return [
    `You are checking the lines printed on a teacher's sheet about ONE school lesson${subject ? ` (subject ${line(subject)}` : ''}${grade ? `${subject ? ', ' : ' ('}grade ${line(grade)}` : ''}${subject || grade ? ')' : ''}. You are told NOTHING about the lesson itself, on purpose: judge every line by the subject alone, the way a careful teacher who knows the subject would.`,
    'For EACH line, decide whether it states — as true, or as what was taught — a claim that is FALSE by the subject: a wrong definition, formula, rule, spelling, count, meaning, name, date or fact. A line that only names a topic, an example, an activity or an objective, without asserting anything wrong, is fine: "you compared 1/4, 4/8 and 2/5" is fine; "you taught that 4/8 is not a proper fraction" is false; "Identify proper fractions" is fine; "Learn that the largest planet is Earth" is false. A claim you cannot judge without having been in the lesson (which examples were used, what a story said, what happened in class) is fine — never guess. Judge facts of the subject only: an assumption about the children, a teaching choice, a tone or an opinion is not a false claim, and an objective is false only when it would teach a wrong fact, rule, definition, method or spelling — what the children are asked to do, or to say about themselves, never is. Style, grammar and translation quality are not your concern.',
    'For a line that IS false, write "rewrite": the same line with the false claim taken out. A line that says what the lesson covered names that part of the lesson by its topic or its example WITHOUT the claim ("you also worked through an example with 24 and 30") — never put a different, correct claim in the lesson\'s mouth, because the lesson did not say it. An objective keeps the skill it names and loses only the false part — a wrong name, rule or attribution attached to it ("Set up the subtraction in hundreds, tens and ones columns"); only when the skill itself is the wrong fact does it become the correct objective the lesson was working toward ("Identify proper fractions"). Never swap in a different skill: the questions under an objective were written for the skill it names. Every false line comes back with a rewrite — an objective always keeps at least the skill it names, in plain words; a sentence that is nothing but the false claim may say only what part of the lesson it was about. Keep the line\'s own language and script (Urdu stays in Urdu script, English terms in English letters as they were), its voice ("you" / «آپ» where it uses it), and about its length; change nothing else. Never say or imply that the teacher, the class or anyone was wrong, mistaken or corrected, and never add a note, a label or a correction.',
    found.length
      ? `WHAT THE QUIZ'S OWN ANSWER CHECK FOUND — an independent solver answered this lesson's quiz questions by the subject alone and noted these facts, where the lesson may have said otherwise. Use them to recognise a line that repeats what the lesson said instead, but judge each line yourself: a note is not an order, and a line is false only if it is false by the subject.\n${found.map((h) => `- ${h}`).join('\n')}`
      : null,
    `THE LINES\n${listed}`,
    'Return ONLY this JSON object, one entry per line above, "id" as given:\n{ "lines": [ { "id": "L1", "false": false, "claim": "", "rewrite": "" } ] }\n"claim" (only when "false" is true): the false claim, in a few English words.',
  ].filter(Boolean).join('\n\n');
}

/**
 * The reply, held to its contract. Throws when there is no `lines` array — the
 * caller treats that as a failed check (fail-open), never as "all true".
 *
 * @returns {Map<string, {false:boolean, claim:string, rewrite:string}>}
 */
function parseVerdicts(json, lines) {
  if (!json || !Array.isArray(json.lines)) throw new Error(`${LABEL}: the reply carries no "lines" array`);
  const wanted = new Set(lines.map((l) => l.id));
  const out = new Map();
  json.lines.forEach((v) => {
    const id = String((v && v.id) || '');
    if (!wanted.has(id) || out.has(id)) return;
    out.set(id, {
      false: v.false === true,
      claim: cut(line(v.claim), CLAIM_MAX),
      rewrite: typeof v.rewrite === 'string' ? v.rewrite : '',
    });
  });
  return out;
}

/**
 * What each flagged line becomes: its rewrite, if the contract takes it, else
 * nothing (the line is dropped).
 *
 * @returns {{decisions: Map<string,{action:'rewritten'|'dropped', text?:string, why?:string, claim:string}>, missing:number}}
 */
function decide(lines, verdicts) {
  const decisions = new Map();
  let missing = 0;
  lines.forEach((l) => {
    const v = verdicts.get(l.id);
    if (!v) { missing += 1; return; }
    if (!v.false) return;
    const why = rewriteRefusal(l.text, v.rewrite, { maxWords: l.kind === 'short' ? 40 : null });
    decisions.set(l.id, why
      ? { action: 'dropped', why, claim: v.claim }
      : { action: 'rewritten', text: line(v.rewrite), claim: v.claim });
  });
  return { decisions, missing };
}

/**
 * Apply the decisions to the texts the sheet prints. Pure.
 *
 * @returns {{lessonSummary:string, extras:object, slos:object[]}}
 */
function applyDecisions({ lessonSummary, extras, slos }, lines, decisions) {
  const summary = sentences(lessonSummary).map((s) => ({ text: s }));
  const nextExtras = { ...(extras || {}) };
  const nextSlos = (Array.isArray(slos) ? slos : []).map((s) => ({ ...s }));
  lines.forEach((l) => {
    const d = decisions.get(l.id);
    if (!d) return;
    const value = d.action === 'rewritten' ? d.text : null;
    l.targets.forEach((t) => {
      if (t.field === 'short') nextExtras.lesson_summary_short = value;
      else if (t.field === 'checks') nextExtras.checks_summary = value;
      else if (t.field === 'summary') summary[t.index].text = value;
      else if (t.field === 'slo') nextSlos[t.index][t.key] = value || '';
    });
  });
  return {
    lessonSummary: summary.map((s) => s.text).filter(Boolean).join(' '),
    extras: nextExtras,
    slos: nextSlos,
  };
}

/**
 * Check every teacher-facing line of one quiz. Throws on an LLM failure or an
 * unusable reply — the caller decides what that means (it fails open).
 *
 * @returns {Promise<{lessonSummary:string, extras:object, slos:object[], checked:number,
 *   flagged:number, rewritten:number, dropped:number, missing:number,
 *   lines:{kind:string, action:string, why?:string, claim:string}[],
 *   model:string|null, costUsd:number, latencyMs:number}>}
 */
async function checkSummaryTruth({
  lessonSummary = '', extras = {}, slos = [], subject = null, grade = null, hints = [],
}) {
  const lines = collectLines({ lessonSummary, extras, slos });
  const same = {
    lessonSummary: String(lessonSummary || ''), extras: { ...(extras || {}) }, slos: Array.isArray(slos) ? slos : [],
  };
  if (!lines.length) {
    return {
      ...same, checked: 0, flagged: 0, rewritten: 0, dropped: 0, missing: 0, lines: [], model: null, costUsd: 0, latencyMs: 0, skipped: 'nothing_to_check',
    };
  }
  const requested = todaysModel(JOB);
  const {
    json, model, costUsd, latencyMs,
  } = await completeJson({
    prompt: buildTruthPrompt({
      lines, subject, grade, hints,
    }),
    maxTokens: 6000,
    label: LABEL,
    model: requested,
    job: JOB,
  });
  const verdicts = parseVerdicts(json, lines);
  const { decisions, missing } = decide(lines, verdicts);
  const applied = applyDecisions({ lessonSummary, extras, slos }, lines, decisions);
  const acted = lines.filter((l) => decisions.has(l.id)).map((l) => {
    const d = decisions.get(l.id);
    return { kind: l.kind, action: d.action, ...(d.why ? { why: d.why } : {}), claim: d.claim };
  });
  return {
    ...applied,
    checked: lines.length,
    flagged: acted.length,
    rewritten: acted.filter((a) => a.action === 'rewritten').length,
    dropped: acted.filter((a) => a.action === 'dropped').length,
    missing,
    lines: acted,
    model: model || requested,
    costUsd: Number(costUsd) || 0,
    latencyMs,
  };
}

module.exports = {
  checkSummaryTruth, buildTruthPrompt, collectLines, parseVerdicts, decide, applyDecisions, rewriteRefusal, sentences, LABEL, JOB,
};
