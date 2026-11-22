'use strict';
/**
 * A wrong answer key must not become the teacher's lesson.
 *
 * The class report's "most missed" block names the keyed option as "the right answer", prints the option most of the
 * class picked, its authored child feedback as "why they picked it", and hands all three to the model that writes the
 * reteach box. When the key itself is wrong (the item sits in keys' review queue, quiz_item_reviews, status open /
 * key_wrong / ambiguous), that block tells a teacher their class misunderstood the very answer it got right, and the
 * model writes a plan to reteach it.
 *
 * app_settings `video_quiz_report_key_review` (off unless JSON true): an item the queue holds stays in "most missed"
 * (the class did miss it: the signal stays) and is labelled "answer key under review"; its keyed answer, the class's
 * pick, the feedback and the explanation are not printed, and the model is told the key is under review. Off, a
 * missing table or an unreadable queue: today's report byte for byte.
 *
 * Drives the REAL generate() and the real PDF template. Faked at the boundaries only: Supabase (in-memory, applies
 * filters), the model client, WhatsApp, the PDF printer (captures the HTML).
 */
jest.mock('../../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({})));
const mockCreate = jest.fn();
jest.mock('../../../shared/services/llm-client', () => ({
  withSpendRecording: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WhatsAppService = require('../../../shared/services/whatsapp.service');
const { htmlToPdf } = require('../../../shared/utils/html-to-pdf');
const { logEvent } = require('../../../shared/utils/structured-logger');
const report = require('../../../shared/services/quiz/video-quiz-report.service');
// absent before the change: the red run still executes every test
const KeyReview = (() => { try { return require('../../../shared/services/quiz/report-key-review'); } catch (_) { return null; } })();

const SC = 'sc-kr1';
const QUIZ = 'q-kr1';
const Q_HELD = 'qq-kr-held';
const Q_OK = 'qq-kr-ok';
const KEY = 'video_quiz_report_key_review';
const GUIDANCE = {
  muddled: 'The class mixed up two blends.',
  board: 'Write br and tr on the board and say each one.',
  check: 'Ask three children to name a word with each.',
};

const LABEL_EN = 'Answer key under review';
const LABEL_UR = 'جواب کی جانچ جاری ہے';

const kid = (id, name) => ({
  id, share_code_id: SC, student_id: `st-${id}`, student_name: name, user_id: null, invited_by_student_id: null,
  student_class: '3', status: 'completed', device_ref: `dev-${id}`, parent_phone: null,
  total_questions_answered: 2, correct_answers: 1, mastery_percentage: 50,
  created_at: '2026-11-20T08:00:00Z', completed_at: '2026-11-20T08:05:00Z',
});

// The held item: keyed B (Br), yet C (Tr) is an r blend too; three of four children picked C.
const HELD = {
  id: Q_HELD, quiz_id: QUIZ, external_id: 'x-held', question_text: 'Which of these is an r blend?',
  option_a: 'Sk', option_b: 'Br', option_c: 'Tr', option_d: 'Pl', correct_option: 'B',
  option_feedback: { wrong: { 2: 'Tr is not an r blend, keep practising!' } },
  explanation: 'Br starts with b then r.', sort_order: 1,
};
const OK = {
  id: Q_OK, quiz_id: QUIZ, external_id: 'x-ok', question_text: 'What is 2 + 3?',
  option_a: '4', option_b: '5', option_c: '6', option_d: null, correct_option: 'B',
  option_feedback: { wrong: { 0: 'Counted one short.' } },
  explanation: 'Two and three more make five.', sort_order: 2,
};
const ans = (sid, qid, opt, ok) => ({ id: `${sid}-${qid}`, session_id: sid, question_id: qid, selected_option: opt, is_correct: ok });

function seed({ setting, reviews = [{ question_id: Q_HELD, status: 'open' }], language = 'en', table = 'ok' } = {}) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'KR11AA', quiz_id: QUIZ, teacher_user_id: 'u1', teacher_name: 'T',
      topic: 'Blends', language, report_sent_at: null, created_at: '2026-11-20T07:00:00Z' }],
    users: [{ id: 'u1', phone_number: '+92300FIXTURE41', preferred_language: language, name: 'Teacher Testwala' }],
    quiz_sessions: [kid('a', 'Ali Testwala'), kid('b', 'Sana Testwala'), kid('c', 'Omar Testwala'), kid('d', 'Hira Testwala')],
    quiz_answers: [
      ans('a', Q_HELD, 'C', false), ans('b', Q_HELD, 'C', false), ans('c', Q_HELD, 'C', false), ans('d', Q_HELD, 'B', true),
      ans('a', Q_OK, 'A', false), ans('b', Q_OK, 'A', false), ans('c', Q_OK, 'B', true), ans('d', Q_OK, 'B', true),
    ],
    quiz_questions: [{ ...HELD }, { ...OK }],
    quiz_item_reviews: reviews.map((r, i) => ({ id: `rv-${i}`, ...r })),
    app_settings: setting === undefined ? [] : [{ key: KEY, value: setting }],
    quizzes: [{ id: QUIZ, teacher_id: 'u1', meta: { share_code_id: SC }, quiz_source: 'transcript', language, subject: 'english', grade: '3', status: 'sent' }],
  });
  const reviewReads = [];
  supabase.from.mockImplementation((t) => {
    if (t === 'quiz_item_reviews') {
      reviewReads.push(t);
      // production before keys' migration: PostgREST answers an unknown table with an error, never rows
      if (table === 'missing') {
        const err = { data: null, error: { code: '42P01', message: 'relation "public.quiz_item_reviews" does not exist' } };
        const b = { select: () => b, in: () => b, eq: () => b, then: (res, rej) => Promise.resolve(err).then(res, rej) };
        return b;
      }
    }
    return fake.from(t);
  });
  supabase.rpc = fake.rpc;
  return { fake, reviewReads };
}

async function run(opts) {
  const w = seed(opts);
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  const html = htmlToPdf.mock.calls[htmlToPdf.mock.calls.length - 1][0];
  const prompt = mockCreate.mock.calls.length
    ? mockCreate.mock.calls[0][0].messages.map((m) => m.content).join('\n') : '';
  return { ...w, html, prompt };
}

/** The PDF card of one "most missed" question: from its text to the next card. */
function cardOf(html, questionText) {
  const at = html.indexOf(questionText);
  expect(at).toBeGreaterThan(-1);
  const next = html.indexOf('class="moment"', at);
  return html.slice(at, next === -1 ? at + 4000 : next);
}

beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-11-21T02:00:00Z'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(GUIDANCE) } }] });
  process.env.VIDEO_REPORT_SEND_CLAIM = 'false';
  delete process.env.CLASS_CARD_ENABLED;
  if (KeyReview) KeyReview.reset();
});

describe('switch on, the item is in the review queue', () => {
  test('the PDF keeps the question, labels its key "under review", and prints no keyed answer, pick or feedback for it', async () => {
    const { html } = await run({ setting: true });
    const held = cardOf(html, HELD.question_text);
    expect(held).toContain(LABEL_EN);
    expect(held).not.toContain('>Tr<');                       // the class's pick, as a "wrong" pill
    expect(held).not.toContain('>Br<');                       // the keyed answer, as the "correct" pill
    expect(held).not.toContain('Tr is not an r blend');       // the distractor's feedback as the class's mistake
    expect(held).not.toContain(HELD.explanation);             // why the (suspect) key is right
    expect(held).toContain('3'); // "3 of 4 got it wrong" stays: the class did miss it
  });

  test('an item the queue does not hold is printed exactly as today', async () => {
    const { html } = await run({ setting: true });
    const ok = cardOf(html, OK.question_text);
    expect(ok).not.toContain(LABEL_EN);
    expect(ok).toContain('Counted one short.');
    expect(ok).toContain(OK.explanation);
  });

  test('the reteach model is told the key is under review, never that the class picked the wrong answer', async () => {
    const { prompt } = await run({ setting: true });
    expect(prompt).toContain(HELD.question_text);
    expect(prompt).not.toContain('Most of them chose "Tr"');
    expect(prompt).not.toContain('Tr is not an r blend');
    expect(prompt).toMatch(/answer key for this question is under review/i);
    expect(prompt).toContain('Most of them chose "4"');         // the other item keeps its evidence
  });

  test('key_wrong and ambiguous hold too; a reviewed key that holds does not', async () => {
    for (const status of ['key_wrong', 'ambiguous']) {
      jest.clearAllMocks();
      mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(GUIDANCE) } }] });
      if (KeyReview) KeyReview.reset();
      const { html } = await run({ setting: true, reviews: [{ question_id: Q_HELD, status }] });
      expect(cardOf(html, HELD.question_text)).toContain(LABEL_EN);
    }
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(GUIDANCE) } }] });
    if (KeyReview) KeyReview.reset();
    const { html } = await run({ setting: true, reviews: [{ question_id: Q_HELD, status: 'key_ok' }] });
    expect(cardOf(html, HELD.question_text)).not.toContain(LABEL_EN);
  });

  test('an Urdu quiz: the label is in Urdu', async () => {
    const { html } = await run({ setting: true, language: 'ur' });
    expect(cardOf(html, HELD.question_text)).toContain(LABEL_UR);
  });

  test('the PDF fails: the text report carries the label under the question', async () => {
    htmlToPdf.mockRejectedValueOnce(new Error('no renderer'));
    seed({ setting: true });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    const text = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    const at = text.indexOf(HELD.question_text);
    expect(at).toBeGreaterThan(-1);
    expect(text.slice(at, text.indexOf('\n•', at + 1) === -1 ? undefined : text.indexOf('\n•', at + 1))).toContain(LABEL_EN);
  });

  test('the label is counted: report_sent carries key_review_n', async () => {
    await run({ setting: true });
    const sent = logEvent.mock.calls.filter((c) => c[0] === 'video_quiz.report_sent').map((c) => c[1]);
    expect(sent).toEqual([expect.objectContaining({ key_review_n: 1 })]);
  });
});

describe('today\'s report, byte for byte (the golden)', () => {
  test('switch off: the queue is never read and the PDF and prompt match a world with no queue at all', async () => {
    const off = await run({});
    expect(off.reviewReads).toEqual([]);
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(GUIDANCE) } }] });
    const none = await run({ reviews: [] });
    expect(off.html).toBe(none.html);
    expect(off.prompt).toBe(none.prompt);
    expect(cardOf(off.html, HELD.question_text)).toContain('Tr is not an r blend');   // today's text, wrong lesson and all
  });

  test.each([['false', false], ['the string "true"', 'true'], ['an object', { on: true }]])('switch %s is off', async (_l, setting) => {
    const { html, reviewReads } = await run({ setting });
    expect(reviewReads).toEqual([]);
    expect(html).not.toContain(LABEL_EN);
  });

  test('switch on, the queue table missing (production before keys\' migration): today\'s report', async () => {
    const missing = await run({ setting: true, table: 'missing' });
    expect(missing.reviewReads.length).toBeGreaterThan(0);
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(GUIDANCE) } }] });
    if (KeyReview) KeyReview.reset();
    const off = await run({});
    expect(missing.html).toBe(off.html);
    expect(missing.prompt).toBe(off.prompt);
  });

  test('switch on, an empty queue: today\'s report', async () => {
    const empty = await run({ setting: true, reviews: [] });
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(GUIDANCE) } }] });
    if (KeyReview) KeyReview.reset();
    const off = await run({});
    expect(empty.html).toBe(off.html);
    expect(empty.prompt).toBe(off.prompt);
  });
});
