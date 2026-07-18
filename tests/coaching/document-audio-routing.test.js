/**
 * Coaching — Document→Audio routing
 *
 * Validates that WhatsApp documents with an audio MIME type are treated as
 * audio uploads (Rifat's ask on the Coach Platform card: use documents to
 * bypass Meta's 16MB voice cap and get up to 100MB). Whisper still caps
 * transcription at 25MB per file, so anything larger must be rejected
 * with a friendly message BEFORE we download the file.
 *
 * Under test: bot/shared/handlers/audio-document-router.js — the pure
 * classification/message helpers wired into handleDocumentMessage.
 *
 * The wiring itself (handleDocumentMessage in whatsapp-bot.js) is exercised
 * separately by the existing bug-005-audio-document.test.js suite; this
 * file focuses on the classifier + reject-message contract so regressions
 * in either direction are caught quickly.
 */

const {
  classifyAudioDocument,
  isAudioMimeType,
  buildTooLargeMessage,
  WHISPER_MAX_BYTES,
  WHATSAPP_DOCUMENT_MAX_BYTES,
} = require('../../bot/shared/handlers/audio-document-router');

describe('audio-document-router — MIME detection', () => {
  const audioMimes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'audio/x-m4a',
    'audio/webm',
    'audio/aac',
    'audio/opus',
    'AUDIO/MPEG', // case-insensitive
  ];

  audioMimes.forEach((mime) => {
    test(`routes ${mime} to coaching audio pipeline`, () => {
      expect(isAudioMimeType(mime)).toBe(true);
      const result = classifyAudioDocument({ mimeType: mime, fileSize: 1_000_000 });
      expect(result.decision).toBe('route_to_audio_pipeline');
    });
  });

  test('PDF documents still fall through to lesson-plan/document handler (regression)', () => {
    // This is the load-bearing invariant — PDFs must NOT be rerouted to audio.
    // If this ever flips green, the LP-upload path in handleDocumentMessage
    // will start treating PDFs as audio and try to transcribe them.
    const result = classifyAudioDocument({ mimeType: 'application/pdf', fileSize: 5_000_000 });
    expect(result.decision).toBe('not_audio');
    expect(isAudioMimeType('application/pdf')).toBe(false);
  });

  test('other non-audio MIMEs (images, msword, plain text) fall through', () => {
    ['image/jpeg', 'image/png', 'application/msword', 'text/plain'].forEach((mime) => {
      expect(classifyAudioDocument({ mimeType: mime, fileSize: 100 }).decision).toBe('not_audio');
    });
  });

  test('malformed / missing MIME → not_audio (no crash, falls through to default handler)', () => {
    // Zero-byte or malformed uploads must not throw. handleDocumentMessage's
    // default branch will still send the "I received your document" message.
    expect(classifyAudioDocument({}).decision).toBe('not_audio');
    expect(classifyAudioDocument({ mimeType: null, fileSize: 0 }).decision).toBe('not_audio');
    expect(classifyAudioDocument({ mimeType: '', fileSize: 0 }).decision).toBe('not_audio');
    expect(classifyAudioDocument({ mimeType: undefined }).decision).toBe('not_audio');
    // Non-string MIME (defensive — WA payloads have surprised us before)
    expect(classifyAudioDocument({ mimeType: 42, fileSize: 100 }).decision).toBe('not_audio');
  });
});

describe('audio-document-router — Whisper 25MB gate', () => {
  test('audio ≤ 25MB → route_to_audio_pipeline', () => {
    // 20MB — well under cap
    const result = classifyAudioDocument({
      mimeType: 'audio/mpeg',
      fileSize: 20 * 1024 * 1024,
    });
    expect(result.decision).toBe('route_to_audio_pipeline');
    expect(result.sizeMB).toBe('20.0');
  });

  test('audio exactly at 25MB → route_to_audio_pipeline (boundary inclusive)', () => {
    const result = classifyAudioDocument({
      mimeType: 'audio/mpeg',
      fileSize: WHISPER_MAX_BYTES,
    });
    expect(result.decision).toBe('route_to_audio_pipeline');
  });

  test('audio 1 byte over 25MB → reject_too_large', () => {
    const result = classifyAudioDocument({
      mimeType: 'audio/mpeg',
      fileSize: WHISPER_MAX_BYTES + 1,
    });
    expect(result.decision).toBe('reject_too_large');
  });

  test('audio at 40MB (typical rejected classroom recording) → reject_too_large with size', () => {
    const result = classifyAudioDocument({
      mimeType: 'audio/mpeg',
      fileSize: 40 * 1024 * 1024,
    });
    expect(result.decision).toBe('reject_too_large');
    expect(result.sizeMB).toBe('40.0');
  });

  test('audio near the WhatsApp 100MB document ceiling → reject_too_large (does not attempt download)', () => {
    // 95MB is legal to upload as a WA doc but way over Whisper's 25MB —
    // we must reject BEFORE downloading (bandwidth + wasted Whisper API attempts).
    const result = classifyAudioDocument({
      mimeType: 'audio/mp4',
      fileSize: 95 * 1024 * 1024,
    });
    expect(result.decision).toBe('reject_too_large');
    expect(Number(result.sizeMB)).toBeLessThanOrEqual(WHATSAPP_DOCUMENT_MAX_BYTES / (1024 * 1024));
  });

  test('audio with unknown file_size (WA omitted it) → route_to_audio_pipeline (existing ffprobe path handles it)', () => {
    // We do NOT pre-reject on missing file_size — some WA payloads omit it,
    // and the existing download+ffprobe path will fail loudly if the file
    // turns out to be malformed. Pre-rejecting would drop legitimate uploads.
    expect(classifyAudioDocument({ mimeType: 'audio/mpeg', fileSize: 0 }).decision).toBe(
      'route_to_audio_pipeline'
    );
    expect(classifyAudioDocument({ mimeType: 'audio/mpeg' }).decision).toBe(
      'route_to_audio_pipeline'
    );
    expect(
      classifyAudioDocument({ mimeType: 'audio/mpeg', fileSize: undefined }).decision
    ).toBe('route_to_audio_pipeline');
  });
});

describe('audio-document-router — reject message', () => {
  test('includes reported size in MB', () => {
    const msg = buildTooLargeMessage('42.3');
    expect(msg).toContain('42.3 MB');
  });

  test('mentions the 25MB cap and points at compression/splitting as the workaround', () => {
    const msg = buildTooLargeMessage('40.0');
    expect(msg).toMatch(/25MB/);
    expect(msg.toLowerCase()).toMatch(/compress|split/);
    // Names transcription as the constraint so users don't think it's a size limit on Rumi itself.
    expect(msg.toLowerCase()).toContain('transcription');
  });

  test('documents chunked-recording roadmap so users know it is on our list', () => {
    const msg = buildTooLargeMessage('50.0');
    expect(msg.toLowerCase()).toContain('roadmap');
  });
});

describe('audio-document-router — invariants used by handleDocumentMessage', () => {
  test('WHISPER_MAX_BYTES is 25MB (do not tune without confirming Whisper limit)', () => {
    expect(WHISPER_MAX_BYTES).toBe(25 * 1024 * 1024);
  });

  test('WHATSAPP_DOCUMENT_MAX_BYTES is 100MB (Meta Cloud API document cap)', () => {
    expect(WHATSAPP_DOCUMENT_MAX_BYTES).toBe(100 * 1024 * 1024);
  });
});
