# routes — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/routes -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `_http-post.js` | Test helper: axios.post-shaped call over real HTTP resolving {status, data}, for route tests where axios is stubbed |
| `app-login-fln.test.js` | PR-E: a teacher's own /go token with target fln:<id> verifies and 303s to the FLN plan page, tampering refused |
| `bd-o15qnr.17-portal-booking-announce.test.js` | bd-o15qnr.17: a portal visit book/move/cancel sends the same coach invite and teacher notice as WhatsApp /observe |
| `fln-go-target.test.js` | PR-E: pins the pure fln-go-target module: fln:<1-9 digits> is a /go target landing on the plan page |
| `fln-keys.test.js` | PR-E: pins fln-keys teacherKey (per-environment 16-hex) and userKey (the HMAC userKeyOf formula) |
| `fln-send.service.test.js` | PR-E: sendPlanToTeachers sends per-recipient /go tokens, cta_url in-window or template outside, one event each |
| `internal-certificates-api.test.js` | Pins the bot-owned internal certificates API the portal calls over HTTP (shared-key auth, list, issue) |
| `internal-fln-send.test.js` | PR-E: POST /api/internal/fln/send over real Express and HTTP: per-teacher sends, 401 without key, event rows |
| `internal-lp-describe.test.js` | bd-5rz1v.15: POST /api/internal/lp/describe names K-5 catalogue and 6-12 plans for the portal's recent-plan lists |
| `internal-observe-notify-teacher.test.js` | bd-xorfy: POST /api/internal/observe/notify-teacher re-reads the stored visit, ignoring any teacher or phone in the body |
| `internal-observe-school-admin.test.js` | Pins the internal observe school-search and school-admin routes: coach app saves only through the /observe writers |
| `internal-observe-teacher-admin.test.js` | bd-o15qnr.11: internal observe teacher-move and edits use the /observe writers; a school the coach lacks gets 403 |
| `internal-queue-lesson-plan.test.js` | bd-2461: POST /api/internal/queue-lesson-plan exposes the LP enqueue to the portal behind the shared API key |
| `internal-training-api.test.js` | bd-2479: the bot's internal training decision API (shared-key auth) that the portal delegates to rather than re-derive |
| `pakistan-lp-endpoint.test.js` | Pins the Pakistan LP Flow endpoint (FEAT-059/109): INIT grades and subject, chapter, topic dropdown rows |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `tests/CLAUDE.md`?
