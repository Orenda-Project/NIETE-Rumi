'use strict';
/**
 * OpenAI text-to-speech — the last voice in the default chain, for when the
 * chosen provider and ElevenLabs both failed. It speaks every language, never
 * with emotion tags (they are stripped), and returns Ogg Opus like the others.
 *
 * Urdu text gets the same number clean-up as the ElevenLabs path: before the
 * gateway this fallback received the raw text and read its digits as it liked.
 */

const { normalizeForUrduTTS } = require('../../urdu-tts-normalizer');

function createOpenAiProvider({ env = process.env, service } = {}) {
  const elevenLabs = () => service || require('../../elevenlabs.service');
  return {
    name: 'openai',
    isConfigured: () => Boolean(env.OPENAI_API_KEY),
    supports: (language) => Boolean(language),
    voiceFor: () => 'openai-tts-1',
    async synthesize({ text, language }) {
      const textSent = String(language).split('-')[0] === 'ur' ? normalizeForUrduTTS(text) : text;
      const audio = await elevenLabs().generateSpeechOpenAI(textSent, language);
      return { audio, voice: 'openai-tts-1', model: 'tts-1', parts: 1, attempts: 1, textSent, dropped: [] };
    },
  };
}

module.exports = { createOpenAiProvider, openAiProvider: createOpenAiProvider() };
