# dashboard — Legacy Express admin dashboard: login, users, conversations, stats

<!-- kg:meta repo=NIETE-Rumi dir=bot/dashboard kg=a72d2553a390 gen=425e0920abb7 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `index.js` — server, session login, routes
- `views` — EJS pages it renders
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `views/` | EJS pages of the admin dashboard (Tailwind via CDN) → `views/CLAUDE.md` |
| `index.js` | Express admin dashboard (session login, bcrypt, rate limit) listing users, conversations and activity stats |

## Who reads this (generated)
- env read here: `ADMIN_PASSWORD_HASH` · `ADMIN_USERNAME` · `DASHBOARD_PORT` · `NODE_ENV` · `SESSION_SECRET`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.md`?
- service: `dashboard`
