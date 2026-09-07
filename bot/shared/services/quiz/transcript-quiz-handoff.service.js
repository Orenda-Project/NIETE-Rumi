'use strict';
/**
 * Transcript quiz — HAND-OFF: mint (or reuse) the share code, get the teacher
 * the PDF, and send the forwardable link — once from generate(), and again,
 * link-for-link the same, whenever they tap "resend the link" from /quiz.
 *
 * The share code is minted AT MOST ONCE, ever: once `meta.share_code_id` and
 * `meta.student_message` exist, every later call reuses them verbatim. A
 * resend never rewrites `status`/`sent_at`, never re-promises a report the
 * teacher already has, and never schedules a second nudge — only the very first
 * send (`firstSend: true`, always from generate()'s process()) does that.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { teacherLanguageFor, formatLessonDate, lessonLabel } = require('./transcript-quiz-language');

const GAP_MS = 1200;
const NUDGE_AFTER_MS = 6 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUIZ_QUESTIONS_SELECT = 'external_id, question_text, option_a, option_b, option_c, correct_option, '
  + 'explanation, distractor_misconceptions, option_feedback, media, render_pattern, sort_order';

async function updateQuiz(quizId, patch) {
  const { error } = await supabase.from('quizzes').update(patch).eq('id', quizId);
  if (error) throw new Error(`quizzes update failed: ${error.message}`);
}

/**
 * Everything sendHandoff needs when the caller does NOT already hold it in
 * memory — the /quiz resend path, which only has a quizId and a phone.
 */
async function load(quizId) {
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, topic, subject, language, grade, status, meta, coaching_session_id')
    .eq('id', quizId).maybeSingle();
  if (!quiz) return null;
  const meta = quiz.meta || {};

  const [{ data: session }, { data: user }, { data: storedQs }] = await Promise.all([
    supabase.from('coaching_sessions').select('created_at').eq('id', quiz.coaching_session_id).maybeSingle(),
    supabase.from('users').select('preferred_language, first_name, last_name').eq('id', quiz.teacher_id).maybeSingle(),
    supabase.from('quiz_questions').select(QUIZ_QUESTIONS_SELECT).eq('quiz_id', quizId).order('sort_order', { ascending: true }),
  ]);

  const teacherLang = teacherLanguageFor({ preferredLanguage: user?.preferred_language });
  const teacherName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || null;

  return {
    quiz, session: session || {}, questions: null, qRows: storedQs || [],
    digest: meta.digest, meta, language: quiz.language, teacherLang, teacherName,
  };
}

/**
 * @returns {Promise<{ok:true,code:string,pdfSent:boolean,reused:boolean}|{ok:false,reason:string}>}
 */
async function sendHandoff(quizId, phone, { firstSend = false, prepared = null } = {}) {
  const api = module.exports;
  const bundle = prepared || await load(quizId);
  if (!bundle) return { ok: false, reason: 'quiz_not_found' };
  const {
    quiz, session, questions, qRows, digest, teacherName, teacherLang, language,
  } = bundle;
  const meta = bundle.meta || {};

  // ── the share code — minted once, reused forever ──────────────────────────
  const share = require('./video-quiz-share.service');
  let code;
  let shareCodeId;
  let link;
  let forwardable;
  let reused = false;
  if (meta.share_code_id && meta.student_message) {
    code = meta.share_code;
    shareCodeId = meta.share_code_id;
    link = meta.link;
    forwardable = meta.student_message;
    reused = true;
  } else if (!firstSend) {
    // A RESEND has nothing to mint from. Reaching here means the row is missing
    // one half of the pair (a `student_message` written without a
    // `share_code_id`, or the reverse) — and minting would hand the teacher a
    // SECOND code for a class that already has a link. "The link, as agreed,
    // should be the same one that was originally used": only the first send
    // ever mints, and that is enforced here rather than at each caller.
    logToFile('⚠️ transcript quiz: resend asked for on a quiz with no code to reuse', {
      quizId, hasCodeId: Boolean(meta.share_code_id), hasMessage: Boolean(meta.student_message),
    });
    logEvent('transcript_quiz.resend_without_code', { quizId });
    return { ok: false, reason: 'no_code_to_reuse' };
  } else {
    const minted = await share.mintCode({ quizId, userId: quiz.teacher_id, videoId: null, language });
    if (!minted) {
      await updateQuiz(quizId, { meta: { ...meta, step: 'ready', handoff_error: 'mint_failed' } });
      await WhatsAppService.sendMessage(phone, resolveUx('tqCouldNotSend', { language: teacherLang }));
      return { ok: false, reason: 'mint_failed' };
    }
    code = minted.code;
    shareCodeId = minted.id;
    link = `https://wa.me/${share.botNumber()}?text=QUIZ-${code}`;
    const lessonDate = formatLessonDate(session.created_at, language);
    const Gen = require('./transcript-quiz-generate.service');
    forwardable = Gen.studentMessage({ teacherName: minted.teacherName || teacherName, topic: quiz.topic, date: lessonDate, link, language });
  }

  // ── the PDF — the SAME object the teacher was sent, best effort ────────────
  // meta.pdf_key is the document already on R2; only when it is absent, or the
  // object is gone, do we pay to re-render it (and re-upload so the next
  // resend gets the cheap path too). A PDF that cannot be produced at all is
  // still not a reason to withhold the link.
  let pdfKey = meta.pdf_key || null;
  let tempPath = null;
  let rerendered = false;
  if (pdfKey) {
    try {
      const { downloadFromR2 } = require('../../storage/r2');
      const buffer = await downloadFromR2(pdfKey);
      tempPath = path.join(os.tmpdir(), `transcript-quiz-${quizId}.pdf`);
      fs.writeFileSync(tempPath, buffer);
    } catch (err) {
      logToFile('⚠️ transcript quiz: stored PDF could not be fetched from R2, re-rendering', { quizId, error: err.message });
      tempPath = null;
      pdfKey = null;
    }
  }
  if (!tempPath) {
    try {
      const Gen = require('./transcript-quiz-generate.service');
      const buffer = await Gen.renderPdf({
        quiz, questions: Gen.withFigureSvgs(qRows, questions, language), digest, teacherName,
        grade: quiz.grade || meta.grade || null,
        lessonSummary: meta.lesson_summary || '',
        // D1: one language for the whole document, and it is the quiz's.
        language, contentLanguage: language,
        date: formatLessonDate(session.created_at, language, { year: true }), link,
      });
      try {
        const { uploadBuffer } = require('../../storage/r2');
        pdfKey = `transcript_quizzes/${quiz.teacher_id}/${quizId}.pdf`;
        await uploadBuffer(buffer, pdfKey, 'application/pdf');
        rerendered = true;
      } catch (upErr) {
        pdfKey = null;
        logToFile('⚠️ transcript quiz: PDF upload to R2 failed (continuing)', { quizId, error: upErr.message });
      }
      tempPath = path.join(os.tmpdir(), `transcript-quiz-${quizId}.pdf`);
      fs.writeFileSync(tempPath, buffer);
    } catch (err) {
      logToFile('⚠️ transcript quiz: PDF render failed (sending the link without it)', { quizId, error: err.message });
    }
  }

  // ── send: document (or its text fallback), THEN the link alone, THEN (first
  // send only) the report promise — paced exactly as process() always paced it.
  const caption = resolveUx('tqHandoffIntro', {
    language: teacherLang,
    params: { lesson: lessonLabel({ digest, quizLanguage: language, teacherLanguage: teacherLang }), n: qRows.length },
  });
  let pdfSent = false;
  if (tempPath) {
    const { pdfFilename } = require('./transcript-quiz-generate.service');
    pdfSent = await WhatsAppService.sendDocument(phone, tempPath, pdfFilename(quiz.topic), caption);
    try { fs.unlinkSync(tempPath); } catch { /* not worth failing over */ }
  }
  if (!pdfSent) {
    await WhatsAppService.sendMessage(phone, `${caption}\n\n${resolveUx('tqForwardThis', { language: teacherLang })}`);
  }
  await api.sleep(GAP_MS);
  await WhatsAppService.sendMessage(phone, forwardable);      // THE forwardable message, alone
  if (firstSend) {
    await api.sleep(GAP_MS);
    await WhatsAppService.sendMessage(phone, resolveUx('tqReportPromise', { language: teacherLang }));
  }

  // ── bookkeeping — only the first send owns status/sent_at/the nudge ────────
  if (firstSend) {
    const newMeta = {
      ...meta, step: 'sent', share_code: code, share_code_id: shareCodeId, link,
      student_message: forwardable, pdf_key: pdfKey, pdf_sent: pdfSent, sent_at: new Date().toISOString(),
    };
    await updateQuiz(quizId, { status: 'sent', meta: newMeta });
    logEvent('transcript_quiz.sent', { quizId, userId: quiz.teacher_id, code, language, pdfSent, costUsd: meta.cost_usd });

    try {
      const SQSQueueService = require('../queue/sqs-queue.service');
      // Six hours, pushed out of the 21:00-07:00 PKT quiet window rather than
      // dropped — the worker re-queues until this instant.
      const { nudgeTargetUtc } = require('./transcript-quiz-nudge.service');
      const targetAt = nudgeTargetUtc(new Date(Date.now() + NUDGE_AFTER_MS)).toISOString();
      await SQSQueueService.queueJob(quizId, 'quiz_nudge_teacher', { quizId, targetAt }, {
        delaySeconds: 900, deduplicationId: `${quizId}-quiz_nudge_teacher`,
      });
    } catch (err) {
      logToFile('⚠️ transcript quiz: nudge scheduling failed (non-fatal)', { quizId, error: err.message });
    }
  } else {
    // A resend that had to re-render the PDF still saves the new key so the
    // NEXT resend gets the cheap R2 download — and touches nothing else.
    if (rerendered && pdfKey) {
      await updateQuiz(quizId, { meta: { ...meta, pdf_key: pdfKey } });
    }
    logEvent('transcript_quiz.handoff_resent', { quizId, code, pdfSent });
  }

  return { ok: true, code, pdfSent, reused };
}

module.exports = { sendHandoff, sleep, GAP_MS, NUDGE_AFTER_MS };
