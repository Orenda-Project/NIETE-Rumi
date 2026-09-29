# Reading a runs.jsonl row and the PR comment

One row per (run × feature), appended by `.claude/qa/shared/ledger_row.py` to
`.claude/qa/ledgers/runs.jsonl`.

```json
{"method":"mock","env":"sandbox","feature":"menu","status":"CRITICAL",
 "summary":{"total":12,"passed":11,"failed":1,"blocked":0,"skipped":0},
 "commit_sha":"<40 hex>","branch":"…","dirty":false,"dirty_files":0,
 "cassette":{"mode":"replay-strict","misses":7,"scenarios_affected":["M08","M09","M12"],"note":"…record once…"},
 "stack":{"bot_url":"http://127.0.0.1:3100","mock_url":"http://127.0.0.1:4010","worktree":"…/src","lock_blob":"…"},
 "flows":{"via":"flow-emulator","opened":4,"completed":0,"refused":0,"flows":["…"]},
 "regression":{"gate":"pass","new_failures":[],"known":["L08"],"fixed":[]},
 "spec_sync":{"brief":null,"validator_exit":0}}
```

## `status` — one rule (`ledger.verdict`)

| Status | Rule |
|---|---|
| `CRITICAL` | any `blocked`, or 3+ `failed` — **or any cassette miss** in the run |
| `DEGRADED` | 1–2 `failed` |
| `HEALTHY` | otherwise |

A `CRITICAL` is not automatically a new break. Read `regression`: `gate: pass` with everything under
`known` means only documented findings failed; `new_failures` is what actually broke.

## Fields that are easy to misread

| Field | What it really says |
|---|---|
| `dirty` / `dirty_files` | the **developer's** tree at run time. The bot ran from a clean worktree at `commit_sha` regardless |
| `cassette.misses` / `scenarios_affected` | vendor answers that were not recorded. Those scenarios' PASS/FAIL is **not evidence** — the bot answered from its error path |
| `flows.completed` | counts real `complete` actions only. A script that closes the Flow after the endpoint answered (lesson-plan does) completes none — `0` is not a failure |
| `spec_sync.validator_exit` | non-zero means the Gherkin was invalid; nothing should have been driven |

## The PR comment (`<!-- niete-qa-impact -->`)

| Cell | Means |
|---|---|
| spec `stale` | the feature's code changed but its `.feature` did not, and no `Spec-Sync: <feature>=none-needed (<why>)` line in the PR body — **blocks the PR** |
| e2e `✅ HEALTHY` / `⚠️ DEGRADED` / `❌ CRITICAL` (or `✅ recorded`) | a row for the feature was added in the PR range; the word is its last row's status |
| e2e `⬜ missing` | no row added in the range **on the remote** — see link 4 in SKILL.md §1 |
| `📼 N missing` | the latest row still has N cassette misses → record them (SKILL.md §4) |

E2E proof is **warn**, never blocking (yet). Spec freshness and "a Gherkin scenario with no driver"
(`check-scenario-coverage.py`) **do** fail the PR.
