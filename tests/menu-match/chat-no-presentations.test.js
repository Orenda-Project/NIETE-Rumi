'use strict';
/**
 * bd-xw56ed — the chat no longer offers to make presentations (operator, 20 Oct 2026: not a menu entry, so not
 * something a message is routed to).
 *
 * Until now the teacher prompt listed "CREATE presentations" among capabilities it must NEVER deny, with a
 * "I'm preparing an educational presentation for you" template — a promise nothing behind the chat keeps. Pinned
 * on the prompt the model actually receives, built by the real builder for every language and format NIETE serves.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const OpenAIService = require('../../bot/shared/services/openai.service');
const capabilities = require('../../bot/shared/config/capabilities.config');

// Any offer or promise to make one: "CREATE presentations", "preparing an educational presentation", the Urdu
// "پریزنٹیشن تیار کر رہی ہوں", a PRESENTATION response template.
const OFFERS_A_PRESENTATION = /(create|creating|preparing|make me)\b[^.\n]{0,40}presentation|presentation[^.\n]{0,10}requests?:|^-?\s*presentation:|پریزنٹیشن[^۔\n]{0,20}(تیار|بنائیں)/im;

describe.each([['en'], ['ur']])('the %s teacher prompt', (language) => {
  test.each([['text'], ['voice']])('%s: never offers a presentation, and says it does not make one', (format) => {
    const prompt = OpenAIService._getFormatAwareSystemPrompt(format, language, 'T');
    expect(prompt).not.toMatch(OFFERS_A_PRESENTATION);
    expect(prompt).toMatch(/you do not make presentations or slides/);
  });
});

test('the capabilities the help agent describes do not include presentations', () => {
  const list = capabilities.CAPABILITIES || capabilities.capabilities || capabilities;
  const ids = (Array.isArray(list) ? list : Object.values(list).find(Array.isArray) || []).map((c) => c.id);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids).not.toContain('presentations');
});
