# Hashir vs Data Analyst vs RDF vs portal, per level group (bd-tsa15l, queue #322)

Read 27 Nov 2026. Data Analyst = Taleemabad Data server `teacher_headcount` by `teacher_level` (rules v0.42.8, at-a-school base,
the analytics population of dimensions 1e), run through `query_metric`. RDF = live roster, `rdf_niete/live_roster.py` (ICT v45,
25 Nov). Portal = Trainings tab on prod, read-only REST, with the fix in PR #6132. Per-group portal counts are from
`users.teacher_level` over the same canonical teachers; the section counts are by programme membership, which is what the tab uses.
The operator's ~4,000 was an estimate and is not part of this comparison.

## Per level group

| Group | Hashir | Data Analyst (at a school) | RDF | Portal (by teacher_level) |
|---|---|---|---|---|
| Primary only | 2,602 | **2,602** | - (primary total 3,253) | 2,603 |
| Middle/High only | ~2,980 | 2,977 | - | 2,977 |
| Cross-level (Primary + Middle/High) | ~650 | 648 | - | 648 |
| No level recorded | 126 | **126** | - | 126 |
| **All** | ~6,358 | 6,353 | 6,360 (all bands, 25 Nov) | 6,354 |

## Per section

| Section | Hashir | Data Analyst (primary only + cross, / mh only + cross) | RDF | Portal tab, by programme (after fix) | Portal tab, before |
|---|---|---|---|---|---|
| Primary | ~3,250 | **3,250** (2,602 + 648) | 3,253 | 3,239 | 6,154 |
| Middle/High | ~3,600 | 3,625 (2,977 + 648) | not on the ICT brief (Grades 6-12 brief) | 3,628 | 4,546 |

## Verdict: Hashir and the Analyst agree

Primary-only and no-level are identical to the head; the other lines are within 3 teachers (his are rounded). The Analyst's wider
headcount (no school required) is larger and is where the ~6,000 / ~4,000 impressions can come from: primary-only 4,095,
middle/high-only 3,434, both 746, not recorded 818, total 9,093 (2,391+ without a school recorded, mostly handsets and unverified
contacts). The Analyst itself says analytics use the at-a-school subset (1e).

## Where the small gaps come from (findings, not guesses)

1. Portal tab vs band count, Primary: 3,239 by programme vs 3,250 by band, 11-12 teachers. Cause: 14 teachers with PRIMARY in
   `teacher_level` hold no `niete_primary` assignment (so the tab omits them and they see no training), and 4 PRIMARY-only teachers
   hold both programmes. A band-derived section would match Hashir to the teacher.
2. Portal vs band, Middle/High: 3,628 vs 3,625: 3 more from the same assignment mismatches (the 4 PRIMARY-only teachers with
   `niete_middle_high`).
3. RDF 3,253 vs Analyst 3,250: the RDF counts role teacher at programme schools in the six sectors with PRIMARY in the level on
   25 Nov; the Analyst's run is 2 days later. Within 3.
4. Before the fix the tab counted every programme member (principals 488, coaches, unregistered, 285 test accounts, and 2,497 members
   with no school). That was the ~6,000.
5. Level data: 126 at-a-school teachers have no `teacher_level` and no programme; they appear in no tab and see no training.
   The Analyst and Hashir both report them separately.

## Not built

No change was made to training assignment rules or the dashboard cards beyond the population fix (PR #6132). Open items for the
operator are in `docs/hashir-vs-today-bd-tsa15l.md` §5.
