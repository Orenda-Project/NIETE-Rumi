/**
 * fluent-ffmpeg stub for the root test suite.
 *
 * bot/shared/services/audio.service.js requires it at module scope. The package
 * lives in bot/node_modules (13MB, and it shells out to a real ffmpeg binary), so
 * any root suite whose chain reached audio handling died on an unresolved module.
 * A unit suite should never invoke a real transcoder, so this is a stub rather
 * than a root dependency.
 *
 * The API surface mirrors exactly what audio.service.js uses: the factory returns a
 * chainable command object, plus the three statics (setFfmpegPath, setFfprobePath,
 * ffprobe). ffprobe calls back with a zero-duration payload — audio.service reads
 * `metadata.format.duration` and already treats a missing value as 0, so a suite
 * that forgot to mock it sees a 0-second clip rather than a TypeError.
 */

function command() {
  const c = {};
  for (const m of ['input', 'inputOptions', 'output', 'outputOptions', 'audioCodec',
                   'audioBitrate', 'audioChannels', 'audioFrequency', 'videoCodec',
                   'format', 'seekInput', 'setStartTime', 'duration', 'size',
                   'toFormat', 'noVideo', 'complexFilter']) {
    c[m] = jest.fn(() => c);
  }
  // `.on('end', cb)` is how callers await completion; fire nothing by default so a
  // test that depends on the pipeline must mock it explicitly and visibly.
  c.on = jest.fn(() => c);
  c.save = jest.fn(() => c);
  c.pipe = jest.fn(() => c);
  c.run = jest.fn(() => c);
  return c;
}

const ffmpeg = jest.fn(() => command());
ffmpeg.setFfmpegPath = jest.fn();
ffmpeg.setFfprobePath = jest.fn();
ffmpeg.ffprobe = jest.fn((_path, cb) => cb(null, { format: { duration: 0 }, streams: [] }));

module.exports = ffmpeg;
module.exports.default = ffmpeg;
