# /e2e-web — Run the portal E2E suite (web lane) in a browser against a local stack

The portal's counterpart to `/e2e-mock`. One command, no WhatsApp number, no sandbox or Railway access. The teacher
and coach portal runs locally at this checkout's HEAD on its own port (`localhost:4100+slot`, never the `:4000` of
your own `dev-portal.sh up`), on made-up demo data in a per-run database that is dropped when the run ends. A
headless Chromium drives it. The first run on a machine installs the portal dependencies and the browser by itself.

**Argument (`$ARGUMENTS`)** — optional:
- *(empty)* → `portal-smoke`: every main page of every portal opens healthy
- one feature (`portal-login`, `teacher-lessons`, `coach-portal`, …) → every scenario in that feature
- several features, comma-separated (`portal-login,teacher-home`) → those features at once, one slot each
- `all` → every portal feature at once (at most `E2E_WEB_PARALLEL`, default 4, side by side; one portal build)
- extra options pass through to `e2e-web.sh`:
  - `--only PL01,PL03` (one feature) or `--only 'portal-login=PL01;teacher-home=TH02'` (several)
  - `--headed` — a visible, slowed-down browser to watch (ignored on commit-triggered runs and in CI)
  - `--keep` — leave the stack up afterwards; its URL and logins are printed
  - `--slot N` — pick the port slot · `--print-plan` — show what it would do, start nothing
  - `DATA=sandbox` before the command copies the sandbox database instead of demo data

Run it from the NIETE-Rumi checkout:

```bash
bash scripts/qa/e2e-web.sh $ARGUMENTS
```

The same command from a terminal: `npm run e2e:web -- <args>`.

The features are the drivers in `.claude/qa/web/features/*.cjs`; their specs are `tests/features/web/*.feature`.

When it finishes, report each feature's `ok` / `FAIL` lines and its ledger status (HEALTHY n / n), list every failed
scenario with its error line and screenshot (`.claude/qa/results/web/niete/<run>/<ID>.png`), and give the results
folder. A parallel run also prints the per-feature log folder (`~/.cache/niete-e2e-web/parallel-<time>/`).
If the stack cannot start (exit 3 or more), show the last lines of that feature's log; `--print-plan` shows the
ports and run dir it tried.

For the WhatsApp bot on the mock lane use `/e2e-mock`; for the real bot on a linked WhatsApp account, `/niete-e2e`.
