# Run the teacher + coach portal on your laptop

One command gives you the NIETE portal at `http://localhost:4000`, running on a local database holding a copy of
the **sandbox's** data, plus a few made-up accounts with a known password. Nothing writes to WhatsApp, the sandbox
or production — the sandbox is only read, once, to fill your local copy.

## Once per machine

```bash
brew install postgresql@17 pgvector postgrest redis node      # macOS (Linux: bash bot/scripts/e2e/local-db.sh install-tools)
gh auth login                                                 # needs read access to Orenda-Project/niete-e2e-fixtures
railway login                                                 # needs access to the "NIETE-Rumi Staging" project (the sandbox)
bash bot/scripts/e2e/local-db.sh doctor                       # prints anything still missing; silent when ready
```

No keys file and no `npm ci` by hand: the stack installs the bot's modules from the commit's own lockfile, and
`up` installs `dashboard/` and `portal/` the first time.

## Every time

```bash
bash scripts/dev-portal.sh up        # first time ~40 min (copies the sandbox); after that ~1 min, from the cache
bash scripts/dev-portal.sh status
bash scripts/dev-portal.sh down      # stops everything and drops the database
```

`up` prints the URL and the logins. **Every sandbox account works with its sandbox password.** The made-up
accounts below are added on top so there is always a login you know — password **`Demo2026`**:

| Who | Phone | What you'll see |
|---|---|---|
| Coach | `03000000901` | 3 schools, 10 teachers, today's visits, reports waiting to review |
| Principal | `03000000902` | her school's 4 staff and their activity |
| Teachers | `03000000911` – `03000000919` | a class of 8 students, attendance, lesson plans, 3 scored coaching reports, training progress |

## What it runs

| Piece | Port | From |
|---|---|---|
| Portal API + built portal SPA | 4000 (`PORTAL_PORT`) | your working tree's `dashboard/` |
| Bot (lesson plans, classes, assessment, training, certificates) | 3100 | the committed `HEAD`, via `bot/scripts/e2e/local-stack.sh` |
| Mock WhatsApp API, worker, Redis, file store | 4010, 3201, 6390, 54600 | the same stack |
| Postgres 17 + PostgREST | 54329, 54321 | `bot/scripts/e2e/local-db.sh` — a fresh database per `up` |

**The data.** `local-db.sh sandbox-copy` reads every sandbox table into your run's database (asserted to be the
sandbox project before it connects — it cannot copy production). The pull is cached in
`~/.cache/niete-e2e-db/sandbox-copy` so the next `up` takes a minute; `SANDBOX_REFRESH=1` pulls a fresh one. The
copy holds testers' real phone numbers: it stays on your laptop and never goes in the repo. Then
`local-db.sh demo-seed` adds the made-up network (`bot/scripts/e2e/portal-demo-seed.js`).
**No sandbox access?** `DATA=demo bash scripts/dev-portal.sh up` gives the made-up data only — ~30 s, nothing to
pull. Anything you create while clicking around is gone after `down`.

The API is started from `<run_dir>/portal/` with its own `.env`, so **your `dashboard/.env` is never read** and no
real key reaches a local run. Two settings relax only there: the DB connection skips SSL for a `127.0.0.1` host,
and the session cookie drops `Secure` when `PORTAL_LOCAL_DEV=1` *and* the database is local
(`dashboard/lib/local-dev.js`) — production is unchanged.

## When something goes wrong

- **"a port this stack would bind is already in use"** — another run is up. `bash scripts/dev-portal.sh down`, or
  move this one: `PORTAL_PORT=4100 MOCK_PORT=4110 E2E_BOT_PORT=3110 E2E_REDIS_PORT=6391 E2E_WORKER_HEALTH_PORT=3211
  LOCAL_R2_PORT=54610 E2E_SUPABASE_PORT=54341 LOCAL_DB_REST_PORT=54340 bash scripts/dev-portal.sh up <run_dir>`.
- **Changed portal code** — `PORTAL_REBUILD=1` on `up` rebuilds the SPA. Changed `dashboard/` code — `down` then `up`.
- **Changed bot code** — commit it first; the stack runs `HEAD`.
- **Logs** — `~/.cache/niete-dev-portal/run/portal.log` (API), `bot.log`, `worker.log`.

## What it can't do (yet)

- **Open most lesson-plan files.** Lists, catalogues and history all show, but the PDFs and audio live in R2; a
  local run only has the handful in the seed. With `keys/niete-local.env` present (`provision-local-keys.sh`,
  needs Railway access) the file store reads the rest through from staging, read-only.
- **Generate anything new with AI** (a new lesson plan, an assessment paper, a coaching report): the lane has no
  vendor keys on purpose, so nothing leaves the laptop.
- **`npm run dev` in `portal/`** (the Vite dev server) — `up` serves a production build instead; use
  `PORTAL_REBUILD=1` after frontend changes.
