# ✅ Attendance

![Attendance](../images/features/attendance.jpg)

> Daily attendance without paper or a separate app — a quick tap-through on WhatsApp.

## What it is

Lightweight class attendance. A teacher sets up their class list once, then marks who's present each day through a native WhatsApp Flow (a tap-based form). Over time it becomes a simple, queryable attendance record.

## How it works

1. **Classes are managed separately**, via the class manager (`/class`). Attendance reads rosters; it never creates or edits them.
2. **A teacher says "attendance"** and Rumi opens one Flow that walks the whole task:
   `CLASS → DATE → METHOD → MARK → LEAVE → CONFIRM → SAVED`.
3. **Marking is by exception.** The teacher taps who is *absent*, then — on a second
   screen showing only the students not already marked absent — who is *on leave*.
   Everyone untapped is present.
4. **Re-marking a day replaces it.** The confirm screen names the earlier tallies and
   the time they were saved before it overwrites them.
5. **Records accumulate** for later review and reporting.

Membership is read from the enrollment tables, falling back to the legacy per-teacher
roster for classes an enrollment backfill has not reached.

## What the teacher experiences

A fast daily check-in: open the form, tap down the list, done — no separate login, no paper register to carry.

## Known gap: classes larger than 20 students

**A class with more than 20 students is not yet markable, and the failure mode is
undocumented.** Treat 20 as the working ceiling until this is fixed.

WhatsApp Flows caps a `CheckboxGroup` at **20 options**. The marking endpoint passes
the whole roster into `data-source` with no cap, on **two** screens — `MARK` (the full
roster) and `LEAVE` (the roster minus whoever was marked absent).

Meta documents the 20 as a design-time limit but does **not** specify what happens when
an endpoint sends more at runtime. Both outcomes are plausible and they differ sharply:

| If Meta… | Result |
|---|---|
| rejects the response | the screen fails to render — the teacher is stuck, but no wrong data is stored |
| silently drops the extras | **students past the 20th never appear** — and because marking is by exception, they are recorded **present** without anyone seeing them |

The second is the dangerous one: an absent child marked present, invisibly. Which one
actually happens has not been observed on a real handset, so nothing here should be
assumed.

### Intended fix

Pagination, 20 per page, with the default made explicit rather than silent:

- `Footer` advances (*Next*) until the final page
- the page label carries roll ranges (*"Page 2 of 3 · rolls 21–40"*), since the roster
  is ordered by roll number
- submitting before the last page routes to an explicit confirmation — *"38 students not
  reviewed — mark all present?"* — so nobody is defaulted to present unseen

Pagination also makes in-flight state load-bearing. Selections currently live in a
process-local `Map` in the endpoint, which does not survive a restart and is not shared
across replicas. One screen tolerates that; several pages of accumulated taps do not, so
this needs a shared store (Redis) keyed by `flow_token` before the pages can be trusted.

## Enable it

_Always on_ — core. The marking Flow is registered to your WhatsApp Business Account
during setup (`register-all-flows`); its ID lands in `ATTENDANCE_MARKING_FLOW_ID`. Class
management is a separate Flow (`CLASS_MANAGER_FLOW_ID`).

## Customize

Adjust the roster fields or marking flow — see the [attendance flow JSON](../flows/) and the [Agent Customization Guide](../agent-customization.md).
