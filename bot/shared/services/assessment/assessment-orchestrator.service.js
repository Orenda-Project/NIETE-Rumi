'use strict';
/**
 * The job that turns a queued request into a paper in a teacher's chat.
 *
 * Every step it calls already works alone. What this adds is three things that
 * only exist at the seam: the sequence, a record of what happened, and what she
 * hears when a step fails.
 *
 * The failure paths carry most of the weight. A teacher has been told "about a
 * minute"; if a step throws and nothing reaches her, she is left watching a chat
 * that will never update, and the only thing she can do is ask again — which
 * runs the same failure. So every exit from here either sends her a document or
 * sends her a sentence, and both are recorded.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const BookContent = require('./book-content.service');
const Generation = require('./assessment-generation.service');
const Renderer = require('./assessment-paper.renderer');
const { htmlToPdf } = require('../../utils/html-to-pdf');
const r2 = require('../../storage/r2');
const WhatsAppService = require('../whatsapp.service');

// The module's job entry point is `async function process`, and a function
// declaration shadows the global of the same name across the WHOLE module — so
// `process.env` anywhere in this file resolves to that function's `.env`, which
// is undefined. The environment is therefore captured here, through globalThis,
// which the declaration cannot shadow. Read live (not destructured) so a test
// can set the variable after this module loads.
const ENV = globalThis.process.env;

const SUBJECT_LABEL = {
  english: 'English', urdu: 'Urdu', maths: 'Maths', islamiat: 'Islamiat',
  science: 'Science', general_knowledge: 'General Knowledge', social_studies: 'Social Studies',
};

/**
 * What she is told, per failure. Each one names the thing she can change; a
 * message that only apologises spends her attention and buys her nothing.
 */
const TEACHER_MESSAGE = {
  BOOK_NOT_FOUND: "We don't have that book yet. Try a different grade or subject.",
  CHAPTER_NOT_FOUND: "We couldn't find that chapter. Please pick another one.",
  NO_CONTENT: "We don't have the text for that chapter yet — please try another chapter.",
  PAGE_OUT_OF_RANGE: 'Those page numbers are outside this book. Please check and try again.',
  INVALID_PAGE_RANGE: "Those page numbers didn't make sense. Try something like 4-14.",
  TRUNCATED: 'That was a lot to write in one go. Please try again with fewer questions.',
  MODEL_UNAVAILABLE: "Sorry — we couldn't build your paper just now. Please try again in a moment.",
  BAD_JSON: "Sorry — that didn't come out right. Please try again.",
  NO_QUESTIONS: "Sorry — we couldn't write questions from that chapter. Please try another.",
  RENDER_FAILED: "Sorry — we couldn't make the file. Please try again.",
  UPLOAD_FAILED: "Sorry — we couldn't save your paper. Please try again.",
  SEND_FAILED: "Your paper is made but we couldn't send it here. "
    + 'Please send /assessment to try again.',
};

const FALLBACK_MESSAGE = 'Sorry — something went wrong making your paper. Please try again.';

/** Phone numbers and names never reach a stored error (see the column comment). */
function safeDetail(err) {
  return String(err?.message || '')
    .replace(/\b\d{9,15}\b/g, '[number]')
    .slice(0, 500);
}

function fileName({ grade, subject, chapterTitle, format, suffix = '' }) {
  const label = (SUBJECT_LABEL[subject] || subject || 'Subject').replace(/[^A-Za-z0-9]/g, '');
  const chapter = chapterTitle
    ? `_${String(chapterTitle).replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}` : '';
  return `Grade${grade}_${label}${chapter}${suffix}.${format}`;
}

/**
 * The Flow to offer her for trimming the paper.
 *
 * Read here rather than through `utils/constants`, which loads dotenv — a bot/
 * dependency that throws in any root test suite. And read in its OWN function
 * because the exported job entry point below is called `process`, which shadows
 * the global of that name inside its body: `process.env` there is the job
 * argument's `.env`, which is undefined. That shadowing turned the whole offer
 * into a silent no-op, caught only because a test asserted the send.
 */
function reviewFlowId() {
  return (ENV && ENV.ASSESSMENT_GEN_FLOW_ID) || '';
}

async function _patchPaper(paperId, patch) {
  if (!paperId) return;
  try {
    await supabase.from('assessment_papers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', paperId);
  } catch (err) {
    // Losing the record must not lose the paper she is waiting for.
    logToFile('[assessment] could not update paper row', { paperId, error: err.message });
  }
}

async function process(job) {
  const {
    userId, requestId, grade, subject, chapterNumber, pageRanges,
    questionTypes = [], contentSource = 'unseen', questionCount,
    outputFormat = 'pdf', includeAnswerKey = false, answerLines = true,
  } = job;

  // Who to send it to. Done first, because everything after this is work on
  // behalf of someone we must be able to reach.
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('phone_number, preferred_language, school_name')
    .eq('id', userId)
    .maybeSingle();

  if (userErr || !user || !user.phone_number) {
    logToFile('[assessment] no teacher to deliver to — dropping', { userId, requestId });
    return { status: 'failed', code: 'NO_RECIPIENT' };
  }
  const phone = user.phone_number;

  // Open the record before doing any work, so a job that dies mid-flight leaves
  // a row the watchdog can find rather than nothing at all.
  let paperId = null;
  try {
    const { data } = await supabase.from('assessment_papers')
      .insert({ request_id: requestId, status: 'generating' })
      .select('id').single();
    paperId = data?.id || null;
  } catch (err) {
    logToFile('[assessment] could not open paper row — continuing', { requestId, error: err.message });
  }

  try {
    const source = chapterNumber != null
      ? await BookContent.loadChapterContent({ grade, subject, chapterNumber })
      : await BookContent.loadPageRangeContent({ grade, subject, pageRanges });

    const generated = await Generation.generateExam({
      grade, subject,
      pageContent: source.content,
      pageReference: source.pageReference,
      contentSource, questionCount, questionTypes, includeAnswerKey,
    });

    await _patchPaper(paperId, {
      exam_json: generated.examJson,
      original_exam_json: generated.examJson,
      question_count: generated.questionCount,
      model: generated.tokenData?.model,
      input_tokens: generated.tokenData?.inputTokens,
      output_tokens: generated.tokenData?.outputTokens,
    });

    // The paper never carries the answers; the key, if she asked for one, is a
    // second document sent after it.
    const html = Renderer.renderPaper({
      examJson: generated.examJson,
      grade, subject,
      schoolName: user.school_name || null,
      pageReference: source.pageReference,
      chapterTitle: source.chapterTitle || null,
      answerLines,
    });

    let buffer;
    try {
      buffer = await htmlToPdf(html, { timeout: 60000 });
    } catch (err) {
      throw Object.assign(err, { code: 'RENDER_FAILED' });
    }

    const name = fileName({ grade, subject, chapterTitle: source.chapterTitle, format: outputFormat });
    let key;
    try {
      key = await r2.uploadExamBuffer({
        buffer, userId, examId: paperId || requestId, filename: name,
      });
    } catch (err) {
      throw Object.assign(err, { code: 'UPLOAD_FAILED' });
    }

    // Signed rather than public: a child's exam paper is not a link to leave open.
    // It goes out by LINK, so the signature is the point — WhatsApp fetches the
    // url itself and it stops working an hour later. (Handing a signed url to a
    // sender that re-downloads server-side instead silently loses the document:
    // presigning rewrites host/bucket/key into bucket.host/key, and the key
    // extraction looks for the bucket in the path.)
    const url = await r2.getPresignedUrl(r2.buildR2PublicUrl(key), 3600);

    const marks = Renderer.totalMarks(Renderer.collectQuestions
      ? Renderer.collectQuestions(generated.examJson) : []);
    const caption = [
      `Grade ${grade} ${SUBJECT_LABEL[subject] || subject}`,
      source.chapterTitle,
      `${generated.questionCount} questions`,
    ].filter(Boolean).join(' · ');

    // The caption says what the document is, so there is no herald message. A
    // "your paper is ready 👇" sent BEFORE the document is a promise made by a
    // step that has not run yet, and when the send failed that is exactly what
    // she was left holding.
    const sent = await WhatsAppService.sendDocumentByLink(phone, url, name, caption);
    if (!sent) {
      throw Object.assign(new Error('sendDocumentByLink returned falsy'),
        { code: 'SEND_FAILED' });
    }

    await _patchPaper(paperId, {
      status: 'ready',
      file_r2_key: key,
      total_marks: Number.isFinite(marks) ? marks : null,
      ready_at: new Date().toISOString(),
    });

    // The paper is hers now. Whatever happens to the key from here is logged,
    // never allowed to turn a delivered paper into a "failed" message.
    let answerKeySent = null;
    if (includeAnswerKey) {
      answerKeySent = false;
      try {
        const keyHtml = Renderer.renderAnswerKey({
          examJson: generated.examJson, grade, subject,
          schoolName: user.school_name || null,
          pageReference: source.pageReference, chapterTitle: source.chapterTitle || null,
        });
        const keyBuffer = await htmlToPdf(keyHtml, { timeout: 60000 });
        const keyName = fileName({ grade, subject, chapterTitle: source.chapterTitle, format: outputFormat, suffix: '_AnswerKey' });
        const keyKey = await r2.uploadExamBuffer({
          buffer: keyBuffer, userId, examId: paperId || requestId, filename: keyName,
        });
        const keyUrl = await r2.getPresignedUrl(r2.buildR2PublicUrl(keyKey), 3600);
        answerKeySent = !!(await WhatsAppService.sendDocumentByLink(
          phone, keyUrl, keyName, `Answer key · ${caption}`));
        logToFile(answerKeySent ? '[assessment] answer key delivered' : '[assessment] answer key send returned falsy',
          { userId, requestId, paperId, key: keyKey });
      } catch (err) {
        logToFile('[assessment] answer key failed', { userId, requestId, paperId, error: err.message });
      }
    }

    // The paper is rarely exactly right first time, and without this the only
    // way to change it is to build another one from scratch. The offer comes
    // AFTER the document — a prompt sent before the send is a promise made by a
    // step that has not run yet — and it can only ever be an addition: a paper
    // that arrived is delivered whether or not she is offered the trim.
    if (paperId) {
      try {
        const flowId = reviewFlowId();
        if (flowId) {
          await WhatsAppService.sendFlow(phone, {
            flowId,
            header: '✏️ Change this paper',
            body: 'Want a shorter paper? Open this to untick any questions you '
              + 'do not want, and I will make it again.',
            buttonText: 'Choose questions',
            // The token names the PAPER; INIT reads it and opens REVIEW rather
            // than starting a new request. No `screen`, so this is data_exchange.
            flowToken: `${userId}:assessment-review:${paperId}`,
          });
        }
      } catch (err) {
        logToFile('[assessment] could not offer the review', { userId, paperId, error: err.message });
      }
    }

    logToFile('[assessment] delivered', {
      userId, requestId, paperId, questions: generated.questionCount, key, answerKeySent,
    });
    return { status: 'ready', paperId, key, questionCount: generated.questionCount, answerKeySent };
  } catch (err) {
    const code = err.code || 'UNKNOWN';
    logToFile('[assessment] failed', { userId, requestId, paperId, code, error: err.message });

    await _patchPaper(paperId, {
      status: 'failed', error_code: code, error_detail: safeDetail(err),
    });

    // She was promised a paper in about a minute. Silence is the one outcome
    // that is not allowed.
    try {
      await WhatsAppService.sendMessage(phone, TEACHER_MESSAGE[code] || FALLBACK_MESSAGE);
    } catch (sendErr) {
      logToFile('[assessment] could not even send the apology', { userId, error: sendErr.message });
    }
    return { status: 'failed', code, paperId };
  }
}

module.exports = { process, fileName, TEACHER_MESSAGE };
