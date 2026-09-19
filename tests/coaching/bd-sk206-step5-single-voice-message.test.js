'use strict';
/**
 * bd-sk206 (DC feedback sheet row 132) — Step 5 sent the teacher two messages
 * that say the same thing.
 *
 * Quratulain, 18/9, on the NIETE bot: "In Step 5, two nearly identical messages
 * are being sent back-to-back — one saying the voice summary is being prepared,
 * and another right after saying 'yeh aapke liye audio mein khaas summary
 * tayyar kiya gaya hai'."
 *
 * It was never a double-send. Two DIFFERENT catalog strings were emitted once
 * each — `step5_voiceDebrief` as the progress announcement, `voiceSummaryReady`
 * as a caption for the audio that follows it. The defect is in the Urdu: the
 * caption was translated as a full restatement of the announcement rather than
 * as a caption, so the pair differs only by verb aspect —
 *
 *     …آواز میں خصوصی خلاصہ تیار کیا جا رہا ہے     "is being prepared"
 *     …آواز میں       خلاصہ تیار کیا گیا     ہے     "has been prepared"
 *
 * — one word, at the END of a long sentence. In English the step label and the
 * leading verb ("Creating…" vs "Here's…") carry the distinction up front, which
 * is why this only reads as a duplicate in Urdu.
 *
 * The announcement is the half that must stay: production sits a median 39.7s
 * between the two (586 NIETE sessions, 18 Sep 2026; min 15s, p95 55s, max 242s),
 * so dropping it would leave the teacher with a silent wait instead.
 *
 * Mocked at the network boundary only, matching bd-9h2mm-voice-not-assessed.
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendAudioFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
  uploadReportImage: jest.fn(),
  uploadReportPDF: jest.fn(),
}));
jest.mock('../../bot/shared/services/audio.service', () => ({
  generateSpeechForLanguage: jest.fn().mockResolvedValue(Buffer.alloc(32000)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('ur'),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    update: jest.fn(() => chain),
    select: jest.fn(() => chain),
    single: jest.fn().mockResolvedValue({ data: { analysis_data: {} }, error: null }),
    eq: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  return { from: jest.fn(() => chain) };
});

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const ReportGenerator = require('../../bot/shared/services/coaching/report-generator.service');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const create = jest.fn().mockResolvedValue({
  choices: [{ message: { content: 'بہت خوب۔ آپ نے آج سبق کا آغاز واضح انداز میں کیا۔' } }],
  usage: { prompt_tokens: 10, completion_tokens: 10 },
});
GPT5MiniService.openai = { chat: { completions: { create } } };

const C = fico.getScoringConstants();
const rows = (prefix, n, score) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, score, evidence: 'x' }));

function analysis() {
  const domains = {};
  for (const [key, def] of Object.entries(C.domains)) {
    domains[key] = { indicators: rows(def.key, def.indicatorCount, 1) };
  }
  return fico.computeScores({
    framework: 'fico',
    has_lesson_plan: true,
    fidelity_analysis: { score: 85, max_score: 100, overall_commentary: 'Followed closely.' },
    domains,
  });
}

const urduSession = {
  user_id: 'u1', session_id: 's1', transcript_language: 'ur',
  conversation_state: {}, users: { preferred_language: 'ur' },
};

const textsSent = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);

describe('bd-sk206 — Step 5 says it once', () => {
  beforeEach(() => {
    WhatsAppService.sendMessage.mockClear();
    WhatsAppService.sendAudioFromUrl.mockClear();
    create.mockClear();
  });

  test('THE BUG: an Urdu teacher gets ONE Step-5 text before her audio, not two', async () => {
    await ReportGenerator.generateAndSendVoiceDebrief(urduSession, '923000000000', 'cs1', analysis());

    expect(WhatsAppService.sendAudioFromUrl).toHaveBeenCalledTimes(1);
    expect(textsSent()).toEqual([getCoachingMessage('step5_voiceDebrief', 'ur')]);
  });

  test('the retired caption is not sent in either language', async () => {
    for (const lang of ['ur', 'en']) {
      WhatsAppService.sendMessage.mockClear();
      await ReportGenerator.generateAndSendVoiceDebrief(
        { ...urduSession, transcript_language: lang, users: { preferred_language: lang } },
        '923000000000', 'cs1', analysis(),
      );
      // Matched on the string itself, so the assertion still bites if the key is
      // renamed rather than removed.
      expect(textsSent()).not.toContain('🎤 یہ آپ کے لیے آواز میں تیار کیا گیا خلاصہ ہے:');
      expect(textsSent()).not.toContain("🎤 Here's your personalized voice summary:");
    }
  });

  test('the announcement — the half that covers the ~40s wait — still goes out', async () => {
    await ReportGenerator.generateAndSendVoiceDebrief(urduSession, '923000000000', 'cs1', analysis());
    expect(textsSent()).toContain(getCoachingMessage('step5_voiceDebrief', 'ur'));
  });
});
