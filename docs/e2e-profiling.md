# Mock-lane performance profiling — where a run's time goes

The mock E2E lane ([e2e-mock-lane.md](e2e-mock-lane.md)) records one number per scenario. This profiler
records **where that number comes from**: every harness primitive is a span with its waits as children, the
mock Graph API times the bot's webhook ack and stamps every send, the local DB proxy times every PostgREST
request, and the cassette seam times every vendor call. `profile_run.py` folds those into one profile per
run × feature, and a local dashboard reads them across runs. Nothing here changes how the bot behaves; every
hook is at a seam the lane already owns and is a no-op without its env var.

## Run it

Profiling is **on by default** for every mock-lane run — nothing to switch on:

```bash
npm run e2e:mock -- menu            # or any feature / all; each feature ends with a "profile:" line in runner.log
bash .claude/qa/shared/commit-e2e.sh HEAD --all-mock
```

Then look at it:

```bash
bash .claude/qa/shared/profile-dashboard.sh          # → http://127.0.0.1:8765/shared/profile-dashboard.html
```

The dashboard is one static HTML file served next to `.claude/qa/profiles/` (python `http.server`, bound to
127.0.0.1). `E2E_PROFILE_OFF=1` skips the profiler; the trace files are still written.

Rebuild a profile by hand (e.g. after changing the profiler, or for a run dir the suite did not finish):

```bash
python3 .claude/qa/shared/profile_run.py .claude/qa/results/whatsapp/niete/<run> --feature menu --publish .claude/qa/profiles
python3 .claude/qa/shared/profile_run.py --compare .claude/qa/profiles/<A>.json .claude/qa/profiles/<B>.json
```

## What is measured, and by what

| Layer | Meaning | Source |
|---|---|---|
| `bot.processing` | the webhook left the mock → the bot's first send landed on the mock. Exact: both ends are the mock's own clock, so poll granularity never inflates it | `mock.inject.attrs.at` + the outbox item's `at` (`mock-graph-api.js`) |
| `bot.pacing` | inside bot.processing: time the bot's **send pacer** held the reply for a WhatsApp pair-rate slot (`whatsapp-send-pacer.js`: 6 s per phone once 8 sends are in flight). Production-faithful; pure wait on the mock | `whatsapp.paced` log events (`outcome: waited`, `delayMs`) on the message's correlation id, parsed from `bot.log` |
| `bot.timeout` | a reply that never came: the harness waited its full timeout. Kept apart so a missing reply is never read as slow bot work | `bot.reply` spans with `status: timeout` |
| `wait.intentional` | the harness chose to wait: `wait.quiesce` before every send (outbox still for 800 ms), `wait.settle` after every reply (outbox quiet for 1200 ms), the 31 s `app_settings` settles | spans in `mock-api.cjs` |
| `harness.polling` | the bot had answered; the harness had not polled yet (`pollMs` 500) | `poll.detect` span |
| `mock.http` | the inject round trip, including the bot's webhook ack (`ackMs`) | `mock.inject` span |
| `flow` | Flow-emulator primitives (open / click / pick…), incl. their `data_exchange` calls to the bot's endpoint | spans |
| `seed` | python seeds, DB reach-through, app-setting flips | spans |
| `driver.unaccounted` | scenario time no primitive covers — the feature script's own `sleep()` and polling loops | derived: scenario − covered primitives |
| outside windows | the feature's wall time that falls in **no** scenario window: primitives the driver ran between scenarios (seeds, navigation, re-entering a ladder) and idle time (sleeps, polling, BLOCKED rows recorded at 0 ms). Coaching and training spend more time here than inside their scenarios | `summary.outside` (primitives by op + idle) |
| DB | every PostgREST request: method, table, query, status, bytes, ms | `db/db-timing.jsonl` (`local-db-proxy.js`, `LOCAL_DB_TIMING_LOG`) |
| Vendor | every cassette-mediated call: hit / miss / live / fault, replay `ms`, and the `liveMs` the vendor took when recorded | `cassette-trace.jsonl` (`e2e-cassette.js`, `E2E_CASSETTE_TRACE_LOG`) |

Files, per run dir: `trace-<feature>.jsonl` (spans) · `transcript.jsonl` (`in` / `ack` / `out` with timestamps) ·
`db/db-timing.jsonl` · `cassette-trace.jsonl` · `profile-<feature>.json` (the built profile). Published copies:
`.claude/qa/profiles/<run>__<feature>.json` + `index.json` (gitignored, per machine).

A span line: `{run, feature, span, parent, name, layer, kind, t0, t1, ms, status, attrs}`. A scenario is a row of
its own (`name: scenario`, from the duration `rec()` already measures); primitives are attributed to scenarios by
time window, so feature scripts needed no change.

## Reading the dashboard

- **Overview** — totals, pass rate, mean / median / p90 / p95, the share of intentional waits vs bot time, a
  stacked bar per profile, the slowest scenarios, the top operations by own time.
- **Discover** — every span of the selected runs, searchable (free text over op / arg / scenario / run) and
  filterable by layer, op, status, minimum ms; sortable; a row opens its trace.
- **Traces** — a scenario's waterfall: primitives and their children, coloured by layer, the bot's log timeline
  for each injected message as ticks (and as a table), the DB requests in the window.
- **Bottlenecks** — operations ranked by own time with p50 / p90 / p95 / max and slowest examples; DB by
  request; vendor by kind (replay vs recorded live); repeated calls (same primitive, same argument).
- **Compare** — two profiles: layer deltas, scenario deltas flagged regression / improvement / same
  (threshold max(300 ms, 10 %)), operation deltas.

Filters (runs, feature, date range, latest-per-feature) apply to Overview, Discover and Bottlenecks.

## Timing gaps — what is NOT a measured span

Every profile carries a `gaps` list; the standing ones:

- **Bot internals are point events, not spans.** Stages inside the bot come from `bot.log` / `worker.log`
  (pino-pretty), so a stage's duration is the gap to the next log line. A `.started`/`.completed` pair would
  make it a span; the handlers do not emit them today.
- **DB queries carry no correlation id** (supabase-js sends none) — attributed to a scenario by timestamp.
  Each parallel slot has its own proxy and database, so there is no cross-slot contamination.
- **`driver.unaccounted` is derived.** The feature scripts' own sleeps and `fresh()` polling loops are not
  individually instrumented (`training.cjs` and `coaching.cjs` carry most of them).
- **Vendor time is replay cost.** `liveMs` is what the vendor took when the cassette was recorded; a strict
  miss has no live figure.
- **Worker jobs** join a trace only when the job envelope carried the inbound correlation id.

## Tests

```bash
npm run test:raw -- tests/e2e-mock/profile-trace.test.js tests/e2e-mock/local-db-proxy-timing.test.js tests/e2e-mock/cassette-trace.test.js --forceExit
python3 .claude/qa/shared/test_profile_run.py
```

## Findings — run `20261023-1006-par` (commit `479f4a70f0ec`, every mock-lane feature, one slot each)

Seven features, 260 recorded scenarios, 37 m 45 s wall in parallel; the features' own walls add up to 77 m.
Of the 36.7 min inside scenario windows (overlaps removed) the bot was **working for 21 s**. Everything else is
a wait of one kind or another. Verdicts: 151 pass · 23 fail · 86 blocked/skipped — the failures are cassette
misses (115 of 250 vendor calls had no recording at this commit) and spec/fixture drift that a control run at
the parent commit (`681208fd4`, registration, no profiling hooks in the bot) reproduces identically.

| Where the time went (inside scenario windows, 2203 s summed) | s | share |
|---|---|---|
| driver sleeps / polling loops inside scenarios (`driver.unaccounted`) | 1038 | 47 % |
| the bot's **send pacer** holding replies (`bot.pacing`) | 527 | 24 % |
| harness quiesce + settle + app-setting settles (`wait.intentional`) | 472 | 21 % |
| poll granularity (`harness.polling`) | 66 | 3 % |
| one reply that never came (`bot.timeout`, COA04 `tap:Yes`) | 60 | 3 % |
| **bot processing** (webhook → first send, pacing excluded) | **21** | **1 %** |
| seeds, flow emulator, inject round trips | 19 | 1 % |

Outside the windows (between scenarios): 982 s of primitives and 1603 s of idle, almost all in coaching
(554 s + 837 s) and training (347 s + 749 s). The bot's real reply latency is p50 43 ms, p95 689 ms (n = 211).

### Ranked bottlenecks, with the measured evidence

1. **Driver-side sleeps and polling loops — 1038 s inside windows, ~1600 s outside.** COA04 alone carries 245 s of
   unaccounted time (a 5-step pipeline walked with 2.5 s polls, `coaching.cjs:342/467/476`); T77 90 s, T78 73 s
   (`training.cjs:706` collects with 1.5 s polls); L02 60 s is four hard-coded `sleep(15000)` (`lesson-plan.cjs:49/72`).
   With cassette replay the bot answers in milliseconds, so these are pure waits.
   *Fix:* replace fixed sleeps with condition polls at ≤250 ms, and make `fresh()` long-poll the mock
   (`/outbox?after=&wait=`), so a loop wakes when a message lands. *Expected:* 60–70 % of this time, ≈ 25–30 min
   of feature wall across the suite.
2. **The bot's WhatsApp send pacer — 527 s inside windows (135 paced replies, p50 3.3 s, max 11.3 s), more outside.**
   `whatsapp-send-pacer.js` spaces sends to one phone 6 s apart once 8 are in flight (Meta's pair rate limit). The
   driver is one phone that talks every 3 s, so from the 9th message on every reply waits ~3 s for a slot; the
   mock Graph API has no such limit. Seen as the 3.3 s gap between `whatsapp.paced … outcome: waited` and the send
   in every menu/status/language trace. *Fix:* set `WA_PAIR_PACING=off` (or `WA_PAIR_INTERVAL_MS=200`) in the lane's
   composed `.env` (`local-stack.sh`), keeping the pacer's own unit tests as its coverage. *Expected:* ≈ 9 min
   inside windows, more in coaching/training between windows.
3. **`wait.settle` after every reply — 318 s (210 settles, p50 1.50 s).** In 208 of 210 the outbox never grew during
   the settle; 381 s of it was after the last message had already landed. *Fix:* on the mock lane drop `settleMs`
   from 1200 to 300–400 (E2E_SETTLE_MS), or end the settle when the bot signals the inbound is done. *Expected:* ≈ 4 min.
4. **`wait.quiesce` before every send — 154 s (153 quiesces, p50 1.0 s).** The outbox moved during a quiesce
   **0** times in the whole run. *Fix:* skip the quiesce when the previous reply's settle already ended quiet (it
   always did), keep it only after a `fresh()`-driven step. *Expected:* ≈ 2.5 min.
5. **`seed.app-setting` 31 s settles — 217 s** (coaching 31, lesson-plan 62, training 124): the harness sleeps out
   the bot's 30 s `app_settings` cache (`FLAG_TTL_MS`) after every flip and every restore. *Fix:* an E2E-only
   cache-invalidate endpoint beside the existing `POST /clear-history`, or a lane env `APP_SETTINGS_TTL_MS=1000`.
   *Expected:* ≈ 3.5 min.
6. **Poll granularity — 66 s** (`pollMs` 500; p50 327 ms per reply). *Fix:* `E2E_POLL_MS=100` on the mock lane, or
   the long-poll above. *Expected:* ≈ 50 s.
7. **Cassette misses — 115 of 250 vendor calls** (109 LLM, 6 TTS). Each miss costs only 0.2–0.4 s but fails or blocks
   its scenario, and 23 fails + several blocks in this run trace to them. Hits avoided 1882 s of recorded vendor
   time (LLM 1434 s, ASR 423 s). *Fix:* a `--record-missing` run with real keys, then commit the cassettes.
8. **DB is not a bottleneck on the lane — 9440 requests, 19.8 s, 2.1 ms mean** — but `GET users` ran 1743 times
   (6.7 per inbound message) and `GET app_settings` 465 times. Free locally; on Supabase in production each is a
   network hop. Worth a per-request user cache, measured in production, not here.

Repeated expensive calls: `send /training` × 18 (105 s), `send /quiz` × 21 (82 s), `send /menu` × 15 (74 s),
`upload hameeda_16min.m4a` × 10 (62 s) — each paying the pacer + settle + quiesce stack above.

Applying 2–6 is harness/env work with no product code change and removes an estimated 20 min of the 37 m 45 s
wall; 1 is driver work and removes most of what remains.

### Applied (bd-k5gjje) — the lane's waits, after the first profile

| Knob | Where | Mock-lane value | Before |
|---|---|---|---|
| `WA_PAIR_PACING` | the bot's env, composed by `local-stack.sh` (`E2E_WA_PAIR_PACING=on` restores it) | `off` | on: 6 s per phone after 8 sends |
| `RATE_LIMIT_MAX` | the bot's env (`constants.js`, 30 per 60 s in production) — one phone sending every second trips it once the pacer is off (training T24/T37 on the first fixed run) | `1000` | 30 |
| `APP_SETTINGS_FLAG_TTL_MS` | the bot's env (`app-redirect.service.js`, default 30 s unchanged) | `30000` (unchanged: six more switch caches in `quiz/*` keep their own 30 s, and a 1.5 s settle broke training T695) | 30 000 |
| `E2E_APP_SETTING_SETTLE_MS` | `run-suite.sh` → `mock-api.cjs` setAppSetting/restoreAppSettings | `31000` (unchanged, knob only; ≈ 217 s still on the table once every cache reads one TTL) | 31 000 |
| `E2E_SETTLE_MS` | `run-suite.sh` → `mock-api.cjs` post-reply settle | `800` | 1200 |
| `E2E_POLL_MS` | `run-suite.sh` → `mock-api.cjs` outbox poll | `100` | 500 |
| quiesce skip | `mock-api.cjs`: the pre-send quiesce is skipped when the outbox has not changed since a settle proved it quiet (`attrs.skipped`) | automatic | 800 ms every send |

The chrome lane is untouched (its defaults are the old values; none of the `E2E_*` knobs is set there).

**Measured** (all seven features, one slot each, same machine, same cassettes):

| | baseline `479f4a7` | fix 1 `09a45dc` | fix 2 `c23df43` |
|---|---|---|---|
| suite wall | 37 m 45 s | 25 m 14 s | **28 m 12 s** |
| features' walls, summed | 4643 s | 3132 s | 3411 s |
| bot send pacer (inside windows) | 527 s | 0 | 0 |
| harness quiesce/settle/app-setting (inside windows) | 472 s | 221 s | 221 s |
| poll granularity | 66 s | 15 s | 15 s |
| "slow down" rate-limit replies | 0 | 4 | 0 |
| verdicts pass / fail | 151 / 23 | 159 / 26 | 160 / 23 |

Fix 1 also settled app-settings in 1.5 s and let the lane trip the bot's inbound rate limit; fix 2 lifts the
limit on the lane and puts the 31 s app-setting settle back (the 3 min between fix 1 and fix 2 is exactly those
settles: menu, lesson-plan and coaching flip switches). Verdicts that changed baseline → fix 2 and are not
explained by the change: `COA28` PASS → BLOCKED ("no progress for 240 s at step 2": after the lesson-plan pick of
the pipeline's second run the bot queued no analysis job, so `COA21/23/24` block on "needs run 2"); `T64`
PASS → FAIL (the `/quiz` list came back with its two seeded rows in the other order; the check requires
newest-first). `M26` FAIL → PASS and `COA16` FAIL → PASS went the other way. Menu now reaches all 26 scenarios
(the baseline runner aborted at M07 on a missing list row). The suite's known cassette misses are unchanged.
