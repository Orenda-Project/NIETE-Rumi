/**
 * bd-oxu2q — the two things the first live Uplift test call surfaced.
 *
 * Evidence, from the staging call at 11:30:26Z (caller 923365709413, 39s):
 *
 *   assistant  Assalamu alaikum، میں نیت ہوں۔ بتائیے، آپ آج کس چیز میں مدد چاہتے ہیں؟
 *   caller     آ حظ لیسن گلو کے بارے میں بتائیں
 *   assistant  میں وہ سبق دیکھتی ہوں جو آپ نے پہلے سے لیا ہے…
 *   caller     دوسرا آخری والا
 *   assistant  I'm trying to pull up the Grade 4 math Chapter 3 "Marvels of Multiplication…"
 *              lesson, but the system is showing multiple matches.       ← full English
 *
 * 1. THE CODE SWITCH. Her record says `en`; she spoke Urdu throughout. The prompt
 *    tells the model to switch and "stay switched" — and then, six lines later,
 *    licenses it to "mix naturally with her". Those cannot both be followed, so
 *    "stay switched" carries no force and the model drops back to the record's
 *    language on the first turn that feels mechanical. This is a contradiction to
 *    REMOVE, not a rule to add: mixing means English TERMS inside an Urdu
 *    sentence, never answering an Urdu question in English prose.
 *
 * 2. THE VOICE. The same `en` record meant the Uplift gate declined the call —
 *    log: "[calls] external voice not used for this language — OpenAI voice
 *    {language: en}", and the persisted row says voice: marin. Correct by the
 *    code as written, but it made the voice untestable by the one person who
 *    needed to hear it. Which languages the external voice may speak is DATA, so
 *    it belongs in config, not in a hardcoded array.
 */

const { buildCallPrompt } = require('../../shared/calls/call-prompt.service');

describe('language — following her without dissolving into a mix', () => {
  test('the prompt does not both order "stay switched" AND license free mixing', () => {
    const p = buildCallPrompt({ language: 'en', callerName: 'Ayesha' });
    // The switching rule must survive; the blanket mixing license must not.
    expect(p).toMatch(/stay switched/i);
    expect(p).not.toMatch(/mix naturally with her/i);
  });

  test('mixing is scoped to TERMS inside a sentence, not whole-turn language', () => {
    const p = buildCallPrompt({ language: 'en' });
    // Whatever wording it lands on, it has to distinguish borrowing a term from
    // answering in the other language.
    expect(p).toMatch(/English (technical )?terms|loanword|individual (English )?words/i);
    expect(p).toMatch(/whole|entire|full (sentence|turn|reply)|do not answer .* in English/i);
  });

  test('the record is named as a STARTING point in both directions', () => {
    expect(buildCallPrompt({ language: 'ur' })).toMatch(/Start in Urdu/);
    expect(buildCallPrompt({ language: 'en' })).toMatch(/Start in English/);
  });
});

describe('which languages the external voice may speak is configuration', () => {
  const { getCallsConfig } = require('../../shared/calls/calls-config');

  afterEach(() => { delete process.env.UPLIFT_LANGUAGES; });

  test('defaults to Urdu only — the voice model is an Urdu one', () => {
    expect(getCallsConfig().uplift.languages).toEqual(['ur']);
  });

  test('a deployment can widen it without a code change', () => {
    process.env.UPLIFT_LANGUAGES = 'ur,en';
    expect(getCallsConfig().uplift.languages).toEqual(['ur', 'en']);
  });

  test('whitespace and case in the env value do not silently break the match', () => {
    process.env.UPLIFT_LANGUAGES = ' UR , En ';
    expect(getCallsConfig().uplift.languages).toEqual(['ur', 'en']);
  });

  test('an empty value falls back to the default rather than disabling everything', () => {
    process.env.UPLIFT_LANGUAGES = '   ';
    expect(getCallsConfig().uplift.languages).toEqual(['ur']);
  });
});

describe('the session honours the configured language set', () => {
  const CallSession = require('../../shared/calls/call-session');

  function build({ language, upliftLanguages }) {
    const peer = {
      createAnswer: jest.fn(async () => 'ANSWER'),
      onCallerAudio: jest.fn(), onStateChange: jest.fn(),
      playAssistantAudio: jest.fn(), playAssistantPcm48k: jest.fn(),
      flushPlayout: jest.fn(), setTyping: jest.fn(), close: jest.fn(),
    };
    const realtime = { connect: jest.fn(), appendAudio: jest.fn(), appendInstructions: jest.fn(), getInstructions: jest.fn(), close: jest.fn() };
    const tts = {
      ready: false,
      connect: jest.fn(function c() { this.ready = true; return Promise.resolve(); }),
      speak: jest.fn(), cancel: jest.fn(), close: jest.fn(),
    };
    const session = new CallSession({
      callId: 'C1', from: '923365709413', callerName: 'Ayesha',
      createPeer: () => peer,
      createRealtime: (o) => { realtime._opts = o; return realtime; },
      createTts: () => tts,
      buildInstructions: async () => ({ instructions: 'P', language }),
      callsApi: { terminate: jest.fn(async () => ({})) },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      config: { maxSeconds: 300, wrapUpSeconds: 270, silenceTimeoutMs: 60000, watchdogTickMs: 5000, upliftLanguages },
    });
    return { session, realtime, tts };
  }

  test('an English caller reaches the external voice when the config allows en', async () => {
    const { session, realtime } = build({ language: 'en', upliftLanguages: ['ur', 'en'] });
    await session.createAnswer('OFFER');
    expect(realtime._opts.outputMode).toBe('text');
  });

  test('and does not when it does not', async () => {
    const { session, realtime } = build({ language: 'en', upliftLanguages: ['ur'] });
    await session.createAnswer('OFFER');
    expect(realtime._opts.outputMode).toBe('audio');
  });
});

describe('one Rumi voice — the calls voice defaults to the product voice', () => {
  const { getCallsConfig } = require('../../shared/calls/calls-config');

  afterEach(() => {
    delete process.env.UPLIFT_VOICE_ID;
    delete process.env.UPLIFT_VOICE_ID_UR;
  });

  test('with nothing set, calls use the same Urdu voice as voice notes', () => {
    // constants.js already speaks Sindhi/Balochi voice notes through Uplift and
    // uses v_8eelc901 for Urdu. A teacher should hear ONE Rumi whether she plays
    // a voice note or rings up, so the two must not drift apart by default.
    expect(getCallsConfig().uplift.voiceId).toBe('v_8eelc901');
  });

  test('the product-wide Urdu voice is honoured when it is configured', () => {
    process.env.UPLIFT_VOICE_ID_UR = 'v_product';
    expect(getCallsConfig().uplift.voiceId).toBe('v_product');
  });

  test('UPLIFT_VOICE_ID gives calls a different voice when that is wanted', () => {
    process.env.UPLIFT_VOICE_ID_UR = 'v_product';
    process.env.UPLIFT_VOICE_ID = 'v_meklc281';
    expect(getCallsConfig().uplift.voiceId).toBe('v_meklc281');
  });
});
