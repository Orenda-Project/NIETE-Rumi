# conversation — Coach's WhatsApp side of the child test: state machine, steps, recovery sweep
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/conversation kg=f605a0222a21 gen=c2ace9e13182 overflow=46 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `machine.js` — the state machine from list to presence to blocks
- `recovery.js` — scoring that survives restarts; sweep re-runs pending blocks
- `switches.js` — battery, maths and check-mode env switches
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `ports.js` | Lazy handles to the other lanes' modules (draw, store, scoring, check-flow, render, item bank) as the conversation... |
| `copy.js` | Coach copy for the child test from the ux-strings catalog (childTest* keys), Urdu default, Urdu digits |
| `identity.js` | Names a drawn child to coach/teacher: full name, classroom label, class teacher; never a roll number (CONTRACT 18-19) |
| `gate.js` | Pure gate: CHILD_TEST_ENABLED, coach/leader role and ICT region decide who may start the child test |
| `recovery.js` | Restart-safe scoring: runScoring plus a sweep that re-runs blocks left pending after a deploy and sends the check |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.js` ← imported by `bot/shared/services/child-test/check-flow/review-v3.js:30:796122bb` · `bot/shared/services/child-test/check-flow/review-view.js:10:37ad926e` (+11)
- `identity.js` ← imported by `bot/shared/services/child-test/check-flow/context.js:12:b9c81850` · `bot/shared/services/child-test/check-flow/review-v3.js:31:ad3926a9` (+5)
- `gate.js` ← imported by `bot/shared/handlers/text-message.handler.js:978:83e9366e` · `bot/shared/services/child-test/app/app-api.service.js:68:61d0ef1b` (+4)
- … 21 more → `CLAUDE.index.md`

## Never (human)
- No in-process setTimeout for nudges, redeploys must lose nothing (nudge.js:10-11)
- Name children by full name and room, never a roll (identity.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/child-test/L36/journey-v3.test.js` (bank-v3.js, nudge.js, ports.js, recovery.js, state.js, steps-v3.js, switches.js)
- `tests/child-test/L26/journey-v2.test.js` (identity.js, nudge.js, ports.js, recovery.js, steps.js)
- … 24 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/child-test/CLAUDE.md`?
