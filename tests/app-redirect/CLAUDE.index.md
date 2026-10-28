# app-redirect — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/app-redirect -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `app-link-coach-school-card-door.test.js` | The /school card door in the real text handler: a coach on the switch gets one cta_url; everyone else is unchanged |
| `app-link-coach-school-card.test.js` | /school card for coaches: who gets the one-message Open button to the coach app, switch and role checks, EMIS or name |
| `app-link-coach-training.test.js` | bd-s42dye.3: a coach's /training opens the coach app Training Library under its own coach_app_training switch |
| `app-link-coach.test.js` | bd-fmf24g.52: a coach's /menu and /observe send one cta_url that opens the coach app signed in, when switches hold |
| `app-link-copy.test.js` | bd-fmf24g.42: each linkable command's app-link line and button are short, per-command, bilingual, no "signed in" talk |
| `app-link-every-teacher.test.js` | bd-fmf24g.46: app_redirect_<feature>="teachers" sends every registered teacher on the teacher app the link |
| `app-link-leader-lesson-plan.test.js` | bd-zcgpkx, bd-a73p5m: a leader's "lesson plan" request opens the app instead of the WhatsApp catalogue Flow |
| `app-link-leader-lessons-doors.test.js` | bd-a73p5m: a coach's "lesson plan" reaches the Lesson Plans tab through every plain text door, end to end |
| `app-link-leader-lessons-rescue.test.js` | bd-l6424d: a coach whose lesson-plan request was in flight gets one Lesson Plans tab message, never tab plus catalogue |
| `app-link-leader-lessons-voice-topic.test.js` | bd-l6424d: a coach who speaks a lesson-plan topic gets the Lesson Plans tab like one who types it |
| `app-link-pilot.test.js` | bd-fmf24g.35: app_redirect_<feature> as a JSON list of users.id sends pilot teachers one cta_url login link |
| `app-link-report-prefill.test.js` | bd-pw1ccr.2: the A/B report button's grade/subject/chapter prefill rides encrypted inside the /go token |
| `app-login-coach-school.test.js` | coach-school-target.js: coach_school:<EMIS> and coach_schools landing targets and their token round trip |
| `app-login-coach.test.js` | bd-fmf24g.52: coach tokens (menu, observe, training) sign the coach in and land on the right coach app page |
| `app-login-link.test.js` | bd-fmf24g.35: one-tap login token is AES-GCM encrypted, hides the user id, lasts 24 h and is re-tappable |
| `app-login-new-link.test.js` | bd-x7aprz.3: the /go dead-link page offers a wa.me button typing /portal for a fresh link, never another bot's number |
| `app-login-route.test.js` | bd-fmf24g.35: GET /go/:token signs into the full teacher app, 303s to the feature, shows a new-link page when expired |
| `app-redirect-routing.test.js` | bd-onxyu: every door (text handler, menu router, classifier) asks its own app-redirect switch before sending the notice |
| `app-redirect.service.test.js` | bd-onxyu: app_redirect_<feature> switch registry, fail-closed lookups, and the bot-to-app notice contract |
| `bd-c5reix-app-link-on-link.test.js` | bd-c5reix: redirectIfFlagged's onLink hook runs only on the link branch, before the send, with optional landing and copy |
| `bd-c5reix.1-saved-link-copy.test.js` | bd-c5reix.1: the "recording saved, tap Digital Coaching" line and button text exist exactly in English and Urdu |

## Who reads this (all, generated)
- env `INTERNAL_API_KEY` read at `tests/app-redirect/app-login-coach-school.test.js:35:f9a6d27d` · `tests/app-redirect/app-login-coach.test.js:36:f9a6d27d` · `tests/app-redirect/app-login-link.test.js:149:b1c2450a`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/schools/CLAUDE.md`? · `bot/shared/services/training/CLAUDE.index.md`? · `bot/workers/CLAUDE.index.md`? · `dashboard/lib/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/app-redirect/CLAUDE.index.md`? · `tests/app-redirect/CLAUDE.md`?
