/**
 * A debrief whose recording is GONE must not be retried, and the coach must be
 * told the truth about it.
 *
 * WhatsApp media ids expire. When one has, every download of it answers 400 from
 * the Meta media endpoint — permanently. The retry planner had no notion of a
 * permanent failure: it gated on attempts, age and spacing only, so a dead media
 * id was retried exactly like a provider outage. Measured on production 15 Sep:
 * 8 pending debriefs with an audio id and no transcript, ALL 8 sitting at the
 * attempts ceiling of 6, every one carrying "Request failed with status code
 * 400" — 48 futile Meta downloads, and 8 coaches each told once that the
 * recording would be recovered automatically. It never could be.
 *
 * Two halves, both asserted here:
 *   the recorder classifies the failure (media_gone vs transient) from the
 *   failing REQUEST, not from the message text;
 *   the planner refuses a media_gone row at any attempt count, and says why.
 */

const {
  selectDebriefsToRetry,
  classifyTranscriptionFailure,
} = require('../../shared/services/observe/debrief-retry-sweep');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-09-15T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const row = (debriefOver = {}, over = {}) => ({
  id: over.id || `s-${Math.random().toString(36).slice(2, 8)}`,
  debrief_status: 'pending',
  created_at: iso(3 * HOUR),
  observer_debrief: {
    audio_id: 'wamid.A', recorded_at: iso(2 * HOUR), transcript: null, feedback: null,
    ...debriefOver,
  },
  ...over,
});

const ids = (rows) => rows.map((r) => r.id);

// An axios rejection as the media download actually produces one.
const httpError = (status, url) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, config: { url } },
  config: { url },
  isAxiosError: true,
});

const MEDIA_INFO_URL = 'https://graph.facebook.com/v23.0/1234567890';
const MEDIA_BINARY_URL = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=abc&ext=1';

describe('classifying a transcription-stage failure', () => {
  test('400 from the Meta media endpoint is permanent — the recording is gone', () => {
    expect(classifyTranscriptionFailure(httpError(400, MEDIA_INFO_URL))).toBe('media_gone');
    expect(classifyTranscriptionFailure(httpError(400, MEDIA_BINARY_URL))).toBe('media_gone');
  });

  test('404 from the Meta media endpoint is permanent too', () => {
    expect(classifyTranscriptionFailure(httpError(404, MEDIA_INFO_URL))).toBe('media_gone');
  });

  test('a 5xx from the media endpoint is transient — Meta, not the media', () => {
    expect(classifyTranscriptionFailure(httpError(503, MEDIA_INFO_URL))).toBe('transient');
    expect(classifyTranscriptionFailure(httpError(500, MEDIA_BINARY_URL))).toBe('transient');
  });

  test('a 400 from somewhere that is NOT the media endpoint stays transient', () => {
    // This is the whole reason classification reads the request and not the
    // message: the transcription provider answers 400 on a mislabelled
    // container, and that IS worth retrying once the container is right.
    expect(classifyTranscriptionFailure(httpError(400, 'https://api.soniox.com/v1/transcribe')))
      .toBe('transient');
    expect(classifyTranscriptionFailure(httpError(400, 'https://api.openai.com/v1/audio/transcriptions')))
      .toBe('transient');
  });

  test('a network error, a timeout and a bare throw are all transient', () => {
    expect(classifyTranscriptionFailure(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })))
      .toBe('transient');
    expect(classifyTranscriptionFailure(Object.assign(new Error('timeout of 0ms exceeded'), { code: 'ETIMEDOUT' })))
      .toBe('transient');
    expect(classifyTranscriptionFailure(new Error('provider balance exhausted'))).toBe('transient');
    expect(classifyTranscriptionFailure(null)).toBe('transient');
    expect(classifyTranscriptionFailure(undefined)).toBe('transient');
  });

  test('the default is transient, so an unrecognised failure is still chased', () => {
    // Fail-open: mis-classifying a retryable failure as permanent loses a
    // debrief for good, while the other direction only costs one more attempt.
    expect(classifyTranscriptionFailure({ weird: true })).toBe('transient');
  });
});

describe('the planner refuses a debrief whose media is gone', () => {
  test('media_gone is skipped at attempt 1, where a transient row is retried', () => {
    const gone = row({ error_class: 'media_gone', attempts: 1, failed_at: iso(2 * HOUR) }, { id: 'gone' });
    const transient = row({ error_class: 'transient', attempts: 1, failed_at: iso(2 * HOUR) }, { id: 'transient' });
    expect(ids(selectDebriefsToRetry([gone, transient], NOW))).toEqual(['transient']);
  });

  test('media_gone is skipped however young, old or untried the row is', () => {
    const cases = [
      row({ error_class: 'media_gone', attempts: 0 }),
      row({ error_class: 'media_gone', attempts: 5, failed_at: iso(6 * HOUR) }),
      row({ error_class: 'media_gone', attempts: 1, recorded_at: iso(20 * 24 * HOUR), failed_at: iso(19 * 24 * HOUR) }),
    ];
    expect(selectDebriefsToRetry(cases, NOW)).toEqual([]);
  });

  test('a row with no error_class at all is still retried — this change strands nothing already in flight', () => {
    const legacy = row({ attempts: 2, failed_at: iso(2 * HOUR) }, { id: 'legacy' });
    expect(ids(selectDebriefsToRetry([legacy], NOW))).toEqual(['legacy']);
  });

  test('the skip reason is reported, so a tick can say what it refused', () => {
    const gone = row({ error_class: 'media_gone', attempts: 1, failed_at: iso(2 * HOUR) }, { id: 'gone' });
    const eligible = row({ attempts: 1, failed_at: iso(2 * HOUR) }, { id: 'ok' });
    const tally = {};
    const selected = selectDebriefsToRetry([gone, eligible], NOW, {}, tally);
    expect(ids(selected)).toEqual(['ok']);
    expect(tally.mediaGone).toBe(1);
  });
});
