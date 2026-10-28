# observe — Jest tests for the /observe stack: one file per incident or feature (bd-id in name)
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/observe kg=cf4b3b076787 gen=fa20ae3d2224 overflow=119 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `observe-endpoint.test.js` — Flow data_exchange contract
- `leader-teachers-deprecated.test.js` — ratchet on the deprecated table
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `cancelled-observation-stays-cancelled.test.js` | Pins a cancelled observation not being revived by photo-gate and lesson-plan Yes/No taps sent earlier |
| `bd-2kxxa2-media-target.test.js` | Pins media-target and session-resolver binding photos/docs to the tapped observation, else asking (bd-2kxxa.2) |
| `bd-jrxo3-no-bare-capture.test.js` | Pins raw audio not becoming an observation; maybeLaunchVisitFlow's three answers (bd-jrxo3) |
| `second-person-address.test.js` | Pins observe prompts stating the masculine Urdu plural is not neutral, with logged check on the guide |
| `observe-pipeline-fork.test.js` | Pins the /observe fork points inside the shared coaching pipeline: analysis to FICO draft (bd-2138) |
| `visit*` | 9 files; most used `visit-scheduling-wiring.test.js`: Pins scheduling wiring: detector discriminator, completion 3-way, flag-gated entry (bd-2444/2445) |
| `observe-endpoint-hots.test.js` | Pins the observe endpoint working for the HOTS pack and pack-driven score labels (bd-59, bd-60) |
| `bd-2kxxa3-debrief-transcription-failure.test.js` | Pins debrief transcription failure being caught, recorded, told once, never rethrown (bd-2kxxa.3) |
| … | 119 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `OBSERVE_FRAMEWORK` · `OBSERVE_MEWAKA_FLOW_ID` · `OBSERVE_VISIT_FLOW_ID` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `PORTAL_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
- Flow endpoint responses carry no `version` field (observe-endpoint.test.js:4, bd-215)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/cache/CLAUDE.index.md`? (+31)
