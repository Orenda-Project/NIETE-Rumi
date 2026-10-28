# views — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/views -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
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
| `byof-admin.ejs` | BYOF approver admin view (rendered by byof.routes.js) for reviewing sessions and plans. |
| `byof-new.ejs` | BYOF new-session page to start a bug report or feature plan chat. |
| `byof-session.ejs` | BYOF chat session page where the Forge agent converses and shows the plan. |
| `byof.ejs` | BYOF home listing the user's bug/feature sessions (/observability/byof). |
| `change-password.ejs` | Change-password form for dashboard users (rendered by routes/settings.js). |
| `coaching.ejs` | Coaching sessions list with status and date filters (/observability/coaching). |
| `conversations-backup.ejs` | Unreferenced backup of the original conversations view; no code renders it (named in MEDIA_FEATURES_README). |
| `conversations-enhanced.ejs` | Unreferenced conversation viewer with media playback; no route renders it (index.js serves conversations as JSON). |
| `conversations.ejs` | Unreferenced conversation viewer template, near-identical to conversations-enhanced.ejs; no res.render uses it. |
| `dashboard.ejs` | Main observability dashboard (/observability/dashboard): KPI stats and charts from the materialized views. |
| `error.ejs` | Generic error page rendered by index.js handlers and the final error handler. |
| `forgot-password.ejs` | Forgot-password form for dashboard users (/observability/forgot-password). |
| `funnel.ejs` | Website-to-registration funnel analysis page (/observability/funnel). |
| `invite-user.ejs` | Super-admin invite-user form (rendered by routes/settings.js at /observability/settings/invite). |
| `juice-demo.html` | Standalone demo page of Jugnu sounds served at /wq/juice-demo.html by web-quiz.routes.js; no EJS. |
| `layout.ejs` | Unused EJS layout shell (title + body); no layouts middleware is installed or referenced in dashboard code. |
| `loading-transcript.ejs` | Progress page shown while a transcript is processed (polls transcript-status) before redirecting to the transcript. |
| `login.ejs` | Dashboard login page (/observability/login) with the NIETE brand and release-notes feed. |
| `release-notes.ejs` | Public changelog page "What's New" (/observability/release-notes) from the release_notes table. |
| `reset-password.ejs` | Reset-password form using an emailed code (/observability/reset-password). |
| `retention.ejs` | Cohort retention analysis page (/observability/retention). |
| `schema.ejs` | Database schema browser page (/observability/schema) listing tables and columns. |
| `sessions.ejs` | Session Analytics page (/observability/sessions) with conversation-session stats. |
| `settings.ejs` | Super-admin settings page (/observability/settings): user list, invite, role change, deactivate. |
| `setup-password.ejs` | Invitation acceptance page where an invited user sets username and password (/observability/setup-password). |
| `transcript-enhanced.ejs` | Coaching session transcript viewer (/observability/proxy/transcript/:sessionId) with SLO and climate panels; 2.7k lines. |
| `transcript.ejs` | Unreferenced plain transcript template; index.js renders transcript-enhanced instead. |
| `users.ejs` | Users list page (/observability/users) with search and activity sorting, backed by /api/users and conversations API. |
| `video-detail.ejs` | Single video request detail page (/observability/videos/:id) with pipeline steps and media. |
| `videos.ejs` | Video request gallery (/observability/videos) with filters and pagination. |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- `funnel.ejs` ← `scripts/app-funnel/test_funnel.py`?
- `transcript.ejs` ← `portal/src/portal/lib/transcript.test.ts`?

## Related (all, generated)
- docs: `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/views/CLAUDE.index.md`? · `dashboard/views/CLAUDE.md`? · `dashboard/views/partials/CLAUDE.md`? · `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/portal/lib/CLAUDE.md`? · `scripts/app-funnel/CLAUDE.md`?
