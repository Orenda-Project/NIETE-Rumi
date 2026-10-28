# routes — Tests the bot's internal HTTP API (portal-to-bot), FLN sends and /go links
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/routes kg=938e5c7f54ab gen=1644468cb13e overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `internal-training-api.test.js` — the training decision API the portal delegates to (bd-2479)
- `_http-post.js` — helper: real-HTTP post, since axios is stubbed in the root suite
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/routes --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `internal*` | 8 files; most used `internal-fln-send.test.js`: PR-E: POST /api/internal/fln/send over real Express and HTTP: per-teacher sends, 401 without key, event rows |
| `fln*` | 3 files; most used `fln-send.service.test.js`: PR-E: sendPlanToTeachers sends per-recipient /go tokens, cta_url in-window or template outside, one event each |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `app-login-fln.test.js` | PR-E: a teacher's own /go token with target fln:<id> verifies and 303s to the FLN plan page, tampering refused |
| `bd-o15qnr.17-portal-booking-announce.test.js` | bd-o15qnr.17: a portal visit book/move/cancel sends the same coach invite and teacher notice as WhatsApp /observe |
| `_http-post.js` | Test helper: axios.post-shaped call over real HTTP resolving {status, data}, for route tests where axios is stubbed |
| `pakistan-lp-endpoint.test.js` | Pins the Pakistan LP Flow endpoint (FEAT-059/109): INIT grades and subject, chapter, topic dropdown rows |

## Who reads this (generated)
- (none)

## Never (human)
- Every internal route is key-authed and refuses all callers when INTERNAL_API_KEY is unset (internal-training-api.test.js:31)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/routes/CLAUDE.index.md`? · `tests/routes/CLAUDE.md`?
