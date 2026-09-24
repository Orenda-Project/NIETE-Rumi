'use strict';
/**
 * The blind solver names the questions that ask the same fact in other words.
 *
 * The word-for-word repeat check catches a question asked twice with the same
 * words; it cannot see "What is formed in a physical change?" beside "What is
 * true about a physical change?", both answered "No new substance is formed."
 * — the kind of repeat most of the missed ones are. The blind solve already
 * reads every item of the quiz in ONE call and works out every answer itself,
 * so the same call is asked, at no extra cost, which questions test the same
 * fact with the same answer ("same_fact").
 *
 * A pair it names is held to that contract in CODE before anything acts on it
 * (the same answer — as written or without a trailing Urdu postposition — and
 * the same numbers and quoted items, i.e. not one template on another item).
 * A confirmed pair goes to the existing repeat repair: the later question is
 * rewritten by the one targeted rewrite the blind solve already makes, and a
 * rewrite that does not take ships the quiz with the repeat recorded — never a
 * refusal, never a dropped question. A pair that fails the contract is only
 * logged.
 *
 * Only the network is stubbed (the LLM client, Supabase, WhatsApp, the queue,
 * R2): the solver prompt, its parse, the generate step and the rewrite run.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Teacher', topic: 'Changes' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
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
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const KV = require('../../bot/shared/services/quiz/transcript-quiz-key-verify.service');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ASKS_SAME_FACT = /"same_fact"/;

// ── an English science quiz with one reworded repeat (q2 / q6) ───────────────
const SCI = {
  topic: 'Physical and chemical changes', topic_as_taught: 'Physical and chemical changes', subject: 'science',
  grade_band: '6-8', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'tell a physical change from a chemical change', statement_en: 'tell a physical change from a chemical change', taught_level: 'understand' },
    { id: 'S2', statement: 'give signs of a chemical change', statement_en: 'give signs of a chemical change', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'physical change' }, { term: 'chemical change' }], examples_used: ['melting ice', 'burning paper'], misconceptions_surfaced: [],
};
const SCI_SUMMARY = 'You taught the difference between physical and chemical changes, using melting ice and burning paper.';
const sq = ({ slo = 'S1', level = 'understand', question, options }) => ({
  slo_id: slo, level, question, options, correct_index: 0,
  explanation: 'In a physical change the substance stays the same substance.',
  selected_because: 'the class sorted everyday changes into physical and chemical',
  distractor_misconceptions: { 1: 'thinks every change makes something new', 2: 'confuses a change of shape with a new substance' },
  option_feedback: { correct: 'Well done!', wrong: { 1: 'Think about whether a new substance was made.', 2: 'Look again at what changed.' } },
});
function science() {
  return [
    sq({ question: 'Which of these is a physical change?', options: ['Melting ice', 'Burning paper', 'Rusting iron'] }),
    sq({ question: 'Which of these is a chemical change?', options: ['Burning wood', 'Cutting paper', 'Melting butter'] }),
    sq({ question: 'What is formed in a physical change?', options: ['No new substance is formed.', 'A different form of the same substance is formed.', 'A completely new substance is formed.'] }),
    sq({ question: 'What happens to the particles of ice when it melts?', options: ['They move more freely', 'They disappear', 'They turn into new particles'] }),
    sq({ slo: 'S2', question: 'Which sign shows that a chemical change has happened?', options: ['A new colour or gas appears', 'The shape changes', 'The size changes'] }),
    sq({ question: 'Can melted chocolate become solid again?', options: ['Yes, by cooling it', 'No, never', 'Only by adding water'] }),
    // the same fact as q2, in other words
    sq({ question: 'What is true about a physical change?', options: ['No new substance is formed.', 'It cannot be reversed.', 'A new substance is always formed.'] }),
    sq({ slo: 'S2', question: 'Why is cooking an egg a chemical change?', options: ['A new substance is formed', 'It gets hot', 'It changes shape'] }),
  ];
}
const SCI_REPLACEMENT = sq({ question: 'Which of these is a sign of a physical change?', options: ['Only the shape changes', 'A new gas is made', 'A new colour appears'] });

// ── the live Urdu pair: a blank and a question on one fact (q3 / q7) ─────────
const TALE = {
  topic: 'نوری جام تماچی', topic_as_taught: 'نوری جام تماچی', subject: 'urdu', grade_band: '3-5', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'کہانی کے کرداروں اور واقعات کو پہچاننا', statement_en: 'recognise the characters and events of the story', taught_level: 'understand' },
    { id: 'S2', statement: 'کہانی کا سبق سمجھنا', statement_en: 'understand the lesson of the story', taught_level: 'understand' },
  ],
  key_terms: [], examples_used: [], misconceptions_surfaced: [],
};
const TALE_SUMMARY = 'آج کے سبق میں نوری اور جام تماچی کی کہانی پڑھی گئی اور اس کا سبق سمجھا گیا۔';
const uq = ({ slo = 'S1', level = 'recall', question, options }) => ({
  slo_id: slo, level, question, options, correct_index: 0,
  selected_because: 'کہانی کے اس حصے پر کلاس میں بات ہوئی',
  distractor_misconceptions: { 1: 'کہانی کا دوسرا واقعہ یاد رکھنا', 2: 'کرداروں کو آپس میں ملا دینا' },
  explanation: 'کہانی میں یہی بات بتائی گئی ہے۔',
  option_feedback: { correct: 'بالکل درست! کہانی میں یہی ہوا۔', wrong: { 1: 'کہانی دوبارہ یاد کریں، یہ بات نہیں ہوئی۔', 2: 'یہ کسی اور حصے کی بات ہے۔' } },
});
function tale() {
  return [
    uq({ question: 'نوری کا تعلق کس برادری سے تھا؟', options: ['مچھیروں کی برادری', 'کسانوں کی برادری', 'تاجروں کی برادری'] }),
    uq({ level: 'understand', question: 'جام تماچی کون تھا؟', options: ['ایک بادشاہ', 'ایک مچھیرا', 'ایک سپاہی'] }),
    uq({ question: 'جام تماچی نے نوری کو پہلی بار کہاں دیکھا؟', options: ['جھیل کے کنارے', 'بازار کے بیچ', 'محل کے اندر'] }),
    uq({ question: 'جام تماچی نے نوری سے شادی کی اور مچھیروں کو __________ سے نوازا۔', options: ['انعام و اکرام', 'سخت سزا', 'نئی کشتیوں'] }),
    uq({ slo: 'S2', level: 'understand', question: 'نوری کی کون سی خوبی جام تماچی کو سب سے زیادہ پسند آئی؟', options: ['سادگی', 'دولت', 'غرور'] }),
    uq({ slo: 'S2', level: 'understand', question: 'اس کہانی سے کیا سبق ملتا ہے؟', options: ['سادگی اور عاجزی کی قدر ہوتی ہے', 'دولت سب سے اہم ہوتی ہے', 'غرور اچھی عادت ہے'] }),
    uq({ level: 'understand', question: 'محل میں رہ کر بھی نوری کیسے کپڑے پہنتی تھی؟', options: ['سادہ کپڑے', 'ریشمی کپڑے', 'سنہری کپڑے'] }),
    uq({ question: 'جام تماچی نے نوری سے شادی کے بعد مچھیروں کو کس چیز سے نوازا؟', options: ['انعام و اکرام سے', 'سخت سزا سے', 'بھاری ٹیکس سے'] }),
  ];
}
const TALE_REPLACEMENT = uq({ question: 'جام تماچی نے نوری کے لیے جھیل پر کیا بنوایا؟', options: ['ایک محل', 'ایک پل', 'ایک مسجد'] });

// ── the model, at the network boundary ───────────────────────────────────────
function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const textOf = (call) => (call.messages || []).map((m) => String(m.content || '')).join('\n');
const isSolve = (t) => /You are SOLVING a short quiz/.test(t);
const isRewrite = (t) => /REWRITE THESE QUESTIONS/.test(t);
const clean = (s) => String(s ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim();
/**
 * A solver that agrees with every key: it reads each item and its shown options
 * from the prompt, and answers with the shown position of the keyed option.
 */
function agreeingAnswers(prompt, known) {
  const answers = [];
  const re = /^q(\d+) \([^)]*\): (.*)\n {2}options: (.*)$/gm;
  let m;
  while ((m = re.exec(prompt))) {
    const q = known.find((x) => clean(x.question) === clean(m[2]));
    const shown = m[3].split(' | ').map((s) => clean(s.replace(/^\[\d+\] /, '')));
    answers.push({ index: Number(m[1]), correct: q ? [shown.indexOf(clean(q.options[q.correct_index]))] : [], unsure: !q, note: '' });
  }
  return answers;
}
/**
 * `authored` is what the author writes; `rewrites` answers each rewrite call in
 * turn; `sameFact` is what the first full solve names.
 */
function drive({ authored, summary, rewrites = [], sameFact = null, disagreeOn = null }) {
  const known = [...authored, ...rewrites.flatMap((r) => (r ? r.map((x) => x.q) : []))];
  let rewriteCalls = 0;
  mockCreate.mockImplementation((call) => {
    const t = textOf(call);
    if (isSolve(t)) {
      const body = { answers: agreeingAnswers(t, known) };
      // a solver that answers one ORIGINAL item differently: its key is not true
      if (disagreeOn) {
        body.answers = body.answers.map((a) => {
          const m = new RegExp(`^q${a.index} \\([^)]*\\): (.*)$`, 'm').exec(t);
          if (!m || clean(m[1]) !== clean(disagreeOn.question)) return a;
          const opts = new RegExp(`^q${a.index} [^\\n]*\\n {2}options: (.*)$`, 'm').exec(t)[1].split(' | ').map((x) => clean(x.replace(/^\[\d+\] /, '')));
          return { ...a, correct: [opts.indexOf(clean(disagreeOn.answer))], note: 'the other option is right' };
        });
      }
      if (ASKS_SAME_FACT.test(t) && sameFact) body.same_fact = sameFact;
      return Promise.resolve(reply(body));
    }
    if (isRewrite(t)) {
      const r = rewrites[rewriteCalls];
      rewriteCalls += 1;
      return Promise.resolve(reply({ questions: (r || []).map((x) => ({ index: x.index, ...x.q })) }));
    }
    return Promise.resolve(reply({ lesson_summary: summary, questions: authored }));
  });
}
function wire(digest, language) {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: digest.topic, subject: digest.subject, language, status: 'generating', meta: { digest, grade: digest.grade_band === '3-5' ? '4' : '7', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: language, created_at: '2026-09-24T04:00:00Z', analysis_data: {}, users: { phone_number: '923000000000', preferred_language: language, name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923000000000', preferred_language: language }] },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const lastMeta = () => {
  const ups = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]).filter((u) => u.meta);
  return ups.length ? ups[ups.length - 1].meta : {};
};
const calls = () => mockCreate.mock.calls.map((c) => textOf(c[0]));
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('the fixtures', () => {
  test('the science quiz is valid and its reworded pair is NOT a word-for-word repeat', () => {
    expect(validate(science(), { language: 'en', subject: 'science', digest: SCI, nExpected: 8, lessonSummary: SCI_SUMMARY }).errors).toEqual([]);
  });
});

describe('the solver is asked, once, in the call it already makes', () => {
  const items = () => science().map((q, i) => KV.itemFor(q, i, QID));
  test('the full solve with the lesson asks for "same_fact"; the solve without the lesson and a re-solve do not', () => {
    expect(KV.buildVerifyPrompt({ items: items(), language: 'en', digest: SCI, lessonSummary: SCI_SUMMARY, askSameFact: true })).toMatch(ASKS_SAME_FACT);
    expect(KV.buildVerifyPrompt({ items: items(), language: 'en', withLesson: false })).not.toMatch(ASKS_SAME_FACT);
    expect(KV.buildVerifyPrompt({ items: items().slice(6), language: 'en', digest: SCI, lessonSummary: SCI_SUMMARY })).not.toMatch(ASKS_SAME_FACT);
  });

  test('verifyKeys returns the pairs it named, held to their shape: two different items it was shown, earlier first, once', async () => {
    drive({ authored: science(), summary: SCI_SUMMARY, sameFact: [[6, 2], [2, 6], [3, 3], [1], [2, 9], ['a', 'b'], [0, 1]] });
    const out = await KV.verifyKeys({ questions: science(), language: 'en', digest: SCI, lessonSummary: SCI_SUMMARY, quizId: QID });
    expect(out.sameFact).toEqual([[0, 1], [2, 6]]);
    expect(out.verdicts.every((v) => v.verdict === 'agree')).toBe(true);
  });

  test('a reply without "same_fact" is still a good solve, with no pairs', async () => {
    drive({ authored: science(), summary: SCI_SUMMARY });
    const out = await KV.verifyKeys({ questions: science(), language: 'en', digest: SCI, lessonSummary: SCI_SUMMARY, quizId: QID });
    expect(out.sameFact).toEqual([]);
    expect(out.verdicts).toHaveLength(8);
  });
});

describe('on the generate path', () => {
  test('a reworded repeat the solver names is rewritten, and the quiz ships 8 different questions', async () => {
    drive({ authored: science(), summary: SCI_SUMMARY, sameFact: [[2, 6]], rewrites: [[{ index: 6, q: SCI_REPLACEMENT }]] });
    wire(SCI, 'en');
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rw = calls().filter(isRewrite);
    expect(rw).toHaveLength(1);
    expect(rw[0]).toContain('REWRITE THESE QUESTIONS: q6');
    expect(rw[0]).toMatch(/q6: DUPLICATE_QUESTION — .*q2/);
    expect(rw[0]).toContain('ASKED TWICE');
    const stems = storedRows().map((x) => x.question_text);
    expect(stems).toHaveLength(8);
    expect(stems).toContain('Which of these is a sign of a physical change?');
    expect(stems).not.toContain('What is true about a physical change?');
    expect(events('transcript_quiz.duplicate_question')).toContainEqual(expect.objectContaining({ stage: 'solver', confirmed: [[2, 6]], unconfirmed: [] }));
    expect(lastMeta().key_verify.same_fact).toEqual(expect.objectContaining({ confirmed: [[2, 6]], fixed: [6] }));
  });

  test('a pair that fails the contract — another answer — is only logged, never rewritten', async () => {
    drive({ authored: science(), summary: SCI_SUMMARY, sameFact: [[0, 1]] });
    wire(SCI, 'en');
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(calls().filter(isRewrite)).toHaveLength(0);
    expect(storedRows().map((x) => x.question_text)).toEqual(science().map((q) => q.question));
    expect(events('transcript_quiz.duplicate_question')).toContainEqual(expect.objectContaining({ stage: 'solver', confirmed: [], unconfirmed: [[0, 1]] }));
  });

  test('a rewrite that does not take ships the quiz whole, the repeat recorded — never a refusal, never a dropped question', async () => {
    drive({ authored: science(), summary: SCI_SUMMARY, sameFact: [[2, 6]], rewrites: [[]] });
    wire(SCI, 'en');
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(8);
    expect((lastMeta().soft_faults || []).filter((e) => /^q6: DUPLICATE_QUESTION/.test(e))).toHaveLength(1);
    expect(logEvent.mock.calls.map((c) => c[0])).not.toContain('transcript_quiz.failed');
  });

  test('a key that is not true and a repeat go to the ONE rewrite together; only the key is solved again', async () => {
    const KEY_FIX = sq({ slo: 'S2', question: 'Which of these shows that a new substance was made?', options: ['A new smell or gas', 'A change of shape', 'A change of size'] });
    drive({
      authored: science(), summary: SCI_SUMMARY, sameFact: [[2, 6]],
      disagreeOn: { question: science()[4].question, answer: 'The shape changes' },
      rewrites: [[{ index: 4, q: KEY_FIX }, { index: 6, q: SCI_REPLACEMENT }]],
    });
    wire(SCI, 'en');
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rw = calls().filter(isRewrite);
    expect(rw).toHaveLength(1);
    expect(rw[0]).toContain('REWRITE THESE QUESTIONS: q4, q6');
    expect(rw[0]).toMatch(/q4: KEY_DISAGREEMENT/);
    expect(rw[0]).toMatch(/q6: DUPLICATE_QUESTION/);
    // the re-solve after the rewrite is of the key item alone
    const resolves = calls().filter(isSolve).filter((t) => !ASKS_SAME_FACT.test(t) && /^q4 /m.test(t) && !/^q0 /m.test(t));
    expect(resolves.length).toBeGreaterThan(0);
    resolves.forEach((t) => expect(t).not.toMatch(/^q6 /m));
    const stems = storedRows().map((x) => x.question_text);
    expect(stems).toEqual(expect.arrayContaining([KEY_FIX.question, SCI_REPLACEMENT.question]));
    expect(lastMeta().key_verify).toEqual(expect.objectContaining({ status: 'fixed', fixed: 1 }));
    expect(lastMeta().key_verify.same_fact).toEqual(expect.objectContaining({ fixed: [6], shipped: [] }));
  });

  test('the live Urdu pair: when the word-for-word repair does not take, the solver gets it a second repair', async () => {
    // the in-place rewrite writes the copy again; the rewrite after the solve replaces it
    drive({
      authored: tale(), summary: TALE_SUMMARY, sameFact: [[3, 7]],
      rewrites: [[{ index: 7, q: tale()[7] }], [{ index: 7, q: TALE_REPLACEMENT }]],
    });
    wire(TALE, 'ur');
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(calls().filter(isRewrite)).toHaveLength(2);
    const stems = storedRows().map((x) => x.question_text);
    expect(stems).toHaveLength(8);
    expect(stems).toContain(TALE_REPLACEMENT.question);
    expect(stems).not.toContain(tale()[7].question);
    expect(events('transcript_quiz.duplicate_question')).toContainEqual(expect.objectContaining({ stage: 'solver', confirmed: [[3, 7]] }));
  });
});
