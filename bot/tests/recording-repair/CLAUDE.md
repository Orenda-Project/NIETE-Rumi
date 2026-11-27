# tests/recording-repair — synthetic-audio tests for the damaged-recording repair (bd-8sr958)

## Entry points
- `synthetic.js` — makes AAC m4a files with the bundled ffmpeg and damages them (no moov, mdat size zero or ????, torn tail)
- `recording-repair.test.js` — inspect + the ladder on those files (decode with 0 errors, same length)
- `damaged-audio.test.js` — the job's side with injected deps: one message, one alert, never "try again"
- `wiring.test.js` — repair runs before the short gate and the dedupe

## Never (human)
- No teacher audio in a test or the repo: synthetic files only
