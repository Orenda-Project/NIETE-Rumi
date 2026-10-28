# fflp — Free-form (typed-topic) lesson plan seam: switch, catalogue match, queue, goldens

<!-- kg:meta repo=NIETE-Rumi dir=tests/fflp kg=696b5eec9c2d gen=40ec5388f38a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `seam-goldens.test.js` — runs the real text handler per row, switch absent vs ON, against goldens/
- `switch.test.js` — the freeform_lp app_settings switch; defaults OFF on every failure path
- Covers fflp services, queue, migration V1.7.8. Root jest (tests/jest.config.js): from repo root `node tests/run.js tests/fflp --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `goldens/` | Pinned WhatsApp/DB call recordings for the free-form seam, one JSON per row → `goldens/CLAUDE.md` |
| `queue-worker.test.js` | Pins createAndQueueFreeform and the generation worker accepting free-form jobs; SQS failure marks the row failed at once |
| `CLAUDE.md` | (unmapped) |
| `seam-goldens.test.js` | Runs real text-message handler per fixture teacher, switch absent vs ON, and compares output to goldens/*.golden.json |
| `catalogue-match.test.js` | Pins fflp catalogue-match: topic normalise/tokens and ranking so a catalogue HIT on a typed topic is never changed |
| `switch.test.js` | Pins the freeform_lp app_settings switch: every read failure or bad config reads as OFF, default off |
| `engine-ready.test.js` | Pins fflp.engineReady(): true only when a fflp/engine module exists (virtual jest module), false and no throw otherwise |
| `migration-v178.test.js` | Pins migration V1.7.8: nullable textbook_metadata jsonb on lesson_plan_requests, rollback guard; V1.7.7 files gone |

## Who reads this (generated)
- (none)

## Never (human)
- Don't regenerate a golden to make a test pass: they pin pre-change bytes so catalogue doors can't move (seam-goldens.test.js:9)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/fflp/CLAUDE.md`? · `bot/shared/services/queue/CLAUDE.index.md`? · `bot/workers/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? (+3)
