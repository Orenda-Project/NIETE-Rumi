/**
 * Coaching — Document→Audio routing
 *
 * Validates that WhatsApp documents with an audio MIME type are treated as
 * audio uploads (Rifat's ask on the Coach Platform card: use documents to
 * bypass Meta's 16MB voice cap and get up to 100MB). The cap is 100 MB (Soniox
 * transcribes long files; Whisper is only the fallback), and anything larger is
 * refused with a message BEFORE the file is downloaded.
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

describe('audio-document-router — the 100 MB cap', () => {
  const MB = 1024 * 1024;

  test('a 20 MB recording → route_to_audio_pipeline', () => {
    const result = classifyAudioDocument({ mimeType: 'audio/mpeg', fileSize: 20 * MB });
    expect(result.decision).toBe('route_to_audio_pipeline');
    expect(result.sizeMB).toBe('20.0');
  });

  test('a 40 MB classroom recording (a 40-minute lesson from a phone recorder) → route_to_audio_pipeline', () => {
    const result = classifyAudioDocument({ mimeType: 'audio/mp4', fileSize: 40 * MB });
    expect(result.decision).toBe('route_to_audio_pipeline');
    expect(result.sizeMB).toBe('40.0');
  });

  test('exactly 100 MB → route_to_audio_pipeline (boundary inclusive)', () => {
    expect(classifyAudioDocument({ mimeType: 'audio/mpeg', fileSize: WHISPER_MAX_BYTES }).decision).toBe('route_to_audio_pipeline');
  });

  test('1 byte over 100 MB → reject_too_large, with its size', () => {
    const result = classifyAudioDocument({ mimeType: 'audio/mpeg', fileSize: WHISPER_MAX_BYTES + 1 });
    expect(result.decision).toBe('reject_too_large');
    expect(result.sizeMB).toBe('100.0');
  });

  test('audio with unknown file_size (WA omitted it) → route_to_audio_pipeline (resolveAudioDocument asks Meta)', () => {
    // We do NOT pre-reject on missing file_size: the webhook never carries it on a
    // document. resolveAudioDocument reads the real size from Meta's media info.
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

describe('audio-document-router — resolveAudioDocument (the size the webhook leaves out)', () => {
  const MB = 1024 * 1024;
  const { resolveAudioDocument } = require('../../bot/shared/handlers/audio-document-router');

  test('reads the size from Meta\'s media info and refuses over the cap', async () => {
    const getMediaInfo = jest.fn().mockResolvedValue({ file_size: 150 * MB });
    const result = await resolveAudioDocument({ mimeType: 'audio/mp4', mediaId: 'M1' }, { getMediaInfo });
    expect(getMediaInfo).toHaveBeenCalledWith('M1');
    expect(result).toEqual({ decision: 'reject_too_large', sizeMB: '150.0' });
  });

  test('Meta sends file_size as a string too: still read', async () => {
    const getMediaInfo = jest.fn().mockResolvedValue({ file_size: String(30 * MB) });
    const result = await resolveAudioDocument({ mimeType: 'audio/mp4', mediaId: 'M1' }, { getMediaInfo });
    expect(result).toEqual({ decision: 'route_to_audio_pipeline', sizeMB: '30.0' });
  });

  test('does not ask Meta when the webhook gave a size, or for a non-audio document', async () => {
    const getMediaInfo = jest.fn();
    await resolveAudioDocument({ mimeType: 'audio/mp4', fileSize: 10 * MB, mediaId: 'M1' }, { getMediaInfo });
    await resolveAudioDocument({ mimeType: 'application/pdf', mediaId: 'M2' }, { getMediaInfo });
    expect(getMediaInfo).not.toHaveBeenCalled();
  });

  test('a failed lookup never refuses: the size stays unknown and the reason is returned for the log', async () => {
    const getMediaInfo = jest.fn().mockRejectedValue(new Error('Graph 500'));
    const result = await resolveAudioDocument({ mimeType: 'audio/mp4', mediaId: 'M1' }, { getMediaInfo });
    expect(result).toEqual({ decision: 'route_to_audio_pipeline', sizeMB: null, sizeLookupError: 'Graph 500' });
  });
});

describe('audio-document-router — the refusal names the real state', () => {
  test('includes the size and the real 100 MB cap, never the old 25 MB one or a roadmap', () => {
    const msg = buildTooLargeMessage('142.3');
    expect(msg).toContain('142.3 MB');
    expect(msg).toContain('100 MB');
    expect(msg).not.toMatch(/25 ?MB|roadmap|transcription engine/i);
  });

  test('says nothing was received or started, and what to send instead', () => {
    const msg = buildTooLargeMessage('150.0');
    expect(msg).toMatch(/did not receive/i);
    expect(msg).toMatch(/nothing has started/i);
    expect(msg).toMatch(/voice recorder app/i);
    expect(msg).toMatch(/\*Document\*/);
  });

  test('is in the sender\'s language', () => {
    const ur = buildTooLargeMessage('150.0', { user: { preferred_language: 'ur' } });
    expect(ur).toMatch(/[\u0600-\u06FF]/);
    expect(ur).toContain('150.0 MB');
    expect(buildTooLargeMessage('150.0', { language: 'en' })).toMatch(/^This file is 150\.0 MB/);
  });
});

describe('audio-document-router — invariants used by handleDocumentMessage', () => {
  test('the transcription cap is the WhatsApp document ceiling, 100 MB (Soniox, not Whisper, transcribes long files)', () => {
    expect(WHISPER_MAX_BYTES).toBe(100 * 1024 * 1024);
  });

  test('WHATSAPP_DOCUMENT_MAX_BYTES is 100MB (Meta Cloud API document cap)', () => {
    expect(WHATSAPP_DOCUMENT_MAX_BYTES).toBe(100 * 1024 * 1024);
  });
});
