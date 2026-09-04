'use strict';
/**
 * Re-rendering a paper she has edited.
 *
 * Generation is the expensive, slow, uncertain step; this is none of those. The
 * questions already exist and she has only said which of them to keep, so this
 * path never calls a model — it filters a tree, renders it, and sends it. That is
 * why the review screen can answer in seconds while the first paper took a minute.
 *
 * Delivery deliberately mirrors the orchestrator rather than inventing a second
 * way to send a document: render → upload → presign → sendDocumentByLink → check
 * the return value. Each of those four was learned by losing a paper. In
 * particular the send goes BY LINK, because the other sender re-downloads
 * server-side and cannot dereference a presigned url — and its failure was
 * swallowed into a row that said `ready`.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Renderer = require('./assessment-paper.renderer');
const Selection = require('./assessment-selection');
const Edit = require('./assessment-edit');
const { htmlToPdf } = require('../../utils/html-to-pdf');
const r2 = require('../../storage/r2');
const WhatsAppService = require('../whatsapp.service');

const SUBJECT_LABEL = {
  english: 'English', urdu: 'Urdu', maths: 'Maths', islamiat: 'Islamiat',
  science: 'Science', general_knowledge: 'General Knowledge', social_studies: 'Social Studies',
};

const TEACHER_MESSAGE = {
  EMPTY_SELECTION: 'Keep at least one question and I will make the paper again.',
  NOT_FOUND: "I couldn't find that paper. Send /assessment to make a new one.",
  NOT_READY: 'That paper is still being made. I will send it here when it is done.',
  RENDER_FAILED: "Sorry — we couldn't make the file. Please try again.",
  UPLOAD_FAILED: "Sorry — we couldn't save your paper. Please try again.",
  SEND_FAILED: "Your paper is made but we couldn't send it here. "
    + 'Please send /assessment to try again.',
};
const FALLBACK_MESSAGE = 'Sorry — something went wrong making your paper. Please try again.';

/**
 * The request row stores `grade_code` as 'grade_4' and `subject_code` as the bare
 * subject. Everything downstream — the renderer, the filename, the caption —
 * wants a number and a plain subject, so the conversion happens once here rather
 * than at each of the six call sites that would otherwise each get it slightly
 * wrong.
 */
function coverageOf(req) {
  const g = String(req?.grade_code || '').match(/(\d+)/);
  return {
    grade: g ? Number(g[1]) : null,
    subject: req?.subject_code || null,
    pageRanges: req?.page_ranges || null,
    format: req?.output_format || 'pdf',
  };
}

function fileName({ grade, subject, chapterTitle, format = 'pdf', suffix = '' }) {
  const label = (SUBJECT_LABEL[subject] || subject || 'Subject').replace(/[^A-Za-z0-9]/g, '');
  const chapter = chapterTitle
    ? `_${String(chapterTitle).replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}` : '';
  return `Grade${grade}_${label}${chapter}${suffix}.${format}`;
}

/**
 * The paper, with the request it came from — and only if it is hers.
 *
 * Ownership is checked in the query rather than after it, so a paper belonging to
 * someone else is indistinguishable from one that does not exist. A flow token is
 * a bearer credential; it is not proof of who is holding it.
 */
async function _loadOwnedPaper(paperId, userId) {
  const { data, error } = await supabase
    .from('assessment_papers')
    // The columns are grade_code ('grade_4') and subject_code — NOT grade and
    // subject. PostgREST rejects the whole query for one unknown column, so
    // naming them wrong does not degrade the result, it erases it: the screen
    // rendered with an empty question list and the client refused to draw a
    // CheckboxGroup with no options, while the paper itself was fine.
    .select('id, status, exam_json, selected_question_ids, request_id, '
      + 'assessment_requests!inner(id, user_id, grade_code, subject_code, '
      + 'chapter_number, page_ranges, output_format)')
    .eq('id', paperId)
    .maybeSingle();

  if (error || !data) {
    // Logged rather than swallowed: this returned NOT_FOUND for a paper that
    // existed, and without the reason the screen looks merely empty.
    if (error) logToFile('[assessment-revision] paper lookup failed', { paperId, error: error.message });
    return { code: 'NOT_FOUND' };
  }
  if (data.assessment_requests?.user_id !== userId) return { code: 'NOT_FOUND' };
  if (data.status !== 'ready') return { code: 'NOT_READY' };
  return { paper: data };
}

/** Everything she could tick, for the screen that asks. */
async function listQuestions({ paperId, userId }) {
  const { paper, code } = await _loadOwnedPaper(paperId, userId);
  if (!paper) return { code };

  const items = Selection.indexQuestions(paper.exam_json);
  const chosen = paper.selected_question_ids;
  return {
    paper,
    items: items.map((q) => ({ ...q, selected: chosen == null || chosen.includes(q.id) })),
  };
}

async function _patch(paperId, patch) {
  try {
    await supabase.from('assessment_papers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', paperId);
  } catch (err) {
    logToFile('[assessment-revision] could not update paper row', { paperId, error: err.message });
  }
}

/**
 * Build and send the paper she has just defined by her ticks.
 *
 * `selectedIds` of `[]` is refused rather than rendered. It is a reachable state
 * — she can untick everything — and it means something real, so it gets its own
 * message instead of being quietly reinterpreted as "all", which would hand her
 * back the very paper she had just emptied.
 */
async function rerender({ paperId, userId, selectedIds, phone: knownPhone }) {
  const loaded = await _loadOwnedPaper(paperId, userId);
  if (!loaded.paper) {
    // Nothing to send and possibly nobody to send it to; the caller is a Flow
    // screen that can say this itself.
    return { status: 'failed', code: loaded.code };
  }
  const { paper } = loaded;
  const req = paper.assessment_requests || {};
  const { grade, subject, pageRanges, format } = coverageOf(req);

  let phone = knownPhone || null;
  let schoolName = null;
  try {
    const { data: user } = await supabase.from('users')
      .select('phone_number, school_name').eq('id', userId).maybeSingle();
    phone = phone || user?.phone_number || null;
    schoolName = user?.school_name || null;
  } catch (err) {
    logToFile('[assessment-revision] user lookup failed', { userId, error: err.message });
  }

  const say = async (code) => {
    if (!phone) return;
    try {
      await WhatsAppService.sendMessage(phone, TEACHER_MESSAGE[code] || FALLBACK_MESSAGE);
    } catch (err) {
      logToFile('[assessment-revision] could not send the apology', { userId, error: err.message });
    }
  };

  if (Array.isArray(selectedIds) && selectedIds.length === 0) {
    await say('EMPTY_SELECTION');
    return { status: 'failed', code: 'EMPTY_SELECTION' };
  }

  try {
    const examJson = Selection.applySelection(paper.exam_json, selectedIds);
    const questions = Renderer.collectQuestions(examJson);
    const marks = Renderer.totalMarks(questions);

    const html = Renderer.renderPaper({
      examJson,
      grade,
      subject,
      schoolName,
      pageReference: pageRanges,
      chapterTitle: null,
      answerLines: true,
    });

    let buffer;
    try {
      buffer = await htmlToPdf(html, { timeout: 60000 });
    } catch (err) {
      throw Object.assign(err, { code: 'RENDER_FAILED' });
    }

    const name = fileName({ grade, subject, format, suffix: '_Edited' });

    let key;
    try {
      key = await r2.uploadExamBuffer({ buffer, userId, examId: paperId, filename: name });
    } catch (err) {
      throw Object.assign(err, { code: 'UPLOAD_FAILED' });
    }

    const url = await r2.getPresignedUrl(r2.buildR2PublicUrl(key), 3600);
    const caption = [
      `Grade ${grade} ${SUBJECT_LABEL[subject] || subject}`,
      `${questions.length} questions`,
      Number.isFinite(marks) && marks > 0 ? `${marks} marks` : null,
    ].filter(Boolean).join(' · ');

    const sent = await WhatsAppService.sendDocumentByLink(phone, url, name, caption);
    if (!sent) {
      throw Object.assign(new Error('sendDocumentByLink returned falsy'), { code: 'SEND_FAILED' });
    }

    // Her ticks and the tree they produce are written together, and
    // `original_exam_json` is never touched: the gap between the model's first
    // answer and what she actually kept is the only unprompted signal we get on
    // whether the prompts are any good.
    await _patch(paperId, {
      selected_question_ids: selectedIds ?? null,
      exam_json: examJson,
      question_count: questions.length,
      total_marks: Number.isFinite(marks) ? marks : null,
      file_r2_key: key,
      edited_at: new Date().toISOString(),
    });

    logToFile('[assessment-revision] delivered', {
      userId, paperId, questions: questions.length, marks, key,
    });
    return { status: 'ready', paperId, key, questionCount: questions.length, marks };
  } catch (err) {
    const code = err.code || 'UNKNOWN';
    logToFile('[assessment-revision] failed', { userId, paperId, code, error: err.message });
    await say(code);
    return { status: 'failed', code, paperId };
  }
}

/**
 * Write one edited question back into the stored paper.
 *
 * The path id says exactly where it belongs, so there is no diffing and no way
 * for an edit to land on the wrong question. `original_exam_json` is never
 * touched: the gap between the model's first answer and what she actually kept
 * is the only unprompted signal we get on whether the prompts are any good, and
 * an edit is precisely the moment that signal is created.
 *
 * A rejection is a RESULT, not a throw — the caller is a Flow screen that has to
 * put the reason in front of her and keep her typing.
 */
async function saveEdit({ paperId, userId, questionId, edit }) {
  const { paper, code } = await _loadOwnedPaper(paperId, userId);
  if (!paper) {
    return { status: 'rejected', code, message: TEACHER_MESSAGE[code] || FALLBACK_MESSAGE };
  }

  const tree = paper.exam_json;
  const target = Selection.indexQuestions(tree).find((q) => q.id === questionId);
  if (!target) {
    return { status: 'rejected', code: 'GONE', message: 'That question is no longer on the paper.' };
  }

  let updated;
  try {
    updated = Edit.applyEdit(target.question, edit);
  } catch (err) {
    // Her mistake, not ours: an empty question, one option, a half-cleared pair.
    return { status: 'rejected', code: err.code || 'EDIT_REJECTED', message: err.message };
  }

  const next = Selection.replaceAt(tree, questionId, updated);
  if (!next) {
    return { status: 'rejected', code: 'GONE', message: 'That question is no longer on the paper.' };
  }

  const questions = Renderer.collectQuestions(next);
  const marks = Renderer.totalMarks(questions);

  await _patch(paperId, {
    exam_json: next,
    question_count: questions.length,
    total_marks: Number.isFinite(marks) ? marks : null,
    edited_at: new Date().toISOString(),
  });

  logToFile('[assessment-revision] question edited', { userId, paperId, questionId });
  return { status: 'ok', questionId };
}

module.exports = { rerender, listQuestions, saveEdit, fileName, TEACHER_MESSAGE };
