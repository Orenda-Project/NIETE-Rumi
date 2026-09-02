const axios = require('axios');
const OpenAI = require('openai');
const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_SPANISH_VOICE_ID,
  ELEVENLABS_ARABIC_VOICE_ID,
  VOICE_MODELS,
  OPENAI_API_KEY
} = require('../utils/constants');
const { logToFile } = require('../utils/logger');
const { normalizeForUrduTTS } = require('./urdu-tts-normalizer');

/**
 * ElevenLabs Service (Phase 3: Multi-language support)
 * Handles text-to-speech for English, Spanish, and Arabic with emotional expressiveness
 * Uses ElevenLabs Eleven v3 model with emotion tag support
 * Supports audio tags like [laughs], [whispers], [excited] and creative tags like [warmly], [thoughtfully]
 * v3 gracefully ignores unsupported tags, allowing creative emotional direction
 * Includes OpenAI TTS fallback for all languages
 */
class ElevenLabsService {
  /**
   * POST one TTS request, falling back to ELEVENLABS_FALLBACK_API_KEY on
   * QUOTA/LIMIT errors only (bd-errbx). The NIETE workspace (Pro, 1.08M
   * chars/mo) hit 95% eight days into a cycle; when it runs dry the same
   * Sara/Jessica voice IDs resolve on the global Rumi workspace — proven in
   * production (the corpus fleet rendered on the global key with the same
   * IDs). Scope is deliberate:
   *   401 quota_exceeded / 429 throttle → retry once on the fallback key.
   *   Anything else → throw unchanged; the callers' OpenAI-TTS fallback
   *   remains the net for true outages. Never burn the fallback on a 500.
   * @private
   */
  static async _postTts(url, body) {
    // Staging-only record/replay of the synthesized audio (E2E_CASSETTE) — the axios response is
    // reduced to {data, status, headers} with the audio as base64 so it survives JSON.
    const cassette = require('./e2e-cassette');
    if (cassette.mode() === 'off') return this._postTtsLive(url, body);
    return cassette.wrap('tts', { url, body }, () => this._postTtsLive(url, body), {
      serialize: r => ({ status: r.status, headers: { 'content-type': r.headers && r.headers['content-type'] }, b64: Buffer.from(r.data).toString('base64') }),
      deserialize: s => ({ status: s.status, headers: s.headers || {}, data: Buffer.from(s.b64, 'base64') }),
    });
  }

  static async _postTtsLive(url, body) {
    const post = (key) => axios.post(url, body, {
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 120000,
    });

    try {
      return await post(ELEVENLABS_API_KEY);
    } catch (error) {
      const fallbackKey = process.env.ELEVENLABS_FALLBACK_API_KEY;
      if (!fallbackKey || !ElevenLabsService._isQuotaError(error)) throw error;
      logToFile('⚠️ ElevenLabs primary key exhausted/throttled — retrying on fallback key', {
        status: error.response?.status,
      });
      return await post(fallbackKey);
    }
  }

  /**
   * TRUE only when the key has genuinely RUN OUT of characters (operator,
   * 2026-08-23: "use fallback only if main NIETE key runs out"). A 429 is
   * load, not exhaustion — falling back on it would silently shift NIETE's
   * concurrency spikes onto the shared global workspace. A bare/unparseable
   * 401 is a credentials problem, not quota. Both throw unchanged.
   * @private
   */
  static _isQuotaError(error) {
    if (error.response?.status !== 401) return false;
    try {
      const parsed = JSON.parse(Buffer.from(error.response?.data || '').toString('utf8'));
      return parsed?.detail?.status === 'quota_exceeded';
    } catch (_) {
      return false;
    }
  }

  // OpenAI client is lazy-initialized. Constructing it at module-load time
  // threw `OpenAIError: Missing credentials` whenever OPENAI_API_KEY was
  // unset, which crashed the bot at cold-boot even though OPENAI_API_KEY is
  // documented as an optional key (used here only as a TTS fallback when
  // ElevenLabs is unreachable). With lazy init, the bot boots cleanly without
  // it; the only call site that needs the key (the OpenAI TTS fallback below)
  // throws a clear error if invoked without a key set.
  static _openai = null;
  static get openai() {
    if (!ElevenLabsService._openai) {
      if (!OPENAI_API_KEY) {
        throw new Error(
          'OPENAI_API_KEY is required for the ElevenLabs OpenAI-TTS fallback. ' +
          'Set OPENAI_API_KEY in .env or avoid calling the fallback path.'
        );
      }
      ElevenLabsService._openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    }
    return ElevenLabsService._openai;
  }

  /**
   * Generate speech from text using ElevenLabs (Jessica voice with emotion support)
   * @param {string} text - Text to convert to speech (can include emotion tags like [warmly])
   * @returns {Promise<Buffer>} Audio buffer (MP3 format)
   */
  static async generateSpeech(text) {
    try {
      logToFile('Generating speech with ElevenLabs', {
        textLength: text.length,
        textSample: text.substring(0, 100),
        voiceId: ELEVENLABS_VOICE_ID,
        hasEmotionTags: /\[[\w]+\]/.test(text)
      });

      // bd-z5olm: Ogg Opus, not MP3 — WhatsApp renders opus audio as a real
      // VOICE message (waveform + speed control), exactly like the LP
      // voicenotes. Probed live 2026-08-21: eleven_v3 returns OggS bytes.
      const response = await ElevenLabsService._postTts(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=opus_48000_64`,
        {
          text: text,
          model_id: 'eleven_v3', // v3 supports audio tags and emotion control
          voice_settings: {
            stability: 0.0, // 0.0 = Creative (best for expressiveness with audio tags)
            similarity_boost: 0.75, // How closely to match the voice
            style: 0.0, // Style exaggeration (0 = natural)
            use_speaker_boost: true // Enhance speaker clarity
          }
        }
      );

      const audioBuffer = Buffer.from(response.data);

      logToFile('✅ ElevenLabs speech generated successfully', {
        audioSize: audioBuffer.length,
        voiceId: ELEVENLABS_VOICE_ID
      });

      return audioBuffer;

    } catch (error) {
      logToFile('❌ Error generating speech with ElevenLabs', {
        error: error.message,
        status: error.response?.status,
        errorDetails: error.response?.data?.toString() || 'No details'
      });

      // Log specific error types
      if (error.response?.status === 401) {
        logToFile('❌ ElevenLabs authentication failed - check API key');
      } else if (error.response?.status === 429) {
        logToFile('❌ ElevenLabs rate limit exceeded');
      } else if (error.response?.status === 400) {
        logToFile('❌ ElevenLabs bad request - check text formatting');
      }

      throw error;
    }
  }

  /**
   * Generate speech for any language using appropriate voice model
   * Routes to correct provider based on language (Phase 3: Multi-language)
   *
   * @param {string} text - Text to convert to speech (can include emotion tags for en/es/ar)
   * @param {string} languageCode - Language code (en, es, ur, ar)
   * @returns {Promise<Buffer>} Audio buffer (MP3 or OGG format)
   */
  static async generateSpeechForLanguage(text, languageCode = 'en') {
    const voiceConfig = VOICE_MODELS[languageCode];

    if (!voiceConfig) {
      logToFile('⚠️  Unsupported language code, falling back to English', {
        requestedLanguage: languageCode,
        fallbackLanguage: 'en'
      });
      return this.generateSpeech(text);
    }

    try {
      if (voiceConfig.provider === 'elevenlabs') {
        // Use ElevenLabs for en/es/ar/ur. bd-2375: Urdu goes to Sara — run the
        // runtime discipline (inline digits → English words, strip Markdown) so
        // Sara doesn't render "3" as gibberish or read "**" aloud.
        const ttsText = languageCode === 'ur' ? normalizeForUrduTTS(text) : text;
        return await this.generateSpeechWithVoice(ttsText, voiceConfig.voiceId, languageCode);
      } else if (voiceConfig.provider === 'uplift') {
        // Use Uplift for Urdu (existing integration in audio.service)
        const AudioService = require('./audio.service');
        return await AudioService.generateSpeech(text);
      }
    } catch (error) {
      logToFile('❌ Primary TTS provider failed, attempting OpenAI fallback', {
        language: languageCode,
        provider: voiceConfig.provider,
        error: error.message
      });

      // Fallback to OpenAI TTS
      return await this.generateSpeechOpenAI(text, languageCode);
    }
  }

  /**
   * Generate speech using specific ElevenLabs voice ID
   * Supports emotion tags for English, Spanish, and Arabic
   *
   * @param {string} text - Text to convert to speech
   * @param {string} voiceId - ElevenLabs voice ID
   * @param {string} languageCode - Language code for logging
   * @returns {Promise<Buffer>} Audio buffer (MP3 format)
   */
  static async generateSpeechWithVoice(text, voiceId, languageCode) {
    try {
      logToFile('Generating speech with ElevenLabs', {
        textLength: text.length,
        textSample: text.substring(0, 100),
        voiceId,
        language: languageCode,
        hasEmotionTags: /\[[\w]+\]/.test(text)
      });

      // bd-2375: Sara (Urdu) reads best at the LP-voicenotes V20 settings —
      // higher stability keeps Nastaliq + code-switched English steady. The
      // expressive 0.0-stability profile stays for en/es/ar (audio tags).
      const voiceSettings = languageCode === 'ur'
        ? { stability: 0.7, similarity_boost: 0.85, style: 0.0, use_speaker_boost: true }
        : { stability: 0.0, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true };

      // bd-z5olm: Ogg Opus for the WhatsApp voice bubble — see generateSpeech.
      const response = await ElevenLabsService._postTts(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=opus_48000_64`,
        {
          text: text,
          model_id: 'eleven_v3', // v3 supports audio tags and emotion control
          voice_settings: voiceSettings
        }
      );

      const audioBuffer = Buffer.from(response.data);

      logToFile('✅ ElevenLabs speech generated successfully', {
        audioSize: audioBuffer.length,
        voiceId,
        language: languageCode
      });

      return audioBuffer;

    } catch (error) {
      logToFile('❌ Error generating speech with ElevenLabs', {
        language: languageCode,
        voiceId,
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Generate speech using OpenAI TTS (fallback for all languages)
   * Used as fallback when ElevenLabs/Uplift fails, or for Tier 3 languages
   *
   * @param {string} text - Text to convert to speech (emotion tags will be stripped)
   * @param {string} languageCode - Language code (en, es, ur, ar, pa-PK, ps-PK, sd-PK, bal-PK, ta-LK)
   * @returns {Promise<Buffer>} Audio buffer (MP3 format)
   */
  static async generateSpeechOpenAI(text, languageCode = 'en') {
    try {
      // Strip emotion tags for OpenAI (doesn't support them)
      const cleanText = text.replace(/\[[\w\s]+\]/g, '').trim();

      logToFile('Generating speech with OpenAI TTS fallback', {
        textLength: cleanText.length,
        language: languageCode,
        strippedEmotionTags: text !== cleanText
      });

      // OpenAI voice mapping (best voices for each language/region)
      const openaiVoices = {
        // Tier 1/2 languages (fallback when primary fails)
        en: 'nova',      // Female, warm, engaging
        es: 'nova',      // Works well for Spanish
        ur: 'shimmer',   // Clear pronunciation for Urdu
        ar: 'alloy',     // Neutral, works for Arabic

        // New languages (December 2025)
        'pa-PK': 'shimmer',  // Pakistani Punjabi
        'ps-PK': 'shimmer',  // Pakistani Pashto
        'sd-PK': 'shimmer',  // Sindhi
        'bal-PK': 'shimmer', // Balochi
        'ta-LK': 'nova',     // Sri Lankan Tamil

        // Common Tier 3 languages (direct OpenAI TTS)
        hi: 'shimmer',   // Hindi
        bn: 'shimmer',   // Bengali
        fr: 'nova',      // French
        de: 'onyx',      // German
        pt: 'nova',      // Portuguese
        tr: 'alloy',     // Turkish
        fa: 'shimmer'    // Farsi/Persian
      };

      const voice = openaiVoices[languageCode] || 'nova';

      // bd-z5olm: opus here too, so the fallback keeps the voice bubble.
      // OpenAI's 'opus' response_format is Ogg-contained — same container the
      // ElevenLabs path now returns and sendAudio sniffs for.
      const speech = await this.openai.audio.speech.create({
        model: 'tts-1',
        voice: voice,
        input: cleanText,
        response_format: 'opus',
        speed: 1.0
      });

      const buffer = Buffer.from(await speech.arrayBuffer());

      logToFile('✅ OpenAI TTS generated successfully', {
        audioSize: buffer.length,
        language: languageCode,
        voice
      });

      return buffer;

    } catch (error) {
      logToFile('❌ Error generating speech with OpenAI TTS', {
        language: languageCode,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Test the ElevenLabs API connection
   * @returns {Promise<boolean>} True if connection successful
   */
  static async testConnection() {
    try {
      const testText = '[warmly] Hello! This is a test of the ElevenLabs text-to-speech service.';
      await this.generateSpeech(testText);
      logToFile('✅ ElevenLabs connection test successful');
      return true;
    } catch (error) {
      logToFile('❌ ElevenLabs connection test failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get available voices from ElevenLabs
   * @returns {Promise<Array>} List of available voices
   */
  static async getAvailableVoices() {
    try {
      const response = await axios.get(
        'https://api.elevenlabs.io/v1/voices',
        {
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY
          }
        }
      );

      return response.data.voices;
    } catch (error) {
      logToFile('Error fetching ElevenLabs voices', { error: error.message });
      throw error;
    }
  }
}

module.exports = ElevenLabsService;
