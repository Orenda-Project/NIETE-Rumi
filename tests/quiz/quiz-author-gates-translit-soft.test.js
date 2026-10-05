'use strict';
/**
 * A TRANSLITERATED TERM NAMES ITS QUESTION, AND IS NEVER A REASON TO SEND NOTHING
 * — behind app_settings quiz_author_gates_v2.
 *
 * Measured with the gates on: an Urdu science lesson got NO quiz. All three
 * author attempts wrote «انرجی» (energy, in Urdu letters — as the class said
 * it), and the validator's rule "transliterated English term in Urdu script"
 * is a complaint about the whole SET. A set-level complaint is one the targeted
 * rewrite cannot reach (rewriteTargets returns no repair) and the salvage
 * refuses, so the quiz died as validator_failed over one word.
 *
 * Flag on: the complaint names the question that carries the term
 * ("q2: URDU_TRANSLITERATED — …"), the term is repaired IN PLACE by one
 * targeted rewrite like the other wording faults, and the quiz ships whatever
 * that leaves, the fault counted in meta.soft_faults. Roman Urdu is named the
 * same way. Flag off: the set-level complaint, exactly as today.
 *
 * The LLM is mocked at the network boundary; generate, the validator and the
 * rewrite run for real.
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
const TRANSLIT = (q) => ({ ...q, explanation: 'ہر masculine noun کا ایک feminine noun ہوتا ہے، اس میں انرجی نہیں لگتی۔' });
const UNTRANSLIT = (q) => ({ ...q, explanation: 'ہر masculine noun کا ایک feminine noun ہوتا ہے، اس میں energy نہیں لگتی۔' });
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

describe('the validator', () => {
  test('flag on: the complaint NAMES the question, and no set-level line is left for the repair to trip on', () => {
    const qs = grammar(); qs[2] = TRANSLIT(qs[2]);
    const errs = validate(qs, { ...CTX, authorGates: true }).errors;
    expect(errs.filter((e) => /transliterat|TRANSLITERATED/i.test(e))).toEqual([
      expect.stringMatching(/^q2: URDU_TRANSLITERATED — "انرجی"/),
    ]);
    // …so the targeted rewrite can reach it, and repairs it in place
    const t = Rewrite.rewriteTargets(errs, { partial: 'in_place' });
    expect(t.indices).toEqual([2]);
    const p = Rewrite.buildRewritePrompt({ digest: EN_DIGEST, language: 'ur', questions: qs, targets: t });
    expect(p).toContain('A TERM IN URDU LETTERS — REPAIR IN PLACE');
    expect(p).toMatch(/q2 · .*REPAIR IN PLACE/);
  });

  test('flag on: Roman Urdu is named on the questions that carry it', () => {
    const qs = grammar();
    qs[4] = { ...qs[4], explanation: 'Uncle ek masculine noun hai aur ye yaad rakhna hai' };
    const errs = validate(qs, { ...CTX, authorGates: true }).errors;
    expect(errs.filter((e) => /roman|URDU_ROMAN/i.test(e))).toEqual([expect.stringMatching(/^q4: URDU_ROMAN — /)]);
  });

  test('flag off: exactly today\'s set-level complaints', () => {
    const qs = grammar(); qs[2] = TRANSLIT(qs[2]);
    qs[4] = { ...qs[4], explanation: 'Uncle ek masculine noun hai aur ye yaad rakhna hai' };
    const errs = validate(qs, { ...CTX, authorGates: false }).errors;
    expect(errs).toContain('transliterated English term in Urdu script: انرجی — write it in English letters');
    expect(errs.some((e) => /^roman urdu tokens: /.test(e))).toBe(true);
    expect(errs.some((e) => /URDU_TRANSLITERATED|URDU_ROMAN/.test(e))).toBe(false);
  });
});

describe('on the generate path', () => {
  test('flag on: the model writes «انرجی» on every attempt → ONE in-place repair → the quiz SHIPS 8, the fault counted', async () => {
    const bad = grammar(); bad[2] = TRANSLIT(bad[2]);
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...bad[2] }] }))   // the repair leaves it as it was
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rw = mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p));
    expect(rw).toHaveLength(1);
    expect(rw[0]).toContain('REWRITE THESE QUESTIONS: q2');
    expect(storedRows()).toHaveLength(8);
    expect((lastMeta().soft_faults || []).filter((e) => /^q2: URDU_TRANSLITERATED/.test(e))).toHaveLength(1);
    const events = logEvent.mock.calls.map((c) => c[0]);
    expect(events).not.toContain('transcript_quiz.failed');
  });

  test('flag on: a repair that writes the term in English letters ships clean', async () => {
    const bad = grammar(); bad[2] = TRANSLIT(bad[2]);
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...UNTRANSLIT(grammar()[2]) }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(8);
    expect(JSON.stringify(storedRows())).not.toContain('انرجی');
    expect((lastMeta().soft_faults || []).filter((e) => /TRANSLITERATED/.test(e))).toHaveLength(0);
  });

  test('flag off: the same quiz fails as validator_failed, as today', async () => {
    const bad = grammar(); bad[2] = TRANSLIT(bad[2]);
    mockCreate.mockImplementation(() => Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad })));
    wire({ gates: undefined });
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'validator_failed' }));
  });
});
