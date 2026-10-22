'use strict';
/**
 * bd-c5reix (D7) — the dedupe backstop on a teacher's PORTAL recording sends nothing to WhatsApp.
 *
 * bd-7beiz's backstop runs in transcription: the same bytes as an analysed DC observation of hers reuse that score,
 * and on WhatsApp she is told so and sent the old report again. A recording sent from the app is followed in the app
 * (bd-s7c31y keeps its Step lines off WhatsApp); there the repeat is shown by the page (DuplicateNote), and the report
 * she already has is already in her chat. So for a portal teacher session the row is stamped exactly as before and
 * nothing goes to WhatsApp. A WhatsApp recording is unchanged (bd-7beiz-dedupe-call-site.test.js).
 *
 * The real processTranscription runs; only the infrastructure is mocked (the sibling suite's harness).
 */

const mockSendMessage = jest.fn(async () => true);
const mockSendDocumentFromUrl = jest.fn(async () => true);
const mockSendImageFromUrl = jest.fn(async () => true);
const mockUpdateIfNotTerminal = jest.fn(async () => ({ applied: true }));

const PRIOR = {
  id: 'prior-session',
  created_at: '2026-10-01T05:59:46.391Z',
  analysis_data: { framework: 'fico', scores: { overall_marks: 85, overall_max_marks: 148 } },
  report_pdf_url: 'https://r2.example/reports/u1/prior_report.png',
};
const KEY = 'classroom_audio/teacher-uuid/2026-10/portal_wa-0123456789abcdef-b2c3.ogg';
const mockSessionRow = {
  id: 'current-session',
  user_id: 'teacher-uuid',
  observation_type: null,
  audio_url: `https://r2.example/digital-coach-audio/${KEY}`,
  audio_duration_seconds: 1812,
  users: { phone_number: '+92300FIXTURE3', name: 'Ayesha Qadeer', preferred_language: 'ur' },
};

jest.mock('../../bot/shared/config/supabase', () => ({
  from() {
    const q = {
      select() { return q; }, update() { return q; }, eq() { return q; }, is() { return q; }, gte() { return q; },
      neq() { return q; }, not() { return q; }, order() { return q; }, limit() { return q; },
      single: async () => ({ data: mockSessionRow, error: null }),
      maybeSingle: async () => ({ data: PRIOR, error: null }),
      then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
    };
    return q;
  },
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentFromUrl: (...a) => mockSendDocumentFromUrl(...a),
  sendImageFromUrl: (...a) => mockSendImageFromUrl(...a),
  sendImage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  downloadMedia: jest.fn(),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadClassroomAudio: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/portal-short-recording', () => ({
  isPortalDc: () => true,
  refuseShortPortalRecording: async () => ({ refused: false }),
}));
jest.mock('../../bot/shared/services/coaching/session-terminal', () => ({
  updateIfNotTerminal: (...a) => mockUpdateIfNotTerminal(...a),
  TERMINAL_STATUSES: [], TERMINAL_IN_FILTER: '()', isTerminalStatus: () => false, refuseTapIfTerminal: jest.fn(),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(async () => ({})),
  updateConversationState: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'ur'),
  setUserLanguage: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn(),
  generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));

const TranscriptionProcessor = require('../../bot/shared/services/coaching/transcription-processor.service');
const { resolveDuplicateSubmission } = require('../../bot/shared/services/coaching/audio-hash-cache');

describe('the backstop, as wired, on a portal teacher session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(TranscriptionProcessor, 'fetchAudioForSession').mockResolvedValue(Buffer.from('identical classroom audio bytes'));
  });

  test('the prior score is reused and recorded, exactly as on WhatsApp', async () => {
    await TranscriptionProcessor.processTranscription('current-session', { from: '+92300FIXTURE3' });
    expect(mockUpdateIfNotTerminal).toHaveBeenCalledTimes(1);
    const [, patch] = mockUpdateIfNotTerminal.mock.calls[0];
    expect(patch).toMatchObject({ status: 'completed', duplicate_of_session_id: 'prior-session', analysis_data: PRIOR.analysis_data });
  });

  test('nothing goes to WhatsApp: no "heard this before" line, no report again', async () => {
    await TranscriptionProcessor.processTranscription('current-session', { from: '+92300FIXTURE3' });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendImageFromUrl).not.toHaveBeenCalled();
    expect(mockSendDocumentFromUrl).not.toHaveBeenCalled();
  });
});

describe('resolveDuplicateSubmission — quiet', () => {
  const opts = () => ({
    updateIfNotTerminal: jest.fn(async () => ({ applied: true })),
    sendMessage: jest.fn(), sendImageFromUrl: jest.fn(), sendDocumentFromUrl: jest.fn(),
    getMessage: jest.fn(() => 'msg'), getLanguage: jest.fn(async () => 'ur'), log: jest.fn(),
  });

  test('quiet: stamped, handled, nothing sent', async () => {
    const o = opts();
    const handled = await resolveDuplicateSubmission(
      { coachingSessionId: 'cs', from: '+92300FIXTURE5', userId: 'u', audioHash: 'h', duplicate: PRIOR, quiet: true }, o,
    );
    expect(handled).toBe(true);
    expect(o.updateIfNotTerminal).toHaveBeenCalledTimes(1);
    expect(o.sendMessage).not.toHaveBeenCalled();
    expect(o.sendImageFromUrl).not.toHaveBeenCalled();
  });

  test('not quiet (a WhatsApp recording): told and resent, as before', async () => {
    const o = opts();
    await resolveDuplicateSubmission({ coachingSessionId: 'cs', from: '+92300FIXTURE5', userId: 'u', audioHash: 'h', duplicate: PRIOR }, o);
    expect(o.sendMessage).toHaveBeenCalledWith('+92300FIXTURE5', 'msg');
    expect(o.sendImageFromUrl).toHaveBeenCalledWith('+92300FIXTURE5', PRIOR.report_pdf_url, '');
  });
});
