# G1–5 Re-segmentation — Design

**Date:** 2026-09-15
**Owner:** Amena Ahmed
**Status:** design, pending review
**Scope:** Grades 1–5 English, Urdu, Maths; Grades 4–5 General Science

Detail lives in four companion files:

| File | Covers |
|---|---|
| [`evidence.md`](2026-09-15-g1-5-resegmentation/evidence.md) | RDF/FICO, the live feedback log, the corpus diagnostic |
| [`segmentation.md`](2026-09-15-g1-5-resegmentation/segmentation.md) | Stage B — day boundaries, SLO integrity, calendar budget |
| [`lp-format.md`](2026-09-15-g1-5-resegmentation/lp-format.md) | The lesson-plan format itself |
| [`sheet.md`](2026-09-15-g1-5-resegmentation/sheet.md) | Sheet architecture, trace columns, review columns |

---

## 1. What we are fixing

The current G1–5 matrix carries 2,038 segments across 1,798 teaching days, and the
day boundaries are not trustworthy:

- **693 days (38%) inherit an SLO** from a neighbouring day rather than owning one.
- **605 days (33%) overlap pages** with the day beside them.
- **324 topics contain `+`** — multi-skill stapling; 51 staple three or more.
- **`duration_min` is a flat 30** (35 for G4 maths/science) on every row. It has
  never been a budget.

Downstream, the plan built from those rows is worth **+2.3 FICO points** over
having no plan at all (63.9 vs 61.6, n=167 ICT recordings). That is the number
this work has to beat.

## 2. The governing principle

> **A lesson plan is not a script for the teacher. It is the instrument that puts
> students to work.**

Every design decision below is downstream of this. The evidence is unambiguous:
the four worst-scoring high-leverage indicators in ICT are all student-side —
Taleemabad tech integration 1.02/4, self & peer assessment 1.53/4, collaborative
learning 2.08/4, student agency & voice 2.14/4 — while the teacher-side indicators
(content accuracy 3.01, academic language 3.45, classroom management 2.98) are
comparatively healthy. We are not failing at telling teachers what to say. We are
failing at getting children to do anything.

Three rules make the principle enforceable rather than decorative:

1. **Every move states what students do.** A move with no student action fails lint.
2. **Teacher-talk-primary time ≤ 10 of 40 minutes.** Printed on the page, checkable.
3. **Every LP names one collaboration structure and one student-choice point**,
   both drawn from a rotation so no chapter repeats itself.

## 3. Scope decisions (settled)

| Decision | Value |
|---|---|
| Subjects | English G1–5, Urdu G1–5, Maths G1–5, General Science G4–5 |
| Out of scope | G1–3 General Knowledge |
| Boundaries rebuilt from page truth | **English, Maths** |
| Boundaries kept, day-integrity fields repaired | **Urdu, Science** |
| SLOs | Never removed. Transcribed verbatim from each chapter's printed *Explorer's Pathway* opener |
| Target sheet | `14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio` — new, not the production matrix |
| Curriculum completion | All content lands on or before **2026-12-24**; Jan–Mar is revision + Grade 5 board prep |
| Assessment stance | FDE assessments are summative; ours are a formative spiral |
| FDE-omitted content | Stays omitted, but is **labelled as a deviation** — never silently deleted |
| Build location | `NIETE-Rumi/curriculum/g1-5-resegment/` |
| Renderer | LP-HTML v8.1 (`curriculum-baked-lesson-plans/scripts/lp_html/`) |

Urdu Chapter 0 (قاعدہ) gets a **read-only decoding-progression check** before the
"keep Urdu boundaries" decision is final. If the progression is unsound, that
comes back to Amena rather than being rebuilt silently.

## 4. Pipeline

The existing 7-stage A→F spine, unchanged:

```
A page-truth → B segmentation → C enrichment → C-gate
  → D0 slide-script → D render → E voicenote → F delivery
```

Each stage writes a content-hashed artefact to R2 and a hyperlink into the sheet's
trace columns. Stage letters are the column labels — see [`sheet.md`](2026-09-15-g1-5-resegmentation/sheet.md).

Stage B is the substance of this build. Stages C–F reuse what exists, with the
format changes in [`lp-format.md`](2026-09-15-g1-5-resegmentation/lp-format.md).

## 5. The 40-minute period

The single largest complaint in the live field log is that lessons do not fit the
period. The fix is a printed spine that sums to 40 and a segmentation rule that
enforces it.

| Block | Min | Moves | Teacher-primary? |
|---|---:|---:|---|
| Warm-up + opening (focus, then provocation) | 5 | 1–2 | partly |
| I Do | 8 | 2–3 | **yes** |
| We Do | 10 | 3–4 | no |
| You Do (3 named tiers) | 12 | 3–4 | no |
| Exit check (one ticket, with self/peer check) | 3 | 1–2 | no |
| transition buffer | 2 | — | — |
| **Total** | **40** | **10–15** | **≤10 min** |

Moves run **10–15** per the extractor spec (`upload-extractor-prompt.js:22`).
Minutes print beside each move.

**A day whose moves sum past 40 is a segmentation defect, not a formatting one.**
It goes back to Stage B and splits. This is the mechanism that fixes "too many
topics in a single lesson" — the same root cause as the Grade 2 Urdu report of
بھاری آواز and ارکان سازی stapled into one plan.

*Known prod constraint:* `MAX_MOVE_SLOTS = 12` in `observe-draft.service.js`, so
moves 13–15 get no coach slot and silently retain the AI's rating. Not a reason to
cut moves; recorded here and adjacent to `bd-z1cc6`.

## 6. Voice note

Spec unchanged — 45–90 s segment, 90–150 s chapter-heart, per
`lp-voicenotes`. Sara's measured pace is 0.42–0.57 s/word; the old
`words × 0.35 + 1` gate is a truncation floor, not a pace model, and must not be
used for budgeting.

**The heart stays.** What changes is that it must be *teaching-relevant*: the note
names the one move that makes the lesson work and the one thing that goes wrong,
drawn from that day's actual moves. Not a restatement of the objective.

For NIETE primary, voicenotes are **not currently live**
(`018_niete_lp_assets_and_downloads.sql:127`); `pakistan-lp-endpoint.js:707` sends
one only if an `.ogg` happens to sit at the PDF's stem path, and `niete_lp_assets`
holds no audio rows. Turning them on is in scope for Stage E.

No WhatsApp delivery message for primary — the voice note carries that job.

## 7. Open items

| # | Item | Resolves by |
|---|---|---|
| O1 | What one page actually holds at 12–15 moves with the progress strip | Rendering one real day and measuring |
| O2 | Voice note: page-carries-script vs audio-carries-emphasis | Two sample renders of the same day |
| O3 | Urdu Chapter 0 decoding progression | Read-only check before boundaries are frozen |
| O4 | Video→SLO mapping confidence threshold | Built during Stage R, reviewed on-sheet |

O1 and O2 are deliberately unresolved. Page-1 sufficiency was proposed and
**withdrawn** — we do not yet know the capacity, and guessing it would set a cap
that the content then has to be trimmed to, which is the failure mode this whole
build exists to end.

## 8. Out of scope

- **Getting the plan into the room.** 63% of observed ICT lessons had no lesson
  plan present. That is a delivery and access problem. Better plans do not fix it,
  and this design does not claim to.
- The DC phase-vocabulary defect — filed separately as **`bd-z1cc6`**.
- G6–12. The matrix, renderer and voicenote pipeline are shared; the content is not.
