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

const screen = (id, data) => ({ screen: id, data });

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

async function handleInit(userId, flowToken) {
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
      return screen('SUBMITTED', {
        message: "Something went wrong starting your paper. Please send /assessment and try again.",
      });
    }

    await clearSession(flowToken);
    return screen('SUBMITTED', { message: 'Making your paper — about a minute. It will arrive in this chat.' });
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
async function submit(state) {
  const book = await bookFacts(state);
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
      page_ranges: state.pageRanges || null,
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
    pageRanges: state.pageRanges || null,
    contentSource: state.contentSource || 'unseen',
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
  _internal: { summaryOf, GRADE_BANDS, COUNT_CHOICES },
};
