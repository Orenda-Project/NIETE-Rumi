# Running the NIETE E2E suite on a schedule

**Installed:** `com.rumi.niete-e2e` — a macOS LaunchAgent firing at **00:00, 02:00 … 22:00 local**,
scope `all`, driver = the number linked in the driving Chrome (`NIETE_E2E_DRIVER`, required), target = the default profile in `whatsapp-targets.yaml` — **sandbox** since 2026-09-09.

```bash
bash scripts/qa/niete-e2e-schedule.sh status      # loaded? last fires?
bash scripts/qa/niete-e2e-scheduled.sh --check-only   # would a fire start right now?
bash scripts/qa/niete-e2e-schedule.sh run-now     # fire once, foreground
bash scripts/qa/niete-e2e-schedule.sh uninstall
```

## Why a LaunchAgent and not `/loop` or an in-session cron

Both of those live **inside the Claude session that created them**. The previous schedule
(jobs `dfdc4717` / `8311154c`) was set up on 2026-08-18 and stopped the moment that session
closed at 16:07 the same day. Nothing on disk held the schedule — the job ids existed only in
the session transcript. A LaunchAgent survives session close, logout and reboot.

## What it cannot do

**Sleep kills a run.** This Mac idles to sleep after 1 minute; on 2026-08-24 a scheduled run died
at 02:33 with `Your computer went to sleep mid-response` having completed only registration
(13 of 99). The runner now wraps the child in `caffeinate -ims`, which holds the machine awake
for exactly the length of the run. Two limits remain: `-s` is ignored **on battery**, and
**closing the lid sleeps regardless**. For an overnight full run, leave it on AC with the lid open.

**This suite cannot run truly headless.** WhatsApp de-links a headless browser within about a
second, so every fire needs a real desktop Chrome, on a Mac that is **awake and unlocked**, with
a **linked** `web.whatsapp.com` tab. A sleeping laptop means a missed fire — launchd will run it
on wake, but a locked screen with Chrome closed will simply be refused.

## The three guards, and the failures they exist for

1. **Already running → decline (exit 0).** A full `all` run takes ~3h15m on a 2h cadence, so
   fires overlap by design. The driver lock makes the late fire step aside instead of letting two
   runs drive one WhatsApp account. Expect **roughly every other fire to be skipped** — that is
   the schedule self-regulating, not an error.
2. **Preconditions → visible BLOCKED report.** Chrome must be running and a `web.whatsapp.com`
   page target must exist (asked of Chrome's DevTools endpoint, ports `9223 9222 9229`). A refusal
   writes `REPORT.md` saying why.
3. **No output → visible NO OUTPUT report.** The 2026-08-17/18 fires left **empty directories**
   (`niete-all-cron-1313`, `niete-all-cron-2245`, `niete-cron-confirm-20260817` — all still there,
   all still empty) because they stopped at the QR screen and wrote nothing. An empty run dir reads
   as "no problems found", which is the worst possible way for a QA schedule to fail. Any fire that
   produces no `PER-SCENARIO.md` now leaves a report saying so, and a fire that does produce one is
   put through `validate-run.py`.

Logs: `.claude/qa/results/whatsapp/niete/_scheduler/<run>.log`, plus launchd's own
`launchd.out.log` / `launchd.err.log` in the same directory.

## The thing that actually broke it: which Chrome the run attaches to

`chrome-devtools-mcp`, left to itself, **launches its own Chrome** over
`--remote-debugging-pipe` with a fresh profile. That profile has no linked WhatsApp, so a scheduled
run meets a QR screen and stops — which is precisely how the 2026-08-17/18 fires ended up writing
nothing. Three Chromes were running on this machine when we diagnosed it, and only one (port
`9223`) held the linked session.

The runner therefore writes a **run-specific MCP config** pinning `chrome-devtools` to
`--browserUrl http://127.0.0.1:$WA_PORT` and passes it with `--mcp-config … --strict-mcp-config`.
The shared `.mcp.json` is left alone so interactive sessions keep their normal behaviour.

If you move the linked session to a different Chrome, set `NIETE_E2E_CDP_PORTS` to the port list to
probe (default `9223 9222 9229`). A committed copy of the config lives at
`.claude/qa/config/mcp-scheduled.json` for reference; the runner generates its own per fire so the
port is always the one it just verified.

## Changing cadence or scope

Edit the env block in `niete-e2e-schedule.sh` (or export before installing) and re-run `install`:
`NIETE_E2E_SCOPE` (`all` or empty for the safe subset), `NIETE_E2E_DRIVER`, `NIETE_E2E_REPO`.
For a lighter cadence, the safe subset runs in ~15–20 min and suits 2-hourly far better than the
full 99.
