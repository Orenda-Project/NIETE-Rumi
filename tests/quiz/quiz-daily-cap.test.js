'use strict';
/**
 * The runaway guard: at most QUIZ_DAILY_CAP quizzes made per teacher per day,
 * counted in the generate step before any model call, both streams.
 *
 * The generate step runs for real; the network boundary is mocked (supabase,
 * WhatsApp, the queue, R2, the PDF renderer, Redis — whose one Lua call is
 * the counter) and so are the LLM-backed digest and author.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn(), normaliseDigest: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/lp-quiz-digest.service', () => ({
  run: jest.fn(), lessonExcerpts: jest.fn().mockReturnValue('WHAT THE CLASS WAS TO LEARN: add with carrying'),
  lessonDrewBlock: jest.fn().mockReturnValue(''),
}));
jest.mock('../../bot/shared/services/quiz/lp-asset-source.store', () => ({ resolveSlideScript: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-new', code: 'NEW234', teacherName: 'Rifat Noor', topic: 'Carrying' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn(async (_b, key) => `https://r2/${key}`),
  downloadFromR2: jest.fn(async () => Buffer.from('png')),
  extractKeyFromUrl: jest.fn((url) => String(url).replace(/^https:\/\/r2\//, '')),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockLocks = new Map();
const mockRedis = { available: true };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => mockRedis.available,
  acquireLock: jest.fn(async (res, id) => { if (mockLocks.has(res)) return false; mockLocks.set(res, id); return true; }),
  releaseLock: jest.fn(async (res, id) => { if (mockLocks.get(res) !== id) return false; mockLocks.delete(res); return true; }),
  evalScript: jest.fn(async () => null),
}));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../bot/shared/services/quiz/lp-asset-source.store');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');
const Redis = require('../../bot/shared/services/cache/railway-redis.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const DailyCap = require('../../bot/shared/services/quiz/quiz-daily-cap');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { installNoPictureRepair } = require('./helpers/no-picture-repair');

const QID = '44444444-4444-4444-8444-444444444444';
const DONOR_ID = '55555555-5555-4555-8555-555555555555';
const LESSON = {
  lesson_id: 'grade_2_math_ch9_seg3', asset_id: 'a-1', version_stamp: 'v8-20260901', content_hash: 'h-abc', delivered_at: '2026-09-24T04:10:00Z',
};
const LP_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Add a 3-digit and a 2-digit number',
  subject: 'maths', language: 'en', status: 'generating', grade: '2',
  meta: {
    step: 'generating', source: 'lp_offer', nudge_id: 'n-1', lessons: [LESSON], class: { grade: 2, subject: 'maths' }, lesson_date: '2026-09-24',
  },
};
const USER = { id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'en' };
const SLIDE_SCRIPT = { meta: { lessonId: LESSON.lesson_id, grade: 2, subject: 'math' }, goal: 'Add with carrying' };
const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '1-2', confidence: 0.9,
  taught_level: 'apply',
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['146 + 27'], misconceptions_surfaced: [],
};

// Everything teacher-specific on the donor — none of it may reach the new quiz.
const DONOR_SECRETS = {
  teacherName: 'Donor Teacher Zzqx', shareCode: 'OLDQ77', shareCodeId: 'sc-donor-9f', lessonDate: '2026-09-03',
  link: 'https://wa.me/923000000000?text=QUIZ-OLDQ77', pdfKey: 'transcript_quizzes/u-donor/old.pdf', nudge: 'n-donor-71',
};
function donorRow(over = {}) {
  const meta = {
    step: 'ready', source: 'lp_offer', nudge_id: DONOR_SECRETS.nudge, lessons: [{ ...LESSON, asset_id: 'a-1', delivered_at: '2026-09-02T04:00:00Z' }],
    class: { grade: 2, subject: 'maths', section: 'Zeta-9' }, lesson_date: DONOR_SECRETS.lessonDate,
    digest: DIGEST, grade: '2', grade_source: 'catalog', lesson_summary: 'You planned column addition.',
    lesson_summary_short: 'Column addition.', question_count: 2,
    key_verify: { status: 'clean' }, key_check: { status: 'clean' }, cost_usd: 0.041,
    share_code: DONOR_SECRETS.shareCode, share_code_id: DONOR_SECRETS.shareCodeId, link: DONOR_SECRETS.link,
    student_message: `${DONOR_SECRETS.teacherName} sent a quiz ${DONOR_SECRETS.link}`, pdf_key: DONOR_SECRETS.pdfKey,
    teacher_name: DONOR_SECRETS.teacherName, class_cards: { sent: 3 }, sent_at: '2026-09-03T09:00:00Z',
    ...(over.meta || {}),
  };
  return {
    id: DONOR_ID, quiz_source: 'lp_v8', topic: 'Adding with carrying', subject: 'maths', grade: '2', language: 'en',
    status: 'sent', created_at: new Date(Date.now() - 3 * 864e5).toISOString(), teacher_id: 'u-donor',
    ...over, meta,
  };
}
const DONOR_Q = [0, 1].map((i) => ({
  question_text: `What is ${146 + i} + 27?`, option_a: `${173 + i}`, option_b: `${163 + i}`, option_c: `${183 + i}`,
  correct_option: 'A', explanation: 'Ones first.', misconception_feedback: null, distractor_misconceptions: null,
  option_feedback: { correct: 'Yes', wrong: {} }, difficulty_level: 3,
  media: { language: 'en', display_order: [2, 0, 1], question_card: `https://r2/transcript_quizzes/u-donor/${DONOR_ID}/card${i + 1}.png` },
  render_pattern: 'P1', sort_order: i, external_id: `tq:${DONOR_ID}:S${i + 1}:${i + 1}`,
  id: `row-donor-${i}`, quiz_id: DONOR_ID, created_at: '2026-09-03T08:00:00Z',
}));

function goodQuestion(i, slo, level) {
  return {
    slo_id: slo, level, question: `Question ${i}: what is ${100 + i} + ${20 + i}?`,
    options: [`${120 + 2 * i}`, `${130 + 2 * i}`, `${110 + 2 * i}`], correct_index: 0,
    explanation: `Add the ones, then the tens: ${120 + 2 * i}.`,
    selected_because: `Question ${i} checks adding two numbers in columns.`,
    distractor_misconceptions: { 1: 'carried when no column reached ten', 2: 'dropped a ten' },
    option_feedback: { correct: 'Yes — ones first, then tens.', wrong: { 1: 'No column reached ten, so nothing carries.', 2: 'A ten was lost from the tens column.' } },
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => goodQuestion(i, i % 2 ? 'S1' : 'S2', i % 2 ? 'apply' : 'understand'));

beforeEach(() => {
  jest.clearAllMocks();
  mockLocks.clear();
  mockRedis.available = true;
  delete process.env.QUIZ_DAILY_CAP;
  process.env.QUIZ_LP_CACHE = 'off';
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  Store.resolveSlideScript.mockResolvedValue({ slideScript: SLIDE_SCRIPT, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({ digest: DIGEST, grade: '2', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002, latencyMs: 10 });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned column addition.' });
});
afterAll(() => { delete process.env.QUIZ_LP_CACHE; });

function wire({ quiz = LP_QUIZ } = {}) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert' || c[0] === 'delete') ? { data: null, error: null } : { data: [] }),
    users: { data: [USER] },
  }));
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);

describe('the per-teacher daily cap', () => {
  test('over the cap: no model call, the quiz fails daily_cap and the teacher is told honestly', async () => {
    Redis.evalScript.mockResolvedValueOnce(-10);   // the 11th quiz today
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual({ failed: true, reason: 'daily_cap' });
    expect(LpDigest.run).not.toHaveBeenCalled();
    expect(Author.author).not.toHaveBeenCalled();
    expect(Store.resolveSlideScript).not.toHaveBeenCalled();
    const failed = quizUpdates().find((u) => u.status === 'failed');
    expect(failed.meta.error).toBe('daily_cap');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, UX_STRINGS.tqDailyCap.en);
    const ev = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.failed');
    expect(ev[1]).toEqual(expect.objectContaining({ reason: 'daily_cap', count: 10, limit: 10 }));
  });

  test('the counter is keyed on the teacher and the PKT day and holds quiz ids (a redelivery never counts twice)', async () => {
    Redis.evalScript.mockResolvedValueOnce(3);
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const [script, keys, args] = Redis.evalScript.mock.calls[0];
    expect(script).toBe(DailyCap.CLAIM_LUA);
    expect(keys).toEqual([`quizcap:u-1:${DailyCap.pktDate()}`]);
    expect(args[0]).toBe(QID);
    expect(args[1]).toBe(10);
  });

  test('QUIZ_DAILY_CAP=off: nothing is counted', async () => {
    process.env.QUIZ_DAILY_CAP = 'off';
    wire();
    await Gen.process(QID, {});
    expect(Redis.evalScript).not.toHaveBeenCalled();
    expect(Author.author).toHaveBeenCalled();
  });

  test('QUIZ_DAILY_CAP=25 is the cap passed to the counter', async () => {
    process.env.QUIZ_DAILY_CAP = '25';
    Redis.evalScript.mockResolvedValueOnce(12);
    wire();
    await Gen.process(QID, {});
    expect(Redis.evalScript.mock.calls[0][2][1]).toBe(25);
  });

  test('Redis down: the quiz is made (the guard fails open)', async () => {
    Redis.evalScript.mockResolvedValueOnce(null);
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(Author.author).toHaveBeenCalled();
  });

  test('a quiz resuming at the hand-off is not counted again', async () => {
    wire({ quiz: { ...LP_QUIZ, status: 'ready', meta: { ...LP_QUIZ.meta, step: 'ready', digest: DIGEST, question_count: 8 } } });
    await Gen.process(QID, {});
    expect(Redis.evalScript).not.toHaveBeenCalled();
  });

  test('the copy: en + ur, names the limit and tomorrow, no recording/transcript, gender-neutral', () => {
    const s = UX_STRINGS.tqDailyCap;
    expect(s.en).toMatch(/today/i);
    expect(s.en).toMatch(/tomorrow/i);
    expect(s.en).not.toMatch(/recording|transcript/i);
    expect(s.en).not.toMatch(/\b(she|her|he|his|him)\b/i);
    expect(s.ur).toMatch(/کل/);
    expect(s.ur).not.toMatch(/رہی|رہے ہوں|چکی ہیں|چکے ہیں|سکتی ہیں|سکتے ہیں/);
    expect([...s.en].length).toBeLessThanOrEqual(1024);
    expect([...s.ur].length).toBeLessThanOrEqual(1024);
  });
});
