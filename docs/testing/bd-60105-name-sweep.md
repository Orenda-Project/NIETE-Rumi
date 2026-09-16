# Testing guide — dashboard name sweep (bd-60105)

**What changed:** the NIETE portal showed teacher names wrongly in two ways. Some
screens showed **nothing** where a name belongs; the videos screen showed every
name **twice**.

**Where to test:** https://portal-production-24e6.up.railway.app

> ⚠️ That hostname contains `-production-` **but it is STAGING**, not production.
> Railway's default host for the staging portal is named that way. Production is a
> different Railway project entirely. You are safe to click around here.

**Before you start — confirm you are testing the new code.** If staging has not
finished deploying you will be testing the old build and everything below will
"fail" for the wrong reason.

```
cd NIETE-Rumi && railway status --json | grep -A3 staging
```

The `portal` service must show `status: SUCCESS` against the commit for this
change. If it shows an older commit, wait for the deploy.

---

## The 60-second version

Log in, open **Coaching Sessions**, and look at the teacher name on each row.

| | Before (broken) | After (fixed) |
|---|---|---|
| Teacher with a name | *(blank)* | `Naushaba Taj` |
| Teacher with no name | *(blank)* | `923228531756` |

If you see real names and phone numbers instead of blanks, the main fix works.

---

## Test 1 — Coaching Sessions (the worst one)

**Page:** Observability → Coaching Sessions

**Was:** the teacher name line was **completely empty** on every row. The page
still rendered, the phone number and school were fine — just no name. Easy to miss
if you were not looking for it, which is why it survived this long.

**Now:** every row shows the teacher's name.

**Steps**

1. Open Coaching Sessions.
2. Look at the name heading on each row — the large text above the 📱 phone line.
3. Expect a real name.

**Known-good records on staging data:** `Naushaba Taj`, `Zamurad Bibi` appear in
recent sessions.

**PASS** — every row has either a name or a phone number in the name position.
**FAIL** — any row has a blank where the name should be.

### The important sub-case: nameless teachers

**6,432 of 15,588 users have no name at all** in the database. That is not a bug
in this change — it is a separate, still-open data problem (see *Known gap* at the
bottom).

For those teachers the name position now shows **their phone number**, e.g.
`923228531756`. That is the intended behaviour: a phone number is recognisable,
a blank is not.

**PASS** — nameless teacher shows a phone number.
**FAIL** — nameless teacher shows a blank, the word `null`, or `undefined`.

---

## Test 2 — the doubled name

**Page:** Observability → Videos

**Was:** every teacher's name was printed **twice**, e.g.

```
Munazza Khatoon Munazza Khatoon
```

This was verified against the real production database — it is not hypothetical.

**Now:** `Munazza Khatoon`, once.

> ⚠️ **`video_requests` is EMPTY on the staging database (0 rows).** The Videos
> page will show an empty list, so **you cannot visually confirm this fix on
> staging.** An empty page is *not* a pass — it is "not tested". Do not report
> this one as verified unless video data exists.
>
> If you want to confirm it, the automated test covers it
> (`dashboard/tests/name-column-sweep.service.test.js`, the "must not be repeated
> twice" case), or check it on production after release.

**Good multi-word names for spotting doubling if data appears:**
`Munazza Khatoon`, `Irene Khan`, `Muhammad Waqqas`. A single-word name would hide
the bug — always test with a name that has a space in it.

---

## Test 3 — Users list

**Page:** Observability → Users

Check three things:

1. **Display name** — a real name, or the phone number if the person has none.
   Never blank, never `null`.
2. **Avatar initial** — the circle should carry the first letter of the displayed
   name (`Naushaba Taj` → `N`). A teacher with no name gets the first character of
   their phone number. It should never be an empty circle.
3. **Search** — type part of a teacher's name. They should still be found.

Search is worth a moment: it used to match against three fields, two of which no
longer exist. It now matches name and phone only. Search for `Naushaba` and for a
partial phone number, and confirm both return the person.

**PASS** — names show, initials show, both searches find their teacher.

---

## Test 4 — the quieter screens

Quick look, same rule each time: **a name or a phone number, never a blank.**

| Page | What to look at |
|---|---|
| Video detail | the teacher link near the top |
| Admin → Invitations | the preview list, `phone - name` |
| Attendance marking | the teacher rows, and the header showing who is logged in |
| Schema viewer | the `users` column list — should no longer mention `first_name` / `last_name` |

---

## What this change does NOT fix

**Two out of five teachers have no name in the database** (6,432 of 15,588). They
will show a **phone number** everywhere. That is this change working as intended,
not a defect to re-report.

The real fix for those teachers is a separate data backfill
(`scripts/backfill-names-from-fde.js`) which is still waiting on operator
approval, because it writes across databases into production. About 1,596 of the
nameless are recoverable from the FDE database; the rest have no name recorded
anywhere.

So: **a phone number where a name should be = expected today.** A **blank**, or
the literal text `null` / `undefined`, is a real bug — please report that.

---

## Reporting a failure

Include: the page, the teacher's phone number (so the row can be found), what you
saw, and what you expected. A screenshot of the row is ideal.

Ref: bd-60105 · PR #1021 (staging) · PR #1017 (sandbox, already live)
