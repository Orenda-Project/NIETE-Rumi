'use strict';
/**
 * ANSWER LEAKS BETWEEN QUESTIONS — behind app_settings quiz_author_gates_v2.
 *
 * The red team's re-score (5 Oct 2026, ten real sources, scored blind) found
 * one question giving away another's answer in every transcript quiz: an earlier
 * stem asks "Why is Urdu called the national language?" and a later one asks
 * "Which is the national language?"; an earlier explanation says "a sentence
 * ends with a full stop" and the next question asks what ends a sentence. Every
 * check looked at one question at a time, so none could see it.
 *
 * Flag on: the LATER question is named (qN: ANSWER_LEAK), when an earlier
 * question's stem or explanation states its answer, names none of its wrong
 * options, and shares a topic word with it beyond the answer. It is repaired by
 * the targeted rewrite (a new question for that slot) and the quiz ships
 * whatever that leaves, the fault counted. A category named in passing ("a
 * structural adaptation") is not a leak; nor is a maths expression.
 * Flag off: nothing changes.
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
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const GatesV2 = require('../../bot/shared/services/quiz/quiz-author-gates-v2');
const { answerLeakErrors } = require('../../bot/shared/services/quiz/transcript-quiz-answer-leaks');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = '66666666-6666-4666-8666-666666666666';
const SID = '55555555-5555-4555-8555-555555555555';

// An English-grammar lesson quizzed in Urdu, grade 7 (no picture is demanded).
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
/** The moment of the lesson each question's answer comes from. */
const moment = (key) => `${key} کا جوڑا ہم نے کلاس میں یاد کیا`;
const gq = ({ slo = 'S1', level = 'recall', question, options, explanation, correct, wrong }) => ({
  slo_id: slo, level, question, options, correct_index: 0,
  explanation: explanation || 'ہر masculine noun کا ایک feminine noun ہوتا ہے۔',
  selected_because: 'سبق میں جوڑوں کی مثالیں دی گئیں',
  distractor_misconceptions: { 1: 'جوڑا الٹ سمجھنا', 2: 'کوئی اور رشتہ چن لینا' },
  option_feedback: { correct: correct || 'بالکل درست!', wrong: wrong || { 1: 'یہ اس کا جوڑا نہیں ہے۔', 2: 'یہ بھی اس کا جوڑا نہیں ہے۔' } },
  source_quote: moment(options[0]), teaching_error: null,
});
function grammar() {
  return [
    gq({ question: 'Brother کا feminine noun کیا ہے؟', options: ['Sister', 'Mother', 'Uncle'], correct: 'شاباش! Brother کے ساتھ جوڑا Sister کا ہے۔' }),
    gq({ question: 'King کا feminine noun کیا ہے؟', options: ['Queen', 'Princess', 'Aunt'], correct: 'درست! King کے ساتھ جوڑا Queen کا ہے۔' }),
    gq({ question: 'Father کا feminine noun کیا ہے؟', options: ['Mother', 'Sister', 'Daughter'] }),
    gq({ question: 'Boy کا feminine noun کیا ہے؟', options: ['Girl', 'Woman', 'Lady'] }),
    gq({ slo: 'S2', level: 'understand', question: 'ان میں سے کون سا masculine noun ہے؟', options: ['Uncle', 'Aunt', 'Niece'] }),
    gq({ slo: 'S2', level: 'understand', question: 'ان میں سے کون سا feminine noun ہے؟', options: ['Niece', 'Nephew', 'Uncle'] }),
    gq({ slo: 'S2', level: 'understand', question: 'لفظ Son کس قسم کا noun ہے؟', options: ['masculine noun', 'feminine noun', 'دونوں'] }),
    gq({ slo: 'S2', level: 'understand', question: 'لفظ Daughter کس قسم کا noun ہے؟', options: ['feminine noun', 'masculine noun', 'دونوں'] }),
  ];
}
const TRANSCRIPT = grammar().map((q) => `استاد: ${moment(q.options[0])}۔`).join('\n').repeat(4);
/** The term the class said in Urdu letters, in one question's explanation. */
/** q0's explanation states q2's answer (Father → Mother), naming none of q2's wrong options. */
const LEAKS_Q2 = (q) => ({ ...q, explanation: 'ہر masculine noun کا ایک feminine noun ہوتا ہے، جیسے Father کا جوڑا Mother ہے۔' });
const CTX = { language: 'ur', subject: 'english', digest: EN_DIGEST, nExpected: 8, lessonSummary: EN_SUMMARY };

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

const mcq = (question, options, explanation = '') => ({ question, options, correct_index: 0, explanation, option_feedback: { correct: '', wrong: {} } });

describe('the detector', () => {
  test('an earlier explanation that states a later answer: the LATER question is named, with the earlier one', () => {
    const qs = [
      mcq('What does every sentence start with?', ['a capital letter', 'a comma', 'a number'], 'A sentence always starts with a capital letter and ends with a full stop.'),
      mcq('What comes at the end of a sentence?', ['a full stop', 'a comma', 'a question word'], 'A sentence ends with a full stop.'),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer «a full stop».*q0's explanation/)]);
  });

  test('an earlier STEM that states a later answer (Urdu)', () => {
    const qs = [
      mcq('اردو کو قومی زبان کیوں کہا جاتا ہے؟', ['یہ سب کو جوڑتی ہے', 'یہ سب سے پرانی ہے', 'یہ صرف ایک شہر میں بولی جاتی ہے']),
      mcq('پاکستان کی قومی زبان کون سی ہے؟', ['اردو', 'انگریزی', 'پنجابی']),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer «اردو».*q0's question/)]);
  });

  test('a LATER question cannot leak to an earlier one: the child has already answered it', () => {
    const qs = [
      mcq('پاکستان کی قومی زبان کون سی ہے؟', ['اردو', 'انگریزی', 'پنجابی']),
      mcq('اردو کو قومی زبان کیوں کہا جاتا ہے؟', ['یہ سب کو جوڑتی ہے', 'یہ سب سے پرانی ہے', 'یہ صرف ایک شہر میں بولی جاتی ہے']),
    ];
    expect(answerLeakErrors(qs)).toEqual([]);
  });

  test('a category named in passing is not a leak: "Which of these is a structural adaptation?" before "desert fox ears: which type?"', () => {
    const qs = [
      mcq('Which of these is a structural adaptation?', ['A cactus storing water in its stem', 'Birds flying south', 'A bear sleeping in winter']),
      mcq('A desert fox has large ears to lose heat. Which type of adaptation is this?', ['structural adaptation', 'behavioural adaptation', 'no adaptation']),
    ];
    expect(answerLeakErrors(qs)).toEqual([]);
  });

  test('a stem that offers the choice itself, a source that names a wrong option too, and a maths answer are left alone', () => {
    // (a stem that names the later answer in passing — "between the crust and the outer core" before
    // "which layer comes after the mantle?" — IS a give-away: the blind re-score counted it; see
    // quiz-author-gates-cross-item-leaks.test.js)
    expect(answerLeakErrors([
      mcq('A cheetah has long legs to run fast. Is this a structural or behavioural adaptation?', ['structural adaptation', 'behavioural adaptation', 'neither']),
      mcq('Birds fly south in winter. Is this a structural or behavioural adaptation?', ['behavioural adaptation', 'structural adaptation', 'neither']),
    ])).toEqual([]);
    expect(answerLeakErrors([
      mcq('Which layer is at the centre of the Earth?', ['inner core', 'crust', 'mantle'], 'From the outside in: crust, then mantle, then outer core, then inner core.'),
      mcq('Which layer comes right after the crust?', ['mantle', 'outer core', 'inner core']),
    ])).toEqual([]);
    expect(answerLeakErrors([
      mcq('In the fraction $\\frac{2}{7}$, which number is the numerator?', ['2', '7', '9']),
      mcq('Which fraction is shaded in the picture of seven parts?', ['$\\frac{2}{7}$', '$\\frac{5}{7}$', '$\\frac{2}{5}$']),
    ])).toEqual([]);
  });
});

describe('repair priority', () => {
  test('beside five hard faults, the give-away is the one left for a second batch — never a hard fault', () => {
    // the give-away sits at q1, BEFORE the hard faults, so only the tier can push it out
    const errs = ['q1: ANSWER_LEAK — its answer "x" is already given by q0\'s question'].concat([2, 3, 4, 5, 6].map((i) => `q${i}: duplicate options`));
    const t = Rewrite.rewriteTargets(errs, { partial: true });
    expect(t.indices).toEqual([2, 3, 4, 5, 6]);
    expect(t.deferred).toEqual([1]);
  });
});

describe('the validator', () => {
  test('flag on: the leak is a named complaint; flag off: nothing', () => {
    const qs = grammar(); qs[0] = LEAKS_Q2(qs[0]);
    expect(validate(qs, { ...CTX, authorGates: true }).errors.filter((e) => /ANSWER_LEAK/.test(e)))
      .toEqual([expect.stringMatching(/^q2: ANSWER_LEAK — q0 gives away q2's answer «Mother».*q0's explanation/)]);
    expect(validate(qs, { ...CTX, authorGates: false }).errors.filter((e) => /ANSWER_LEAK/.test(e))).toEqual([]);
  });
});

describe('on the generate path, flag on', () => {
  test('the targeted rewrite carries the rule; a leak no repair fixes is DROPPED within the floor and the quiz ships', async () => {
    const bad = grammar(); bad[0] = LEAKS_Q2(bad[0]);
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...bad[2] }] }))   // the repair changes nothing
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rw = mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p));
    // the loop's repair, then the last one on what ships
    expect(rw).toHaveLength(2);
    expect(rw[0]).toContain('REWRITE THESE QUESTIONS: q2');
    expect(rw[0]).toContain('GIVEN AWAY BY ANOTHER QUESTION');
    expect(storedRows()).toHaveLength(7);
    expect((lastMeta().soft_faults || []).filter((e) => /ANSWER_LEAK/.test(e))).toHaveLength(0);
    expect(lastMeta().answer_leaks).toEqual(expect.objectContaining({ found: 1, dropped: [2], remaining: 0 }));
    expect(logEvent.mock.calls.map((c) => c[0])).not.toContain('transcript_quiz.failed');
  });

  test('flag off: the same quiz ships as today, with no rewrite for it', async () => {
    const bad = grammar(); bad[0] = LEAKS_Q2(bad[0]);
    mockCreate.mockImplementation(() => Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad })));
    wire({ gates: undefined });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p))).toHaveLength(0);
    expect(storedRows()).toHaveLength(8);
  });
});
