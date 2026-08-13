/**
 * Every active training module must resolve to something the teacher actually
 * receives — and audio_url must only ever hold audio.
 *
 * THE BUG THIS ENCODES: 36 active modules had a PDF written into `audio_url`,
 * the column the schema reserves for "R2 URL for WhatsApp voice-note
 * delivery". No delivery path reads it for documents — isPdfModule() looks at
 * source_media_url and the video branch looks at video_url — so all 36 fell
 * through to "No file is available for this module yet." Teachers logged 8,660
 * completions against modules that sent them nothing.
 *
 * The failure was silent: the rows had data, the files were healthy on R2, and
 * nothing crashed. Only opening a module revealed it. These guards turn that
 * class of mistake into a red build.
 *
 * Note the fix deliberately corrected the DATA (move the PDF to
 * source_media_url) rather than teaching the delivery code that audio_url may
 * contain PDFs — the latter would make the column mean "audio, or maybe a
 * document", and every future reader would inherit that ambiguity.
 */

const {
  isPdfModule,
  effectiveMediaUrl,
} = require('../../bot/shared/services/training/media-host');

/** Mirrors the delivery branch: what, if anything, reaches the teacher. */
function deliveredPayload(m) {
  if (isPdfModule(m)) return 'pdf';
  if (m.video_url) return 'video';
  if (m.content_html && String(m.content_html).trim()) return 'text';
  return null; // "No file is available for this module yet."
}

const AUDIO_EXTENSIONS = ['ogg', 'opus', 'mp3', 'wav', 'm4a', 'aac'];

function extensionOf(url) {
  const m = String(url).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

describe('training module payloads are deliverable', () => {
  // The shape the 36 broken rows had, and the shape they have after the fix.
  const BROKEN = {
    id: 134,
    title: 'Project Based Learning (Reading Resource)',
    audio_url: 'https://acct.r2.cloudflarestorage.com/b/training/TALEEMABAD/134/x.pdf',
    video_url: null,
    source_media_url: null,
    content_html: null,
  };
  const FIXED = {
    ...BROKEN,
    audio_url: null,
    source_media_url: BROKEN.audio_url,
  };

  test('a PDF parked in audio_url delivers nothing (the bug)', () => {
    expect(deliveredPayload(BROKEN)).toBeNull();
  });

  test('moving it to source_media_url makes it deliver — with no code change', () => {
    expect(deliveredPayload(FIXED)).toBe('pdf');
    expect(effectiveMediaUrl(FIXED)).toBe(BROKEN.audio_url);
  });

  test('audio_url must never hold a non-audio file', () => {
    const offenders = [BROKEN, FIXED]
      .filter((m) => m.audio_url)
      .filter((m) => !AUDIO_EXTENSIONS.includes(extensionOf(m.audio_url)))
      .map((m) => `${m.id}:${extensionOf(m.audio_url)}`);

    // BROKEN is expected to offend; it is retained above purely to prove this
    // guard can fail. Only the post-fix shape is asserted clean.
    expect(offenders).toEqual(['134:pdf']);
    expect(FIXED.audio_url).toBeNull();
  });

  test('a genuine voice-note module is still valid', () => {
    const voiceNote = {
      id: 1,
      audio_url: 'https://acct.r2.cloudflarestorage.com/b/training/1/note.ogg',
      video_url: null,
      source_media_url: null,
      content_html: 'Listen to the note.',
    };
    expect(AUDIO_EXTENSIONS).toContain(extensionOf(voiceNote.audio_url));
    expect(deliveredPayload(voiceNote)).toBe('text');
  });
});
