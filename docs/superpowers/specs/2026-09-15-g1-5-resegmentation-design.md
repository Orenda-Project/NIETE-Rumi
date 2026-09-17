# G1–5 Re-segmentation — Design

**Date:** 2026-09-15
**Owner:** Amena Ahmed
**Status:** design, pending review
**Scope:** Grades 1–5 English, Urdu, Maths; Grades 4–5 General Science

| File | Covers |
|---|---|
| [`evidence.md`](2026-09-15-g1-5-resegmentation/evidence.md) | RDF/FICO, the live feedback log, the corpus diagnostic |
| [`segmentation.md`](2026-09-15-g1-5-resegmentation/segmentation.md) | Stage B — day boundaries, SLO integrity, calendar budget |
| [`lp-format.md`](2026-09-15-g1-5-resegmentation/lp-format.md) | The lesson-plan format |
| [`sheet.md`](2026-09-15-g1-5-resegmentation/sheet.md) | Sheet architecture, trace columns, review columns |

---

## 1. Problem

The current G1–5 matrix carries 2,038 segments across 1,798 teaching days.

- **693 days (38%) inherit an SLO** from a neighbouring day rather than owning one.
- **605 days (33%) overlap pages** with the day beside them.
- **324 topics contain `+`** — multi-skill stapling; 51 staple three or more.
- **`duration_min` is a flat 30** (35 for G4 maths/science) on every row.

A lesson taught with the resulting plan scores **+2.3 FICO points** over one taught
with no plan (63.9 vs 61.6, n=167 ICT recordings). See [`evidence.md`](2026-09-15-g1-5-resegmentation/evidence.md) §1.

## 2. Governing principle

> **A lesson plan is not a script for the teacher. It is the instrument that puts
> students to work.**

In ICT the four lowest-scoring high-leverage indicators are all student-side —
tech integration 1.02/4, self & peer assessment 1.53/4, collaborative learning
2.08/4, student agency 2.14/4 — against healthy teacher-side scores (content
accuracy 3.01, academic language 3.45, classroom management 2.98).

Three rules make the principle enforceable:

1. **Every move states what students do.** A move with no student action fails lint.
2. **Teacher-talk-primary time ≤10 of 40 minutes**, printed on the page.
3. **Every LP names one collaboration structure and one student-choice point**,
   both on a rotation that cannot repeat within a chapter.

In English and Urdu this is measured, not asserted: the matrix's `Interaction` and
`Gap` columns feed a **Communicative Balance** tab that counts periods tagged
Speaking/Listening against periods whose `Interaction` is actually pair or group.
That gap is the count of periods the plan turned into deskwork.

## 3. Scope

| Decision | Value |
|---|---|
| Subjects | English G1–5, Urdu G1–5, Maths G1–5, General Science G4–5 |
| Out of scope | G1–3 General Knowledge |
| Boundaries rebuilt from page truth | English, Maths |
| Boundaries kept, day-integrity fields repaired | Urdu, Science |
| SLOs | Never removed. Transcribed verbatim from each chapter's printed *Explorer's Pathway* opener |
| Target sheet | `14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio` — new, not the production matrix |
| Curriculum completion | All content on or before **2026-12-24**; Jan–Mar is revision + Grade 5 board prep |
| Assessment stance | FDE assessments are summative; ours are a formative spiral |
| FDE-omitted content | Stays omitted, labelled as a deviation |
| Build location | `NIETE-Rumi/curriculum/g1-5-resegment/` |
| Renderer | LP-HTML v8.1 (`curriculum-baked-lesson-plans/scripts/lp_html/`) |
| Sheet recipe | `curriculum-baked-lesson-plans/reference/curriculum-matrix-sheet.md` — binding |

Urdu Chapter 0 (قاعدہ) gets a read-only decoding-progression check before the
"keep Urdu boundaries" decision is final. An unsound progression escalates rather
than triggering a silent rebuild.

## 4. Pipeline

```
A page-truth → B segmentation → C enrichment → C-gate
  → D0 slide-script → D render → E voicenote → F delivery
```

Each stage writes a content-hashed artefact to R2 and a hyperlink into the sheet's
trace columns, labelled by stage letter — see [`sheet.md`](2026-09-15-g1-5-resegmentation/sheet.md) §3.

Stage B is the substance of this build. Stages C–F reuse the existing pipeline with
the format changes in [`lp-format.md`](2026-09-15-g1-5-resegmentation/lp-format.md).

## 5. The 40-minute period

| Block | Min | Moves | Teacher-primary |
|---|---:|---:|---|
| Warm-up + opening (focus, then provocation) | 5 | 1–2 | partly |
| I Do | 8 | 2–3 | yes |
| We Do | 10 | 3–4 | no |
| You Do (3 named tiers) | 12 | 3–4 | no |
| Exit check (one ticket, with self/peer check) | 3 | 1–2 | no |
| transition buffer | 2 | — | — |
| **Total** | **40** | **10–15** | **≤10 min** |

Moves run 10–15 per `upload-extractor-prompt.js:22`. Minutes print beside each move.

**A day whose moves sum past 40 splits at Stage B.** Over-length is a segmentation
defect, not a formatting one, and is never resolved by trimming the plan.

`MAX_MOVE_SLOTS = 12` in `observe-draft.service.js` means moves 13–15 receive no
coach slot and retain the AI's rating unreviewed. Constraint on the DC form, not on
the plan.

## 6. Voice note

Spec unchanged: 45–90 s segment, 90–150 s chapter-heart, per `lp-voicenotes`.
Sara's measured pace is 0.42–0.57 s/word; the `words × 0.35 + 1` formula is a
truncation floor and must not be used for budgeting.

The heart is retained and must be teaching-relevant: it names the one move that
makes the lesson work and the one thing that goes wrong, both drawn from that day's
move set.

Voicenotes are not currently live for NIETE primary
(`018_niete_lp_assets_and_downloads.sql:127`); `pakistan-lp-endpoint.js:707` sends
one only if an `.ogg` sits at the PDF's stem path, and `niete_lp_assets` holds no
audio rows. Enabling them is in scope for Stage E.

No WhatsApp delivery message for primary.

## 7. Open items

| # | Item | Resolves by |
|---|---|---|
| O1 | Page capacity at 10–15 moves with the progress strip | Rendering one real day and measuring |
| O2 | Voice note: page-carries-script vs audio-carries-emphasis | Two sample renders of the same day |
| O3 | Urdu Chapter 0 decoding progression | Read-only check before boundaries are frozen |
| O4 | Video→SLO mapping confidence threshold | Built at Stage R, reviewed on-sheet |

O1 is resolved by measurement, not by asserting a page count in advance.

## 8. Out of scope

- **Getting the plan into the room.** 63% of observed ICT lessons had no lesson
  plan present. This is a delivery and access problem; this design does not address it.
- The DC phase-vocabulary defect — tracked as `bd-z1cc6`.
- G6–12. The matrix, renderer and voicenote pipeline are shared; the content is not.
