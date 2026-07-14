/**
 * Exam Orchestrator — end-to-end pipeline for one exam-generate request.
 *
 * Trigger: WhatsApp Flow submits { userId, type, grade, subject, language, chapters }
 *          → queued as an EXAM_GENERATE job → sqs-worker calls this.
 *
 * Steps:
 *   1. composeExam (composer.service)      — pick + snapshot questions, insert rows
 *   2. renderAndPublish (render.service)   — build .docx, upload to R2, mark ready
 *   3. sendPaperToTeacher                  — deliver via WhatsApp
 *
 * Failure modes are surfaced as friendly WhatsApp messages (see the design doc's
 * "Failure modes" table). exams.status = 'failed' + error_reason on catch.
 */

const { composeExam } = require('./exam-composer.service');
const { renderAndPublish } = require('./exam-render.service');
const WhatsAppService = require('../whatsapp.service');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

// exam.grade is stored as the pre-formatted "Grade Five" / "Grade Prep" string,
// so any user-facing message that adds its own "Grade " / "گریڈ " prefix produces
// the double-prefix bug seen on 2026-07-12 ("Grade Grade Five ..."). Strip the
// leading token here so both the filename builder and these chat messages behave.
function stripGradePrefix(grade) {
  return String(grade || '').replace(/^grade\s*/i, '').replace(/^گریڈ\s*/, '');
}

const FRIENDLY_MESSAGES = {
  en: {
    starting: (grade, subject, type, chapters) =>
      `Making your Grade ${stripGradePrefix(grade)} ${subject} ${type.toLowerCase()} test on ` +
      `${chapters.length === 1 ? `Chapter ${chapters[0]}` : `Chapters ${chapters.join(', ')}`}. ~30 sec…`,
    ready: 'Your exam is ready 👇',
    insufficient: (bucket) =>
      `Not enough questions in these chapters yet${bucket ? ` (${bucket})` : ''}. ` +
      `Try picking more chapters, or ask us to add coverage.`,
    empty:
      "We don't have questions for that combination yet. Try a different grade / subject / language, " +
      'or contact us to add coverage.',
    generic: 'Something went wrong generating your exam. Please try again in a minute.',
  },
  ur: {
    starting: (grade, subject, type, chapters) =>
      `آپ کا گریڈ ${stripGradePrefix(grade)} ${subject} ${type === 'WEEKLY' ? 'ہفتہ وار' : 'ٹرم'} امتحان تیار ہو رہا ہے ` +
      `(${chapters.length === 1 ? `چیپٹر ${chapters[0]}` : `چیپٹرز ${chapters.join('، ')}`}). ~30 سیکنڈ…`,
    ready: 'آپ کا امتحان تیار ہے 👇',
    insufficient: (bucket) =>
      `ان چیپٹرز میں ابھی کافی سوالات نہیں${bucket ? ` (${bucket})` : ''}۔ ` +
      `مزید چیپٹرز منتخب کریں یا ہمیں اضافہ کرنے کو کہیں۔`,
    empty:
      'اس مجموعے کے لیے ابھی سوالات دستیاب نہیں۔ مختلف گریڈ / مضمون / زبان آزمائیں یا ہم سے رابطہ کریں۔',
    generic: 'امتحان بنانے میں کچھ مسئلہ ہوا۔ ایک منٹ بعد دوبارہ کوشش کریں۔',
  },
};

function pickLang(language) {
  return language === 'ur' ? 'ur' : 'en';
}

/**
 * Load the teacher's phone_number for WhatsApp delivery.
 */
async function loadTeacherPhone(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('phone_number, preferred_language')
    .eq('id', userId)
    .single();
  if (error) throw new Error(`user lookup failed: ${error.message}`);
  return data;
}

async function sendStartingMessage(phone, exam, lang) {
  const msg = FRIENDLY_MESSAGES[lang].starting(
    exam.grade, exam.subject, exam.type, exam.chapters
  );
  return await WhatsAppService.sendMessage(phone, msg);
}

async function sendPaperToTeacher(phone, url, filename, lang) {
  // WhatsAppService.sendMessage / sendDocumentFromUrl catch errors internally
  // and return false — they never throw. Bubble the results back up so the
  // orchestrator can distinguish "delivered" from "silently dropped" and log
  // the individual step that failed.
  const readyOk = await WhatsAppService.sendMessage(phone, FRIENDLY_MESSAGES[lang].ready);
  const docOk = await WhatsAppService.sendDocumentFromUrl(phone, url, filename, null);
  return { readyOk, docOk };
}

async function markFailed(examId, reason) {
  await supabase
    .from('exams')
    .update({ status: 'failed', error_reason: String(reason).slice(0, 500) })
    .eq('id', examId);
}

/**
 * Main entry — called by the SQS worker's EXAM_GENERATE case.
 */
async function generateExam(request) {
  const { userId, type, grade, subject, language, chapters, question_types } = request;
  const lang = pickLang(language);
  const M = FRIENDLY_MESSAGES[lang];

  logToFile('[exam-orchestrator] start', request);

  const teacher = await loadTeacherPhone(userId);
  if (!teacher || !teacher.phone_number) {
    logToFile('[exam-orchestrator] no phone_number for user', { userId });
    return; // no way to communicate — silent drop, log for triage
  }

  let composed;
  try {
    composed = await composeExam({ userId, type, grade, subject, language, chapters, question_types });
  } catch (err) {
    logToFile('[exam-orchestrator] compose failed', {
      code: err.code, bucket: err.bucket, message: err.message,
    });
    let friendly;
    if (err.code === 'EMPTY_POOL') friendly = M.empty;
    else if (err.code === 'INSUFFICIENT_POOL') friendly = M.insufficient(err.bucket);
    else friendly = M.generic;
    try {
      await WhatsAppService.sendMessage(teacher.phone_number, friendly);
    } catch (e) {
      logToFile('[exam-orchestrator] compose-fail notice send err', {
        err: e.message, stack: e.stack, phone: teacher.phone_number,
      });
    }
    return;
  }

  // Best-effort progress ping. Both throws AND falsy returns need to surface
  // — the 2026-07-12 incident was a silent `sendMessage → false` inside the
  // WhatsAppService catch block, which the previous swallow-and-move-on wrapper
  // hid completely. Now we log both failure modes.
  try {
    const startingOk = await sendStartingMessage(teacher.phone_number, composed.exam, lang);
    if (!startingOk) {
      logToFile('[exam-orchestrator] starting msg returned false (WA API failure)', {
        phone: teacher.phone_number,
        examId: composed.exam?.id,
        grade: composed.exam?.grade,
        subject: composed.exam?.subject,
        chapters: composed.exam?.chapters,
      });
    }
  } catch (e) {
    logToFile('[exam-orchestrator] starting msg send err', {
      err: e.message, stack: e.stack,
      phone: teacher.phone_number,
      examId: composed.exam?.id,
      grade: composed.exam?.grade,
      subject: composed.exam?.subject,
      chapters: composed.exam?.chapters,
    });
  }

  let published;
  try {
    published = await renderAndPublish(composed);
  } catch (err) {
    logToFile('[exam-orchestrator] render failed', { message: err.message, stack: err.stack });
    await markFailed(composed.exam.id, err.message);
    try {
      await WhatsAppService.sendMessage(teacher.phone_number, M.generic);
    } catch (e) {
      logToFile('[exam-orchestrator] render-fail notice send err', {
        err: e.message, stack: e.stack, phone: teacher.phone_number,
      });
    }
    return;
  }

  try {
    const { readyOk, docOk } = await sendPaperToTeacher(
      teacher.phone_number, published.publicUrl, published.filename, lang
    );
    if (!readyOk || !docOk) {
      logToFile('[exam-orchestrator] delivery step returned false (WA API failure)', {
        readyOk, docOk,
        phone: teacher.phone_number,
        examId: composed.exam?.id,
        filename: published?.filename,
        publicUrlPrefix: published?.publicUrl ? String(published.publicUrl).slice(0, 80) : null,
      });
    } else {
      logToFile('[exam-orchestrator] delivered ok', {
        phone: teacher.phone_number,
        examId: composed.exam?.id,
        filename: published?.filename,
      });
    }
  } catch (err) {
    logToFile('[exam-orchestrator] delivery threw', {
      err: err.message, stack: err.stack,
      phone: teacher.phone_number,
      examId: composed.exam?.id,
      filename: published?.filename,
      publicUrlPrefix: published?.publicUrl ? String(published.publicUrl).slice(0, 80) : null,
    });
    // Exam is ready in DB — teacher can be re-notified via a retry job.
  }

  logToFile('[exam-orchestrator] complete', { examId: composed.exam.id });
}

module.exports = { generateExam };
