# Role-based menu for DC and HITL — design

**Status** approved, in build · **Date** 2026-09-15 · **Branch** off `sandbox`
**Source** DC review sheet row 122 (Saaim, 14 Sep) — teacher Asifa Ayub
**Investigation** `06_Logs & Misc/Investigations/workspace/niete/coaching/leader-role-blocks-own-dc/`

---

## 1. Problem

The main menu offers every user the same four rows. Two of its features are
role-shaped and it says so nowhere:

* **DC** (Classroom Coaching) — coach *me* on *my* lesson.
* **HITL** (`/observe`) — I am observing *someone else's* lesson.

A `role='principal'` user (459 on NIETE prod) taps **Classroom Coaching**, is told
*"send your classroom recording, 15+ minutes"*, sends it — and
`observe-audio-router.routeLeaderAudio` intercepts it on `role` alone and answers
with the HITL binding list, *"Whose observation is this?"*. Her recording is
parked in Redis and never analysed.

Regression dated exactly: `88ae87fc` (2026-08-24, bd-tju8f). 65 leader-owned
self-DC sessions exist since 1 Aug, **all** ≥900s, **all** stopping on 2026-08-24.
Zero since. 544 users affected (459 principal + 85 coach).

## 2. Scope

**In:**
1. The main menu's DC and HITL rows are chosen by role.
2. The tap handler enforces the same rule (a row hidden today is still tappable
   from scrollback tomorrow).
3. `routeLeaderAudio` honours a declared DC intent, so the DC row a principal
   now sees actually works.

**Explicitly OUT** (operator, 2026-09-15): no change to the DC flow, no change to
the HITL flow. Principals get HITL exactly as coaches have it today, add/remove
school included. No patch-resolver change, no school derivation from
`users.school_id`, no self-exclusion from the roster. Those were considered and
dropped as architectural.

## 3. The contract

| `users.role` | DC row | HITL row |
|---|---|---|
| `teacher` | ✅ | ❌ |
| `principal` | ✅ | ✅ |
| `coach` | ❌ | ✅ |
| `school_leader`, `supervisor`, `aeo` | ❌ | ✅ |
| unknown / null / unregistered | ✅ | ❌ |

Two rules behind the table:

* **Leader roles named explicitly.** `school_leader`/`supervisor`/`aeo` are in
  `observe-gate.LEADER_ROLES`. Left to the default they would get DC and no
  HITL — backwards. Zero such users on NIETE today; the entry is a landmine
  guard, not a feature.
* **Unknown defaults to DC only.** Never grant HITL by accident, never take DC
  from the ~14.4k teachers because a role string was unexpected.

Implemented as a **pure synchronous map**, not via `authz/capability.js`: that
module is DB-backed and fail-closed, so a lookup blip would strip DC from every
teacher, and on the audio hot path a "deny" means the recording parks. This
decision is deliberate and is recorded here so it is not "fixed" later.

## 4. Changes

### 4.1 `bot/shared/config/role-features.js` (new)

Pure, no IO, no requires.

```js
canSelfCoach(user) -> boolean   // may use DC
canObserve(user)   -> boolean   // may use HITL
```

`canObserve` is the menu's view of eligibility only; `/observe` keeps its own
authority (`evaluateObserveTrigger` still returns `deny_role`), so the two can
never disagree in a way that grants access.

### 4.2 Menu rows — `whatsapp.service.js:2083 sendFeatureMenuListFallback`

Takes a role/user argument. Builds the DC row when `canSelfCoach`, the HITL row
(`id: 'menu_observe'`) when `canObserve` **and** `OBSERVE_MEWAKA_FLOW_ID` is
set — presence-based gating, per the NIETE architecture rule. Training, Lesson
Plans and Ask Anything are unchanged for everyone.

`sendMenu(from, userId, sessionId, language)` gains a trailing optional `user`.
All 5 call sites already hold it (`voice-message.handler.js:1106`,
`text-message.handler.js:660/1926/2634/2654`). Omitted → today's rows, so no
caller can silently lose the menu. Shared service: grep consumers + smoke test
(root CLAUDE.md Rule 10); `services/__mocks__/whatsapp.service.js` updated.

### 4.3 Tap handler — `menu.service.js:129 handleMenuButtonResponse`

Already receives the full `user`. `case 'menu_coaching'` requires `canSelfCoach`,
new `case 'menu_observe'` requires `canObserve`; a disallowed tap gets one honest
line in her language, never the feature. This is what makes 4.2 real rather than
cosmetic — WhatsApp list rows live in scrollback forever.

`menu_observe` delegates to `handleObserveCommand(user, from, '/observe')` — the
existing door, unchanged, so onboarding / pending debriefs / the visit picker /
add-remove-school all behave exactly as they do for a coach today.

### 4.4 Router intent — `observe-audio-router.js:76 routeLeaderAudio`

One branch, placed **after** the two armed-state checks and **immediately before**
`park()`:

```js
if (canSelfCoach(user) && hasDeclaredDcIntent(user)) return false;
if (looksLikeClassroom) { await park(); return true; }
```

`hasDeclaredDcIntent` reads `user.conversation_state` — written by
`_handleClassroomCoachingChoice`, already on the object (`getOrCreateUser` does
`select('*')`), so zero extra IO — requiring `flow === 'coaching'`,
`step === 'AWAITING_CLASSROOM_AUDIO'`, and an unexpired
`conversation_state_expires_at`.

**Why that placement is the safety argument:** teachers returned `false` two lines
above; coaches fail `canSelfCoach`; a principal mid-`/observe` is caught by the
armed-state branches, which are the more specific declaration; and a principal
with no declared intent still parks. The bd-tju8f invariant — *an undeclared
school-leader classroom recording never starts teacher coaching* — is preserved
exactly. The change is additive to the one branch that is currently wrong.

Covers all four call sites: `voice-message.handler.js:78` and
`whatsapp-bot.js:2471/2498/2549` all funnel through this function.

## 5. Tests (red first — root CLAUDE.md Rule 6)

`bot/tests/observe/` and `bot/tests/menu/`:

**Role map** — the full table above, including unknown/null.

**Menu rows** — teacher: DC, no HITL · coach: HITL, no DC · principal: both ·
HITL row absent when `OBSERVE_MEWAKA_FLOW_ID` is unset · `sendMenu` without a
user still renders today's rows.

**Tap handler** — coach tapping a scrollback `menu_coaching` is refused and
`_handleClassroomCoachingChoice` is NOT called · teacher tapping `menu_observe`
is refused · principal passes both.

**Router** *(the row-122 regression test — must fail on `sandbox` today)* —
principal + `AWAITING_CLASSROOM_AUDIO` + 1200s → returns `false`, `parkAndAsk`
NOT called · principal, no intent, 1200s → still parks · principal, expired
intent → still parks · principal with `awaiting_audio` observe state + DC intent
→ observe capture wins · **coach + DC intent + 1200s → still parks** · teacher
untouched.

Baseline gate: `npm test` (delta vs `tests/baseline.snapshot.json`; the snapshot
may only shrink). Filtered runs via `npm run test:raw -- <args> --forceExit`.

## 6. Accepted gaps

Named, not fixed, so they are not mistaken for oversights:

* **The 6h TTL becomes load-bearing for principals.** Tap DC at 09:00, send at
  16:30 → intent expired → parked. Today a teacher's expiry costs nothing.
  Mitigation deferred: a *"this is my own lesson"* row on the binding list would
  make every state-loss path recoverable, since the recording is already parked.
* **`observe_bind_not_obs` still discards the recording**
  (`observe-binding.service.js:154`) — tapping "Not an observation" drops it
  rather than handing it to DC.
* **`/menu` mid-flow clears the DC intent** (correct behaviour; compounds the
  TTL gap).
* Row 122's recording is not recoverable — its 6h park TTL expired on 14 Sep.

## 7. Porting note

NIETE-only by construction: separate repo, Railway project, WhatsApp numbers and
database. `hyasin270/whatsapp-ai-bot` (PK/TZ/YE) shares the role gate but has
**no `looksLikeClassroom` and no `park()`** — bd-tju8f was never ported — so its
principals still fall through to DC and are unaffected.

**If the binding wall is ever ported to the main bot, this fix must go with it**,
or the bug travels. That repo's `LEADER_ROLES` also carries `cluster_coordinator`,
which must be added to the role map at that time.
