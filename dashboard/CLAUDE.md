# dashboard — Express server: admin pages, teacher/coach portal API, child-quiz edge
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard kg=8abdfe3e3569 gen=cc19e61ce31c overflow=24 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `index.js` — app wiring: sessions, limits, every router mount, admin pages, portal build serving
- `package.json` — tests: `./run-tests.sh tests/<dir> --maxWorkers=2`; testRegex skips 15 files
- `entrypoint.js` — Railway start: WORKER_MODE=sqs runs the SQS worker, else the server
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 13 sub-dirs, each with `CLAUDE.md` | `data/` · `database/` · `docs/` · `lib/` · `middleware/` · `public/` · `routes/` · `sa/` · `scripts/` · `services/` · `supabase/` · `tests/` · `views/` |
| 5 sub-dirs without a door | `config/` (2) · `jobs/` (1) · `portal-frontend/` (1) · `sa-game/` (2) · `workers/` (1) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `index.js` | Main Express app: sessions, CORS, limits, mounts every router and admin page, serves the portal build; 3.8k lines. |
| … | 11 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `coaching_sessions` (written by `index.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? (+87)
- column `coaching_sessions.analysis_data` (written by `index.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:53:c286009d` (+34)
- table `coaching_sessions` whole row (`*`) (written by `index.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? (+7)
- … 13 more → `CLAUDE.index.md`

## Never (human)
- Never require bot modules that need pino from the portal (`services/telemetry.service.js:8`)
- Never let every cluster worker start the MV scheduler; one owner is marked (`cluster.js:31`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `tests/jest.config.js`? (jest.config.js)

## Related (generated)
- docs: `CLAUDE.md`? · `dashboard/CLAUDE.index.md`? · `dashboard/CLAUDE.md`? · `dashboard/README.md`? · `dashboard/data/CLAUDE.md`? · `dashboard/database/CLAUDE.index.md`? (+33)
- service: `railpack.portal.json` · `railway.toml`
