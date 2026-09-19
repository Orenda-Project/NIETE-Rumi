/**
 * DC:133 (bd-x3k1q) — a coaching session must announce that it is OVER before
 * the next feature speaks.
 *
 * Qurat (ICT, 2026-09-18): "Right after the commitment question ('will you try
 * this in the next class?'), the /quiz message gets sent immediately with no
 * separator. This confuses teachers and coaches into thinking the quiz is still
 * part of the DC coaching session, since there's nothing marking where the
 * coaching flow ends and the quiz feature begins."
 *
 * The fix is one teacher-facing line, in HER language, sent after the commit
 * prompt and before anything the quiz / feature-linker sends.
 *
 * The message catalog is deliberately NOT mocked here: the assertions read the
 * real per-language string, so an English-only implementation goes red.
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
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-dc133' }));

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

// Language resolver — the single source of the teacher-facing output language.
jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('en'),
  calculateTotalCost: jest.fn(() => 0),
  recordQualityMetrics: jest.fn().mockResolvedValue(true),
}));
const mockHelpers = require('../../bot/shared/services/coaching/coaching-helpers.service');

// The next feature that speaks after coaching.
jest.mock('../../bot/shared/services/feature-linker.service', () => ({
  suggestNext: jest.fn().mockResolvedValue(true),
}));
const mockFeatureLinker = require('../../bot/shared/services/feature-linker.service');

const mockSessionRow = {
  id: 'sess-dc133',
  user_id: 'user-dc133',
  status: 'analysis_complete',
  created_at: '2026-09-18T00:00:00Z',
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
const {
  COACHING_MESSAGES,
  SUPPORTED_LANGUAGES,
  TODO,
  getCoachingMessage,
} = require('../../bot/shared/config/coaching-messages');

const order = (mockFn, nth = 0) => mockFn.mock.invocationCallOrder[nth];

describe('DC:133 — the coaching session declares itself complete before the quiz', () => {
  beforeEach(() => {
    Object.values(mockWA).forEach((fn) => fn.mockClear());
    mockFeatureLinker.suggestNext.mockClear();
    mockHelpers.determineOutputLanguage.mockResolvedValue('en');
    jest.spyOn(ReportGeneratorService, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'oecd', topic: 'Fractions' });
    jest.spyOn(ReportGeneratorService, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
    jest.spyOn(ReportGeneratorService, 'sendHeroImageReport').mockResolvedValue(true);
    jest.spyOn(ReportGeneratorService, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
    jest.spyOn(ReportGeneratorService, 'scheduleTranscriptQuiz').mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends the English session-complete line when the teacher reads English', async () => {
    await ReportGeneratorService.generateReport('sess-dc133', { from: '923016669553' });

    const expected = getCoachingMessage('sessionComplete', 'en');
    const bodies = mockWA.sendMessage.mock.calls.map((c) => c[1]);
    expect(bodies).toContain(expected);
  });

  it('sends the Urdu line — not the English one — when her language is Urdu', async () => {
    mockHelpers.determineOutputLanguage.mockResolvedValue('ur');
    await ReportGeneratorService.generateReport('sess-dc133', { from: '923016669553' });

    const bodies = mockWA.sendMessage.mock.calls.map((c) => c[1]);
    expect(bodies).toContain(getCoachingMessage('sessionComplete', 'ur'));
    expect(bodies).not.toContain(getCoachingMessage('sessionComplete', 'en'));
  });

  it('places the line AFTER the commit prompt and BEFORE the quiz / next-feature ask', async () => {
    await ReportGeneratorService.generateReport('sess-dc133', { from: '923016669553' });

    const expected = getCoachingMessage('sessionComplete', 'en');
    const noteIdx = mockWA.sendMessage.mock.calls.findIndex((c) => c[1] === expected);
    expect(noteIdx).toBeGreaterThanOrEqual(0);              // present, before any ordering claim
    expect(mockWA.sendInteractiveButtons).toHaveBeenCalled(); // the commit prompt fired
    expect(ReportGeneratorService.scheduleTranscriptQuiz).toHaveBeenCalled();

    const noteOrder = order(mockWA.sendMessage, noteIdx);
    expect(noteOrder).toBeGreaterThan(order(mockWA.sendInteractiveButtons, 0));
    expect(noteOrder).toBeLessThan(order(ReportGeneratorService.scheduleTranscriptQuiz, 0));
    expect(noteOrder).toBeLessThan(order(mockFeatureLinker.suggestNext, 0));
  });

  it('still sends the boundary when no commitment card could be generated', async () => {
    const { generateCommitmentCard } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');
    generateCommitmentCard.mockResolvedValueOnce(null);

    await ReportGeneratorService.generateReport('sess-dc133', { from: '923016669553' });

    const bodies = mockWA.sendMessage.mock.calls.map((c) => c[1]);
    expect(bodies).toContain(getCoachingMessage('sessionComplete', 'en'));
  });

  it('is translated for every offered language, within the WhatsApp body cap', () => {
    const entry = COACHING_MESSAGES.sessionComplete;
    expect(entry).toBeDefined();
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(typeof entry[lang]).toBe('string');
      expect(entry[lang]).not.toBe(TODO);                         // a real translation, not the sentinel
      expect([...entry[lang]].length).toBeGreaterThan(0);
      expect([...entry[lang]].length).toBeLessThanOrEqual(1024);  // body.text cap, in code points
      if (lang !== 'en') expect(entry[lang]).not.toBe(entry.en);
    }
  });
});
