'use strict';
/**
 * THE LEAKS WORD MATCHING CANNOT SEE — one model pass (behind quiz_author_gates_v2).
 *
 * A blind counter over 30 more quizzes found that the word check names about a
 * third of the leaked questions: the rest are given away by elimination (an
 * earlier question says which province the ajrak belongs to, and the later
 * question's other options fall away) or by one step of reasoning ("the whole
 * group is the bigger number" before "the whole group in 18 − 7"). One model
 * call over the numbered quiz names them; a flag counts only when the words it
 * quotes name the later question's answer.
 *
 * Model flags are REWRITTEN only — never a reason to drop a question — and what
 * the rewrite does not replace ships, counted. The word check keeps its own
 * path (trim, rewrite, drop within the floor). A failed model call changes
 * nothing. Flag off: no call at all.
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
const { modelLeakErrors } = require('../../bot/shared/services/quiz/transcript-quiz-answer-leaks');

function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.001 } }; }
const promptOf = (call) => call[0].messages[0].content;
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
const isLeakPass = (call) => /LEAK CHECK/.test(call.messages[0].content);

const mcq = (question, options, { explanation = '', correct = '', wrong = {} } = {}) => ({
  question, options, correct_index: 0, explanation, option_feedback: { correct, wrong },
});
// The real elimination leak from a grade 5 Urdu social-studies quiz: q0 settles the ajrak and the
// kurta, so q1's other two options fall away. No sentence states «پشاوری چپل», so words cannot see it.
const PAK = [
  mcq('سندھ کی ثقافتی خصوصیات میں سے کون سی چیز سندھ کی پہچان ہے؟', ['اجرک', 'خشک میوہ', 'پنجابی کرتا'], {
    wrong: { 2: 'یہ پنجابی کرتا ہے جو پنجاب کی ثقافتی چیز ہے۔ سندھ کی خاص ثقافتی چیز اجرک ہے۔' },
  }),
  mcq('اگر آپ خیبر پختونخواہ کا دورہ کریں تو وہاں کی کون سی ثقافتی چیز خریدنی چاہیے؟', ['پشاوری چپل', 'اجرک', 'پنجابی کرتا']),
];

describe('the model pass', () => {
  test('a flag whose quoted words rule out every other option of the later question is named, with both questions', async () => {
    const complete = jest.fn().mockResolvedValue({
      json: { leaks: [{ later: 2, earlier: 1, quote: 'سندھ کی خاص ثقافتی چیز اجرک ہے۔ یہ پنجابی کرتا ہے جو پنجاب کی ثقافتی چیز ہے۔' }] },
      costUsd: 0.0015,
    });
    const out = await modelLeakErrors(PAK, { complete });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].prompt).toMatch(/LEAK CHECK/);
    expect(out.errors).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer «پشاوری چپل»/)]);
    expect(out).toEqual(expect.objectContaining({ flagged: 1, kept: 1, cost_usd: 0.0015 }));
  });

  test('a flag whose quote neither names the answer nor rules out the other options is dropped; so are backwards and self flags', async () => {
    const complete = jest.fn().mockResolvedValue({
      json: { leaks: [
        { later: 2, earlier: 1, quote: 'سندھ کی ثقافتی خصوصیات' },        // same topic, says nothing about the answer
        { later: 1, earlier: 2, quote: 'پشاوری چپل' },                      // backwards: the child has already answered q1
        { later: 2, earlier: 2, quote: 'پشاوری چپل' },                      // a question and itself
      ] },
      costUsd: 0.001,
    });
    const out = await modelLeakErrors(PAK, { complete });
    expect(out.errors).toEqual([]);
    expect(out).toEqual(expect.objectContaining({ flagged: 3, kept: 0 }));
  });

  test('a failed or unusable call changes nothing', async () => {
    expect((await modelLeakErrors(PAK, { complete: jest.fn().mockRejectedValue(new Error('boom')) })).errors).toEqual([]);
    expect((await modelLeakErrors(PAK, { complete: jest.fn().mockResolvedValue({ json: { nope: 1 } }) })).errors).toEqual([]);
  });
});

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
const gq = ({ slo = 'S1', level = 'recall', question, options }) => ({
  slo_id: slo, level, question, options, correct_index: 0,
  explanation: 'ہر masculine noun کا ایک feminine noun ہوتا ہے۔',
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
const FIXED_Q3 = gq({ question: 'Grandfather کا feminine noun کیا ہے؟', options: ['Grandmother', 'Granddaughter', 'Aunt'] });
const TRANSCRIPT = [...grammar(), FIXED_Q3].map((q) => `استاد: ${moment(q.options[0])}۔`).join('\n').repeat(4);
// The model says q1 (1-based) lets the child eliminate q4's other options.
const MODEL_FLAG = { leaks: [{ later: 4, earlier: 1, quote: 'Boy کا جوڑا Girl ہے' }] };

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

describe('on the generate path, flag on', () => {
  test('a model flag the rewrite fixes: the later question is replaced, all eight kept, the rewrite named both questions', async () => {
    const qs = grammar();
    mockCreate.mockImplementation((call) => {
      if (isLeakPass(call)) return Promise.resolve(reply(MODEL_FLAG));
      if (isRewrite(call)) return Promise.resolve(reply({ questions: [{ index: 3, ...FIXED_Q3 }] }));
      return Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: qs }));
    });
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(rows.some((x) => x.question_text.includes('Grandfather کا feminine noun'))).toBe(true);
    const rw = mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p));
    expect(rw[rw.length - 1]).toMatch(/q0 gives away q3's answer/);
    expect(lastMeta().answer_leaks).toEqual(expect.objectContaining({
      model: expect.objectContaining({ flagged: 1, kept: 1, rewritten: 1, remaining: 0 }), dropped: [],
    }));
  });

  test('a model flag the rewrite cannot fix is NEVER dropped: eight rows ship, the flag counted', async () => {
    const qs = grammar();
    mockCreate.mockImplementation((call) => {
      if (isLeakPass(call)) return Promise.resolve(reply(MODEL_FLAG));
      if (isRewrite(call)) return Promise.resolve(reply({ questions: [{ index: 3, ...qs[3] }] }));   // changes nothing
      return Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: qs }));
    });
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(8);
    const meta = lastMeta();
    expect(meta.answer_leaks).toEqual(expect.objectContaining({ dropped: [], model: expect.objectContaining({ kept: 1, rewritten: 0, remaining: 1 }) }));
    expect((meta.soft_faults || []).filter((e) => /^q3: ANSWER_LEAK — q0 gives away/.test(e))).toHaveLength(1);
  });

  test('flag off: no leak pass is asked at all', async () => {
    const qs = grammar();
    mockCreate.mockImplementation((call) => (isLeakPass(call)
      ? Promise.resolve(reply(MODEL_FLAG))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: qs }))));
    wire({ gates: undefined });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate.mock.calls.filter((c) => isLeakPass(c[0]))).toHaveLength(0);
    expect(storedRows()).toHaveLength(8);
  });
});
