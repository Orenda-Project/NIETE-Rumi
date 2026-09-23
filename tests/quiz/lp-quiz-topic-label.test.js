'use strict';
/**
 * The label an LP-born quiz carries is the lesson's own name, not a clipped
 * sentence.
 *
 * For an Urdu quiz the label the teacher and the children read is
 * `digest.topic_as_taught` (topicFor(digest,'ur')): it becomes `quizzes.topic`,
 * the student forward message, the /quiz row and the PDF. The LP digest's model
 * filled it from the slide script's `meta.topic`, which on every script is the
 * first clause of the objective cut mid-sentence — live, for
 * grade_3_urdu_ch5_seg5: "طالب علم واحد اور جمع کے فرق کو". The forward message
 * then read "…واحد اور جمع کے فرق کو پر quiz بھیجا ہے".
 *
 * The catalog already holds the name the lesson's PDF caption prints
 * ("واحد اور جمع"). The label is set from it, deterministically, after the
 * model — and the model's English `topic` is kept.
 *
 * Mocked: supabase, WhatsApp, the queue, the LLM client (completeJson), and the
 * render/storage boundaries (html-to-pdf, R2) plus the share-code minter, which
 * is a supabase+redis writer. The digest, the author, the validator, the
 * slide-script store, generate and the hand-off all run for real.
 */

jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
// The blind solve is not this suite's subject: an agreeing solver on its seam (see the helper).
const { installAgreeingSolver } = require('./helpers/key-verify-agree');

const QID = '55555555-5555-4555-8555-555555555555';
const LESSON_ID = 'grade_3_urdu_ch5_seg5';
/** The clipped objective clause every slide script carries as meta.topic. */
const CLIPPED = 'طالب علم واحد اور جمع کے فرق کو';
/** The name the lesson's PDF caption prints — the catalog's `topic`. */
const CLEAN = 'واحد اور جمع';

const SLIDE_SCRIPT = {
  meta: { lessonId: LESSON_ID, grade: 3, subject: 'urdu', topic: CLIPPED, language: 'ur' },
  goal: 'طلبہ واحد اور جمع کا فرق پہچانیں اور واحد سے جمع بنائیں۔',
  sloFull: 'طلبہ واحد اور جمع کے فرق کو پہچان کر واحد الفاظ کی جمع بنا سکیں گے۔',
  bloom: 'understand',
  iDo: { keyFact: 'ایک چیز کے لیے واحد، ایک سے زیادہ کے لیے جمع۔' },
  youDo: { problems: [{ prompt: 'کتاب کی جمع لکھیں۔' }] },
  wrap: { keyFacts: ['واحد ایک، جمع ایک سے زیادہ۔'] },
};

/** What the digest model returns: its label is the clipped clause it was handed. */
const MODEL_DIGEST = {
  topic: 'Singular and plural nouns',
  topic_as_taught: CLIPPED,
  subject: 'urdu',
  grade_band: '3-5',
  language_of_instruction: 'ur',
  confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'واحد پہچانیں', statement_en: 'Identify singular nouns', statement_ur: 'واحد پہچانیں', evidence_quote: 'واحد', taught_level: 'recall' },
    { id: 'S2', statement: 'جمع بنائیں', statement_en: 'Form plurals', statement_ur: 'جمع بنائیں', evidence_quote: 'جمع', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'واحد', as_spoken: 'واحد' }],
  examples_used: ['کتاب', 'کتابیں'],
  misconceptions_surfaced: [],
};

function urduQuestion(i, slo, level) {
  return {
    slo_id: slo, level, question: `سوال ${i}: آدھی روٹی کا کسر کیا ہے؟`, options: [`½ ${i}`, `⅓ ${i}`, `¼ ${i}`], correct_index: 0,
    explanation: 'آدھی روٹی یعنی ایک بٹا دو۔',
    selected_because: `سوال ${i} روٹی کے ٹکڑوں والے حصے سے لیا گیا`,
    distractor_misconceptions: { 1: 'تین حصے', 2: 'چار حصے' },
    option_feedback: { correct: 'بالکل — آدھی روٹی ایک بٹا دو ہوتی ہے۔', wrong: { 1: 'تین حصے نہیں، روٹی دو حصوں میں کٹی تھی۔', 2: 'چار حصے نہیں، روٹی دو حصوں میں کٹی تھی۔' } },
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => urduQuestion(i, i % 2 ? 'S1' : 'S2', i % 2 ? 'recall' : 'understand'));

function llm({ digest = MODEL_DIGEST } = {}) {
  completeJson.mockImplementation(async ({ label }) => {
    if (label === 'lp_quiz.digest') return { json: digest, model: 'dm', costUsd: 0.001, latencyMs: 5 };
    return {
      json: {
        lesson_summary: 'آج کے سبق میں بچے واحد اور جمع کا فرق پہچانتے ہیں اور کتاب سے کتابیں بناتے ہیں۔',
        questions: EIGHT,
      },
      model: 'am', costUsd: 0.01, latencyMs: 50,
    };
  });
}

const LP_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: CLIPPED,
  subject: 'urdu', language: 'ur', status: 'generating', grade: '3',
  meta: {
    step: 'digest', source: 'lp_offer', nudge_id: 'n-1', class: { grade: 3, subject: 'urdu' }, lesson_date: '2026-09-22',
    lessons: [{ lesson_id: LESSON_ID, asset_id: 'a-1', version_stamp: 'v8-20260901', content_hash: 'h-1', delivered_at: '2026-09-22T04:10:00Z' }],
  },
};

function wire(quiz = LP_QUIZ) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: () => { throw new Error('an lp_v8 quiz must never query coaching_sessions'); },
    niete_lp_asset_sources: {
      data: [{
        asset_id: 'a-1', lesson_id: LESSON_ID, version_stamp: 'v8-20260901', content_hash: 'h-1',
        // No meta.lessonId on the stored script: the name must come from the
        // lesson the ROW was offered for (meta.lessons[0]), which generate passes.
        slide_script: { ...SLIDE_SCRIPT, meta: { ...SLIDE_SCRIPT.meta, lessonId: undefined } },
        source_url: null, verified: 'upload',
      }],
    },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'ur' }] },
  }));
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
});

describe('the LP digest names the lesson from the catalog, not from the model', () => {
  test('topic_as_taught is the catalog name of the served lesson; the model\'s English topic is kept', async () => {
    llm();
    const { digest } = await LpDigest.run({
      slideScript: SLIDE_SCRIPT, language: 'ur', grade: '3', subject: 'urdu', lessonId: LESSON_ID,
    });
    expect(digest.topic_as_taught).toBe(CLEAN);
    expect(digest.topic).toBe('Singular and plural nouns');
  });

  test('a lesson the catalog does not know keeps the model\'s label rather than losing it', async () => {
    llm({ digest: { ...MODEL_DIGEST, topic_as_taught: 'واحد اور جمع کا کھیل' } });
    const { digest } = await LpDigest.run({
      slideScript: { ...SLIDE_SCRIPT, meta: { ...SLIDE_SCRIPT.meta, lessonId: 'not_a_lesson' } },
      language: 'ur', grade: '3', subject: 'urdu', lessonId: 'not_a_lesson',
    });
    expect(digest.topic_as_taught).toBe('واحد اور جمع کا کھیل');
  });
});

describe('generate — an Urdu lp_v8 quiz is labelled with the lesson\'s own name everywhere', () => {
  test('quizzes.topic, the stored digest, the PDF caption and the student forward message all read the clean name', async () => {
    llm();
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));

    // The row the /quiz list and the share code read.
    const afterDigest = quizUpdates().find((u) => u.meta && u.meta.step === 'author');
    expect(afterDigest.topic).toBe(CLEAN);
    expect(afterDigest.meta.digest.topic_as_taught).toBe(CLEAN);
    expect(afterDigest.meta.digest.topic).toBe('Singular and plural nouns');

    // The PDF caption the teacher reads.
    const caption = WhatsAppService.sendDocument.mock.calls[0][3];
    expect(caption).toContain(CLEAN);
    expect(caption).not.toContain('فرق کو');

    // The message the teacher forwards to the children.
    const forwardable = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(forwardable).toContain(`*${CLEAN}* پر quiz`);
    expect(forwardable).not.toContain('فرق کو');
  });
});
