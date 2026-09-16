---
name: chrome-mcp-whatsapp-e2e
description: 'Drive a real logged-in WhatsApp Web tab via Chrome DevTools MCP to prove user-visible bot behaviour: send triggers, read real replies, click buttons/lists, drive Flow forms. Desktop only. NOT for headless runs (whatsapp-web-e2e), NOT for authoring scenarios (gherkin-test-cases).'
paths:
  - ".claude/qa/**"
  - "tests/features/whatsapp/**"
metadata:
  disclosure: scoped
---

# Chrome-MCP WhatsApp E2E

**Shape, not instance.** This skill is the *method* for driving a logged-in WhatsApp Web tab through the
`chrome-devtools` MCP. It is tenant-agnostic — the bot under test is a variable `<target-number>` for a
`<region>/<tenant>`. Concrete per-tenant test suites live in the **QA e2e tree**, not in this skill:
Gherkin specs at `tests/features/whatsapp/<tenant>/*.feature`, the per-feature executors at
`.claude/qa/agents/niete-<feature>-agent.md` (menu, training, lesson-plan, coaching, registration, status),
config/fixtures under `.claude/qa/`. See [`.claude/qa/README.md`](../../qa/README.md).

**Relationship to `whatsapp-web-e2e`.** That skill picks the driver by environment: **Baileys** (headless-safe,
default) vs the **Chrome DevTools route** (desktop-only fallback). This skill *is* that Chrome route, written up
in full with every technique worked out in practice. Read `whatsapp-web-e2e` first for method selection, the
"defined ≠ live" rule, identities, and proof-to-Notion discipline. Use THIS skill once you've committed to the
browser route.

## Instances

- **NIETE-Rumi (ICT / Islamabad)** — spec [`tests/features/whatsapp/niete/menu.feature`](../../../tests/features/whatsapp/niete/menu.feature),
  suite index [`_suite.md`](../../../tests/features/whatsapp/niete/_suite.md). Default target: staging `923222482222` ("Rumi Staging Niete"); prod `923206281951` only with an explicit go.

---

## 0 — When this route is valid (READ FIRST)

| Precondition | Why |
|---|---|
| **Real desktop Chrome, not headless** | WhatsApp de-links a headless browser ~1s after linking. The Chrome route only works on a genuine paired session (e.g. a Mac with the `chrome-devtools` MCP). On a headless server use Baileys. |
| **A logged-in `web.whatsapp.com` tab** | Scan the QR once; "Stay logged in" persists it. **`navigate_page` to `https://web.whatsapp.com` unconditionally, then judge** — `list_pages` shows which tabs exist, not whether the profile is linked, so a blank or stale tab reads as "no session" when the session is fine (2026-08-28). |
| **Memory headroom ≥ ~1 GB free** | Under memory pressure every CDP call (`take_snapshot`/`screenshot`/`evaluate_script`) hangs. |
| **Explicit go if the target is PROD** | Every message writes to the tenant's prod DB for your number and may start real flows. Get a per-run "go" (root CLAUDE.md Rule 1/7). Prefer a tenant's **staging** surface when it has one (NIETE staging = `923222482222`); reserve prod for cases that must be proven on prod, with a go. |

**Target the right number.** You drive *your own* logged-in WhatsApp; messages go **from your number → the bot's
number**. Confirm `<target-number>` before the first send.

---

## 1 — Setup

**Prerequisite — the Chrome DevTools MCP must be installed.** If `mcp__chrome-devtools__*` tools don't exist in your session, the server isn't loaded. The Rumi repo ships a portable declaration at root **`.mcp.json`** (`chrome-devtools` → `npx -y chrome-devtools-mcp@latest`) — approve it when Claude Code prompts on clone, or add it manually: `claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest` (needs Node.js + desktop Chrome; restart Claude Code to pick up a new `.mcp.json`). For any other repo, add the same server yourself. Only once `list_pages` resolves are you set up.

```
mcp__chrome-devtools__list_pages                      # find/confirm the tab (also the "is the MCP loaded?" check)
mcp__chrome-devtools__navigate_page  url=https://web.whatsapp.com   # ALWAYS — a listed tab can be stale/blank
mcp__chrome-devtools__take_screenshot                 # QR screen? → ask the human to scan. Chats list? → logged in.
```

Open the target chat: `take_snapshot` → find the chat gridcell by name/number → `click` its uid. (Or use the
search box: `fill` the search textbox uid with the digits, then click the result row.)

**Hide the chat-list sidebar so every later snapshot is small** (the left pane is ~1000 lines of noise):

```js
// evaluate_script — run once after opening the chat
() => { let s=document.getElementById('e2e-hide')||Object.assign(document.createElement('style'),{id:'e2e-hide'});
        s.textContent='#side{display:none !important;}'; document.head.appendChild(s); return true; }
```

---

## 2 — Sending a message (the reliable primitives)

WhatsApp's composer is a **Lexical contenteditable** — this breaks the obvious approaches.

> ✅ **Use `wa.sendAndWait(text)` from [`wa-drive.js`](../../qa/shared/wa-drive.js). Do not hand-roll either
> primitive below**. This section used to rank `fill` "most reliable" and paste "flaky", while
> [`whatsapp-interaction-map.md`](../../qa/shared/whatsapp-interaction-map.md) recorded the opposite — `fill`
> "went unreliable (reported success, nothing sent)", paste "the dependable primitive". Both verdicts came from
> the **same 2026-08-21 run**, and both have the **same root cause**: `#main{display:none}` was left hidden by a
> lean Flow snapshot, after which the composer accepts input **silently** and Enter does nothing. The map notes
> this was "briefly misread as a second session driving the same account" — so it has already been
> misdiagnosed twice. Neither primitive is flaky; the hidden pane was.
>
> What is genuinely true of each: **paste appends** (so it must clear first, or you send `/menu/menu`), and
> **`fill` replaces** (so it does not). `wa.send()` handles both — it auto-restores a hidden `#main` and
> reports `healed:true`, then clears the composer before pasting. Reach for the raw forms below only to debug
> `wa.send` itself.

**A. MCP `fill` + `Enter`.** `fill` cleanly *replaces* the composer contents.
```
mcp__chrome-devtools__fill  uid=<composer-uid>  value="/menu"
mcp__chrome-devtools__press_key  key="Enter"
```
- Get `<composer-uid>` once from a snapshot (aria-label starts `"Type a message to <number>"`). **The composer
  element persists across sends**, so the same uid is reusable for the whole run — you do **not** need a fresh
  snapshot per send.
- The **Send button's uid goes stale every send** (it's re-created), so prefer `Enter` over clicking Send.

**B. Paste-event fallback** (when you only have `evaluate_script`, no fresh uid):
```js
() => { const b=document.querySelector('div[contenteditable="true"][aria-label^="Type a message"]');
        b.focus(); const dt=new DataTransfer(); dt.setData('text/plain','/menu');
        b.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
        return b.innerText; }
```
WhatsApp honours synthetic `paste`. **It's flaky** and it **appends** — always clear first (Meta+A, Backspace)
or you get `"/menu/menu"`.

**Does NOT work:** `execCommand('insertText', …)` (Lexical ignores it); setting `.textContent`/`.innerText`
(no input events fire). **Gotcha:** `box.innerText` under-reports Lexical state — a box that *looks* empty
(`"\n"`) can still send stale text. Trust the sent bubble in the transcript, not `innerText`.

---

## 3 — Reading the bot's reply (lean, no giant snapshots)

Scrape the last few message rows with `evaluate_script` — far cheaper than `take_snapshot`:

```js
() => [...document.querySelectorAll('div[role="row"]')].slice(-3).map(r => ({
  txt: (r.innerText||'').trim().slice(0,400),
  btns: [...new Set([...r.querySelectorAll('button, div[role="button"]')]
        .map(b => b.getAttribute('aria-label')||b.innerText).filter(Boolean)
        .filter(t => t.length<40 && !/reaction/i.test(t)))],
})).filter(x => x.txt);
```

- **Wait for slow/LLM replies** with `wa.waitForNew(baseline)` — never a fixed sleep, and never a figure copied
  out of a doc. **Reply latency is a distribution, not a number**, which is why three different "the" figures
  ended up in three places (reconciled here, a tracked issue):

  | Figure | Population it came from |
  |---|---|
  | ~4.0s | an LLM free-text reply, measured live post-run |
  | median 10.3s · mean 11.0s | **all** waits — 34 logged, 2026-08-23 (Flow renders and DB-backed replies included) |
  | 7.8s | R01 registration Flow launch, live 2026-08-25 (`waited 7824ms`) |
  | 1.2s – 75.9s | the observed **range** across that same 34-wait sample |

  None of them contradicts the others; they are different populations. The range is the point: any constant is
  wrong at one end or the other, and the 2026-08-21 run's 9–20s sleeps were wrong at **both** — slow for a 4s
  reply, and short enough to read the wrong message on the 23 of 34 waits that ran longer.
  LP/video/coaching replies take minutes; let those background and read the task notification.
- Verify **what rendered**, not what you typed: bubble order, message type (text vs interactive-list vs audio vs
  file card vs Flow CTA), branding, buttons. Quote the diagnostic markers.

---

## 4 — Interactive elements

| Element | How to drive it |
|---|---|
| **Quick-reply / CTA buttons** (e.g. "View Features", "Just tell me", "Show me!") | Rendered as `div[role="button"]` (NOT `<button>`). A synthetic `.click()` via `evaluate_script` **does** fire them: find by `innerText` and `.click()`. |
| **Interactive-list picker** (e.g. `/language`, `/menu` "View Features") | 1) click the opener button (script `.click()` works). 2) A modal `div[role="dialog"]` opens with `[role="radio"]` rows. 3) Select a row via **MCP `click(uid)`** (needs a snapshot — but the sidebar is hidden so it's small). 4) Send the selection by clicking the dialog's send icon `[data-icon="wds-ic-send-filled"]` (script `.click()` works). |
| **Native WhatsApp Flow forms** (registration, reading setup, training picker, LP "Pick Class") | **Drivable — and as of 2026-08-26 you should NOT be using snapshots for this.** Tapping the CTA opens a **cross-origin iframe** (`flows.whatsapp.net/flows-v2/wa-web/`). The MCP's `evaluate_script` cannot reach into it — it runs in the top-page context — but **CDP can**: the iframe is a **separate CDP target** with its own `webSocketDebuggerUrl`, and attaching to it gives `Runtime.evaluate` + `Input.dispatchMouseEvent` INSIDE the Flow. Use [`flow-drive.js`](../../qa/shared/flow-drive.js). **Measured: 1.62 s per step and ZERO snapshots, against 37–86 s and a 16–24 KB payload for the snapshot route — 23–53x.** Confirmed live on all three control styles: training (radio listbox), Lesson Plans (section buttons), registration (text input + dropdown). That snapshot cost was training's single largest expense: 37.4 of its 93.5 min, and the `t01 took 17 snapshots` hotspot (14.2 min → 27.5 s). The legacy `take_snapshot` + `click(uid)` route below still works and is the fallback. ⚠️ A synthetic `.click()` inside the iframe selects a row visually but React ignores the untrusted event, so the submit stays **disabled** and the step silently does nothing — always real input, always read the submit back. Gotchas: (1) **the Flow "Open" CTA needs a REAL MCP `click(uid)` — a synthetic `.click()` does NOT open the native Flow** (unlike list-dialog openers / quick-reply CTAs, which synthetic click DOES fire); so `take_snapshot` for the CTA uid first. (2) **Two control styles**: a **radio listbox** (training levels) → click the **wrapping button** uid, not the bare `radio` ("did not become interactive"); OR a **dropdown picker** (LP grade/subject/chapter/topic) → click the `button haspopup="menu"` → a `listbox` opens → click the option → it collapses and "Next" enables. (3) the submit enables after selection ("Open level"/"Next"/"Send Lesson Plan") — click it by uid; a stale-disabled read is common, re-snapshot. (4) hide `#main` + `#side` via CSS first so each Flow snapshot is small; on submit the iframe closes and the bot pushes results to chat — restore `#main` and scrape. (5) **a Flow can hand back to chat mid-journey**: e.g. picking a training module closes the Flow and the module + quiz run as **chat** buttons ("📝 Take quiz" → per-question "Answer" → an A/B/C/D options dialog; the check asks ALL questions THEN grades; "🔄 Try again" is a **separate follow-up message**). Server-side gating still applies (a locked option may be selectable client-side but the endpoint rejects it). For endpoint-only checks without the webview, the server-side decryption path in `whatsapp-web-e2e` §8.5 still works. |

---

## 5 — Snapshots vs scripts (cost discipline)

> **Load [`wa-drive.js`](../../qa/shared/wa-drive.js) first and never write a fixed sleep.** The 2026-08-21 `all`
> run (99 scenarios) took **4 hours** largely because it did neither: hardcoded `setTimeout(…, 9000..20000)` per
> read, 146 snapshots, ~14 Flow re-entries. Measured on the live bot afterwards, an LLM free-text reply lands in
> **~4.0s** against the 18s that run slept for it. Use `wa.waitForNew(baseline)` / `wa.waitFor(words|regex)`.
> Full rules + the per-rule cost: the **Speed contract** at the top of
> [`whatsapp-interaction-map.md`](../../qa/shared/whatsapp-interaction-map.md).

- `take_snapshot` returns the **entire** a11y tree and is expensive — with the sidebar hidden it's tolerable, use
  it only when you need a real element **uid** (open a chat, click a list radio).
- Everything else — sending (paste fallback), reading replies, clicking `div[role=button]`, opening dialogs,
  finding the send icon — do with `evaluate_script`.
- **uid namespace resets each `take_snapshot`** (prefixes bump `5_` → `7_` → …), but the MCP keeps live element
  handles, so a persistent element's old uid keeps working until that element is re-created. Composer uid: stable.
  Send-button uid: re-created each send.
- **One `evaluate_script` per `Then`, returning `{pass, actual, expected}`** — collapses
  3 round-trips to 1 AND hands the drift ledger its `expected`/`actual` for free. See
  `.claude/qa/ledgers/README.md` and the executor agents' Step 4.

---

## 6 — Per-test loop & recording

For each test case: **send trigger → wait → scrape reply → compare to expected → mark ✅/❌/🟡**. Keep a running
table (see the instance `_suite.md`). Legend: ✅ pass · ❌ fail · 🟡 handled-but-degraded (graceful "not
available"/"coming soon"). Note the wall-clock time of each bot reply — it's your timestamped proof.

**Harness errors are not bugs.** A dirty composer that sends `/register/register` (→ falls through to the AI
handler) is a *your-tooling* failure — re-send clean before recording a verdict.

## 7 — Files

- `SKILL.md` (this file) — the method.
- `tests/features/whatsapp/<tenant>/*.feature` — Gherkin scenarios (source of truth), tagged `@e2e` etc.
- `.claude/qa/agents/niete-<feature>-agent.md` — per-feature executor: loads `@e2e` scenarios, drives via Chrome MCP, returns JSON.
- `tests/features/whatsapp/<tenant>/_suite.md` — human index + findings + coverage status.
- `.claude/qa/{config,shared,fixtures,results}/` — targets/tags, parser + interaction map, expected values, run outputs. See [`.claude/qa/README.md`](../../qa/README.md).
- `.claude/qa/ledgers/` — durable, git-tracked run/drift/discovery ledgers (Step 4 discovery capture + drift emission write here). See [`.claude/qa/ledgers/README.md`](../../qa/ledgers/README.md).

Related: `whatsapp-web-e2e` (method selection, Baileys route, proof-to-Notion), `notion-board` (posting proof),
`feature-tracer` (grounding "what SHOULD this flow do" in the deployed code before asserting a bug).
