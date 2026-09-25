'use strict';
/**
 * The children in the room are never the subject of the quiz.
 *
 * A staging quiz from an Urdu word-meanings lesson asked «<pupil> نے 'سوچنا'
 * کا کیا مطلب بتایا تھا؟» and «کلاس میں <pupil> کے بارے میں کیا جملہ استعمال
 * کیا گیا تھا؟», with the option «<pupil> کلاس میں شور کرتا ہے۔» — a real child
 * from the recording made the subject of a question, and a negative line about
 * that child sent to the whole class. The teacher had used the children's names
 * in example sentences; the digest listed them as the lesson's "people", and the
 * author had them in both the digest and the transcript excerpts.
 *
 *   1. the transcript digest keeps story and word-problem characters in
 *      `people` and records the children in the room separately, as one-way
 *      hashes only (`pupil_tokens`), and their names are scrubbed from what
 *      the author reads;
 *   2. the author and every rewrite that writes a question are told never to
 *      name a child from the recording or ask what a child said or did;
 *   3. PEDAGOGY_PUPIL_AS_SUBJECT is a hard fault — a recorded pupil, a "what
 *      did X say/do" question, or a negative claim about a named child — that
 *      the targeted rewrite gets one try at and the salvage drops, and that
 *      never quotes the child's name.
 *
 * Every name below is synthetic.
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
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const { buildAuthorPrompt, excerptsFor } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logToFile } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// Synthetic: two children "in the room", Zoya and Umar Farooq.
const PUPILS = [{ latin: 'Zoya', ur: 'زویا' }, { latin: 'Umar Farooq', ur: 'عمر فاروق' }];
const OLD_DIGEST = {
  topic: 'Word meanings', topic_as_taught: 'الفاظ معنی', subject: 'urdu', grade_band: '1-2', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'الفاظ کے معنی پہچاننا', statement_en: 'know word meanings', taught_level: 'recall' },
    { id: 'S2', statement: 'لفظ کو جملے میں استعمال کرنا', statement_en: 'use a word in a sentence', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'سوچنا', as_spoken: 'سوچنا' }, { term: 'چپ چاپ', as_spoken: 'چپ چاپ' }],
  examples_used: ['دماغ سے سوچنا', 'کلاس میں چپ چاپ بیٹھنا'], misconceptions_surfaced: [],
};
const NEW_DIGEST = () => Digest.normaliseDigest({ ...OLD_DIGEST, people: [], pupils_named: PUPILS });
const SUMMARY = 'آج کے سبق میں الفاظ کے معنی اور ان کا جملوں میں استعمال سکھایا گیا۔';
const CTX = (digest = OLD_DIGEST) => ({ language: 'ur', subject: 'urdu', digest, nExpected: 8, lessonSummary: SUMMARY });
const base = (o) => ({
  slo_id: 'S1', level: 'recall', correct_index: 0,
  explanation: 'یہ اس لفظ کا صحیح معنی ہے۔', selected_because: 'سبق میں الفاظ کے معنی',
  distractor_misconceptions: { 1: 'ملتے جلتے لفظ کو ایک سمجھنا', 2: 'لفظ کا الٹ معنی لینا' },
  option_feedback: { correct: 'بالکل درست!', wrong: { 1: 'یہ اس کا معنی نہیں۔', 2: 'دوبارہ سوچیں۔' } },
  ...o,
});
const WORDS = [['چھپانا', 'پوشیدہ رکھنا', 'تلاش کرنا', 'دکھانا'], ['سننا', 'کان سے سننا', 'دیکھنا', 'بولنا'], ['چھٹی', 'اسکول نہ جانے کا دن', 'کام', 'کھیل'],
  ['دیکھنا', 'آنکھ سے دیکھنا', 'سونگھنا', 'چکھنا'], ['بولنا', 'زبان سے بولنا', 'سننا', 'لکھنا'], ['لکھنا', 'ہاتھ سے لکھنا', 'دوڑنا', 'سونا']];
function clean() {
  // four of the eight at "understand", on the SLO taught at "understand"
  const qs = WORDS.map(([w, a, b, c], i) => base({
    question: `لفظ '${w}' کا کیا مطلب ہے؟`, options: [a, b, c], ...(i >= 3 ? { slo_id: 'S2', level: 'understand' } : {}),
  }));
  qs.push(base({ question: "لفظ 'سوچنا' کا کیا مطلب ہے؟", options: ['غور کرنا', 'دیکھنا', 'بولنا'] }));
  qs.push(base({ slo_id: 'S2', level: 'understand', question: "کون سا جملہ 'چپ چاپ' کو ٹھیک استعمال کرتا ہے؟", options: ['بچہ کلاس میں چپ چاپ بیٹھا رہا۔', 'چپ چاپ ایک کھیل ہے۔', 'میں چپ چاپ کھا رہا ہوں۔'] }));
  return qs;
}
/** The staging shape, with synthetic names. */
function staging() {
  const qs = clean();
  qs[6] = base({ question: "زویا نے 'سوچنا' کا کیا مطلب بتایا تھا؟", options: ['غور کرنا', 'دیکھنا', 'بولنا'] });
  qs[7] = base({
    slo_id: 'S2', level: 'understand', question: 'کلاس میں عمر فاروق کے بارے میں کیا جملہ استعمال کیا گیا تھا؟',
    options: ['عمر کلاس میں چپ چاپ بیٹھا رہتا ہے۔', 'عمر کلاس میں شور کرتا ہے۔', 'عمر کلاس میں کھیلتا ہے۔'],
  });
  return qs;
}
const pupilFaults = (errs) => errs.filter((e) => /PUPIL_AS_SUBJECT/.test(e));

describe('1 — PEDAGOGY_PUPIL_AS_SUBJECT on the staging shape', () => {
  test('both questions are named, the complaint quotes no name, and nothing else fires', () => {
    expect(validate(clean(), CTX()).errors).toEqual([]);
    const errs = validate(staging(), CTX()).errors;
    const got = pupilFaults(errs);
    expect(got.map((e) => e.slice(0, 3))).toEqual(['q6:', 'q7:']);
    got.forEach((e) => {
      expect(e).toMatch(/^q\d: PEDAGOGY_PUPIL_AS_SUBJECT — /);
      expect(e).not.toMatch(/زویا|عمر|فاروق|Zoya|Umar/);
    });
    expect(errs.filter((e) => !/PUPIL_AS_SUBJECT/.test(e))).toEqual([]);
  });

  test('it is a hard fault: never soft, never shipped in place', () => {
    const errs = pupilFaults(validate(staging(), CTX()).errors);
    errs.forEach((e) => expect(Gen.SOFT_FAULT.test(e)).toBe(false));
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([6, 7]);
  });

  test('a negative claim about a named child, in an option alone', () => {
    const qs = clean();
    qs[7] = { ...qs[7], options: ['بچہ کلاس میں چپ چاپ بیٹھا رہا۔', 'عمر کلاس میں شور کرتا ہے۔', 'میں چپ چاپ کھا رہا ہوں۔'] };
    expect(pupilFaults(validate(qs, CTX()).errors).map((e) => e.slice(0, 3))).toEqual(['q7:']);
  });

  test('an English quiz: "What did <child> say…"', () => {
    const qs = clean().map((q, i) => ({ ...q, question: `What does the word number ${i} mean?`, options: ['to think', 'to see', 'to speak'], explanation: 'That is its meaning.', option_feedback: { correct: 'Yes.', wrong: { 1: 'No.', 2: 'No.' } }, selected_because: 'word meanings', distractor_misconceptions: { 1: 'a', 2: 'b' } }));
    qs[6] = { ...qs[6], question: "What did Zoya say the word 'think' means?" };
    const errs = validate(qs, { ...CTX(), language: 'en' }).errors;
    expect(pupilFaults(errs).map((e) => e.slice(0, 3))).toEqual(['q6:']);
  });
});

describe('2 — never a child from the recording, even in a neutral sentence (new digest)', () => {
  test('the digest records the children as hashes only, and scrubs them from its own text', () => {
    const d = Digest.normaliseDigest({
      ...OLD_DIGEST, examples_used: ['کلاس میں چپ چاپ بیٹھنا (عمر فاروق کی مثال)', 'زویا نے سوچنا کا مطلب بتایا'],
      people: [{ latin: 'Hira', ur: 'حرا' }], pupils_named: PUPILS,
    });
    expect(Array.isArray(d.pupil_tokens) && d.pupil_tokens.length).toBeTruthy();
    expect(d.pupils_named).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/زویا|عمر|فاروق|Zoya|Umar|Farooq/);
    expect(d.people).toEqual([{ latin: 'Hira', ur: 'حرا' }]);
  });

  test('a recorded child in any child-facing field is a fault; a lesson character is not', () => {
    const qs = clean();
    qs[5] = { ...qs[5], question: "زویا کے پاس ایک کتاب ہے۔ لفظ 'لکھنا' کا کیا مطلب ہے؟" };
    expect(pupilFaults(validate(qs, CTX(NEW_DIGEST())).errors).map((e) => e.slice(0, 3))).toEqual(['q5:']);
    const fb = clean(); fb[2] = { ...fb[2], option_feedback: { ...fb[2].option_feedback, correct: 'بالکل درست، جیسے زویا نے کہا۔' } };
    expect(pupilFaults(validate(fb, CTX(NEW_DIGEST())).errors).map((e) => e.slice(0, 3))).toEqual(['q2:']);
    // the lesson's own character is fine
    const lp = clean(); lp[5] = { ...lp[5], question: "حرا کی بوتل میں پانی ہے۔ لفظ 'لکھنا' کا کیا مطلب ہے؟" };
    const withHira = Digest.normaliseDigest({ ...OLD_DIGEST, people: [{ latin: 'Hira', ur: 'حرا' }], pupils_named: PUPILS });
    expect(pupilFaults(validate(lp, CTX(withHira)).errors)).toEqual([]);
  });

  test('the transcript prompt separates characters from the children in the room', () => {
    const p = Digest.buildDigestPrompt({ transcript: 'سبق', transcriptLanguage: 'ur' });
    expect(p).toMatch(/"pupils_named": \[ \{ "latin": "", "ur": "" \} \]/);
    expect(p).toMatch(/a child in the room/i);
  });

  test('the author never reads a recorded child\'s name: not in the digest, not in the transcript excerpts', () => {
    const digest = NEW_DIGEST();
    const transcript = `${'سبق '.repeat(50)} زویا آپ بتائیں سوچنا کا مطلب کیا ہے۔ زویا نے کہا غور کرنا۔ عمر فاروق چپ چاپ بیٹھے ہیں۔ ${'سبق '.repeat(50)}`;
    const excerpts = excerptsFor(transcript, { ...digest, slos: [{ id: 'S1', evidence_quote: 'زویا آپ بتائیں' }] });
    expect(excerpts).not.toMatch(/زویا|عمر|فاروق/);
    const p = buildAuthorPrompt({ digest, excerpts, language: 'ur', gradeBand: '1-2' });
    expect(p).not.toMatch(/زویا|عمر|فاروق|Zoya|Umar|Farooq/);
  });
});

describe('2b — no log names a recorded child', () => {
  test('a logged complaint that quotes a note with a recorded child in it is redacted', () => {
    const { logRedactor } = require('../../bot/shared/services/quiz/transcript-quiz-people');
    const out = logRedactor(NEW_DIGEST())(['q2: URDU_TEACHER_FIELDS — selected_because must be written in Urdu; got "Zoya\'s answer about thinking"', 'q3: x «عمر فاروق نے بتایا»']);
    expect(JSON.stringify(out)).not.toMatch(/Zoya|زویا|عمر|فاروق/);
    expect(out[0]).toMatch(/^q2: URDU_TEACHER_FIELDS — /);
  });
});

describe('3 — what is not a pupil', () => {
  test('the teacher (its own rule), a common noun, a story character, a historical figure', () => {
    const qs = clean();
    qs[0] = { ...qs[0], question: "استاد نے 'چھپانا' کا کیا مطلب بتایا؟" };
    qs[1] = { ...qs[1], question: "ایک بچے نے کہا کہ وہ کان سے سنتا ہے۔ لفظ 'سننا' کا کیا مطلب ہے؟" };
    qs[3] = { ...qs[3], question: "قائد اعظم محمد علی جناح نے محنت کا سبق دیا۔ لفظ 'دیکھنا' کا کیا مطلب ہے؟" };
    const story = Digest.normaliseDigest({ ...OLD_DIGEST, people: [{ latin: 'Ali', ur: 'علی' }] });
    qs[4] = { ...qs[4], question: 'کہانی میں علی نے اپنی امی سے کیا پوچھا؟', options: ['کھانے کا وقت', 'بارش کا حال', 'کتاب کا نام'] };
    const errs = validate(qs, CTX(story)).errors;
    expect(pupilFaults(errs)).toEqual([]);
    expect(errs.some((e) => /^q0: PEDAGOGY_TEACHER_AS_SUBJECT/.test(e))).toBe(true);
  });
});

describe('3b — the shapes a production sweep flagged wrongly: history, a textbook story, a news item', () => {
  // A sweep of 18,917 shipped questions: a detector that fired on any named
  // person with a past verb and a question word flagged 24, and only one or
  // two were about a child in the class. These are the shapes of the others
  // (public figures as the textbooks name them; story characters synthetic).
  const history = [
    'محترمہ فاطمہ جناح نے خواتین سے کیا کرنے کو کہا؟',
    'محترمہ فاطمہ جناح نے کون سی ڈگری حاصل کی تھی؟',
    'سر سید احمد خان نے کون سا ادارہ قائم کیا تھا؟',
    'علامہ محمد اقبال رحمۃ اللہ علیہ نے الگ ریاست کا تصور کب پیش کیا تھا؟',
    'قائد اعظم محمد علی جناح نے کون سی تعلیم حاصل کی تھی؟',
  ];
  const story = [
    'علی نے تقریر کی مشق کرنے کے بعد دادی جان سے کیا کہا ہوگا؟',
    'علی نے تقریر کی تیاری کے لیے کیا مشق کی تھی؟',
    'What did Moti say they do on Monday?',
    'What did Tara do that made someone feel left out?',
  ];
  test.each([...history, ...story])('«%s» is not a question about a child in the class', (stem) => {
    const q = { question: stem, options: ['a', 'b', 'c'] };
    const P = require('../../bot/shared/services/quiz/transcript-quiz-pupils');
    expect(P.pupilAsSubject(q, { digest: OLD_DIGEST })).toBeNull();
  });

  test('the classroom shapes are still found: a meaning or an answer a named child gave, the teacher asking a named child', () => {
    const P = require('../../bot/shared/services/quiz/transcript-quiz-pupils');
    const hit = (stem) => P.pupilAsSubject({ question: stem, options: ['a', 'b', 'c'] }, { digest: OLD_DIGEST });
    expect(hit("زویا نے 'Spacecraft' کا کیا مطلب بتایا تھا؟")).toMatch(/said or did in class/);
    expect(hit("عمر نے 'پھول' کے لفظ سے کون سا جملہ بنایا تھا؟")).toMatch(/said or did in class/);
    expect(hit("استاد نے زویا سے 'سوچنا' کے بارے میں کیا پوچھا؟")).toMatch(/said or did in class/);
    expect(hit('What answer did Zoya give when the teacher asked about thinking?')).toMatch(/said or did in class/);
  });
});

describe('4 — every writer is told, up front', () => {
  const RULE = /THE CHILDREN IN THE ROOM ARE NEVER IN THE QUIZ/;
  test('the author, the targeted rewrite and the picture repair', async () => {
    expect(buildAuthorPrompt({ digest: OLD_DIGEST, excerpts: '…', language: 'ur', gradeBand: '1-2' })).toMatch(RULE);
    expect(buildAuthorPrompt({ digest: OLD_DIGEST, excerpts: '…', language: 'en', gradeBand: '1-2' })).toMatch(RULE);
    const errs = pupilFaults(validate(staging(), CTX()).errors);
    const p = Rewrite.buildRewritePrompt({ digest: OLD_DIGEST, language: 'ur', questions: staging(), targets: Rewrite.rewriteTargets(errs) });
    expect(p).toMatch(RULE);
    expect(p).toMatch(/A CHILD FROM THE CLASS/);
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pictures: [] }) }, finish_reason: 'stop' }], usage: {} });
    await Rewrite.addPictures({ questions: clean(), digest: { ...OLD_DIGEST, subject: 'maths', grade_band: '4' }, language: 'ur', gradeBand: '4', need: 1 });
    expect(mockCreate.mock.calls[0][0].messages[0].content).toMatch(RULE);
  });
});

// ── 5. the generate path ──────────────────────────────────────────────────────
function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
function wire(digest) {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: digest.topic, subject: 'urdu', language: 'ur', status: 'generating', meta: { digest, grade: '2', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'سبق '.repeat(400), transcript_language: 'ur', created_at: '2026-09-24T04:00:00Z', analysis_data: {}, users: { phone_number: '923001234567', preferred_language: 'ur', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923001234567', preferred_language: 'ur' }] },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const NAMES = /زویا|عمر|فاروق|Zoya|Umar|Farooq/;

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('5 — on the generate path: repaired, or dropped, never shipped', () => {
  // grade 1-2 Urdu: a picture is asked for on attempt 1 only when none is drawn;
  // the tests give every author reply the same set so the path is the repair.
  test('the targeted rewrite replaces both questions with questions about the words', async () => {
    const fixed = clean();
    mockCreate.mockImplementation((call) => Promise.resolve(isRewrite(call)
      ? reply({ questions: [{ index: 6, ...fixed[6] }, { index: 7, ...fixed[7] }] })
      : reply({ lesson_summary: SUMMARY, questions: staging() })));
    wire(OLD_DIGEST);
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(JSON.stringify(rows.map((x) => [x.question_text, x.option_a, x.option_b, x.option_c]))).not.toMatch(NAMES);
  });

  test('a rewrite that keeps asking about a child: the question is dropped, and no log names the child', async () => {
    mockCreate.mockImplementation((call) => Promise.resolve(isRewrite(call)
      ? reply({ questions: [{ index: 6, ...staging()[6] }, { index: 7, ...staging()[7] }] })
      : reply({ lesson_summary: SUMMARY, questions: staging() })));
    wire(OLD_DIGEST);
    const r = await Gen.process(QID, {});
    const rows = storedRows();
    // shipped without them, or not at all — never with them
    expect(JSON.stringify(rows.map((x) => [x.question_text, x.option_a, x.option_b, x.option_c]))).not.toMatch(NAMES);
    if (r.ok) expect(rows.length).toBeLessThan(8);
    const logged = [...logToFile.mock.calls.map((c) => JSON.stringify(c.slice(1))), ...logEvent.mock.calls.map((c) => JSON.stringify(c[1] || {}))];
    expect(logged.filter((t) => NAMES.test(t))).toEqual([]);
  });
});
