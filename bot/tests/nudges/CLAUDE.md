# nudges — Tests for scheduled teacher nudges: store, sweeper, PKT time, worker wiring

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/nudges kg=114c98e4ddcc gen=36bdce131615 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `teacher-nudges.sweeper.test.js` — register/claim/handler contract of the sweep
- `teacher-nudges.store.test.js` — no-double-ask guards and closed vocabularies
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `nudge-flags.test.js` | Pins that the three R8 nudge switches (coaching ask, afternoon offer, sweeper) read 'on' the same way (bd-mg9c7.159.10) |
| `CLAUDE.md` | (unmapped) |
| `pkt-time.test.js` | Tests pkt-time: PKT (UTC+5, no DST) school-day and may-we-speak-now arithmetic for scheduled teacher nudges |
| `teacher-nudges-sqs-worker-wiring.test.js` | Pins that the teacher-nudge sweep interval is armed on the main-queue sqs-worker (90 s then 5 min) and never on video |
| `teacher-nudges.store.test.js` | Tests teacher-nudges.store: closed SKIP_REASONS vocabulary, KINDS incl. weekly usage report, and no-double-ask guards |
| `teacher-nudges.sweeper.test.js` | Tests teacher-nudge sweeper: kind registration, expiry, cohort build, claim, outcome marking, sends nothing itself |

## Who reads this (generated)
- env read here: `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `TEACHER_NUDGES_ENABLED`

## Never (human)
- A nudge kind is registered once only; two owners is a bug (tests/nudges/teacher-nudges.sweeper.test.js:91)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/nudges/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.md`? · `bot/tests/CLAUDE.index.md`? · `bot/tests/CLAUDE.md`? · `bot/tests/nudges/CLAUDE.md`? · `bot/workers/CLAUDE.index.md`? (+1)
