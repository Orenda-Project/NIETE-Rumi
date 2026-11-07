'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { avoidNote } = require('../repeat-guard');
const { capBlooms, appliesToGrade, APPLY_NOTE } = require('../bloom-ceiling');
const { configForRequest, ensureCurrent } = require('../../../config/model-settings');
const { extractJsonFromResponse } = require('../assessment-json.util');
const { getClient, getClientForModel } = require('../../llm-client');
const { logToFile } = require('../../../utils/logger');
const { resolveModelForJob } = require('../../../config/model-registry');
const { stemsBlock, applyStems } = require('../topics/stem-prompt');
const { _norm, _splitOption, _walkQuestions, buildUserPrompt, countQuestions, enforceMarksBudget, stripImageKeys, totalMarksOf, trimSeen } = require('./marks-answers');
const { MAX_OUTPUT_TOKENS, URDU_MEDIUM, _isEmptyReply, buildSystemPrompt, canonical, fail, familyModel, planCounts } = require('./models-prompts');

/**
 * The option an MCQ answer names, or null when it names none unambiguously.
 * Tried in order: the option itself, its label alone ("b", "(b)", "ج"), and the
 * text after the label ("4" for "b) 4"). Only a single match counts — a guess
 * would print a wrong answer on a teacher's key, which is worse than a gap.
 */
function _resolveOption(options, answer) {
  const want = _norm(answer);
  if (!want) return null;
  const exact = options.filter((o) => _norm(o) === want);
  if (exact.length === 1) return exact[0];
  const bareLabel = want.replace(/^\(\s*/, '').replace(/\s*[).:\-]?\s*\)?$/, '');
  const byLabel = options.filter((o) => _splitOption(o).label === bareLabel);
  if (byLabel.length === 1) return byLabel[0];
  const asOption = _splitOption(answer);
  const byText = options.filter((o) => {
    const t = _splitOption(o).text;
    return t && (t === want || (asOption.label && t === asOption.text));
  });
  return byText.length === 1 ? byText[0] : null;
}

/** "1) a 2) b 3) c" → ['a','b','c'], or null when it is not numbered 1..n. */
function _splitNumbered(answer, n) {
  const text = String(answer ?? '');
  const marks = [...text.matchAll(/(?:^|\s)\(?(\d{1,2})\s*[).:\-]\s*/g)];
  const seq = [];
  for (const m of marks) {
    if (Number(m[1]) === seq.length + 1) seq.push(m);
  }
  if (seq.length !== n || n === 0) return null;
  return seq.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < seq.length ? seq[i + 1].index : text.length;
    return text.slice(start, end).trim();
  });
}

function _hasText(v) {
  return typeof v === 'string' ? v.trim() !== '' : v != null && v !== false;
}

/**
 * Make the model's answers usable by the key without asking it again — only
 * where the right answer is recoverable from what it wrote (bd-bfnsk):
 *
 *   * An MCQ answer given as a letter, a label or the option's bare text is
 *     rewritten to the exact option, so the key reads "b) 4", not "b".
 *   * A comprehension answer written once on the passage as "1) … 2) …" is
 *     split onto the sub-questions that carry none. A sub-question's own
 *     answer is never overwritten.
 *
 * Nothing is invented: an answer that cannot be placed is left as written.
 */
function normaliseAnswers(examJson) {
  _walkQuestions(examJson, (q) => {
    if (Array.isArray(q.options) && q.options.length && _hasText(q.answer)
        && typeof q.answer !== 'object') {
      const hit = _resolveOption(q.options, q.answer);
      if (hit != null) q.answer = hit;
    }
    if (Array.isArray(q.questions) && q.questions.length && _hasText(q.answer)) {
      const parts = _splitNumbered(q.answer, q.questions.length);
      if (parts) {
        q.questions.forEach((sub, i) => {
          if (sub && typeof sub === 'object' && !_hasText(sub.answer) && parts[i]) sub.answer = parts[i];
        });
      }
    }
  });
  return examJson;
}

/**
 * How much of the key has an answer, counted the way renderAnswerKey prints
 * it: a comprehension question counts once per sub-question, and falls back to
 * the passage's own answer only when none of its subs has one.
 */
function answerCoverage(examJson) {
  let questions = 0;
  let answered = 0;
  _walkQuestions(examJson, (q) => {
    if (Array.isArray(q.questions) && q.questions.length && q.passage) {
      const subs = q.questions;
      const anySub = subs.some((s) => s && typeof s === 'object' && _hasText(s.answer));
      if (!anySub && _hasText(q.answer)) { questions += 1; answered += 1; return; }
      subs.forEach((s) => {
        questions += 1;
        if (s && typeof s === 'object' && _hasText(s.answer)) answered += 1;
      });
      return;
    }
    questions += 1;
    if (_hasText(q.answer)) answered += 1;
  });
  return { questions, answered };
}

async function generateExam(args) {
  const { grade, subject, pageContent, pageReference,
          contentSource = 'unseen', questionCount, questionTypes = [], includeAnswerKey = false,
          totalMarks = null, seenCount = null, slos = null, avoidQuestions = [] } = args;

  const key = canonical(subject) || 'eng';
  const family = URDU_MEDIUM.has(key) ? 'urdu' : 'eng';
  // bd-gr4fy.5.8: this job picks its model here, before the client's own wait for stale settings runs, so
  // settings too old to trust are read first (one bounded wait). familyModel stays synchronous for MODELS.
  if (typeof ensureCurrent === 'function') await ensureCurrent();
  const model = familyModel(family);
  // The model this family runs with no settings at all (bd-gr4fy.7). Named as `fallbackModel` only
  // when the settings moved the call, so llm-client stands this paper's own model behind the moved
  // one: Urdu and English papers run different models, and only this call site knows which.
  const ownModel = resolveModelForJob('assessment.generate', { family }).model;
  const plan = planCounts({ contentSource, questionCount, questionTypes, seenCount });
  const honestBlooms = appliesToGrade(grade);

  const messages = [
    { role: 'system', content: buildSystemPrompt({ subject, includeAnswerKey }) + (honestBlooms ? APPLY_NOTE : '') },
    { role: 'user', content: buildUserPrompt({ grade, subject, pageContent, pageReference, contentSource, questionCount, questionTypes, totalMarks, seenCount, slos }) + avoidNote(avoidQuestions) },
  ];

  logToFile('[assessment] generating', {
    grade, subject: key, model, pageReference, contentSource,
    total: plan.total, seenTarget: plan.seenTarget,
    types: plan.questionTypes.map((q) => `${q.count} ${q.id}`), contentChars: (pageContent || '').length,
  });

  const ask = () => getClient().chat.completions.create({
    model,
    // Names the spender. llm-client records it on api.cost.incurred and strips it
    // before the request goes out, so this job stops being $11.34/day of anonymous spend.
    job: 'assessment.generate',
    ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    max_tokens: MAX_OUTPUT_TOKENS,
  });

  let response;
  const startedAt = Date.now();
  try {
    response = await ask();
    if (_isEmptyReply(response)) {
      logToFile('[assessment] empty reply, retrying once', { model, usage: response.usage || null });
      response = await ask();
    }
  } catch (err) {
    // An outage is not bad output, and telling them apart is what decides
    // whether a retry is worth anything.
    logToFile('[assessment] model call failed', { model, error: err.message });
    throw fail('MODEL_UNAVAILABLE', 'The question writer is unavailable right now.',
      { cause: err.message });
  }

  const choice = response?.choices?.[0] || {};
  const raw = choice.message?.content || '';

  // This model reasons before it answers, and reasoning spends the same budget
  // as output. Hit the ceiling and the reply comes back with a null content and
  // finish_reason 'length' — which is a truncation, not bad output, and wants a
  // different answer: ask for fewer questions rather than simply try again.
  if (!raw && choice.finish_reason === 'length') {
    logToFile('[assessment] model ran out of room', { model, usage: response.usage });
    throw fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.',
      { usage: response.usage });
  }

  let examJson;
  try {
    examJson = extractJsonFromResponse(raw);
  } catch (err) {
    // Cut off mid-paper at the ceiling: the same answer as above, not "try again".
    if (choice.finish_reason === 'length') {
      logToFile('[assessment] model ran out of room', { model, usage: response.usage, partial: true });
      throw fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.',
        { usage: response.usage });
    }
    logToFile('[assessment] model returned unusable JSON', {
      model, error: err.message, preview: raw.slice(0, 300),
    });
    throw fail('BAD_JSON', 'The question writer returned something we could not read.',
      { cause: err.message });
  }

  stripImageKeys(examJson);
  normaliseAnswers(examJson);
  // The writer tags its own questions; a bare drill tagged Apply or a one-mark opinion tagged
  // Evaluate is lowered to the level its shape supports (bloom-ceiling.js). Only ever lowers.
  const bloomsMoved = honestBlooms ? capBlooms(examJson) : [];
  if (bloomsMoved.length) logToFile('[assessment] bloom tags lowered to fit the question', { moved: bloomsMoved });
  // bd-6clakk.12 — her ticked stems: a near miss is set to the stem; a question using none is logged.
  const { misses: stemMisses } = applyStems(examJson, plan.questionTypes);
  if (stemMisses.length) logToFile('[assessment] questions without a ticked stem', { misses: stemMisses });
  const removedSeen = trimSeen(examJson, plan.seenTarget);
  if (removedSeen > 0) {
    logToFile('[assessment] trimmed seen questions to the cap', { seenTarget: plan.seenTarget, removed: removedSeen });
  }
  const trimmed = removedSeen > 0 ? { seen: removedSeen } : {};

  // Last, because it measures the paper that actually survived the seen cap.
  const marksRemoved = enforceMarksBudget(examJson, totalMarks);
  if (marksRemoved > 0) {
    logToFile('[assessment] dropped questions to fit the marks budget', {
      totalMarks, removed: marksRemoved, marksNow: totalMarksOf(examJson),
    });
  }

  const produced = countQuestions(examJson);
  if (produced === 0) {
    // Valid JSON with an empty tree. Rare, and worth its own code: retrying is
    // reasonable here, where retrying a refusal is not.
    throw fail('NO_QUESTIONS', 'The question writer returned no questions.');
  }

  const usage = response.usage || {};
  const tokenData = {
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    model,
  };

  // Measured on every paper, so a model that stops writing answers shows up in
  // the logs the day it happens rather than in a teacher's blank key (bd-bfnsk).
  const coverage = answerCoverage(examJson);

  logToFile('[assessment] generated', {
    grade, subject: key, questionCount: produced, elapsedMs: Date.now() - startedAt, ...tokenData,
    answersGiven: coverage.answered, answersExpected: coverage.questions,
  });

  return { examJson, questionCount: produced, tokenData, trimmed, plan, marksRemoved,
    answerCoverage: coverage, elapsedMs: Date.now() - startedAt };
}

// ───────────────────────── Board-pattern papers ─────────────────────────
//
// Everything below runs only for a job that carries `pattern`. Nothing above
// calls it, so a paper without a pattern is built exactly as it always was.

// Grades 9-12 board papers (bd-5jmnfj.38.24): their own writer, lookup and helpers; reachable by id only.
// round 6 Urdu

// Required on first use: the loader opens a database client, and the prompt
// helpers above are loaded by tests and tools that have no database.
// eslint-disable-next-line global-require
const BookContent = () => require('../book-content.service');
const TopicOral = () => require('../topics/topic-oral');

module.exports = {
  BookContent, TopicOral, answerCoverage, generateExam, normaliseAnswers,
};
