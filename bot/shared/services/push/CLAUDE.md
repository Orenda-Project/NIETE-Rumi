# push — Web quiz reminder push: VAPID subscriptions, routes and finish-response field
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/push kg=7c7ac2f5a365 gen=bb6a69e2c402 overflow=4 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `web-quiz-push.service.js` — table, sender and switches
- `web-quiz-push.routes.js` — internal router behind web_quiz_push_remind
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `web*` | 3 files; most used `web-quiz-push.service.js`: Web quiz reminder push: web_quiz_push_subscriptions table, VAPID sender, child and teacher evening reminders |

## Who reads this (generated)
- `web-quiz-push.service.js` ← imported by `bot/workers/push-ticks.js:21:b0b560fa` · `bot/shared/services/push/web-quiz-push-field.js:11:cc4db408` (+1)
- `web-quiz-push-field.js` ← imported by `bot/shared/routes/web-quiz-class-link.routes.js:25:34489aae`
- `web-quiz-push.routes.js` ← imported by `bot/shared/services/first-touch/push-remind.mount.js:9:ceb08b14`
- env read here: `WQ_PUSH_ENC_KEY` · `WQ_PUSH_HASH_SALT` · `WQ_PUSH_VAPID_PRIVATE` · `WQ_PUSH_VAPID_PUBLIC` · `WQ_PUSH_VAPID_SUBJECT`

## Never (human)
- Switches are JSON true only and fail closed (web-quiz-push.service.js:4-5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/push/web-quiz-push.routes.test.js`? (web-quiz-push-field.js, web-quiz-push.routes.js, web-quiz-push.service.js)
- `bot/tests/push/web-quiz-push-finish.test.js` (web-quiz-push.service.js)
- `bot/tests/push/web-quiz-push-gone.test.js` (web-quiz-push.service.js)
- `bot/tests/push/web-quiz-push-ps.test.js` (web-quiz-push.service.js)
- `bot/tests/push/web-quiz-push-qa.test.js` (web-quiz-push.service.js)
- `bot/tests/push/web-quiz-push.service.test.js` (web-quiz-push.service.js)
- `bot/tests/qfix-reminders/ask-src.test.js` (web-quiz-push.service.js)
- `bot/tests/qfix-reminders/push-canary-teacher.test.js` (web-quiz-push.service.js)
- `bot/tests/qfix-reminders/push-canary.test.js` (web-quiz-push.service.js)
- `bot/tests/qfix-reminders/push-copy-a.test.js` (web-quiz-push.service.js)
- `bot/tests/qfix-reminders/push-jcode.test.js` (web-quiz-push.service.js)
- `bot/tests/qfix-reminders/push-meters.test.js` (web-quiz-push.service.js)
- … 4 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`?
