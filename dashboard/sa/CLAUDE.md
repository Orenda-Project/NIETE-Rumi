# sa — Self-administered reading/maths battery engine served at /sa/*, offline-first
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/sa kg=cd06c1256d27 gen=e102f624e6bf overflow=139 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `sa-page.js` — boot of /sa/play.html, the page both coach and game open
- `sa-core.js` — pure runner of the timed subtasks; sa-ui.js draws it, sa-sync.js uploads
- `sw.js` — service worker keeping the battery and clips on the phone
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `img/` | → (no door; 14 files) |
| `v1/` | → (no door; 1378 files) |
| `v2/` | → (no door; 1378 files) |
| `v3/` | → (no door; 27 files) |
| `v4/` | Version-4 recorded clips for the battery's spoken lines, per language → `v4/CLAUDE.md` |
| `v5/` | → (no door; 112 files) |
| `sa*` | 12 files; most used `sa-core.js`: Pure runner: one child through a timed EGRA/EGMA battery; normalize() battery JSON, ordered events, no DOM/timers |
| `sw.js` | Battery service worker (scope /sa/): network-first engine files, cache-first battery and clips; offline prepare |
| `sink-coach.js` | Coach sink: battery putBatch/presign/register via portal relay /api/portal/leader/child-test/sa/session/:id/* |
| `clips.lock.json` | sha1 of every file sw.js serves cache-first (clips, word timings, pictures, batteries) and the SESSION they were taken with |
| `sink-game.js` | Game sink: battery sync via /api/sa-game/s/* with run token st and x-wq-device header; openSession/forGame helpers |
| … | 17 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Engine files live here, not in public/, so nothing is served while sa_engine is off (routes/sa-engine.routes.js:5)
- sa-core.js stays pure: no DOM, storage or timers (sa-core.js:4)
- sa-page.js VERSION and sw.js VERSION are bumped together; dashboard/tests/sa-r28-served-stamp fails on a one-sided bump
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/sa-r28-mic-unknown.service.test.js` (sa-core.js, sa-engine.js, sa-mic.js, sa-rec.js, sa-store.js, sa-ui.js, sink-coach.js)
- `dashboard/tests/sa-r13-whole-stop.service.test.js` (sa-core.js, sa-engine.js, sa-page.js, sa-store.js, sa-ui.js)
- … 133 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/CLAUDE.md`?
