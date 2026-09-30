'use strict';
/**
 * ElevenLabs — the voice every NIETE voice note used before the gateway, and
 * the first fallback behind any other provider.
 *
 * Deliberately a thin adapter: it sends exactly what the pre-gateway path sent
 * (same voices from VOICE_MODELS, same Urdu clean-up, same voice settings, same
 * Ogg Opus format), so leaving TTS_PROVIDER unset changes nothing a teacher
 * hears. The fallback to OpenAI now belongs to the gateway's chain, not to this
 * adapter, so a failure here is reported once and handled once.
 */

const { normalizeFor } = require('../text/normalizers');

// Video narration always used the expressive settings (its prompts write
// emotion tags into every line); every other use case keeps the per-language
// settings the ElevenLabs service chooses.
const VIDEO_VOICE_SETTINGS = Object.freeze({ stability: 0.0, similarity_boost: 0.75 });

function voiceModel(language) {
  const { VOICE_MODELS } = require('../../../utils/constants');
  const model = VOICE_MODELS[language];
  return model && model.provider === 'elevenlabs' ? model : null;
}

function createElevenLabsProvider({ env = process.env, service } = {}) {
  const elevenLabs = () => service || require('../../elevenlabs.service');
  return {
    name: 'elevenlabs',
    isConfigured: () => Boolean(env.ELEVENLABS_API_KEY),
    supports: (language) => Boolean(voiceModel(language)),
    voiceFor: (language) => (voiceModel(language) || {}).voiceId || null,
    async synthesize({ text, language, useCase }) {
      const model = voiceModel(language);
      // The Urdu voice renders bare digits as gibberish and reads Markdown
      // markers aloud; the clean-up has run on this path since it was chosen.
      const textSent = normalizeFor(language, text);
      const settings = useCase === 'video' ? { ...VIDEO_VOICE_SETTINGS } : undefined;
      const audio = await elevenLabs().generateSpeechWithVoice(textSent, model.voiceId, language, settings);
      return { audio, voice: model.voiceId, model: 'eleven_v3', parts: 1, attempts: 1, textSent, dropped: [] };
    },
  };
}

module.exports = { createElevenLabsProvider, elevenLabsProvider: createElevenLabsProvider() };
