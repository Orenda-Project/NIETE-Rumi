/**
 * bd-7beiz — the dedupe BRANCH as it is actually wired, not as it is injected.
 *
 * The sibling suite (bd-7beiz-audio-hash-dedupe.test.js) drives
 * `resolveDuplicateSubmission` with injected deps, which proves the logic and
 * proves nothing about the call site. Repo rule, CLAUDE.md § Working rules:
 * "The red test must EXECUTE the changed line on its live branch... A parameter
 * once dropped one hop short of its use site shipped a guaranteed crash under
 * 28 green tests."
 *
 * That is not hypothetical here. While writing this port, `logWarn` was used in
 * transcription-processor's new catch block but never added to its `require`,
 * and the injected-deps suite stayed green on all 15 tests. Only a test that
 * runs the real `processTranscription` catches that class of mistake.
 *
 * So: mock at the infrastructure boundary (Supabase, WhatsApp, R2, ffprobe) and
 * let every line of the real branch run.
 */

const mockSendMessage = jest.fn(async () => true);
const mockSendDocumentFromUrl = jest.fn(async () => true);
const mockSendImageFromUrl = jest.fn(async () => true);
const mockSendImage = jest.fn(async () => true);
const mockDownloadMedia = jest.fn(async () => Buffer.from('identical classroom audio bytes'));
const mockUploadClassroomAudio = jest.fn(async () => 'https://r2.example/new.ogg');
const mockUpdateIfNotTerminal = jest.fn(async () => ({ applied: true }));

const PRIOR = {
  id: 'prior-session',
  created_at: '2026-09-15T05:59:46.391Z',
  analysis_data: { framework: 'fico', scores: { overall_marks: 85, overall_max_marks: 148 } },
  // bd-5tgzv — production stores the hero PNG here, never a PDF (12,749 of
  // 12,754 completed DC sessions). The fixture has to be the real shape or
  // this suite certifies a delivery path that never runs.
  report_pdf_url: 'https://r2.example/reports/u1/prior_report.png',
};

const mockSessionRow = {
  id: 'current-session',
  user_id: 'teacher-uuid',
  observation_type: null,
  audio_duration_seconds: 2309,
  users: { phone_number: '923497552393', name: 'Ayesha Qadeer', preferred_language: 'ur' },
};

/** Chainable PostgREST double covering the three shapes this path uses. */
let mockDuplicateRow = PRIOR;
const mockUpdateCalls = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from() {
    const q = {
      _update: null,
      select() { return q; },
      update(patch) { q._update = patch; return q; },
      eq() { return q; },
      is() { return q; },
      gte() { return q; },
      neq() { return q; },
      not() { return q; },
      order() { return q; },
      limit() { return q; },
      single: async () => ({ data: mockSessionRow, error: null }),
      maybeSingle: async () => ({ data: mockDuplicateRow, error: null }),
      then(resolve) {            // a bare `await supabase.from().update().eq()`
        if (q._update) mockUpdateCalls.push(q._update);
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return q;
  },
}));

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentFromUrl: (...a) => mockSendDocumentFromUrl(...a),
  sendImageFromUrl: (...a) => mockSendImageFromUrl(...a),
  sendImage: (...a) => mockSendImage(...a),
  sendInteractiveButtons: jest.fn(async () => true),
  downloadMedia: (...a) => mockDownloadMedia(...a),
}));

jest.mock('../../bot/shared/storage/r2', () => ({
  uploadClassroomAudio: (...a) => mockUploadClassroomAudio(...a),
}));

jest.mock('../../bot/shared/services/coaching/session-terminal', () => ({
  updateIfNotTerminal: (...a) => mockUpdateIfNotTerminal(...a),
  TERMINAL_STATUSES: [],
  TERMINAL_IN_FILTER: '()',
  isTerminalStatus: () => false,
  refuseTapIfTerminal: jest.fn(),
}));

jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(async () => ({})),
  updateConversationState: jest.fn(async () => ({})),
}));

jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'ur'),
  setUserLanguage: jest.fn(async () => ({})),
}));

// NOTE: deliberately a FULL logger stub. A partial one (logToFile only) would
// hide exactly the ReferenceError this suite exists to catch.
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const TranscriptionProcessor =
  require('../../bot/shared/services/coaching/transcription-processor.service');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

describe('an identical resubmission never reaches transcription', () => {
  beforeEach(() => {
    mockDuplicateRow = PRIOR;
    mockUpdateCalls.length = 0;
    jest.clearAllMocks();
    mockDownloadMedia.mockResolvedValue(Buffer.from('identical classroom audio bytes'));
    mockUpdateIfNotTerminal.mockResolvedValue({ applied: true });
  });

  test('neither uploads the audio nor transcribes it', async () => {
    await TranscriptionProcessor.processTranscription('current-session', {
      from: '923497552393', audioId: 'wa-media-id',
    });
    expect(mockUploadClassroomAudio).not.toHaveBeenCalled();
  });

  test('stamps the prior analysis and what it duplicated', async () => {
    await TranscriptionProcessor.processTranscription('current-session', {
      from: '923497552393', audioId: 'wa-media-id',
    });
    expect(mockUpdateIfNotTerminal).toHaveBeenCalledTimes(1);
    const [, patch] = mockUpdateIfNotTerminal.mock.calls[0];
    expect(patch.analysis_data).toEqual(PRIOR.analysis_data);
    expect(patch.duplicate_of_session_id).toBe('prior-session');
    expect(patch.audio_hash).toHaveLength(64);
  });

  test('tells the teacher in Urdu, with the catalog string', async () => {
    await TranscriptionProcessor.processTranscription('current-session', {
      from: '923497552393', audioId: 'wa-media-id',
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      '923497552393', getCoachingMessage('duplicateRecording', 'ur'),
    );
    // bd-5tgzv — an IMAGE, because that is what the artefact is. Sending the
    // hero PNG as a .pdf document is what made the resent report unopenable.
    expect(mockSendImageFromUrl).toHaveBeenCalledWith(
      '923497552393', PRIOR.report_pdf_url, expect.any(String),
    );
    expect(mockSendDocumentFromUrl).not.toHaveBeenCalled();
  });
});

describe('a first-time recording is unaffected', () => {
  beforeEach(() => {
    mockDuplicateRow = null;          // no prior match
    mockUpdateCalls.length = 0;
    jest.clearAllMocks();
    mockDownloadMedia.mockResolvedValue(Buffer.from('a lesson nobody has sent before'));
    mockUpdateIfNotTerminal.mockResolvedValue({ applied: true });
  });

  test('still uploads to R2 — the dedupe check does not swallow a new session', async () => {
    // Soniox is the next boundary past the branch under test. Stub it so the
    // run ends here rather than reaching out to the network; everything up to
    // and including the R2 upload has already executed for real by then.
    const transcribe = jest
      .spyOn(TranscriptionProcessor, 'transcribeWithDiarization')
      .mockRejectedValue(new Error('transcription is out of scope for this test'));

    await TranscriptionProcessor.processTranscription('current-session', {
      from: '923497552393', audioId: 'wa-media-id',
    }).catch(() => {});

    expect(mockUploadClassroomAudio).toHaveBeenCalled();
    transcribe.mockRestore();
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      '923497552393', getCoachingMessage('duplicateRecording', 'ur'),
    );
  });
});
