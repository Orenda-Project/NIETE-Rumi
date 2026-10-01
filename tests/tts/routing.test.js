/**
 * Which voice provider speaks for a use case (red first).
 *
 * The provider is configuration, not code: one variable moves every voice note
 * (TTS_PROVIDER), and a use case — or one site inside it — can be moved on its
 * own (TTS_PROVIDER_<USE_CASE>, TTS_PROVIDER_<USE_CASE>_<SITE>). The rest of the
 * chain is the fallback order. With nothing set the chain is exactly today's:
 * ElevenLabs, then OpenAI.
 */

const { resolveChain, USE_CASES } = require('../../bot/shared/services/tts/routing');

describe('tts routing — resolveChain', () => {
  it('nothing set: ElevenLabs then OpenAI, for every use case', () => {
    for (const useCase of Object.keys(USE_CASES)) {
      expect(resolveChain({ useCase, env: {} }).chain).toEqual(['elevenlabs', 'openai']);
    }
  });

  it('TTS_PROVIDER moves every use case at once, keeping the fallbacks behind it', () => {
    const env = { TTS_PROVIDER: 'soniox' };
    for (const useCase of Object.keys(USE_CASES)) {
      expect(resolveChain({ useCase, env }).chain).toEqual(['soniox', 'elevenlabs', 'openai']);
    }
  });

  it('a use case can be moved on its own', () => {
    const env = { TTS_PROVIDER_COACHING: 'soniox' };
    expect(resolveChain({ useCase: 'coaching', env }).chain).toEqual(['soniox', 'elevenlabs', 'openai']);
    expect(resolveChain({ useCase: 'conversation', env }).chain).toEqual(['elevenlabs', 'openai']);
  });

  it('a use-case setting beats the global one, and a site setting beats both', () => {
    const env = {
      TTS_PROVIDER: 'soniox',
      TTS_PROVIDER_COACHING: 'elevenlabs',
      TTS_PROVIDER_COACHING_REPORT_VOICENOTE: 'soniox',
    };
    expect(resolveChain({ useCase: 'coaching', site: 'question', env }).chain).toEqual(['elevenlabs', 'openai']);
    expect(resolveChain({ useCase: 'coaching', site: 'report_voicenote', env }).chain)
      .toEqual(['soniox', 'elevenlabs', 'openai']);
    expect(resolveChain({ useCase: 'reading', env }).chain).toEqual(['soniox', 'elevenlabs', 'openai']);
  });

  it('TTS_FALLBACK sets the order behind the primary, without repeating it', () => {
    expect(resolveChain({ useCase: 'conversation', env: { TTS_PROVIDER: 'soniox', TTS_FALLBACK: 'openai' } }).chain)
      .toEqual(['soniox', 'openai']);
    expect(resolveChain({ useCase: 'conversation', env: { TTS_PROVIDER: 'soniox', TTS_FALLBACK: 'soniox, elevenlabs' } }).chain)
      .toEqual(['soniox', 'elevenlabs']);
    expect(resolveChain({ useCase: 'conversation', env: { TTS_FALLBACK: 'none' } }).chain).toEqual(['elevenlabs']);
  });

  it('names are case- and space-insensitive', () => {
    expect(resolveChain({ useCase: 'video', env: { TTS_PROVIDER: ' Soniox ' } }).chain)
      .toEqual(['soniox', 'elevenlabs', 'openai']);
  });

  it('an unknown provider name is ignored and reported, never silently used', () => {
    const r = resolveChain({ useCase: 'coaching', env: { TTS_PROVIDER: 'sonix', TTS_FALLBACK: 'elevenlabs,uplift' } });
    expect(r.chain).toEqual(['elevenlabs']);
    expect(r.ignored).toEqual(expect.arrayContaining(['TTS_PROVIDER=sonix', 'TTS_FALLBACK=uplift']));
  });

  it('an unknown use case is refused — every caller must say what it is', () => {
    expect(() => resolveChain({ useCase: 'chat', env: {} })).toThrow(/use case/i);
    expect(() => resolveChain({ env: {} })).toThrow(/use case/i);
  });

  it('reports which setting chose the primary, for the telemetry', () => {
    expect(resolveChain({ useCase: 'coaching', env: {} }).source).toBe('default');
    expect(resolveChain({ useCase: 'coaching', env: { TTS_PROVIDER: 'soniox' } }).source).toBe('TTS_PROVIDER');
    expect(resolveChain({ useCase: 'coaching', site: 'closer', env: { TTS_PROVIDER_COACHING_CLOSER: 'openai' } }).source)
      .toBe('TTS_PROVIDER_COACHING_CLOSER');
  });

  it('the use cases are the four the operator named, each listing its sites', () => {
    expect(Object.keys(USE_CASES).sort()).toEqual(['coaching', 'conversation', 'reading', 'video']);
    expect(USE_CASES.coaching.sites).toEqual(expect.arrayContaining(['question', 'closer', 'report_voicenote']));
    expect(USE_CASES.conversation.sites).toEqual(
      expect.arrayContaining(['voice_reply', 'language_switch', 'name_retry', 'name_question']),
    );
  });
});
