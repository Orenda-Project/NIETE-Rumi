'use strict';
/**
 * bd-5jmnfj.38.31 — the free-mode paper for grades 6 and up (no board pattern).
 *
 * Until now a G6-8 free paper ran the G1-5 generateExam unchanged, and the panel of 2026-11-06
 * blocked two of them. This runs the same call (same model, job, temperature and post-processing,
 * from the generation service's own exports) with three changes:
 *   1. the grades 6-12 rules (free-secondary-rules.js) sit before the safety policies;
 *   2. the type counts are sized to the band's time before the paper is asked for, and the writer is
 *      asked for about 30% more MCQs than that; the subset with the fewest leaks is kept (free-secondary-pool.js);
 *   3. the draft is checked (free-secondary-checks.js); one that breaks a rule is sent back once
 *      with the list, and the paper with fewer problems is kept;
 *   4. one small call, on a job of another model family than the writer, rates each MCQ distractor and flags
 *      a longest-option key, two defensible options, an odd-one-out key or an option that does not complete
 *      the stem (free-secondary-review.js);
 *   5. items still leaking, or with a longest-option key, an absolute distractor or one rated 1, are rewritten on
 *      their own (free-secondary-rewrite.js), up to two rounds, each kept only if it leaves fewer problems.
 * Then writer instructions are stripped from the marking points (free-secondary-tidy.js), number options
 * are put in ascending order, the MCQ keys
 * are spread from the paper's seed (free-secondary-keys.js), the time is stamped as `_timeMinutes`, and
 * an Urdu-medium paper is marked `_paperLang: 'ur'` so its chrome prints in Urdu.
 *
 * The orchestrator calls this only for grade >= 6, so no G1-5 paper reaches it.
 */

const { getClient } = require('../llm-client');
const { resolveModelForJob } = require('../../config/model-registry');
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
const Review = require('./free-secondary-review');
const { stripInstructions, scenarioParts } = require('./free-secondary-tidy');
const { isRtl } = require('./assessment-paper.renderer');

const JOB = 'assessment.generate';
const MAX_OUTPUT_TOKENS = 32000;
const REVIEW_TOKENS = 6000;
// Existing registered jobs whose model may be of another family than the writer's (the review reuses one).
const REVIEWER_JOBS = ['quiz.keyVerify', 'lp.fidelity'];
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

  const sized = Rules.sizeTypes(questionTypes, grade);
  // Sizing shrinks every type in proportion, so the paper asks for the sized total, not the requested one.
  const sizedCount = questionCount > 0 ? Math.max(1, questionCount - sized.dropped) : questionCount;
  const plan = Gen.planCounts({ contentSource, questionCount: sizedCount, questionTypes: sized.types, seenCount });
  const pool = Pool.poolTypes(sized.types);
  const keepMcqs = (sized.types.find((t) => t.id === 'mcq') || {}).count || 0;
  let pooled = 0;
  // Normalised first so the leak check reads the keys, then cut back to the plan's MCQ count.
  const pick = (exam) => {
    Gen.normaliseAnswers(exam);
    pooled = Pool.select(exam, keepMcqs, (e) => paperIssues(e, checkOpts)).dropped;
    return exam;
  };
  const system = Rules.withRules(Gen.buildSystemPrompt({ subject: base, includeAnswerKey }),
    PROMPTS['eg.safety.policies'], grade, chapterTitle) + (appliesToGrade(grade) ? APPLY_NOTE : '');
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: Gen.buildUserPrompt({ grade, subject, pageContent, pageReference, contentSource,
      questionCount: sizedCount + pool.extra, questionTypes: pool.types,
      totalMarks: totalMarks == null ? totalMarks : totalMarks + pool.extra, seenCount, slos }) },
  ];
  logToFile('[assessment] generating (grades 6-12 free)', {
    grade, subject, base, model, dropped: sized.dropped, types: plan.questionTypes.map((q) => `${q.count} ${q.id}`),
  });

  const ask = (msgs) => getClient().chat.completions.create({
    model, job: JOB, ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages: msgs, temperature: 0.7, response_format: { type: 'json_object' }, max_tokens: MAX_OUTPUT_TOKENS,
  });
  const startedAt = Date.now();

  let response;
  try {
    response = await ask(messages);
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
  let usage = response.usage || {};
  let revised = false;

  if (issues.length) {
    try {
      const firstPooled = pooled;
      const second = await ask([...messages, { role: 'assistant', content: JSON.stringify(examJson) },
        { role: 'user', content: Rules.fixNote(issues) }]);
      const next = pick(extractJsonFromResponse(second?.choices?.[0]?.message?.content || ''));
      const nextCleaned = postProcess(next, { grade, plan, totalMarks });
      const nextIssues = paperIssues(next, checkOpts);
      if (Gen.countQuestions(next) > 0 && nextIssues.length < issues.length) {
        examJson = next; cleaned = nextCleaned; issues = nextIssues; usage = second.usage || usage; revised = true;
      } else pooled = firstPooled;
    } catch (err) {
      logToFile('[assessment] revision skipped', { error: err.message });
    }
  }

  // The review runs on a registered job of another model family than the writer, so it does not share the
  // writer's blind spots (quiz.keyVerify for a Gemini writer, lp.fidelity for a Claude one), with the
  // writer's model as the fallback; on the writer's own job and model when no such job resolves. MCQs only.
  // Families are compared on the models in force: a per-job settings row moves a job in the client.
  const inForce = (job, site) => {
    const row = !cfg.killSwitch && cfg.perJob && cfg.perJob[job];
    return typeof row === 'string' && row.includes('/') ? row : site;
  };
  const reviewer = Review.pickReviewer(inForce(JOB, model),
    REVIEWER_JOBS.map((job) => ({ job, model: inForce(job, resolveModelForJob(job).model) })));
  const reviewCall = reviewer ? { model: reviewer.model, job: reviewer.job, fallbackModel: model }
    : { model, job: JOB, ...(model !== ownModel ? { fallbackModel: ownModel } : {}) };
  logToFile('[assessment] distractor review model', { job: reviewCall.job, model: reviewCall.model });
  const reviewed = await Review.review({
    examJson, grade, existing: issues,
    ask: async (text) => {
      const out = await getClient().chat.completions.create({
        ...reviewCall,
        messages: [{ role: 'user', content: text }], temperature: 0,
        response_format: { type: 'json_object' }, max_tokens: REVIEW_TOKENS,
      });
      return extractJsonFromResponse(out?.choices?.[0]?.message?.content || '');
    },
    onError: (err) => logToFile('[assessment] distractor review skipped', { error: err.message }),
  });
  issues = [...issues, ...reviewed];

  const targeted = await Rewrite.rounds({
    examJson, issues,
    check: (exam) => [...paperIssues(exam, checkOpts), ...Review.stillOpen(exam, reviewed)],
    ask: async (text) => {
      const out = await ask([messages[0], { role: 'user', content: `${messages[1].content}\n\n${text}` }]);
      return extractJsonFromResponse(out?.choices?.[0]?.message?.content || '');
    },
    tidy: (exam) => { Gen.stripImageKeys(exam); Gen.normaliseAnswers(exam); },
    onError: (err) => logToFile('[assessment] targeted rewrite skipped', { error: err.message }),
  });
  examJson = targeted.exam; issues = targeted.issues;
  const { rewritten } = targeted;

  const produced = Gen.countQuestions(examJson);
  if (produced === 0) throw fail('NO_QUESTIONS', 'The question writer returned no questions.');
  const stripped = stripInstructions(examJson);
  scenarioParts(examJson);
  const numbersSorted = sortNumeric(examJson);
  const keysMoved = balanceKeys(examJson, keySeed ?? startedAt);
  const load = estimateMinutes(examJson);
  examJson._timeMinutes = printedMinutes(load);
  // The answer key prints each item's thinking level (panel A6b), on a G6-12 free paper only.
  examJson._levels = true;
  // A paper set right to left prints its headings and instructions in Urdu (free-secondary-chrome.js).
  if (isRtl(subject)) examJson._paperLang = 'ur';

  const tokenData = { inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null, model };
  const coverage = Gen.answerCoverage(examJson);
  logToFile('[assessment] generated (grades 6-12 free)', {
    grade, subject, questionCount: produced, revised, pooled, reviewed: reviewed.length, rewritten, stripped, issuesLeft: issues.length, numbersSorted, keysMoved,
    loadMinutes: Math.round(load), timeMinutes: examJson._timeMinutes, elapsedMs: Date.now() - startedAt,
  });
  return {
    examJson, questionCount: produced, tokenData, plan, issues, revised, rewritten, pooled,
    trimmed: cleaned.removedSeen > 0 ? { seen: cleaned.removedSeen } : {},
    marksRemoved: cleaned.marksRemoved, answerCoverage: coverage, elapsedMs: Date.now() - startedAt,
  };
}

module.exports = { generateExam };
