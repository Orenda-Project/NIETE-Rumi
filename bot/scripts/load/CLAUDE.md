# load — Offline load harness for the quiz queue

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/load kg=a0fe124c1d03 gen=1dc0ad6dfc68 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `quiz-queue-load-harness.js` — real workers on a virtual clock, no network
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `quiz-queue-load-harness.js` | Offline load harness running real SQS worker instances on a virtual clock and in-memory SQS to simulate quiz-queue traf… |

## Who reads this (generated)
- env read here: `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `QUIZ_QUEUE_OWN_LOOP` · `SQS_WORKER_CONCURRENCY` · `VIDEO_REPORT_SCHEDULE_ONCE`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`?
