# app-redirect — Bot-to-app redirect: per-feature switches and the one-tap /go login link
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/app-redirect kg=89770b98261b gen=35abecd9a6fc overflow=14 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `app-redirect.service.test.js` — the app_redirect_<feature> switch registry and its contract
- `app-login-link.test.js` — encrypted 24 h login token behind the /go link
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/app-redirect --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `app-link-leader-lessons-doors.test.js` | bd-a73p5m: a coach's "lesson plan" reaches the Lesson Plans tab through every plain text door, end to end |
| `app-redirect-routing.test.js` | bd-onxyu: every door (text handler, menu router, classifier) asks its own app-redirect switch before sending the notice |
| `app-link-leader-lessons-rescue.test.js` | bd-l6424d: a coach whose lesson-plan request was in flight gets one Lesson Plans tab message, never tab plus catalogue |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `app-link-coach-school-card.test.js` | /school card for coaches: who gets the one-message Open button to the coach app, switch and role checks, EMIS or name |
| `app-link-leader-lessons-voice-topic.test.js` | bd-l6424d: a coach who speaks a lesson-plan topic gets the Lesson Plans tab like one who types it |
| `app-link-leader-lesson-plan.test.js` | bd-zcgpkx, bd-a73p5m: a leader's "lesson plan" request opens the app instead of the WhatsApp catalogue Flow |
| `app-link-coach-training.test.js` | bd-s42dye.3: a coach's /training opens the coach app Training Library under its own coach_app_training switch |
| … | 14 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `INTERNAL_API_KEY`

## Never (human)
- Switch lookups fail closed: absent, malformed or failed read means off (tests/app-redirect/app-redirect.service.test.js:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/schools/CLAUDE.md`? · `bot/shared/services/training/CLAUDE.index.md`? · `bot/workers/CLAUDE.index.md`? (+6)
