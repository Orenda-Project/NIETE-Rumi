'use strict';
/**
 * ONE language decides everything the TEACHER reads: the language she stored.
 *
 * Round 1 resolved it per service, and fell back to the language of the
 * TRANSCRIPT when she had stored nothing — so a teacher reading English got
 * Urdu interstitials around an Urdu lesson, and two surfaces in the same
 * feature could disagree. The stored preference, clamped to the offer, is now
 * the only authority (the model in config/languages.js + utils/language-cache).
 *
 * The quiz CONTENT is a separate decision: she chooses that, and the children
 * read it. Nothing here should follow it.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({ author: jest.fn(), excerptsFor: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor' }),
  botNumber: jest.fn().mockReturnValue('923222482222'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-report.service', () => ({ generate: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/templates/transcript-quiz-teacher.template', () => jest.fn().mockReturnValue('<html>quiz</html>'));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(true), markVideoShown: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WA = require('../../bot/shared/services/whatsapp.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const teacherTemplate = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const { lessonLabel, formatLessonDate, teacherLanguageFor } = require('../../bot/shared/services/quiz/transcript-quiz-language');

const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Nudge = require('../../bot/shared/services/quiz/transcript-quiz-nudge.service');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
const UID = 'u-1';

/** An ENGLISH-reading teacher. Everything else about her lesson is Urdu. */
const TEACHER = { id: UID, phone_number: PHONE, preferred_language: 'en', first_name: 'Rifat', last_name: 'Noor', grades_taught: ['4'] };
const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5',
  language_of_instruction: 'ur', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }, { id: 'S2', statement: 'b', taught_level: 'understand' }],
  key_terms: [], examples_used: [], misconceptions_surfaced: [],
};
const SESSION = {
  id: SID, user_id: UID, status: 'completed', observation_type: null,
  transcript_text: 'x'.repeat(3000), transcript_language: 'ur', created_at: '2026-09-05T05:00:00Z',
  analysis_data: { topic: 'Fractions', subject: 'Maths' }, users: TEACHER,
};
const QUIZ = {
  id: QID, teacher_id: UID, coaching_session_id: SID, topic: 'کسریں', subject: 'maths',
  language: 'ur', status: 'generating', meta: { digest: DIGEST, grade: '4', step: 'author' },
};
const en = (key, params) => resolveUx(key, { language: 'en', params });

function question(i) {
  return {
    slo_id: i % 2 ? 'S1' : 'S2', level: i % 2 ? 'recall' : 'understand',
    question: `سوال ${i}: آدھی روٹی کا کسر کیا ہے؟`, options: [`½ ${i}`, `⅓ ${i}`, `¼ ${i}`], correct_index: 0,
    explanation: 'آدھی روٹی یعنی ایک بٹا دو۔',
    selected_because: `سوال ${i} روٹی کے ٹکڑوں والے حصے سے لیا گیا`,
    distractor_misconceptions: { 1: 'تین حصے', 2: 'چار حصے' },
    option_feedback: { correct: 'بالکل۔', wrong: { 1: 'نہیں۔', 2: 'نہیں۔' } },
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map(question);
const LESSON_SUMMARY = 'استاد نے آدھی روٹی کی مثال سے کسر پڑھایا اور بورڈ پر ٹکڑے بنا کر دکھائے۔';

const bodies = () => [
  ...WA.sendMessage.mock.calls.map((c) => c[1]),
  ...WA.sendInteractiveButtons.mock.calls.map((c) => c[1].body),
  ...WA.sendInteractiveMessage.mock.calls.map((c) => c[1].body?.text),
  ...WA.sendDocument.mock.calls.map((c) => c[3]),
].filter(Boolean);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  delete process.env.TRANSCRIPT_QUIZ_OFFER_MODE;
  delete process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
});

describe('teacherLanguageFor', () => {
  test('reads the stored preference and nothing else', () => {
    expect(teacherLanguageFor({ preferredLanguage: 'en', transcriptLanguage: 'ur' })).toBe('en');
    expect(teacherLanguageFor({ preferredLanguage: 'ur', transcriptLanguage: 'en' })).toBe('ur');
  });

  test('an Urdu transcript can no longer answer for a teacher who stored nothing', () => {
    expect(teacherLanguageFor({ preferredLanguage: null, transcriptLanguage: 'ur' })).toBe('en');
    expect(teacherLanguageFor({ preferredLanguage: null, transcriptLanguage: 'en' })).toBe('en');
    expect(teacherLanguageFor({ preferredLanguage: 'pa-PK', transcriptLanguage: 'ur' })).toBe('en');
    expect(teacherLanguageFor({})).toBe('en');
  });
});

describe('every teacher-facing surface answers in her stored language', () => {
  test('the offer', async () => {
    process.env.TRANSCRIPT_QUIZ_OFFER_MODE = 'every';   // she has met the feature already
    Digest.run.mockResolvedValue({ digest: DIGEST, grade: '4', gradeSource: 'profile', lpHint: null, model: 'm', costUsd: 0.001 });
    installFrom(supabase.from, { coaching_sessions: { data: [SESSION] }, quizzes: { data: [{ id: QID }] } });
    await Offer.processOffer(SID, {});
    expect(WA.sendInteractiveButtons.mock.calls[0][1].body).toBe(en('tqOffer', {
      lesson: lessonLabel({ digest: DIGEST, quizLanguage: 'ur', teacherLanguage: 'en' }),
      date: formatLessonDate(SESSION.created_at, 'en'),
    }));
  });

  test('the language ask, and the decline', async () => {
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{ ...QUIZ, status: 'offered' }] }),
      users: { data: [TEACHER] },
    });
    await Offer.handleOfferButton(`tq_yes_${QID}`, PHONE);
    expect(WA.sendInteractiveButtons.mock.calls[0][1].body).toBe(en('tqAskLanguage'));

    jest.clearAllMocks();
    await Offer.handleOfferButton(`tq_no_${QID}`, PHONE);
    expect(WA.sendMessage.mock.calls[0][1]).toBe(en('tqDeclined'));
  });

  test('the expired offer — the surface with no teacher row to read', async () => {
    installFrom(supabase.from, { quizzes: { data: [] }, users: { data: [] } });
    await Offer.handleOfferButton(`tq_yes_${QID}`, PHONE);
    expect(WA.sendMessage.mock.calls[0][1]).toBe(en('tqOfferExpired'));
  });

  test('"making it now", after she has chosen', async () => {
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{ ...QUIZ, status: 'offered' }] }),
      users: { data: [TEACHER] },
    });
    await Offer.handleLanguageButton(`tq_lang_ur_${QID}`, PHONE, TEACHER);
    expect(WA.sendMessage.mock.calls[0][1]).toBe(en('tqMaking'));
  });

  test('the three hand-off messages, and the PDF chrome', async () => {
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: LESSON_SUMMARY });
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [QUIZ] }),
      coaching_sessions: { data: [SESSION] },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [TEACHER] },
    });
    await Gen.process(QID, {});

    expect(WA.sendDocument.mock.calls[0][3]).toBe(en('tqHandoffIntro', {
      lesson: lessonLabel({ digest: DIGEST, quizLanguage: 'ur', teacherLanguage: 'en' }), n: 8,
    }));
    // The middle message is the forwardable one, in the QUIZ language — it is
    // read by children, not by her, so it is deliberately not English here.
    expect(WA.sendMessage.mock.calls[0][1]).toMatch(/[؀-ۿ]/);
    expect(WA.sendMessage.mock.calls[1][1]).toBe(en('tqReportPromise'));
    // The DOCUMENT is not one of her surfaces in that sense: PLAN_R4 D1 makes
    // the PDF single-language, and the language it speaks is the QUIZ's — she
    // chose it for this quiz, and it is what her class will read. Her stored
    // preference still decides everything above: the caption, the report
    // promise, the nudge. So both template arguments are the quiz language.
    expect(teacherTemplate).toHaveBeenCalledWith(expect.objectContaining({ language: 'ur', contentLanguage: 'ur' }));
  });

  test('the honest failure', async () => {
    Author.author.mockResolvedValue({ questions: EIGHT.map((q) => ({ ...q, slo_id: 'S1' })), model: 'm', costUsd: 0.01, latencyMs: 10, lessonSummary: LESSON_SUMMARY });
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [QUIZ] }),
      coaching_sessions: { data: [SESSION] },
      quiz_questions: { data: [] },
      users: { data: [TEACHER] },
    });
    await Gen.process(QID, {});
    expect(bodies()).toContain(en('tqCouldNotMake'));
  });

  test('the nudge', async () => {
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{ ...QUIZ, status: 'sent' }] }),
      quiz_sessions: { data: [{ id: 'qs-1' }] },
      users: { data: [TEACHER] },
    });
    await Nudge.process(QID);
    expect(WA.sendMessage.mock.calls[0][1]).toBe(en('tqNudge', { started: 1, topic: 'کسریں' }));
  });

  test('the /quiz list, its rows and its empty state', async () => {
    installFrom(supabase.from, {
      coaching_sessions: { data: [{ id: SID, created_at: SESSION.created_at, transcript_text: SESSION.transcript_text, analysis_data: SESSION.analysis_data }] },
      quizzes: { data: [] },
    });
    await List.showList(TEACHER, PHONE, null);
    const payload = WA.sendInteractiveMessage.mock.calls[0][1];
    expect(payload.body.text).toBe(en('tqListBody'));
    expect(payload.action.button).toBe(en('tqListButton'));
    expect(payload.action.sections[0].rows[0].description).toBe(`Mathematics · ${en('tqRowNoQuiz')}`);

    jest.clearAllMocks();
    installFrom(supabase.from, { coaching_sessions: { data: [] }, quizzes: { data: [] } });
    await List.showList(TEACHER, PHONE, null);
    expect(WA.sendMessage.mock.calls[0][1]).toBe(en('tqListEmpty'));
  });

  test('the /quiz replies: still making, resend, report', async () => {
    installFrom(supabase.from, {
      coaching_sessions: { data: [{ id: SID, user_id: UID, created_at: SESSION.created_at, transcript_text: SESSION.transcript_text, transcript_language: 'ur', analysis_data: SESSION.analysis_data }] },
      quizzes: { data: [{ ...QUIZ, status: 'generating' }] },
      users: { data: [TEACHER] },
    });
    await List.handleListPick(`tq_pick_${SID}`, PHONE, TEACHER);
    expect(WA.sendMessage.mock.calls[0][1]).toBe(en('tqStillMaking'));

    jest.clearAllMocks();
    installFrom(supabase.from, {
      quizzes: { data: [{ ...QUIZ, status: 'sent', meta: { ...QUIZ.meta, student_message: 'FORWARD ME' } }] },
      users: { data: [TEACHER] },
    });
    await List.handleActionButton(`tq_link_${QID}`, PHONE);
    expect(WA.sendMessage.mock.calls[0][1]).toBe(en('tqForwardThis'));

    jest.clearAllMocks();
    installFrom(supabase.from, {
      quizzes: { data: [{ ...QUIZ, status: 'sent', meta: { ...QUIZ.meta } }] },
      users: { data: [TEACHER] },
    });
    await List.handleActionButton(`tq_report_${QID}`, PHONE);
    expect(WA.sendMessage.mock.calls[0][1]).toBe(en('tqNoReportYet'));
  });
});
