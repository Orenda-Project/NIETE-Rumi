# deployment — Reference Meta Graph API scripts from the original Taleemabad WABA; ids are WABA-bound
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/deployment kg=33271c31d2c0 gen=c9add22a7085 overflow=21 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `README.md` — what is reusable and what is hardcoded
- `update-niete-whatsapp-profile.js` — NIETE profile picture and About
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `create-carousel-template.js` | Creates the services carousel message template on the WABA via Graph API (hardcoded media IDs) |
| `register-phone-number.js` | Registers the phone number with Meta using the two-step PIN (env WHATSAPP_2FA_PIN, placeholder fallback) |
| `upload*` | 6 files; most used `upload-menu-image.js`: Uploads the menu image to WhatsApp media for a permanent media id |
| `DEPLOY_NOW.sh` | Reference shell script that pushes the current branch to trigger a Railway auto-deploy |
| `README.md` | Warns deployment scripts are Taleemabad-WABA reference code with hardcoded IDs that clones must replace |
| … | 20 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `get-portal-test-tokens.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+170)
- column `users.phone_number` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/database/queries.js:106:fef21f32` (+88)
- column `users.preferred_language` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/handlers/flow-response.handler.js:761:6d7fc8d6` (+73)
- column `users.name` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` (+61)
- … 23 more → `CLAUDE.index.md`

## Never (human)
- Do not reuse hardcoded media or phone ids on another WABA (README.md:7)
- Tokens come from env, never hardcode (check-recent-logs.sh:4)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `SETUP.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/deployment/README.md`?
