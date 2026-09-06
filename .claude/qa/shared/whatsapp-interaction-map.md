# WhatsApp Web interaction map (Chrome-MCP)

The `data-cy` equivalent for WhatsApp Web — there are no test ids, so drive by
role/aria + the techniques below. Full rationale in
[`../../skills/chrome-mcp-whatsapp-e2e/SKILL.md`](../../skills/chrome-mcp-whatsapp-e2e/SKILL.md).

> **Non-determinism (every feature):** the bot's output is largely non-deterministic
> (LLM free-text, model scores, seeded/shuffled quiz sets, generated PDFs/images, async
> pipelines, state-dependent lists). When executing a scenario, **honor**
> [`non-determinism-contract.md`](non-determinism-contract.md): assert the CONTRACT
> (heading/CTA present · template with placeholders · count SHAPE `<done>/<total>·<pct>%`
> · served==min(bank,cap) · artifact delivered · one-of-a-kind invariants), never volatile
> content. **`@content-driven`** steps are resolved LIVE — read the prompt + options and
> pick by TEXT against the semantic answer key (substring), never by position; a forced-wrong
> picks any option NOT matching the correct key. `@copy` is the exception (fixed strings only).

## Speed contract — read before your first send

The 2026-08-21 `all` run took **4 hours** for 99 scenarios. Most of that was avoidable, and the
three rules below are where it went. They are not style preferences; each one is a measured cost.

> **These rules are now MEASURED AND GATED — they used to be prose, and prose decayed.**
> `run_efficiency.py` reads the run dir and fails it on cost, exactly as `validate-run.py` fails it
> on coverage. What it caught on the runs already on disk:
> `20260821-0632` → 8 problems · `20260823-1606` → 2 · `20260824-1004` → 3 (T01 alone burned **17**
> snapshots re-walking the training Flow). Two days after this contract was written,
> `20260825-1040/run.json` still recorded `"wa_drive_loaded": false`.
>
> ```bash
> # start of run — one command for all of §1 Setup
> python3 .claude/qa/shared/preflight.py <run-id> --mode all --driver <your digits>
> # after wa-drive returns "wa-drive ready: ..."
> python3 .claude/qa/shared/preflight.py <run-dir> --mark-wa-drive-loaded
> # end of run — dump __wa.waitLog() to <run-dir>/waits.jsonl, then
> python3 .claude/qa/shared/preflight.py <run-dir> --finish
> ```
>
> **`waits.jsonl` is the proof of adaptive waiting** — nothing else on disk distinguishes a poll
> that returned in 3s from a constant that slept 9s, so its ABSENCE is treated as hand-rolled
> sleeps. Every `wa.waitForNew` / `wa.waitFor` / `wa.sendAndWait` records itself; `__wa.stats()`
> summarises. The cost gate never changes a run's PASS/FAIL verdict — a run that found real bugs
> publishes even if it was slow — but it prints on every scheduled fire.
>
> Why cost is not cosmetic here: the LaunchAgent fires every 2h and a full run takes ~3h15m, so
> **roughly every other fire is skipped** (SCHEDULE.md guard 1). Minutes saved are scheduled runs
> gained.

1. **Load [`wa-drive.js`](wa-drive.js) once, first, and drive through it.** That run never loaded
   it and hand-rolled inline `setTimeout(…, 9000..20000)` for every read instead.
   **You should no longer have to:** `preflight.py` injects it over CDP at run start
   ([`inject-wa-drive.js`](inject-wa-drive.js)) — because step 6 of all NINE agents already said
   to load it and 2026-08-25 still recorded `"wa_drive_loaded": false`. **Check, don't assume:**
   `typeof window.__wa` — a page reload drops it, and then you re-inject:
   `node .claude/qa/shared/inject-wa-drive.js --run-dir <run-dir>`. **Never write a
   fixed sleep.** Use `wa.waitForNew(baseline)` (no marker words needed — the common case) or
   `wa.waitFor(words|regex)` when you know the marker. Both return `waitedMs`, so a slow surface
   shows up as data instead of hiding inside a constant.
   *Measured on 2026-08-23, 34 logged waits: mean **11.0s**, median 10.3s, range 1.2–75.9s.* That is
   ~4 min saved against a flat 18s across those waits, and **slower** than a flat 9s — but a flat 9s
   is simply wrong here: 23 of 34 replies took longer, and two exceeded every fixed sleep the old
   code used, so the old approach bought its speed by reading the wrong message. Scaled across a
   full run the wait saving is roughly **10–25 min**, not the "≈30 minutes of dead air" first
   estimated from worst-case arithmetic. The larger measured wins were snapshot discipline
   (146 → 80 snapshots, 2.5 MB → 0.7 MB) and test design (one coaching pipeline covering four
   scenarios instead of one each).
2. **Don't re-enter a Flow you are already inside.** Same run: **~14 re-entries** into the training
   Flow (`/training` → Open → program → level → picker), ~60–90s and ~5 snapshots each. See
   *Stay inside the Flow* below.
3. **Snapshot only for the Flow iframe.** That run took **146 snapshots (2.2 MB, ~292 tool calls)**
   resolving element ids. Everything on the main page — chat buttons, list dialogs, the composer —
   is reachable from `evaluate_script`, so `wa.tap()` / `wa.pickListRow()` need **zero** snapshots.
   Only the cross-origin `flows.whatsapp.net` iframe genuinely requires `take_snapshot` + `click(uid)`.

| Action | How (Chrome-MCP) |
|--------|------------------|
| **Open bot chat** | `fill` the search box with the target digits → `click` the result row → confirm header. |
| **Lean snapshots** | inject `#side{display:none}` once (and `#main{display:none}` while inside a Flow iframe). |
| **Send text** | `wa.send(text)` → returns `{ok, baseline}`; then `press_key("Enter")` (Enter needs a real key event). Keep the `baseline` and pass it to `wa.waitForNew(baseline)`. Raw form: focus `div[contenteditable="true"][aria-label^="Type a message"]`, synthetic `paste` (clear first — it appends), then Enter. ⚠️ **Neither raw primitive is the answer** (reconciled a tracked issue): `fill` "reported success, nothing sent" late in the 2026-08-21 run, and the `chrome-mcp-whatsapp-e2e` SKILL called paste "flaky" — **same run, same root cause**, `#main{display:none}` left hidden (see the trap below). Paste appends, `fill` replaces; `wa.send()` clears first AND auto-restores a hidden `#main` (`healed:true`), so it is safe where both raw forms are not. |
| **Wait for the reply** | `wa.waitForNew(baseline)` — polls every 600ms, returns the moment a new **inbound** row lands. Never a fixed sleep. `wa.waitFor(words\|regex)` when you know the marker. MCP backgrounds an `evaluate_script` past ~120s, so keep `timeoutMs` under that for a foreground result; for coaching's ~9-min steps just let it background and read the task notification. |
| **Read reply** | `wa.readLast(n)` → `[{txt, mine, btns}]`. Batch — never N calls. Outbound rows are detected by their delivery-receipt icon / `message-out`, not by the bot's phone number: in GENERAL_CONVERSATION (Ask Anything) rows the number is absent, so a phone-match returns null (verified 2026-08-04). |
| **Tap quick-reply / CTA** | `wa.tap(label)` — synthetic click, no snapshot. It picks the **newest enabled** match: spent CTAs stay in the transcript with `aria-disabled="true"`, and tapping one is a silent no-op that looks like a product hang. |
| **Open list dialog** | `.click()` the opener button → `div[role="dialog"]` with `[role="radio"]` rows. |
| **Select list row** | `take_snapshot` → MCP `click(<uid of the option's wrapping button>)` (bare radio uid may be "not interactive") → send via `evaluate_script` clicking `[data-icon="wds-ic-send-filled"]`. |
| **Drive native Flow** | **Use [`flow-drive.js`](flow-drive.js) — not snapshots.** The iframe is a **separate CDP target**; attach to it and `Runtime.evaluate` + `Input.dispatchMouseEvent` work inside the Flow. **1.62 s/step, 0 snapshots** vs 37–86 s and 16–24 KB for the snapshot route. Confirmed on training, LP and registration. Synthetic clicks are ignored by React — real input only, and read the submit back. `take_snapshot` + `click(uid)` remains the fallback (block below). |

> ⚠️ **The Attach menu is transient — and it needs a REAL MCP click.** A synthetic `.click()` from
> `evaluate_script` does not open it (same rule as a native Flow CTA). And once open it closes on the
> next unrelated call, so `click(Attach)` → `take_snapshot` → `upload_file` must run with **nothing in
> between**; slip one call in and the upload fails with "Element … no longer exists". Verified
> repeatedly on 2026-08-23.

| **Upload media (audio/doc)** | Open the **Attach** (📎) menu → `take_snapshot` for the item uids → `upload_file(<uid>, <abs path>)`. **Use the "Document" item, NOT "Audio"** — verified 2026-08-04: `upload_file` on the "Audio" menuitem sets the file but produces NO send-preview (silent fail, twice), while "Document" reliably shows the caption preview + send button. Then click the media send `[data-icon="wds-ic-send-filled"]`. A 25 MB `.m4a` sent as a Document is still received by the bot as audio (it reads the duration and offers "Yes, Analyze"). |

Gotchas: composer `innerText` under-reports Lexical state (trust the sent bubble); bot replies arrive from an
`@lid` JID; the Send-button uid is recreated each send (prefer Enter); a locked list option may be selectable
client-side but the server rejects it. WhatsApp Web trims a message's leading/trailing whitespace before sending.

> ⚠️ **The `#main{display:none}` trap.** `leanCSS(true)` hides the chat pane for lean Flow snapshots. Leave it
> hidden and the composer keeps accepting `paste` events **silently** — the text piles up (`"/menu/menu"`),
> Enter does nothing, and the chat looks like the bot has gone quiet. This cost ~10 minutes on 2026-08-21 and
> was briefly misread as a second session driving the same account. `wa.send()`/`wa.tap()` now auto-restore
> and report `healed:true`; call `wa.restore()` yourself after any `leanCSS(true)` snapshot.

## Driving a native WhatsApp Flow (verified on Teacher Training, 2026-08-04)

The Flow is a cross-origin iframe (`flows.whatsapp.net/flows-v2/wa-web/`). `evaluate_script` **cannot** read
or click inside it; only `take_snapshot` (which surfaces the iframe controls with uids) + MCP `click` work.

1. **Open the Flow.** The chat "Open" CTA needs a **real MCP `click(<uid>)`** — a synthetic `.click()` from
   `evaluate_script` does NOT open the native Flow (unlike an in-page list dialog). So `take_snapshot` first to
   get the "Open" button uid, then MCP-click it.
2. **Lean snapshots.** Once the Flow overlay is up, inject `#main{display:none}` (top-frame `evaluate_script`
   still works on the top document) so snapshots drop the chat history and show ~20 lines of Flow controls
   instead of the whole scrollback. Remove the style before reading chat replies again.
3. **Select + submit, per screen.** Each Flow screen is a `form` with a `listbox` of `button > radio` options
   and a footer submit ("Open program", "Open level", …) that is `disabled` until a selection. MCP-`click` the
   **wrapping button** (not the bare radio — "did not become interactive"); the radio flips `checked` and the
   submit enables; then MCP-`click` the submit. Teacher Training chain: Choose a program → Levels ladder →
   open a level → (module video + "Take quiz" arrive as **chat** quick-reply buttons, not Flow controls).
4. **Locked rows are still selectable.** A `🔒 Locked` level row can be selected and enables its submit
   client-side; the **server** rejects it on submit (returns an errorScreen / chat message). Assert the server
   message, not the disabled state.
5. **After a submit, the Flow may close** and the bot posts the result to chat — un-hide `#main` and read the
   last row.

### Stay inside the Flow — don't re-enter it per scenario

Re-entering costs a send + `/training` reply wait + Open + program + level ≈ **60–90s and ~5 snapshots**, and
the 2026-08-21 run did it ~14 times in training alone. The Flow has its own **`Back`** button in the nav bar:
use it to move *between screens within one session* instead of cancelling out to chat and starting over.

- One Flow session can serve the whole read-only cluster: **levels ladder → level detail → module picker**,
  plus the `🔒 Locked` level / locked-module / locked-exam negatives. Assert, `Back`, assert the next one.
- Only re-enter when a step **closes the Flow by design** — picking a module (hands off to a chat quiz),
  submitting a locked row (server replies in chat), or completing a Pick-Class drill-down.
- After a `Back`, **re-snapshot**: uids are per-snapshot and the previous screen's are stale. The *page-level*
  composer uid stays stable across the whole session; Flow-iframe uids never do.
- Grep the fresh snapshot for **every uid the next 2–3 steps need in one pass** (`grep -nE 'Open program|Open
  level|Pick a module'`) rather than one grep per click — that halves the snapshot→grep round-trips, which
  were ~292 tool calls last run.
- The Flow can reopen on the screen you left it on (observed on the LP picker) — snapshot before assuming
  you are back at the top, and `Back` up as needed.

**Two Flow control styles.** Training uses a **radio listbox** (select the wrapping button → submit enables).
The Lesson-Plans "Pick Class" Flow uses **dropdown pickers** (verified 2026-08-04): each screen has a
`button "<Label>"` with `haspopup="menu"` → MCP-click it to open a `listbox` of options → MCP-click the option
→ the dropdown collapses back onto the screen and "Next" enables → MCP-click "Next". Screens:
`Class/Grade (static Grade 1..10) → Subject → Chapter → Topic`; the last submit is **"Send Lesson Plan"**, after
which the Flow closes and the bot delivers a **pre-generated PDF from R2** to chat ("Sending your lesson plan:
… " → a PDF document, in seconds — NOT slow generation).

**Flow TEXT inputs** (e.g. registration Full Name / School Name, verified 2026-08-04): MCP `fill(uid,…)` sets the
DOM `.value` (a snapshot shows it) but may NOT register in the Flow's framework state → the field can submit
empty. Prefer: MCP `click(uid)` to focus the field, then `type_text("…")` (real key events) — a "Clear input"
chip appearing next to the field confirms the value registered. (Even so, if the final greeting is still empty,
suspect a PRODUCT bug in the completion payload, not the input method — see registration F-REG1.)

**Module quizzes leave the Flow and run in chat** (verified 2026-08-04): open Level 0 → level-detail shows the
grand-quiz status + "Pick a module to watch"; picking the ▶ Next-up module closes the Flow and dispatches the
video + a "📝 Take quiz" chat button. Then: tap **📝 Take quiz** (chat button; note it carries
`aria-disabled="false"` — filter on `!== 'true'`, don't reject the presence of the attr) → each **Q_n/3** arrives
as a message with an **"Answer"** button → tapping it opens an **A/B/C/D options list dialog** (same select-radio-
via-wrapping-button + `[data-icon="wds-ic-send-filled"]` send pattern). The check asks **ALL** questions THEN
grades (100% required) → "Module check — passed/not quite … N/3". The **"🔄 Try again"** retry button is a
**separate follow-up message** ("Ready to try the module check again?"), NOT on the result message.
