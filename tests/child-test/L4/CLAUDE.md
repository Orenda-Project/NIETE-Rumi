# L4 — Coach conversation handler: gate, /egra routing, offers, media claim, strings
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L4 kg=a5db2fd46338 gen=12ed37da4424 overflow=4 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `conversation.test.js` — /egra to check, with lane fakes
- `gate.test.js` — CHILD_TEST_ENABLED, coach role, ICT region
- `webhook-routing.test.js` — ctst_ ids reach the child test
- Run from repo root: `node tests/run.js tests/child-test/L4 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `helpers/` | → (no door; 2 test files) |
| `media-claim.test.js` | Pins that the real voice and image handlers hand child-test notes and strip photos over before other routers take them |
| `observe2-offer.test.js` | Pins the child-test offer after /observe2's check and debrief question, carrying the form id, when gated on (bd-s1oo0.4) |
| `CLAUDE.index.md` | (unmapped) |
| `text-dispatch.test.js` | Tests /egra through the real handleTextMessage dispatch into the child-test handler; flag off falls through unchanged |
| `conversation.test.js` | End-to-end coach conversation via L4 handler: /egra, list, Present, three voice notes, strip photo, check (bd-s1oo0.4) |
| `CLAUDE.md` | (unmapped) |
| `integration-l3.test.js` | Coach conversation against L3's real draw and store on in-memory Supabase; skipped if modules absent (bd-s1oo0.3) |
| `gate.test.js` | Tests the child-test gate: CHILD_TEST_ENABLED plus coach role plus ICT region, inert otherwise |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `OPENROUTER_API_KEY` · `RAILWAY_ENVIRONMENT`

## Never (human)
- webhook-routing asserts on source text, never boots whatsapp-bot.js (tests/child-test/L4/webhook-routing.test.js:4)
- integration-l3 is describe.skip when L3 modules are absent (tests/child-test/L4/integration-l3.test.js:32)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/child-test/conversation/CLAUDE.index.md`? · `bot/shared/services/child-test/draw/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? (+6)
