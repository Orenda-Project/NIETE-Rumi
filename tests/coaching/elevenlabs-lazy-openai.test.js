/**
 * ElevenLabs OpenAI-client lazy initialization regression.
 *
 * Locks the architectural fix: the OpenAI client used as the TTS fallback
 * MUST NOT be constructed at module load time. Construction is deferred until
 * the `ElevenLabsService.openai` getter is first accessed; that access throws
 * a clear error if `OPENAI_API_KEY` is missing.
 *
 * Before this fix, `static openai = new OpenAI({ apiKey: OPENAI_API_KEY })`
 * threw `OpenAIError: Missing credentials` at module load whenever
 * `OPENAI_API_KEY` was unset — which crashed the bot at cold-boot despite
 * `OPENAI_API_KEY` being documented as an optional feature key.
 */

// Virtual-mock the bot-only npm deps so this test runs in CI-condition
// (root jest pass; bot/node_modules absent).
jest.mock('axios', () => ({ post: jest.fn() }), { virtual: true });
jest.mock('openai', () => {
  return class MockOpenAI { constructor() {} };
}, { virtual: true });

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({
  ELEVENLABS_API_KEY: 'placeholder',
  ELEVENLABS_VOICE_ID: 'placeholder',
  ELEVENLABS_SPANISH_VOICE_ID: 'placeholder',
  ELEVENLABS_ARABIC_VOICE_ID: 'placeholder',
  VOICE_MODELS: {},
  OPENAI_API_KEY: '', // SIMULATES the cold-boot scenario where the key is absent.
}));

describe('ElevenLabsService — lazy OpenAI client initialization', () => {
  it('requiring the module does NOT construct an OpenAI client', () => {
    // If construction were not lazy, require() itself would throw.
    expect(() => {
      jest.isolateModules(() => {
        require('../../bot/shared/services/elevenlabs.service');
      });
    }).not.toThrow();
  });

  it('the source defines a getter (lazy), not an eager initializer', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../bot/shared/services/elevenlabs.service.js'),
      'utf8'
    );
    // Eager init pattern must not exist anywhere
    expect(src).not.toMatch(/static\s+openai\s*=\s*new\s+OpenAI/);
    // Lazy getter pattern must exist
    expect(src).toMatch(/static\s+get\s+openai\s*\(\s*\)\s*\{/);
  });

  it('accessing .openai without OPENAI_API_KEY throws a CLEAR error', () => {
    let ElevenLabsService;
    jest.isolateModules(() => {
      ElevenLabsService = require('../../bot/shared/services/elevenlabs.service');
    });
    expect(() => ElevenLabsService.openai).toThrow(/OPENAI_API_KEY is required/);
  });
});

describe('ElevenLabsService — OPENAI_API_KEY present', () => {
  it('constructs the client on first access AND caches it', () => {
    jest.resetModules();
    jest.doMock('axios', () => ({ post: jest.fn() }), { virtual: true });
    jest.doMock('openai', () => class MockOpenAI { constructor() {} }, { virtual: true });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/utils/constants', () => ({
      ELEVENLABS_API_KEY: 'placeholder',
      ELEVENLABS_VOICE_ID: 'placeholder',
      ELEVENLABS_SPANISH_VOICE_ID: 'placeholder',
      ELEVENLABS_ARABIC_VOICE_ID: 'placeholder',
      VOICE_MODELS: {},
      OPENAI_API_KEY: 'sk-test-placeholder',
    }));
    const ElevenLabsService = require('../../bot/shared/services/elevenlabs.service');
    const a = ElevenLabsService.openai;
    expect(a).toBeDefined();
    // Cached — second access returns the same instance.
    expect(ElevenLabsService.openai).toBe(a);
  });
});
