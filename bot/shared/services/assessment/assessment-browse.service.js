'use strict';
/**
 * What a surface may OFFER, and what a teacher may DOWNLOAD.
 *
 * Surface-neutral by construction, the same way lp-v8-browse is:
 * full titles, no truncation, no `{id, title}` rows shaped for a WhatsApp
 * NavigationList, no 20-row pagination borrowed from a Flow. The Flow keeps
 * building its own capped rows from the same tables; this returns the facts and
 * each surface decides how they look.
 *
 * Why this exists rather than the portal querying `textbooks` itself: a portal
 * that offers a grade or subject the generator has no book for produces a
 * refusal a teacher cannot act on. That is not hypothetical — on the lesson-plan
 * side the identical split (portal reading one corpus, bot answering from
 * another) had grade 5 maths showing 0 chapters in the portal and 8 chapters
 * with 87 lessons on WhatsApp, on production, for months.
 *
 * The download half is the ownership boundary. It is written as ONE query with
 * the owner in it rather than a fetch-then-check, because a fetch-then-check is
 * a bug waiting for someone to add an early return above it.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const r2 = require('../../storage/r2');
const QuestionTypes = require('./question-types');
const { subjectLabel, taughtIn } = require('./assessment-vocabulary');

/**
 * The curriculum the assessment generator can actually read.
 *
 * Not decoration: `textbooks` also holds a punjab_snc_2020 book, and the ICT
 * prompts and page-content pipeline cannot generate from it. Dropping this
 * filter would offer a book that fails at generation time.
 */
const CURRICULUM = 'ict';

/** Every grade we hold at least one ICT book for. */
async function listGrades() {
  const { data, error } = await supabase
    .from('textbooks')
    .select('grade')
    .eq('curriculum', CURRICULUM);

  if (error) {
    logToFile('[assessment-browse] grade list failed', { error: error.message });
    throw new Error('Could not list grades');
  }

  return [...new Set((data || []).map((r) => r.grade))]
    .filter((g) => g != null)
    .sort((a, b) => a - b);
}

/**
 * The subjects on offer in one grade.
 *
 * Two filters, both required and asking different questions: do we HOLD the
 * book (the query), and is the subject TAUGHT in this grade (the band).
 */
async function listSubjects(grade) {
  const { data, error } = await supabase
    .from('textbooks')
    .select('subject')
    .eq('curriculum', CURRICULUM)
    .eq('grade', Number(grade));

  if (error) {
    logToFile('[assessment-browse] subject list failed', { grade, error: error.message });
    throw new Error('Could not list subjects');
  }

  const seen = new Set();
  return (data || [])
    .map((r) => r.subject)
    .filter((s) => s && taughtIn(s, grade))
    .filter((s) => (seen.has(s) ? false : seen.add(s)))
    .map((s) => ({ subject_key: s, subject: subjectLabel(s) }));
}

/** The chapters of one book, with the pages each covers. */
async function listChapters(grade, subject) {
  const { data: book, error: bookErr } = await supabase
    .from('textbooks')
    .select('id')
    .eq('curriculum', CURRICULUM)
    .eq('grade', Number(grade))
    .eq('subject', subject)
    .maybeSingle();

  if (bookErr || !book) {
    logToFile('[assessment-browse] no book', { grade, subject, error: bookErr?.message });
    return [];
  }

  const { data, error } = await supabase
    .from('textbook_toc')
    .select('chapter_number, chapter_title, page_start, page_end')
    .eq('textbook_id', book.id)
    .order('chapter_number');

  if (error) {
    logToFile('[assessment-browse] chapter list failed', { grade, subject, error: error.message });
    throw new Error('Could not list chapters');
  }

  return (data || []).map((c) => ({
    chapter_number: c.chapter_number,
    chapter_title: c.chapter_title,
    page_start: c.page_start,
    page_end: c.page_end,
    page_count: (c.page_start != null && c.page_end != null)
      ? (c.page_end - c.page_start + 1)
      : null,
  }));
}

/**
 * Which question types this subject and grade support, and how many questions
 * a paper may hold.
 *
 * The cap ships from HERE rather than being known by the caller (S6). The dead
 * portal panel hardcoded MAX_COUNT = 20 against the bot's MAX_QUESTIONS = 25 —
 * two surfaces, two numbers, no error, and a teacher on the portal silently
 * capped five questions lower than the same teacher on WhatsApp. A form that
 * reads the cap cannot disagree with the validator that enforces it.
 */
function questionOptions(subject, grade) {
  return {
    types: QuestionTypes.forSubject(subject, grade),
    maxQuestions: QuestionTypes.MAX_QUESTIONS,
    defaultQuestions: QuestionTypes.DEFAULT_QUESTIONS,
  };
}

function fileNameFor({ grade, subject, chapterTitle, format = 'pdf', suffix = '' }) {
  const label = subjectLabel(subject).replace(/[^A-Za-z0-9]/g, '');
  const chapter = chapterTitle
    ? `_${String(chapterTitle).replace(/[^A-Za-z0-9]+/g, '').slice(0, 24)}` : '';
  return `Grade${grade}_${label}${chapter}${suffix}.${format}`;
}

/**
 * A time-limited link to a paper she owns, or a flat "not available".
 *
 * Ownership is checked IN THE QUERY, so a paper belonging to someone else is
 * indistinguishable from one that does not exist — no 403 to probe with, no
 * difference in timing worth measuring, and no branch above the check for a
 * later edit to slip past.
 *
 * `available: false` is returned with a 200 by the route above it, and covers
 * four genuinely different situations that a caller should treat identically:
 * the paper is not hers, it does not exist, it is not finished, or it is an
 * answer key whose location was never recorded (every paper generated before
 * V1.4.2). None of them is an error, and none of them should say which.
 */
async function paperDownloadUrl(paperId, userId, artifact = 'paper') {
  const wantsKey = artifact === 'answer_key';

  const { data, error } = await supabase
    .from('assessment_papers')
    .select('id, status, file_r2_key, answer_key_r2_key, '
      + 'assessment_requests!inner(user_id, grade_code, subject_code, chapter_number, output_format)')
    .eq('id', paperId)
    .maybeSingle();

  if (error) {
    logToFile('[assessment-browse] paper lookup failed', { paperId, error: error.message });
    return { available: false };
  }
  if (!data) return { available: false };
  if (data.assessment_requests?.user_id !== userId) return { available: false };
  if (data.status !== 'ready') return { available: false };

  const key = wantsKey ? data.answer_key_r2_key : data.file_r2_key;
  if (!key) return { available: false };

  const req = data.assessment_requests;
  // grade_code is 'grade_4'; the filename wants the number.
  const grade = String(req.grade_code || '').replace(/^grade_/, '');
  const format = req.output_format || 'pdf';

  let url;
  try {
    url = await r2.getPresignedUrl(r2.buildR2PublicUrl(key), 3600);
  } catch (err) {
    logToFile('[assessment-browse] could not presign', { paperId, error: err.message });
    return { available: false };
  }

  return {
    available: true,
    url,
    filename: fileNameFor({
      grade,
      subject: req.subject_code,
      chapterTitle: null,
      format,
      suffix: wantsKey ? '_AnswerKey' : '',
    }),
  };
}

/** The book behind a grade+subject, or null. The FK a request row needs. */
async function bookFor(grade, subject) {
  const { data, error } = await supabase
    .from('textbooks')
    .select('id, total_pages')
    .eq('curriculum', CURRICULUM)
    .eq('grade', Number(grade))
    .eq('subject', subject)
    .maybeSingle();

  if (error) {
    logToFile('[assessment-browse] book lookup failed', { grade, subject, error: error.message });
    return null;
  }
  return data || null;
}

/**
 * Where a request has got to.
 *
 * Four states, and the caller must be able to act differently on each:
 *
 *   queued      the row exists, the worker has not opened a paper yet. There is
 *               a real window here — createAndQueue writes the request and
 *               queues the job, and the paper row is opened when the worker
 *               picks it up. A poll landing in that gap must read "queued", not
 *               "something is wrong".
 *   generating  the worker has it.
 *   ready       there is a paperId to download.
 *   failed      with the CODE, so she can be told which real thing went wrong
 *               rather than a generic apology.
 *
 * `not_found` covers both a request that does not exist and one that is not
 * hers — checked in the query, so the two are indistinguishable.
 */
async function requestStatus(requestId, userId) {
  const { data, error } = await supabase
    .from('assessment_requests')
    .select('id, user_id, assessment_papers(id, status, error_code, attempt)')
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    logToFile('[assessment-browse] status lookup failed', { requestId, error: error.message });
    return { status: 'not_found' };
  }
  if (!data || data.user_id !== userId) return { status: 'not_found' };

  const papers = data.assessment_papers || [];
  if (!papers.length) return { status: 'queued' };

  // A retry is a NEW row rather than an overwrite, precisely so a failure stays
  // visible — which means the latest attempt is the answer and the earlier ones
  // are history.
  const latest = papers.reduce((a, b) => ((b.attempt || 0) > (a.attempt || 0) ? b : a));

  return {
    status: latest.status,
    paperId: latest.status === 'ready' ? latest.id : undefined,
    errorCode: latest.status === 'failed' ? (latest.error_code || 'UNKNOWN') : undefined,
  };
}

/**
 * Her finished papers, newest first, filterable by grade and subject.
 *
 * Only `ready` rows: a failed attempt is kept in the table on purpose (that is
 * why a retry is a new row) but a list of things to download is not where it
 * belongs. `count: 'exact'` because the page needs to know how many pages
 * there are, not just whether there is another one.
 */
async function listPapers(userId, { page = 1, pageSize = 10, grade = null, subject = null } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(50, Math.max(1, Number(pageSize) || 10));
  const from = (p - 1) * size;

  let q = supabase
    .from('assessment_papers')
    .select('id, status, question_count, total_marks, ready_at, file_r2_key, answer_key_r2_key, '
      + 'assessment_requests!inner(user_id, grade_code, subject_code, chapter_number)',
    { count: 'exact' })
    .eq('status', 'ready')
    .eq('assessment_requests.user_id', userId);

  if (grade !== null) q = q.eq('assessment_requests.grade_code', `grade_${grade}`);
  if (subject) q = q.eq('assessment_requests.subject_code', subject);

  const { data, error, count } = await q
    .order('ready_at', { ascending: false })
    .range(from, from + size - 1);

  if (error) {
    logToFile('[assessment-browse] paper list failed', { userId, error: error.message });
    throw new Error('Could not list papers');
  }

  return {
    page: p,
    pageSize: size,
    total: count || 0,
    papers: (data || []).map((r) => {
      const req = r.assessment_requests || {};
      const subjectKey = req.subject_code;
      return {
        paper_id: r.id,
        grade: Number(String(req.grade_code || '').replace(/^grade_/, '')) || null,
        subject_key: subjectKey,
        subject: subjectLabel(subjectKey),
        chapter_number: req.chapter_number,
        question_count: r.question_count,
        total_marks: r.total_marks,
        ready_at: r.ready_at,
        // Whether the button can be drawn at all. Absent for every paper
        // generated before V1.4.2, and for every paper she did not ask a key
        // for — the page must not offer a download that will answer "no".
        has_answer_key: !!r.answer_key_r2_key,
      };
    }),
  };
}

module.exports = {
  listGrades,
  listSubjects,
  listChapters,
  questionOptions,
  bookFor,
  requestStatus,
  listPapers,
  paperDownloadUrl,
  fileNameFor,
};
