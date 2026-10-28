# insights — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/lib/insights -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `prompts/` | Model prompts for COACHIP glosses, re-check, homework and phonics detection → `prompts/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `allowlist.js` | The only reader of coaching_sessions.analysis_data for COACHIP; passes allow-listed keys only, dropping evidence text. |
| `circle.js` | COACHIP stage 8: picks one moment per coach on a sector's rank-1 weakness for the coaches' circle. |
| `clip-stage.js` | COACHIP stage 11 on R2: presigns recordings, cuts moment clips and full-lesson MP3s, records clip_status/clip_r2_key. |
| `clips.js` | COACHIP clip helpers: R2 key naming and ffmpeg cut-to-temp-file and upload of moment clips and seekable MP3s. |
| `constants.js` | Named constants every COACHIP nightly stage reads, incl. PIPELINE_VERSION and the PROD_WRITES_ALLOWED guard. |
| `env.js` | COACHIP environment assertion before any write, and the dry run's read-only client; prod stays read-only in code. |
| `facts.js` | COACHIP stage 1: pure functions that detect the FICO instrument, de-duplicate sessions and hash inputs. |
| `gloss.js` | COACHIP moment one-liner generation with five code gates, one retry then blocked; never logs names or quotes. |
| `job.js` | Runs the COACHIP nightly pipeline stage by stage (facts to glosses) against a Supabase or in-memory store. |
| `legs.js` | COACHIP stage 4: code-computed legs (minutes over plan, check-signal evaluator, step checks); pure. |
| `model-stage.js` | COACHIP stages 5/9/10 wiring: one spend ledger under the nightly cap and one coachip_model_runs row per model call. |
| `model.js` | OpenRouter client and nightly ledger enforcing the US$2 cap for COACHIP model calls, with one same-config retry. |
| `moments.js` | COACHIP stage 3: pure functions turning facts and session signals into moments and the chapter strip. |
| `phonics.js` | COACHIP phonics detector: keeps only model quotes found in the transcript and computes F8 in code; stores seconds only. |
| `predicates.js` | COACHIP FICO-crosswalk rule 2: phaseOutcome (graded/skipped/done) matching the governed Q2b query so rollups agree. |
| `purge.js` | COACHIP retention: --purge-clips deletes pre-cut clips and full MP3s a year after their last window; bd-sex15q.36. |
| `ranking.js` | COACHIP stage 7: ranks weaknesses per scope (prevalence x weight, 10% stickiness), returning ranks 1 and 2 only. |
| `reconcile.js` | COACHIP B14 reconcile: recomputes per-phase skipped/graded lesson counts with the governed Q2b predicate. |
| `results.js` | COACHIP stage 6b: per school/grade/language/W child-result cells for the term; scores only, under 5 tested insufficient. |
| `rollups.js` | COACHIP stage 6: per coach/school/sector x weakness rollups with the 4/8-week window rule; counts only, no teacher key. |
| `safety.js` | Nightly job DB/R2 protection: bounded PostgREST concurrency, timeouts, GET retries, backoff after OOM; bd-sex15q.41. |
| `scheduler.js` | Starts the COACHIP nightly as a child process at 02:00 Karachi when COACHIP_NIGHTLY=on; advisory lock picks one replica. |
| `seed.js` | Seeds the COACHIP lookup tables (weaknesses, interventions, crosswalk) from the frozen library JSON files, parent-first. |
| `signals.js` | COACHIP stage 2: one coachip_session_signals row per countable fact and weakness, via code EVALUATORS by W and source. |
| `source.js` | COACHIP stage 0 reads: ICT schools, coaches, teachers, sessions in window; analysis_data fetched by JSON path only. |
| `store.js` | COACHIP job writer: SupabaseStore and MemoryStore (dry run) share one interface; small-batch upserts after env check. |
| `windows.js` | COACHIP window calendar: Monday-to-Sunday weeks on Karachi days, held as date strings and computed in UTC. |

## Who reads this (all, generated)
- `allowlist.js` ← imported by `dashboard/lib/insights/job.js:15:25df117c` · `dashboard/lib/insights/phonics.js:9:6ca892ae`
- `circle.js` ← imported by `dashboard/lib/insights/job.js:24:4d4f36e9`
- `clip-stage.js` ← imported by `dashboard/jobs/coachip-nightly.js:187:5b2468f6`
- `clips.js` ← imported by `dashboard/lib/insights/clip-stage.js:11:cbd28092`
- `constants.js` ← imported by `dashboard/lib/insights/circle.js:16:642d7dc6` · `dashboard/lib/insights/env.js:9:642d7dc6` · `dashboard/lib/insights/facts.js:8:642d7dc6` · `dashboard/lib/insights/job.js:14:642d7dc6` (+12: `python3 kg/kg.py who-reads constants.js`)
- `env.js` ← imported by `dashboard/jobs/coachip-nightly.js:25:61874984`
- `facts.js` ← imported by `dashboard/lib/insights/job.js:16:1f70f462` · `dashboard/lib/insights/model.js:11:a9f54701` · `dashboard/lib/insights/purge.js:22:f9e07106`
- `gloss.js` ← imported by `dashboard/lib/insights/model-stage.js:14:65ff0992`
- `job.js` ← imported by `dashboard/jobs/coachip-nightly.js:154:d8ac42db`
- `legs.js` ← imported by `dashboard/lib/insights/job.js:20:86bd823c`
- `model-stage.js` ← imported by `dashboard/lib/insights/job.js:27:18fb3b9b`
- `model.js` ← imported by `dashboard/lib/insights/gloss.js:8:83d05ded` · `dashboard/lib/insights/model-stage.js:13:83d05ded` · `dashboard/lib/insights/phonics.js:8:83d05ded`
- `moments.js` ← imported by `dashboard/lib/insights/job.js:19:e6ecf195` · `dashboard/lib/insights/legs.js:9:e58c1d6e`
- `phonics.js` ← imported by `dashboard/lib/insights/model-stage.js:15:7e951b7b`
- `predicates.js` ← imported by `dashboard/lib/insights/facts.js:9:aea0feda` · `dashboard/lib/insights/legs.js:8:aea0feda` · `dashboard/lib/insights/model-stage.js:16:aea0feda` · `dashboard/lib/insights/reconcile.js:9:aea0feda` (+1: `python3 kg/kg.py who-reads predicates.js`)
- `purge.js` ← imported by `dashboard/jobs/coachip-nightly.js:62:eafa0f69`
- `ranking.js` ← imported by `dashboard/lib/insights/job.js:23:e58a673a`
- `reconcile.js` ← imported by `dashboard/lib/insights/job.js:25:7ce92c3a`
- `rollups.js` ← imported by `dashboard/lib/insights/job.js:22:946391df`
- `safety.js` ← imported by `dashboard/jobs/coachip-nightly.js:26:76f2f10b` · `dashboard/lib/insights/clip-stage.js:12:1f937b2c` · `dashboard/lib/insights/job.js:28:01dd00fe` · `dashboard/lib/insights/model-stage.js:17:01dd00fe`
- `seed.js` ← imported by `dashboard/lib/insights/job.js:26:46ce46b0`
- `signals.js` ← imported by `dashboard/lib/insights/job.js:18:6ee3cc1c` · `dashboard/lib/insights/rollups.js:10:0d9ca772`
- `source.js` ← imported by `dashboard/lib/insights/job.js:17:f1c8cb7d`
- `store.js` ← imported by `dashboard/jobs/coachip-nightly.js:81:8dabc7a6`
- `windows.js` ← imported by `dashboard/jobs/coachip-nightly.js:63:5cf6ad13` · `dashboard/lib/insights/circle.js:17:fbc8ff9e` · `dashboard/lib/insights/job.js:21:97cdd70a` · `dashboard/lib/insights/purge.js:21:97cdd70a` (+1: `python3 kg/kg.py who-reads windows.js`)

## Tests (all, generated)
- `allowlist.js` ← `dashboard/tests/insights/facts.service.test.js` · `dashboard/tests/insights/fixtures/moments.js` · `dashboard/tests/insights/fixtures/rollups.js` · `dashboard/tests/insights/gloss.service.test.js` · `dashboard/tests/insights/model-concurrency.service.test.js` · `dashboard/tests/insights/model-stage.gloss-reuse.service.test.js`
- `circle.js` ← `dashboard/tests/insights/circle.service.test.js`
- `clip-stage.js` ← `dashboard/tests/insights/clip-stage.service.test.js`
- `clips.js` ← `dashboard/tests/insights/clips.service.test.js`
- `constants.js` ← `dashboard/tests/insights/job.service.test.js` · `dashboard/tests/insights/purge.service.test.js` · `dashboard/tests/insights/rollups.service.test.js` · `dashboard/tests/insights/windows.service.test.js` · `tests/coachip/coachip-job-runs-env-ref.test.js`
- `facts.js` ← `dashboard/tests/insights/facts.service.test.js` · `dashboard/tests/insights/fixtures/moments.js` · `dashboard/tests/insights/fixtures/rollups.js`
- `gloss.js` ← `dashboard/tests/insights/gloss.service.test.js`
- `job.js` ← `dashboard/tests/insights/job.service.test.js` · `tests/coachip/coachip-job-runs-env-ref.test.js`
- `legs.js` ← `dashboard/tests/insights/legs.service.test.js`
- `model-stage.js` ← `dashboard/tests/insights/model-concurrency.service.test.js` · `dashboard/tests/insights/model-stage.gloss-reuse.service.test.js` · `dashboard/tests/insights/model-stage.phonics-reuse.service.test.js`
- `model.js` ← `dashboard/tests/insights/gloss.service.test.js` · `dashboard/tests/insights/model-concurrency.service.test.js` · `dashboard/tests/insights/model.service.test.js` · `dashboard/tests/insights/phonics.service.test.js`
- `moments.js` ← `dashboard/tests/insights/moments.service.test.js`
- `phonics.js` ← `dashboard/tests/insights/phonics.service.test.js`
- `predicates.js` ← `dashboard/tests/insights/facts.service.test.js` · `dashboard/tests/insights/legs.service.test.js`
- `purge.js` ← `dashboard/tests/insights/purge.service.test.js`
- `ranking.js` ← `dashboard/tests/insights/ranking.service.test.js`
- `reconcile.js` ← `dashboard/tests/insights/reconcile.service.test.js`
- `results.js` ← `dashboard/tests/insights/results.service.test.js`
- `rollups.js` ← `dashboard/tests/insights/rollups.service.test.js`
- `safety.js` ← `dashboard/tests/insights/model-concurrency.service.test.js`
- `scheduler.js` ← `dashboard/tests/insights/scheduler.service.test.js`
- `seed.js` ← `dashboard/tests/insights/seed.service.test.js`
- `signals.js` ← `dashboard/tests/insights/rollups.service.test.js` · `dashboard/tests/insights/signals.service.test.js`
- `source.js` ← `dashboard/tests/insights/source.service.test.js`
- `store.js` ← `dashboard/tests/insights/clip-stage.service.test.js` · `dashboard/tests/insights/job.service.test.js` · `dashboard/tests/insights/model-concurrency.service.test.js` · `dashboard/tests/insights/model-stage.gloss-reuse.service.test.js` · `dashboard/tests/insights/model-stage.phonics-reuse.service.test.js` · `dashboard/tests/insights/purge.service.test.js` (+2: `python3 kg/kg.py who-reads dashboard/lib/insights/store.js`)
- `windows.js` ← `dashboard/tests/insights/rollups.service.test.js` · `dashboard/tests/insights/windows.service.test.js`

## Related (all, generated)
- docs: `dashboard/lib/CLAUDE.index.md`? · `dashboard/lib/CLAUDE.md`? · `dashboard/lib/insights/CLAUDE.index.md`? · `dashboard/lib/insights/CLAUDE.md`? · `dashboard/lib/insights/prompts/CLAUDE.md`? · `dashboard/tests/insights/CLAUDE.index.md`? · `dashboard/tests/insights/CLAUDE.md`? · `tests/coachip/CLAUDE.index.md`? · `tests/coachip/CLAUDE.md`?
