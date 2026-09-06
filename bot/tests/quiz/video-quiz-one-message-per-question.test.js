'use strict';
/**
 * ONE MESSAGE PER QUESTION — the per-question send cost is a budget.
 *
 * A child's quiz stalled on staging for three and a half minutes per verdict.
 * The per-recipient throttle (video-quiz-rate-limiter.service.js) allows 20
 * sends in a rolling 5-minute window, and a question card was costing FOUR of
 * them: the "Question n of N" chrome text, the card image, the letter buttons,
 * and the verdict. Eight questions is 32 sends against a budget of 20, so the
 * window filled at question 5 and the only exit was waiting for the oldest send
 * to age out of a five-minute window. Neither earlier live run hit it because
 * those children answered slowly enough for the window to drain; a child who
 * taps fast hits it every time.
 *
 * WhatsApp can carry the whole question in ONE message — an interactive message
 * with an image header, a body and the buttons — so the picture, the counter,
 * the cue and the tap surface arrive together. That is both the fix for the
 * stall and the thing the operator asked for on his phone: one message per
 * question, not three.
 *
 * The rule this file locks: a question costs ONE send when the tap surface can
 * carry an image header (a question card or a figure with <=3 short options),
 * and TWO when it cannot (a list, which Meta gives no image header). The
 * counter never costs a send of its own on any path.
 *
 * RUN: cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest --config jest.config.js tests/quiz/video-quiz-one-message-per-question.test.js
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true), setNX: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendAudioFromUrlReturningId: jest.fn().mockResolvedValue('mid-1'),
  sendTextReturningId: jest.fn().mockResolvedValue('mid-2'),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
// The throttle is the thing the budget is spent against; counting its calls is
// how "a question costs N sends" is measured from the limiter's own side.
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const rateLimiter = require('../../shared/services/quiz/video-quiz-rate-limiter.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');

const PHONE = '923000000000';

/** Every WhatsApp call this module can make, so a new send kind cannot hide. */
const SEND_FNS = [
  'sendMessage', 'sendInteractiveButtons', 'sendImageWithButtons',
  'sendInteractiveMessage', 'sendImageFromUrl', 'sendAudioFromUrlReturningId',
  'sendTextReturningId', 'sendFlow',
];

function sendCalls() {
  const calls = [];
  SEND_FNS.forEach((fn) => {
    WhatsAppService[fn].mock.calls.forEach(() => calls.push(fn));
  });
  return calls;
}

function question(overrides = {}) {
  return {
    id: 'q-1', external_id: 'tq:quiz-1:S1:1',
    question_text: 'Which gas do plants take in?',
    option_a: 'Carbon dioxide', option_b: 'Oxygen', option_c: 'Nitrogen', option_d: null,
    correct_option: 'A', explanation: 'Plants take in carbon dioxide.',
    option_feedback: null, media: {}, render_pattern: 'P1',
    ...overrides,
  };
}

function stubRow(q) {
  supabase.from.mockImplementation(() => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: () => chain,
      or: async () => ({ data: null, error: null }),
      single: async () => ({ data: q, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve) => resolve({ data: [], error: null }),
    };
    return chain;
  });
}

const state = (i = 0, n = 8) => ({
  sessionId: 'sess-1', quizId: 'qz-1', language: 'en',
  questionIds: Array.from({ length: n }, (_, k) => `q-${k + 1}`),
  index: i, correct: 0, answered: 0, currentQuestionId: null,
});

beforeEach(() => { jest.clearAllMocks(); });

describe('a question is ONE message', () => {
  test('a question CARD: one send, the card as the header, the counter in the body', async () => {
    stubRow(question({ media: { question_card: 'https://r2/card1.png' } }));
    await VideoQuiz.sendNextQuestion(PHONE, state(4));

    expect(sendCalls()).toEqual(['sendImageWithButtons']);
    const [, imageUrl, body, buttons] = WhatsAppService.sendImageWithButtons.mock.calls[0];
    expect(imageUrl).toBe('https://r2/card1.png');
    // The cue names exactly the letters this send offers, and NOT the counter:
    // the card paints "QUESTION 5 OF 8" into the picture itself, and printing
    // it again underneath is the two-numbers-for-one-question the operator
    // photographed (see transcript-quiz-card-counter-source.test.js for the
    // guard that the picture really does carry it).
    expect(body).toBe('The question is in the picture above. Tap A, B or C.');
    expect(buttons.map((b) => b.title)).toEqual(['A', 'B', 'C']);
    // One send is one unit of the recipient's window.
    expect(rateLimiter.throttle).toHaveBeenCalledTimes(1);
  });

  test('a FIGURE question (P3): one send, the figure as the header, the stem under it', async () => {
    stubRow(question({
      render_pattern: 'P3',
      option_a: 'Anode', option_b: 'Cathode', option_c: 'Filament',
      media: { question_image: 'https://r2/figure1.png' },
    }));
    await VideoQuiz.sendNextQuestion(PHONE, state(0));

    expect(sendCalls()).toEqual(['sendImageWithButtons']);
    const [, imageUrl, body] = WhatsAppService.sendImageWithButtons.mock.calls[0];
    expect(imageUrl).toBe('https://r2/figure1.png');
    expect(body.startsWith('*Question 1 of 8*')).toBe(true);
    expect(body).toContain('Which gas do plants take in?');
    expect(rateLimiter.throttle).toHaveBeenCalledTimes(1);
  });

  test('a TEXT question: one send, the counter opening the body', async () => {
    stubRow(question());
    await VideoQuiz.sendNextQuestion(PHONE, state(2));

    expect(sendCalls()).toEqual(['sendInteractiveButtons']);
    const [, payload] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(payload.body.startsWith('*Question 3 of 8*')).toBe(true);
    expect(payload.body).toContain('Which gas do plants take in?');
    expect(rateLimiter.throttle).toHaveBeenCalledTimes(1);
  });

  test('a CARD with four options still takes the list, and still costs two sends, not three', async () => {
    // Meta gives an interactive LIST no image header, so the picture has to be
    // its own message here. Two sends is the floor for this shape; the counter
    // still costs nothing.
    stubRow(question({
      option_d: 'Hydrogen',
      media: { question_card: 'https://r2/card4.png' },
    }));
    await VideoQuiz.sendNextQuestion(PHONE, state(0));

    expect(sendCalls().sort()).toEqual(['sendImageFromUrl', 'sendInteractiveMessage']);
    // Still no chat counter: the picture carries it, on both card shapes.
    const [, , caption] = WhatsAppService.sendImageFromUrl.mock.calls[0];
    const [, payload] = WhatsAppService.sendInteractiveMessage.mock.calls[0];
    expect(caption).toBe('');
    expect(payload.body.text).toBe('The question is in the picture above. Tap A, B, C or D.');
    expect(rateLimiter.throttle).toHaveBeenCalledTimes(2);
  });

  test('the counter is never a message of its own, and never printed twice', async () => {
    const shapes = [
      // A card paints its own counter, so the chat prints none: 0.
      { name: 'card', expected: 0, row: { media: { question_card: 'https://r2/c.png' } } },
      { name: 'card+list', expected: 0,
        row: { option_d: 'Hydrogen', media: { question_card: 'https://r2/c4.png' } } },
      // A figure is a diagram with no counter of its own, so the body carries it.
      { name: 'figure', expected: 1,
        row: { render_pattern: 'P3', option_a: 'Anode', option_b: 'Cathode', option_c: 'Filament',
          media: { question_image: 'https://r2/f.png' } } },
      { name: 'text', expected: 1, row: {} },
    ];
    for (const shape of shapes) {
      jest.clearAllMocks();
      stubRow(question(shape.row));
      // eslint-disable-next-line no-await-in-loop
      await VideoQuiz.sendNextQuestion(PHONE, state(0));
      // sendMessage is the plain-text send. Nothing in a question phase may
      // use it: a question is a picker, with or without a picture header.
      expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
      const texts = [
        ...WhatsAppService.sendImageFromUrl.mock.calls.map((c) => c[2]),
        ...WhatsAppService.sendImageWithButtons.mock.calls.map((c) => c[2]),
        ...WhatsAppService.sendInteractiveButtons.mock.calls.map((c) => c[1].body),
        ...WhatsAppService.sendInteractiveMessage.mock.calls.map((c) => c[1].body.text),
      ];
      const hits = texts.filter((t) => String(t).includes('Question 1 of 8')).length;
      expect(`${shape.name}:${hits}`).toBe(`${shape.name}:${shape.expected}`);
    }
  });

  test('the whole eight-question run fits the per-recipient window', async () => {
    // The budget this file exists to defend: opener + 8 x (question + verdict)
    // + scorecard + one post-quiz offer has to sit under the limiter's cap.
    const perQuestion = 2;
    const spend = 1 + (8 * perQuestion) + 1 + 1;
    const limiter = jest.requireActual('../../shared/services/quiz/video-quiz-rate-limiter.service');
    expect(spend).toBeLessThanOrEqual(limiter.MAX_SENDS_PER_WINDOW);
  });
});

describe('the verdict is the question\'s only other send', () => {
  test('an answer phase with no explanation media is one message', async () => {
    const render = require('../../shared/services/quiz/video-quiz-render.service');
    const msgs = render.build(question({ media: { question_card: 'https://r2/c.png' } }));
    await sender.sendPhase(PHONE, msgs, 'answer', {
      questionId: 'q-1', sessionId: 'sess-1', isCorrect: true, selectedIndex: 0,
    });
    expect(sendCalls()).toEqual(['sendMessage']);
  });
});
