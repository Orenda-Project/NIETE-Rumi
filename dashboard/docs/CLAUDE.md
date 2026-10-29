# docs — Operator notes for the dashboard: DNS runbook, partner RBAC, API health, media

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/docs kg=aa57e80f19bb gen=2c8e0e148224 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `PARTNER_RBAC_STATUS.md` — what the partner RBAC feature includes
- `DNS_CHANGE_RUNBOOK.md` — steps when a Railway custom domain changes
- `api/Teacher_Portal_API.postman_collection.json` — portal auth API collection
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `api-health/` | → (no door; 2 files) |
| `api/` | → (no door; 1 files) |
| `PARTNER_RBAC_STATUS.md` | Phase-by-phase status of the Partner RBAC feature: DB schema, backend foundation and what is complete. |
| `DNS_CHANGE_RUNBOOK.md` | Runbook for updating GoDaddy DNS CNAME when a Railway custom domain for the portal is removed/re-added (Jan 2026). |
| `MEDIA_FEATURES_README.md` | Notes on dashboard media features: voice-note playback, PDF viewer, coaching audio, lesson-plan viewing (Nov 2025). |
| `PARTNER_RBAC_RELEASE_NOTES.md` | Release notes for Partner RBAC v1.0 (Jan 13 2026 prod deploy) aimed at super admins managing partner access. |

## Who reads this (generated)
- (none)

## Never (human)
- Never remove and re-add a Railway custom domain without recording the new CNAME (`DNS_CHANGE_RUNBOOK.md:13`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/CLAUDE.md`? · `dashboard/docs/PARTNER_RBAC_RELEASE_NOTES.md`? · `dashboard/docs/PARTNER_RBAC_STATUS.md`?
