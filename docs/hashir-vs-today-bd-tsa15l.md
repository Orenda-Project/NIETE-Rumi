# Hashir's numbers and training rules vs today (bd-tsa15l, queue #322)

Source: Hashir Hussain, Slack DM 27 Nov 13:25, copied verbatim to `docs/hashir-1325-bd-tsa15l.txt`. Prod read-only, 27 Nov.
Two totals are reported side by side, not reconciled: Hashir's section totals (~3,250 / ~3,600; ~6,358 teachers) and the
operator's "close to 4,000".

## 1. Counts

| | Hashir | Today (after the fix) | Before the fix |
|---|---|---|---|
| Primary only | 2,602 | 2,585 | - |
| Middle/High only (no Primary) | ~2,980 | 2,974 (476 M, 1,111 H, 1,387 M+H) | - |
| Across Primary + Middle/High | ~650 | 646 (350 P+M, 123 P+H, 173 P+M+H) | - |
| No level recorded | 126 | 126 | - |
| **Primary section** | ~3,250 | **3,239** (RDF live roster 3,253) | 6,154 |
| **Middle/High section** | ~3,600 | **3,628** | 4,546 |
| All ICT teachers | ~6,358 | 6,354 canonical (RDF 6,360) | - |

All within 0.5% of Hashir's. The ~4,000 figure sits between the two sections and equals neither; no filter on the portal data
produces it (Primary 3,239 + the no-programme rows is ~3,255, M/H 3,628). If 4,000 means a different cut (e.g. Primary plus
cross-level, or active teachers only) it needs the operator's definition.

## 2. His seven level combinations vs today's logic

Today: PRIMARY -> niete_primary (NIETE 0-3); MIDDLE or HIGH -> niete_middle_high (NIETE 2-3, GBTLA, AI-Powered Subject
Pedagogy, TDP with the Grades 9-12 gate: HIGH or earned work).

| Combination | Hashir | Today on the portal | Match |
|---|---|---|---|
| Primary only (2,585) | NIETE 0-3 | NIETE 0-3 | yes |
| Primary + Middle (350) | NIETE 0-3, GBTLA, AI-Powered | NIETE 0-3, GBTLA, AI-Powered | yes |
| Primary + Middle + High (173) | NIETE 0-3, GBTLA, AI-Powered, TDP | same | yes |
| Primary + High (123) | NIETE 0-3, TDP | NIETE 0-3, TDP **plus GBTLA and AI-Powered** | **no: two extra** |
| Middle + High (1,387) | NIETE 2-3, GBTLA, AI-Powered, TDP | same | yes |
| Middle only (476) | NIETE 2-3, GBTLA, AI-Powered | same | yes |
| High only (1,111) | TDP only | NIETE 2-3, GBTLA, AI-Powered, TDP | **no: three extra** |

Cause: assignments are per programme, not per band combination. High-only holds niete_middle_high, which carries NIETE 2-3,
Oxbridge and Beaconhouse; P+H holds both programmes, so it also gets Oxbridge and Beaconhouse.

## 3. Dashboard vs his list

The dashboard shows two sections by programme membership: Primary = niete_primary members (NIETE 0-3); Mid/High =
niete_middle_high members, with NIETE 2-3, GBTLA, AI-Powered and TDP each over the whole section.
- Section totals match his.
- Per-card denominators do not follow his combinations: GBTLA/AI-Powered include High-only and P+H teachers (should not); NIETE 2-3
  on the Mid/High tab includes High-only (should not); TDP now follows the HIGH gate (fixed in this PR).

## 4. His two status rules

| Rule | Today | Match |
|---|---|---|
| AI-Powered Subject Pedagogy = Completed if any one subject is completed | Passed = a certificate for any of its four subjects (the RDF's levels 18-21, once per teacher) | yes |
| TDP shown as Level 1, Level 2, Level 3 separately, no overall status | one card: Passed = the level certificate, per Module 1-9 columns, "Completed all" | **no**. ISAPS has three levels (Novice, Intermediate, Advanced) in the catalogue |

## 5. What would change, and what I did not change

Not changed (assignment rules touch what teachers see on the portal and the WhatsApp Flow, so they are the operator's call):
1. Required trainings by combination: High-only to TDP only; P+H to drop GBTLA and AI-Powered. Options: per-combination rule at the
   assignment writer (band-selection.service.js), or a read-time filter in the portal and the dashboard.
2. Dashboard TDP card: Level 1/2/3 rows instead of Modules 1-9 plus overall.
3. Dashboard per-card denominators: required-by-combination, not whole section.
Done in this PR: canonical population (6,154 -> 3,239 / 4,546 -> 3,628), TDP assigned follows the Grades 9-12 gate.
