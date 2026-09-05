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
function toRows(quizId, questions, { rng = Math.random } = {}) {
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
      external_id: `tq:${q.slo_id || 'S?'}:${i + 1}`,
      render_pattern: 'P1',
      sort_order: i,
    };
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
 * `language` is the TEACHER's — labels, instructions, the footer.
 * `contentLanguage` is the QUIZ's — stems, options, explanations, the topic.
 * They differ whenever an English-preferring teacher teaches an Urdu-medium
 * lesson, which is the common case here; passing only one of them puts the
 * quiz's script on a font that has no glyphs for it.
 */
async function renderPdf({ quiz, questions, digest, teacherName, language, contentLanguage, date, link }) {
  const { htmlToPdf } = require('../../utils/html-to-pdf');
  const render = require('../../templates/transcript-quiz-teacher.template');
  const html = render({
    topic: quiz.topic, teacherName, date, link, digest, questions,
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
  const teacherLang = teacherLanguageFor({ preferredLanguage: user.preferred_language, transcriptLanguage: session.transcript_language });
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
  if (quiz.status !== 'ready' || meta.step !== 'ready') {
    let previousErrors = null;
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
      const v = validate(out.questions, { language, subject: digest.subject, digest, nExpected: N_QUESTIONS });
      attempts.push({ attempt, model: out.model, cost_usd: out.costUsd, latency_ms: out.latencyMs, errors: v.errors });
      meta.cost_usd = (meta.cost_usd || 0) + (out.costUsd || 0);
      if (v.ok) { questions = v.questions; break; }
      logToFile('⚠️ transcript quiz: validator rejected attempt', { quizId, attempt, errors: v.errors.slice(0, 8) });
      previousErrors = v.errors;
    }
    meta.author_attempts = attempts;
    if (!questions) {
      await updateQuiz(quizId, { status: 'failed', meta: { ...meta, step: 'failed' } });
      await tellTeacherFailed(phone, teacherLang, quizId, 'validator_failed');
      return { failed: true, reason: 'validator_failed', attempts };
    }
    const rows = toRows(quizId, questions);
    await supabase.from('quiz_questions').delete().eq('quiz_id', quizId);
    const { error: insErr } = await supabase.from('quiz_questions').insert(rows);
    if (insErr) throw new Error(`quiz_questions insert failed: ${insErr.message}`);
    meta = { ...meta, step: 'ready', question_count: rows.length, ready_at: new Date().toISOString() };
    await updateQuiz(quizId, { status: 'ready', meta });
    logEvent('transcript_quiz.ready', { quizId, questions: rows.length, language, attempts: attempts.length, costUsd: meta.cost_usd });
  }

  // ── hand-off
  const { data: storedQs } = await supabase.from('quiz_questions')
    .select('external_id, question_text, option_a, option_b, option_c, correct_option, explanation, distractor_misconceptions, option_feedback, sort_order')
    .eq('quiz_id', quizId).order('sort_order', { ascending: true });
  const qRows = storedQs && storedQs.length ? storedQs : toRows(quizId, questions || []);

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
      quiz, questions: qRows, digest, teacherName,
      language: teacherLang, contentLanguage: language,
      date: formatLessonDate(session.created_at, teacherLang, { year: true }), link,
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

module.exports = { process, toRows, studentMessage, teacherLabel, renderPdf, pdfFilename, sleep, N_QUESTIONS, MAX_ATTEMPTS, NUDGE_AFTER_MS };
