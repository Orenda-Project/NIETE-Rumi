# status — Tests /status: active-resource listing, cancel actions, completion acks and logging
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/status kg=26850195323e gen=965c16f9f9dc overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `status-flow.test.js` — teacher-state.service and status-flow-endpoint handlers
- `every-status-action-is-decided.test.js` — each status_action is acked or silent with a reason
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/status --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `status*` | 8 files; most used `status-training-visibility.test.js`: Pins that /status lists an in-flight training-quiz attempt and names the question it is on |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `every-status-action-is-decided.test.js` | Guard: every status_action the /status Flow can emit is either acknowledged in chat or silent with a stated reason |

## Who reads this (generated)
- (none)

## Never (human)
- /status must answer in chat when nothing runs, not open the Flow (status-command.test.js:2)
- Every /status Flow refusal logs at error; an empty footer payload once went unseen (status-flow-errors-are-logged.test.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/status/CLAUDE.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/status/CLAUDE.index.md`? (+1)
