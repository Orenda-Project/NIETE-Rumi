# app — Coach-app API and app_settings switches for the self-administered assessment
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/app kg=674396aa3b5b gen=081efbd7d8d6 overflow=53 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `sa-api.service.js` — schools, day list, outcomes, battery, sessions for the portal
- `app-api.service.js` — coach-recorded child test from the app (bd-s1oo0.7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `sa-api.service.js` | Coach app's self-administered Learning assessment API: schools, day list, outcomes, battery, presign, register, sessions |
| `app-api.service.js` | Bot side of the coach-app child test (card, timer, recorder); portal relays here over the internal API (bd-s1oo0.7) |
| `practice-only-switch.js` | Switch (child_test_practice_only): coaches off the pilot list get practice schools only; read by gate.isPracticeCoach |
| `coach-last-word-switch.js` | Switch (sa_coach_last_word) enabling POST /sa/last-word-hint suggestions for coaches; read by sa-api.service |
| … | 14 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `app-api.service.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:69:83955dcf` · `bot/shared/services/child-test/app/sa-review.service.js:19:6a7c12b1`
- `coach-last-word-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:85:6ae06b45` · `bot/shared/services/child-test/app/sa-api.service.js:60:317cbf62`
- `practice-only-switch.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:83:0b89114b` · `bot/shared/services/child-test/app/sa-api.service.js:61:38022a6f`
- `stop-rules-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:84:9b745876` · `bot/shared/services/child-test/app/sa-api.service.js:58:d22b901d`
- … 18 more → `CLAUDE.index.md`

## Never (human)
- Switches fail closed: only JSON true turns one on (rdf-switch.js:6)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/sa-practice-only.test.js` (app-api.service.js, practice-only-switch.js, sa-api.service.js)
- `bot/tests/child-test/sa-any-school.test.js` (any-school-switch.js, sa-api.service.js)
- … 26 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/child-test/CLAUDE.md`?
