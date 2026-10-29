# sa — Self-administered reading/maths battery engine served at /sa/*, offline-first
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/sa kg=f2f6de4537c8 gen=6e1d71520008 overflow=91 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `sa-page.js` — boot of /sa/play.html, the page both coach and game open
- `sa-core.js` — pure runner of the timed subtasks; sa-ui.js draws it, sa-sync.js uploads
- `sw.js` — service worker keeping the battery and clips on the phone
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `img/` | → (no door; 14 files) |
| `v1/` | → (no door; 1311 files) |
| `v2/` | → (no door; 1311 files) |
| `v3/` | → (no door; 24 files) |
| `v4/` | Version-4 recorded clips for the battery's spoken lines, per language → `v4/CLAUDE.md` |
| `sa*` | 12 files; most used `sa-core.js`: Pure runner: one child through a timed EGRA/EGMA battery; normalize() battery JSON, ordered events, no DOM/timers |
| `sw.js` | Battery service worker (scope /sa/): network-first engine files, cache-first battery and clips; offline prepare |
| `sink-coach.js` | Coach sink: battery putBatch/presign/register via portal relay /api/portal/leader/child-test/sa/session/:id/* |
| `sink-game.js` | Game sink: battery sync via /api/sa-game/s/* with run token st and x-wq-device header; openSession/forGame helpers |
| `demo-battery.json` | Demo battery (coach G3 set A, ur) with welcome/audio-check lines and tasks; default form of the QA page run.html |
| `skin-game.js` | Game skin script: registers game sink from stored run token, Jugnu glow while timed task runs, chime and fanfare, mute |
| … | 14 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Engine files live here, not in public/, so nothing is served while sa_engine is off (routes/sa-engine.routes.js:5)
- sa-core.js stays pure: no DOM, storage or timers (sa-core.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/sa-r4-coach-last-word.service.test.js` (sa-core.js, sa-engine.js, sa-store.js, sa-ui.js, sink-coach.js)
- `dashboard/tests/sa-r8-offline-hunks.service.test.js` (sa-core.js, sa-engine.js, sa-offline.js, sa-store.js, sa-voice.js)
- … 88 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.md`?
