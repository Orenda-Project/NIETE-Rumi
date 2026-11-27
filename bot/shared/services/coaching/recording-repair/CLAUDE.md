# recording-repair — rebuild a damaged teacher recording before it is transcribed (bd-8sr958, queue #320)

## Entry points
- `damaged-audio.js` — the job's side: `repairBeforeTranscription` (called by processTranscription), `handleDamagedFailure` (one message, one Slack post)
- `index.js` — `inspectRecording` (box walk, no decoding) and `repairRecording` (ladder: remux, her reference file, templates; then verify)
- `frame-finder.mjs` — the AAC frame finder on node-av, run as a CHILD process (native lib, ES module, ~170 MB while it works)

## Never (human)
- Never ask her to record again or "try again": a file that cannot be rebuilt fails ONCE as failed_step 'damaged_audio' (catalog key damagedRecording), the team gets ONE Slack post, the job is permanent
- Runs BEFORE the portal short-recording gate and the duplicate-audio check; a finished file is a box walk and nothing else
- `repairRecording` never throws; no hand-built moov (found frames -> ADTS -> bundled ffmpeg remux); verify = full decode, 0 errors
- Tests use synthetic audio only (bot/tests/recording-repair/synthetic.js); teacher audio stays in R2 and the scratchpad
- node-av needs Node >= 22.18 and its linux prebuilt is GPL-3.0-or-later: it stays in its own process
