'use strict';
/**
 * SCHEMA_v2 web items at generation: when the teacher is on the web arm AND
 * app_settings web_quiz_items_v2 is on, the stored rows carry media.web; when
 * either is off, the rows are exactly today's and no extra model call is made.
 * The model is faked at the network boundary (llm-client); web-quiz-items, the
 * web-arm switch and every gate run for real.
 */
jest.mock('../../bot/shared/services/llm-client', () => ({ getClientForModel: jest.fn() }));
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
  lessonDrewBlock: jest.fn().mockReturnValue('WHAT THE LESSON DREW — sticks'),
}));
jest.mock('../../bot/shared/services/quiz/lp-asset-source.store', () => ({ resolveSlideScript: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'T', topic: 'Carrying' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../bot/shared/services/quiz/lp-asset-source.store');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { installNoPictureRepair } = require('./helpers/no-picture-repair');

const QID = '44444444-4444-4444-8444-444444444444';
const TID = '55555555-5555-4555-8555-555555555555';
const SID = '66666666-6666-4666-8666-666666666666';
const PHONE = '923001234567';
const LESSON = {
  lesson_id: 'grade_2_math_ch9_seg3', asset_id: 'a-1', version_stamp: 'v8-20260901', content_hash: 'h-abc', delivered_at: '2026-09-22T04:10:00Z',
};
const LP_QUIZ = {
  id: QID, teacher_id: TID, coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Add a 3-digit and a 2-digit number',
  subject: 'maths', language: 'en', status: 'generating', grade: '2',
  meta: { step: 'digest', source: 'lp_offer', nudge_id: 'n-1', lessons: [LESSON], class: { grade: 2, subject: 'maths' }, lesson_date: '2026-09-22' },
};
const TQ_QUIZ = {
  id: QID, teacher_id: TID, coaching_session_id: SID, quiz_source: 'transcript', topic: 'Carrying', subject: 'maths',
  language: 'en', status: 'generating', grade: '2', meta: { step: 'digest', source: 'list' },
};
const USER = { id: TID, name: 'T', phone_number: PHONE, preferred_language: 'en' };
const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '1-2', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['146 + 27'], misconceptions_surfaced: ['carries out of every column'],
};
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
const TRANSCRIPT = 'Today we added numbers with carrying: 146 plus 27, ones first, then tens. '.repeat(40);
const SESSION = {
  id: SID, user_id: TID, status: 'completed', observation_type: null, transcript_text: TRANSCRIPT, transcript_language: 'en',
  analysis_data: { topic: 'Carrying', subject: 'maths' }, created_at: '2026-09-22T05:00:00Z', users: USER,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);   // the hand-off's own pacing
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  WhatsAppService.sendMessage.mockResolvedValue(true);
  Share.mintCode.mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'T', topic: 'Carrying' });
  Store.resolveSlideScript.mockResolvedValue({ slideScript: { meta: { lessonId: LESSON.lesson_id } }, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({ digest: DIGEST, grade: '2', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002 });
  Digest.run.mockResolvedValue({ digest: DIGEST, grade: '2', gradeSource: 'profile', lpHint: null, model: 'dm', costUsd: 0.002 });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned column addition.' });
});


const LLM = require('../../bot/shared/services/llm-client');
const WebItems = require('../../bot/shared/services/quiz/web-quiz-items');
const WebLink = require('../../bot/shared/services/quiz/web-quiz-link');

const WEB_REPLY = { items: [
  { q: 0, type: 'single', source_quote: '146 plus 27, ones first, then tens', read: { stem: 'What is 101 plus 21?', opts: ['122', '132', '112'] }, why: 'Add the ones, then the tens.' },
] };
let create;
function wire({ settings }) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [TQ_QUIZ] }),
    coaching_sessions: { data: [SESSION] },
    niete_lp_downloads: { data: [] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [USER] },
    app_settings: { data: settings },
  }));
}
const inserted = () => supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert').map((c) => c[1]).pop();
const ON = [{ key: 'web_quiz_enabled', value: 'true' }, { key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_items_v2', value: 'true' }];

const SAVED_ENV = { ...process.env };
afterAll(() => { process.env = SAVED_ENV; });

beforeEach(() => {
  process.env.PORTAL_URL = 'https://portal.example';
  WebItems.__resetCache(); WebLink._resetCache();
  create = jest.fn(async (params) => {
    const prompt = params.messages[0].content;
    if (!/A child will now meet them on a WEB PAGE/.test(prompt)) throw new Error('unexpected model call in this suite');
    return { choices: [{ message: { content: JSON.stringify(WEB_REPLY) }, finish_reason: 'stop' }], usage: { cost: 0.003 } };
  });
  LLM.getClientForModel.mockReturnValue({ client: { chat: { completions: { create } } }, model: 'fake' });
});

test('web arm + web_quiz_items_v2 on: the stored rows carry media.web (source-checked), WhatsApp columns unchanged', async () => {
  wire({ settings: ON });
  const first = {
    ...EIGHT[0], question: 'When we add with carrying, which column do we add first?', options: ['the ones', 'the tens', 'the hundreds'], correct_index: 0,
  };
  Author.author.mockResolvedValue({ questions: [first, ...EIGHT.slice(1)], model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You taught column addition.' });
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  const rows = inserted();
  expect(rows).toHaveLength(8);
  expect(rows[0].media.web).toMatchObject({ v: 2, type: 'single', source: { kind: 'transcript', ok: true }, wa: { from: 'same' } });
  expect(rows[0].media.web.key).toBe(rows[0].correct_option);
  expect(rows[0].question_text).toBe(rows[0].media.web.stem);
  expect(rows.slice(1).every((x) => !(x.media && x.media.web))).toBe(true);
  expect(create).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith('web_quiz.items_attached', expect.objectContaining({ quizId: QID, attached: 1 }));
});

test('items flag absent: no extra call, no media.web (production authoring unchanged)', async () => {
  wire({ settings: ON.slice(0, 2) });
  await Gen.process(QID, { phone: PHONE });
  expect(create).not.toHaveBeenCalled();
  expect(inserted().every((x) => !(x.media && x.media.web))).toBe(true);
});
