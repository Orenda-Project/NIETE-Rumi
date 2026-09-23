'use strict';
/**
 * LP-born quiz — the KEY CHECK, between authoring and the hand-off.
 *
 * WHY THIS EXISTS. On sandbox, a Grade 3 Urdu singular/plural quiz went out
 * with one item keyed to the lesson's own planted misconception: "what do you
 * do to make the plural of بہار?" → «اس کی شکل نہیں بدلے گی» ("its form will
 * not change"). The slide script says the opposite three times — a vocabulary
 * definition («بہار سے بہاریں»), the We-Do check that plants exactly this
 * mistake for the class to correct («احمد کہتا ہے کہ 'بہار' کی جمع 'بہار' ہی
 * رہے گی … کیا وہ درست ہے؟»), and the homework answer. The author is handed the
 * misconception so it can build WRONG options from it, and once in 24 items it
 * made it the RIGHT one. The validator checks shape, language, level and
 * pictures; nothing compared a key with the lesson. A quiz that teaches children
 * the misconception is the worst thing this feature can send.
 *
 * WHAT IT DOES. An lp_v8 quiz is written from a written source, so its keys can
 * be checked against that source:
 *
 *   1. `sourceAnswers(slideScript)` — pure — gathers the lesson's own stated
 *      facts and worked answers (vocabulary definitions, key facts, the I-Do /
 *      We-Do worked examples, the practice and exit answers, homework answers)
 *      and, SEPARATELY, the mistakes the plan warns about, plus the check
 *      questions it puts to the class (where a planted mistake usually lives:
 *      "X says … — is X right?"). The split is the point: the checker has to
 *      know which statements in the lesson are WRONG.
 *   2. `checkKeys()` — ONE LLM call through the pipeline's JSON client — asks,
 *      per item, whether the KEYED option agrees with the lesson, and returns
 *      `{index, verdict: consistent|contradicts|unclear, quote}`.
 *
 * What the generate step does with a contradiction (re-author once through the
 * existing targeted rewrite, re-check, drop, or fail as `key_conflict`) lives
 * in `transcript-quiz-generate.service.js`, beside every other recovery step.
 *
 * TWO CONTRACTS ASSERTED IN CODE (root rule 24c), not left to the prompt:
 *   - a reply with no `verdicts` array is a FAILED check (the caller fails open
 *     and says so at error), never "every key is fine";
 *   - a verdict outside the three values, or an item the reply skipped, is
 *     `unclear` — it neither blocks the quiz nor counts as a pass.
 *
 * The transcript quiz has no written source and is never checked here.
 * Pure except for the one LLM call: no DB, no WhatsApp, no R2.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { LANG_NAME } = require('./transcript-quiz-language');
const Multi = require('./transcript-quiz-multi');

/** One line of the lesson, at most this many code points (the long ones are teacher prose). */
const LINE_MAX = 280;
/** Section caps: a real slide script yields ~15-30 fact lines; the caps bound a pathological one. */
const FACTS_MAX = 40;
const MISTAKES_MAX = 10;
const CHECKS_MAX = 10;
const VERDICTS = new Set(['consistent', 'contradicts', 'unclear']);
const LABEL = 'lp_quiz.key_check';

const cp = (s) => [...String(s)].length;
const arr = (v) => (Array.isArray(v) ? v : []);

/** A field as one trimmed line, cut to LINE_MAX code points. */
function line(v) {
  if (v == null || typeof v === 'object') return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return cp(s) > LINE_MAX ? `${[...s].slice(0, LINE_MAX - 1).join('')}…` : s;
}

/** "prompt → answer" (with worked steps between them), or '' when there is no answer to carry. */
function qa(prompt, answer, work) {
  const a = line(answer);
  if (!a) return '';
  const p = line(prompt);
  const steps = arr(work).map(line).filter(Boolean).slice(0, 4);
  const middle = steps.length ? ` (${steps.join('؛ ')})` : '';
  return line(p ? `${p}${middle} → ${a}` : `${middle.trim()} ${a}`.trim());
}

/** A worked example ({problem, work, answer}) as one line. */
function worked(w) {
  return w && typeof w === 'object' ? qa(w.problem, w.answer, w.work) : '';
}

/** A {prompt, answer}-shaped item, or a plain line. */
function item(x) {
  if (x && typeof x === 'object') {
    return qa(x.prompt || x.question || x.q || x.text, x.answer || x.a || x.key, x.work);
  }
  return line(x);
}

/** An exit option, with its choices when the answer is only a letter. */
function exitLine(o) {
  if (!o || typeof o !== 'object') return '';
  const choices = arr(o.choices).map(line).filter(Boolean);
  const listed = choices.length ? ` [${choices.map((c, k) => `${'ABCD'[k] || k + 1}) ${c}`).join(' | ')}]` : '';
  return qa(`${line(o.prompt)}${listed}`, o.answer || o.correct, null);
}

/**
 * A misconception in either shape a plan writes one: a string, or {slip, why, fix}.
 * Only the SLIP is carried. The `why` often states something true ("some words,
 * like قلم, keep their form") and the `fix` is an instruction to the teacher;
 * under a heading that says "every statement here is WRONG", either would teach
 * the checker to flag a correct key.
 */
function mistakeLine(m) {
  if (!m) return '';
  if (typeof m === 'string') return line(m);
  if (typeof m !== 'object') return '';
  return line(m.slip || m.mistake || m.text);
}

function pushAll(list, values, max) {
  values.forEach((v) => {
    if (v && list.length < max && !list.includes(v)) list.push(v);
  });
}

/**
 * The lesson's own answers, and — kept apart — its planted mistakes and the
 * check questions it puts to the class. Pure.
 *
 * Reads the slide-script shape the LP renderer writes (the same one
 * `lp-quiz-digest.service` reads). Homework is read in either shape it takes: a
 * plain line (whose text may carry its answer) or `{prompt, answer}`. The exit
 * options ARE read here, although the digest never forwards them to the author:
 * the digest keeps the author from REUSING the exit question; this call only
 * reads the lesson's answers.
 *
 * @param {object} slideScript
 * @returns {{facts:string[], mistakes:string[], checks:string[]}}
 */
function sourceAnswers(slideScript) {
  const ss = slideScript && typeof slideScript === 'object' ? slideScript : {};
  const hook = ss.hook || {};
  const iDo = ss.iDo || {};
  const weDo = ss.weDo || {};
  const youDo = ss.youDo || {};
  const wrap = ss.wrap || {};
  const facts = [];
  const mistakes = [];
  const checks = [];

  // Vocabulary: the definition is the lesson's own statement of the rule.
  const vocab = [...arr(hook.keyWords), ...arr(ss.keyWords), ...arr(ss.vocab), ...arr(hook.vocab)];
  pushAll(facts, vocab.map((w) => {
    if (!w || typeof w !== 'object') return line(w);
    const term = line(w.term || w.word);
    const gloss = line(w.urdu || w.gloss || w.meaning);
    const def = line(w.def || w.definition);
    if (!term || (!gloss && !def)) return '';
    return line(`${term}${gloss ? ` (${gloss})` : ''}${def ? `: ${def}` : ''}`);
  }), FACTS_MAX);

  const warm = hook.warmUp || {};
  pushAll(facts, [
    qa(warm.teacherAsks, warm.expectedAnswer, null),
    line(iDo.keyFact),
    worked(iDo.worked),
    qa(iDo.cfu, iDo.cfuPassSignal, null),
    worked(weDo.modelled),
    qa(weDo.cfu, weDo.cfuPassSignal, null),
    ...arr(youDo.problems).map(item),
    item(youDo.wordProblem),
    item(youDo.behind),
    item(youDo.ahead),
    ...arr(wrap.exitOptions).map(exitLine),
    ...arr(wrap.keyFacts).map(line),
    ...arr(wrap.homework).map(item),
    // An answer key for the homework, wherever the plan keeps it.
    ...Object.keys(wrap).filter((k) => /^homework.*(answer|key)/i.test(k))
      .flatMap((k) => (Array.isArray(wrap[k]) ? wrap[k] : [wrap[k]]).map(item)),
    line(ss.exitSuccessCriteria),
  ], FACTS_MAX);

  pushAll(mistakes, [
    mistakeLine(iDo.misconception),
    mistakeLine(weDo.misconception),
    mistakeLine(youDo.misconception),
    ...arr(ss.misconceptions).map(mistakeLine),
  ], MISTAKES_MAX);

  // A check question is never a fact: a claim inside one ("X says … — is X
  // right?") is put to the class to TEST, and is often the planted mistake.
  pushAll(checks, [iDo.cfu, weDo.cfu, youDo.cfu, wrap.cfu].map(line), CHECKS_MAX);

  return { facts, mistakes, checks };
}

/** The three sections as the checker reads them; '' when the lesson states nothing checkable. */
function renderSourceBlock(source) {
  const s = source || {};
  const facts = arr(s.facts);
  const mistakes = arr(s.mistakes);
  const checks = arr(s.checks);
  if (!facts.length && !mistakes.length) return '';
  const list = (xs) => xs.map((x) => `- ${x}`).join('\n');
  return [
    facts.length ? `THE LESSON'S OWN FACTS AND WORKED ANSWERS — every line here is TRUE for this quiz:\n${list(facts)}` : null,
    mistakes.length ? `MISTAKES THE LESSON EXPECTS CHILDREN TO MAKE — every statement here is WRONG:\n${list(mistakes)}` : null,
    checks.length ? `QUESTIONS THE LESSON PUTS TO THE CLASS — a claim inside one of these (for example "X says … — is X right?") is put up to be TESTED. It is never a fact; where the facts above disagree with it, it is a planted mistake and it is WRONG:\n${list(checks)}` : null,
  ].filter(Boolean).join('\n\n');
}

/** The positions an item keys as correct: one for an ordinary question, a set for "select all". */
function keyedIndices(q) {
  if (Multi.isMultiQuestion(q)) return Multi.authoredCorrectIndices(q);
  const n = Number(q && q.correct_index);
  return Number.isInteger(n) ? [n] : [];
}

/** The keyed option(s) as text — what the checker judges and what the record shows. */
function keyedText(q) {
  const opts = arr(q && q.options);
  return keyedIndices(q).map((i) => String(opts[i] ?? '').trim()).filter(Boolean).join(' + ');
}

/**
 * THE CHECKER PROMPT. The lesson first, then the items, then the verdict rule.
 * Written in English; the lesson and the quiz stay in their own language and
 * the quote is asked for verbatim.
 */
function buildKeyCheckPrompt({ sourceBlock, questions, indices, language }) {
  const qs = arr(questions);
  const items = indices.map((i) => {
    const q = qs[i] || {};
    const opts = arr(q.options).map((o, k) => `[${k}] ${String(o ?? '').trim()}`).join(' | ');
    const keyed = keyedIndices(q).map((k) => `[${k}] ${String(arr(q.options)[k] ?? '').trim()}`).join('; ');
    const multi = Multi.isMultiQuestion(q) ? ' (all that apply)' : '';
    return `q${i}: ${String(q.question || '').trim()}\n  options: ${opts}\n  marked correct${multi}: ${keyed || '(none)'}`;
  }).join('\n\n');

  return [
    `You are CHECKING THE ANSWER KEY of a short quiz for children, written from ONE lesson plan. For each question, decide whether the answer MARKED CORRECT agrees with what the lesson itself says. The lesson and the quiz are in ${LANG_NAME[language] || 'the lesson\'s own language'}.`,
    `THE LESSON\n\n${sourceBlock}`,
    `THE QUIZ — each question, its options, and the one marked correct\n\n${items}`,
    `For EACH question give one verdict:
- "contradicts": the marked answer disagrees with a fact or worked answer in the lesson, OR it says one of the lesson's mistakes — including a claim the lesson puts to the class to test and then corrects. Quote, word for word and in the lesson's own language, the ONE line of the lesson that shows it.
- "consistent": the lesson supports the marked answer.
- "unclear": the lesson says nothing that decides this question either way.
Judge ONLY the marked answer against the LESSON. Do not re-solve the question from your own knowledge, and do not judge wording, level, style, or whether another option could also be defended. Say "contradicts" only when you can quote the line.`,
    `Return ONLY this JSON object, one entry per question above, "index" being the number after its q:
{ "verdicts": [ { "index": ${indices[0] ?? 0}, "verdict": "consistent|contradicts|unclear", "quote": "" } ] }`,
  ].join('\n\n');
}

/** Letters, digits and marks only — so a quote matches the lesson through punctuation, spacing and diacritics. */
function squash(s) {
  return String(s || '').normalize('NFC').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * The reply, held to its contract. Throws when there is no `verdicts` array —
 * the caller treats that as a failed check, never as "all consistent". One
 * verdict per REQUESTED index, in order: a verdict outside the three values is
 * `unclear`, and so is an index the reply skipped (`missing: true`). A
 * `contradicts` carries whether its quote is actually in the lesson
 * (`grounded`), so a model that invents its evidence shows up in the telemetry.
 *
 * @returns {{index:number, verdict:string, quote:string, grounded?:boolean, missing?:boolean}[]}
 */
function parseVerdicts(json, indices, sourceBlock) {
  if (!json || !Array.isArray(json.verdicts)) throw new Error(`${LABEL}: the reply carries no "verdicts" array`);
  const byIndex = new Map();
  json.verdicts.forEach((v) => {
    const i = Number(v && v.index);
    if (!Number.isInteger(i) || !indices.includes(i) || byIndex.has(i)) return;
    byIndex.set(i, v);
  });
  const haystack = squash(sourceBlock);
  return indices.map((index) => {
    const v = byIndex.get(index);
    if (!v) return { index, verdict: 'unclear', quote: '', missing: true };
    const said = String(v.verdict || '').trim().toLowerCase();
    const verdict = VERDICTS.has(said) ? said : 'unclear';
    const quote = typeof v.quote === 'string' ? v.quote.trim() : '';
    const out = { index, verdict, quote };
    if (verdict === 'contradicts') out.grounded = Boolean(quote) && haystack.includes(squash(quote));
    return out;
  });
}

/**
 * The complaint a contradicting item carries into the targeted rewrite — the
 * same `q<i>: CODE — …` shape every validator complaint has, so the existing
 * rewrite takes it as one question's text to rewrite.
 */
function conflictComplaint(verdict, q) {
  const keyed = keyedText(q) || '(none)';
  const quote = line(verdict && verdict.quote) || '(no line quoted)';
  return `q${verdict.index}: KEY_CONFLICT — the answer marked correct ("${keyed}") contradicts the lesson, which says: "${quote}". Mark as correct the answer the lesson teaches; the lesson's mistake may only ever be a WRONG option.`;
}

/**
 * ONE call. Checks every item, or only `indices` (the re-check after a rewrite).
 * Throws on an LLM failure or an unusable reply — the caller decides what a
 * failed check means (it fails open). Returns `skipped: 'no_source'` with no
 * call at all when the lesson states nothing to check against.
 *
 * @returns {Promise<{verdicts:object[], model:string|null, costUsd:number,
 *   latencyMs:number, skipped?:string, sourceLines?:object}>}
 */
async function checkKeys({
  questions, slideScript, language, indices = null, quizId = null,   // eslint-disable-line no-unused-vars
}) {
  const qs = arr(questions);
  const idx = Array.isArray(indices) ? indices.filter((i) => Number.isInteger(i) && qs[i]) : qs.map((_, i) => i);
  const source = sourceAnswers(slideScript);
  const sourceBlock = renderSourceBlock(source);
  const sourceLines = { facts: source.facts.length, mistakes: source.mistakes.length, checks: source.checks.length };
  if (!sourceBlock || !idx.length) {
    return { verdicts: [], model: null, costUsd: 0, latencyMs: 0, skipped: 'no_source', sourceLines };
  }
  const prompt = buildKeyCheckPrompt({ sourceBlock, questions: qs, indices: idx, language });
  // 8000 like the targeted rewrite: a reasoning model spends its budget
  // thinking, and a truncated reply here is a failed check, not a verdict.
  const {
    json, model, costUsd, latencyMs,
  } = await completeJson({ prompt, maxTokens: 8000, label: LABEL });
  return {
    verdicts: parseVerdicts(json, idx, sourceBlock),
    model,
    costUsd: Number(costUsd) || 0,
    latencyMs,
    sourceLines,
    promptChars: cp(prompt),
  };
}

module.exports = {
  sourceAnswers, renderSourceBlock, buildKeyCheckPrompt, parseVerdicts, conflictComplaint, checkKeys,
  keyedIndices, keyedText, LABEL, LINE_MAX,
};
