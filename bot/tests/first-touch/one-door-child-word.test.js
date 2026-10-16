'use strict';
/**
 * The bot's own name from a known child, through the REAL student-ingress route(): `jugnu` / «جگنو» is NOT a quiz
 * request under the one door — the tutor answers it, ON exactly as OFF (the card's return words are `quiz please` /
 * «کوئز دکھائیں», which are already quiz-shaped). `quiz` is the child's /quiz either way.
 */
process.env.STUDENT_MODE_ENABLED = 'true';
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({ getActiveState: jest.fn(async () => null), getPostQuizState: jest.fn(async () => null) }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: jest.fn(async () => true), handleButton: jest.fn(async () => true), RETRY_ID: 'sq_retry', CARD_ID: 'sq_card' }));
jest.mock('../../shared/handlers/text-message.handler', () => ({ handleGeneralConversation: jest.fn(async () => true), tryChildVideoMenu: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/web-quiz-identity-flags', () => ({ flags: jest.fn(async () => ({ canon: false, phoneBind: false, guestHome: false })) }));
let mockOn = false;
jest.mock('../../shared/services/first-touch/one-door.flags', () => ({ on: jest.fn(async () => mockOn) }));

const Ingress = require('../../shared/services/student-ingress');
const StudentQuiz = require('../../shared/services/quiz/student-quiz.service');
const { handleGeneralConversation } = require('../../shared/handlers/text-message.handler');

const CHILD = () => ({ id: 'u-child', persona: 'student', personaLanguage: 'ur', personaReason: 'no_identity_quiz_joined' });
const route = (body) => Ingress.route({ messageType: 'text', messageBody: body, from: fixturePhone(2), user: CHILD() });

beforeEach(() => { jest.clearAllMocks(); mockOn = false; });

describe.each([['OFF', false], ['ON', true]])('switch %s', (_name, on) => {
  test.each(['jugnu', 'Jugnu', 'جگنو'])('%s goes to the tutor, as today', async (word) => {
    mockOn = on;
    expect(await route(word)).toBe(true);
    expect(StudentQuiz.open).not.toHaveBeenCalled();
    expect(handleGeneralConversation).toHaveBeenCalledTimes(1);
  });

  test.each(['quiz', 'quiz please', 'کوئز دکھائیں'])('%s opens the child\'s own quizzes (the ONE hub reply)', async (word) => {
    mockOn = on;
    expect(await route(word)).toBe(true);
    expect(StudentQuiz.open).toHaveBeenCalledTimes(1);
    expect(handleGeneralConversation).not.toHaveBeenCalled();
  });
});
