# Evidence base

Three independent sources. Where they disagree, the disagreement is recorded
rather than resolved.

---

## 1. RDF / FICO — what classrooms actually look like

`app_settings.rdf_combined_fico_results` on the Rumi Supabase, read 2026-09-15
(feed timestamp `2026-09-15T05:26:37`). 568 scored AI-coach recordings across five
regions; **170 are ICT (Islamabad)**, 166 Urdu-medium, all `artifact = "AI-coach
recording"`, all scored on the 148-mark FICO rubric.

### The distribution barely moves

| Band | ICT lessons |
|---|---:|
| developing | 160 |
| proficient | 9 |
| emerging | 1 |

Overall mean **62.4%**, p25 59.5, median 62.8, p75 65.5. A 6-point interquartile
range across 170 classrooms. Domain means:

| Domain | Mean |
|---|---:|
| student engagement | 68.2 |
| lesson plan fidelity | 62.3 |
| teacher subject knowledge | 61.6 |
| **high-leverage practices** | **59.7** |

### Indicator level — the bottom ten (mean of 4, n=167)

| | Indicator | Mean |
|---|---|---:|
| **C10** | Integration of Taleemabad Technology | **1.02** |
| **F6** | Subject-Specific Pedagogy: SCIENCE | **1.16** |
| **C11** | Self & Peer Assessment Facilitation | **1.53** |
| **F5** | Subject-Specific Pedagogy: MATH | **1.55** |
| **B6** | Differentiation / Catering to Learning Levels | **1.65** |
| **B8** | Use of Prescribed Resources | **1.95** |
| C1 | Quality Questioning (Bloom's aligned) | 2.01 |
| C9 | Collaborative Learning | 2.08 |
| C5 | Student Agency & Voice | 2.14 |
| B7 | Use of Taleemabad Lesson Plan | 2.14 |

For contrast, the top of the table: F2 Use of Academic Language 3.45, B9 Time on
Task 3.28, B3 Activities Alignment 3.14, D1 Active Participation 3.07, F1 Content
Accuracy 3.01, C8 Modeling & Scaffolding 3.01.

**The shape of the failure:** teacher-side indicators are healthy; student-side
indicators are the floor. This is the evidential basis for the governing principle.

### What coaches actually prioritise

90 of the 170 sessions carried a prioritised focus area:

| Indicator | Sessions | Share |
|---|---:|---:|
| **C1 Quality Questioning** | 55 | **61%** |
| **B6 Differentiation** | 22 | **24%** |
| C9 Collaborative Learning | 5 | 6% |
| B10 Closure & Consolidation | 4 | 4% |
| C4, D2, C3, B8 | 1 each | 4% |

Two indicators are 85% of all coaching in ICT.

### Three findings that constrain the design

**(a) The plan is absent more often than it is wrong.** Only **62 of 167** observed
lessons had a lesson plan present (37%). `lesson_plan_link_method`: 100 null, 18
explicit `none`, 44 `selected_recent`, 5 `uploaded`.

**(b) The current plan is worth +2.3 points.**

| Domain | With LP (n=62) | No LP (n=105) | Δ |
|---|---:|---:|---:|
| overall | 63.9 | 61.6 | +2.3 |
| high-leverage practices | 61.3 | 58.7 | +2.6 |
| lesson plan fidelity | 64.0 | 61.4 | +2.6 |
| student engagement | 69.8 | 67.2 | +2.6 |
| teacher subject knowledge | 62.4 | 61.3 | +1.1 |

**(c) Length does not predict quality.** 25 sessions carry a measured
`lesson_plan_word_count`, spanning 23 to 1,869 words (12 of the 25 shown):

```
  23 → 61.5     1045 → 59.5     1355 → 55.4     1611 → 62.2
  55 → 74.3     1302 → 66.9     1407 → 73.6     1723 → 65.5
  95 → 60.1     1320 → 68.2     1509 → 56.8     1869 → 67.6
```

No relationship. The 1,869-word plan outscores the 1,355-word plan by 12 points.
Density and navigability are the levers; page count is not.

### Caveat

Median recording length is **1,198 s (~20 min)**, p90 1,854 s (~31 min). These are
partial captures of a 40-minute period. Treat the scores as a sample of the lesson,
not the whole of it.

---

## 2. The live ICT feedback log — what teachers say

`13xqceMWgyEhQgdHcdOYB9Uiw6SiNDKzjFaBspmgQPZg`, tab `Lesson Plan`. 323 data rows,
**182 in Grades 1–5** (G1 24, G2 20, G3 30, G4 50, G5 58). 280 still `🔴 New`.

Theme tallies across the 182: assessment/exit 14 · textbook/page 14 · wrong
content or answer 9 · time/too long 8 · voice note 7 · activity/resources 5 ·
formatting 4 · language 4 · video 3 · SLO 2 · repetition 2.

Verbatim, on length:

> "There is no sequence in the lesson plan. Lps are sk lengthy and include
> irrelevant information. Make it 1 pager only with proper instructions" — G3
> "It is tooo detailed to implement in 40 min" — G5
> "Bohot detail ha samj hi ni AA rahi lesson ki" — G4
> "Bohot lengthy hai" — G1
> "lesson plans are too lengthy to complete within a 40-minute class and often
> include too many topics in a single lesson" — field staff summary

On voice notes: a request for "a full understanding of prefixes in a voice note"
(G3); "Voice note sentence structure and language is not accurate" (G4).

On segmentation: a G2 Urdu report that بھاری آواز and ارکان سازی were mixed into
one LP so the concept was unclear. A G5 teacher asked for a simplified plan for a
class of 65.

**This is a complaint channel, not a sample.** Good evidence of what is wrong, poor
evidence of how common.

### The tension, stated rather than resolved

The log asks for one page. Amena's decision is teach 2 / total 4. The RDF word-count
finding (1c) says neither number is the operative variable. The design therefore
commits to a *measured* capacity (open item O1) rather than to a page number
asserted in advance.

---

## 3. Corpus diagnostic — what the matrix contains

2,038 segments across 1,798 teaching days.

| Subject | Days | SLO inherited | Page overlap |
|---|---:|---:|---:|
| English | 518 | 114 | 190 |
| Urdu | 646 | 265 | 334 |
| Maths | 503 | 244 | 43 |
| Science | 131 | 70 | 38 |
| **Total** | **1,798** | **693 (38%)** | **605 (33%)** |

- 324 topics contain `+`; 51 staple three or more skills.
- **CPA collapse:** G4 shows 91 abstract / 8 pictorial / **0 concrete**; G5 shows
  1 concrete in 129 days.
- Science 5E ordering is correct in 18/18 chapters.
- Urdu has zero bundled-conjunction SLOs.
- `duration_min` is a flat 30 (35 for G4 maths/science) throughout.

### Calendar budget

144 calendar slots on or before 2026-12-24; **523 spare days** across the in-scope
books. Tightest are Urdu G1 (+2) and Urdu G5 (+4) — neither is being expanded.
Three gazetted holidays fall inside the window and are removed: 1 May, 14 Aug,
25 Aug.

---

## 4. Provenance notes

- The 33 `_voicenote.txt` artefacts in R2 are ICT G6–12. R2 returned **403 on all
  24 fetch attempts** — the `pub-*.r2.dev` bucket is not publicly readable, so
  shipped voicenote length was not measurable from artefacts. Length in
  [`../2026-09-15-g1-5-resegmentation-design.md`](../2026-09-15-g1-5-resegmentation-design.md) §6 comes from the
  `lp-voicenotes` spec and its measured pace, not from the files.
- Corpus licence is `restricted-educational-internal` (NBF/FBISE copyright).
  Page truth, pipeline intermediates and rendered output stay local and untracked.
