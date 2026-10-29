# observe — Jest tests for the /observe stack: one file per incident or feature (bd-id in name)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/observe kg=b8a116633d72 gen=b5338118fa4a overflow=117 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `observe-endpoint.test.js` — Flow data_exchange contract
- `leader-teachers-deprecated.test.js` — ratchet on the deprecated table
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `cancelled-observation-stays-cancelled.test.js` | Pins a cancelled observation not being revived by photo-gate and lesson-plan Yes/No taps sent earlier |
| `bd-2kxxa2-media-target.test.js` | Pins media-target and session-resolver binding photos/docs to the tapped observation, else asking (bd-2kxxa.2) |
| `bd-jrxo3-no-bare-capture.test.js` | Pins raw audio not becoming an observation; maybeLaunchVisitFlow's three answers (bd-jrxo3) |
| `second-person-address.test.js` | Pins observe prompts stating the masculine Urdu plural is not neutral, with logged check on the guide |
| `observe-pipeline-fork.test.js` | Pins the /observe fork points inside the shared coaching pipeline: analysis to FICO draft (bd-2138) |
| `visit*` | 9 files; most used `visit-scheduling-wiring.test.js`: Pins scheduling wiring: detector discriminator, completion 3-way, flag-gated entry (bd-2444/2445) |
| `observe-endpoint-hots.test.js` | Pins the observe endpoint working for the HOTS pack and pack-driven score labels (bd-59, bd-60) |
| `bd-2kxxa3-debrief-transcription-failure.test.js` | Pins debrief transcription failure being caught, recorded, told once, never rethrown (bd-2kxxa.3) |
| `bd-dy7hs-one-language-owner.test.js` | Pins the teacher report using the language resolver and removal of the language toggle (bd-dy7hs) |
| … | 127 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Flow endpoint responses carry no `version` field (observe-endpoint.test.js:4, bd-215)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/cache/CLAUDE.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/frameworks/CLAUDE.md`? · `bot/shared/services/coaching/report-renderers/CLAUDE.md`? · `bot/shared/services/observe/CLAUDE.md`? · `bot/shared/services/observe/assignment/CLAUDE.md`? (+6)
