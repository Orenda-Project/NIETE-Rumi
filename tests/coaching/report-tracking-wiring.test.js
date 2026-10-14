/**
 * v10 coaching test (bd-v0toag.12): the report generator hands each send a tracker, so the image,
 * the voice note and the commit-prompt buttons are each recorded with their wamid (sent) or their
 * error (failed). The tracker itself is tested in report-tracking.test.js; here it is a spy, and
 * what is asserted is that every part reaches it and that a send still behaves exactly as before.
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendImage: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendAudioFromUrl: jest.fn().mockResolvedValue(true),
}));
const mockWA = require('../../bot/shared/services/whatsapp.service');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-v0toag12' }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn().mockResolvedValue('https://r2.example/report.png'),
  uploadReportPDF: jest.fn().mockResolvedValue('https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn().mockResolvedValue('https://r2.example/card.png'),
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.ogg'),
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
jest.mock('../../bot/shared/services/feature-linker.service', () => ({ suggestNext: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  summarizeForVoiceDebrief: jest.fn().mockResolvedValue('A short spoken summary.'),
  inferLessonTopic: jest.fn().mockResolvedValue('Fractions'),
  inferLessonSubject: jest.fn().mockResolvedValue('Maths'),
}));
jest.mock('../../bot/shared/services/tts', () => ({
  synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('OggS'), durationSec: 30 }),
}));

const mockTracker = {
  opts: jest.fn((part) => ({ onMessageId: jest.fn(), part })),
  record: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../bot/shared/services/coaching/report-tracking', () => ({
  createReportTracker: jest.fn(() => mockTracker),
}));
const { createReportTracker } = require('../../bot/shared/services/coaching/report-tracking');

const mockSessionRow = {
  id: 'sess-12',
  user_id: 'user-12',
  status: 'analysis_complete',
  created_at: '2026-10-14T00:00:00Z',
  conversation_state: { questions_answered: 3 },
  analysis_data: { framework: 'oecd' },
  transcript_language: 'en',
  users: { phone_number: '923001110012', name: 'Sana', region: 'ICT', preferred_language: 'en' },
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

const recorded = () => mockTracker.record.mock.calls.map((c) => [c[0], c[1]]);

beforeEach(() => {
  jest.clearAllMocks();
  mockTracker.opts.mockImplementation((part) => ({ onMessageId: jest.fn(), part }));
  mockTracker.record.mockResolvedValue(undefined);
  mockWA.sendInteractiveButtons.mockResolvedValue(true);
  mockWA.sendAudioFromUrl.mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('generateReport', () => {
  beforeEach(() => {
    jest.spyOn(ReportGeneratorService, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'oecd', topic: 'Fractions' });
    jest.spyOn(ReportGeneratorService, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
    jest.spyOn(ReportGeneratorService, 'sendHeroImageReport').mockResolvedValue(undefined);
    jest.spyOn(ReportGeneratorService, 'generateAndSendVoiceDebrief').mockResolvedValue(undefined);
    jest.spyOn(ReportGeneratorService, 'scheduleTranscriptQuiz').mockResolvedValue(false);
  });

  test('one tracker per report, for this session and teacher', async () => {
    await ReportGeneratorService.generateReport('sess-12', { from: '923001110012' });
    expect(createReportTracker).toHaveBeenCalledTimes(1);
    expect(createReportTracker).toHaveBeenCalledWith({ coachingSessionId: 'sess-12', userId: 'user-12' });
  });

  test('the image send gets the image opts and is recorded as sent', async () => {
    await ReportGeneratorService.generateReport('sess-12', { from: '923001110012' });
    const args = ReportGeneratorService.sendHeroImageReport.mock.calls[0];
    expect(args[6]).toMatchObject({ part: 'image' });
    expect(recorded()).toContainEqual(['image', true]);
  });

  test('a failed image send is recorded as failed, and the report still fails as before', async () => {
    ReportGeneratorService.sendHeroImageReport.mockRejectedValue(new Error('sendImage returned false'));
    jest.spyOn(ReportGeneratorService, 'handleReportError').mockResolvedValue(undefined);
    await ReportGeneratorService.generateReport('sess-12', { from: '923001110012' }).catch(() => {});
    const call = mockTracker.record.mock.calls.find((c) => c[0] === 'image');
    expect(call[1]).toBe(false);
    expect(call[2].message).toBe('sendImage returned false');
  });

  test('the voice debrief is handed the tracker', async () => {
    await ReportGeneratorService.generateReport('sess-12', { from: '923001110012' });
    expect(ReportGeneratorService.generateAndSendVoiceDebrief.mock.calls[0][4]).toBe(mockTracker);
  });

  test('the commit-prompt buttons get the buttons opts and are recorded', async () => {
    await ReportGeneratorService.generateReport('sess-12', { from: '923001110012' });
    const btn = mockWA.sendInteractiveButtons.mock.calls.find((c) => /^card_yes_/.test(c[1].buttons[0].id));
    expect(btn[2]).toMatchObject({ part: 'buttons' });
    expect(recorded()).toContainEqual(['buttons', true]);
  });

  test('buttons Meta refused are recorded as failed', async () => {
    mockWA.sendInteractiveButtons.mockResolvedValue(false);
    await ReportGeneratorService.generateReport('sess-12', { from: '923001110012' });
    expect(recorded()).toContainEqual(['buttons', false]);
  });
});

describe('sendHeroImageReport', () => {
  test('forwards the opts to sendImage', async () => {
    const opts = { onMessageId: jest.fn() };
    await ReportGeneratorService.sendHeroImageReport('923001110012', 'sess-12', Buffer.from('PNG'), 'cap', 'Sana', null, opts);
    expect(mockWA.sendImage.mock.calls[0][3]).toBe(opts);
  });
});

describe('generateAndSendVoiceDebrief', () => {
  const session = { ...mockSessionRow };

  test('the voice note gets the voice opts and is recorded as sent', async () => {
    await ReportGeneratorService.generateAndSendVoiceDebrief(session, '923001110012', 'sess-12', { framework: 'oecd' }, mockTracker);
    expect(mockWA.sendAudioFromUrl.mock.calls[0][2]).toMatchObject({ part: 'voice' });
    expect(recorded()).toContainEqual(['voice', true]);
  });

  test('a voice note the sender refused is recorded as failed', async () => {
    mockWA.sendAudioFromUrl.mockResolvedValue(false);
    await ReportGeneratorService.generateAndSendVoiceDebrief(session, '923001110012', 'sess-12', { framework: 'oecd' }, mockTracker);
    expect(recorded()).toContainEqual(['voice', false]);
  });

  test('without a tracker it sends exactly as before', async () => {
    await ReportGeneratorService.generateAndSendVoiceDebrief(session, '923001110012', 'sess-12', { framework: 'oecd' });
    expect(mockWA.sendAudioFromUrl).toHaveBeenCalledWith('923001110012', 'https://r2.example/voice.ogg', undefined);
    expect(mockTracker.record).not.toHaveBeenCalled();
  });
});
