# registration — Tests the registration Flow v5, its endpoint and every door that invites it
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/registration kg=a130dab197f2 gen=61871c7e4389 overflow=3 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bd-x7aprz2-registration-v5.test.js` — v5 endpoint; teacher or principal roles only
- `front-door-invite.test.js` — any unregistered adult reaches the Flow via one sender
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/registration --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `bd*` | 7 files; most used `bd-x7aprz2-registration-v5.test.js`: bd-x7aprz.2 and bd-3goqc0: registration v5 endpoint grants teacher or principal only, never alters coach or AEO |
| `front-door-invite.test.js` | Pins the front door: any unregistered adult or register request reaches the registration Flow via one invite sender |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `after-first-feature-invite.test.js` | Pins that after a delivered feature an unregistered adult gets the registration Flow once, via the one invite sender |
| `greeting-only.test.js` | Pins isGreetingOnly so a bare "hi" gets the registration invite and not a second AI greeting |
| `registration*` | 5 files; most used `registration-endpoint.test.js`: Pins registration-endpoint screen routing, BACK navigation and Redis persistence of the registration Flow |
| `flow-type-detector.test.js` | Pins detectFlowType, the nfm_reply router that picks the handler for each completed WhatsApp Flow |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `INTERNAL_API_KEY` · `REGISTRATION_FLOW_ID` · `SUPABASE_URL`

## Never (human)
- Finish must return a completion payload so the Flow closes (bd-x7aprz9-finish-closes-flow.test.js:2)
- Registration must ask language so it is chosen, not defaulted (registration-asks-language.test.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/setup/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.index.md`? (+6)
