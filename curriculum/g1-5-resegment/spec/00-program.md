# Grades 1–5 curriculum rebuild — the programme

**Status:** spec, not yet approved · **Written:** 2026-09-16 · **Owner:** Amena Ahmed
**Build code:** `NIETE-Rumi/curriculum/g1-5-resegment/` · **Workbook:**
[Reworked Grades 1-5 ICT Curriculum Matrix](https://docs.google.com/spreadsheets/d/14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio)

---

## The big idea

A Grade 1–5 teacher in an ICT school opens her phone between 9am and 1pm, reads
the day's plan, and teaches it in forty minutes. Today that plan is four dense
pages she did not have time to read, built on a segmentation that nobody has
checked against the printed book since it was written, covering four of the
seven books she is timetabled to teach, with a video link she has no reason to
trust and a voice note that tells her how the chapter feels rather than what to
do at 9:05.

This programme fixes those four things at once, because they are one thing. The
plan is only readable if the day is the right size; the day is only the right
size if the segmentation is rebuilt from the page; the segmentation is only
complete if all seven books are in it; and none of it lands unless the media
that reaches her phone points at the same SLO the plan does.

**Four slices, plus the media that runs through all of them:**

| # | Slice | What it delivers | File |
|---|---|---|---|
| 1 | **Format** | What one lesson plan looks like: 4-page cap, 2-page Teach, 10–15 colour-and-text-coded moves, one exit ticket, answers everywhere, VTRs, SVG diagrams, visual chapter strip | [01-format.md](01-format.md) |
| 2 | **Electives push** | The 10 books nobody has segmented: GK G1–3, Islamiat G1–5, Social Studies G4–5, with Nazra as a parallel track | [02-electives.md](02-electives.md) |
| 3 | **Core remaining chapters push** | Finishing the four core subjects: English + Maths boundary rebuild, the Maths CPA hole, the Urdu vocabulary hole, SLO normalisation | [03-core-remaining.md](03-core-remaining.md) |
| 4 | **Segmentation** | The engine underneath all three: row grammar, day rules, page-overlap model, SLO role model, the review gate | [04-segmentation.md](04-segmentation.md) |
| — | **Media** | Video→SLO mapping from the 915-video catalogue, and the voice note that carries the moves | [05-media.md](05-media.md) |
| — | **LP production** | The authoring law for the HTML profile: section registry, the measured per-surface word budget, and why "reduce the script" is a Stage-C rule and not a renderer one | [07-lp-production.md](07-lp-production.md) |

---

## Why this order

The user's instruction is *"first spec, i want to see the segmentation and then
we see how samples are being generated."* So the order of **reading** is the
table above — format first, because it is what everyone has an opinion about —
but the order of **building** is the reverse, and the spec says so plainly:

```
   4. Segmentation engine  ──┬──►  3. Core remaining     ──┐
                             │                             ├──►  1. Format  ──►  samples
                             └──►  2. Electives push    ──┘
                                            │
                                   — . Media runs alongside both,
                                       keyed on SLO, not on day
```

Nothing in Format can be sampled until a day exists to sample. Nothing in Media
can be mapped until an SLO has a day to attach to. So the engine ships first,
the two content pushes run against it in parallel, and Format is the last thing
locked — which is also the right order for the argument, because a page cap is
only arguable once you know how much a real day actually contains.

**Slices 2 and 3 are genuinely parallel.** They share the engine and share
nothing else: different books, different corpora, different pacing authority.
Electives have page truth but no FDE breakdown; core has both.

---

## What is already true

These are measured, not assumed. Each is verifiable in the workbook today.

- **The corpus is segmented for the four core subjects.** 1,748 teaching days,
  290 chapter tails, 894 SLO-introducing days across English G1–5, Urdu G1–5,
  Maths G1–5, Science G4–5.
- **FDE omits nothing.** 233 chapters across all 17 core books; the FDE
  syllabus breakdown schedules every one. Verified 16 Sep 2026 and recorded on
  the Calendar — assumptions tab. *An earlier version of this programme was built on the
  premise that FDE drops chapters and that the dropped chapters give us room.
  That premise was wrong and is retracted.*
- **The room is still real, for a different reason.** The books are shorter than
  the timetable. English at 5 periods/week gives 140 periods to 24 December
  against books of ~110–127; Maths at 6/week gives 169 against 118–143; Science
  at 3/week gives 87 against 83–84. That spare is entirely basics — phonics,
  arkaan saazi, communicative language, number fluency — anchored to the
  surrounding chapter so the chapter band never breaks.
- **The coverage holes are named and counted.** Maths concrete phase is 0 days
  in G4 and 1 in G3, abstract 0 in every grade, number fluency 0 in every grade
  (`bd-5364e`). English communicative language is an empty ringed column across
  all five grades. Urdu الفاظ و معانی is missing from 29 chapters, nearly all
  G2. Science "Engage" is missing from 8 of 18 chapters. 94 thin chapters out of
  233.
- **The video catalogue exists and already carries SLOs.** 915 videos with
  transcript-derived, evidence-quoted SLOs — Maths 236, English 207, Science
  201, Urdu 189, Geography 39, GK 16, History 16, Islamic Studies 11.
- **The voice-note spec is locked and is not being reopened.** V20 segment brief
  and chapter-heart v4, `.claude/skills/lp-voicenotes/`.

## What is not true yet

Stated as holes, not papered over.

- **The SLO column cannot be read as coverage yet.** Transcription is uneven
  between books — G5 English names 168 SLO codes against G3 English's 41; G3
  Urdu 94 against G5 Urdu's 22. Where a book names more SLOs than the year has
  days, "never introduced" is a granularity artefact (`bd-viysx`).
- **1,004 day boundaries in English and Maths are flagged and unrebuilt**
  (`bd-l80rt`).
- **Nothing has been rendered.** No Grade 1–5 lesson plan exists in the new
  format. The 4-page cap, the 2-page Teach and the 10–15 moves are all
  *specified* and none is *sampled*. See O1 below.
- **The elective books are not ingested locally.** Page truth is in Drive; the
  local corpus holds core only.
- **The G1–2 slow ramp is a design assumption, not a finding.** The RDF quiz
  instrument returns 81–85% mastery in every grade with `avg_difficulty` flat at
  3.0 — a ceiling measure with no grade signal. The ramp is declared as an
  assumption in `ramp.py` and on the Teaching Calendar, and stays declared until
  a better instrument exists.
- **The calendar teaches on 5 gazetted public holidays** (`bd-0wtl0`), inherited
  from the previous workbook's date spine.

---

## Decisions already taken

Recorded here so no slice relitigates them.

| Decision | Ruling |
|---|---|
| Science scope | Grades 4–5 General Science only. G1–3 General Knowledge returns as an elective, not as core. |
| Which boundaries get rebuilt | English G1–5 and Maths G1–5 rebuilt from page truth. **Urdu G1–5 and Science G4–5 boundaries are kept** — repair day-integrity fields only. |
| Which workbook | The new one (`14-ndk94…`). The production sheet is not touched. First tab is navigation. |
| SLOs | Never removed. Every day's SLO must match that day's activities and objectives. |
| Where the year ends | Curriculum content finishes by December 2026. January–March is revision plus Grade 5 board prep. |
| Grade 5 | Gets Grade-9-style board preparation for the recalled Grade 5 board exam, SLO-based. |
| FDE's role | FDE assessment is summative. Ours is a formative spiral. They are not in competition. |
| Periods per week | Core 5–6, Science 3–4. Allocated conservatively — better than the previous sheet, not idealised. |
| Out-of-textbook content | Anchored. A basics period inherits the chapter number of the periods around it, renders italic, and never breaks the chapter band. The textbook stays the spine. |
| Delivery message | Primary does not get one. A voice note goes instead. |

## Decisions still open

These block specific slices and are named in them.

| # | Question | Blocks | Bead |
|---|---|---|---|
| D1 | Maths: how do we restore concrete and abstract, and where does number fluency live? | Slice 3 | `bd-5364e` |
| D2 | Is phonics front-loaded for Grade 1 only, or Grade 1 **and** Grade 2? And what is the Grade 1 FLN on-ramp, given children arrive with no ECE? | Slices 3, 4 | — |
| D3 | Which elective books get a full LP and which get a lighter topic card? | Slice 2 | `bd-heymg` |
| D3a | Electives: 1 period/week (`bd-heymg`) or the 2–3/week the live workbook actually allocates? | Slice 2 | `bd-q95dh` |
| D4 | Chapter-heart voice notes run 90–150s; the cap is 120s. Cap the render or leave primary on segment notes only? | Media | — |

---

## The gates

No slice is "done" on assertion. Each has a gate that produces an artefact
somebody can look at.

- **O1 — page capacity is sampled, not asserted.** Render one real Maths day and
  one real Urdu day at 10 moves and at 15 moves, with the chapter progress strip,
  and measure what fits. Until O1 returns a number, "4 pages, 2 of them Teach"
  is a proposal.
- **O2 — the voice-note split is sampled.** One segment note and one
  chapter-heart note for the same chapter, timed, scanner-passed.
- **Pedagogy review and design review** are columns in the workbook, as they were
  in the original. A row is not shipped until both carry a verdict.
- **Trace columns** follow the previous sheet's English tab, columns AE–AN: one
  column per pipeline stage (A, B, C, C-gate, D0, D, E, J-ped, J-des, F).

---

## Working rules that bind every slice

- **Nothing is hardcoded to a row number.** Scripts match the row grammar
  (`^GRADE \d+`, `^Chapter \d+:`, `^Day \d+`, `↻ Spiral Review`, `📋 Ch. Review`).
- **Dark stages stay dark.** A stage with no design gets the words "design
  pending" in its trace column, never a proxy value.
- **Over cap fails; it never trims.** A renderer that silently drops a move to
  fit the page is worse than one that refuses.
- **The corpus is `restricted-educational-internal`.** NBF/FBISE copyright. Page
  truth, pipeline intermediates and rendered output stay local and untracked.
- **Every file stays under 300 lines.** This spec is split for that reason, not
  for tidiness.

---

## Beads

| Bead | What |
|---|---|
| `bd-vby7e` | Slice 4 — segmentation engine |
| `bd-9mnih` | Slice 3 — core remaining chapters |
| `bd-6640j` | Slice 2 — electives push (extends `bd-heymg`) |
| `bd-60gpr` | Slice 1 — format |
| `bd-03cav` | Gate O1 — page capacity sample |
| `bd-5k4cs` | Gate O2 — voice-note split sample |
| `bd-pn8wn` | Video catalogue is unreadable by the build service account |
| `bd-l80rt` | Stage B2 — 1,004 flagged English/Maths days |
| `bd-5364e` | Maths concrete phase empties out by Grade 4 |
| `bd-viysx` | SLO transcription uneven between books |
| `bd-0wtl0` | Calendar teaches on 5 gazetted public holidays |
| `bd-heymg` | NBF wave 2 Stage B — the 10 elective books (owner Haroon Yasin) |
| `bd-q95dh` | D3a — elective period allocation, 1/wk vs 2–3/wk |
