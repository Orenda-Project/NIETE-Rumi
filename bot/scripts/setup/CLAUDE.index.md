# setup — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/scripts/setup -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `assets/` | → (no door; 1 files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `create-child-test-review-flow-draft.js` | Creates or refreshes the child-test review Flow as a DRAFT on the NIETE sandbox WABA and prints validation errors; neve… |
| `doctor.js` | npm run doctor preflight: checks required and optional env vars statically, then live Meta checks |
| `flow-configs.js` | Single source of truth listing which WhatsApp Flows a deployment registers; used by register and validate scripts |
| `meta-api.js` | Graph API client wrapping flow and template registration calls with a normalized success/error envelope |
| `register-all-flows.js` | Registers every Flow in flow-configs.js with Meta on a blank account; skips ones that already exist |
| `register-all-templates.js` | Idempotently registers the video_style_selection and feature_menu_carousel_v3 templates with Meta |
| `register-child-test-check-flow.js` | Registers the child-test check Flow on the NIETE sandbox WABA only, refusing unless env file and live account say sandb… |
| `register-one-flow.js` | Creates and publishes ONE Flow on an account that already has others, which register-all-flows cannot do |
| `republish-flow.js` | Re-publishes one existing Flow from its JSON on disk, since register-all-flows skips existing flows |
| `run-full-setup.js` | Orchestrates encryption, all Flows and templates registration in order, idempotently |
| `setup-encryption.js` | Generates RSA-2048 keypair, registers the public key with Meta and records it in the setup state file; idempotent |
| `setup-state.js` | SetupState class managing .setup-state.json for flow, template and encryption registration status |
| `validate-flows.js` | Preflight verifying flows and templates exist and are PUBLISHED via the state file and optional Graph API checks |

## Who reads this (all, generated)
- `flow-configs.js` ← imported by `bot/scripts/setup/doctor.js:28:e92fd19a` · `bot/scripts/setup/register-all-flows.js:29:e92fd19a` · `bot/scripts/setup/register-one-flow.js:51:e92fd19a` · `bot/scripts/setup/setup-state.js:15:e7a2a00f` (+1: `python3 kg/kg.py who-reads flow-configs.js`)
- `meta-api.js` ← imported by `bot/scripts/setup/create-child-test-review-flow-draft.js:46:178f6770` · `bot/scripts/setup/register-all-flows.js:20:178f6770` · `bot/scripts/setup/register-all-templates.js:21:178f6770` · `bot/scripts/setup/register-child-test-check-flow.js:67:178f6770` (+4: `python3 kg/kg.py who-reads meta-api.js`)
- `register-all-flows.js` ← imported by `bot/scripts/setup/run-full-setup.js:40:1e563a97`
- `register-all-templates.js` ← imported by `bot/scripts/setup/run-full-setup.js:41:34c766d9`
- `register-child-test-check-flow.js` ← imported by `bot/scripts/setup/create-child-test-review-flow-draft.js:18:57498956`
- `register-one-flow.js` ← imported by `bot/scripts/setup/create-child-test-review-flow-draft.js:45:e2a3a310` · `bot/scripts/setup/register-child-test-check-flow.js:66:e2a3a310`
- `setup-encryption.js` ← imported by `bot/scripts/setup/run-full-setup.js:39:c07ebf10`
- `setup-state.js` ← imported by `bot/scripts/setup/register-all-flows.js:21:1a71048c` · `bot/scripts/setup/register-all-templates.js:22:1a71048c` · `bot/scripts/setup/setup-encryption.js:19:1a71048c` · `bot/scripts/setup/validate-flows.js:12:1a71048c`
- `validate-flows.js` ← imported by `bot/scripts/setup/run-full-setup.js:42:f485f730`
- env `ASSETS_BASE_URL` read at `bot/scripts/setup/register-all-templates.js:298:ba3455dc`
- env `ASSET_BASE_URL` read at `bot/scripts/setup/register-all-templates.js:298:ba3455dc`
- env `PHONE_NUMBER_ID` read at `bot/scripts/setup/republish-flow.js:135:f04bf405`
- env `REGISTRATION_FLOW_ID` read at `bot/scripts/setup/republish-flow.js:71:9307b2e7`
- env `WABA_ID` read at `bot/scripts/setup/republish-flow.js:81:74196b19`
- env `WHATSAPP_TOKEN` read at `bot/scripts/setup/republish-flow.js:80:250e68a3`

## Tests (all, generated)
- `create-child-test-review-flow-draft.js` ← `tests/child-test/L28/review-flow-draft.test.js`
- `doctor.js` ← `tests/setup/doctor.test.js`
- `flow-configs.js` ← `tests/quiz/quiz-flow-endpoint.test.js` · `tests/registration/bd-x7aprz9-finish-closes-flow.test.js` · `tests/setup/flow-config-conformance.test.js` · `tests/setup/flow-key-consistency.test.js` · `tests/setup/setup-state.test.js` · `tests/training/quiz-multi-select-flow.test.js`
- `meta-api.js` ← `tests/setup/meta-api.test.js` · `tests/setup/register-all-flows.test.js` · `tests/setup/validate-flows.test.js`
- `register-all-flows.js` ← `tests/setup/flow-configs-paths.test.js` · `tests/setup/register-all-flows.test.js`
- `register-all-templates.js` ← `tests/setup/register-all-templates.test.js`
- `register-child-test-check-flow.js` ← `tests/child-test/L6/send-and-complete.test.js`
- `register-one-flow.js` ← `tests/setup/register-one-flow.test.js`
- `setup-encryption.js` ← `tests/setup/setup-encryption.test.js`?
- `setup-state.js` ← `tests/setup/flow-key-consistency.test.js` · `tests/setup/register-all-flows.test.js` · `tests/setup/setup-state.test.js` · `tests/setup/validate-flows.test.js`
- `validate-flows.js` ← `tests/setup/validate-flows.test.js`

## Related (all, generated)
- skills: `whatsapp-flows`?
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/setup/CLAUDE.index.md`? · `bot/scripts/setup/CLAUDE.md`? · `bot/scripts/templates/CLAUDE.md`? · `bot/scripts/templates/README.md`? · `docs/CLAUDE.index.md`? · `docs/e2e-mock-lane.md`? · `docs/templates/roster-change-notification.md`? · `tests/child-test/L28/CLAUDE.md`? · `tests/child-test/L6/CLAUDE.index.md`? · `tests/child-test/L6/CLAUDE.md`? · `tests/quiz/CLAUDE.index.md`? · `tests/quiz/CLAUDE.md`? · `tests/registration/CLAUDE.index.md`? · `tests/registration/CLAUDE.md`? · `tests/setup/CLAUDE.index.md`? · `tests/setup/CLAUDE.md`? · `tests/training/CLAUDE.index.md`? · `tests/training/CLAUDE.md`?
