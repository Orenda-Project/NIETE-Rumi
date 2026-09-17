# Slice 3 — Core subjects, remaining chapters

**Parent:** [00-program.md](00-program.md) · **Beads:** `bd-l80rt` (boundary
rebuild), `bd-5364e` (Maths CPA), `bd-viysx` (SLO transcription)

The four core subjects are segmented end to end — 1,748 teaching days across 17
books. This slice is not "finish the segmentation." It is **finish the chapters
the segmentation got wrong or got thin**, which the Coverage Map has now named
and counted.

---

## What gets rebuilt and what gets kept

| Subject | Ruling |
|---|---|
| **English G1–5** | Day boundaries rebuilt from page truth |
| **Maths G1–5** | Day boundaries rebuilt from page truth |
| **Urdu G1–5** | **Boundaries kept.** Repair day-integrity fields only |
| **Science G4–5** | **Boundaries kept.** Repair day-integrity fields only |

The split is the operator's, and it is the right one: Urdu and Science
boundaries hold up against the printed book; English and Maths do not. 1,004
flagged days sit in English and Maths (`bd-l80rt`), of which 538 are days whose
every field needs re-deriving.

"Repair day-integrity fields only" means: an Urdu or Science row may gain a
corrected skill type, a corrected SLO role, a page-overlap note or a missing
vocabulary day — but the day it starts and the day it ends do not move.

---

## The four holes, by subject

Each is measured on the Coverage Map, not inferred.

### Maths — the CPA hole (D1, `bd-5364e`)

| | G1 | G2 | G3 | G4 | G5 |
|---|---|---|---|---|---|
| Concrete days | 36 | 6 | **1** | **0** | 33 |
| Abstract days | **0** | **0** | **0** | **0** | **0** |
| Number-fluency days | **0** | **0** | **0** | **0** | **0** |

Grade 4 runs 67% Pictorial→Abstract with no concrete stage at all, which is not
CPA — it is pictorial teaching with an abstract label. The abstract column being
empty across every grade is a taxonomy failure as much as a teaching one: the
segmenter has nowhere to put an abstract day.

This is **open decision D1**. Three things have to be settled together:

1. Where concrete re-enters G3 and G4. Concrete in upper primary is not
   counting bears; it is arrays, area models and partitioning with whatever is
   in the room.
2. Whether "abstract" is a skill type at all, or a *stage* every skill passes
   through. If it is a stage, the taxonomy changes and the conflict count
   changes with it.
3. Where number fluency lives — its own periods, or a routine at the start of
   every Maths period. A routine costs no periods and is the honest answer for a
   40-minute lesson; separate periods cost book time we do have.

**Multiplication is called out by name.** The operator's instruction is that
Maths must be taught easily and correctly, *"especially multiplication"*, by a
teacher who is not a subject specialist. The derive rules already exist and are
proven: the placeholder zero on the tens row is written **first**, carries are
always drawn, one notation for add/subtract/multiply/divide
(`curriculum-baked-lesson-plans/SKILL.md:314`).

### English — communicative language is an empty column

Across all five grades. The books do not carry it and the segmentation did not
invent it. Phonics also thins badly: 1 day in G4, 3 in G5.

This is where the book-shorter-than-timetable spare goes. English at 5
periods/week gives ~140 periods to 24 December against books of 110–127, so
there are 13–30 periods per grade for communicative language and phonics —
anchored to the surrounding chapter, rendered italic, chapter band unbroken.

### Urdu — vocabulary is missing from 29 chapters

Almost all of them Grade 2, which gets **2 الفاظ و معانی days for the whole
year** against 13–17 in the other grades. Urdu boundaries are kept, so this is
repaired in place: existing days gain the vocabulary work, or a spare period
carries it, without moving a single boundary.

### Science — "Engage" missing from 8 of 18 chapters

Nearly half the chapters open without a hook. In a 5E frame the Engage phase is
what makes the rest of the chapter answerable; a chapter that opens on
explanation teaches a conclusion nobody asked for. Repaired in place.

---

## Grade 1 and Grade 2 — the FLN on-ramp (D2)

The operator's finding, which no dataset here contradicts:

> *"more often than not students come in directly to schools in grade one
> [without] prep or ECE centers so grade one needs to scaffold appropriately
> across subjects keeping in mind that children might be missing out on FLN
> basics."*

Two things follow, and one of them is still open.

**Settled:** Grades 1–2 get a slow ramp that escalates later in the year — same
total periods, tilted toward the back. Children cannot cope with a front-loaded
year and teachers teach didactically when pushed. This is a **declared design
assumption**, not a measured finding: the RDF quiz instrument returns 81–85%
mastery in every grade with difficulty flat at 3.0, so it has no grade signal to
give. The assumption is stated in `ramp.py` and on the Teaching Calendar and
stays stated.

**Open (D2):** phonics front-loading. The question put to the operator was
whether phonics is introduced at the beginning for Grade 1 only, or for Grade 1
**and** Grade 2, and it has not been answered. It matters because it changes the
first six weeks of two grades and because G2's Urdu vocabulary hole and G2's
phonics placement are the same six weeks.

Science-of-reading sequencing applies in both languages: the decoding
progression drives the order, and a text a child cannot decode is not a reading
lesson.

---

## SLO normalisation comes first (`bd-viysx`)

Before any of the above can be read as coverage, the SLO transcription has to be
normalised per book. Today G5 English names 168 SLO codes and G3 English 41; G3
Urdu names 94 and G5 Urdu 22. Where a book names more SLOs than the year has
days — G1, G2 and G5 English all sit below 1.0 days per SLO — "never introduced"
counts granularity, not gaps.

Rule, unchanged: **SLOs are never removed**, and every day's SLO must match that
day's activities and objectives. Normalising means agreeing the grain at which
an Explorer's Pathway line becomes one code, then applying it identically to all
17 books. It does not mean deleting codes.

---

## Grade 5 board preparation

Grade 5 has a recalled board exam. It gets Grade-9-style preparation: SLO-based,
sitting in January–March after curriculum content completes in December, built
on the same SLO codes the year taught rather than on a separate revision
syllabus. FDE's assessments are summative and ours are a formative spiral —
board prep is where the spiral is deliberately pulled toward the summative one.

---

## Gates

- **Boundary rebuild is page-evidenced.** Every rebuilt English or Maths day
  names the printed pages it covers, and no printed page is assigned to two days
  without a `Page overlap` note naming the other day.
- **No hole closes silently.** When a chapter gains a vocabulary day or an
  Engage hook, the Coverage Map cell changes from ringed-empty to a count, and
  that is the evidence the repair happened.
- **D1 and D2 are answered before the rebuild runs**, not during it. Rebuilding
  Maths boundaries under an undecided CPA taxonomy means rebuilding twice.
