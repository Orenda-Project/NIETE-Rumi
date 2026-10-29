# partials — EJS pieces included by the dashboard's admin pages: top navigation bar and login release feed

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/views/partials kg=cab69247a327 gen=a6a1ae981a12 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `navigation.ejs` — the NIETE-styled top bar every admin view includes with currentPage/username/userRole (bd-2458)
- `release-feed.ejs` — floating release-notes feed on the login page; expects a releaseNotes array
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `navigation.ejs` | Shared navigation bar included by observability pages, role-aware via currentPage and userRole. |
| `release-feed.ejs` | Floating release-notes feed component included on the login page. |

## Who reads this (generated)
- (none)

## Never (human)
- navigation.ejs decides admin links from isAdmin or userRole admin/super_admin (navigation.ejs:3-6); 24 views include it, so keep its locals contract
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/views/CLAUDE.md`?
