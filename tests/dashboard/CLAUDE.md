# dashboard — Dashboard portal proxy routes to the bot: assessment, classes, board pattern

<!-- kg:meta repo=NIETE-Rumi dir=tests/dashboard kg=4723d9b326d4 gen=4a35d412c6bf overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `portal-proxy-harness.js` — loads the real portal router with only I/O edges stubbed
- `fde-proxy.test.js` — pattern/scope carried to the bot; plain request unchanged
- Under root jest, not dashboard/tests: `node tests/run.js tests/dashboard --maxWorkers=2` from repo root
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `portal-proxy-harness.js` | Shared harness for dashboard assessment proxy tests: real portal router with Supabase, pg, R2 and axios stubbed |
| `CLAUDE.md` | (unmapped) |
| `assessment-rate-limit.test.js` | Per-teacher paper limit (10/hour, 30/day) behind assessment_rate_limit_enabled; readable "next one at" message |
| `assessment-ask-shared-path.test.js` | Dashboard assessment.service: coded 400/409 passthrough applies only to the create path of the shared ask() |
| `assessment-topics-route.test.js` | GET /api/portal/assessment/topics: portal auth, then the real assessment.service proxies to the bot's topics route |
| `classes-remove-proxy.test.js` | bd-ql2j3p: DELETE /api/portal/classes/:classId proxies to the bot's remove, teacher id taken from the session |
| `fde-proxy.test.js` | Portal /assessment/generate proxy carries board pattern and scope to the bot; plain requests stay byte-identical |
| `fde-r7-status-passthrough.test.js` | Portal /assessment/status passes the bot's pattern and created_at (and failure code) through for board-pattern papers |
| `topics-origin-proxy.test.js` | bd-6clakk.10, bd-pw1ccr.1: generate proxy forwards topicIds and origin to the bot; absent when the app omits them |

## Who reads this (generated)
- (none)

## Never (human)
- A plain generate request reaches the bot byte-identical to before (tests/dashboard/fde-proxy.test.js:42)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/lib/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/dashboard/CLAUDE.md`?
