'use strict';
/**
 * bd-0q8b4x — the child page gets `words` (short Urdu meanings) on a question only while
 * app_settings quiz_word_help is on; off, the payload is exactly as before.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn() }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => false, setNX: jest.fn(), get: jest.fn(async () => null), set: jest.fn(), delete: jest.fn(),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
const mockFlag = { on: false, lot: false };
jest.mock('../../../shared/services/quiz/quiz-word-help-flag', () => ({ readFlag: jest.fn(async () => mockFlag) }));

const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Flag = require('../../../shared/services/quiz/quiz-word-help-flag');

const rows = [
  { id: 'a', question_text: 'When do farmers harvest wheat?', media: { word_help: [{ en: 'harvest', ur: 'فصل کاٹنا', from: 'book' }] } },
  { id: 'b', question_text: 'What is red?', media: null },
];
const payloads = () => rows.map((r, i) => ({ qid: r.id, i: i + 1, text: r.question_text }));

beforeEach(() => { mockFlag.on = false; mockFlag.lot = false; Flag.readFlag.mockClear(); });

test('switch off: payload unchanged', async () => {
  expect(await WQ.withWordHelp(rows, payloads(), 'sc1')).toEqual(payloads());
});

test('switch on: the question with words carries them, the other does not', async () => {
  mockFlag.on = true;
  const out = await WQ.withWordHelp(rows, payloads(), 'sc1');
  expect(out[0].words).toEqual([{ en: 'harvest', ur: 'فصل کاٹنا' }]);
  expect(out[1].words).toBeUndefined();
});

test('a quiz with no word help never reads the switch', async () => {
  await WQ.withWordHelp([rows[1]], [payloads()[1]], 'sc1');
  expect(Flag.readFlag).not.toHaveBeenCalled();
});
