/**
 * FEAT-106 CHANGE 4 part 2 (bd-2346) — the "one thing to try next class" action
 * ships ONCE, inside the hero feedback card. The standalone commitment-card IMAGE
 * that used to be sent as a second message (WhatsAppService.sendImageFromUrl with a
 * `coaching-card-*` URL) is removed. The commit-prompt BUTTONS and the
 * prioritized_action DB write MUST still fire (they drive the follow-up flow).
 *
 * Qurat (ICT, 2026-07-21): "the Commitment Card is being displayed in both text and
 * PNG formats. It should be displayed in only one format, not both."
 */

// WhatsApp service — inline factory so we observe exactly what got sent.
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendImage: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
const mockWA = require('../../bot/shared/services/whatsapp.service');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-4b' }));

// R2 — no network.
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn().mockResolvedValue('https://r2.example/report.png'),
  uploadReportPDF: jest.fn().mockResolvedValue('https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn().mockResolvedValue('https://r2.example/card.png'),
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
}));

// Commitment-card content (LLM path) — reached in the delivery block.
jest.mock('../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({
  generateCommitmentCard: jest.fn().mockResolvedValue({
    _source: 'llm', commitment: 'Ask one open question', action: 'Try a think-pair-share', language: 'en',
  }),
}));

jest.mock('../../bot/shared/config/coaching-card.config', () => ({
  getCoachingCardCopy: jest.fn(() => ({
    commitPrompt: 'Will you try this?',
    commitButtons: { yes: 'Yes', later: 'Later', no: 'No' },
    cardFooter: 'Human Coach',
  })),
}));

// Supabase — session fetch returns a ready-for-delivery session; updates are captured.
const mockUpdateSpy = jest.fn().mockResolvedValue({ data: null, error: null });
const mockSessionRow = {
  id: 'sess-1',
  user_id: 'user-1',
  status: 'analysis_complete',
  created_at: '2026-07-29T00:00:00Z',
  conversation_state: { questions_answered: 1 },
  analysis_data: { framework: 'oecd' },
  transcript_language: 'en',
  users: { phone_number: '10000000000', name: 'Sana N', region: 'ICT', preferred_language: 'en' },
};
jest.mock('../../bot/shared/config/supabase', () => {
  const makeChain = () => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.single = jest.fn().mockResolvedValue({ data: mockSessionRow, error: null });
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: mockSessionRow, error: null });
    chain.update = jest.fn((payload) => { mockUpdateSpy(payload); return chain; });
    // Awaitable: `await supabase.from().update().eq()` resolves without a terminal.
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn(() => makeChain()) };
});

const ReportGeneratorService = require('../../bot/shared/services/coaching/report-generator.service');

describe('FEAT-106 CHANGE 4b — no standalone commitment-card image', () => {
  beforeEach(() => {
    Object.values(mockWA).forEach((fn) => fn.mockClear());
    mockUpdateSpy.mockClear();
    // Stub the heavy delivery collaborators so we reach the commitment block.
    jest.spyOn(ReportGeneratorService, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'oecd' });
    jest.spyOn(ReportGeneratorService, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
    jest.spyOn(ReportGeneratorService, 'sendHeroImageReport').mockResolvedValue(true);
    jest.spyOn(ReportGeneratorService, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('does NOT send a standalone commitment-card image', async () => {
    await ReportGeneratorService.generateReport('sess-1', { from: '10000000000' });
    expect(mockWA.sendImageFromUrl).not.toHaveBeenCalled();
  });

  it('still sends the commit-prompt buttons and writes prioritized_action', async () => {
    await ReportGeneratorService.generateReport('sess-1', { from: '10000000000' });
    expect(mockWA.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(mockUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ prioritized_action: expect.objectContaining({ commitment: 'Ask one open question' }) }),
    );
  });
});
