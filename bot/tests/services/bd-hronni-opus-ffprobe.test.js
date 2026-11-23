/**
 * bd-hronni (queue #237) — the pipeline reads a REAL Ogg Opus recording with the real ffprobe.
 *
 * The WhatsApp file door and the portal's short-recording check decide "a lesson or a voice note?" on
 * AudioService.getAudioDuration. It writes the bytes under a .m4a name; ffprobe reads the container from the bytes, so
 * Ogg Opus (WhatsApp voice notes, many Android recorders) is measured like any other recording.
 *
 * Real binaries (the root suite stubs fluent-ffmpeg on purpose). Run: cd bot && npx jest tests/services/bd-hronni-opus-ffprobe
 * Fixture: tests/fixtures/audio/lesson-hello.opus — 4.25 s of speech, Opus 16 kbps in Ogg, 7.7 KB.
 */
const fs = require('fs');
const path = require('path');

const OPUS = fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/audio/lesson-hello.opus'));

test('ffprobe measures a real Ogg Opus recording (4.25 s)', async () => {
  const AudioService = require('../../shared/services/audio.service');
  const seconds = await AudioService.getAudioDuration(OPUS);
  expect(seconds).toBeGreaterThan(4);
  expect(seconds).toBeLessThan(4.5);
}, 30000);
