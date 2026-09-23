/**
 * DC:137 (bd-fmr3s) — the session-complete line and the commitment question are
 * ONE message, with session-completion LEADING.
 *
 * Qurat (ICT, 2026-09-22): "Currently, after the voice note, DC sends two separate
 * messages back-to-back: first the commitment question ... and then a second
 * message confirming the coaching session is complete. ... Merge these into a
 * single message, in the correct order: state first that the coaching session is
 * complete ('aapka coaching session yahan mukammal ho gaya hai'), then ask the
 * commitment question ('kya aap agli class mein ye azmane ka ahad karenge?')."
 *
 * Row 133 (bd-x3k1q) added the boundary as its own message AFTER the commit
 * prompt. This keeps the boundary but moves it to the FRONT of the commit-prompt
 * body, for every card language — and sends no second completion message.
 *
 * The card copy is deliberately NOT mocked: the assertions read the real
 * per-language strings, so an English-only implementation goes red.
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendImage: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
const mockWA = require('../../bot/shared/services/whatsapp.service');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-dc137' }));

jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn().mockResolvedValue('https://r2.example/report.png'),
  uploadReportPDF: jest.fn().mockResolvedValue('https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn().mockResolvedValue('https://r2.example/card.png'),
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
}));

jest.mock('../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({
  generateCommitmentCard: jest.fn().mockResolvedValue({
    _source: 'llm', commitment: 'Ask one open question', action: 'Try a think-pair-share', language: 'en',
  }),
}));

jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('en'),
  calculateTotalCost: jest.fn(() => 0),
  recordQualityMetrics: jest.fn().mockResolvedValue(true),
}));
const mockHelpers = require('../../bot/shared/services/coaching/coaching-helpers.service');

jest.mock('../../bot/shared/services/feature-linker.service', () => ({
  suggestNext: jest.fn().mockResolvedValue(true),
}));

const mockSessionRow = {
  id: 'sess-dc137',
  user_id: 'user-dc137',
  status: 'analysis_complete',
  created_at: '2026-09-22T00:00:00Z',
  conversation_state: { questions_answered: 3 },
  analysis_data: { framework: 'oecd' },
  transcript_language: 'ur',
  users: { phone_number: '923016669553', name: 'Mehwish', region: 'ICT', preferred_language: 'ur' },
};
jest.mock('../../bot/shared/config/supabase', () => {
  const makeChain = () => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.single = jest.fn().mockResolvedValue({ data: mockSessionRow, error: null });
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: mockSessionRow, error: null });
    chain.update = jest.fn(() => chain);
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn(() => makeChain()) };
});

const ReportGeneratorService = require('../../bot/shared/services/coaching/report-generator.service');
const { COACHING_CARD_COPY } = require('../../bot/shared/config/coaching-card.config');
const { getCoachingMessage, SUPPORTED_LANGUAGES } = require('../../bot/shared/config/coaching-messages');

const CARD_LANGUAGES = Object.keys(COACHING_CARD_COPY);

describe('DC:137 — session-complete leads the commitment question, in one message', () => {
  beforeEach(() => {
    Object.values(mockWA).forEach((fn) => fn.mockClear());
    mockHelpers.determineOutputLanguage.mockResolvedValue('en');
    jest.spyOn(ReportGeneratorService, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'oecd', topic: 'Fractions' });
    jest.spyOn(ReportGeneratorService, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
    jest.spyOn(ReportGeneratorService, 'sendHeroImageReport').mockResolvedValue(true);
    jest.spyOn(ReportGeneratorService, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
    jest.spyOn(ReportGeneratorService, 'scheduleTranscriptQuiz').mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(CARD_LANGUAGES)('[%s] the commit-prompt body opens with the session-complete line, then asks', async (lang) => {
    mockHelpers.determineOutputLanguage.mockResolvedValue(lang);
    await ReportGeneratorService.generateReport('sess-dc137', { from: '923016669553' });

    const copy = COACHING_CARD_COPY[lang];
    // Only the commit prompt counts here — the "was this useful?" survey is also a
    // buttons message and goes out just before it.
    const commit = mockWA.sendInteractiveButtons.mock.calls
      .filter((c) => c[1].buttons.some((btn) => btn.id.startsWith('card_')));
    expect(commit).toHaveLength(1);
    const { body } = commit[0][1];
    expect(body).toBe(`${copy.sessionCompleteLead}\n\n${copy.commitPrompt}`);
  });

  it.each(CARD_LANGUAGES)('[%s] no second session-complete message follows the commit prompt', async (lang) => {
    mockHelpers.determineOutputLanguage.mockResolvedValue(lang);
    await ReportGeneratorService.generateReport('sess-dc137', { from: '923016669553' });

    const bodies = mockWA.sendMessage.mock.calls.map((c) => c[1]);
    for (const code of SUPPORTED_LANGUAGES) {
      expect(bodies).not.toContain(getCoachingMessage('sessionComplete', code));
    }
    for (const code of CARD_LANGUAGES) {
      expect(bodies).not.toContain(COACHING_CARD_COPY[code].sessionCompleteLead);
    }
  });

  it('Urdu reads "aapka coaching session yahan mukammal ho gaya hai" — then the ahad question', () => {
    expect(COACHING_CARD_COPY.ur.sessionCompleteLead).toBe('✅ آپ کا کوچنگ سیشن یہاں مکمل ہو گیا ہے۔');
    expect(COACHING_CARD_COPY.ur.commitPrompt).toBe('کیا آپ اگلی کلاس میں یہ آزمانے کا عہد کریں گے؟');
  });

  it.each(CARD_LANGUAGES)('[%s] lead is translated, ✅-led, and the merged body fits the 1024 cap', (lang) => {
    const copy = COACHING_CARD_COPY[lang];
    expect(typeof copy.sessionCompleteLead).toBe('string');
    expect(copy.sessionCompleteLead.startsWith('✅')).toBe(true);
    if (lang !== 'en') expect(copy.sessionCompleteLead).not.toBe(COACHING_CARD_COPY.en.sessionCompleteLead);
    expect([...`${copy.sessionCompleteLead}\n\n${copy.commitPrompt}`].length).toBeLessThanOrEqual(1024);
  });
});
