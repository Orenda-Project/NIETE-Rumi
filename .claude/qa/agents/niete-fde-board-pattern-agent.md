---
name: niete-fde-board-pattern-agent
description: NIETE (ICT) teacher-app E2E agent for the FDE Grade 5 board-pattern paper (Assessment → FDE pattern papers). Runs the @sandbox scenarios of fde-board-pattern.feature — the ones that need a real generated paper — on the SANDBOX tier in a headless Android WebView, EN and UR, and returns JSON. The local-stack @FBnn scenarios belong to the web lane (`npm run e2e:web -- fde-board-pattern`). NO prompts.
order: 20
feature: tests/features/web/fde-board-pattern.feature
---

# NIETE — FDE board-pattern paper E2E Agent

Execute the `@sandbox`-tagged scenarios of **`tests/features/web/fde-board-pattern.feature`** against the NIETE teacher
app on **sandbox** and return structured JSON. **Self-contained**: this agent owns its run procedure. The `@FBnn`
scenarios (switch, door, Check and make, refusals, soft limit) are run by the web-lane driver
`.claude/qa/web/features/fde-board-pattern.cjs` on the local stack; run them here too only when asked.

## Step 0: Setup
1. **Tier** — sandbox only. Never production, never staging, unless the caller names the tier.
2. **Database ref** — before ANY write, resolve the Supabase project ref from the URL in use, print it, and abort if it
   is not the sandbox ref. Never print a key.
3. **Switches** — `assessment_fde_pattern_enabled` = `true` for the run (`insert … on conflict (key) do update`);
   `assessment_rate_limit_enabled` left as found. Record what you changed; put both back at the end.
4. **Teacher** — a fictional sandbox teacher account with Grade 5 (and Grade 3 for the last scenario). No real names
   or numbers in anything written.
5. **Browser** — one headless Chromium with an Android WebView user agent, viewport 390×844 (and 360×740 for the
   word-count and layout checks), `--mute-audio`, speech synthesis disabled. Closed in `finally`.
6. **Log** — `[WEB-E2E] setup complete — tier:sandbox feature:fde-board-pattern`.

**If setup fails**: return `status: "BLOCKED"` with the reason.

## Step 1: Load Scenarios
```bash
python3 .claude/qa/engine/bin/parse-gherkin.py tests/features/web/fde-board-pattern.feature --tag @sandbox
```
`@real-paper` scenarios make a real paper (one model run each, about three minutes): run them in order, one at a time,
and reuse a ready paper across the editor scenarios instead of making another. `@urdu` runs with the app in Urdu.

## Step 2: Execute Each Scenario
Per scenario: Given (switch, account, state) → When (tap through the app by visible words) → Then (read the screen;
download both PDFs and read their text; render the first page of each to PNG as evidence). A paper assertion reads
the PDF's text, never the app's summary of it. The 409 scenario starts a paper and, while its status is
`queued`/`generating`, reaches Check and make again for the same grade and subject.

**Status values**: `PASS | FAIL | BLOCKED`. On FAIL: the screenshot, the request id, and the exact text seen.
Evidence goes under `.claude/qa/results/web/fde-board-pattern/<run>/`.

## Step 3: Clean up
Delete only the rows this run created, by their recorded ids. Put the switches back as found.

## Step 4: Return JSON
```json
{
  "feature": "fde-board-pattern",
  "surface": "web",
  "env": "sandbox",
  "started_at": "<ISO-8601>",
  "finished_at": "<ISO-8601>",
  "summary": { "total": 0, "passed": 0, "failed": 0, "blocked": 0 },
  "scenarios": [
    { "name": "…", "status": "PASS", "duration_ms": 0, "tags": "@sandbox @real-paper",
      "evidence": "one-line proof — quote what actually rendered", "error": null }
  ],
  "status": "HEALTHY"
}
```
