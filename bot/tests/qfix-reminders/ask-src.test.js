'use strict';
/**
 * Where the reminder ask was answered: remind_step carries src (result = the quiz result screen, class_link = under the
 * standing link's chips, landing = /remind/:code). Allow-listed; anything else is dropped, never logged as given.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const { logEvent } = require('../../shared/utils/structured-logger');
const Push = require('../../shared/services/push/web-quiz-push.service');

beforeEach(() => jest.clearAllMocks());

test.each(['result', 'class_link', 'landing'])('src %s is kept on remind_step', (src) => {
  expect(Push.stepEvent({ step: 'yes', lang: 'ur', src })).toEqual({ ok: 1 });
  expect(logEvent).toHaveBeenCalledWith('web_quiz.remind_step', { step: 'yes', lang: 'ur', src });
});
test('an unknown src is dropped, the step still logged', () => {
  Push.stepEvent({ step: 'shown', src: 'https://x' });
  expect(logEvent).toHaveBeenCalledWith('web_quiz.remind_step', { step: 'shown' });
});
