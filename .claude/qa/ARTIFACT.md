# The NIETE E2E run artifact — one page, updated in place

**URL — do not change:** https://claude.ai/code/artifact/fa27772a-9ccc-4bdb-b416-10710dd784da

One living page for the suite. Every run **overwrites** it so the team always reads the latest
results at a stable link, and nobody has to hunt for "which run was that".

## Regenerate + republish (the last step of every `/niete-e2e` run)

```bash
RUN=.claude/qa/results/whatsapp/niete/<run-id>
python3 .claude/qa/shared/parse-per-scenario.py "$RUN"     # PER-SCENARIO.md -> scenarios.json
python3 .claude/qa/shared/build-run-artifact.py "$RUN"     # -> $RUN/artifact.html
```

Then publish with the **Artifact** tool:

```
Artifact(file_path="<abs path to $RUN/artifact.html>",
         url="https://claude.ai/code/artifact/fa27772a-9ccc-4bdb-b416-10710dd784da",
         favicon="🧪",
         description="…one sentence naming the run and its verdict…")
```

> ⚠️ **Passing `url` is what keeps the link stable.** Each run writes to a NEW directory, so the
> file path differs every time. Publishing a new path *without* `url` creates a SEPARATE artifact
> and the team's link goes stale. Keep `favicon` as 🧪 too — people find the tab by its icon.

## What feeds the page

| file | written by | holds |
|---|---|---|
| `run.json` | the runner, at run start | run id, target, driver, env, DB ref |
| `PER-SCENARIO.md` | the runner, as it goes | one row per scenario — id, name, tags, verdict, waited, evidence |
| `scenarios.json` | `parse-per-scenario.py` | the same rows, canonical + verdict-classified |
| `findings.json` | the runner, at the end | `critical` / `new` / `fixed` / `unverified` / `harness` |

`findings.json` is the only hand-authored input. Shape:

```json
{"critical":[{"bead":"bd-…","title":"…","body":"…","proof":"…","impact":"…"}],
 "new":[{"bead":"bd-…","title":"…","body":"…"}],
 "fixed":[{"bead":"bd-…","title":"…","body":"…"}],
 "unverified":[{"title":"…","body":"…"}],
 "harness":["…"]}
```

`proof` and `impact` are optional and render as labelled sub-notes; they are worth filling for
anything critical, because a finding without proof reads as a guess.

## Conventions the parser depends on

- A feature section header is `## <n>. <feature> (<count>)`.
- Each table has a header row containing `id` and `verdict`; other columns are read by name, so a
  feature may omit `waited` without breaking anything.
- Scenario ids match `^[A-Z]{1,2}\d{1,2}$` (`R01`, `M12`, `LP10`, `C9`, `L21`, `S4`).
- A verdict that OPENS with `PASS` counts as a pass even when the note also says an issue
  reproduces — the leading token is the verdict, the parenthetical is commentary.

Urdu evidence strings are detected and wrapped for Nastaliq + RTL automatically; write them
inline as normal.
