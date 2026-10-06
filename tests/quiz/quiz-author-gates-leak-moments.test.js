'use strict';
/**
 * A LEAK REWRITE IS SHOWN THE LESSON (quiz_author_gates_v2). The ANSWER_LEAK complaint carried no lesson text, so the rewrite quoted a summary and source fidelity dropped it (5 of 14 drops on one 10-source run). Fixtures from the cross-item leak suite.
 * (behind app_settings quiz_author_gates_v2).
 *
 * A blind re-score of ten real lessons found answer leaks in 8 of 10 quizzes
 * AFTER the first leak check shipped: 20 of the 25 leaked questions were not
 * named, because the check read only an earlier question's stem, explanation and
 * "right" line, matched the answer only word for word, and skipped every number.
 * Each case below is a real leaking pair from those quizzes, shortened.
 *
 * And a leak the repair could not fix shipped whole. Now, after every step that
 * writes a question, the leaking LATER question gets one more targeted rewrite
 * (the complaint names both questions), else is dropped while the quiz keeps at
 * least the floor of six, else ships counted. Flag off: nothing changes.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true), sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true), sendTextReturningId: jest.fn().mockResolvedValue('m1'),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'A B', topic: 'x' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const GatesV2 = require('../../bot/shared/services/quiz/quiz-author-gates-v2');


// ── the generate path ────────────────────────────────────────────────────────
const QID = '66666666-6666-4666-8666-666666666666';
const SID = '55555555-5555-4555-8555-555555555555';
const EN_DIGEST = {
  topic: 'Gender of nouns', topic_as_taught: 'masculine and feminine nouns', subject: 'english',
  grade_band: '6-8', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'name the feminine noun for a masculine noun', statement_en: 'name the feminine noun for a masculine noun', taught_level: 'recall' },
    { id: 'S2', statement: 'tell a masculine noun from a feminine noun', statement_en: 'tell a masculine noun from a feminine noun', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'masculine noun' }, { term: 'feminine noun' }], examples_used: ['brother and sister', 'king and queen'], misconceptions_surfaced: [],
};
const EN_SUMMARY = 'آج کے سبق میں masculine noun اور feminine noun کی پہچان اور ان کے جوڑے سکھائے گئے۔';
const moment = (key) => `${key} کا جوڑا ہم نے کلاس میں یاد کیا`;
const gq = ({ slo = 'S1', level = 'recall', question, options, explanation }) => ({
  slo_id: slo, level, question, options, correct_index: 0,
  explanation: explanation || 'ہر masculine noun کا ایک feminine noun ہوتا ہے۔',
  selected_because: 'سبق میں جوڑوں کی مثالیں دی گئیں',
  distractor_misconceptions: { 1: 'جوڑا الٹ سمجھنا', 2: 'کوئی اور رشتہ چن لینا' },
  option_feedback: { correct: 'بالکل درست!', wrong: { 1: 'یہ اس کا جوڑا نہیں ہے۔', 2: 'یہ بھی اس کا جوڑا نہیں ہے۔' } },
  source_quote: moment(options[0]), teaching_error: null,
});
function grammar() {
  return [
    gq({ question: 'Brother کا feminine noun کیا ہے؟', options: ['Sister', 'Mother', 'Uncle'] }),
    gq({ question: 'King کا feminine noun کیا ہے؟', options: ['Queen', 'Princess', 'Aunt'] }),
    gq({ question: 'Father کا feminine noun کیا ہے؟', options: ['Mother', 'Sister', 'Daughter'] }),
    gq({ question: 'Boy کا feminine noun کیا ہے؟', options: ['Girl', 'Woman', 'Lady'] }),
    gq({ slo: 'S2', level: 'understand', question: 'ان میں سے کون سا masculine noun ہے؟', options: ['Uncle', 'Aunt', 'Niece'] }),
    gq({ slo: 'S2', level: 'understand', question: 'ان میں سے کون سا feminine noun ہے؟', options: ['Niece', 'Nephew', 'Uncle'] }),
    gq({ slo: 'S2', level: 'understand', question: 'لفظ Son کس قسم کا noun ہے؟', options: ['masculine noun', 'feminine noun', 'دونوں'] }),
    gq({ slo: 'S2', level: 'understand', question: 'لفظ Daughter کس قسم کا noun ہے؟', options: ['feminine noun', 'masculine noun', 'دونوں'] }),
  ];
}
/** q0's explanation states q2's answer (Father → Mother). */
const leaky = () => { const qs = grammar(); qs[0] = { ...qs[0], explanation: 'ہر masculine noun کا ایک feminine noun ہوتا ہے، جیسے Father کا جوڑا Mother ہے۔' }; return qs; };
const FIXED_Q2 = gq({ question: 'Grandfather کا feminine noun کیا ہے؟', options: ['Grandmother', 'Granddaughter', 'Aunt'] });
const TRANSCRIPT = [...grammar(), FIXED_Q2].map((q) => `استاد: ${moment(q.options[0])}۔`).join('\n').repeat(4) + '\nاستاد: آج ہم نے Nephew اور Niece کے رشتے کو بھی غور سے پڑھا۔';

function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages[0].content;
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
function wire({ gates }) {
  const settings = gates === undefined ? [] : [{ key: 'quiz_author_gates_v2', value: gates }];
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: EN_DIGEST.topic, subject: 'english', language: 'ur', status: 'generating', meta: { digest: EN_DIGEST, grade: '7', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: TRANSCRIPT, transcript_language: 'ur', created_at: '2026-09-24T04:00:00Z', analysis_data: {}, users: { phone_number: '923001234567', preferred_language: 'ur', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923001234567', preferred_language: 'ur' }] },
    app_settings: (calls) => {
      const eq = calls.find((c) => c[0] === 'eq' && c[1] === 'key');
      const inn = calls.find((c) => c[0] === 'in' && c[1] === 'key');
      const keys = eq ? [eq[2]] : (inn ? inn[2] : []);
      return { data: settings.filter((r) => keys.includes(r.key)) };
    },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const lastMeta = () => {
  const ups = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]).filter((u) => u.meta);
  return ups.length ? ups[ups.length - 1].meta : {};
};

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});
afterEach(() => GatesV2.setEnabled(false));


describe('a leak rewrite is shown the lesson (gates v2)', () => {
  test('the ANSWER_LEAK complaint the rewrite sees carries unused lesson lines to quote', async () => {
    const bad = leaky();
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...FIXED_Q2 }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const leakPrompts = mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p) && /ANSWER_LEAK/.test(p));
    expect(leakPrompts.length).toBeGreaterThan(0);
    const line = leakPrompts[0].split('\n').find((l) => /ANSWER_LEAK/.test(l));
    expect(line).toMatch(/not used yet: «[^»]*Nephew اور Niece/);
  });

  test('flag off: no leak rewrite, nothing appended', async () => {
    const bad = leaky();
    mockCreate.mockImplementation(() => Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad })));
    wire({ gates: undefined });
    await Gen.process(QID, {});
    expect(mockCreate.mock.calls.map(promptOf).filter((p) => /not used yet/.test(p))).toHaveLength(0);
  });
});

test('withLessonMoments: appends to ANSWER_LEAK only, once', () => {
  const src = 'Teacher: the king and the queen are a pair we learned in class today.\nTeacher: a brother and a sister are another pair we learned.';
  const errs = ['q2: ANSWER_LEAK — q0 gives away q2\'s answer «Mother»', 'q3: META_STEM — x'];
  const out = Gen.withLessonMoments(errs, [], src);
  expect(out[0]).toMatch(/not used yet: «/);
  expect(out[1]).toBe('q3: META_STEM — x');
  expect(Gen.withLessonMoments(out, [], src)).toEqual(out);
});
