# setup — Register WhatsApp Flows, templates and encryption with Meta; doctor preflight
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/setup kg=9ca69d49956d gen=ca884f995d23 overflow=28 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `flow-configs.js` — the single list of Flows to register
- `register-one-flow.js` — add one Flow to a live account
- `doctor.js` — preflight checks
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assets/` | → (no door; 1 files) |
| `CLAUDE.index.md` | (unmapped) |
| `flow-configs.js` | Single source of truth listing which WhatsApp Flows a deployment registers; used by register and validate scripts |
| `meta-api.js` | Graph API client wrapping flow and template registration calls with a normalized success/error envelope |
| `setup-state.js` | SetupState class managing .setup-state.json for flow, template and encryption registration status |
| `CLAUDE.md` | (unmapped) |
| … | 7 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `meta-api.js` ← imported by `bot/scripts/setup/create-child-test-review-flow-draft.js:46:178f6770` · `bot/scripts/setup/register-all-flows.js:20:178f6770` (+6)
- `flow-configs.js` ← imported by `bot/scripts/setup/doctor.js:28:e92fd19a` · `bot/scripts/setup/register-all-flows.js:29:e92fd19a` (+3)
- `setup-state.js` ← imported by `bot/scripts/setup/register-all-flows.js:21:1a71048c` · `bot/scripts/setup/register-all-templates.js:22:1a71048c` (+2)
- … 7 more → `CLAUDE.index.md`

## Never (human)
- Flow list lives only in flow-configs.js (flow-configs.js:2); add entries there, not in the registrars
- Child-test Flows register on sandbox only (register-child-test-check-flow.js:3)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/setup/register-all-flows.test.js` (meta-api.js, register-all-flows.js, setup-state.js)
- `tests/setup/validate-flows.test.js` (meta-api.js, setup-state.js, validate-flows.js)
- … 14 more → `CLAUDE.index.md`

## Related (generated)
- skills: `whatsapp-flows`?
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/setup/CLAUDE.index.md`? · `bot/scripts/setup/CLAUDE.md`? · `bot/scripts/templates/CLAUDE.md`? · `bot/scripts/templates/README.md`? (+14)
