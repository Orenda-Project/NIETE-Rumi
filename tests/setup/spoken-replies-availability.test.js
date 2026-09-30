/**
 * Spoken replies are available with ANY configured voice provider (red first).
 *
 * The presence gate named one vendor's key, so a deployment speaking through
 * Soniox (TTS_PROVIDER=soniox) with no ElevenLabs key was reported by setup and
 * doctor as having spoken replies switched off, although every voice note worked.
 * The voice gateway can speak with ElevenLabs, Soniox or OpenAI; any one key
 * turns the feature on.
 */

const { FEATURES, isFeatureAvailable } = require('../../bot/shared/config/feature-availability');

const spoken = () => FEATURES.find((f) => /spoken replies/i.test(f.name));

test('one entry describes spoken replies, without naming a single vendor as the requirement', () => {
  expect(spoken()).toBeDefined();
  expect(spoken().keysAny).toEqual(expect.arrayContaining(['ELEVENLABS_API_KEY', 'SONIOX_API_KEY', 'OPENAI_API_KEY']));
});

test.each([
  [{ SONIOX_API_KEY: 'k' }, true],
  [{ ELEVENLABS_API_KEY: 'k' }, true],
  [{ OPENAI_API_KEY: 'k' }, true],
  [{}, false],
])('available with %o → %s', (env, expected) => {
  expect(isFeatureAvailable(spoken(), env)).toBe(expected);
});
