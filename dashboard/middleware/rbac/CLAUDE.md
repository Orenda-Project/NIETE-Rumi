# rbac — Role, feature-access and DB-context middleware for admin routes

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/middleware/rbac kg=c382a33ce504 gen=738ddbb18275 overflow=0 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `rbac.js` — requireSuperAdmin, requirePartnerAdmin, requireAdmin
- `database-context.js` — per-request RLS client, released on finish
- `USAGE_EXAMPLES.md` — usage examples
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `database-context.js` | Sets the per-request DB client/RLS context and releases it on res finish, avoiding res.send overriding races. |
| `index.js` | Barrel exporting the RBAC middleware (rbac, feature-access, database-context). |
| `feature-access.js` | requireFeatureAccess middleware: checks the user's role against the feature_permissions table. |
| `rbac.js` | Role-based access checks (requireSuperAdmin, requirePartnerAdmin etc.) for dashboard routes. |
| `USAGE_EXAMPLES.md` | Examples of applying the RBAC middleware (roles, feature access, database context) to dashboard routes. |

## Who reads this (generated)
- `index.js` ← imported by `dashboard/index.js:28:102018cb` · `dashboard/routes/settings.js:7:a91be657`
- `database-context.js` ← imported by `dashboard/middleware/rbac/index.js:10:c9a1c0b4`
- `feature-access.js` ← imported by `dashboard/middleware/rbac/index.js:24:30d1a34e`
- `rbac.js` ← imported by `dashboard/middleware/rbac/index.js:18:0a50f85d`

## Never (human)
- Never release the DB context by overriding res.send; cleanup is on res finish (`database-context.js:5`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `tests/portal/bd-5gyspy.9-10-db-client-timeouts.test.js` (database-context.js)
- `tests/portal/bd-sex15q.49-assets-no-db.test.js` (database-context.js)

## Related (generated)
- docs: `bot/shared/services/authz/CLAUDE.md`? · `dashboard/middleware/CLAUDE.md`?
