'use strict';
/**
 * bd-r2uzg1.18.4 — the teacher's DC report: the analysis it is rendered from and the voice note she hears.
 *
 * At report time the stored analysis is rewritten whole by the reflection pass (enhanceAnalysisWithReflections:
 * focus area, strengths, recommendations, the debrief reflection), and the report image, the PDF and the report page
 * read that copy. The voice note's script is written by the model from it and spoken by TTS.
 *
 * Mocked at the network boundary only (the chat completion, TTS, R2, Supabase, WhatsApp), as
 * bd-9h2mm-voice-not-assessed.test.js does. Strings are made up, shaped like the prod samples.
 */

const updates = [];

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendAudioFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.ogg'),
  uploadReportImage: jest.fn(),
  uploadReportPDF: jest.fn(),
}));
jest.mock('../../bot/shared/services/tts', () => ({
  synthesize: jest.fn().mockResolvedValue({ audio: Buffer.alloc(32000), mimeType: 'audio/ogg', extension: 'ogg', durationSec: 2 }),
}));
jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('ur'),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    update: jest.fn((patch) => { updates.push(patch); return chain; }),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn().mockResolvedValue({ data: { analysis_data: {} }, error: null }),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => chain) };
});

// The model boundary, as voice-debrief-says-score.test.js mocks it: the real methods run on a stubbed client.
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));

const { hasDevanagari } = require('../../bot/shared/utils/devanagari-guard');
const tts = require('../../bot/shared/services/tts');
const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const ReportGenerator = require('../../bot/shared/services/coaching/report-generator.service');

const UR_WITH_HINDI_WORD = 'استاد نے گہرے سوچنے کے मौके محدود کیے';
const UR_PREFIX = 'استاد نے گہرے سوچنے کے ';
const MIXED_QUOTE = 'Teacher: "अच्छा, अब बताइए" — بچوں نے جواب دیا';
const CLEAN_UR = 'آپ نے بچوں کو سوچنے کا وقت دیا۔';
const deepHasDevanagari = (v) => hasDevanagari(JSON.stringify(v));


beforeEach(() => {
  updates.length = 0;
  mockCreate.mockReset();
  tts.synthesize.mockClear();
});

describe('the reflection pass: what the report is rendered from', () => {
  test('enhanceAnalysisWithReflections returns and stores an analysis with no Devanagari', async () => {
    const spy = jest.spyOn(GPT5MiniService, 'enhanceAnalysisWithReflections').mockResolvedValue({
      framework: 'fico',
      scores: { overall_marks: 40 },
      focus_area: { rationale: UR_WITH_HINDI_WORD, try_this_tomorrow: CLEAN_UR },
      strengths: [{ evidence: MIXED_QUOTE }],
      recommendations: [UR_WITH_HINDI_WORD],
      debrief_reflection: { q1: { note: UR_WITH_HINDI_WORD } },
    });
    const session = { id: 'cs-1', user_id: 'u-1', analysis_data: {}, transcript_text: 't', conversation_state: { questions: [] } };
    const out = await ReportGenerator.enhanceAnalysisWithReflections(session);

    expect(deepHasDevanagari(out)).toBe(false);
    expect(out.focus_area.rationale.startsWith(UR_PREFIX)).toBe(true);
    expect(out.focus_area.try_this_tomorrow).toBe(CLEAN_UR);
    expect(out.scores).toEqual({ overall_marks: 40 });
    const written = updates.find((u) => u && u.analysis_data);
    expect(written).toBeTruthy();
    expect(deepHasDevanagari(written.analysis_data)).toBe(false);
    spy.mockRestore();
  });
});

describe('the voice note', () => {
  test('TTS is handed a script with no Devanagari, and the stored script is the same clean text', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: `السلام علیکم۔ ${UR_WITH_HINDI_WORD}` } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
    const session = { user_id: 'u1', session_id: 's1', transcript_language: 'ur', conversation_state: {}, users: { preferred_language: 'ur' } };
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', { framework: 'fico', domains: {} });

    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    const spoken = tts.synthesize.mock.calls[0][0].text;
    expect(hasDevanagari(spoken)).toBe(false);
    expect(spoken.startsWith(`السلام علیکم۔ ${UR_PREFIX}`)).toBe(true);
    const stored = updates.find((u) => u && u.analysis_data && u.analysis_data.voice_debrief_script);
    expect(stored).toBeTruthy();
    expect(stored.analysis_data.voice_debrief_script).toBe(spoken);
  });
});
