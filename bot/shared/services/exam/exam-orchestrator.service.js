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

const FRIENDLY_MESSAGES = {
  en: {
    starting: (grade, subject, type, chapters) =>
      `Making your Grade ${grade} ${subject} ${type.toLowerCase()} test on ` +
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
      `آپ کا گریڈ ${grade} ${subject} ${type === 'WEEKLY' ? 'ہفتہ وار' : 'ٹرم'} امتحان تیار ہو رہا ہے ` +
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
  await WhatsAppService.sendMessage(phone, msg);
}

async function sendPaperToTeacher(phone, url, filename, lang) {
  await WhatsAppService.sendMessage(phone, FRIENDLY_MESSAGES[lang].ready);
  await WhatsAppService.sendDocumentFromUrl(phone, url, filename, null);
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
  const { userId, type, grade, subject, language, chapters } = request;
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
    composed = await composeExam({ userId, type, grade, subject, language, chapters });
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
    } catch (_e) { /* swallow */ }
    return;
  }

  // Best-effort progress ping.
  try {
    await sendStartingMessage(teacher.phone_number, composed.exam, lang);
  } catch (_e) { /* not fatal — press on */ }

  let published;
  try {
    published = await renderAndPublish(composed);
  } catch (err) {
    logToFile('[exam-orchestrator] render failed', { message: err.message });
    await markFailed(composed.exam.id, err.message);
    try {
      await WhatsAppService.sendMessage(teacher.phone_number, M.generic);
    } catch (_e) { /* swallow */ }
    return;
  }

  try {
    await sendPaperToTeacher(
      teacher.phone_number, published.publicUrl, published.filename, lang
    );
  } catch (err) {
    logToFile('[exam-orchestrator] delivery failed', { message: err.message });
    // Exam is ready in DB — teacher can be re-notified via a retry job.
  }

  logToFile('[exam-orchestrator] complete', { examId: composed.exam.id });
}

module.exports = { generateExam };
