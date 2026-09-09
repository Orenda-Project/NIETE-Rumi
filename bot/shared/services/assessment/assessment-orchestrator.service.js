'use strict';
/**
 * Turning a queued request into a paper, and then into a paper someone has.
 *
 * Every step it calls already works alone. What this adds is three things that
 * only exist at the seam: the sequence, a record of what happened, and what she
 * hears when a step fails.
 *
 * The file is deliberately in two halves, because they answer to different
 * masters:
 *
 *   buildPaper()  load → generate → render → upload → record. Knows nothing
 *                 about who asked or how they get it. Returns a result.
 *   process()     buildPaper plus the WhatsApp tail — document by link, answer
 *                 key, the offer to trim, and a sentence when it goes wrong.
 *
 * The split is what lets a second surface exist without a second generator.
 * Before it, the send was welded to the end of the pipeline and the row was
 * written `ready` only AFTER a successful send — so a caller with nobody to
 * message could build a perfectly good paper and be told it had failed.
 *
 * The failure paths carry most of the weight in the delivery half. A teacher
 * has been told "about a minute"; if a step throws and nothing reaches her, she
 * is left watching a chat that will never update, and the only thing she can do
 * is ask again — which runs the same failure. So every exit from process()
 * either sends her a document or sends her a sentence, and both are recorded.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const BookContent = require('./book-content.service');
const Generation = require('./assessment-generation.service');
const Renderer = require('./assessment-paper.renderer');
// The renderer is chosen by the requested format, in one place, so the bytes
// and the filename can never disagree. Requiring htmlToPdf directly here is
// what let a Word request produce a PDF named .docx.
const { rendererFor } = require('./assessment-format');
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
  // The review layer is its OWN Flow, and it has to be.
  //
  // A WhatsApp Flow opens on screens[0]. The review screens used to live in the
  // generator Flow, where KEEP sat at index 6 and was reachable only from
  // CONFIRM — which is terminal, so it never routes onward. Opening straight
  // onto KEEP therefore asked the client to enter a screen with no reachable
  // predecessor: it painted for an instant and died with "Something went
  // wrong", while our endpoint logged a clean INIT and a valid 1068-byte
  // response. Proven by publishing KEEP alone as a one-screen Flow with the
  // exact same payload — it rendered perfectly.
  //
  // Falls back to the generator id so a deployment that has not been given the
  // new variable yet keeps its previous behaviour rather than silently sending
  // nothing at all.
  return (ENV && (ENV.ASSESSMENT_REVIEW_FLOW_ID || ENV.ASSESSMENT_GEN_FLOW_ID)) || '';
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

/**
 * Everything between a queued request and a finished document — and nothing
 * about handing it over.
 *
 * This half has no idea who asked or how they will get it. It loads the
 * content, runs the model, renders, uploads, and writes the row; the caller
 * decides what happens next. That separation is the whole reason it exists:
 * WhatsApp wants the paper pushed to a phone, the portal wants it sitting
 * behind a download button, and neither should have to care about the other.
 *
 * Returns a RESULT rather than throwing, because both outcomes are ordinary.
 * A model that returns nothing usable is a Tuesday, not an exception, and a
 * caller that has to wrap this in try/catch to find out is a caller that will
 * eventually forget to.
 *
 *   { status:'ready',  paperId, key, examJson, questionCount, marks, filename }
 *   { status:'failed', code, paperId }
 *
 * `user` is passed in rather than looked up here. The lookup belongs to
 * whoever needs to reach her: WhatsApp cannot deliver without a phone number,
 * the portal never needs one, and making this function demand a phone would
 * have re-coupled it to the surface it was split away from. It reads
 * `school_name` off the object for the paper's header, so a caller with no
 * user at all can pass `{}` and get an unheaded paper.
 */
async function buildPaper(job, user = {}) {
  const {
    userId, requestId, grade, subject, chapterNumber, pageRanges,
    questionTypes = [], contentSource = 'unseen', questionCount,
    outputFormat = 'pdf', includeAnswerKey = false, answerLines = true,
  } = job;

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
    // second document built after it.
    const html = Renderer.renderPaper({
      examJson: generated.examJson,
      grade, subject,
      schoolName: user.school_name || null,
      pageReference: source.pageReference,
      chapterTitle: source.chapterTitle || null,
      answerLines,
    });

    const renderer = rendererFor(outputFormat);
    let buffer;
    try {
      buffer = await renderer.render(html);
    } catch (err) {
      throw Object.assign(err, { code: 'RENDER_FAILED' });
    }

    // The extension comes off the SAME object as the renderer.
    const name = fileName({ grade, subject, chapterTitle: source.chapterTitle, format: renderer.ext });
    let key;
    try {
      key = await r2.uploadExamBuffer({
        buffer, userId, examId: paperId || requestId, filename: name,
      });
    } catch (err) {
      throw Object.assign(err, { code: 'UPLOAD_FAILED' });
    }

    const marks = Renderer.totalMarks(Renderer.collectQuestions
      ? Renderer.collectQuestions(generated.examJson) : []);

    // Ready the moment the bytes are safely in storage.
    //
    // This used to be written AFTER the WhatsApp send, which made a delivery
    // problem look like a generation problem: a perfectly good paper whose
    // send returned falsy was recorded `failed` with no file_r2_key, so it
    // could not even be handed over a second time. Storage is what makes a
    // paper real; delivery is a separate thing that can be retried.
    await _patchPaper(paperId, {
      status: 'ready',
      file_r2_key: key,
      total_marks: Number.isFinite(marks) ? marks : null,
      ready_at: new Date().toISOString(),
    });

    return {
      status: 'ready',
      paperId,
      key,
      examJson: generated.examJson,
      questionCount: generated.questionCount,
      marks: Number.isFinite(marks) ? marks : null,
      filename: name,
      renderer,
      chapterTitle: source.chapterTitle || null,
      pageReference: source.pageReference,
    };
  } catch (err) {
    const code = err.code || 'UNKNOWN';
    logToFile('[assessment] build failed', { userId, requestId, paperId, code, error: err.message });

    await _patchPaper(paperId, {
      status: 'failed', error_code: code, error_detail: safeDetail(err),
    });

    return { status: 'failed', code, paperId };
  }
}

/**
 * The job that turns a queued request into a paper in a teacher's chat.
 *
 * `buildPaper` plus a WhatsApp tail — and the tail is the part that is
 * genuinely WhatsApp-shaped: a document by link, an answer key after it, an
 * offer to trim, and a sentence when any of it goes wrong.
 */
async function process(job) {
  const { userId, requestId, grade, subject, includeAnswerKey = false } = job;

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

  const built = await buildPaper(job, user);

  // A build that failed has already recorded itself. All that is left is to
  // tell her, because she was promised a paper in about a minute and silence
  // is the one outcome that is not allowed.
  if (built.status !== 'ready') {
    await _apologise(phone, built.code, { userId });
    return { status: 'failed', code: built.code, paperId: built.paperId };
  }

  const {
    paperId, key, examJson, questionCount, filename: name, renderer,
    chapterTitle, pageReference,
  } = built;

  try {
    // Signed rather than public: a child's exam paper is not a link to leave open.
    // It goes out by LINK, so the signature is the point — WhatsApp fetches the
    // url itself and it stops working an hour later. (Handing a signed url to a
    // sender that re-downloads server-side instead silently loses the document:
    // presigning rewrites host/bucket/key into bucket.host/key, and the key
    // extraction looks for the bucket in the path.)
    const url = await r2.getPresignedUrl(r2.buildR2PublicUrl(key), 3600);

    const caption = [
      `Grade ${grade} ${SUBJECT_LABEL[subject] || subject}`,
      chapterTitle,
      `${questionCount} questions`,
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

    // The paper is hers now. Whatever happens to the key from here is logged,
    // never allowed to turn a delivered paper into a "failed" message.
    let answerKeySent = null;
    if (includeAnswerKey) {
      answerKeySent = false;
      try {
        const keyHtml = Renderer.renderAnswerKey({
          examJson, grade, subject,
          schoolName: user.school_name || null,
          pageReference, chapterTitle,
        });
        const keyBuffer = await renderer.render(keyHtml);
        const keyName = fileName({ grade, subject, chapterTitle, format: renderer.ext, suffix: '_AnswerKey' });
        const keyKey = await r2.uploadExamBuffer({
          buffer: keyBuffer, userId, examId: paperId || requestId, filename: keyName,
        });
        // Recorded BEFORE the send, and deliberately so (bd-60068).
        //
        // The upload is what makes the key retrievable; the send is what makes
        // it delivered, and those are different facts. Writing the column only
        // after a successful send would lose exactly the case the column exists
        // for — a key sitting in R2 that we can no longer point at.
        //
        // Until V1.4.2 this location went into the log line below and nowhere
        // else, so a teacher who lost the message lost the key permanently:
        // regenerating runs the model again and yields different questions, so
        // the new key does not match the paper she printed.
        await _patchPaper(paperId, { answer_key_r2_key: keyKey });

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
      userId, requestId, paperId, questions: questionCount, key, answerKeySent,
    });
    return { status: 'ready', paperId, key, questionCount, answerKeySent };
  } catch (err) {
    const code = err.code || 'UNKNOWN';
    logToFile('[assessment] delivery failed', { userId, requestId, paperId, code, error: err.message });

    // `failed`, deliberately, even though the bytes are safely in R2.
    //
    // It would be tidier to leave the row `ready` and record only the error —
    // the paper does exist. But `status` is not a description of the file, it
    // is the gate on everything downstream: assessment-revision's
    // _loadOwnedPaper refuses any paper that is not `ready` with NOT_READY, and
    // that is the correct answer here. She never received this paper, so
    // offering her a Flow to trim it would be offering to edit something she
    // has never seen. This is the invariant commit 1f44184f was written to
    // establish — "the paper was made, marked delivered, and never sent" — and
    // it stays.
    //
    // What has changed is that the patch MERGES rather than replaces, so
    // file_r2_key (written by buildPaper before any send was attempted)
    // survives. Previously the ready-patch never ran at all on this path, so a
    // failed delivery lost the location of a paper that existed — it could not
    // even be re-sent without regenerating it.
    await _patchPaper(paperId, {
      status: 'failed', error_code: code, error_detail: safeDetail(err),
    });

    await _apologise(phone, code, { userId });
    return { status: 'failed', code, paperId };
  }
}

/**
 * Tell her what happened. Never throws: a failure to deliver the apology is
 * worth a log line and nothing more, because there is no further fallback and
 * the caller's own outcome does not change.
 */
async function _apologise(phone, code, { userId } = {}) {
  try {
    await WhatsAppService.sendMessage(phone, TEACHER_MESSAGE[code] || FALLBACK_MESSAGE);
  } catch (sendErr) {
    logToFile('[assessment] could not even send the apology', { userId, error: sendErr.message });
  }
}

module.exports = { process, buildPaper, fileName, TEACHER_MESSAGE };
