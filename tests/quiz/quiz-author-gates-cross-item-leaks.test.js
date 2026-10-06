'use strict';
/**
 * ONE QUESTION GIVING AWAY ANOTHER'S ANSWER — what the first leak check missed
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
const { answerLeakErrors } = require('../../bot/shared/services/quiz/transcript-quiz-answer-leaks');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const mcq = (question, options, { explanation = '', correct = '', wrong = {} } = {}) => ({
  question, options, correct_index: 0, explanation, option_feedback: { correct, wrong },
});

describe('the detector: leaks the first check let through', () => {
  test('a WRONG option\'s feedback states the later answer — both questions are named, with the words', () => {
    const qs = [
      mcq('ایک fraction میں اوپر والے نمبر کو کیا کہتے ہیں؟', ['numerator', 'denominator', 'whole'], {
        wrong: { 1: 'نہیں، denominator نیچے والے نمبر کو کہتے ہیں۔ اوپر والے نمبر کو numerator کہتے ہیں۔' },
      }),
      mcq('ایک fraction میں نیچے والے نمبر کو کیا کہتے ہیں؟', ['Denominator', 'Whole', 'Numerator']),
    ];
    expect(answerLeakErrors(qs)).toEqual([
      expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer «Denominator»: q0's wrong-option feedback says «نہیں، denominator نیچے والے نمبر کو کہتے ہیں۔»/),
    ]);
  });

  test('the earlier question\'s RIGHT option states it, in other words (stores / stores water)', () => {
    const qs = [
      mcq('Which of these is a structural adaptation?', ['Cactus stores water in its thick stem.', 'Birds migrate in winter.', 'A desert fox hunts at night.']),
      mcq("How does the cactus's thick stem help it survive?", ['It stores water.', 'It makes it look pretty.', 'It helps it run faster.']),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away .*q0's correct option says «Cactus stores water/)]);
  });

  test('a sum stated before it is asked (19 − 7 = 12, then "Subtract 7 from 19")', () => {
    const qs = [
      mcq('Bilal says $19 - 7 = 13$. Is this correct?', ['No, $19 - 7 = 12$', 'Yes, $19 - 7 = 13$', 'No, $19 - 7 = 11$']),
      mcq('Subtract 7 from 19. How many remain?', ['12', '19', '7']),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer «12»/)]);
  });

  test('a fraction stated before it is asked ("4/8 is the same as 1/2", then 4 of 8 parts covered)', () => {
    const qs = [
      mcq('Why is $\\frac{4}{8}$ the same as $\\frac{1}{2}$?', ['Because 4 is half of 8', 'Because both are even', 'Because 8 is half of 4']),
      mcq('You fold a strip into 8 equal parts and cover 4 of them. What fraction is covered?', ['$\\frac{1}{2}$', '$\\frac{4}{8}$', '$\\frac{1}{4}$']),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer/)]);
  });

  test('the same stem twice with the key in other words is the same question (Urdu)', () => {
    const qs = [
      mcq("مکالمے میں 'اہم میٹنگ' کا کیا مطلب ہے؟", ['ایک ضروری ملاقات', 'ایک تفریحی ملاقات', 'ایک لمبی ملاقات']),
      mcq("مکالمے میں 'اہم میٹنگ' کا کیا مطلب ہے؟", ['ایک ضروری بات چیت', 'ایک بڑی پارٹی', 'ایک کھیل کا مقابلہ']),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q1 asks word for word what q0 already asks/)]);
  });

  test('a wrong option is read WITH its feedback: «This is a behavioural adaptation» is about the fox it answers', () => {
    const qs = [
      mcq('Which of these is an example of a structural adaptation?', ['A cactus storing water in its thick stem', 'A desert fox hunting at night', 'Birds migrating to Pakistan in winter'], {
        wrong: {
          1: "This is a behavioural adaptation, as it's something the fox DOES. Remember, a structural adaptation is a physical body part.",
          2: "This is a behavioural adaptation, as it's something the bird DOES. Remember, a structural adaptation is a physical body part.",
        },
      }),
      mcq('Which of these is a behavioural adaptation?', ['A desert fox hunting only at night', 'A desert fox having large ears', 'A bird having wings']),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer «A desert fox hunting only at night»: q0's wrong-option feedback/)]);
  });

  test('a key with its English gloss in brackets is stated by either half («ٹرف (trough)»)', () => {
    const qs = [
      mcq('عرضی لہر (transverse wave) میں سب سے اونچے پوائنٹ کو کیا کہتے ہیں؟', ['کرسٹ (crest)', 'ٹرف (trough)', 'مین پوائنٹ (mean point)'], {
        wrong: { 1: 'ٹرف لہر کا سب سے نچلا حصہ ہوتا ہے، سب سے اونچا نہیں۔ سب سے اونچا پوائنٹ کرسٹ کہلاتا ہے۔' },
      }),
      mcq('عرضی لہر کے مین پوائنٹ سے سب سے نچلے پوائنٹ کو کیا کہتے ہیں؟', ['ٹرف (trough)', 'پیک پوائنٹ (peak point)', 'کرسٹ (crest)']),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer «ٹرف \(trough\)»/)]);
  });

  test('a stem that names the later answer in passing order ("between the crust and the outer core") gives it away', () => {
    const qs = [
      mcq('Which layer lies between the crust and the outer core?', ['mantle', 'inner core', 'crust']),
      mcq('Digging down from the crust, which layer comes after the mantle?', ['outer core', 'inner core', 'crust']),
    ];
    expect(answerLeakErrors(qs)).toEqual([expect.stringMatching(/^q1: ANSWER_LEAK — q0 gives away q1's answer «outer core»: q0's question/)]);
  });
});

describe('the detector: what is NOT a leak', () => {
  test('a wrong option is offered, never asserted', () => {
    expect(answerLeakErrors([
      mcq('Which of these is a behavioural adaptation?', ['Birds migrate in winter', 'Thick fur keeps a fox warm', 'Long legs']),
      mcq('What keeps a desert fox warm at night?', ['Thick fur', 'Sharp teeth', 'A long tail']),
    ])).toEqual([]);
  });

  test('bare number options, a place named in passing, a comparison the stem offers, a list of every option', () => {
    expect(answerLeakErrors([
      mcq('How many syllables are in the word "living"?', ['2', '1', '3']),
      mcq('How many syllables are in the word "famous"?', ['2', '1', '3']),
    ])).toEqual([]);
    expect(answerLeakErrors([
      mcq('سندھ کی کون سی چیز مشہور ہے؟', ['اجرک', 'خشک میوہ', 'پنجابی کرتا'], { wrong: { 2: 'یہ پنجابی کرتا ہے جو پنجاب کی ثقافتی چیز ہے۔' } }),
      mcq('پنجاب میں کون سی مادری زبان بولی جاتی ہے؟', ['پنجابی', 'سندھی', 'بلوچی']),
    ])).toEqual([]);
    expect(answerLeakErrors([
      mcq('When you cross-multiply $\\frac{3}{4}$ and $\\frac{2}{5}$, what are the two products?', ['15 and 8', '12 and 10', '6 and 20']),
      mcq('Which is bigger: $\\frac{3}{4}$ or $\\frac{2}{5}$?', ['$\\frac{3}{4}$', '$\\frac{2}{5}$', 'They are equal']),
    ])).toEqual([]);
    expect(answerLeakErrors([
      mcq('Which layer is at the centre of the Earth?', ['inner core', 'crust', 'mantle'], {
        explanation: 'From the outside in: crust, then mantle, then outer core, then inner core.',
      }),
      mcq('Which layer comes right after the crust?', ['mantle', 'outer core', 'inner core']),
    ])).toEqual([]);
  });

  test('one stem over two different sounds ("Tap the air word.") is two questions', () => {
    expect(answerLeakErrors([
      mcq("Tap the 'air' word.", ['stair', 'star', 'stay']),
      mcq("Tap the 'air' word.", ['chair', 'cheer', 'chain']),
    ])).toEqual([]);
  });
});

describe('the recorded faults once leaks are settled', () => {
  const { settleLeakFaults } = require('../../bot/shared/services/quiz/transcript-quiz-answer-leaks');
  test('an old ANSWER_LEAK line goes, a dropped question\'s lines go, the rest are renumbered, what still leaks is added', () => {
    expect(settleLeakFaults([
      'q2: ANSWER_LEAK — q0 gives away q2\'s answer «x»',
      'q3: PEDAGOGY_GENDERED_TEACHER — …',
      'q5: META_STEM — …',
      'SLOs uncovered: S2',
    ], [3], ['q4: ANSWER_LEAK — q1 gives away q4\'s answer «y»'])).toEqual([
      'q4: META_STEM — …', 'SLOs uncovered: S2', 'q4: ANSWER_LEAK — q1 gives away q4\'s answer «y»',
    ]);
  });
});

describe('an aside that gives the answer away is taken out of the earlier question, not the later question', () => {
  const { trimLeakAsides } = require('../../bot/shared/services/quiz/transcript-quiz-answer-leaks');
  test('a wrong option\'s feedback loses only the sentence that states the later answer', () => {
    const qs = [
      mcq('Which of these is a structural adaptation?', ['Cactus stores water in its thick stem.', 'Birds migrate in winter.', 'A desert fox hunts at night.'], {
        wrong: { 1: 'Birds migrating is something they DO, not a body part they HAVE. Remember, structural adaptations are about the body.', 2: 'A desert fox hunting at night is an action, a behaviour. It is not a part of its body, so it is not structural.' },
      }),
      mcq('Which of these is a behavioural adaptation of a desert fox?', ['Hunting only at night', 'Thick fur', 'Sharp teeth']),
    ];
    const out = trimLeakAsides(qs);
    expect(out.trimmed).toEqual([expect.objectContaining({ from: 0, to: 1, where: 'wrong-option feedback' })]);
    expect(out.questions[0].option_feedback.wrong[2]).toBe('It is not a part of its body, so it is not structural.');
    expect(out.questions[1]).toBe(qs[1]);
    expect(answerLeakErrors(out.questions)).toEqual([]);
  });

  test('never the sentence that explains the earlier question\'s OWN answer, never a field left with nothing to say', () => {
    const own = [
      mcq('Which of these is a layer of the Earth?', ['crust', 'sky', 'ocean'], { explanation: 'The Earth has four main layers. The crust is the outermost layer.' }),
      mcq('What is the outermost layer of the Earth called?', ['crust', 'core', 'mantle']),
    ];
    expect(trimLeakAsides(own).trimmed).toEqual([]);
    const only = [
      mcq('ایک fraction میں اوپر والے نمبر کو کیا کہتے ہیں؟', ['numerator', 'denominator', 'whole'], { wrong: { 1: 'نہیں، denominator نیچے والے نمبر کو کہتے ہیں۔' } }),
      mcq('ایک fraction میں نیچے والے نمبر کو کیا کہتے ہیں؟', ['Denominator', 'Whole', 'Numerator']),
    ];
    expect(trimLeakAsides(only).trimmed).toEqual([]);
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
/** A lesson line no question quotes: what the last leak rewrite should be offered to copy. */
const UNUSED_LINE = 'آج ہم نے Nephew اور Niece کے جوڑے پر بھی بات کی۔';
const TRANSCRIPT = `${[...grammar(), FIXED_Q2].map((q) => `استاد: ${moment(q.options[0])}۔`).join('\n')}\nاستاد: ${UNUSED_LINE}\n`.repeat(4);

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

describe('on the generate path, flag on: repair, else drop within the floor, never kill the quiz', () => {
  test('a leak no rewrite fixes: the LATER question is DROPPED (8 -> 7), recorded; the quiz ships', async () => {
    const bad = leaky();
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...bad[2] }] }))   // every repair changes nothing
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = storedRows();
    expect(rows).toHaveLength(7);
    expect(rows.some((x) => x.question_text.includes('Father کا feminine noun'))).toBe(false);
    const meta = lastMeta();
    expect(meta.answer_leaks).toEqual(expect.objectContaining({ found: 1, dropped: [2], remaining: 0 }));
    expect((meta.soft_faults || []).filter((e) => /ANSWER_LEAK/.test(e))).toEqual([]);
    // the last rewrite named BOTH questions
    const rw = mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p));
    expect(rw[rw.length - 1]).toMatch(/q0 gives away q2's answer/);
    expect(logEvent.mock.calls.map((c) => c[0])).toContain('transcript_quiz.answer_leaks');
  });

  test('the last leak rewrite is shown lesson lines no question uses yet, so its new question can quote the lesson', async () => {
    const bad = leaky();
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...bad[2] }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire({ gates: true });
    await Gen.process(QID, {});
    const rw = mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p));
    const last = rw[rw.length - 1];
    expect(last).toMatch(/q0 gives away q2's answer/);
    // the transcript line no question quotes yet, offered to copy word for word
    expect(last).toContain('these moments are not used yet:');
    expect(last).toContain(UNUSED_LINE);
  });

  test('an aside in an earlier explanation is taken out: all eight questions kept, no extra rewrite', async () => {
    const bad = grammar();
    bad[0] = { ...bad[0], explanation: 'ہر masculine noun کا ایک feminine noun ہوتا ہے۔ جیسے Father کا feminine noun Mother ہے۔' };
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...bad[2] }] }))   // the loop's repair changes nothing
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(rows.some((x) => String(x.explanation).includes('Father کا feminine noun Mother'))).toBe(false);
    expect(lastMeta().answer_leaks).toEqual(expect.objectContaining({ found: 1, trimmed: 1, dropped: [], remaining: 0 }));
    // the loop asked once; the last step needed no model call
    expect(mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p))).toHaveLength(1);
  });

  test('a leak the LAST rewrite fixes keeps all eight questions', async () => {
    const bad = leaky();
    let rewrites = 0;
    mockCreate.mockImplementation((call) => {
      if (!isRewrite(call)) return Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }));
      rewrites += 1;
      // the loop's repair changes nothing; the final one writes another fact
      return Promise.resolve(reply({ questions: [{ index: 2, ...(rewrites > 1 ? FIXED_Q2 : bad[2]) }] }));
    });
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(8);
    expect(storedRows().some((x) => x.question_text.includes('Grandfather کا feminine noun'))).toBe(true);
    expect(lastMeta().answer_leaks).toEqual(expect.objectContaining({ found: 1, fixed: 1, dropped: [], remaining: 0 }));
  });

  test('at the floor (six questions) the leak is shipped and counted, never dropped', async () => {
    const bad = leaky().slice(0, 6);
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...bad[2] }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(6);
    expect(lastMeta().answer_leaks).toEqual(expect.objectContaining({ found: 1, dropped: [], remaining: 1 }));
    expect((lastMeta().soft_faults || []).filter((e) => /^q2: ANSWER_LEAK/.test(e))).toHaveLength(1);
  });

  test('a leak the loop named that is gone from what ships is not recorded as shipped', async () => {
    const bad = leaky();
    let rewrites = 0;
    mockCreate.mockImplementation((call) => {
      if (!isRewrite(call)) return Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }));
      rewrites += 1;
      return Promise.resolve(reply({ questions: [{ index: 2, ...(rewrites > 1 ? FIXED_Q2 : bad[2]) }] }));
    });
    wire({ gates: true });
    await Gen.process(QID, {});
    expect((lastMeta().soft_faults || []).filter((e) => /ANSWER_LEAK/.test(e))).toEqual([]);
  });

  test('flag off: no leak step at all — eight rows, no record', async () => {
    const bad = leaky();
    mockCreate.mockImplementation(() => Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad })));
    wire({ gates: undefined });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(8);
    expect(lastMeta().answer_leaks).toBeUndefined();
    expect(mockCreate.mock.calls.map(promptOf).filter((p) => /REWRITE THESE QUESTIONS/.test(p))).toHaveLength(0);
  });
});
