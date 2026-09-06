# NIETE (ICT) WhatsApp E2E suite

End-to-end tests that drive the **real** NIETE bot over a logged-in WhatsApp Web session and prove
user-visible behaviour (menus, native Flows, quizzes, PDF generation, voice, coaching). You run them
from **Claude Code** with the `/niete-e2e` command — an agent reads the `.feature` specs here and drives
the bot for you.

> **This is a private repo.** The whole suite (specs **and** runner) is self-contained here — nothing
> lives in the public NIETE-Rumi repo. Real teacher audio + internal notes stay private.

---

## TL;DR

```
1. Have Node.js + desktop Google Chrome installed, and a THROWAWAY WhatsApp number for the driver.
2. Open this repo in Claude Code → approve the `chrome-devtools` MCP when prompted (ships in ./.mcp.json).
3. Open https://web.whatsapp.com in that Chrome and scan the QR with the driver phone (stays logged in).
4. In Claude Code:  /niete-e2e all      ← drives all ~68 scenarios
```

---

## Prerequisites (do these once)

| Need | Why | How |
|---|---|---|
| **Node.js** on PATH | the MCP server runs via `npx` | `node -v` (any recent LTS) |
| **Desktop Google Chrome** | WhatsApp de-links headless browsers — must be real Chrome | install Chrome |
| **Chrome DevTools MCP** | this is what lets the agent drive the browser | **ships in `./.mcp.json`** — approve it when Claude Code prompts, or `claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest`, then restart Claude Code |
| **A throwaway WhatsApp number** | `all` runs destructive tests (registration, quiz progress) — **never a personal number** | link it as the driver (staging default `923028931858`) |
| **Logged-in WhatsApp Web** | the session the agent drives | open `web.whatsapp.com` in Chrome, scan QR on the driver phone (Linked Devices → Link a device); "Stay logged in" persists it |

**What happens if you don't have the MCP:** `/niete-e2e` checks for it first (calls `list_pages`). If the
`chrome-devtools` tools aren't loaded it **stops and tells you to install them** — it will not fake results.
So: approve `.mcp.json` (or `claude mcp add …`) and restart Claude Code, then re-run.

---

## Running

From Claude Code, in this repo:

| Command | What it runs |
|---|---|
| `/niete-e2e` | **SAFE subset** — every `@e2e` scenario except `@destructive` / `@slow` / drafts. Non-mutating. |
| `/niete-e2e <feature>` | one feature: `menu` · `training` · `lesson-plan` · `coaching` · `registration` · `status` · `language` (+ `observe` / `attendance` drafts, by name only) |
| `/niete-e2e all` | **EXHAUSTIVE — every scenario (~68).** Includes `@destructive` + `@slow`. **Throwaway driver only.** |

**Don't know which one you need?** Ask — the selector maps a diff to the affected feature(s):

```bash
python3 .claude/qa/shared/select_e2e.py --repo NIETE-Rumi        # what this branch earns
```

On a **commit (any branch)** or a push to `develop`/`main` this is **automatic**: the run is
armed and the agent is held to it once before the turn can end (`E2E_AUTORUN_OFF=1` to disable,
`E2E_AUTORUN_ALL=1` for the whole suite instead). Other pushes just print the selection,
advisory. Mind which build you are driving — a commit deploys nothing, so a commit-armed run
exercises the PREVIOUS build, and the hook says so. Either way a linked WhatsApp Web session is
still required — the hooks make sure you're asked, they can't scan the QR.
An unmapped file falls back to the SAFE subset *and says so*, so
under-selection is never silent. Map: `.claude/qa/config/feature-map.yaml`. Full detail in
the [`/niete-e2e` command](../../../../.claude/commands/niete-e2e.md#which-features-does-my-change-need--targeted-selection-bd-43512).

**`all` = ~68 scenarios**, per feature: **menu 11 · training 14 · lesson-plan 10 · coaching 3 · registration 10 · status 3 · language 17**. It's the full per-scenario drive, not a "core happy-path" spot-check — the run writes one PASS/FAIL/SKIP line per scenario.

List what a feature will cover before running:
```bash
python3 .claude/qa/shared/parse-gherkin.py tests/features/whatsapp/niete/menu.feature --tag @e2e
```

---

## Hard constraints (read before you trust a run)

- **Desktop-tethered, not a cloud job.** It only runs on a machine with Chrome open + WhatsApp Web linked.
  Asleep / Chrome closed / de-linked → it can't run. It cannot run headless or on a server.
- **Default target is STAGING** `923222482222` ("Rumi Staging Niete") — its own separate DB, so destructive
  writes don't touch prod. Prod (`923206281951`) is explicit opt-in only and needs a "go".
- **Throwaway driver only for `all`.** Destructive scenarios blank the account name / advance quiz progress /
  can trip a 24h grand-quiz cooldown. Never point the driver at a personal number.
- **One run at a time** — a file lock (`.claude/qa/shared/driver_lock.py`) prevents two runs sharing the driver.

---

## Where things live

```
tests/features/whatsapp/niete/*.feature   # the specs (this folder) — source of truth
tests/features/whatsapp/niete/_suite.md    # suite index + durable findings
.claude/commands/niete-e2e.md              # the /niete-e2e command (full procedure)
.claude/qa/agents/niete-<feature>-agent.md # per-feature executor agents
.claude/qa/config/whatsapp-targets.yaml    # targets per env (staging default)
.claude/qa/fixtures/whatsapp/niete/        # answer-keys.yaml + media/ fixtures (audio for coaching/voice)
.claude/qa/shared/                         # parse-gherkin.py, driver_lock.py, interaction map
.claude/qa/results/whatsapp/niete/<run>/   # run.json + evidence per run (gitignored)
.mcp.json                                  # ships the chrome-devtools MCP so a clone can run
```

Method (the reusable "how to drive WhatsApp Web via Chrome MCP") lives in
[`.claude/skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../../../../.claude/skills/chrome-mcp-whatsapp-e2e/SKILL.md).

---

## Known open bugs (so you don't misread results)

These are **expected failures** — the suite flags them on purpose:

| ID | What | Scenario |
|---|---|---|
| **F-ASK1** | "Ask Anything" never returns an AI answer — free-text is captured by the feature router | menu · "Ask Anything answers a teaching question" |
| **F-REG1** | Registration completion drops the teacher's name (+ PK language) | registration · "…drops the teacher's name" (`@known-fail`) |
| **F-LP-PIC** | Photo / pic-to-LP is dropped silently — no reply | lesson-plan · "A photo gets no reply…" (`@known-fail`) |

A `@known-fail` that **passes** means the bug got fixed — update the spec.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `list_pages` "unknown tool" / no `chrome-devtools` | MCP not loaded — approve `./.mcp.json` (or `claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest`) and **restart Claude Code** |
| Screenshot shows the QR "Scan to log in" screen | not linked — scan the QR on the driver phone; don't proceed on a QR screen |
| "driver lock is already held" | another run is in progress; wait, or `python3 .claude/qa/shared/driver_lock.py status --driver <num>` to inspect |
| Overnight run skipped | machine slept — keep it awake + plugged in, lid open, Chrome running |
| Results look like "env drift" | assert against the **running** bot, not `.env.template` — staging ≠ the repo template |
