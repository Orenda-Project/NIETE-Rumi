/**
 * Exam Render Service — takes a composed exam and produces a .docx file
 * uploaded to R2. Updates the exams row with paper_docx_url + status='ready'.
 *
 * Called by exam-orchestrator.service.js after composition. Isolated so a
 * v2 answer-key render can hang off the same input without touching the
 * composition or orchestration layers.
 */

const { buildExamDocx } = require('./exam-paper.template');
const { uploadExamBuffer, getPresignedUrl } = require('../../storage/r2');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

/**
 * Descriptive filename: `GradeFive_Math_Weekly_2026-07-12.docx`
 * Chosen per design decision on filename convention.
 *
 * exam.grade is stored denormalized as "Grade Five" / "Grade Prep" / etc.
 * (see 05-exam-generator migration doc). Strip the leading "Grade " token
 * before the alphanumeric normalizer so we don't end up with "GradeGradeFive_..."
 * — the raw string already starts with "Grade", and the template re-adds it.
 */
function buildFilename(exam) {
  const gradeRaw = String(exam.grade).replace(/^grade\s*/i, '');
  const grade = gradeRaw.replace(/[^0-9A-Za-z]/g, '');
  const subject = String(exam.subject).replace(/[^A-Za-z]/g, '');
  const type = exam.type === 'WEEKLY' ? 'Weekly' : 'Term';
  const date = new Date(exam.created_at || Date.now()).toISOString().slice(0, 10);
  return `Grade${grade}_${subject}_${type}_${date}.docx`;
}

/**
 * Render + upload + persist. Returns { publicUrl, filename }.
 * Errors bubble to the orchestrator, which is responsible for marking the
 * exams row as failed.
 */
async function renderAndPublish({ exam, questions, groupMeta }) {
  logToFile('[exam-render] start', { examId: exam.id, questions: questions.length });

  const buffer = await buildExamDocx({ exam, questions, groupMeta });
  const filename = buildFilename(exam);

  const key = await uploadExamBuffer({
    buffer,
    userId: exam.created_by_user_id,
    examId: exam.id,
    filename,
  });

  // Presigned URL — bot fetches on WhatsApp send, so short TTL is fine.
  const publicUrl = await getPresignedUrl(key, 3600); // 1 hour

  const { error } = await supabase
    .from('exams')
    .update({
      status: 'ready',
      paper_docx_url: key, // store the key, not the presigned URL (that expires)
      ready_at: new Date().toISOString(),
    })
    .eq('id', exam.id);
  if (error) throw new Error(`update exam ready failed: ${error.message}`);

  logToFile('[exam-render] done', { examId: exam.id, filename, key });
  return { publicUrl, filename, key };
}

module.exports = { renderAndPublish, buildFilename };
