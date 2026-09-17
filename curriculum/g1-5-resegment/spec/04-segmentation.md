# Slice 4 — Segmentation

**Parent:** [00-program.md](00-program.md) · **The engine the other three slices
run on. Ships first.**

One row is one teaching day is one segment is one lesson plan. Everything the
programme does downstream — the format, the calendar, the video map, the voice
note — is keyed on that row. If the row is wrong, four artefacts are wrong.

---

## The A→F spine

Seven stages, each with a review gate, each with a trace column in the workbook
(previous sheet's English tab, columns **AE–AN**):

| Stage | Does | Artefact |
|---|---|---|
| **A** | Page truth — one JSON per printed page, straight from the book | `pg_NNN.json` |
| **B** | Segment — page truth becomes teaching days | segment records |
| **C** | Enrich — SLOs, skill type, CPA phase, Bloom's, duration | enriched segments |
| **C-gate** | Review — does the day hold together? | verdict |
| **D0** | Fidelity moves — the prescribed-action list | `<lesson>.moves.json` |
| **D** | Slide script / lesson body | `lp_doc` JSON |
| **E** | Render | LP-HTML v8.1 → PDF |
| **J-ped / J-des** | Pedagogy review · design review | verdicts in the sheet |
| **F** | Deliver | plan + voice note to the teacher |

`lp_doc` JSON is the **artefact of record**. The PDF is a rendering of it, not
the thing itself. A defect is filed against `lp_doc`.

---

## The segment record

Eighteen fields, as they exist in the corpus today:

```
segment_index · day_label · chapter_number · chapter_title · topic
skill_type · cpa_phase · section · pages_printed · pages_pdf
slo_codes · slo_descriptions · blooms · duration_min
new_or_revision · prev_segment_id · next_segment_id · notes
```

Language subjects carry five further columns — **Function · Interaction · Gap ·
Strand · Recycles** — with **Unit Task** on the chapter-header row. Those five
are what make a language row a communicative-language row rather than a
comprehension row with a different label.

---

## Row grammar

Scripts match the grammar. **No script may reference a row by number.** The
workbook is rebuilt on every run and rows move.

```
^GRADE \d+          grade band header
^Chapter \d+:       chapter header row (carries Unit Task for languages)
^Day \d+            a teaching day
↻ Spiral Review     a spiral-review day
📋 Ch. Review       a chapter review / assessment tail
```

---

## Day rules

**One day = one SLO focus.** Supporting SLOs may ride along; the primary SLO is
the one the day is named for and the one the exit ticket checks.

**SLO role model.** Each SLO has exactly one *introducing* day. Every later day
on the same code reads *develops*. This is what makes "never introduced" a
meaningful question — and why `bd-viysx` has to be settled before the column can
be read (see [03-core-remaining.md](03-core-remaining.md)).

**Page-overlap model.** Printed pages are never reassigned. Where two days both
legitimately claim a page — a poem taught across two days, an exercise set split
— both keep it and each names the other in a `Page overlap` column. A page that
silently belongs to one day is a page the second teacher will not know to open.

**New or revision.** Every day is one or the other and says which. Our model is
a formative spiral: revision is scheduled, not left to the end.

**Duration.** Every day carries a minute budget, and it has to land inside 40
minutes. See [01-format.md](01-format.md).

---

## Skill type, and where CPA sits

The operator's question — *"ideally, skill type should include CPA, no?"* — is
resolved yes: **CPA is Maths' skill type**, not a parallel axis. Every subject
has a skill-type taxonomy; in Maths that taxonomy is Concrete / Pictorial /
Abstract plus the subject-specific types (word problem, number fluency). Colour
codes are inherited from the original sheet so a reader who learnt the palette
once does not relearn it.

Bookkeeping types — revision, assessment, review_assess, and Urdu's دہرائی and
جائزہ — are excluded from the coverage mix. Counting them made 13% of the Urdu
year look like a skill.

---

## What the books actually contain — one correction

**No Urdu book in the corpus has a Chapter 0 قاعدہ.** Grade 1 Urdu opens at
Chapter 1 (حمد – میرا خُدا) and the decoding work is embedded: `arkaan_saazi`
appears as a skill type on Day 3 of Chapter 1, teaching the half-forms of
letters inside the chapter's own text rather than in a separate primer.

This matters for Slice 3's phonics question (D2). The decoding progression in
Urdu is *already* distributed through the chapters; front-loading phonics means
deciding whether to concentrate it, not whether to add it.

---

## The calendar and the allocator

The Teaching Calendar counts **periods, not days** — a subject's presence in a
week is how many periods it holds, not one chip per school day. Allocation is
conservative: core 5–6 periods/week, Science 3–4.

**Ideal and factual budgets are collapsed into one.** They existed to express
"whole book" versus "what FDE schedules." FDE schedules every chapter, so the
two numbers were always identical and the split was removed from `fdetab.py` and
from `caltab.assumption_block()`.

**Stretch and ramp.** The books are shorter than the timetable, so the book
stretches evenly across the year rather than finishing early and leaving a hole.
The Grades 1–2 ramp then tilts that same total toward the back of the year —
same periods, later weight. The ramp is a declared design assumption; the RDF
quiz instrument has no grade signal to support or refute it.

**Book anchoring.** A basics period — phonics, arkaan saazi, communicative
language, number fluency — **inherits the chapter number of the periods around
it** and renders italic rather than as its own coloured block. The chapter band
stays continuous, so a teacher scanning the calendar never sees the book stop.
This is the answer to *"the teachers will get angry if the out of textbook takes
too much content"*: nothing leaves the book; the basics sit inside it.

The calendar follows the Calendar of Activities spine. Keys are drawn
explicitly — an unlabelled colour block is not a key.

**Known defect:** the spine currently teaches on 5 gazetted public holidays
(`bd-0wtl0`), inherited from the previous workbook. The Grades 6–12 module
`08_Grades 6-12 LP Build/matrix/holidays.py` is the authority and has not yet
been cross-checked against the restored spine.

---

## The workbook

One sheet, eleven tabs, first tab is navigation.

| Tab | Holds |
|---|---|
| Navigation | How to read the workbook |
| Teaching Calendar | The year, in periods, with keys |
| FDE Syllabus | FDE's pacing against ours, per book |
| English · Urdu · Maths · Science | The segment rows |
| Coverage Map | Mix bars, chapter heat grid, gap list, SLO coverage |
| All Segments + SLOs | The flat join |
| Skill Taxonomy | The palette and its definitions |
| Pipeline Stages | The A→F spine and what each trace column means |

Current state: English 659 rows, Urdu 739, Maths 703, Science 187, Coverage Map
497, Teaching Calendar 109 × 206.

---

## Gates

- **Stage B2 rebuild is not merged until the flagged count falls.** 1,004 flagged
  days today (`bd-l80rt`); the gate is the number, not the effort.
- **Every stage writes its trace.** A stage with no design writes "design
  pending" — never a proxy.
- **Sheets discipline:** rich-text links, never `=HYPERLINK()`; a paragraph in a
  cell must be merged across its block or WRAP stacks it one word per line;
  always `unmergeCells` the grid before a rebuild.
- **Verification is visual.** No Sheets work is called done until it has been
  exported and looked at — `scratchpad/shot.py` runs the authenticated
  export→PNG loop for any tab and range.
