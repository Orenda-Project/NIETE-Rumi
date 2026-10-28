# lp-coaching — Lesson-plan step of a coaching session: list, link, upload, paste
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/coaching/lp-coaching kg=a7be68585c45 gen=5c2e60e58c3b overflow=36 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `lp-step.service.js` — shared landing on the lesson-plan step
- `lp-selection-list.service.js` — builds the LP picker list
- `send-lp-prompt.js` — routes list vs buttons payloads
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `recent-fidelity-lps.service.js` | Recent-LP source for the selection list from niete_lp_downloads plus catalog, incl. app-read plans (bd-wmfsp.5) |
| `CLAUDE.index.md` | (unmapped) |
| `lp*` | 8 files; most used `lp-step.service.js`: Single shared "land on the lesson-plan step" for every finish-photos path, plus LP re-prompt (bd-5azz0) |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `lp-coaching-linker.service.js` (+1)) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+88)
- column `coaching_sessions.status` (written by `lp-step.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` (+41)
- … 14 more → `CLAUDE.index.md`

## Never (human)
- A WhatsApp list holds at most 10 rows total; over it the list is refused, so cap LPs at 8 (lp-selection-list.service.js:20-22, bd-zrlcp)
- List payloads go to sendInteractiveMessage, never buttons (send-lp-prompt.js, bd-lqpog)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/coaching-flow-integration.test.js` (lp-coaching-linker.service.js, lp-framework-prompt.service.js, lp-selection-list.service.js)
- `tests/coaching/lp-coaching-link.test.js` (lp-coaching-linker.service.js, lp-framework-prompt.service.js, lp-selection-list.service.js)
- … 20 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.md`? · `bot/tests/observe/CLAUDE.index.md`? · `tests/coaching/CLAUDE.index.md`? (+6)
