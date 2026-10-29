# authz — Capability gate: may this user do X, answered from feature_permissions data

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/authz kg=b165e50a40d8 gen=85102a652162 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `capability.js` — the one capability question for users-table roles (bd-2531)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `capability.js` | Capability gate answering 'may this user do X' from feature_permissions data (bd-2531) |

## Who reads this (generated)
- `capability.js` ← imported by `bot/shared/handlers/remark-command.handler.js:26:3869d9be` · `bot/shared/services/remark/remark-gate.js:19:7dd75014`

## Never (human)
- Gate from data, not route conditionals (`bot/shared/services/authz/capability.js:5`); the portal's `dashboard/middleware/rbac/feature-access.js:71` reads the same table
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/services/capability.test.js` (capability.js)
- `bot/tests/services/remark-gate.test.js` (capability.js)
- `bot/tests/services/remark-wiring.test.js` (capability.js)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`?
