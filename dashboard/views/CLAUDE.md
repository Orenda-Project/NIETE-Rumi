# views — EJS pages for the observability admin portal plus one static demo HTML
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/views kg=d4aaee62669a gen=6995d8c7893e overflow=25 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `partials/navigation.ejs` — nav shared by admin pages
- `dashboard.ejs` — main stats page
- `transcript-enhanced.ejs` — the live transcript view
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `partials/` | EJS pieces included by the dashboard's admin pages: top navigation bar and login release feed → `partials/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `ab-testing.ejs` | Observability A/B testing page (/observability/ab-testing) with Chart.js group results. |
| `admin-invitations.ejs` | Super-admin page listing and managing partner invitations (/observability/admin/invitations). |
| `admin-users.ejs` | Super-admin user management page (/observability/admin/users): roles, access scopes, deactivation. |
| `ama-chats.ejs` | Admin view of AMA conversations and their messages (/observability/ama-chats). |
| `ama.ejs` | Ask-Me-Anything chat UI (/observability/ama) for natural-language data questions; 1.5k lines. |
| `api-health.ejs` | API-health page (/observability/api-health) showing each vendor service's usage and status cards. |
| `attendance-mark.ejs` | Standalone Teacher Attendance marking page (/observability/attendance-mark) calling the portal attendance API. |
| `broadcast-history.ejs` | Past WhatsApp broadcasts and delivery stats (/observability/broadcast/history), admin only. |
| `broadcast.ejs` | Compose and send a WhatsApp broadcast with filters and template approval (/observability/broadcast), admin only. |
| … | 25 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/lib/transcript.test.ts`? (transcript.ejs)
- `scripts/app-funnel/test_funnel.py`? (funnel.ejs)

## Related (generated)
- docs: `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/views/CLAUDE.index.md`? · `dashboard/views/CLAUDE.md`? · `dashboard/views/partials/CLAUDE.md`? · `portal/src/portal/lib/CLAUDE.index.md`? (+2)
