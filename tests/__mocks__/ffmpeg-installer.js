/**
 * @ffmpeg-installer/ffmpeg and @ffprobe-installer/ffprobe stub for the root suite.
 *
 * Both packages exist only to ship a platform binary and expose its path. They live
 * in bot/node_modules, so bot/shared/services/audio.service.js could not load in the
 * root job even once fluent-ffmpeg itself was stubbed. One stub serves both: the
 * only member either caller reads is `.path`, and the fluent-ffmpeg stub beside this
 * one never launches what the path points at.
 */

module.exports = { path: '/nonexistent/stub/ffmpeg' };
module.exports.default = module.exports;
