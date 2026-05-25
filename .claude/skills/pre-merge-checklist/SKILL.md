---
name: pre-merge-checklist
description: Pre-merge defensive checks for recurring, predictable bug classes — run before merging code that (a) emits new interactive button/list/Flow IDs, (b) edits or sends a Flow, (c) writes new enum/status values, (d) chains Supabase update+filter+select, (e) sends to a dormant user, or (f) tracks files toxic to a fresh clone. Each class has a concrete grep/SQL pre-flight and the failure mode it prevents.
---

# Pre-Merge Checklist

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [whatsapp-flows](../whatsapp-flows/SKILL.md), [coaching](../coaching/SKILL.md), [digital-coach](../digital-coach/SKILL.md), [registration](../registration/SKILL.md)

These bugs are not hard — they are **predictable**. Each one has a 30-second pre-flight check. Read the
relevant section, run the verification, fix what it surfaces, then merge.

---

## Class A — Orphan dispatch: a service emits IDs nothing handles

Service code emits an `id` for an interactive button, list row, or template quick-reply. The user taps it.
Nothing happens; the bot logs `⚠️ Unknown button ID` (or similar) and silently no-ops.

WhatsApp delivers user actions through **four separate webhook shapes**, and *each* needs its own handler:

| Webhook shape | Origin | Where to wire |
|---|---|---|
| `interactive` / `button_reply` (`id`) | Free-message button | `whatsapp-bot.js` button_reply branch |
| `interactive` / `list_reply` (`id`) | Free-message list row | `whatsapp-bot.js` list_reply branch |
| `button` (`button.text` / `button.payload`) | Template quick-reply | `whatsapp-bot.js` button (template) branch — match by text |
| `text` (free text) | User typing `A`/`B`/`STOP` instead of tapping | `text-message.handler.js` — intercept **before** the registration gate if the recipient may be unregistered |

**Pre-flight:**

```bash
# 1. Find every interactive ID your new code emits
grep -rEn "id:\s*['\"]?\$?\{?[a-z_]+_" --include="*.js" bot/shared/services/ | grep -i your_prefix
# 2. Confirm each prefix has a dispatcher in the receivers
grep -n "your_prefix" bot/whatsapp-bot.js bot/shared/handlers/text-message.handler.js
```

If a prefix is emitted but absent from the receivers, it's an orphan. **Lock it in with a mock-free
"route-contract" test** that greps the source and asserts the dispatcher exists — service-layer unit tests
mock the receivers and cannot catch this. Full grep patterns + handler stubs:
[reference/dispatch-wiring.md](reference/dispatch-wiring.md).

---

## Class B — WhatsApp Flow gotchas

Covered in full by [whatsapp-flows](../whatsapp-flows/SKILL.md). The pre-merge summary:

- **Edit-then-republish**: editing the Flow JSON does NOT update Meta — re-run the registration script.
- **Forward-only `routing_model`**: any backward route → `INVALID_ROUTING_MODEL` on publish.
- **~10s `data_exchange` timeout**: long work (LLM, uploads) must run async via `setImmediate` after returning SUCCESS.
- **Endpoint health-check blocks publish**: deploy the endpoint *before* publishing (`error_subcode: 4233014` if not).
- **A new Flow ID needs three wiring points**: flow-type-detector + the `nfm_reply` branch + flow-response.handler.

---

## Class C — Database schema surprises

### C.1 — CHECK constraints on enum-like columns

Postgres CHECK constraints silently reject values outside the whitelist (and the Supabase JS chain in
Class D can hide the rejection). Before writing a new value:

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'YOUR_TABLE'::regclass AND contype = 'c';
```

If the new value isn't in the whitelist, ship a migration that expands the constraint **before** the code
that writes it.

### C.2 — Unique indexes that don't match your application WHERE

If a unique index covers `(a, b, c)` but your "look up, insert if missing" check uses `(a, b, d)`, you'll
hit duplicate-key violations on rows your code thinks don't exist.

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'YOUR_TABLE' AND indexdef LIKE '%UNIQUE%';
```

Make the application-level lookup match the indexed columns exactly, or catch the duplicate-key error as a
recovery path.

### C.3 — Inconsistent storage formats

Phone numbers, emails, normalised text — sample the actual stored format before assuming one. A
`.eq('+<countrycode>…')` lookup against rows stored without the leading `+` matches nothing.

```sql
SELECT col, COUNT(*) FROM your_table GROUP BY 1 LIMIT 10;  -- eyeball the real shapes first
```

Full SQL pre-flights + recovery patterns: [reference/db-mutation-safety.md](reference/db-mutation-safety.md).

---

## Class D — The Supabase JS chain hides errors

```js
// ❌ can return {data:null, error:null} even on a constraint rejection
await supabase.from('t').update({status:'x'}).eq('id', x).in('status', [...]).select().single();

// ✅ split: fetch → JS-check → plain update → check error
const { data: row, error: fetchErr } = await supabase.from('t').select('id,status').eq('id', x).single();
if (fetchErr || !row) { /* not-found */ }
if (!['a','b'].includes(row.status)) { /* invalid-state */ }
const { error: updErr } = await supabase.from('t').update({status:'x'}).eq('id', x);
if (updErr) { /* surface the real SQL error */ }
```

**Apply when**: any UPDATE with two or more WHERE conditions beyond `eq('id', ...)`, or an enum-like new value.

---

## Class E — JS short-circuit hides a ReferenceError in untested branches

A multi-arm ternary referencing an undeclared variable only throws when execution *reaches* that arm. If
your tests only exercise the first arm, the broken arm is physically unreachable from your test inputs and
ships silently.

```js
const isUrduLike = lang === 'ur' || lang === 'sd';
// ❌ isSwahili never declared — throws ONLY when isUrduLike is false
const yes = isUrduLike ? '👍 ہاں' : isSwahili ? '👍 Ndiyo' : '👍 Yes';
```

**The habits that catch it:**
1. **Test every branch** of a multi-arm ternary — one case per arm, not just the default.
2. **Enable `no-undef`** in ESLint — catches it deterministically at lint time.
3. **Grep the whole file** when you add a flag — function scope doesn't leak; declare it in every function that uses it.
4. **Treat `.catch()` on `setTimeout`/`Promise` as deliberately silent** — an error logged at `info` there is a silent failure. Surface it loudly.

---

## Class F — Files that work locally but are toxic to a fresh clone

Critical for a repo anyone can clone. A tracked symlink (git mode `120000`) pointing at an operator-local
path (`node_modules`, a local cache) builds fine on your laptop but **breaks every CI build / fresh clone** —
the symlink target doesn't exist there, and the install step aborts.

**Pre-flight:**

```bash
git ls-tree -r HEAD | grep "^120000"        # expect ZERO matches in an app repo
git clone . /tmp/fresh && cd /tmp/fresh && npm ci   # reproduce a clean clone in 30s
```

If there are tracked symlinks, untrack them (`git rm --cached <path>`) and add to `.gitignore`. When
cherry-picking a feature set, don't skip the source branch's `chore: untrack …` cleanup commits — skipping
them surfaces this bug on the target branch.

> **Deploy-verification corollary**: many platforms keep the *previous* deployment serving when a new build
> fails, so `/health` still returns 200 and looks fine. The only reliable "new code is live" signal is the
> process **start time being after your push** plus uptime past the build window — not "a deploy happened".

---

## Class G — Sending to a dormant user needs a template, not free text

WhatsApp rejects free-form messages outside the 24-hour customer-service window (error `131047`). Anywhere
the user did **not** just trigger the message — a reset code, a portal-initiated invite, a cron nudge — you
must send a Meta-approved **AUTHENTICATION** or **UTILITY** template, not `sendMessage`.

**Pre-flight:**

```bash
grep -rn "WhatsAppService\.sendMessage" bot/shared/services/ bot/shared/handlers/ bot/workers/
# For each: "is the user guaranteed to have messaged us in the last 24h?" If not → sendTemplate.
```

Rules: the template must be **APPROVED** on the WABA (and in the right language) before merge; **always
check the boolean return** of the send and surface a real error on `false` — never report success when the
send was rejected; fall back to English with a warning when the user's language has no approved template.

---

## When something goes wrong post-deploy: investigate, don't guess

Pull the logs for the exact reported time window and read the real error — see [debugging](../debugging/SKILL.md)
(and [logging](../logging/SKILL.md) for how the correlation id threads the trace). The bot's own log line is
often generic, but the underlying `err`/`error.message` field usually carries the real Postgres/Meta error
(`violates check constraint "…"`, `duplicate key value violates unique constraint "…"`) that points
straight at the fix. Don't speculate a root cause the logs can settle.

## Reference Files

| File | Contents |
|------|----------|
| [reference/dispatch-wiring.md](reference/dispatch-wiring.md) | Grep patterns + handler-stub examples for each of the four WhatsApp webhook shapes |
| [reference/db-mutation-safety.md](reference/db-mutation-safety.md) | SQL pre-flights for CHECK constraints, unique indexes, inconsistent formats, and the Supabase JS chain |

## Related Skills

- [whatsapp-flows](../whatsapp-flows/SKILL.md) — the full Flow rules behind Class B.
- [registration](../registration/SKILL.md) · [coaching](../coaching/SKILL.md) · [digital-coach](../digital-coach/SKILL.md) — common emitters of new IDs / DB writes.
- [logging](../logging/SKILL.md) — reading the `err` field that carries the real cause.
