'use strict';
/**
 * bd-mg9c7.11 — the generate step: author → validate → store → PDF → link →
 * three paced teacher messages. Idempotent per step, honest on failure.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor', topic: 'کسریں' }),
  botNumber: jest.fn().mockReturnValue('923222482222'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5', language_of_instruction: 'ur', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }, { id: 'S2', statement: 'b', taught_level: 'understand' }],
  key_terms: [], examples_used: ['آدھی روٹی'], misconceptions_surfaced: [],
};
const QUIZ = { id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: 'کسریں', subject: 'maths', language: 'ur', status: 'generating', meta: { digest: DIGEST, grade: '4', step: 'author' } };
const SESSION = {
  id: SID, user_id: 'u-1', transcript_text: 'x'.repeat(3000), transcript_language: 'ur', created_at: '2026-09-05T05:00:00Z',
  analysis_data: { topic: 'Fractions', subject: 'Maths' },
  users: { phone_number: '923001234567', preferred_language: 'ur', first_name: 'Rifat', last_name: 'Noor' },
};

function goodQuestion(i, slo = 'S1', level = 'recall') {
  return {
    slo_id: slo, level, question: `سوال ${i}: آدھی روٹی کا کسر کیا ہے؟`, options: [`½ ${i}`, `⅓ ${i}`, `¼ ${i}`], correct_index: 0,
    explanation: 'آدھی روٹی یعنی ایک بٹا دو۔',
    distractor_misconceptions: { 1: 'تین حصے', 2: 'چار حصے' },
    option_feedback: { correct: 'بالکل — آدھی روٹی ایک بٹا دو ہوتی ہے۔', wrong: { 1: 'تین حصے نہیں، روٹی دو حصوں میں کٹی تھی۔', 2: 'چار حصے نہیں، روٹی دو حصوں میں کٹی تھی۔' } },
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => goodQuestion(i, i % 2 ? 'S1' : 'S2', i % 2 ? 'recall' : 'understand'));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
});

function wire({ quiz = QUIZ, insertError = null } = {}) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: { data: [SESSION] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: insertError } : { data: [] }),
    users: { data: [SESSION.users] },
  }));
}

describe('process — happy path', () => {
  test('authors, validates, stores 8 rows, renders the PDF, mints a code, sends three paced messages, marks sent', async () => {
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100 });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);

    const qInserts = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert');
    expect(qInserts).toHaveLength(1);
    const rows = qInserts[0][1];
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual(expect.objectContaining({ quiz_id: QID, render_pattern: 'P1', sort_order: 0 }));
    // quiz_questions.external_id is GLOBALLY unique (idx_quiz_questions_external_id):
    // the second live quiz on staging died on "tq:S1:1" already taken by the first.
    expect(rows[0].external_id).toMatch(new RegExp(`^tq:${QID}:S1:1$`));
    const other = Gen.toRows("33333333-3333-4333-8333-333333333333", EIGHT, { rng: () => 0 });
    expect(new Set([...rows, ...other].map((r) => r.external_id)).size).toBe(rows.length + other.length);
    // Stored feedback keys follow the SHUFFLED layout: the wrong keys are the non-correct indices.
    rows.forEach((row) => {
      const correctIdx = 'ABC'.indexOf(row.correct_option);
      expect(Object.keys(row.option_feedback.wrong).sort()).toEqual([0, 1, 2].filter((i) => i !== correctIdx).map(String));
    });

    expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
    const forwardable = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(forwardable).toMatch(/Rifat Noor/);
    expect(forwardable).toMatch(/کسریں/);
    expect(forwardable).toMatch(/https:\/\/wa\.me\/923222482222\?text=QUIZ-ABC234/);
    expect(forwardable.replace(/wa\.me\/\d+/, '')).not.toMatch(/\d{9,}/);

    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
    expect(updates.some((u) => u.status === 'ready')).toBe(true);
    expect(updates[updates.length - 1].status).toBe('sent');
    expect(updates[updates.length - 1].meta.share_code).toBe('ABC234');
    // A nudge is scheduled for +3h.
    expect(SQS.queueJob).toHaveBeenCalledWith(QID, 'quiz_nudge_teacher', expect.any(Object), expect.any(Object));
  });

  test('the PDF caption names the subject and the topic as it was taught', async () => {
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100 });
    wire();
    await Gen.process(QID, {});
    const caption = WhatsAppService.sendDocument.mock.calls[0][3];
    expect(caption).toMatch(/ریاضی/);   // the subject, in the teacher's language
    expect(caption).toMatch(/کسریں/);   // the topic as the class heard it
  });

  test('the language SHE chose outranks the subject rule', async () => {
    // An Urdu-subject lesson: the rule says 'ur'. She asked for English on the
    // language ask, and that is what the row carries.
    const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
    Digest.run.mockResolvedValue({
      digest: { ...DIGEST, subject: 'urdu' }, grade: '4', gradeSource: 'profile', lpHint: null, model: 'm', costUsd: 0.001,
    });
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100 });
    wire({ quiz: { ...QUIZ, subject: 'urdu', language: 'en', meta: { grade: '4', step: 'digest' } } });

    await Gen.process(QID, {});
    expect(Author.author).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
    expect(updates.find((u) => 'language' in u).language).toBe('en');
  });

  test('is idempotent: a quiz already sent does nothing', async () => {
    wire({ quiz: { ...QUIZ, status: 'sent' } });
    const r = await Gen.process(QID, {});
    expect(r.skipped).toBe('already_sent');
    expect(Author.author).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});

describe('process — validator failure', () => {
  test('regenerates once, then marks failed and tells the teacher honestly', async () => {
    const bad = EIGHT.map((q) => ({ ...q, slo_id: 'S1' }));   // S2 never covered
    Author.author.mockResolvedValue({ questions: bad, model: 'm', costUsd: 0.01 });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.failed).toBe(true);
    expect(Author.author).toHaveBeenCalledTimes(2);
    // The retry carries the validator's complaints back to the model.
    expect(Author.author.mock.calls[1][0].previousErrors).toEqual(expect.arrayContaining([expect.stringMatching(/SLOs uncovered/)]));
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
    expect(updates[updates.length - 1].status).toBe('failed');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/[؀-ۿ]/);   // teacher language ur
    expect(WhatsAppService.sendDocument).not.toHaveBeenCalled();
  });
});

/**
 * bd-mg9c7.26 — the teacher's PDF carries TWO languages: her chrome and the
 * quiz's content. Staging shipped a teacher whose preference is English an
 * all-Urdu quiz, and because the whole document was keyed on her preference
 * every Urdu question landed on a Latin-only face and printed as boxes.
 *
 * Driven through the real process() -> renderPdf -> template chain (only the
 * network boundary, htmlToPdf, is mocked) so the parameter is proved to reach
 * its use site, not merely to be passed one hop.
 */
describe('process — the PDF follows both languages', () => {
  const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');

  test('an English-preferring teacher with an Urdu quiz gets English chrome around RTL Urdu questions', async () => {
    Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100 });
    wire({ quiz: { ...QUIZ, language: 'ur' } });
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{ ...QUIZ, language: 'ur' }] }),
      coaching_sessions: { data: [{ ...SESSION, users: { ...SESSION.users, preferred_language: 'en' } }] },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [{ ...SESSION.users, preferred_language: 'en' }] },
    });

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);

    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toMatch(/<html dir="ltr" lang="en">/);        // her chrome
    expect(html).toMatch(/How to send it/);
    expect(html).toMatch(/<div class="stem content" dir="rtl">/); // the quiz
    expect(html).toMatch(/[؀-ۿ]/);
  });
});

describe('studentMessage', () => {
  test('is written in the QUIZ language and names teacher, topic, date, link', () => {
    const ur = Gen.studentMessage({ teacherName: 'Rifat', topic: 'کسریں', date: '5 ستمبر', link: 'https://wa.me/1?text=QUIZ-X', language: 'ur' });
    expect(ur).toMatch(/Rifat/); expect(ur).toMatch(/کسریں/); expect(ur).toMatch(/QUIZ-X/); expect(ur).toMatch(/[؀-ۿ]/);
    const en = Gen.studentMessage({ teacherName: 'Rifat', topic: 'Fractions', date: '5 Sep', link: 'https://wa.me/1?text=QUIZ-X', language: 'en' });
    expect(en).toMatch(/Fractions/); expect(en).not.toMatch(/[؀-ۿ]/);
  });
});
