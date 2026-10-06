'use strict';
/**
 * THE TOP-UP (quiz_author_gates_v2). Every stage after the author that may drop
 * a question takes a few, and nothing refilled the quiz: on ten real lessons the
 * mean slid from 7.8 questions (gates off) to about 6.5, most quizzes at the
 * floor of six. Now, after every gates-on stage, a quiz under SEVEN gets ONE
 * call that writes the missing questions from lesson lines no question uses yet
 * (and no line that is itself a question), naming the questions already in the
 * quiz. Each one is checked like any other — the validator, the source check,
 * the blind solve, the leak and repeat checks — and one that fails is simply not
 * added: never a second call, never fewer questions than there were.
 * Flag off: nothing runs.
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
afterEach(() => GatesV2.setEnabled(false));

const SIX = () => grammar().slice(0, 6);
const isTopUp = (call) => /TOP_UP/.test(call.messages[0].content);
const topUpPrompts = () => mockCreate.mock.calls.map(promptOf).filter((p) => /TOP_UP/.test(p));

describe('the top-up to seven (gates v2)', () => {
  test('a quiz that would ship six gets ONE call and ships seven, the new question quoting an unused lesson line', async () => {
    mockCreate.mockImplementation((call) => (isTopUp(call)
      ? Promise.resolve(reply({ questions: [{ index: 6, ...FIXED_Q2 }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: SIX() }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(7);
    expect(storedRows().some((row) => /Grandfather/.test(row.question_text))).toBe(true);
    expect(topUpPrompts()).toHaveLength(1);
    const line = topUpPrompts()[0].split('\n').find((l) => /TOP_UP/.test(l));
    expect(line).toMatch(/quote one of THESE lines verbatim/);
    expect(line).toMatch(/Nephew اور Niece/);
    // names the questions already in the quiz, so it neither repeats nor gives one away
    expect(line).toMatch(/Brother کا feminine noun/);
    // what the validator would refuse anyway (ABOUT_TEACHER, FIGURE_MISSING): asked for up front
    expect(line).toMatch(/never about the teacher/);
    expect(line).toMatch(/no picture/);
    expect(lastMeta().top_up).toEqual(expect.objectContaining({ wanted: 1, candidates: 2, added: 1, failed_reasons: { NOT_RETURNED: 1 } }));
  });

  test('a replacement that repeats a question already in the quiz is not added, and no second call is made', async () => {
    mockCreate.mockImplementation((call) => (isTopUp(call)
      ? Promise.resolve(reply({ questions: [{ index: 6, ...grammar()[1] }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: SIX() }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(6);
    expect(topUpPrompts()).toHaveLength(1);
    const tu = lastMeta().top_up;
    expect(tu).toEqual(expect.objectContaining({ wanted: 1, added: 0 }));
    expect(Object.keys(tu.failed_reasons).length).toBeGreaterThan(0);
  });

  test('the one call asks for two candidates per missing question; a failing first candidate leaves room for the second', async () => {
    mockCreate.mockImplementation((call) => (isTopUp(call)
      ? Promise.resolve(reply({ questions: [{ index: 6, ...grammar()[1] }, { index: 7, ...FIXED_Q2 }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: SIX() }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(topUpPrompts()).toHaveLength(1);
    expect(topUpPrompts()[0].split('\n').filter((l) => /TOP_UP/.test(l))).toHaveLength(2);
    expect(storedRows()).toHaveLength(7);
    expect(storedRows().some((row) => /Grandfather/.test(row.question_text))).toBe(true);
    expect(lastMeta().top_up).toEqual(expect.objectContaining({ wanted: 1, candidates: 2, added: 1 }));
  });

  test('never more than the missing count is added, even when both candidates pass', async () => {
    const SECOND = gq({ question: 'Nephew کا feminine noun کیا ہے؟', options: ['Niece', 'Aunt', 'Sister'] });
    SECOND.source_quote = 'آج ہم نے Nephew اور Niece کے رشتے کو بھی غور سے پڑھا';
    mockCreate.mockImplementation((call) => (isTopUp(call)
      ? Promise.resolve(reply({ questions: [{ index: 6, ...FIXED_Q2 }, { index: 7, ...SECOND }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: SIX() }))));
    wire({ gates: true });
    await Gen.process(QID, {});
    expect(storedRows()).toHaveLength(7);
    expect(lastMeta().top_up).toEqual(expect.objectContaining({ wanted: 1, added: 1 }));
  });

  test('a replacement the blind solver disagrees with is not added', async () => {
    mockCreate.mockImplementation((call) => (isTopUp(call)
      ? Promise.resolve(reply({ questions: [{ index: 6, ...FIXED_Q2 }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: SIX() }))));
    wire({ gates: true });
    const { agreeWithEveryKey } = require('./helpers/key-verify-agree');
    Gen.verifyKeys.mockImplementation(async (args) => {
      const res = await agreeWithEveryKey(args);
      const qs = args.questions || [];
      return { ...res, verdicts: res.verdicts.map((v) => (qs[v.index] && /Grandfather/.test(qs[v.index].question) ? { ...v, verdict: 'disagree' } : v)) };
    });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(6);
    expect(lastMeta().top_up).toEqual(expect.objectContaining({ wanted: 1, added: 0 }));
  });

  test('a quiz of seven or more makes no top-up call', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: grammar() })));
    wire({ gates: true });
    await Gen.process(QID, {});
    expect(topUpPrompts()).toHaveLength(0);
    expect(lastMeta().top_up).toBeUndefined();
  });

  test('flag off: a quiz of six ships six, no top-up call', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: SIX() })));
    wire({ gates: undefined });
    await Gen.process(QID, {});
    expect(topUpPrompts()).toHaveLength(0);
    expect(lastMeta().top_up).toBeUndefined();
  });
});
