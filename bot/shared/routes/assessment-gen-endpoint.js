'use strict';
/**
 * The Assessment Generator Flow, driven from the server.
 *
 *   CLASS ──▶ COVERAGE ──┬─▶ QUESTIONS ──┬─▶ CONFIRM ──▶ SUBMITTED
 *                        └─▶ PAGES ──────┘   (via TYPES if she asks)
 *
 * Every list she sees is built here as the screen is requested, rather than
 * published into the Flow and left to drift: the subjects offered are the books
 * we actually hold for her grade, the chapters are that book's real contents
 * page, and the question types are the ones valid for that subject. A teacher
 * cannot pick something we then have to refuse.
 *
 * State between screens lives in Redis under the flow token. Flows are
 * stateless by design — what she chose two screens ago is only knowable because
 * we wrote it down.
 */

const redis = require('../services/cache/railway-redis.service');
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const BookContent = require('../services/assessment/book-content.service');
const QuestionTypes = require('../services/assessment/question-types');
const SQSQueueService = require('../services/queue');

const SESSION_TTL_SECONDS = 15 * 60;

const SUBJECT_TITLE = {
  english: 'English', urdu: 'Urdu', maths: 'Maths', islamiat: 'Islamiat',
  science: 'Science', general_knowledge: 'General Knowledge', social_studies: 'Social Studies',
};

// Which subjects a grade is actually taught. Science and Social Studies start at
// Grade 4; General Knowledge stops at Grade 3. Offering one outside its band
// produces a book we do not have and a refusal she cannot act on.
const GRADE_BANDS = {
  science: [4, 5],
  social_studies: [4, 5],
  general_knowledge: [1, 2, 3],
};

const COUNT_CHOICES = [10, 15, 20, 25, 30];

function sessionKey(token) { return `assessment_gen:${token || 'no-token'}`; }

async function readSession(token) {
  try {
    const s = await redis.get(sessionKey(token));
    return (s && typeof s === 'object') ? s : {};
  } catch (err) {
    logToFile('[assessment-flow] session read failed', { error: err.message });
    return {};
  }
}

async function writeSession(token, state) {
  try {
    await redis.set(sessionKey(token), state, SESSION_TTL_SECONDS);
  } catch (err) {
    logToFile('[assessment-flow] session write failed', { error: err.message });
  }
}

async function clearSession(token) {
  try { await redis.delete(sessionKey(token)); } catch { /* best effort */ }
}

// Meta requires a component's `visible` to be a boolean, not a truthy string,
// so the error TEXT and the decision to SHOW it are two fields. Deriving the
// flag here means no caller can set one and forget the other.
const screen = (id, data) => ({
  screen: id,
  data: ('error' in (data || {})) ? { ...data, has_error: Boolean(data.error) } : data,
});

/** Which grades we hold any book for. */
async function gradesOnOffer() {
  const { data } = await supabase
    .from('textbooks').select('grade').eq('curriculum', 'ict');
  const grades = [...new Set((data || []).map((r) => r.grade))].filter(Boolean).sort();
  return grades.map((g) => ({ id: String(g), title: `Grade ${g}` }));
}

/** Which subjects we hold a book for, in this grade. */
async function subjectsOnOffer(grade) {
  const { data } = await supabase
    .from('textbooks').select('subject').eq('curriculum', 'ict').eq('grade', Number(grade));
  return (data || [])
    .map((r) => r.subject)
    .filter((s) => {
      const band = GRADE_BANDS[s];
      return !band || band.includes(Number(grade));
    })
    .map((s) => ({ id: s, title: SUBJECT_TITLE[s] || s }));
}

function summaryOf(state) {
  return [
    state.grade ? `Grade ${state.grade}` : null,
    SUBJECT_TITLE[state.subject] || state.subject,
    state.chapterTitle ? `Chapter ${state.chapterNumber} · ${state.chapterTitle}` : null,
    (!state.chapterNumber && state.pageRanges) ? `Pages ${state.pageRanges}` : null,
  ].filter(Boolean).join(' · ');
}

// ── The review journey ──────────────────────────────────────────────────────
//
// She comes back to this Flow already holding a paper, so her token names a
// PAPER rather than a half-built request: `<userId>:assessment-review:<paperId>`.
// Same Flow, same endpoint, different entry point — which is why the token, not
// a screen id, is what decides where INIT lands.

// Required lazily, at call time, NOT at module scope. The revision service
// reaches R2 and so pulls in `@aws-sdk/client-s3`, which lives in bot/ — and CI
// runs the root suite before bot's deps are installed. A top-level require here
// kills every root suite that loads this endpoint for an unrelated reason,
// reporting a missing module instead of whatever it was actually asserting.
const Selection = require('../services/assessment/assessment-selection');
const revision = () => require('../services/assessment/assessment-revision.service');

const REVIEW_MARKER = ':assessment-review:';

/** The paper id a review token names, or null if this is an ordinary session. */
function paperIdFromToken(flowToken) {
  const i = String(flowToken || '').indexOf(REVIEW_MARKER);
  return i === -1 ? null : String(flowToken).slice(i + REVIEW_MARKER.length) || null;
}

/**
 * One page of her questions.
 *
 * `selected` is the running answer for the WHOLE paper and lives in the session,
 * not in the form: the form only ever knows the twenty rows currently on screen,
 * so trusting it alone would silently drop every question she never scrolled to.
 */
function reviewScreen({ items, selected, page, error = '' }) {
  const view = Selection.pageOf(items, page);
  const keep = new Set(selected);
  return screen('REVIEW', {
    summary: `${items.length} question${items.length === 1 ? '' : 's'} · `
      + `${keep.size} kept`,
    progress: view.total > view.items.length
      ? `Questions ${view.from}-${view.to} of ${view.total}`
      : `${view.total} question${view.total === 1 ? '' : 's'}`,
    questions: view.items.map((q) => ({
      id: q.id,
      title: Selection.optionTitle(q),
      description: `${q.marks} mark${q.marks === 1 ? '' : 's'}${q.type ? ` · ${q.type}` : ''}`,
    })),
    selected: view.items.filter((q) => keep.has(q.id)).map((q) => q.id),
    page: String(view.index),
    has_prev: view.hasPrev,
    has_next: view.hasNext,
    error,
  });
}

/** An empty review screen that explains itself, for when there is no paper. */
function reviewError(message) {
  return screen('REVIEW', {
    summary: '', progress: '', questions: [], selected: [],
    page: '0', has_prev: false, has_next: false, error: message,
  });
}

async function openReview(userId, paperId, flowToken) {
  const { items, code } = await revision().listQuestions({ paperId, userId });
  if (!items) {
    return reviewError(code === 'NOT_READY'
      ? 'That paper is still being made. I will send it here when it is done.'
      : "I couldn't find that paper. Send /assessment to make a new one.");
  }
  const selected = items.filter((q) => q.selected).map((q) => q.id);
  await writeSession(flowToken, { userId, paperId, page: 0, selected });
  return reviewScreen({ items, selected, page: 0 });
}

/**
 * Fold this page's ticks into the answer for the whole paper.
 *
 * Only the ids ON THIS PAGE are decided by `keep`; everything else keeps whatever
 * it already had. Replacing the whole set with `keep` would untick every question
 * she has not scrolled to — the paper would quietly shrink to one screenful.
 */
function mergePageTicks({ selected, pageIds, keep }) {
  const onPage = new Set(pageIds);
  const ticked = new Set(Array.isArray(keep) ? keep : []);
  const out = new Set((selected || []).filter((id) => !onPage.has(id)));
  for (const id of pageIds) if (ticked.has(id)) out.add(id);
  return out;
}

async function handleReview(userId, data, flowToken) {
  const state = await readSession(flowToken);
  const paperId = state.paperId || paperIdFromToken(flowToken);
  const owner = state.userId || userId;

  const { items, code } = await revision().listQuestions({ paperId, userId: owner });
  if (!items) return reviewError("I couldn't find that paper. Send /assessment to make a new one.");

  const page = Number.parseInt(data.page, 10) || 0;
  const view = Selection.pageOf(items, page);
  const merged = mergePageTicks({
    selected: state.selected ?? items.map((q) => q.id),
    pageIds: view.items.map((q) => q.id),
    keep: data.keep,
  });
  const selected = [...merged];

  const action = String(data.action || 'done');
  if (action === 'next' || action === 'prev') {
    const nextPage = action === 'next' ? view.index + 1 : view.index - 1;
    await writeSession(flowToken, { userId: owner, paperId, page: nextPage, selected });
    return reviewScreen({ items, selected, page: nextPage });
  }

  // She can untick everything; it is a real state and it means something. Saying
  // so on the screen keeps her one tap from a paper, where sending a blank
  // document would cost her the whole journey.
  if (selected.length === 0) {
    await writeSession(flowToken, { userId: owner, paperId, page: view.index, selected });
    return reviewScreen({
      items, selected, page: view.index,
      error: 'Keep at least one question, then tap "Make the paper".',
    });
  }

  const result = await revision().rerender({ paperId, userId: owner, selectedIds: selected });
  await clearSession(flowToken);

  if (result.status !== 'ready') {
    return screen('SUBMITTED', {
      heading: "That didn't work",
      message: revision().TEACHER_MESSAGE?.[result.code]
        || 'Sorry — something went wrong making your paper. Please try again.',
      caption: 'You can close this.',
    });
  }

  return screen('SUBMITTED', {
    heading: 'Your paper is on its way',
    message: `${result.questionCount} question${result.questionCount === 1 ? '' : 's'}`
      + `${result.marks ? ` · ${result.marks} marks` : ''}. It will arrive in this chat.`,
    caption: 'You can close this.',
  });
}

async function handleInit(userId, flowToken) {
  // A review token means she already has a paper and wants to trim it. Checked
  // before anything else, because every screen below assumes a fresh request.
  const reviewPaperId = paperIdFromToken(flowToken);
  if (reviewPaperId) return openReview(userId, reviewPaperId, flowToken);

  await writeSession(flowToken, { userId });
  const grades = await gradesOnOffer();
  if (grades.length === 0) {
    // Nothing imported yet. Say so rather than showing an empty dropdown.
    return screen('CLASS', {
      grades: [], subjects: [],
      error: 'No books are loaded yet. Please try again later.',
    });
  }
  // Subjects are filled in properly once she picks a grade; the first render
  // needs a non-empty list because the component requires one.
  const subjects = await subjectsOnOffer(grades[0].id);
  return screen('CLASS', { grades, subjects, error: '' });
}

async function handleDataExchange(userId, screenId, formData, flowToken) {
  const state = await readSession(flowToken);
  state.userId = state.userId || userId;
  const data = formData || {};

  // ── REVIEW → REVIEW | SUBMITTED ──────────────────────────────────────────
  // Its own journey, entered by token rather than by walking the screens above.
  if (screenId === 'REVIEW') return handleReview(userId, data, flowToken);

  // ── CLASS → COVERAGE ─────────────────────────────────────────────────────
  if (screenId === 'CLASS') {
    const grade = Number(data.grade);
    const subject = String(data.subject || '');
    const subjects = await subjectsOnOffer(grade);

    // A stale client can submit a pair that is not on offer. Re-render rather
    // than accept it — the next screen would only fail on a missing book.
    if (!subjects.some((s) => s.id === subject)) {
      return screen('CLASS', {
        grades: await gradesOnOffer(), subjects,
        error: `We don't have that subject for Grade ${grade}. Please pick another.`,
      });
    }

    Object.assign(state, { grade, subject, chapterNumber: null, chapterTitle: null, pageRanges: null });
    await writeSession(flowToken, state);

    let chapters = [];
    try {
      chapters = await BookContent.listChapters({ grade, subject });
    } catch (err) {
      logToFile('[assessment-flow] chapter list failed', { grade, subject, error: err.message });
    }

    if (chapters.length === 0) {
      // No contents page for this book — page numbers are the only way in.
      return screen('PAGES', {
        summary: summaryOf(state),
        hint: 'Type the pages you want, for example 4-14.',
        error: '',
      });
    }

    return screen('COVERAGE', {
      summary: summaryOf(state),
      has_chapters: true,
      chapters: chapters.map((c) => ({
        id: String(c.chapterNumber),
        title: `${c.chapterNumber} · ${c.title}`
          + (c.pageStart ? ` (pages ${c.pageStart}-${c.pageEnd})` : ''),
      })),
      error: '',
    });
  }

  // ── COVERAGE → PAGES | QUESTIONS ─────────────────────────────────────────
  if (screenId === 'COVERAGE') {
    const wantsPages = data.use_pages === true || data.use_pages === 'true';
    if (wantsPages) {
      const book = await bookFacts(state);
      return screen('PAGES', {
        summary: summaryOf(state),
        hint: book.totalPages
          ? `This book has pages 1-${book.totalPages}.`
          : 'Type the pages you want, for example 4-14.',
        error: '',
      });
    }

    const chapterNumber = Number(data.chapter);
    if (!chapterNumber) {
      return screen('COVERAGE', {
        summary: summaryOf(state), has_chapters: true,
        chapters: await chapterOptions(state),
        error: 'Please choose a chapter, or tick the box to type page numbers.',
      });
    }

    const chapters = await BookContent.listChapters({ grade: state.grade, subject: state.subject });
    const chosen = chapters.find((c) => c.chapterNumber === chapterNumber);
    Object.assign(state, { chapterNumber, chapterTitle: chosen ? chosen.title : null, pageRanges: null });
    await writeSession(flowToken, state);
    return questionsScreen(state);
  }

  // ── PAGES → QUESTIONS ────────────────────────────────────────────────────
  if (screenId === 'PAGES') {
    const pageRanges = String(data.page_ranges || '').trim();
    const book = await bookFacts(state);
    try {
      const pages = BookContent.parsePageRanges(pageRanges);
      const beyond = book.totalPages ? pages.filter((p) => p > book.totalPages) : [];
      if (beyond.length) {
        return screen('PAGES', {
          summary: summaryOf(state),
          hint: `This book has pages 1-${book.totalPages}.`,
          error: `This book has pages 1-${book.totalPages}. You asked for ${beyond.join(', ')}.`,
        });
      }
    } catch (err) {
      return screen('PAGES', {
        summary: summaryOf(state),
        hint: book.totalPages ? `This book has pages 1-${book.totalPages}.` : '',
        error: 'Try something like 4-14, or 4, 9, 12.',
      });
    }
    Object.assign(state, { pageRanges, chapterNumber: null, chapterTitle: null });
    await writeSession(flowToken, state);
    return questionsScreen(state);
  }

  // ── QUESTIONS → TYPES | CONFIRM ──────────────────────────────────────────
  if (screenId === 'QUESTIONS') {
    Object.assign(state, {
      contentSource: String(data.content_source || 'unseen'),
      questionCount: Number(data.question_count) || 20,
    });
    await writeSession(flowToken, state);

    const wantsTypes = data.pick_types === true || data.pick_types === 'true';
    if (wantsTypes) {
      return screen('TYPES', {
        summary: summaryOf(state),
        types: QuestionTypes.forSubject(state.subject, state.grade)
          .map((t) => ({ id: t.id, title: t.id })),
        error: '',
      });
    }
    return confirmScreen(state);
  }

  // ── TYPES → CONFIRM ──────────────────────────────────────────────────────
  if (screenId === 'TYPES') {
    const picked = Array.isArray(data.question_types) ? data.question_types : [];
    if (picked.length === 0) {
      return screen('TYPES', {
        summary: summaryOf(state),
        types: QuestionTypes.forSubject(state.subject, state.grade).map((t) => ({ id: t.id, title: t.id })),
        error: 'Please choose at least one kind of question.',
      });
    }
    state.pickedTypes = picked;
    await writeSession(flowToken, state);
    return confirmScreen(state);
  }

  // ── CONFIRM → SUBMITTED ──────────────────────────────────────────────────
  if (screenId === 'CONFIRM') {
    Object.assign(state, {
      outputFormat: String(data.output_format || 'pdf'),
      answerLines: data.answer_lines !== false && data.answer_lines !== 'false',
      answerKey: data.answer_key === true || data.answer_key === 'true',
    });

    try {
      await submit(state);
    } catch (err) {
      logToFile('[assessment-flow] submit failed', { error: err.message, userId: state.userId });
      // The terminal screen is shared, so every line of it has to change on the
      // failure path. Leaving the heading and caption saying a paper is coming
      // is worse than the failure: she waits for something nobody is making.
      return screen('SUBMITTED', {
        heading: "That didn't start",
        message: "Something went wrong starting your paper. Nothing is being made.",
        caption: 'Send /assessment to try again.',
      });
    }

    await clearSession(flowToken);
    return screen('SUBMITTED', {
      heading: 'Making your paper',
      message: 'About a minute.',
      caption: 'It will arrive in this chat. You can close this.',
    });
  }

  logToFile('[assessment-flow] unknown screen', { screenId });
  return screen('CLASS', { grades: await gradesOnOffer(), subjects: [], error: '' });
}

async function chapterOptions(state) {
  try {
    const chapters = await BookContent.listChapters({ grade: state.grade, subject: state.subject });
    return chapters.map((c) => ({
      id: String(c.chapterNumber),
      title: `${c.chapterNumber} · ${c.title}${c.pageStart ? ` (pages ${c.pageStart}-${c.pageEnd})` : ''}`,
    }));
  } catch { return []; }
}

async function bookFacts(state) {
  const { data } = await supabase
    .from('textbooks').select('id, total_pages')
    .eq('curriculum', 'ict').eq('grade', Number(state.grade)).eq('subject', state.subject)
    .maybeSingle();
  return { id: data?.id || null, totalPages: data?.total_pages || null };
}

function questionsScreen(state) {
  return screen('QUESTIONS', {
    summary: summaryOf(state),
    counts: COUNT_CHOICES.map((n) => ({ id: String(n), title: `${n} questions` })),
    error: '',
  });
}

function confirmScreen(state) {
  const source = {
    seen: 'Questions from the book',
    unseen: 'New questions',
    both: 'A mix',
  }[state.contentSource] || 'New questions';
  return screen('CONFIRM', {
    recap: [summaryOf(state), `${source} · ${state.questionCount} questions`].join('\n'),
    error: '',
  });
}

/**
 * Write the request down, then queue the work. In that order: the row is what
 * the worker is handed and what the watchdog looks for, so a queued job that
 * refers to nothing is worse than a row with no job.
 */
/**
 * The pages a chapter covers, or null when the contents page never said.
 * Best-effort: a request whose coverage cannot be named is still a request,
 * and the generator works from the chapter number regardless.
 */
async function chapterPageRange(state) {
  try {
    const chapters = await BookContent.listChapters({
      grade: state.grade, subject: state.subject,
    });
    const c = chapters.find((x) => x.chapterNumber === Number(state.chapterNumber));
    return (c && c.pageStart != null && c.pageEnd != null)
      ? `${c.pageStart}-${c.pageEnd}` : null;
  } catch (err) {
    logToFile('[assessment-flow] could not resolve chapter pages', {
      grade: state.grade, subject: state.subject,
      chapter: state.chapterNumber, error: err.message,
    });
    return null;
  }
}

async function submit(state) {
  const book = await bookFacts(state);

  // She chose a chapter, not pages — but the row should still say which pages
  // it covers, so a request is readable later without re-reading the contents
  // page (which can change under a re-import).
  const pageRanges = state.pageRanges
    || (state.chapterNumber != null ? await chapterPageRange(state) : null);

  const types = (state.pickedTypes && state.pickedTypes.length)
    ? QuestionTypes.withCounts(state.pickedTypes, state.questionCount, state.subject, state.grade)
    : QuestionTypes.defaultMix(state.subject, state.grade, state.questionCount);

  const { data: request, error } = await supabase
    .from('assessment_requests')
    .insert({
      user_id: state.userId,
      surface: 'whatsapp',
      grade_code: `grade_${state.grade}`,
      subject_code: state.subject,
      textbook_id: book.id,
      chapter_number: state.chapterNumber || null,
      page_ranges: pageRanges,
      content_source: state.contentSource || 'unseen',
      question_count: state.questionCount || 20,
      question_types: types,
      has_answer_key: !!state.answerKey,
      has_answer_lines: state.answerLines !== false,
      output_format: state.outputFormat || 'pdf',
    })
    .select('id')
    .single();

  if (error || !request) throw new Error(`could not record the request: ${error?.message}`);

  await SQSQueueService.queueJob(state.userId, 'assessment_generate', {
    userId: state.userId,
    requestId: request.id,
    grade: state.grade,
    subject: state.subject,
    chapterNumber: state.chapterNumber || null,
    pageRanges,
    contentSource: state.contentSource || 'unseen',
    questionCount: state.questionCount || 20,
    questionTypes: types,
    includeAnswerKey: !!state.answerKey,
    answerLines: state.answerLines !== false,
    outputFormat: state.outputFormat || 'pdf',
  });

  logToFile('[assessment-flow] queued', {
    userId: state.userId, requestId: request.id,
    grade: state.grade, subject: state.subject, chapter: state.chapterNumber,
  });
}

async function handleBack(userId, screenId, flowToken) {
  const state = await readSession(flowToken);
  if (screenId === 'CONFIRM' || screenId === 'TYPES') return questionsScreen(state);
  if (screenId === 'QUESTIONS' || screenId === 'PAGES') {
    return screen('COVERAGE', {
      summary: summaryOf(state), has_chapters: true,
      chapters: await chapterOptions(state), error: '',
    });
  }
  return handleInit(userId, flowToken);
}

module.exports = {
  handleAssessmentGenInit: handleInit,
  handleAssessmentGenDataExchange: handleDataExchange,
  handleAssessmentGenBack: handleBack,
  // exported for tests
  _internal: { summaryOf, submit, chapterPageRange, GRADE_BANDS, COUNT_CHOICES,
    paperIdFromToken, mergePageTicks, REVIEW_MARKER },
};
