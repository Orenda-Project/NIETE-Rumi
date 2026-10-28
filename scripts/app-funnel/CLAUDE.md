# app-funnel — Teacher-app funnel report built from Axiom journey events

<!-- kg:meta repo=NIETE-Rumi dir=scripts/app-funnel kg=67eefeb95c2b gen=dc4313b97902 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `funnel.py` — CLI: journeys per step and drop-off page, per starting command
- `test_funnel.py` — pure-logic tests, no network
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `funnel.py` | CLI: queries Axiom for app_funnel/app_link events and prints the teacher-app funnel per starting command (bd-4r3rei) |
| `test_funnel.py` | Unit tests for funnel.py's pure step-counting and last-page drop-off logic, no network (bd-4r3rei) |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- `funnel.py` ← imported by `scripts/app-funnel/test_funnel.py:6:0e9004cd`
- env read here: `AXIOM_TOKEN`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `scripts/app-funnel/test_funnel.py` (funnel.py)

## Related (generated)
- docs: `docs/app-funnel-telemetry.md`? · `scripts/CLAUDE.index.md`? · `scripts/CLAUDE.md`? · `scripts/app-funnel/CLAUDE.md`?
