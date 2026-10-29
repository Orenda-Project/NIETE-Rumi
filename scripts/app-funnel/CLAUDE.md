# app-funnel — Teacher-app funnel report built from Axiom journey events

<!-- kg:meta repo=NIETE-Rumi dir=scripts/app-funnel kg=8ffbe485bb0d gen=6dbfca7a49b7 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `funnel.py` — CLI: journeys per step and drop-off page, per starting command
- `test_funnel.py` — pure-logic tests, no network
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `funnel.py` | CLI: queries Axiom for app_funnel/app_link events and prints the teacher-app funnel per starting command (bd-4r3rei) |
| `test_funnel.py` | Unit tests for funnel.py's pure step-counting and last-page drop-off logic, no network (bd-4r3rei) |

## Who reads this (generated)
- `funnel.py` ← imported by `scripts/app-funnel/test_funnel.py:6:0e9004cd`
- env read here: `AXIOM_TOKEN`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `scripts/app-funnel/test_funnel.py` (funnel.py)

## Related (generated)
- docs: `docs/app-funnel-telemetry.md`? · `scripts/CLAUDE.md`?
