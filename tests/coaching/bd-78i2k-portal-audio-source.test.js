/**
 * bd-78i2k — a classroom recording can arrive from the PORTAL, not just WhatsApp.
 *
 * The teacher self-observation (DC) pipeline has only ever had one audio
 * transport: a WhatsApp media id, downloaded through the Graph API. A browser
 * upload has no media id, so the portal puts the file straight into R2 and
 * records the resulting URL on `coaching_sessions.audio_url` BEFORE queueing
 * transcription.
 *
 * `audio_url` is safe to overload as that signal: on a WhatsApp session it is
 * written only AFTER transcription (see the updateData block), so at fetch time
 * it is always empty. A populated `audio_url` therefore means — unambiguously —
 * "this audio is already in R2, do not call Meta".
 *
 * What is under test is ONLY the source of the bytes. Everything downstream of
 * the fetch — dedupe, status transitions, Soniox, analysis, report queueing —
 * is untouched, and the WhatsApp path must stay byte-for-byte as it was.
 */

const path = require('path');

const SERVICE = '../../bot/shared/services/coaching/transcription-processor.service';
const WHATSAPP = '../../bot/shared/services/whatsapp.service';
const R2 = '../../bot/shared/storage/r2';

/** A chainable PostgREST double returning one coaching_sessions row. */
function supabaseReturning(row) {
  const q = {
    from: () => q,
    select: () => q,
    eq: () => q,
    update: () => q,
    single: async () => ({ data: row, error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return q;
}

describe('bd-78i2k — transcription audio source', () => {
  const AUDIO = Buffer.from('classroom audio bytes');
  const R2_URL = 'https://r2.example/classroom/portal-upload.ogg';

  let downloadMedia;
  let downloadFromR2;

  beforeEach(() => {
    jest.resetModules();

    downloadMedia = jest.fn().mockResolvedValue(AUDIO);
    downloadFromR2 = jest.fn().mockResolvedValue(AUDIO);

    jest.doMock(WHATSAPP, () => ({
      downloadMedia,
      sendMessage: jest.fn().mockResolvedValue(undefined),
      sendInteractiveButtons: jest.fn().mockResolvedValue(undefined),
      sendAudio: jest.fn().mockResolvedValue(undefined),
    }));

    jest.doMock(R2, () => ({
      downloadFromR2,
      uploadClassroomAudio: jest.fn().mockResolvedValue(R2_URL),
      extractKeyFromUrl: (url) => String(url).split('/').pop(),
    }));
  });

  /**
   * Both assertions call the private fetch seam directly rather than driving
   * the whole processTranscription pipeline (which would need Soniox, GPT and
   * a dozen more doubles). The seam is the entire behaviour change.
   */
  function loadFetcher() {
    const svc = require(SERVICE);
    expect(typeof svc.fetchAudioForSession).toBe('function');
    return svc.fetchAudioForSession;
  }

  test('a portal session (audio_url already set) is read from R2, never from WhatsApp', async () => {
    const fetchAudioForSession = loadFetcher();

    const bytes = await fetchAudioForSession(
      { id: 'cs-1', audio_url: R2_URL, audio_id: null },
      { from: '923001234567' },
    );

    expect(downloadFromR2).toHaveBeenCalledTimes(1);
    expect(downloadMedia).not.toHaveBeenCalled();
    expect(bytes).toEqual(AUDIO);
  });

  test('a WhatsApp session (no audio_url) still downloads the media id — unchanged', async () => {
    const fetchAudioForSession = loadFetcher();

    const bytes = await fetchAudioForSession(
      { id: 'cs-2', audio_url: null, audio_id: 'wamid.MEDIA123' },
      { from: '923001234567', audioId: 'wamid.MEDIA123' },
    );

    expect(downloadMedia).toHaveBeenCalledWith('wamid.MEDIA123');
    expect(downloadFromR2).not.toHaveBeenCalled();
    expect(bytes).toEqual(AUDIO);
  });

  test('a WhatsApp session with no media id anywhere still throws the same error', async () => {
    const fetchAudioForSession = loadFetcher();

    await expect(
      fetchAudioForSession({ id: 'cs-3', audio_url: null, audio_id: null }, {}),
    ).rejects.toThrow(/Audio ID not found/);

    expect(downloadFromR2).not.toHaveBeenCalled();
  });
});
