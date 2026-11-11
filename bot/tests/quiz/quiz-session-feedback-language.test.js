'use strict';
/** bd-x0m19 / bd-kso9u / bd-47ukr — the roster quiz's wrong-answer message follows the quiz language. */
const mockSend = jest.fn(async () => {});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/config/model-registry', () => ({ modelFor: jest.fn() }));
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: (...a) => mockSend(...a) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({}));
jest.mock('../../shared/services/queue', () => ({}));
jest.mock('openai', () => function OpenAI() {}, { virtual: true });
jest.mock('../../shared/utils/constants', () => ({ OPENAI_API_KEY: 'x' }));

const Svc = require('../../shared/services/quiz/quiz-session.service');

const q = { id: 'q1', correct_option: 'B', option_a: 'Cat', option_b: 'Dog', option_c: 'Cow', explanation: 'Dogs bark.' };
const URDU = /[؀-ۿ]/;
const wrong = async (language) => {
  mockSend.mockClear();
  await Svc._sendFeedback('9231', q, 'A', false, language ? { language } : {});
  return mockSend.mock.calls[0][1];
};

describe('roster quiz wrong-answer feedback', () => {
  test('en (and no language) is unchanged', async () => {
    const expected = 'Not quite!\n\nThe answer is B: Dog\n\nDogs bark.\n\nKeep going — mistakes help you learn! 💪';
    expect(await wrong('en')).toBe(expected);
    expect(await wrong(undefined)).toBe(expected);
  });
  test('ur speaks Urdu, keeps the answer and explanation', async () => {
    const body = await wrong('ur');
    expect(body).toMatch(URDU);
    expect(body).not.toContain('Not quite');
    expect(body).not.toContain('Keep going');
    expect(body).toContain('Dog');
    expect(body).toContain('Dogs bark.');
  });
});
