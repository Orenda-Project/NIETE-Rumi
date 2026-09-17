# Slice 2 — The electives push

**Parent:** [00-program.md](00-program.md) · **Existing bead:** `bd-heymg` (owner
Haroon Yasin) — this slice extends it, it does not replace it.

Ten books that a Grade 1–5 teacher is timetabled to teach and that the core
re-segmentation leaves untouched.

**Correction (measured 2026-09-17).** An earlier draft of this slice said these
books had never been segmented. That is wrong. The live ICT workbook
(`1zpRop18…`) already carries three elective tabs, segmented, with day rows,
SLO codes and the same A–F trace columns as core:

| Tab | Grades | Day rows (G1–5) | Columns |
|---|---|---|---|
| General Knowledge | G1, G2, G3 | 96 + 108 + 106 = **310** | 37 |
| Social Studies | G4, G5 | 78 + 88 = **166** | 37 |
| Islamiat | G1–G5 (and G6–G11 on the same tab) | 42 + 58 + 82 + 58 + 61 = **301** | 42 |

So this slice is a **carry-across and rebuild**, not greenfield. The work is to
bring 777 existing G1–5 elective day rows onto the new workbook under the new
row grammar and the new format, and to author the books that genuinely have no
rows yet — not to invent a segmentation from nothing. Before any rebuild,
diff the existing rows against page truth: what is already sound is kept.

---

## The ten books

All ten have page truth in Drive, folder
[`01_page_truth`](https://drive.google.com/drive/folders/1jTv0cs0iBwazqe8hIWGL-QCR3qVF-e9m)
(27 book folders: the 17 core plus these 10), in the same per-page
`pg_NNN.json` format the core books use.

| Book | Drive folder id |
|---|---|
| Grade 1 General Knowledge | `1d6NO6IhCXyEh7AqY-Db2yGU5aZsMdy1Q` |
| Grade 2 General Knowledge | `1UdxRoPDY9D1XQ8cO08EjtDM9eExPLE2l` |
| Grade 3 General Knowledge | `1h5kqH3uaNiBOGhK9bBpPhE40pqwm9KP7` |
| Grade 1 Islamiat | `1QknZt7Y_Gl4rNgO9lkyeW8Hq8GIsBBdv` |
| Grade 2 Islamiat | `1psYw3maJWzsYnIzVdvgNYm9OaopEi8W1` |
| Grade 3 Islamiat | `1Z5cStj8QnEqpY9L7GwpB42j1qB-XPLKC` |
| Grade 4 Islamiat | `109QJgtT9rCAjWKw3RV8PZJwBy5QOLT6O` |
| Grade 5 Islamiat | `16CB0oJqpnF5gUdLQ3bkjmrF8oY-YBCgJ` |
| Grade 4 Social Studies | `1iZKDXSK7DzpCUalQp3zu9aZzXLaiQf7l` |
| Grade 5 Social Studies | `1epRNdnCUJXHtjRXCP5A-DqifsS7lHh9F` |

Plus **Nazra as a parallel track** (`bd-heymg`) — it is not a textbook with
chapters and does not go through chapter segmentation. It runs as its own
progression alongside the timetable.

---

## What makes this slice different from core

Three differences, and all three change the method.

### 1. There is no FDE pacing spine

The local FDE breakdown folder holds 17 `.txt` files — **core only**. No
elective book has an FDE syllabus breakdown, so there is nothing external to
check our pacing against and nothing to answer "is this the right number of
weeks for this chapter?"

**Consequence:** the elective calendar is authored, not reconciled. Every
elective pacing decision is ours and must be labelled as ours on the calendar,
not presented with the same authority as a core row that FDE corroborates.

### 2. Fewer periods, so one LP is one topic

`bd-heymg` assumes **1 LP = 1 topic = 1 weekly period.** The live workbook's own
grade-band headers say otherwise — it allocates **3 periods/week** for General
Knowledge G1–G3, **3/week** for Social Studies G4–G5, **3/week** for Islamiat
G1–G3 and **2/week** for Islamiat G4–G5. The 777 existing day rows are paced on
those allocations, not on one period a week.

**D3a (open).** Either the bead's 1/week is stale and the new calendar inherits
2–3/week from the live workbook, or the timetable really has tightened and the
existing rows need thinning. This is an operator call and it must be settled
before the elective calendar is allocated — it is the difference between ~120
and ~40 elective plans a grade-year.

Either way the *shape* holds: an elective chapter that contains four topics
becomes four plans, and the segmenter must find topic boundaries inside a
chapter rather than chapter boundaries inside a book.

The `seg990` / `seg995` markers go at syllabus breakpoints, as in `bd-heymg`.

### 3. SLOs mostly have to be authored

Core books print an "Explorer's Pathway" opener that names the chapter's SLOs,
and the segmenter transcribes them. Elective books largely do not.

**Rule: extract else author, and tag the difference.** Where the book names an
objective, transcribe it. Where it does not, author one from the topic and stamp
the row `slo_authored`. An authored SLO is never silently mixed with a
transcribed one — a reviewer must be able to see, per row, whose objective it is.
Urdu-medium electives carry Urdu SLOs.

---

## LP Type per segment

Elective segments are typed per methodology v3, at the segment level rather than
the book level, because a single Islamiat chapter can hold a narrative topic, a
memorisation topic and a values-discussion topic, and those are three different
lessons.

**Open decision D3:** does every elective segment get a full four-page plan, or
do some get a lighter topic card? A weekly-period subject may not warrant the
same artefact as a six-period-a-week subject, and building 10 books of full
plans is a materially larger job than building 10 books of cards. The spec does
not decide this; the operator does.

---

## Media reach is thin here, and that is a finding

The video catalogue holds **16 General Knowledge videos, 16 History, 39
Geography and 11 Islamic Studies** against 236 Maths and 207 English. Whatever
mapping process Slice Media runs, the electives will come out mostly unmapped.

Do not paper over it. An elective day with no video says so; it does not get a
loosely-related video promoted to fill the column. See [05-media.md](05-media.md).

---

## Work, in order

1. **Ingest.** Pull the 10 books' page truth from Drive into the local corpus in
   the same shape as the core books. They are not there today.
2. **Topic segmentation.** Topic boundaries inside chapters; one topic per weekly
   period; `seg990`/`seg995` at syllabus breakpoints.
3. **SLOs.** Extract-else-author, `slo_authored` tag, Urdu SLOs where the book is
   Urdu-medium.
4. **LP Type** per segment, methodology v3.
5. **Nazra track** authored separately, not chapter-segmented.
6. **Calendar.** Weekly period per elective, laid onto the same year spine as
   core, labelled as authored pacing with no FDE corroboration.
7. **Coverage check.** The same Coverage Map treatment the core books get, so an
   elective book with a hole is as visible as a core one.

---

## Gates

- **No elective row ships without its `slo_authored` flag set correctly.** A
  reviewer sampling ten rows should be able to tell, without asking, which
  objectives came from the book.
- **The calendar must state the absence of an FDE spine** for these books, in
  the assumptions block, in words a reader who does not know this file will
  understand.
- **Nazra is visibly a parallel track**, not a subject column pretending to have
  chapters.
