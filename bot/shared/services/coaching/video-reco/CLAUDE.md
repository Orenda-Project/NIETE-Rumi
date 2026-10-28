# video-reco — Training-video recommendation engine for coaching reports (VIDREC)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/video-reco kg=f41d82a01a6b gen=b10e487e7824 overflow=124 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `engine.js` — recommendForReport pipeline
- `send.js` — the clip message after the report
- `flags.js` — env switches, unset means off
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `catalog.js` | Loads and caches the versioned training-video catalogue JSON (modules, chapters) the engine reads (bd-gzfdu9) |
| `engine.js` | recommendForReport: never-throwing pipeline from flag and target to shortlist, one LLM pick, redaction, stored row |
| `select.js` | The single completeJson pick (coaching.videoReco job) and the validation every answer passes before storage |
| `copy.js` | Fills clip message strings: minutes, Urdu digits, language name, and LTR isolates for English runs in Urdu |
| … | 22 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `clip-pref.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+170)
- `copy.js` ← imported by `dashboard/routes/video-reco.routes.js:23:acc21039` · `dashboard/services/coaching-report-page.js:17:07c6eb0f` (+8)
- `flags.js` ← imported by `dashboard/services/video-reco-events.js:75:f1208529` · `bot/shared/services/coaching/video-reco/arm.js:12:0666eb1f` (+5)
- … 25 more → `CLAUDE.index.md`

## Never (human)
- Engine and sender never throw; a failed clip must not touch the report (send.js:12, engine.js:173)
- Names must pass redact-names.js before reaching a prompt, quote or page (redact-names.js:3, VIDREC H8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/video-reco/skip-iab.test.js` (arm.js, caption-link.js, catalog.js, clip-pref.js, engine.js, flags.js, link-token.js, send.js, strip.js)
- `tests/coaching/video-reco/r7c.test.js` (catalog.js, copy.js, engine.js, prompt.js, select.js, shortlist.js, silence.js)
- … 77 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/video-reco/CLAUDE.index.md`? · `bot/shared/services/coaching/video-reco/CLAUDE.md`?
