# sa — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/sa -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `img/` | → (no door; 14 files) |
| `v1/` | → (no door; 1311 files) |
| `v2/` | → (no door; 1311 files) |
| `v3/` | → (no door; 24 files) |
| `v4/` | Version-4 recorded clips for the battery's spoken lines, per language → `v4/CLAUDE.md` |
| `clips.lock.json` | sha1 of every file sw.js serves cache-first (clips, word timings, pictures, batteries) and the SESSION they were taken with |
| `demo-battery.json` | Demo battery (coach G3 set A, ur) with welcome/audio-check lines and tasks; default form of the QA page run.html |
| `play.html` | The child's battery page /sa/play.html: loads engine scripts; both coach (proctored) and game surfaces open it |
| `run.html` | QA harness page /sa/run.html: loads sa-core, sa-voice, sa-ui and sa-run to render battery screens without store or sync |
| `sa-core.js` | Pure runner: one child through a timed EGRA/EGMA battery; normalize() battery JSON, ordered events, no DOM/timers |
| `sa-engine.js` | Engine's one door SAE.start(): joins runner, store, voice, ui, sync and recorder for a surface in proctored or game mode |
| `sa-mic.js` | SAE.mic: microphone checks (game's once-per-device check, practice spoken question), live level; probe is never uploaded |
| `sa-offline.js` | Page side of the offline copy: registers /sa/sw.js (updating to a new worker first, bounded), asks it to keep battery, clips and pictures, reports ready-offline |
| `sa-page.js` | Boot of /sa/play.html: reads ?s=&form=&mode=&block=, picks the sink (coach relay or game), starts the engine |
| `sa-rec.js` | Battery recorder: MediaRecorder chunks saved to the phone store each second, final one uploaded; silence watch |
| `sa-run.js` | Standalone QA bootstrap for run.html: mounts screens from query params (lang, mode, form) and exposes window.__sae |
| `sa-store.js` | Phone store (IndexedDB 'sa-engine', memory fallback) of sessions, events, results, audio chunks until synced |
| `sa-sync.js` | Upload queue: sends batches, results and audio to the surface's sink idempotently with backoff 2-60 s and status |
| `sa-ui.js` | Battery screens: draws runner.view() for one child (tap, keypad, keyboard, read tasks), v4 word highlight kept in view |
| `sa-voice.js` | Jugnu's voice for the runner: recorded clip first, then phone speechSynthesis in allowed voices, else a short pause |
| `sa.css` | Styles for the battery screens (sa-ui): navy on warm paper, amber accent, 360x640 first, SAE Nastaliq font for Urdu |
| `sink-coach.js` | Coach sink: battery putBatch/presign/register via portal relay /api/portal/leader/child-test/sa/session/:id/* |
| `sink-game.js` | Game sink: battery sync via /api/sa-game/s/* with run token st and x-wq-device header; openSession/forGame helpers |
| `skin-game.css` | Game skin on /sa/play.html (?skin=game): day-sky background, Jugnu glow in corner, one mute button |
| `skin-game.js` | Game skin script: registers game sink from stored run token, Jugnu glow while timed task runs, chime and fanfare, mute |
| `sw.js` | Battery service worker (scope /sa/): network-first engine files, cache-first battery and clips; offline prepare |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- `sa-core.js` ← `bot/tests/child-test/sa-extra.test.js` · `bot/tests/child-test/sa-reading-3.test.js` · `bot/tests/child-test/sa-rulings.test.js` · `bot/tests/child-test/sa-runtime.test.js` · `dashboard/tests/sa-check-tap-early.service.test.js` · `dashboard/tests/sa-check-words-clips.service.test.js` (+61: `python3 kg/kg.py who-reads dashboard/sa/sa-core.js`)
- `sa-engine.js` ← `dashboard/tests/sa-check-words-clips.service.test.js` · `dashboard/tests/sa-engine-back-offline.service.test.js` · `dashboard/tests/sa-engine-battery-end.service.test.js` · `dashboard/tests/sa-engine.service.test.js` · `dashboard/tests/sa-r4-cell-pace.service.test.js` · `dashboard/tests/sa-r4-coach-last-word.service.test.js` (+11: `python3 kg/kg.py who-reads dashboard/sa/sa-engine.js`)
- `sa-mic.js` ← `dashboard/tests/sa-mic.service.test.js` · `dashboard/tests/sa-r8-cues.service.test.js`
- `sa-offline.js` ← `dashboard/tests/sa-clip-429.service.test.js` · `dashboard/tests/sa-offline-images.service.test.js` · `dashboard/tests/sa-offline.service.test.js` · `dashboard/tests/sa-opening-gate.service.test.js` · `dashboard/tests/sa-prepare.service.test.js` · `dashboard/tests/sa-r8-offline-hunks.service.test.js` (+4: `python3 kg/kg.py who-reads dashboard/sa/sa-offline.js`)
- `sa-page.js` ← `dashboard/tests/sa-clip-429.service.test.js` · `dashboard/tests/sa-opening-gate.service.test.js` · `dashboard/tests/sa-page.service.test.js` · `dashboard/tests/sa-r8-lang.service.test.js` · `dashboard/tests/sa-r8-offline-prep.service.test.js` · `dashboard/tests/sa-r8-passage-variant.service.test.js` (+3: `python3 kg/kg.py who-reads dashboard/sa/sa-page.js`)
- `sa-rec.js` ← `dashboard/tests/sa-r4-cell-pace.service.test.js` · `dashboard/tests/sa-r7b-rec-discard.service.test.js` · `dashboard/tests/sa-r8-cues.service.test.js` · `dashboard/tests/sa-r8-position.service.test.js` · `dashboard/tests/sa-rec-mercy.service.test.js` · `dashboard/tests/sa-rec.service.test.js` (+1: `python3 kg/kg.py who-reads dashboard/sa/sa-rec.js`)
- `sa-store.js` ← `dashboard/tests/sa-check-words-clips.service.test.js` · `dashboard/tests/sa-engine-back-offline.service.test.js` · `dashboard/tests/sa-engine-battery-end.service.test.js` · `dashboard/tests/sa-engine.service.test.js` · `dashboard/tests/sa-page.service.test.js` · `dashboard/tests/sa-r4-cell-pace.service.test.js` (+19: `python3 kg/kg.py who-reads dashboard/sa/sa-store.js`)
- `sa-sync.js` ← `dashboard/tests/sa-page.service.test.js` · `dashboard/tests/sa-sync-events-first.service.test.js` · `dashboard/tests/sa-sync-skip.service.test.js` · `dashboard/tests/sa-sync.service.test.js` · `dashboard/tests/sa-two-recordings.service.test.js` · `dashboard/tests/sa-ui-handback.service.test.js`
- `sa-ui.js` ← `bot/tests/child-test/sa-reviewed-lines.test.js` · `bot/tests/child-test/sa-tester-fixes.test.js` · `dashboard/tests/sa-check-tap-early.service.test.js` · `dashboard/tests/sa-image-unavailable.service.test.js` · `dashboard/tests/sa-opening-gate.service.test.js` · `dashboard/tests/sa-r4-coach-last-word.service.test.js` (+39: `python3 kg/kg.py who-reads dashboard/sa/sa-ui.js`)
- `sa-voice.js` ← `dashboard/tests/sa-r8-offline-hunks.service.test.js` · `dashboard/tests/sa-ui-tester-fixes.service.test.js`
- `sink-coach.js` ← `dashboard/tests/sa-r4-coach-last-word.service.test.js` · `dashboard/tests/sa-sink-coach.service.test.js`
- `sink-game.js` ← `dashboard/tests/sa-game-sink-client.service.test.js`
- `sw.js` ← `bot/tests/child-test/sa-voice-sustained-sounds.test.js` · `dashboard/tests/sa-offline.service.test.js` · `dashboard/tests/sa-r8-offline-prep.service.test.js` · `dashboard/tests/sa-sw-session.service.test.js` · `dashboard/tests/sa-voice-gate.service.test.js`

## Related (all, generated)
- docs: `dashboard/CLAUDE.md`?
