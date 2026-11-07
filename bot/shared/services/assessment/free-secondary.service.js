'use strict';
/**
 * bd-5jmnfj.38.31 — the free-mode paper for grades 6 and up (no board pattern).
 *
 * Until now a G6-8 free paper ran the G1-5 generateExam unchanged, and the panel of 2026-11-06
 * blocked two of them. This runs the same call (same model, job, temperature and post-processing,
 * from the generation service's own exports) with three changes:
 *   1. the grades 6-12 rules (free-secondary-rules.js) sit before the safety policies;
 *   2. the requested count is kept and fitted to the band's time by turning extended answers into short
 *      ones, then by lighter marks per written item (Rules.sizeTypes); the writer is asked for about 30%
 *      more MCQs, the subset with the fewest leaks is kept, and the dropped ones stand by as spares
 *      for an MCQ still leaking after the rewrites (free-secondary-pool.js);
 *   3. the draft is checked (free-secondary-checks.js); its problems go on to the review and the targeted
 *      rewrite. There is no second whole-paper draft (bd-5jmnfj.38.40: it cost about two minutes);
 *   4. one small call, on assessment.review with a model of another family than the writer, rates each MCQ distractor and flags
 *      a longest-option key, two defensible options, an odd-one-out key or an option that does not complete
 *      the stem (free-secondary-review.js);
 *   5. items still leaking, or with a longest-option key, an absolute distractor or one rated 1, are rewritten on
 *      their own (free-secondary-rewrite.js), in one round, kept only if it leaves fewer problems.
 * The writer, the review and the rewrite ask the model in force for little thinking (`quick`): with full
 * thinking a G6+ paper took 6-9 minutes against about 1 for a G1-5 paper (bd-5jmnfj.38.40).
 * Then writer instructions are stripped from the marking points and an Urdu paper is put in one digit
 * system (free-secondary-tidy.js), number options
 * are put in ascending order, the MCQ keys
 * are spread from the paper's seed (free-secondary-keys.js), the time is stamped as `_timeMinutes`, and
 * an Urdu-medium paper is marked `_paperLang: 'ur'` so its chrome prints in Urdu.
 *
 * The orchestrator calls this only for grade >= 6, so no G1-5 paper reaches it.
 */

const LLM = require('../llm-client');

const { getClient } = LLM;
const { thinksByDefault, alwaysThinks } = require('../anthropic-native-facade');
const { resolveModelForJob, fallbackForJob } = require('../../config/model-registry');
const { configForRequest, ensureCurrent } = require('../../config/model-settings');
const { logToFile } = require('../../utils/logger');
const { extractJsonFromResponse } = require('./assessment-json.util');
const { applyStems } = require('./topics/stem-prompt');
const { capBlooms, appliesToGrade, APPLY_NOTE } = require('./bloom-ceiling');
const Gen = require('./assessment-generation.service');
const SubjectConfig = require('./subject-config');
const PROMPTS = require('./ict-prompts.json');
const Rules = require('./free-secondary-rules');
const { paperIssues, estimateMinutes, printedMinutes } = require('./free-secondary-checks');
const { balanceKeys, sortNumeric } = require('./free-secondary-keys');
const Rewrite = require('./free-secondary-rewrite');
const Pool = require('./free-secondary-pool');
const { resolveLeaks } = require('./free-secondary-leakfix');
const { typeShortfall } = require('./free-secondary-mix');
const Review = require('./free-secondary-review');
const Levels = require('./free-secondary-levels');
const { statedType } = require('./free-secondary-grammar');
const { stripInstructions, scenarioParts, oneDigitSystem } = require('./free-secondary-tidy');
const { isRtl } = require('./assessment-paper.renderer');

const JOB = 'assessment.generate';
const MAX_OUTPUT_TOKENS = 32000;
const REVIEW_TOKENS = 16000;
// The review's own registry job (approved 2026-11-06): its model, else its registered alternative.
const REVIEW_JOB = 'assessment.review';
// A load over the band's time by more than this share is logged: its larger time prints, no item is cut.
const OVER_BAND = 1.2;
// The G1-5 free prompt each G6-12 subject code borrows. A code not listed keeps today's choice.
const BASE_SUBJECT = { general_science: 'science', english: 'eng', maths: 'maths', urdu: 'urdu', islamiat: 'islamiat' };
const URDU_BASE = new Set(['urdu', 'islamiat', 'genk', 'sst']);

function fail(code, message, extra = {}) {
  return Object.assign(new Error(message), { code }, extra);
}

function familyOf(grade, subject, base) {
  try {
    const row = SubjectConfig.resolve(grade, subject);
    if (row && row.model_family) return row.model_family;
  } catch (_) { /* not a registry cell: fall back to the base prompt's medium */ }
  return URDU_BASE.has(String(base).toLowerCase()) ? 'urdu' : 'eng';
}

/** The model a job's call reaches first: a settings row or the `LLM_JOB_MODELS` map can move it in the client. */
function firstModel(job, site) {
  return typeof LLM.modelInForce === 'function' ? LLM.modelInForce(job, site) : site;
}

/** The thinking setting for a fast call on `model`: off where it can be, low where it cannot; none off Claude. */
function quick(model) {
  if (!thinksByDefault(model)) return undefined;
  return alwaysThinks(model) ? { effort: 'low' } : { enabled: false };
}

/** The writer's setting: low thinking on a Claude that thinks (off left 6 of 7 schemes without a do-not-accept line). */
function brief(model) {
  return thinksByDefault(model) ? { effort: 'low' } : undefined;
}

function emptyReply(response) {
  const choice = response?.choices?.[0] || {};
  const text = choice.message?.content;
  return (text == null || String(text).trim() === '') && choice.finish_reason !== 'length'
    && (Number(response?.usage?.completion_tokens) || 0) === 0;
}

/** The generation service's own clean-up, in its order, on one parsed draft. */
function postProcess(examJson, { grade, plan, totalMarks }) {
  Gen.stripImageKeys(examJson);
  Gen.normaliseAnswers(examJson);
  if (appliesToGrade(grade)) capBlooms(examJson);
  applyStems(examJson, plan.questionTypes);
  const removedSeen = Gen.trimSeen(examJson, plan.seenTarget);
  const marksRemoved = Gen.enforceMarksBudget(examJson, totalMarks);
  return { removedSeen, marksRemoved };
}

async function generateExam(args) {
  const { grade, subject, pageContent, pageReference, contentSource = 'unseen', questionCount,
    questionTypes = [], includeAnswerKey = false, totalMarks = null, seenCount = null, slos = null,
    chapterTitle = null, keySeed = null } = args;
  const checkOpts = { grade, lessonTitle: chapterTitle };

  const base = BASE_SUBJECT[String(subject || '').trim().toLowerCase()] || subject;
  const family = familyOf(grade, subject, base);
  if (typeof ensureCurrent === 'function') await ensureCurrent();
  const cfg = configForRequest() || {};
  const model = resolveModelForJob(JOB, { cfg, family }).model;
  const ownModel = resolveModelForJob(JOB, { family }).model;

  // The teacher's count is kept (a7 ruling on A5e): sizing only converts and lightens items.
  const sized = Rules.sizeTypes(questionTypes, grade);
  const sizedCount = questionCount;
  const plan = Gen.planCounts({ contentSource, questionCount: sizedCount, questionTypes: sized.types, seenCount });
  const pool = Pool.poolTypes(sized.types);
  const keepMcqs = (sized.types.find((t) => t.id === 'mcq') || {}).count || 0;
  let pooled = 0;
  let spares = [];
  // Normalised first so the leak check reads the keys, then cut back to the plan's MCQ count.
  const pick = (exam) => {
    Gen.normaliseAnswers(exam);
    ({ dropped: pooled, spares } = Pool.select(exam, keepMcqs, (e) => paperIssues(e, checkOpts)));
    return exam;
  };
  const system = Rules.withRules(Gen.buildSystemPrompt({ subject: base, includeAnswerKey }),
    PROMPTS['eg.safety.policies'], grade, chapterTitle,
    { light: sized.light, levels: Levels.planText(Levels.plan(sized.types, sized.light), { extraMcqs: pool.extra }) }) + (appliesToGrade(grade) ? APPLY_NOTE : '');
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: Gen.buildUserPrompt({ grade, subject, pageContent, pageReference, contentSource,
      questionCount: sizedCount + pool.extra, questionTypes: pool.types,
      totalMarks: totalMarks == null ? totalMarks : totalMarks + pool.extra, seenCount, slos }) },
  ];
  logToFile('[assessment] generating (grades 6-12 free)', {
    grade, subject, base, model, converted: sized.converted, light: sized.light, types: plan.questionTypes.map((q) => `${q.count} ${q.id}`),
  });

  // Families and thinking are decided on the models in force: a per-job settings row moves a job in the client.
  const inForce = (job, site) => {
    const row = !cfg.killSwitch && cfg.perJob && cfg.perJob[job];
    return typeof row === 'string' && row.includes('/') ? row : site;
  };
  const writerThinking = brief(firstModel(JOB, model));
  const ask = (msgs, thinking = writerThinking) => getClient().chat.completions.create({
    model, job: JOB, ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages: msgs, temperature: 0.7, response_format: { type: 'json_object' }, max_tokens: MAX_OUTPUT_TOKENS,
    ...(thinking ? { reasoning: thinking } : {}),
  });
  // A model that refuses the quick setting is asked once more with its own default.
  const askFirst = async () => {
    try {
      return await ask(messages);
    } catch (err) {
      if (!writerThinking) throw err;
      logToFile('[assessment] quick writer call failed, asking with default thinking', { model, error: err.message });
      return ask(messages, null);
    }
  };
  const startedAt = Date.now();

  let response;
  try {
    response = await askFirst();
    if (emptyReply(response)) response = await ask(messages);
  } catch (err) {
    logToFile('[assessment] model call failed', { model, error: err.message });
    throw fail('MODEL_UNAVAILABLE', 'The question writer is unavailable right now.', { cause: err.message });
  }
  const raw = response?.choices?.[0]?.message?.content || '';
  let examJson;
  try {
    examJson = pick(extractJsonFromResponse(raw));
  } catch (err) {
    const truncated = response?.choices?.[0]?.finish_reason === 'length';
    throw truncated
      ? fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.', { usage: response.usage })
      : fail('BAD_JSON', 'The question writer returned something we could not read.', { cause: err.message });
  }
  let cleaned = postProcess(examJson, { grade, plan, totalMarks });
  let issues = paperIssues(examJson, checkOpts);
  const usage = response.usage || {};
  // Kept in the result for its readers; the whole-paper revision is gone (bd-5jmnfj.38.40).
  const revised = false;

  // The review runs on assessment.review with a model of another family than the writer, so it does not
  // share the writer's blind spots: the job's model in force, else its registered alternative (a Sonnet
  // writer gets a Gemini review), with the writer's model as the fallback; on the writer's own job and
  // model when neither differs. Every item, MCQ and written (a8). Families are compared on the models in force.
  const reviewer = Review.pickReviewer(inForce(JOB, model),
    [inForce(REVIEW_JOB, resolveModelForJob(REVIEW_JOB).model), fallbackForJob(REVIEW_JOB)]
      .map((m) => ({ job: REVIEW_JOB, model: m })));
  const reviewCall = reviewer ? { model: reviewer.model, job: reviewer.job, fallbackModel: model }
    : { model, job: JOB, ...(model !== ownModel ? { fallbackModel: ownModel } : {}) };
  const reviewThinking = quick(firstModel(reviewCall.job, reviewCall.model));
  logToFile('[assessment] distractor review model', { job: reviewCall.job, model: reviewCall.model, thinking: reviewThinking || 'default' });
  const reviewed = await Review.review({
    examJson, grade, existing: issues,
    ask: async (text) => {
      const out = await getClient().chat.completions.create({
        ...reviewCall,
        messages: [{ role: 'user', content: text }], temperature: 0,
        response_format: { type: 'json_object' }, max_tokens: REVIEW_TOKENS,
        ...(reviewThinking ? { reasoning: reviewThinking } : {}),
      });
      return extractJsonFromResponse(out?.choices?.[0]?.message?.content || '');
    },
    onError: (err) => logToFile('[assessment] distractor review skipped', { error: err.message }),
  });
  // a8: the level split from the tags and a stem naming what its scheme marks go to the targeted rewrite.
  const a8 = (exam) => [...Levels.levelIssues(exam), ...statedType(exam)];
  issues = [...issues, ...reviewed, ...a8(examJson)];

  const check = (exam) => [...paperIssues(exam, checkOpts), ...Review.stillOpen(exam, reviewed), ...a8(exam)];
  const tidy = (exam) => { Gen.stripImageKeys(exam); Gen.normaliseAnswers(exam); };
  const targeted = await Rewrite.rounds({
    examJson, issues, check, max: 1,
    ask: async (text) => {
      const out = await ask([messages[0], { role: 'user', content: `${messages[1].content}\n\n${text}` }]);
      return extractJsonFromResponse(out?.choices?.[0]?.message?.content || '');
    },
    tidy,
    onError: (err) => logToFile('[assessment] targeted rewrite skipped', { error: err.message }),
  });
  examJson = targeted.exam; issues = targeted.issues;
  const { rewritten } = targeted;
  // An MCQ still giving another item away is replaced by a spare from the pool (G7 a6 Q2 against Q5).
  const swapped = Pool.swapLeaks(examJson, spares, check);
  if (swapped) issues = check(examJson);
  // A leak still standing gets one follow-up quoting it, then a repair in code (a8b Q1 against Q11).
  const fixed = await resolveLeaks({ examJson, check, tidy, onError: (err) => logToFile('[assessment] leak follow-up failed', { error: err.message }),
    ask: async (text) => extractJsonFromResponse((await ask([messages[0], { role: 'user', content: `${messages[1].content}\n\n${text}` }]))?.choices?.[0]?.message?.content || '') });
  examJson = fixed.exam; issues = fixed.issues;
  const shortfall = typeShortfall(questionTypes, sized.types);
  if (shortfall.length || fixed.dropped.length) logToFile('[assessment] shortfall (grades 6-12 free)', { grade, subject, types: shortfall, droppedLeaks: fixed.dropped });

  const produced = Gen.countQuestions(examJson);
  if (produced === 0) throw fail('NO_QUESTIONS', 'The question writer returned no questions.');
  const stripped = stripInstructions(examJson);
  scenarioParts(examJson);
  // The chrome prints Western digits, so an Urdu paper's body does too (a7 ruling: one digit system).
  const digitsFixed = isRtl(subject) ? oneDigitSystem(examJson) : 0;
  const numbersSorted = sortNumeric(examJson);
  const keysMoved = balanceKeys(examJson, keySeed ?? startedAt);
  const load = estimateMinutes(examJson);
  examJson._timeMinutes = printedMinutes(load);
  const overBand = load > Rules.bandOf(grade).minutes * OVER_BAND;
  if (overBand) logToFile('[assessment] load over the band (grades 6-12 free)', { grade, subject, loadMinutes: Math.round(load), bandMinutes: Rules.bandOf(grade).minutes, timeMinutes: examJson._timeMinutes });
  // The answer key prints each item's thinking level (panel A6b), on a G6-12 free paper only.
  examJson._levels = true;
  // A paper set right to left prints its headings and instructions in Urdu (free-secondary-chrome.js).
  if (isRtl(subject)) examJson._paperLang = 'ur';

  const tokenData = { inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null, model };
  const coverage = Gen.answerCoverage(examJson);
  logToFile('[assessment] generated (grades 6-12 free)', {
    grade, subject, questionCount: produced, revised, pooled, reviewed: reviewed.length, rewritten, swapped, stripped, digitsFixed, issuesLeft: issues.length, numbersSorted, keysMoved,
    loadMinutes: Math.round(load), timeMinutes: examJson._timeMinutes, overBand, elapsedMs: Date.now() - startedAt,
  });
  return {
    examJson, questionCount: produced, tokenData, plan, issues, revised, rewritten, pooled, droppedLeaks: fixed.dropped, typeShortfall: shortfall,
    trimmed: cleaned.removedSeen > 0 ? { seen: cleaned.removedSeen } : {},
    marksRemoved: cleaned.marksRemoved, answerCoverage: coverage, elapsedMs: Date.now() - startedAt,
  };
}

module.exports = { generateExam };
