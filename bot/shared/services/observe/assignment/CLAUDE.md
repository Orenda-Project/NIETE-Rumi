# assignment — Which schools and teachers a coach sees in the visit picker, and in what order

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/observe/assignment kg=ef41f5a14e82 gen=68cccb10f8bf overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `leader-source.js` — reads leader_schools and coaching_sessions for the visit Flow
- `prioritise.js` — picker ordering by support need and recency
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `leader-source.js` | Reads leader_schools and coaching_sessions and feeds the visit Flow its teacher shapes (FEAT-116 bd-2298) |
| `CLAUDE.md` | (unmapped) |
| `prioritise.js` | Orders the /observe visit picker by combined recency and support-need weight (bd-2302, bd-2329) |

## Who reads this (generated)
- `leader-source.js` ← imported by `bot/shared/handlers/observe-visit-flow.handler.js:29:72886994` · `bot/shared/services/observe/observe-binding.service.js:265:148ad7a9` (+3)
- `prioritise.js` ← imported by `bot/shared/services/observe/assignment/leader-source.js:23:d9517076`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/observe/bd-o8nt4-self-coachee-suppressed.test.js` (leader-source.js)
- `bot/tests/observe/visit-leader-source.test.js` (leader-source.js)
- `bot/tests/observe/visit-prioritise.test.js` (prioritise.js)
- `tests/coaching/brief-loop-source.test.js` (leader-source.js)
- `tests/observe/bd-5n1a2-resolve-teacher-empty-school.test.js` (leader-source.js)

## Related (generated)
- docs: `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.md`? · `bot/shared/services/observe/assignment/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`?
