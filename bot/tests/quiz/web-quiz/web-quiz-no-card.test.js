'use strict';
/**
 * The web page never shows the WhatsApp question card.
 *
 * A card is a PNG with the stem and the lettered options painted in, in the
 * order of media.display_order. On the web the stem and the options are text
 * buttons, so the card showed the question twice, and its letters could name a
 * different option than the button in the same position. The page's picture
 * is only ever the figure itself (media.question_image), or nothing.
 *
 * Supabase is the boundary and is faked; the E2/E10 service runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({ getPresignedUrl: jest.fn(async (u) => `${u}?signed`) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

// Shaped like real production rows: a card made because an option is over
// WhatsApp's 20-character button cap, its letters in display_order [2,0,1];
// and a figure question that also has a card.
const CARD_ONLY = {
  id: qid(1), quiz_id: QUIZ, external_id: 'tq:1', sort_order: 1,
  question_text: 'Why do plants need sunlight?', option_a: 'To make their own food', option_b: 'To keep the soil warm',
  option_c: 'To drink more water', option_d: null, correct_option: 'A', explanation: 'Leaves use sunlight to make food.',
  option_feedback: null, render_pattern: 'P1',
  media: { language: 'en', display_order: [2, 0, 1], question_card: 'https://r2.example/card1.png' },
};
const FIGURE_AND_CARD = {
  id: qid(2), quiz_id: QUIZ, external_id: 'tq:2', sort_order: 2,
  question_text: 'What part of the bar is shaded?', option_a: '$\\frac{1}{4}$', option_b: '$\\frac{3}{4}$', option_c: '$\\frac{1}{2}$',
  option_d: null, correct_option: 'B', explanation: 'Three of four equal parts are shaded.', option_feedback: null, render_pattern: 'P1',
  media: { language: 'en', display_order: [1, 2, 0], question_card: 'https://r2.example/card2.png',
    question_image: 'https://r2.example/fig2.png', figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] } },
};

beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Plants', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Plants', grade: '4', subject: 'Science', language: 'en', meta: {}, quiz_source: 'transcript' }],
    quiz_questions: [CARD_ONLY, FIGURE_AND_CARD],
    quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('a card-only question has no picture on the web: the lettered card cannot disagree with the buttons', async () => {
  const q = (await WQ.getQuiz('AB12CD')).quiz.questions.find((x) => x.qid === qid(1));
  expect(q.img).toBeUndefined();
  expect(JSON.stringify(q)).not.toContain('card1.png');
  await expect(WQ.media('AB12CD', qid(1), { k: 'q' })).rejects.toMatchObject({ status: 404 });
});

test('a figure question with a card shows the figure picture, never the card', async () => {
  const q = (await WQ.getQuiz('AB12CD')).quiz.questions.find((x) => x.qid === qid(2));
  expect(q.img).toBe(`/api/wq/media/AB12CD/${qid(2)}?k=q`);
  const served = await WQ.media('AB12CD', qid(2), { k: 'q' });
  expect(served.redirect).toContain('fig2.png');
  expect(served.redirect).not.toContain('card2.png');
});
