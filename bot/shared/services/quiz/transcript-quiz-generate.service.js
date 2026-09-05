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
const MAX_ATTEMPTS = 2;
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
  return questions.map((q, i) => {
    const order = [0, 1, 2];
    for (let k = order.length - 1; k > 0; k -= 1) {
      const j = Math.floor(rng() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    // order[newPos] = oldIdx
    const opts = order.map((old) => String(q.options[old]).trim());
    const newCorrect = order.indexOf(Number(q.correct_index));
    const wrong = {};
    const misc = {};
    order.forEach((old, pos) => {
      if (pos === newCorrect) return;
      const w = q.option_feedback?.wrong?.[String(old)];
      if (w) wrong[String(pos)] = String(w).trim();
      const m = q.distractor_misconceptions?.[String(old)];
      if (m) misc['ABC'[pos]] = String(m).trim();
    });
    // A picture question is P3: the child gets ONE interactive message —
    // image header, stem body, three reply buttons. The URL is keyed on the
    // question's index, so a figure whose PNG never uploaded degrades to a
    // plain P1 question rather than to a row pointing at nothing.
    const figureUrl = figureUrls[i];
    const selectedBecause = String(q.selected_because || '').trim();
    const media = (q.figure && figureUrl)
      ? { question_image: figureUrl, figure: q.figure, ...(selectedBecause ? { selected_because: selectedBecause } : {}) }
      : (selectedBecause ? { selected_because: selectedBecause } : null);

    return {
      quiz_id: quizId,
      question_text: String(q.question).trim(),
      option_a: opts[0], option_b: opts[1], option_c: opts[2],
      correct_option: 'ABC'[newCorrect],
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
      render_pattern: (media && media.question_image) ? 'P3' : 'P1',
      ...(media ? { media } : {}),
      sort_order: i,
    };
  });
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
  const urls = {};
  const jobs = rows.map((row, i) => ({ row, i })).filter(({ row }) => Card.needsQuestionCard(row));
  await runPool(jobs, 3, async ({ row, i }) => {
    const startedAt = Date.now();
    try {
      const labels = render.optionLabels(row);
      const displayOrder = render.displayOrder(row, labels);
      const authored = questions && questions[i];
      const figureSvg = (authored && authored.figureSvg) || null;
      const png = await Card.renderQuestionCardPng({
        stem: row.question_text, options: labels, displayOrder, figureSvg, language,
        questionNumber: i + 1, total: rows.length,
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
 * Round 2 gave the sheet two languages at once: her stored preference for the
 * labels, the quiz's language for the questions. It reads as a defect — an
 * English PDF with Urdu down its side — so both arguments are now the quiz's
 * language, which is the one she chose for this quiz and the one her class
 * will read. Her stored preference still decides every WhatsApp message
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
 * Drop the questions whose ONLY complaints are picture rules, and re-validate.
 * Returns { questions, dropped } when the rest still make a valid quiz, else null.
 */
function salvageWithoutBadFigures(questions, errors, ctx) {
  const figureErr = /^q(\d+): FIGURE_/;
  const bad = new Set();
  let other = false;
  errors.forEach((e) => {
    const m = figureErr.exec(e);
    if (m) bad.add(Number(m[1]));
    else if (!/^FIGURE_SHARE/.test(e)) other = true;
  });
  if (other || !bad.size || bad.size > 2) return null;
  const kept = questions.filter((_, i) => !bad.has(i));
  const v = validate(kept, { ...ctx, nExpected: kept.length });
  return v.ok ? { questions: v.questions, dropped: [...bad] } : null;
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
      // The teacher's own choice, stored on the row when she answered the
      // language ask, outranks the subject rule. The rule is what a legacy
      // row (or a skipped ask) falls back to.
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
    let lastLessonSummary = null;
    let readyLessonSummary = null;
    const attempts = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
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
        language, subject: digest.subject, digest, nExpected: N_QUESTIONS, lessonSummary: out.lessonSummary,
      });
      attempts.push({ attempt, model: out.model, cost_usd: out.costUsd, latency_ms: out.latencyMs, errors: v.errors });
      meta.cost_usd = (meta.cost_usd || 0) + (out.costUsd || 0);
      if (v.ok) {
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
    }
    // The last attempt failed. If every remaining complaint is about a PICTURE
    // on a few questions, the quiz is good without those questions: drop them
    // and re-validate, rather than telling the teacher nothing could be made
    // over one drawing (corpus round 3 rejected 9 of 13 first-attempt figures).
    if (!questions && lastRejected && lastErrors) {
      const salvaged = salvageWithoutBadFigures(lastRejected, lastErrors, {
        language, subject: digest.subject, digest, lessonSummary: lastLessonSummary,
      });
      if (salvaged) {
        try {
          const drafted = toRows(quizId, salvaged.questions);
          [figureUrls, cardUrls] = await Promise.all([
            api.renderFigures({ questions: salvaged.questions, language, teacherId: quiz.teacher_id, quizId }),
            api.renderCards({ rows: drafted, questions: salvaged.questions, language, teacherId: quiz.teacher_id, quizId }),
          ]);
          draftedRows = drafted;
          questions = salvaged.questions;
          readyLessonSummary = lastLessonSummary;
          attempts.push({ attempt: 'salvage', dropped: salvaged.dropped, errors: [] });
          logEvent('transcript_quiz.figure_salvage', { quizId, dropped: salvaged.dropped, kept: questions.length });
        } catch (figErr) {
          logToFile('⚠️ transcript quiz: salvage could not render the remaining figures', { quizId, error: figErr.message });
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

  // ── hand-off
  const { data: storedQs } = await supabase.from('quiz_questions')
    .select('external_id, question_text, option_a, option_b, option_c, correct_option, explanation, distractor_misconceptions, option_feedback, media, render_pattern, sort_order')
    .eq('quiz_id', quizId).order('sort_order', { ascending: true });
  const qRows = storedQs && storedQs.length ? storedQs : applyMedia(toRows(quizId, questions || []), questions || [], { figureUrls, cardUrls, language });

  const share = require('./video-quiz-share.service');
  const minted = await share.mintCode({ quizId, userId: quiz.teacher_id, videoId: null, language });
  if (!minted) {
    await updateQuiz(quizId, { meta: { ...meta, step: 'ready', handoff_error: 'mint_failed' } });
    await WhatsAppService.sendMessage(phone, resolveUx('tqCouldNotSend', { language: teacherLang }));
    return { failed: true, reason: 'mint_failed' };
  }
  const link = `https://wa.me/${share.botNumber()}?text=QUIZ-${minted.code}`;
  const lessonDate = formatLessonDate(session.created_at, language);
  const forwardable = studentMessage({ teacherName: minted.teacherName || teacherName, topic: quiz.topic, date: lessonDate, link, language });

  // PDF — best effort. A missing PDF is a worse teacher experience, not a
  // reason to withhold the quiz her class can already take.
  let pdfKey = null;
  let tempPath = null;
  try {
    const buffer = await renderPdf({
      quiz, questions: withFigureSvgs(qRows, questions, language), digest, teacherName,
      grade: quiz.grade || meta.grade || null,
      lessonSummary: meta.lesson_summary || '',
      // D1: one language for the whole document, and it is the quiz's — not
      // `teacherLang`, which still owns the messages either side of it.
      language, contentLanguage: language,
      date: formatLessonDate(session.created_at, language, { year: true }), link,
    });
    try {
      const { uploadBuffer } = require('../../storage/r2');
      pdfKey = `transcript_quizzes/${quiz.teacher_id}/${quizId}.pdf`;
      await uploadBuffer(buffer, pdfKey, 'application/pdf');
    } catch (upErr) {
      pdfKey = null;
      logToFile('⚠️ transcript quiz: PDF upload to R2 failed (continuing)', { quizId, error: upErr.message });
    }
    tempPath = path.join(os.tmpdir(), `transcript-quiz-${quizId}.pdf`);
    fs.writeFileSync(tempPath, buffer);
  } catch (err) {
    logToFile('⚠️ transcript quiz: PDF render failed (sending the link without it)', { quizId, error: err.message });
  }

  const caption = resolveUx('tqHandoffIntro', {
    language: teacherLang,
    params: { lesson: lessonLabel({ digest, quizLanguage: language, teacherLanguage: teacherLang }), n: qRows.length },
  });
  let pdfSent = false;
  if (tempPath) {
    pdfSent = await WhatsAppService.sendDocument(phone, tempPath, pdfFilename(quiz.topic), caption);
    try { fs.unlinkSync(tempPath); } catch { /* not worth failing over */ }
  }
  if (!pdfSent) {
    await WhatsAppService.sendMessage(phone, `${caption}\n\n${resolveUx('tqForwardThis', { language: teacherLang })}`);
  }
  await api.sleep(GAP_MS);
  await WhatsAppService.sendMessage(phone, forwardable);      // THE forwardable message, alone
  await api.sleep(GAP_MS);
  await WhatsAppService.sendMessage(phone, resolveUx('tqReportPromise', { language: teacherLang }));

  meta = {
    ...meta, step: 'sent', share_code: minted.code, share_code_id: minted.id, link,
    student_message: forwardable, pdf_key: pdfKey, pdf_sent: pdfSent, sent_at: new Date().toISOString(),
  };
  await updateQuiz(quizId, { status: 'sent', meta });
  logEvent('transcript_quiz.sent', { quizId, userId: quiz.teacher_id, code: minted.code, language, pdfSent, costUsd: meta.cost_usd });

  try {
    const SQSQueueService = require('../queue/sqs-queue.service');
    const targetAt = new Date(Date.now() + NUDGE_AFTER_MS).toISOString();
    await SQSQueueService.queueJob(quizId, 'quiz_nudge_teacher', { quizId, targetAt }, {
      delaySeconds: 900, deduplicationId: `${quizId}-quiz_nudge_teacher`,
    });
  } catch (err) {
    logToFile('⚠️ transcript quiz: nudge scheduling failed (non-fatal)', { quizId, error: err.message });
  }
  return { ok: true, quizId, code: minted.code };
}

module.exports = {
  salvageWithoutBadFigures,
  process, toRows, renderFigures, renderCards, applyMedia, withFigureSvgs, studentMessage, teacherLabel, renderPdf, pdfFilename,
  sleep, N_QUESTIONS, MAX_ATTEMPTS, NUDGE_AFTER_MS,
};
