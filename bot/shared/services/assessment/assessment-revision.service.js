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
const { rendererFor } = require('./assessment-format');
const r2 = require('../../storage/r2');
const WhatsAppService = require('../whatsapp.service');
const Delivery = require('./assessment-delivery');
const { resolveUx } = require('../../config/ux-strings');

// One definition, shared with the Flow endpoint and the portal's browse
// service. Was copied verbatim into three files.
const { SUBJECT_LABEL } = require('./assessment-vocabulary');

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
    // Her answer-lines choice survives a revision. This path used to hardcode
    // lines ON, so unticking them was undone the moment she trimmed the paper.
    answerLines: req?.has_answer_lines !== false,
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
      + 'chapter_number, page_ranges, output_format, has_answer_lines)')
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
async function rerender({ paperId, userId, selectedIds, phone: knownPhone, budget = null }) {
  const loaded = await _loadOwnedPaper(paperId, userId);
  if (!loaded.paper) {
    // Nothing to send and possibly nobody to send it to; the caller is a Flow
    // screen that can say this itself.
    return { status: 'failed', code: loaded.code };
  }
  const { paper } = loaded;
  const req = paper.assessment_requests || {};
  const { grade, subject, pageRanges, format, answerLines } = coverageOf(req);

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
      await WhatsAppService.sendMessage(phone, TEACHER_MESSAGE[code] || FALLBACK_MESSAGE, { budget });
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
      answerLines,
    });

    const renderer = rendererFor(format);
    let buffer;
    try {
      buffer = await renderer.render(html);
    } catch (err) {
      throw Object.assign(err, { code: 'RENDER_FAILED' });
    }

    const name = fileName({ grade, subject, format: renderer.ext, suffix: '_Edited' });

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

    const sent = await WhatsAppService.sendDocumentByLink(phone, url, name, caption, { budget });
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

    // Her questions are renumbered now, so the first key no longer matches this
    // paper. Every paper is followed by its own key (bd-bfnsk) — built from the
    // same filtered tree, recorded before it is sent, and never allowed to turn a
    // delivered paper into a failure.
    //
    // Inside a Flow's data exchange (a `budget` is set) the screen is waiting on
    // this call and Meta gives it seconds, so the key is left to finish on its
    // own rather than hold the reply for a second render. Everywhere else it is
    // awaited, so the caller knows whether it went.
    const keyTask = (async () => {
      try {
        const keyHtml = Renderer.renderAnswerKey({
          examJson, grade, subject, schoolName, pageReference: pageRanges, chapterTitle: null,
        });
        const keyBuffer = await renderer.render(keyHtml);
        const keyName = fileName({ grade, subject, format: renderer.ext, suffix: '_Edited_AnswerKey' });
        const keyKey = await r2.uploadExamBuffer({ buffer: keyBuffer, userId, examId: paperId, filename: keyName });
        await _patch(paperId, { answer_key_r2_key: keyKey });
        const keyUrl = await r2.getPresignedUrl(r2.buildR2PublicUrl(keyKey), 3600);
        // No budget: nothing is waiting on this send, so it takes its turn in
        // the recipient's pacing like any other message.
        const ok = !!(await WhatsAppService.sendDocumentByLink(
          phone, keyUrl, keyName, `Answer key · ${caption}`));
        logToFile(ok ? '[assessment-revision] answer key delivered' : '[assessment-revision] answer key send returned falsy',
          { userId, paperId, key: keyKey });
        return ok;
      } catch (err) {
        logToFile('[assessment-revision] answer key failed', { userId, paperId, error: err.message });
        return false;
      }
    })();
    const answerKeySent = budget ? null : await keyTask;

    logToFile('[assessment-revision] delivered', {
      userId, paperId, questions: questions.length, marks, key, answerKeySent,
    });
    return { status: 'ready', paperId, key, questionCount: questions.length, marks, answerKeySent };
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

// ── Versions ────────────────────────────────────────────────────────────────
//
// Every "Make my paper" is a NEW row that names the row it was edited from
// (`edited_from`), and no code path here rewrites `exam_json` of a row that is
// ready. The family is every row with the same request_id: a version copies
// its parent's request_id and attempt (V1.5.6 narrows the unique index to
// generated rows). The version number is worked out, never stored.
//
// The three functions above (listQuestions, rerender, saveEdit) are the old
// in-place path and stay only while assessment_versions_enabled is off.

const VERSION_COLUMNS = 'id, status, exam_json, request_id, attempt, edited_from, created_at, '
  + 'file_r2_key, answer_key_r2_key, question_count, total_marks, '
  + 'assessment_requests!inner(id, user_id, grade_code, subject_code, chapter_number, '
  + 'page_ranges, output_format, has_answer_lines, textbook_id)';

/** A version, with its request — only if it is hers (checked in the query). */
async function loadVersion({ paperId, userId }) {
  if (!paperId) return { code: 'NOT_FOUND' };
  const { data, error } = await supabase
    .from('assessment_papers')
    .select(VERSION_COLUMNS)
    .eq('id', paperId)
    .maybeSingle();
  if (error || !data) {
    if (error) logToFile('[assessment-revision] version lookup failed', { paperId, error: error.message });
    return { code: 'NOT_FOUND' };
  }
  if (data.assessment_requests?.user_id !== userId) return { code: 'NOT_FOUND' };
  if (data.status !== 'ready') return { code: 'NOT_READY' };
  return { paper: data };
}

/**
 * Which version this row is. The generated row is 1; any other is 1 + the
 * number of ready non-generated rows in the family created no later than it
 * (itself included once it is ready). Fixed once the row exists, so two edits
 * racing each other still get distinct numbers by created_at.
 */
async function versionNumberOf(paper) {
  if (!paper || !paper.edited_from) return 1;
  const { count, error } = await supabase
    .from('assessment_papers')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', paper.request_id)
    .eq('status', 'ready')
    .not('edited_from', 'is', null)
    .lte('created_at', paper.created_at)
    .neq('id', paper.id);
  if (error) {
    logToFile('[assessment-revision] version count failed', { paperId: paper.id, error: error.message });
    return null;
  }
  return 2 + (count || 0);
}

/** Everything the ✓/✗ list needs: the version, its number, its questions. */
async function listVersionItems({ paperId, userId }) {
  const { paper, code } = await loadVersion({ paperId, userId });
  if (!paper) return { code };
  return { paper, version: await versionNumberOf(paper), items: Selection.indexQuestions(paper.exam_json) };
}

/** Every version of the paper `paperId` belongs to, newest first, numbered. Ownership-checked. */
async function listFamily({ paperId, userId }) {
  const { data: anchor, error } = await supabase.from('assessment_papers')
    .select('id, request_id, assessment_requests!inner(id, user_id)')
    .eq('id', paperId).maybeSingle();
  if (error || !anchor || anchor.assessment_requests?.user_id !== userId) return { code: 'NOT_FOUND' };
  const { data: rows, error: famErr } = await supabase.from('assessment_papers')
    .select('id, status, edited_from, created_at, question_count, total_marks')
    .eq('request_id', anchor.request_id);
  if (famErr) return { code: 'NOT_FOUND' };
  const asc = [...(rows || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let readyEdits = 0;
  const numbered = asc.map((r) => {
    let version = null;
    if (!r.edited_from) version = r.status === 'ready' ? 1 : null;
    else if (r.status === 'ready') { readyEdits += 1; version = 1 + readyEdits; }
    return {
      paperId: r.id, version, status: r.status, createdAt: r.created_at,
      questionCount: r.question_count, marks: r.total_marks, editedFrom: r.edited_from,
    };
  });
  const latestReady = [...numbered].reverse().find((v) => v.status === 'ready');
  return {
    versions: numbered.reverse().map((v) => ({ ...v, latest: !!latestReady && v.paperId === latestReady.paperId })),
  };
}

async function _chapterTitle(req, grade, subject) {
  if (req?.chapter_number == null) return null;
  try {
    const chapters = await require('./book-content.service').listChapters({ grade, subject });
    const hit = (chapters || []).find((c) => Number(c.chapterNumber) === Number(req.chapter_number));
    return hit?.title || null;
  } catch (err) {
    logToFile('[assessment-revision] chapter title lookup failed', { error: err.message });
    return null;
  }
}

async function _teacher(userId, knownPhone) {
  let phone = knownPhone || null;
  let schoolName = null;
  try {
    const { data } = await supabase.from('users')
      .select('phone_number, school_name').eq('id', userId).maybeSingle();
    phone = phone || data?.phone_number || null;
    schoolName = data?.school_name || null;
  } catch (err) {
    logToFile('[assessment-revision] user lookup failed', { userId, error: err.message });
  }
  return { phone, schoolName };
}

function _say(phone, budget) {
  return async (code) => {
    if (!phone) return;
    try {
      await WhatsAppService.sendMessage(phone, TEACHER_MESSAGE[code] || FALLBACK_MESSAGE, { budget });
    } catch (err) {
      logToFile('[assessment-revision] could not send the apology', { error: err.message });
    }
  };
}

/** "Grade 3 Maths · The Thirsty Crow" — what the document is. */
function _title({ grade, subject, chapterTitle }) {
  return [`Grade ${grade} ${SUBJECT_LABEL[subject] || subject}`, chapterTitle].filter(Boolean).join(' · ');
}

/**
 * A new version, made and stored — and given to nobody. The portal calls this
 * directly; createVersion() calls it and then hands the result over on WhatsApp.
 * Same split as the orchestrator's buildPaper()/process().
 *
 * INSERT, never UPDATE of the parent: the version she edited from stays exactly
 * as it was, and so does every older one. The new row is inserted `generating`
 * and becomes `ready` once its paper and key are stored.
 *
 * `schoolName` is optional: createVersion has already read the teacher, so it
 * passes it down; left undefined, it is looked up here.
 */
async function buildVersion({ parentId, userId, tree, schoolName: knownSchool }) {
  const loaded = await loadVersion({ paperId: parentId, userId });
  if (!loaded.paper) return { status: 'failed', code: loaded.code };
  const parent = loaded.paper;
  const req = parent.assessment_requests || {};
  const { grade, subject, pageRanges, format, answerLines } = coverageOf(req);

  const active = Selection.activeTree(tree);
  const questions = Renderer.collectQuestions(active);
  if (!questions.length) return { status: 'failed', code: 'EMPTY_SELECTION' };
  const marks = Renderer.totalMarks(questions);

  const { data: row, error: insErr } = await supabase.from('assessment_papers')
    .insert({
      request_id: parent.request_id,
      attempt: parent.attempt,
      edited_from: parent.id,
      status: 'generating',
      exam_json: tree,
      question_count: questions.length,
      total_marks: Number.isFinite(marks) ? marks : null,
    })
    .select('id, created_at, request_id, edited_from')
    .single();
  if (insErr || !row?.id) {
    logToFile('[assessment-revision] could not open the version row', { parentId, error: insErr?.message });
    return { status: 'failed', code: 'INSERT_FAILED' };
  }
  const paperId = row.id;

  try {
    const [version, parentVersion] = await Promise.all([versionNumberOf(row), versionNumberOf(parent)]);
    const chapterTitle = await _chapterTitle(req, grade, subject);
    const renderer = rendererFor(format);
    const schoolName = knownSchool !== undefined ? knownSchool : (await _teacher(userId, null)).schoolName;
    const common = { examJson: active, grade, subject, schoolName, pageReference: pageRanges, chapterTitle };

    let buffer;
    let keyBuffer;
    try {
      buffer = await renderer.render(Renderer.renderPaper({ ...common, answerLines }));
      keyBuffer = await renderer.render(Renderer.renderAnswerKey(common));
    } catch (err) {
      throw Object.assign(err, { code: 'RENDER_FAILED' });
    }

    const v = version ? `_v${version}` : '_Edited';
    const name = fileName({ grade, subject, chapterTitle, format: renderer.ext, suffix: v });
    const keyName = fileName({ grade, subject, chapterTitle, format: renderer.ext, suffix: `${v}_AnswerKey` });
    let fileKey;
    let keyKey;
    try {
      fileKey = await r2.uploadExamBuffer({ buffer, userId, examId: paperId, filename: name });
      keyKey = await r2.uploadExamBuffer({ buffer: keyBuffer, userId, examId: paperId, filename: keyName });
    } catch (err) {
      throw Object.assign(err, { code: 'UPLOAD_FAILED' });
    }

    await _patch(paperId, {
      status: 'ready', file_r2_key: fileKey, answer_key_r2_key: keyKey, ready_at: new Date().toISOString(),
    });
    return {
      status: 'ready', paperId, version, parentVersion, questionCount: questions.length, marks,
      fileKey, keyKey, fileName: name, keyFileName: keyName, title: _title({ grade, subject, chapterTitle }),
    };
  } catch (err) {
    const code = err.code || 'UNKNOWN';
    logToFile('[assessment-revision] build failed', { userId, paperId, parentId, code, error: err.message }, 'error');
    await _patch(paperId, { status: 'failed', error_code: code, error_detail: String(err.message || '').slice(0, 200) });
    return { status: 'failed', code, paperId };
  }
}

/**
 * Make a NEW version from her draft tree and hand it over on WhatsApp: the paper
 * goes out WITH its Edit button (token naming the new row) and the key after it.
 */
async function createVersion({ parentId, userId, tree, phone: knownPhone, user = null, budget = null }) {
  const { phone, schoolName } = await _teacher(userId, knownPhone);
  const built = await buildVersion({ parentId, userId, tree, schoolName });
  if (built.status !== 'ready') {
    // A paper that was not found / not ready was never the teacher's to hear
    // about from a looked-up number: only the phone the caller handed us counts.
    const notHers = built.code === 'NOT_FOUND' || built.code === 'NOT_READY';
    await _say(notHers ? knownPhone || null : phone, budget)(built.code === 'INSERT_FAILED' ? 'UNKNOWN' : built.code);
    return built;
  }
  const say = _say(phone, budget);
  const { paperId, version, parentVersion, questionCount, marks, fileKey, keyKey, title } = built;
  const name = built.fileName;
  const keyName = built.keyFileName;

  try {
    const caption = `${title} · ${questionCount} questions`;
    const body = resolveUx('assessmentVersionBody', {
      user,
      params: { title, version: version || '?', parent: parentVersion || '?', count: questionCount, marks },
    });
    const url = await r2.getPresignedUrl(r2.buildR2PublicUrl(fileKey), 3600);
    const delivered = await Delivery.sendPaperWithEditButton({
      phone, url, filename: name, caption, body, user, budget,
      flowToken: `${userId}:assessment-review:${paperId}`,
    });
    if (!delivered.sent) {
      throw Object.assign(new Error('paper send returned falsy'), { code: 'SEND_FAILED' });
    }

    const keyUrl = await r2.getPresignedUrl(r2.buildR2PublicUrl(keyKey), 3600);
    const answerKeySent = await Delivery.sendAnswerKey({
      phone, url: keyUrl, filename: keyName, caption: resolveUx('assessmentKeyCaption', { user, params: { title } }),
    });

    logToFile('[assessment-revision] version delivered', {
      userId, paperId, parentId, version, parentVersion, questions: questionCount, marks,
      mode: delivered.mode, answerKeySent,
    });
    return {
      status: 'ready', paperId, version, parentVersion, questionCount, marks, answerKeySent,
    };
  } catch (err) {
    const code = err.code || 'UNKNOWN';
    logToFile('[assessment-revision] failed', { userId, paperId, parentId, code, error: err.message });
    await _patch(paperId, { status: 'failed', error_code: code, error_detail: String(err.message || '').slice(0, 200) });
    await say(code);
    return { status: 'failed', code, paperId };
  }
}

/**
 * "Make my paper" with nothing changed: the SAME version again, with its key
 * and its Edit button. No row is inserted — a version identical to its parent
 * would only be noise in the family.
 */
async function resendVersion({ paperId, userId, phone: knownPhone, user = null, budget = null }) {
  const loaded = await loadVersion({ paperId, userId });
  const { phone, schoolName } = await _teacher(userId, knownPhone);
  const say = _say(phone, budget);
  if (!loaded.paper) {
    await say(loaded.code);
    return { status: 'failed', code: loaded.code };
  }
  const p = loaded.paper;
  if (!p.file_r2_key) {
    await say('NOT_FOUND');
    return { status: 'failed', code: 'NO_FILE' };
  }
  const req = p.assessment_requests || {};
  const { grade, subject, pageRanges, format } = coverageOf(req);
  const chapterTitle = await _chapterTitle(req, grade, subject);
  const version = await versionNumberOf(p);
  const questions = Renderer.collectQuestions(p.exam_json);
  const marks = Renderer.totalMarks(questions);
  const title = [_title({ grade, subject, chapterTitle }), version > 1 ? `Version ${version}` : null]
    .filter(Boolean).join(' · ');
  const name = String(p.file_r2_key).split('/').pop();

  const url = await r2.getPresignedUrl(r2.buildR2PublicUrl(p.file_r2_key), 3600);
  const delivered = await Delivery.sendPaperWithEditButton({
    phone, url, filename: name, caption: `${title} · ${questions.length} questions`, user, budget,
    body: resolveUx('assessmentPaperBody', { user, params: { title, count: questions.length, marks } }),
    flowToken: `${userId}:assessment-review:${paperId}`,
  });
  if (!delivered.sent) {
    await say('SEND_FAILED');
    return { status: 'failed', code: 'SEND_FAILED' };
  }

  // A key is sent with every version. One that predates stored keys is built
  // now from this version's own tree and recorded (the tree is not touched).
  let keyKey = p.answer_key_r2_key;
  if (!keyKey) {
    try {
      const renderer = rendererFor(format);
      const keyBuffer = await renderer.render(Renderer.renderAnswerKey({
        examJson: Selection.activeTree(p.exam_json), grade, subject, schoolName, pageReference: pageRanges, chapterTitle,
      }));
      keyKey = await r2.uploadExamBuffer({
        buffer: keyBuffer, userId, examId: paperId,
        filename: fileName({ grade, subject, chapterTitle, format: renderer.ext, suffix: `_v${version}_AnswerKey` }),
      });
      await _patch(paperId, { answer_key_r2_key: keyKey });
    } catch (err) {
      logToFile('[assessment-revision] key for resend failed', { paperId, error: err.message });
    }
  }
  let answerKeySent = false;
  if (keyKey) {
    const keyUrl = await r2.getPresignedUrl(r2.buildR2PublicUrl(keyKey), 3600);
    answerKeySent = await Delivery.sendAnswerKey({
      phone, url: keyUrl, filename: String(keyKey).split('/').pop(),
      caption: resolveUx('assessmentKeyCaption', { user, params: { title } }),
    });
  }
  logToFile('[assessment-revision] version re-sent unchanged', { userId, paperId, version, answerKeySent });
  return { status: 'resent', paperId, version, questionCount: questions.length, marks, answerKeySent };
}

module.exports = {
  rerender, listQuestions, saveEdit, fileName, TEACHER_MESSAGE,
  loadVersion, versionNumberOf, listVersionItems, listFamily, buildVersion, createVersion, resendVersion,
};
