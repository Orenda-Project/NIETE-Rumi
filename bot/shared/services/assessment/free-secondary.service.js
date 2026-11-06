'use strict';
/**
 * bd-5jmnfj.38.31 — the free-mode paper for grades 6 and up (no board pattern).
 *
 * Until now a G6-8 free paper ran the G1-5 generateExam unchanged, and the panel of 2026-11-06
 * blocked two of them. This runs the same call (same model, job, temperature and post-processing,
 * from the generation service's own exports) with three changes:
 *   1. the grades 6-12 rules (free-secondary-rules.js) sit before the safety policies;
 *   2. the type counts are sized to the band's time before the paper is asked for;
 *   3. the draft is checked (free-secondary-checks.js); one that breaks a rule is sent back once
 *      with the list, and the paper with fewer problems is kept;
 *   4. items still leaking, or with a longest-option key or an absolute distractor, are rewritten on
 *      their own (free-secondary-rewrite.js), kept only if the paper then has fewer problems.
 * Then writer instructions are stripped from the marking points (free-secondary-tidy.js), the MCQ keys
 * are spread from the paper's seed (free-secondary-keys.js) and the time is stamped as `_timeMinutes`.
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
const { balanceKeys } = require('./free-secondary-keys');
const Rewrite = require('./free-secondary-rewrite');
const { stripInstructions, scenarioParts } = require('./free-secondary-tidy');

const JOB = 'assessment.generate';
const MAX_OUTPUT_TOKENS = 32000;
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
  const model = resolveModelForJob(JOB, { cfg: configForRequest(), family }).model;
  const ownModel = resolveModelForJob(JOB, { family }).model;

  const sized = Rules.sizeTypes(questionTypes, grade);
  const plan = Gen.planCounts({ contentSource, questionCount, questionTypes: sized.types, seenCount });
  const system = Rules.withRules(Gen.buildSystemPrompt({ subject: base, includeAnswerKey }),
    PROMPTS['eg.safety.policies'], grade, chapterTitle) + (appliesToGrade(grade) ? APPLY_NOTE : '');
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: Gen.buildUserPrompt({ grade, subject, pageContent, pageReference, contentSource,
      questionCount, questionTypes: sized.types, totalMarks, seenCount, slos }) },
  ];
  logToFile('[assessment] generating (grades 6-12 free)', {
    grade, subject, base, model, moved: sized.moved, types: plan.questionTypes.map((q) => `${q.count} ${q.id}`),
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
    examJson = extractJsonFromResponse(raw);
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
      const second = await ask([...messages, { role: 'assistant', content: raw },
        { role: 'user', content: Rules.fixNote(issues) }]);
      const next = extractJsonFromResponse(second?.choices?.[0]?.message?.content || '');
      const nextCleaned = postProcess(next, { grade, plan, totalMarks });
      const nextIssues = paperIssues(next, checkOpts);
      if (Gen.countQuestions(next) > 0 && nextIssues.length < issues.length) {
        examJson = next; cleaned = nextCleaned; issues = nextIssues; usage = second.usage || usage; revised = true;
      }
    } catch (err) {
      logToFile('[assessment] revision skipped', { error: err.message });
    }
  }

  let rewritten = [];
  const targeted = Rewrite.targets(issues);
  if (targeted.length) {
    try {
      const third = await ask([messages[0], { role: 'user',
        content: `${messages[1].content}\n\n${Rewrite.prompt(examJson, targeted)}` }]);
      const merged = Rewrite.merge(examJson, extractJsonFromResponse(third?.choices?.[0]?.message?.content || ''),
        targeted.map((i) => i.n));
      if (merged.replaced.length) {
        Gen.stripImageKeys(merged.exam);
        Gen.normaliseAnswers(merged.exam);
        const nextIssues = paperIssues(merged.exam, checkOpts);
        if (nextIssues.length < issues.length) { examJson = merged.exam; issues = nextIssues; rewritten = merged.replaced; }
      }
    } catch (err) {
      logToFile('[assessment] targeted rewrite skipped', { error: err.message });
    }
  }

  const produced = Gen.countQuestions(examJson);
  if (produced === 0) throw fail('NO_QUESTIONS', 'The question writer returned no questions.');
  const stripped = stripInstructions(examJson);
  scenarioParts(examJson);
  const keysMoved = balanceKeys(examJson, keySeed ?? startedAt);
  const load = estimateMinutes(examJson);
  examJson._timeMinutes = printedMinutes(load);

  const tokenData = { inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null, model };
  const coverage = Gen.answerCoverage(examJson);
  logToFile('[assessment] generated (grades 6-12 free)', {
    grade, subject, questionCount: produced, revised, rewritten, stripped, issuesLeft: issues.length, keysMoved,
    loadMinutes: Math.round(load), timeMinutes: examJson._timeMinutes, elapsedMs: Date.now() - startedAt,
  });
  return {
    examJson, questionCount: produced, tokenData, plan, issues, revised, rewritten,
    trimmed: cleaned.removedSeen > 0 ? { seen: cleaned.removedSeen } : {},
    marksRemoved: cleaned.marksRemoved, answerCoverage: coverage, elapsedMs: Date.now() - startedAt,
  };
}

module.exports = { generateExam };
