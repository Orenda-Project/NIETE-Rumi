'use strict';
/**
 * bd-8bdr8r.1 — on the staging portal the bundled @ffmpeg-installer binary is killed by a signal before any audio
 * when it reads a presigned R2 link (log: "ffmpeg exited null before any audio"), so every coach disagreement
 * clip answered 503; the same link and arguments cut a clip with a stock ffmpeg. The image now carries Debian's
 * ffmpeg (railpack.json is read by every service), and the portal points FFMPEG_PATH at /usr/bin/ffmpeg.
 */
const railpack = require('../../railpack.json');

describe('railpack.json', () => {
  it('installs ffmpeg in the deployed image, for the coach disagreement clips', () => {
    expect(railpack.deploy.aptPackages).toContain('ffmpeg');
  });
});
