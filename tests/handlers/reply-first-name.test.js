'use strict';
/**
 * A teacher is addressed by their first name, not their whole name.
 *
 * The reply prompt says "The teacher's name is <name>. Use their name
 * naturally". When users.name became the only name column, both reply paths
 * started passing users.name — the WHOLE name — where they had passed a first
 * name. On production the name handed to the model was essentially never
 * multi-word before that change (2 of ~450 named replies on 12–13 Sep); on
 * 15 Sep 2,254 named replies carried a multi-word name, and the model spoke the
 * full name in 30 of them. person-name.js already computes the first name at
 * render time; these paths must use it.
 */

const mockGetResponse = jest.fn(async () => 'Sure, happy to help.');

jest.mock('../../bot/shared/services/openai.service', () => ({
  getResponseWithFormat: (...args) => mockGetResponse(...args),
}));
jest.mock('../../bot/shared/services/context.service', () => ({
  shouldInjectContext: () => ({ shouldInject: false }),
  getUserFeatureContext: jest.fn(async () => null),
}));
jest.mock('../../bot/shared/services/lp-context.service', () => ({
  injectLpContext: jest.fn(async ({ existingContext }) => existingContext || null),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => new Proxy({}, {
  get: () => jest.fn(async () => true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const { handleGeneralConversation } = require('../../bot/shared/handlers/text-message.handler');

const teacher = (name) => ({ id: 'u-1', phone_number: '920000000000', name, persona: null, preferred_language: 'en' });
const run = async (user) => {
  mockGetResponse.mockClear();
  await handleGeneralConversation('920000000000', 'How do I start a lesson on fractions?', user, 's-1', 'en', { stop() {} })
    .catch(() => {}); // anything after the model call is out of scope here
  expect(mockGetResponse).toHaveBeenCalled();
  return mockGetResponse.mock.calls[0][4]; // the firstName argument
};

describe('text replies — the name handed to the model', () => {
  test('a multi-word name reaches the model as its first word', async () => {
    expect(await run(teacher('Muhammad Asif Khan'))).toBe('Muhammad');
  });

  test('a one-word name is unchanged', async () => {
    expect(await run(teacher('Ayesha'))).toBe('Ayesha');
  });

  test('extra whitespace does not leak into the name', async () => {
    expect(await run(teacher('  Sana   Bibi '))).toBe('Sana');
  });

  test('no name means no name, never an empty string', async () => {
    expect(await run(teacher(''))).toBeNull();
    expect(await run(teacher(null))).toBeNull();
  });
});

describe('voice replies — the name handed to the model', () => {
  // The voice handler exports no entry that reaches the reply step without the
  // whole audio pipeline mocked, so this follows the repo's pattern for that
  // handler (voice-reply-language-clamp.test.js): the structure must hold.
  const fs = require('fs');
  const path = require('path');
  const CODE = fs.readFileSync(path.join(__dirname, '../../bot/shared/handlers/voice-message.handler.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('the reply name comes from firstNameOf, not the whole users.name', () => {
    expect(CODE).toMatch(/require\([^)]*person-name[^)]*\)/);
    expect(CODE).toMatch(/const firstName = firstNameOf\(user\)/);
    expect(CODE).not.toMatch(/const firstName = user\?\.name/);
  });
});
