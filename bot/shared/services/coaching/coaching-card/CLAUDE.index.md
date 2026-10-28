# coaching-card — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/coaching-card -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `card-image.service.js` | Legacy node-canvas 600x400 coaching card PNG renderer plus commitment-card image wrapper |
| `card-response.service.js` | Handles teacher button replies to the coaching card and stores them in coaching_sessions.prioritized_action |
| `card-template.js` | HTML template (en/sw/ur, RTL aware) that Playwright screenshots into the commitment card PNG |
| `commitment-card.service.js` | Uses an LLM to fuse the teacher's reflective commitment with one lesson-rooted action for the commitment card |
| `prioritized-action.service.js` | Extracts indicators from an analysis and picks one focus tip, the weakest askable indicator, for the coaching card |

## Who reads this (all, generated)
- `card-response.service.js` ← imported by `bot/whatsapp-bot.js:854:d77287bc`
- `card-template.js` ← imported by `bot/shared/services/coaching/coaching-card/card-image.service.js:149:c67a4de1`
- `commitment-card.service.js` ← imported by `bot/shared/services/coaching/report-generator.service.js:394:98589872`
- `prioritized-action.service.js` ← imported by `bot/shared/services/coaching/next-step.js:16:c9dacf38` · `bot/shared/services/coaching/coaching-card/commitment-card.service.js:22:e5cd3ca1`
- column `coaching_sessions.prioritized_action` (written by `card-response.service.js`) ← read by `bot/shared/services/coaching/coaching-trend.service.js:138:1f9a2623` · `bot/shared/services/coaching/report-generator.service.js:399:cfc5016d` · `bot/shared/services/coaching/thing-to-try-pick.js:62:33bc352a` · `bot/shared/services/coaching/thing-to-try.js:54:d72963d4` (+3: `python3 kg/kg.py who-reads coaching_sessions.prioritized_action`)
- table `coaching_sessions` whole row (`*`) (written by `card-response.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? (+8: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coaching_sessions` (written by `card-response.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+85: `python3 kg/kg.py who-reads coaching_sessions`)

## Tests (all, generated)
- `card-image.service.js` ← `tests/coaching/coaching-card.test.js` · `tests/coaching/coaching-flow-integration.test.js`
- `card-response.service.js` ← `tests/coaching/bd-v0toag.1.2-move-committed.test.js` · `tests/coaching/card-buttons-routed.test.js` · `tests/coaching/coaching-card.test.js` · `tests/coaching/coaching-flow-integration.test.js` · `tests/coaching/meta-bill-wamid-wiring.test.js` · `tests/meta-bill-cut/fx6-round4.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/coaching/coaching-card/card-response.service.js`)
- `card-template.js` ← `bot/tests/coaching/latin-runs-coaching-print.test.js` · `tests/coaching/coaching-latin-runs.test.js` · `tests/coaching/render-commitment-card-image.test.js`
- `commitment-card.service.js` ← `tests/coaching/angle-ladder-without-reflection.test.js` · `tests/coaching/bd-x3k1q-session-complete-boundary.test.js` · `tests/coaching/card-v2-loop.test.js` · `tests/coaching/commitment-card-content.test.js` · `tests/coaching/commitment-card-fallback.test.js` · `tests/coaching/fidelity-phase-wiring.test.js` (+4: `python3 kg/kg.py who-reads bot/shared/services/coaching/coaching-card/commitment-card.service.js`)
- `prioritized-action.service.js` ← `tests/coaching/bd-v0toag.100.10-no-technology-ask.test.js` · `tests/coaching/coaching-card.test.js` · `tests/coaching/coaching-flow-integration.test.js` · `tests/coaching/fallback-card-skips-non-applicable.test.js` · `tests/coaching/observation-score-bands.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.index.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.md`? · `bot/tests/coaching/CLAUDE.index.md`? · `bot/tests/coaching/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/customization.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/meta-bill-cut/CLAUDE.md`?
