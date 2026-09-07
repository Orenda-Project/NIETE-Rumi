'use strict';
/**
 * Transcript quiz — GENERATE and HAND OFF (the worker step after "yes").
 *
 *   author → validate (one retry, with the validator's complaints) → store
 *   quiz_questions → teacher PDF → R2 → share code → three paced messages
 *
 * Idempotent per step, because the quiz queue is Standard SQS (at-least-once):
 * a quiz already `sent` does nothing; a quiz stuck at `ready` (questions
 * stored, hand-off failed) resumes at the hand-off. The share-code chain from
 * the video quizzes takes over from here unchanged — children join through
 * the same link, the same report fires 12 h later.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const Digest = require('./transcript-quiz-digest.service');
const Author = require('./transcript-quiz-author.service');
const { validate } = require('./transcript-quiz-validator');
const { teacherLanguageFor, quizLanguageFor, formatLessonDate, topicFor, lessonLabel } = require('./transcript-quiz-language');
const { SESSION_SELECT } = require('./transcript-quiz-offer.service');

const N_QUESTIONS = 8;
/**
 * Full authoring attempts per quiz. Three, not two, since the first real morning
 * on production (2026-09-07): two teachers lost their quiz because attempt 1
 * was spent on something that is not a fault of the questions (the quiz
 * language, or a drawable lesson with no picture) and attempt 2 — the last —
 * met a complaint nothing could repair. One more attempt costs about $0.011
 * and ten seconds; a teacher who said yes and got "I couldn't make a good quiz"
 * costs the feature. TRANSCRIPT_QUIZ_MAX_ATTEMPTS overrides (read per call).
 */
const MAX_ATTEMPTS = 3;
function maxAttempts() {
  // `process` is this module's exported job function, so the Node global is
  // reached through globalThis.
  const n = parseInt(String(globalThis.process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS || '').trim(), 10);
  return Number.isInteger(n) && n >= 1 ? n : MAX_ATTEMPTS;
}

/** Subjects where a lesson can nearly always be drawn with the allowed types. */
const DRAWABLE_SUBJECTS = new Set(['maths', 'science', 'genk']);

/**
 * A grade 1-5 lesson is drawable in EVERY subject (round 5). Until round 5
 * the drawable roster was the 6-12 one, so a language lesson genuinely had
 * nothing to draw with and this gate correctly let it pass without a picture.
 * The early-years types changed that: `word_blank` and `match` are language
 * types before they are anything else, and across the ICT K-5 segmentation they
 * serve 257 and 360 segments respectively — nearly all of them English or Urdu
 * periods (the option-space study).
 */
function isEarlyYearsBand(gradeBand) {
  const g = String(gradeBand || '').toLowerCase();
  if (/\b(kg|k|prep|nursery|ecce|katchi)\b/.test(g)) return true;
  const nums = (g.match(/\d+/g) || []).map(Number);
  return nums.length > 0 && nums.every((n) => n <= 5);
}

/**
 * "Write at least ONE picture question" was advisory: the first live science
 * lesson of round 4 (Structure of an Atom — the class was asked to draw atoms)
 * came back as eight text questions and nothing sent it back. A drawable
 * lesson with zero figures now fails every attempt but the last, with the
 * reason in the retry note; the last attempt is never failed for it — a quiz
 * without a picture beats no quiz.
 */
function figureRequiredError({ questions, subject, attempt, maxAttempts, gradeBand }) {
  const early = isEarlyYearsBand(gradeBand);
  if (!early && !DRAWABLE_SUBJECTS.has(String(subject || '').toLowerCase())) return null;
  // The picture is asked for ONCE, on the first attempt. A second full attempt
  // spent on the picture is the attempt that was missing when a science lesson
  // died on production (2026-09-07): text-only is a lesser quiz, no quiz is none.
  if (attempt > 1 || attempt >= maxAttempts) return null;
  const drawn = (Array.isArray(questions) ? questions : []).some((q) => q && q.figure && typeof q.figure === 'object');
  if (drawn) return null;
  const why = early
    ? `this is a grade 1-5 lesson (${subject || 'language'}) and every subject is drawable at that age`
    : `this ${subject} lesson is drawable`;
  const how = early
    ? 'Decide the drawing FIRST — the thing the class counted, the word they sounded out, the clock they read, the pattern they continued — then write one or two questions the child answers by reading the picture.'
    : 'Decide the drawing FIRST (what the class was shown or asked to draw), then write one or two questions the child answers by reading the picture.';
  return `quiz: FIGURE_REQUIRED — ${why} but none of the questions carries a "figure". ${how}`;
}
/** Complaints about the SET's shape, never about one question being wrong or unanswerable. */
const SOFT_FAULT = /^(PEDAGOGY_LEVEL_MIX\b|only \d+\/\d+ at\/below taught level|FIGURE_SHARE\b|q\d+: PEDAGOGY_LEVEL_(ABOVE|MIX)\b)/;
const GAP_MS = 1200;
const NUDGE_AFTER_MS = 3 * 60 * 60 * 1000;
const LEVEL_DIFFICULTY = { recall: 2, understand: 3, apply: 4 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── rows ────────────────────────────────────────────────────────────────────

/**
 * Shuffle the correct option into a random slot at generation time (the same
 * rule the parent quiz follows) and rewrite every index-keyed field to follow.
 * The render-time shuffle (seeded on external_id) happens on top; feedbackFor
 * remaps by stored index so both are safe together.
 */
function toRows(quizId, questions, { rng = Math.random, figureUrls = {} } = {}) {
  const Multi = require('./transcript-quiz-multi');
  return questions.map((q, i) => {
    // A "select all that apply" question may carry FOUR options (PLAN_R5 D4);
    // an ordinary one still carries exactly three. The shuffle is over whatever
    // the question has, so a three-option question consumes the rng in exactly
    // the same order it always did and its stored rows are unchanged.
    const multi = Multi.isMultiQuestion(q);
    const order = q.options.map((_, k) => k);
    for (let k = order.length - 1; k > 0; k -= 1) {
      const j = Math.floor(rng() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    // order[newPos] = oldIdx
    const opts = order.map((old) => String(q.options[old]).trim());
    // The answer key follows the shuffle. For a set it is every correct
    // option's NEW position, sorted, joined — the "A,C" shape correctIndices()
    // has always parsed and the column has always been able to hold (asserted
    // against the live database: correct_option is TEXT, no A/B/C constraint).
    const correctOld = multi ? Multi.authoredCorrectIndices(q) : [Number(q.correct_index)];
    const correctNew = correctOld.map((old) => order.indexOf(old)).filter((p) => p >= 0).sort((a, b) => a - b);
    const newCorrect = correctNew[0];
    const isCorrectPos = (pos) => correctNew.includes(pos);
    const wrong = {};
    const misc = {};
    order.forEach((old, pos) => {
      if (isCorrectPos(pos)) return;
      const w = q.option_feedback?.wrong?.[String(old)];
      if (w) wrong[String(pos)] = String(w).trim();
      const m = q.distractor_misconceptions?.[String(old)];
      if (m) misc['ABCD'[pos]] = String(m).trim();
    });
    // A picture question is P3: the child gets ONE interactive message —
    // image header, stem body, three reply buttons. The URL is keyed on the
    // question's index, so a figure whose PNG never uploaded degrades to a
    // plain P1 question rather than to a row pointing at nothing.
    const figureUrl = figureUrls[i];
    const selectedBecause = String(q.selected_because || '').trim();
    // `answer_mode` is the ONE discriminator every consumer reads; its absence
    // means today's behaviour, exactly, so a single-answer row still stores no
    // media at all when it has no figure and no selected_because.
    const media = {
      ...(q.figure && figureUrl ? { question_image: figureUrl, figure: q.figure } : {}),
      ...(selectedBecause ? { selected_because: selectedBecause } : {}),
      ...(multi ? { answer_mode: Multi.ANSWER_MODE_MULTI } : {}),
    };
    const hasMedia = Object.keys(media).length > 0;

    return stampDisplayOrder({
      quiz_id: quizId,
      question_text: String(q.question).trim(),
      option_a: opts[0], option_b: opts[1], option_c: opts[2],
      ...(opts.length > 3 ? { option_d: opts[3] } : {}),
      correct_option: correctNew.map((p) => 'ABCD'[p]).join(','),
      explanation: String(q.explanation || '').trim() || null,
      misconception_feedback: Object.values(wrong)[0] || null,
      distractor_misconceptions: Object.keys(misc).length ? misc : null,
      option_feedback: { correct: String(q.option_feedback?.correct || '').trim(), wrong },
      difficulty_level: LEVEL_DIFFICULTY[q.level] || 3,
      // quiz_questions.external_id is unique across ALL quizzes (partial unique
      // index), so the quiz id is part of it; the report reads the SLO as the
      // second-to-last segment.
      external_id: `tq:${quizId}:${q.slo_id || 'S?'}:${i + 1}`,
      // "media" now also carries selected_because on a question with no
      // figure, so the pattern is keyed on question_image specifically —
      // not on media's mere presence — exactly as it reads once applyMedia
      // recomputes it below.
      render_pattern: media.question_image ? 'P3' : 'P1',
      ...(hasMedia ? { media } : {}),
      sort_order: i,
    });
  });
}

/**
 * ONE ORDER, STORED ONCE (round-5 D1).
 *
 * The order the child sees the options in is decided HERE, once, while the row
 * still has the `external_id` the shuffle is seeded on, and written onto the row
 * as `media.display_order` (display position -> stored index). Every consumer
 * reads it back through `render.displayOrder()`: the question card's picture,
 * the letter buttons, `feedbackFor`'s letter remap, the teacher PDF's answer key.
 *
 * WHY THIS AND NOT "REMEMBER TO SELECT external_id". Because the seed lived in a
 * column any query could omit, and two of them did (`sendNextQuestion` and
 * `handleAnswer`): the card was drawn from a row that had it, the buttons were
 * built from the same row without it, the two shuffles disagreed, and a child who
 * tapped the picture's B was congratulated for the answer at C. A rule that every
 * future `.select()` must remember a column is not a fix; a value that travels
 * inside `media` — which every one of those queries already loads — is.
 */
function stampDisplayOrder(row) {
  const render = require('./video-quiz-render.service');
  const labels = render.optionLabels(row);
  const order = render.displayOrder(row, labels);
  row.media = { ...(row.media || {}), display_order: order };
  return row;
}

/**
 * Draw, screenshot and upload every figure in the quiz, in order.
 *
 * Sequential on purpose: Playwright pages are the expensive resource and a
 * quiz carries at most four figures. Any failure throws — an attempt that
 * cannot produce a picture is a FAILED attempt, retried with the reason, never
 * a stored row whose media.question_image points at an object that does not
 * exist.
 *
 * @returns {Promise<Object<number,string>>} question index → public URL
 */
async function renderFigures({ questions, language, teacherId, quizId }) {
  const Figure = require('./transcript-quiz-figure');
  const urls = {};
  const jobs = questions.map((q, i) => ({ q, i })).filter(({ q }) => q && q.figure);
  // Three at a time: one Chromium, three pages — the whole set lands in the
  // time one used to take, without starving the PDF render that follows.
  await runPool(jobs, 3, async ({ q, i }) => {
    const startedAt = Date.now();
    try {
      // The validator already drew this one; redrawing it would be a second
      // chance for the two copies to differ.
      const svg = q.figureSvg || Figure.renderFigureSvg(q.figure, language);
      const png = await Figure.renderFigurePng(svg, language);
      urls[i] = await Figure.uploadFigure({ teacherId, quizId, index: i, png });
      logEvent('transcript_quiz.figure_ready', {
        quizId, index: i, figureType: q.figure.type, bytes: png.length, latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      logToFile('⚠️ transcript quiz: figure could not be made', { quizId, index: i, error: err.message });
      throw new Error(`q${i}: FIGURE_RENDER — the picture could not be made (${err.message}); write this question without a "figure"`);
    }
  });
  return urls;
}

/** Run `fn` over `items` with at most `limit` in flight; the first rejection wins. */
async function runPool(items, limit, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * QUESTION CARDS — one image for each question whose stem or options carry
 * notation WhatsApp cannot draw, or options too long for a reply button. The
 * card shows the figure, the stem and the options in the SAME display order
 * the sender will use (seeded on the row's external id), with A/B/C handles;
 * the sender then offers letter buttons. Returns { rowIndex: url }.
 */
async function renderCards({ rows, questions, language, teacherId, quizId }) {
  const Card = require('./transcript-quiz-card');
  const render = require('./video-quiz-render.service');
  const Multi = require('./transcript-quiz-multi');
  const urls = {};
  // A tall figure makes a card too (the row may not carry the spec yet; the authored question does).
  const jobs = rows.map((row, i) => ({ row, i })).filter(({ row, i }) => Card.needsQuestionCard(row) || Card.needsQuestionCard(questions[i]));
  await runPool(jobs, 3, async ({ row, i }) => {
    const startedAt = Date.now();
    try {
      const labels = render.optionLabels(row);
      // PLAN_R5 D1/D4 — one order. The multi path reads media.display_order when
      // the row carries it, so the letters on the card are the order the
      // checkboxes will be in.
      const displayOrder = (Multi.isMultiRow(row) && Multi.persistedOrder(row, labels))
        || render.displayOrder(row, labels);
      const authored = questions && questions[i];
      const figureSvg = (authored && authored.figureSvg) || null;
      const png = await Card.renderQuestionCardPng({
        stem: row.question_text, options: labels, displayOrder, figureSvg, language,
        questionNumber: i + 1, total: rows.length,
        // A card for a "select all that apply" question ends with "tap A, B or C"
        // unless it is told otherwise — an instruction that is simply false when
        // the child answers with checkboxes in a Flow.
        answerMode: (row.media && row.media.answer_mode) || 'single',
      });
      urls[i] = await Card.uploadCard({ teacherId, quizId, index: i, png });
      logEvent('transcript_quiz.card_ready', { quizId, index: i, bytes: png.length, latencyMs: Date.now() - startedAt });
    } catch (err) {
      logToFile('⚠️ transcript quiz: question card could not be made', { quizId, index: i, error: err.message });
      throw new Error(`q${i}: CARD_RENDER — the question card could not be made (${err.message})`);
    }
  });
  return urls;
}

/** Stamp the rows with what the renders produced: the figure URL, the card URL, the pattern. */
function applyMedia(rows, questions, { figureUrls = {}, cardUrls = {}, language } = {}) {
  rows.forEach((row, i) => {
    const q = questions && questions[i];
    const media = { ...(row.media || {}), language };
    if (q && q.figure && figureUrls[i]) { media.question_image = figureUrls[i]; media.figure = q.figure; }
    if (cardUrls[i]) media.question_card = cardUrls[i];
    row.media = media;
    // A card carries the figure inside it; the header-image pattern is for a
    // figure with short text options.
    row.render_pattern = (media.question_image && !media.question_card) ? 'P3' : 'P1';
  });
  return rows;
}

/**
 * The questions the teacher PDF sees: the stored rows, each with the vector
 * for its figure so the template can inline it above the stem. Best effort —
 * a figure that will not re-draw costs the PDF a picture, never the PDF.
 */
function withFigureSvgs(rows, questions, language) {
  const Figure = require('./transcript-quiz-figure');
  return rows.map((row, i) => {
    const authored = questions && questions[i];
    const spec = (row.media && row.media.figure) || (authored && authored.figure);
    if (!spec) return row;
    let svg = authored && authored.figureSvg;
    if (!svg) {
      try {
        svg = Figure.renderFigureSvg(spec, language);
      } catch (err) {
        logToFile('⚠️ transcript quiz: figure not re-drawn for the PDF', { index: i, error: err.message });
        return row;
      }
    }
    return { ...row, figureSvg: svg };
  });
}

// ─── messages ────────────────────────────────────────────────────────────────

/** "Teacher Rifat" / "استاد رفعت", or a language-appropriate "your teacher" when no name is stored. */
function teacherLabel(teacherName, language) {
  const name = String(teacherName || '').trim();
  const generic = /^(your teacher|teacher|آپ کے استاد)$/i.test(name);
  if (!name || generic) return resolveUx('tqYourTeacher', { language });
  return resolveUx('tqTeacherNamed', { language, params: { name } });
}

function studentMessage({ teacherName, topic, date, link, language }) {
  return resolveUx('tqStudentMessage', {
    language,
    params: {
      teacher: teacherLabel(teacherName, language),
      topic: topic || resolveUx('tqTodaysLesson', { language }),
      date, link,
    },
  });
}

function pdfFilename(topic) {
  const safe = String(topic || 'quiz').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'quiz';
  return `Quiz_${safe}.pdf`;
}

/**
 * THE DOCUMENT IS SINGLE-LANGUAGE, and the language is the QUIZ's (PLAN_R4 D1).
 *
 * Round 2 gave the sheet two languages at once: the teacher's stored
 * preference for the labels, the quiz's language for the questions. It reads as
 * a defect — an English PDF with Urdu down its side — so both arguments are now
 * the quiz's language, which is the one chosen for this quiz and the one the
 * class will read. The stored preference still decides every WhatsApp message
 * around the document: the caption, the report promise, the nudge.
 *
 * Both parameters stay in the signature because the template still honours
 * them; passing them the same value is the decision, not a simplification.
 */
async function renderPdf({ quiz, questions, digest, teacherName, grade, lessonSummary, language, contentLanguage, date, link }) {
  const { htmlToPdf } = require('../../utils/html-to-pdf');
  const render = require('../../templates/transcript-quiz-teacher.template');
  const html = render({
    topic: quiz.topic, teacherName, grade, date, link, digest, questions, lessonSummary,
    language, contentLanguage: contentLanguage || quiz.language || language,
  });
  const buffer = await htmlToPdf(html, {
    timeout: 45000,
    pdfOptions: { format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } },
  });
  if (!buffer || !buffer.length) throw new Error('empty PDF');
  return buffer;
}

async function updateQuiz(quizId, patch) {
  const { error } = await supabase.from('quizzes').update(patch).eq('id', quizId);
  if (error) throw new Error(`quizzes update failed: ${error.message}`);
}

async function tellTeacherFailed(phone, lang, quizId, reason) {
  await WhatsAppService.sendMessage(phone, resolveUx('tqCouldNotMake', { language: lang }));
  logEvent('transcript_quiz.failed', { quizId, reason });
}

// ─── the step ────────────────────────────────────────────────────────────────

/**
 * Drop the questions whose ONLY complaints are DROPPABLE — a picture rule or a
 * pedagogy rule — and re-validate. Returns { questions, dropped } when the rest
 * still make a valid quiz, else null.
 *
 * Pedagogy joined the picture rules here (PLAN_R5 D3) for the reason the
 * pictures did: a whole-quiz reject on the last attempt means the teacher is
 * told nothing could be made, over one question that should not have been
 * asked. Both are per-question faults, and the quiz is better without that
 * question than not at all. A structural fault is still fatal — the two
 * quiz-level codes below are the only non-q complaints tolerated, and both are
 * re-checked by the validate() call at the end of this function.
 */
function salvageWithoutBadFigures(questions, errors, ctx) {
  const droppableErr = /^q(\d+): (FIGURE_|PEDAGOGY_|RELIGIOUS_)/;
  const bad = new Set();
  let other = false;
  errors.forEach((e) => {
    const m = droppableErr.exec(e);
    if (m) bad.add(Number(m[1]));
    else if (!/^(FIGURE_SHARE|PEDAGOGY_LEVEL_MIX|only \d+\/\d+ at\/below taught level|feminine-stem address$)/.test(e)) other = true;
  });
  if (other || !bad.size || bad.size > 2) return null;
  const kept = questions.filter((_, i) => !bad.has(i));
  const v = validate(kept, { ...ctx, nExpected: kept.length });
  return v.ok ? { questions: v.questions, dropped: [...bad] } : null;
}

/**
 * Draw the pictures and the question cards for a candidate set of questions.
 *
 * The attempt loop, the targeted rewrite and the salvage all need exactly this,
 * and all three treat a failure the same way: the candidate is not usable, the
 * reason is a `q<i>: FIGURE_RENDER` / `CARD_RENDER` string, and the next
 * recovery step runs. Called through `api` so a test can stub the two renders.
 */
async function renderFor(api, { questions, rows, language, teacherId, quizId }) {
  const [figureUrls, cardUrls] = await Promise.all([
    api.renderFigures({ questions, language, teacherId, quizId }),
    api.renderCards({ rows, questions, language, teacherId, quizId }),
  ]);
  return { figureUrls, cardUrls };
}

async function process(quizId, payload = {}) {
  const api = module.exports;
  const { data: quiz, error } = await supabase.from('quizzes')
    .select('id, teacher_id, coaching_session_id, topic, subject, language, status, meta, grade')
    .eq('id', quizId).maybeSingle();
  if (error || !quiz) {
    logToFile('⚠️ transcript quiz: generate — quiz not found', { quizId, error: error?.message });
    return { skipped: 'quiz_not_found' };
  }
  if (quiz.status === 'sent' || quiz.status === 'report_sent') return { skipped: 'already_sent' };
  if (!['generating', 'ready', 'offered'].includes(quiz.status)) return { skipped: `status_${quiz.status}` };

  const { data: session } = await supabase.from('coaching_sessions')
    .select(SESSION_SELECT).eq('id', quiz.coaching_session_id).maybeSingle();
  if (!session) {
    await updateQuiz(quizId, { status: 'failed', meta: { ...(quiz.meta || {}), step: 'failed', error: 'session_missing' } });
    return { failed: true, reason: 'session_missing' };
  }
  const user = session.users || {};
  const phone = payload.phone || user.phone_number;
  const teacherLang = teacherLanguageFor({ preferredLanguage: user.preferred_language });
  const teacherName = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
  let meta = { ...(quiz.meta || {}) };

  // ── digest (already there when the offer path claimed the row; /quiz path lands here without one)
  if (!meta.digest) {
    try {
      const r = await Digest.run({ session, user });
      meta = { ...meta, digest: r.digest, grade: r.grade, grade_source: r.gradeSource, lp_hint: r.lpHint,
        digest_model: r.model, cost_usd: (meta.cost_usd || 0) + (r.costUsd || 0) };
      // The teacher's own choice, stored on the row when the language ask was
      // answered, outranks the subject rule. The rule is what a legacy row (or
      // a skipped ask) falls back to.
      const language = quiz.language || quizLanguageFor(r.digest.subject, session.transcript_language);
      quiz.language = language;
      quiz.subject = r.digest.subject;
      quiz.topic = topicFor(r.digest, language);
      quiz.grade = r.grade;
      await updateQuiz(quizId, { topic: quiz.topic || 'Lesson', subject: quiz.subject, language, grade: r.grade || null, meta: { ...meta, step: 'author' } });
    } catch (err) {
      logToFile('❌ transcript quiz: digest failed in generate', { quizId, error: err.message }, 'error');
      await updateQuiz(quizId, { status: 'failed', meta: { ...meta, step: 'failed', error: `digest: ${err.message}` } });
      await tellTeacherFailed(phone, teacherLang, quizId, 'digest_failed');
      return { failed: true, reason: 'digest_failed' };
    }
  }
  const digest = meta.digest;
  const language = quiz.language || quizLanguageFor(digest.subject, session.transcript_language);

  // ── author + validate + store
  let questions = null;
  let figureUrls = {};
  let cardUrls = {};
  let draftedRows = null;
  if (quiz.status !== 'ready' || meta.step !== 'ready') {
    let previousErrors = null;
    let lastRejected = null;
    let lastErrors = null;
    let lastRewriteErrors = null;   // the complaint list the loop already rewrote
    let rewritten = null;           // the best failed-rewrite candidate for the salvage
    let lastLessonSummary = null;
    let readyLessonSummary = null;
    const attempts = [];
    const attemptsAllowed = maxAttempts();
    for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
      let out;
      try {
        out = await Author.author({
          digest, transcript: session.transcript_text, language, n: N_QUESTIONS,
          gradeBand: digest.grade_band || meta.grade, previousErrors, quizId,
        });
      } catch (err) {
        attempts.push({ attempt, error: err.message });
        previousErrors = [`the previous reply was not valid JSON (${err.code || err.message})`];
        continue;
      }
      lastLessonSummary = out.lessonSummary;
      const v = validate(out.questions, {
        language, subject: digest.subject, digest, nExpected: N_QUESTIONS, lessonSummary: out.lessonSummary, quizId,
      });
      attempts.push({ attempt, model: out.model, cost_usd: out.costUsd, latency_ms: out.latencyMs, errors: v.errors });
      meta.cost_usd = (meta.cost_usd || 0) + (out.costUsd || 0);
      if (v.ok) {
        const needFig = figureRequiredError({
          questions: v.questions, subject: digest.subject, attempt, maxAttempts: attemptsAllowed,
          gradeBand: digest.grade_band || meta.grade,
        });
        if (needFig) {
          attempts[attempts.length - 1].errors = [needFig];
          logToFile('⚠️ transcript quiz: drawable lesson came back without a picture', { quizId, attempt });
          previousErrors = [needFig];
          lastRejected = out.questions;
          lastErrors = [needFig];
          continue;
        }
        // The pictures are made BEFORE any row is stored: a figure that cannot
        // be drawn, screenshotted or uploaded fails this attempt exactly as a
        // validator complaint does, and the model is told which question and why.
        try {
          const drafted = toRows(quizId, v.questions);
          [figureUrls, cardUrls] = await Promise.all([
            api.renderFigures({ questions: v.questions, language, teacherId: quiz.teacher_id, quizId }),
            api.renderCards({ rows: drafted, questions: v.questions, language, teacherId: quiz.teacher_id, quizId }),
          ]);
          draftedRows = drafted;
        } catch (figErr) {
          attempts[attempts.length - 1].errors = [figErr.message];
          logToFile('⚠️ transcript quiz: attempt failed on a figure', { quizId, attempt, error: figErr.message });
          previousErrors = [figErr.message];
          continue;
        }
        questions = v.questions;
        readyLessonSummary = out.lessonSummary;
        break;
      }
      logToFile('⚠️ transcript quiz: validator rejected attempt', { quizId, attempt, errors: v.errors.slice(0, 8) });
      previousErrors = v.errors;
      lastRejected = out.questions;
      lastErrors = v.errors;
      // ── REPAIR BEFORE RE-ROLL ───────────────────────────────────────────
      // When every complaint of THIS attempt belongs to one question (a long
      // option, a missing "why", one pedagogy or figure fault), one small
      // rewrite is cheaper and surer than a second full author call — and a
      // second full call can come back with a complaint nothing can repair
      // (seen live 2026-09-06: attempt 1 = one long option, attempt 2 = a
      // level-mix fault on the whole set; the quiz died although attempt 1
      // was one shortened option away from shipping). The rewrite is tried
      // on every attempt but the last; the last one is handled below.
      if (attempt < attemptsAllowed) {
        // eslint-disable-next-line no-await-in-loop
        const early = await runRewrite({ rejected: out.questions, errors: v.errors, summary: out.lessonSummary, when: attempt });
        if (early.ok) break;
        if (early.tried) {
          lastRewriteErrors = lastErrors;
          previousErrors = early.errors && early.errors.length ? early.errors : v.errors;
        }
      }
    }
    // ── A TARGETED REWRITE BEFORE THE SALVAGE ───────────────────────────────
    // The last full attempt failed. When every remaining complaint belongs to
    // one question and at most three questions are involved, a full re-roll is
    // the wrong move — it has already been tried once and the model wrote the
    // same rejected question again (two live quizzes shipped 7 and 6 of 8 on
    // the same afternoon that way). ONE small call rewrites exactly those
    // questions; the merged set goes through the whole validator again.
    // (Skipped when the loop already rewrote exactly these complaints.)
    if (!questions && lastRejected && lastErrors && lastRewriteErrors !== lastErrors) {
      await runRewrite({ rejected: lastRejected, errors: lastErrors, summary: lastLessonSummary, when: 'last' });
    }
    // ── the rewrite, shared by the loop and the post-loop fallback ───────────
    async function runRewrite({ rejected, errors, summary, when }) {
      const rw = await api.rewriteRejected({
        questions: rejected, errors, digest, language,
        gradeBand: digest.grade_band || meta.grade, quizId, lessonSummary: summary,
      });
      if (!rw.attempted) return { tried: false, ok: false, errors: null };
      {
        meta.cost_usd = (meta.cost_usd || 0) + (rw.costUsd || 0);
        // PLAN_R6 D5 — the rewrite may also return a repaired `lesson_summary`
        // (a gendered reference to the teacher is the one quiz-level complaint
        // it is asked to fix). It is the summary the merged set is VALIDATED
        // with and the one that is stored, so the two cannot disagree.
        const rwSummary = rw.lessonSummary || summary;
        const v = rw.merged
          ? validate(rw.merged, {
            language, subject: digest.subject, digest, nExpected: N_QUESTIONS, lessonSummary: rwSummary, quizId,
          })
          : null;
        let ok = Boolean(v && v.ok);
        if (ok) {
          try {
            const drafted = toRows(quizId, v.questions);
            ({ figureUrls, cardUrls } = await renderFor(api, {
              questions: v.questions, rows: drafted, language, teacherId: quiz.teacher_id, quizId,
            }));
            draftedRows = drafted;
            questions = v.questions;
            readyLessonSummary = rwSummary;
          } catch (figErr) {
            logToFile('⚠️ transcript quiz: the rewritten set could not be drawn', { quizId, error: figErr.message });
            ok = false;
          }
        }
        // A rewrite that did not fully pass is still the better SALVAGE
        // candidate: it may have repaired one of two rejections, and the
        // salvage then drops one question instead of two.
        if (!ok && rw.merged && v) rewritten = { questions: rw.merged, errors: v.errors, lessonSummary: rwSummary };
        attempts.push({
          attempt: 'rewrite',
          after: when,
          indices: rw.indices,
          replaced: rw.replaced,
          model: rw.model || null,
          cost_usd: rw.costUsd || null,
          latency_ms: rw.latencyMs || null,
          errors: v ? v.errors : [rw.error || 'the rewrite returned no usable replacement'],
        });
        logEvent('transcript_quiz.rewrite_attempted', {
          quizId, after: when, indices: rw.indices, replaced: rw.replaced, ok, errors: v ? v.errors.length : null,
        });
        return { tried: true, ok, errors: v ? v.errors : null };
      }
    }

    // The last attempt failed. If every remaining complaint is about a PICTURE
    // or a pedagogy rule on a few questions, the quiz is good without those
    // questions: drop them and re-validate, rather than telling the teacher
    // nothing could be made over one drawing (corpus round 3 rejected 9 of 13
    // first-attempt figures). The rewritten set is tried FIRST — dropping a
    // question it already repaired would throw the repair away.
    if (!questions && lastRejected && lastErrors) {
      const base = { language, subject: digest.subject, digest, quizId };
      const candidates = [rewritten, { questions: lastRejected, errors: lastErrors }].filter(Boolean);
      for (const cand of candidates) {
        // The rewritten candidate carries its own (repaired) summary; the raw
        // last attempt carries the one it was authored with.
        const ctx = { ...base, lessonSummary: cand.lessonSummary || lastLessonSummary };
        const salvaged = salvageWithoutBadFigures(cand.questions, cand.errors, ctx);
        if (!salvaged) continue;
        try {
          const drafted = toRows(quizId, salvaged.questions);
          // eslint-disable-next-line no-await-in-loop
          ({ figureUrls, cardUrls } = await renderFor(api, {
            questions: salvaged.questions, rows: drafted, language, teacherId: quiz.teacher_id, quizId,
          }));
          draftedRows = drafted;
          questions = salvaged.questions;
          readyLessonSummary = ctx.lessonSummary;
          attempts.push({ attempt: 'salvage', dropped: salvaged.dropped, errors: [] });
          logEvent('transcript_quiz.figure_salvage', { quizId, dropped: salvaged.dropped, kept: questions.length });
          break;
        } catch (figErr) {
          logToFile('⚠️ transcript quiz: salvage could not render the remaining figures', { quizId, error: figErr.message });
        }
      }
    }
    // ── SOFT FAULTS NEVER COST A TEACHER THE QUIZ ────────────────────────────
    // Every attempt and every repair has run. If what remains is ONLY the two
    // level-mix rules (too many above the taught level / too few at
    // understand-or-above) or the picture share — properties of the SET, with
    // every question individually well formed and answerable — the quiz ships
    // and the faults are recorded, rather than the teacher who said yes being
    // told nothing could be made (production, 2026-09-07: a science lesson
    // died on its third attempt with "only 3 of 8 at understand or apply").
    if (!questions && lastRejected && lastErrors) {
      const cand = rewritten || { questions: lastRejected, errors: lastErrors, lessonSummary: lastLessonSummary };
      if (cand.errors.length && cand.errors.every((e) => SOFT_FAULT.test(String(e)))) {
        const v = validate(cand.questions, {
          language, subject: digest.subject, digest, nExpected: N_QUESTIONS, lessonSummary: cand.lessonSummary || lastLessonSummary, quizId,
        });
        if (v.errors.every((e) => SOFT_FAULT.test(String(e)))) {
          try {
            const drafted = toRows(quizId, v.questions);
            ({ figureUrls, cardUrls } = await renderFor(api, {
              questions: v.questions, rows: drafted, language, teacherId: quiz.teacher_id, quizId,
            }));
            draftedRows = drafted;
            questions = v.questions;
            readyLessonSummary = cand.lessonSummary || lastLessonSummary;
            meta.soft_faults = v.errors;
            attempts.push({ attempt: 'soft_ship', errors: v.errors });
            logEvent('transcript_quiz.shipped_with_soft_faults', { quizId, faults: v.errors.length, kinds: v.errors.map((e) => String(e).replace(/^q\d+: /, '').split(/\s|—/)[0]) });
          } catch (figErr) {
            logToFile('⚠️ transcript quiz: the soft-fault set could not be drawn', { quizId, error: figErr.message });
          }
        }
      }
    }
    meta.author_attempts = attempts;
    if (!questions) {
      await updateQuiz(quizId, { status: 'failed', meta: { ...meta, step: 'failed' } });
      await tellTeacherFailed(phone, teacherLang, quizId, 'validator_failed');
      return { failed: true, reason: 'validator_failed', attempts };
    }
    const rows = applyMedia(draftedRows || toRows(quizId, questions), questions, { figureUrls, cardUrls, language });
    await supabase.from('quiz_questions').delete().eq('quiz_id', quizId);
    const { error: insErr } = await supabase.from('quiz_questions').insert(rows);
    if (insErr) throw new Error(`quiz_questions insert failed: ${insErr.message}`);
    meta = {
      ...meta,
      step: 'ready',
      question_count: rows.length,
      ready_at: new Date().toISOString(),
      ...(readyLessonSummary ? { lesson_summary: readyLessonSummary } : {}),
    };
    await updateQuiz(quizId, { status: 'ready', meta });
    logEvent('transcript_quiz.ready', { quizId, questions: rows.length, language, attempts: attempts.length, costUsd: meta.cost_usd });
  }

  // ── hand-off (mint or reuse the share code, PDF, the three paced messages —
  // owned by transcript-quiz-handoff.service so /quiz "resend the link" can
  // run the exact same thing on a quiz that already went out).
  const { data: storedQs } = await supabase.from('quiz_questions')
    .select('external_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, distractor_misconceptions, option_feedback, media, render_pattern, sort_order')
    .eq('quiz_id', quizId).order('sort_order', { ascending: true });
  const qRows = storedQs && storedQs.length ? storedQs : applyMedia(toRows(quizId, questions || []), questions || [], { figureUrls, cardUrls, language });

  const Handoff = require('./transcript-quiz-handoff.service');
  const result = await Handoff.sendHandoff(quizId, phone, {
    firstSend: true,
    prepared: { quiz, session, questions, qRows, digest, teacherName, meta, language, teacherLang },
  });
  if (!result.ok) return { failed: true, reason: result.reason };
  return { ok: true, quizId, code: result.code };
}

module.exports = {
  salvageWithoutBadFigures,
  rewriteRejected: (args) => require('./transcript-quiz-rewrite').rewriteRejected(args),
  figureRequiredError,
  SOFT_FAULT,
  isEarlyYearsBand,
  process, toRows, stampDisplayOrder, renderFigures, renderCards, applyMedia, withFigureSvgs, studentMessage, teacherLabel, renderPdf, pdfFilename,
  sleep, N_QUESTIONS, MAX_ATTEMPTS, maxAttempts, NUDGE_AFTER_MS,
};
