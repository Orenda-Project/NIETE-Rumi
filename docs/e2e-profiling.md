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

### Applied (bd-aqi0ay) — the drivers' own sleeps

The feature scripts' `sleep()` was the largest layer left (737 s inside windows after bd-k5gjje, most of the
2400 s between them). On the mock lane the drivers now get `api.sleep`: the mock Graph API long-polls
(`GET /outbox?wait=<ms>`), and a sleep returns as soon as the bot sends something and the outbox then stays
quiet for the settle, else at its full length (plain below 300 ms). It consumes nothing; `fresh()` still
sees the message. `training.cjs`'s three inline waits go through it, and `lesson-plan.cjs`'s two 15 s
Meta-pacing sleeps are skipped on the mock lane. Traced as `driver.sleep` (`woke: message | timeout`).

| | waits + pacer `c23df43` | driver sleep `c4acebd` |
|---|---|---|
| suite wall | 28 m 12 s | **25 m 23 s** |
| driver sleeps inside windows | 737 s (unaccounted) | 612 s, of which 273 of 321 sleeps timed out |
| verdicts pass / fail | 160 / 23 | 162 / 24 |

**What the sleeps are waiting for now.** Only 48 of 321 sleeps woke on a message; the rest ran out. Outside
the scenario windows, 549 timed-out 1.5 s sleeps in coaching (784 s) and 422 in training (645 s) all follow a
`poll.fresh` — the pipeline walkers polling for a bot message that does not come. In coaching that is the
walker's 240 s "no progress" stall at step 2, four to five times per run (COA19/20/28/29/30 BLOCKED), and it
is not explained by the quiz offer's 240 s delay: setting `TRANSCRIPT_QUIZ_OFFER_DELAY_SECS=5` on the lane
(tried, measured, reverted) left the stalls in place and blocked sixteen more coaching scenarios. The
remaining time on the lane is the bot not producing what the walkers wait for — the 115 cassette misses are
the first place to look (`--record-missing` with real vendor keys, a paid run).

### Applied — the cassette library (recorded 2026-10-26, run `20261026-052226`)

`--record-missing` against staging's vendor accounts recorded 104 LLM answers and 15 TTS clips (the
first attempt recorded nothing: the lane composed placeholder keys in record-missing mode, fixed in
bd-xeup1d; the second found the record file's OpenRouter key revoked). 228 cassette files committed.
A sealed replay-strict run with the library, all seven features:

| | driver sleep `c4acebd` | + cassettes `c73a668` |
|---|---|---|
| suite wall | 25 m 23 s | **23 m 9 s** |
| coaching feature wall | 1494 s | 1203 s |
| coaching 240 s "no progress" stalls | 4 | **0** |
| vendor misses | 115 | 15 |
| verdicts pass / fail / other | 162 / 24 / 89 | 157 / 28 / 90 |

The step-2 stalls were the pipeline waiting for LLM answers that a strict miss had killed; with the
answers recorded the pipeline completes. The 15 misses left (training T50/51/52/55/64/70/80 — the
quiz-generation cluster — and coaching COA04/COA58) are prompts whose content changes every run, so
their keys never repeat; they need the cassette key normaliser to mask that content, not more recording.

Verdicts moved because scenarios now reach behaviour they could not before. Newly PASS: menu M09/M24/M25,
coaching COA06/12/26/28/32. Newly FAIL or BLOCKED and not explained by the lane: coaching COA39/40/51 ("no
coaching ask arrived after the sweep"), COA45/48/55 (empty or deferred ask), COA58/29/30 (report content),
lesson-plan L11 (no store link when Lesson Plans are moved to the app), training T15 ("/teacher training"
is treated as the training command; the spec says it must not be). These are product or spec questions
for their owners, surfaced by a lane that now runs the real answers.

### Applied (bd-r09cmx) — under 20 minutes: sharding the two long features

The wall of a parallel run is its longest single-slot feature: with everything above applied, training was
22.8 min and coaching 20.0 min on one slot each (`20261026-1111-par`, suite wall 23 m 9 s). `run-suite.sh
--parallel` now shards a feature across slots along its drivers' `want()` blocks (`E2E_SHARDS`, several
lists per feature with `a|b`; child 1 runs the feature with `--skip`, child k runs list k with `--only`;
`--print-shards` shows the plan). Defaults, measured: training in three (the module ladder; the class-quiz
and lesson-plan-quiz blocks T35–T45/T56–T58; the generation cluster T25…T84), coaching in three (the first
pipeline run and runs 2–3; runs 4–6; run 7 and the coaching-ask cluster). Children launch longest first.
Two driver waits were also cut: `lpState` stops waiting when the bot says the quiz failed (T35 idled 303 s
of a 5 min budget), and the coaching walker's "no progress" budget is 90 s on the lane instead of 240 s
(`E2E_COACHING_STALL_MS`; every coaching shard pays the first pipeline run, which is genuinely stuck at
steps 2/3/5 on the lane with every vendor answer present — a product question, not a cassette gap).

| | one slot per feature `c73a668` | training ×2 `ee32b23` | training ×3, coaching ×3 `66f4d93` |
|---|---|---|---|
| suite wall | 23 m 9 s | 20 m 29 s | **13 m 9 s** |
| longest child | training 1366 s | coaching 1196 s | training#2 776 s |
| verdicts pass / fail / other | 157 / 28 / 90 | 159 / 28 / 90 | 165 / 28 / 90 |

From the baseline this session started from: **37 m 45 s → 13 m 9 s**, 151 → 165 pass, with the same
cassette library state and no scenario dropped (each shard reports its own ids; a block whose ids fall on
both sides of a cut would run twice, and the cuts were chosen so none does). Eleven slots run at once; the
machine has carried them without a port or lock collision. The 15 remaining vendor misses are prompts with
per-run content (training's quiz-generation cluster, COA04/COA58) and need the key normaliser, not recording.

### Fixed (bd-05v2sn) — the coaching walker never saw the report

COA04/05/07/15 were BLOCKED on every run, baseline included, with "the analysis went silent at steps
[2,3,5]". The transcripts showed the opposite: report image, commit card and quiz offer all landed
within 90 s. Since the Meta bill cut (`8d85965b5`, 2026-10-01, NC2) the bot sends the report image with
the "Step 5/5" line in its caption; the walker's report detector (2026-09-07) rejected any row matching
the pipeline-noise pattern, so `obs.report` never set, the commit card was ignored, and the run idled into
the stall budget. `isReportRow` now treats an image/PDF row as the report once any step was seen; the noise
filter applies to text rows only. Verification run `20261026-1616-par`: COA04/05/07/15 PASS, coaching's
first shard 511 → 452 s, suite 169 pass / 28 fail / 86 other, wall 13 m 13 s (the ceiling is now
training's class-quiz shard at 779 s).

### Applied (bd-0vaqcg) — the 31 s app-setting settles

The largest harness wait left after sharding: 18 settles of 31 s (558 s) in `20261026-1616-par`, one after
every switch the drivers flip, because each of the bot's switch caches expires in 30 s and only
app-redirect read `APP_SETTINGS_FLAG_TTL_MS`. `bot/shared/config/app-settings-ttl.js` now resolves that
one value for app-redirect and the six quiz modules that cache `web_quiz_hub` / `web_quiz_child_quiz_home`
(hub-flags, book, card, class-round-flags, hub-play, story-teacher); the lane composes 1000 and settles
1.5 s; production stays at 30 s. Run `20261026-2319-par`: settles 558 → 27 s, every child shorter, suite wall
**12 m 18 s**, verdicts unchanged at 169 / 28 / 86 (T692/T693/T695 and the app-redirect scenarios included).

| | one slot each | sharded | + report fix | + TTL |
|---|---|---|---|---|
| suite wall | 23 m 9 s | 13 m 9 s | 13 m 13 s | **12 m 18 s** |
| longest child | training 1366 s | training#2 776 s | training#2 779 s | training#2 720 s |

Harness waits left inside scenario windows: the 0.8 s settle after each reply (376 × 0.83 s = 313 s across
eleven children, of which 16 settles saw a second message) and the quiesce where no settle preceded it (76 s).

### Triaged (bd-1r3k2h) — the 27 FAILs of `20261026-2335-par`, one cause each

Verdicts 170 pass / 27 fail / 86 other at 12 m 13 s. Every FAIL was read from its evidence row and the run's
logs; nothing below is inferred.

| Cause | Scenarios | Fix |
|---|---|---|
| driver took the merged "✗ Not correct · Q2/20" line as the question (NO_KEY_ENTRY) | T05 T16 T21 | `questionLineOf` (bd-yuur1a) |
| STA06 regex lacked the LRI/PDI around `/menu`; T15 sent into an open menu wait | STA06 T15 | bd-yuur1a |
| `/portal` could not sign a link (no `INTERNAL_API_KEY`), then sent the signed link as text: `cta_url` needs https and the lane's portal URL is http | M10 M21 | lane placeholder key (bd-0ek3rv); `E2E_PORTAL_URL=https://127.0.0.1:5173` on the WhatsApp mock lane |
| registration Flow fixture was the old single-screen form | R02 R07 R12 R13-pre | fixture refreshed to v7.0 |
| `@known-issue` scenario | LANG09 | listed in `known-findings.json` |
| `seed-lp-quiz --lessons-from auto` found no sent lp_v8 quiz locally → no lesson refs → no "Make it again" | T36 T41 (T35) | `--lesson-id grade_3_math_ch1_seg1` |
| `offeredToday()` saw the transcript-quiz offers earlier runs left (`skip_reason: offered_today`) | COA39–COA55, COA45 | purge the driver's run quizzes before every ask |
| second recording sent 45 s after step 1 — pipeline already complete under replay | COA09 | `E2E_COACHING_DEFER_AFTER_MS` (0 on the lane), never after step 5 |
| Step 1/5 is replaced by the reaction (NC1); the check wanted five counters | COA25 | assert steps 2–5 |
| the promise rides in the PDF caption (bd-w2daa.7); the check wanted a PROMISE row after FORWARD | T74 | assert "FORWARD is last" |
| **product**: a question card that could not be sent was logged and the list still went out ("the question is in the picture above") | T42 | the sender stops the phase (`cardFailed`), the engine retries then skips the question; the mock also refuses header links on example.invalid |
| `niete_lp_fidelity_moves` was not a seed table (0 rows → `lp_absent`) | COA29 COA30 (COA20 COA59) | seed table added; `seed-pull --from-sandbox` |
| voice-debrief LLM answer not in the cassette (`E2E_CASSETTE_MISS llm …`) | COA58 | `--record-missing` |
| **product**: gloss that is a sub-phrase of the topic ("… Profit Calculation (Profit Calculation)") | T62 | `subPhraseOf` in lessonLabel |
| **product**: edit classifier filed a new lesson request under out_of_scope; router answered it | L11 (+ new L12) | `new_request` label, router falls through |
| **product**: the hero image had no slot for the partial note | COA19 | `.pnote` + `analysis_data.partial_report_note` |
| content: 2 of 7 questions drew pictures (needs 3) | T54 | LLM content — not a lane or product fix |

Verification, run `20261026-200020-ccede40-mock` (sync-selected parents + full shards, record-missing; wall 14 m 49 s):
T35/T36/T41, COA39–COA48 and COA51–COA55, COA45, COA25, COA19, L11 (+ the new L12), T74, T62 and STA06 PASS;
COA59 PASS as a side effect of the ask purge. Still failing there: T42 and M10/M21 (the two causes added above,
fixed after that run), COA29/COA30 (the runner re-installed the published seed over the sandbox pull — the
fidelity table needs `seed-publish`), LANG09 (known), T54 (content), COA49 (now BLOCKED: no `lesson_plans` row
for the survey — a different, pre-existing gap). T05/T15/T16/T21, R02/R07/R12/R13-pre, COA09 and COA58 were
not in that run's selection and were re-run separately (see the ledger rows for the follow-up run).
Run `20261027-044107-2be216c-mock` (menu + training, every scenario, replay, 7 m 36 s): M10, M21 and T42 PASS
with the second batch; T05/T16/T35/T36/T41/T62/T74 PASS again. T15 is proposed `@obsolete` (the intent
classifier opens the Teacher Training row by design since bd-xw56ed); T21's question-line fix landed after
this run; T54 is content. The follow-up coaching run records the new voice-debrief answer (COA58) and
exercises the deferral right after the confirm tap (COA09).

Closing state of the 27 (runs `20261027-050355-cc93ca7-mock` phase 2 + targeted re-runs): COA58 PASS (the voice
note now says the score), T42 and M10/M21 PASS, L11/L12 PASS, lesson-plan 12/12. COA09 is BLOCKED with its
reason: under cassette replay the session is in a waiting state (photo gate, lesson-plan gate) or the
reflective step until Step 4/5, and Steps 4/5 and the report arrive in one read — there is no mid-flight
second to send into. The guard is unit-tested on both doors (the file door was unguarded until cc93ca791).
Registration: R02/R07/R13-pre PASS with the v7.0 fixture; R12 needs the `schools` table in the seed (0 rows
locally), R10/R13 are the known user-cache gap the driver's header names, R15 needs its cassettes recorded.

### Applied (bd-1r3k2h) — the driver sleeps the dashboard still showed

Run `20261027-1022-par` (212 / 9 / 76, 7 m 38 s): driver.sleep 509 s, bot.timeout 60 s, bot.processing 31 s.
Read from the traces, three waits were waste and one dashboard gap hid a fourth:

| Where | What | Fix |
|---|---|---|
| coaching, 180 s | the walker waited the full 3 min for the report's voice note after the bot had said "Voice summary could not be generated" (per-run cassette miss) | stop on that note; `E2E_COACHING_VOICE_NOTE_MS` 60 s on the lane |
| coaching, 60 s | `tapAndWait` on the photo prompt's "Yes" — a reaction since the bill cut, never a message | 4 s |
| training#3, 150 s | T77 (90 s) and T78 (60 s) wait for a report that must NOT arrive | `E2E_REPORT_ABSENCE_MS` 12 s on the lane |
| coaching#2, 8 × 60 s | the extension's own pipeline tapped "Yes" and "Add another" with the 60 s default — invisible until coaching-ext's verdicts carried a window | 4 s each; guard() times its block, rec() takes an explicit `t1` |

| child | 1022 | 1040 / 1051 |
|---|---|---|
| coaching (first run) | 6.5 min | **2.6 min** |
| coaching#2 | 7.3 min | **5.5 min** |
| coaching#3 | 7.4 min | **3.5 min** |
| training#3 | 7.1 min | **5.1 min** |
| slowest scenario | COA29 179 s | COA56 48 s |
| p95 scenario | ~60 s | 15 s |

Verdicts unchanged across the three runs. What the Overview still shows as "driver sleep" (about half the bar)
is the 1 s / 2.5 s polls while the worker runs a coaching pipeline — the poll wakes on any bot message and
none arrives until the worker is done — so that time belongs to the worker, not the harness; COA27's 63 s is
the photo-gate sweep the scenario itself waits for. The honest next step is in the profiler: attribute a sleep
that overlaps an active worker job (worker.log "Received job" → done) to a `bot.worker` layer.

### Applied (bd-1r3k2h) — the profiler says whose time a driver sleep is

"Driver sleep, 50% of the bar" said nothing about who was waiting for whom. Every driver sleep is now split
by what the bot was doing during it, read from the bot and worker logs:

| layer | meaning | run 20261027-1051 (coaching, three shards) |
|---|---|---|
| `bot.worker` | overlaps a queue-worker job ("Received job" → "Job completed") — the bot's time | 35 s |
| `driver.idle` | neither bot.log nor worker.log wrote a line: the bot had answered, the driver was waiting out a budget for a message that was not coming — **pure harness cost** | 562 s |
| `driver.sleep` | the rest (the bot was logging, no queued job) | 32 s |

The Overview has a tile for each. The idle bucket pointed straight at the extension pipeline's tail: after
the commitment card it polled 30 s for the quiz offer (5 s on the lane) — `E2E_COACHING_POST_REPORT_MS`,
12 s on the lane. Run `20261027-1138-par`: coaching 2.6 → **2.0 min**, coaching#2 5.5 → **3.9 min**,
coaching#3 3.5 → **3.2 min** (idle 177 → 87 s, 272 → 147 s, 113 → 96 s), verdicts unchanged. What remains
idle is COA27's 63 s wait for the photo gate to go stale (the scenario's own design) and the 12 s tail per run.
