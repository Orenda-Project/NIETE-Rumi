# deployment — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/scripts/deployment -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `DEPLOY_NOW.sh` | Reference shell script that pushes the current branch to trigger a Railway auto-deploy |
| `PUSH_TO_PRODUCTION.sh` | Example template script pushing the current branch to GitHub so Railway auto-deploys; meant to be modified |
| `README.md` | Warns deployment scripts are Taleemabad-WABA reference code with hardcoded IDs that clones must replace |
| `SETUP_AND_TEST.sh` | Installs dependencies and tests AWS SQS plus Railway Redis connectivity for a fresh bot setup |
| `change-pin.js` | Sets a new WhatsApp two-step PIN on the phone number via Graph API (PIN hardcoded at line 9) |
| `check-recent-logs.sh` | Tails Railway bot logs filtered to registration, template and flow events; token must come from env |
| `configure-menu-command.js` | Configures the /menu command in WhatsApp Conversational Components for the phone number |
| `create-carousel-template.js` | Creates the services carousel message template on the WABA via Graph API (hardcoded media IDs) |
| `get-portal-test-tokens.js` | Generates portal invitation tokens for test accounts so a frontend developer can test setup and login |
| `get-waba-id.js` | Looks up the WhatsApp Business Account id from the phone number id via Graph API |
| `link-railway.sh` | Helper that walks through linking the Railway CLI to the main bot project |
| `register-commands-meta.js` | Registers the slash commands shown when users type / in chat via Meta's conversational components API |
| `register-phone-number.js` | Registers the phone number with Meta using the two-step PIN (env WHATSAPP_2FA_PIN, placeholder fallback) |
| `resize-and-upload-sticker.js` | Resizes a sticker image to 512x512 and uploads it to WhatsApp media |
| `send-services-list.js` | Sends an interactive services list as a template-free alternative to the carousel |
| `setup-aws-sqs.sh` | Creates the FIFO coaching queue and its dead-letter queue in AWS SQS via the AWS CLI |
| `update-display-name.js` | Requests a WhatsApp Business display-name change on the phone number via Graph API |
| `update-niete-whatsapp-profile.js` | Updates the NIETE WABA profile picture (PNG) and About text per infrastructure/branding/BRANDING.md |
| `update-whatsapp-profile.js` | Parent profile updater: sets WhatsApp profile picture and About text (Rumi copy, jpeg) via Graph API |
| `upload-carousel-images.js` | Uploads the services-carousel card images to WhatsApp media to obtain media ids |
| `upload-listening-animation.js` | Uploads the 'listening' animated sticker (webp) to WhatsApp media and prints the media id |
| `upload-loading-sticker.js` | Uploads the loading sticker once to WhatsApp for a permanent media id to put in env |
| `upload-menu-image.js` | Uploads the menu image to WhatsApp media for a permanent media id |
| `upload-pedagogical-animation.js` | Uploads the pedagogical-analysis animated sticker (webp) to WhatsApp media and prints the media id |
| `upload-registration-success.js` | Uploads the registration-success animation sticker to WhatsApp and returns its media id |

## Who reads this (all, generated)
- column `users.name` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/calls/call-tools.repo.js:242:774e00e5` · `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/handlers/flow-response.handler.js:543:e1438837` (+59: `python3 kg/kg.py who-reads users.name`)
- column `users.phone_number` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/calls/call-context.repo.js:37:2b4c151c` · `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/routes/homework-request-endpoint.js:51:0b64c13f` · `bot/shared/routes/internal-fln-send.routes.js:45:9c6e16c1` (+87: `python3 kg/kg.py who-reads users.phone_number`)
- column `users.portal_activated` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/services/portal-invite.service.js:203:d17654ef` · `bot/shared/services/quiz/web-quiz-student-join.js:264:4a7f1445` · `dashboard/routes/portal.routes.js:407:af8b00f9`
- column `users.portal_invite_expires_at` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/services/portal-invite.service.js:203:d17654ef` · `dashboard/routes/portal.routes.js:482:74e8e3d0`
- column `users.portal_invite_token` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/services/portal-invite.service.js:204:53285ac9` · `dashboard/routes/portal.routes.js:483:53285ac9`
- column `users.portal_password_hash` (written by `get-portal-test-tokens.js`) ← read by `dashboard/routes/portal.routes.js:407:af8b00f9`
- column `users.preferred_language` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/calls/call-context.repo.js:36:6776a642` · `bot/shared/handlers/flow-response.handler.js:761:6d7fc8d6` · `bot/shared/routes/assessment-gen-endpoint.js:995:578cc074` · `bot/shared/routes/class-manager-endpoint.js:143:aa90cbd2` (+72: `python3 kg/kg.py who-reads users.preferred_language`)
- column `users.registration_completed` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/database/queries.js:106:fef21f32` · `bot/shared/services/app-redirect.service.js:306:ae2bb76a` · `bot/shared/services/feature-registration.service.js:48:8579cb74` · `bot/shared/services/first-touch/teacher-home.data.js:67:67bade35` (+4: `python3 kg/kg.py who-reads users.registration_completed`)
- column `users.registration_state` (written by `get-portal-test-tokens.js`) ← read by `bot/shared/services/app-redirect.service.js:306:ae2bb76a` · `bot/shared/services/first-touch/teacher-home.data.js:67:67bade35` · `bot/shared/services/quiz/web-quiz-student-join.js:264:4a7f1445` · `dashboard/routes/portal.routes.js:680:b547e081`
- table `users` whole row (`*`) (written by `get-portal-test-tokens.js`) ← read by `bot/shared/database/bot-helpers.js:28:2ebcf687` · `bot/shared/database/queries.js:14:77bc023b`? · `dashboard/database/queries.js:687:7a0c163a`? · `dashboard/test-rls-with-supabase-client.js:51:77bc023b`?
- table `users` (written by `get-portal-test-tokens.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? · `bot/shared/calls/call-tools.repo.js:242:774e00e5`? · `bot/shared/database/bot-helpers.js:17:61dfd735`? (+170: `python3 kg/kg.py who-reads users`)
- env `AWS_REGION` read at `bot/scripts/deployment/setup-aws-sqs.sh:12:d3d926e2`
- env `BOT_NAME` read at `bot/scripts/deployment/register-phone-number.js:17:1235cf6f`
- env `GRAPH_API_VERSION` read at `bot/scripts/deployment/configure-menu-command.js:13:ddcada1f` · `bot/scripts/deployment/resize-and-upload-sticker.js:20:ddcada1f` · `bot/scripts/deployment/upload-listening-animation.js:9:ddcada1f` · `bot/scripts/deployment/upload-loading-sticker.js:18:ddcada1f` · `bot/scripts/deployment/upload-menu-image.js:13:ddcada1f` · `bot/scripts/deployment/upload-pedagogical-animation.js:9:ddcada1f` · `bot/scripts/deployment/upload-registration-success.js:14:ddcada1f`
- env `MENU_IMAGE_MEDIA_ID` read at `bot/scripts/deployment/upload-menu-image.js:52:2c45e724`
- env `META_APP_ID` read at `bot/scripts/deployment/update-niete-whatsapp-profile.js:26:f3432018`
- env `PHONE_NUMBER_ID` read at `bot/scripts/deployment/change-pin.js:5:c79e4792` · `bot/scripts/deployment/configure-menu-command.js:11:c79e4792` · `bot/scripts/deployment/create-carousel-template.js:13:c79e4792` · `bot/scripts/deployment/get-waba-id.js:5:c79e4792` · `bot/scripts/deployment/register-commands-meta.js:19:c79e4792` · `bot/scripts/deployment/register-phone-number.js:5:c79e4792` · `bot/scripts/deployment/resize-and-upload-sticker.js:19:c79e4792` · `bot/scripts/deployment/send-services-list.js:13:c79e4792` · `bot/scripts/deployment/update-display-name.js:12:c79e4792` · `bot/scripts/deployment/update-niete-whatsapp-profile.js:22:c79e4792` · `bot/scripts/deployment/update-whatsapp-profile.js:8:c79e4792` · `bot/scripts/deployment/upload-carousel-images.js:15:c79e4792` · `bot/scripts/deployment/upload-listening-animation.js:8:c79e4792` · `bot/scripts/deployment/upload-loading-sticker.js:17:c79e4792` · `bot/scripts/deployment/upload-menu-image.js:12:35f02dca` · `bot/scripts/deployment/upload-pedagogical-animation.js:8:c79e4792` · `bot/scripts/deployment/upload-registration-success.js:13:c79e4792`
- env `PORTAL_URL` read at `bot/scripts/deployment/get-portal-test-tokens.js:97:2e403234`
- env `RAILWAY_SERVICE` read at `bot/scripts/deployment/check-recent-logs.sh:9:1597e566`
- env `RAILWAY_TOKEN` read at `bot/scripts/deployment/check-recent-logs.sh:8:d9dea95f`
- env `REDIS_URL` read at `bot/scripts/deployment/SETUP_AND_TEST.sh:47:9d583e6e`
- env `SUPPORT_EMAIL` read at `bot/scripts/deployment/update-whatsapp-profile.js:102:0e9719ac`
- env `TEST_PHONE_NUMBER` read at `bot/scripts/deployment/send-services-list.js:14:ce427c5e`
- env `WABA_ID` read at `bot/scripts/deployment/create-carousel-template.js:12:601afc5a` · `bot/scripts/deployment/update-niete-whatsapp-profile.js:23:601afc5a` · `bot/scripts/deployment/update-whatsapp-profile.js:9:a4122f6a`
- env `WHATSAPP_2FA_PIN` read at `bot/scripts/deployment/register-phone-number.js:11:5f630fa0`
- env `WHATSAPP_DISPLAY_NAME` read at `bot/scripts/deployment/update-display-name.js:16:da6eb135`
- env `WHATSAPP_TOKEN` read at `bot/scripts/deployment/change-pin.js:4:60bafac2` · `bot/scripts/deployment/configure-menu-command.js:12:60bafac2` · `bot/scripts/deployment/create-carousel-template.js:11:60bafac2` · `bot/scripts/deployment/get-waba-id.js:4:60bafac2` · `bot/scripts/deployment/register-commands-meta.js:20:babb0b93` · `bot/scripts/deployment/register-phone-number.js:4:60bafac2` · `bot/scripts/deployment/resize-and-upload-sticker.js:18:60bafac2` · `bot/scripts/deployment/send-services-list.js:12:60bafac2` · `bot/scripts/deployment/update-display-name.js:11:60bafac2` · `bot/scripts/deployment/update-niete-whatsapp-profile.js:21:60bafac2` · `bot/scripts/deployment/update-whatsapp-profile.js:7:60bafac2` · `bot/scripts/deployment/upload-carousel-images.js:14:60bafac2` · `bot/scripts/deployment/upload-listening-animation.js:7:60bafac2` · `bot/scripts/deployment/upload-loading-sticker.js:16:60bafac2` · `bot/scripts/deployment/upload-menu-image.js:12:35f02dca` · `bot/scripts/deployment/upload-pedagogical-animation.js:7:60bafac2` · `bot/scripts/deployment/upload-registration-success.js:12:60bafac2`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `SETUP.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/deployment/README.md`?
