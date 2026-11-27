# ICT teacher count on the portal Trainings tab (bd-tsa15l, queue #322)

Measured on NIETE prod, read-only through REST, 27 Nov 2026.
`dashboard/services/training-levels-analytics.service.js`.

## Side by side

| Source | Count | Rule |
|---|---|---|
| Portal Trainings tab, Primary, before | **6,154** | any active niete_primary assignment, any role, any school or none |
| Portal Trainings tab, Mid/High, before | 4,546 | same, niete_middle_high |
| Portal Primary, after this fix | **3,239** | role teacher, not test, programme school, ICT sector |
| Portal Mid/High, after | 3,628 | same |
| RDF live roster (v45, 25 Nov), primary teachers | 3,253 | `rdf_niete/live_roster.py` (all bands 6,360) |
| Data server `teacher_headcount` (rules v0.42.8) | 8,542 on 13 Oct (6,151 at a programme school) | headcount; analytics use "with a school" (1e) |

## Which filter removes how many (Primary tab, applied in this order)

| Filter | Primary | Mid/High |
|---|---|---|
| start | 6,154 | 4,546 |
| not role teacher (principals, coaches, unregistered) | -429 | -166 |
| test accounts | -254 | -31 |
| no school recorded | -1,856 | -641 |
| school not on FDE programme list | -376 | -80 |
| school outside the six sectors | 0 | 0 |
| **result** | **3,239** | **3,628** |

Remaining gap to the RDF's 3,253: 14 (about 0.4%), from the day the two were read and the primary band test; to be confirmed against Hashir's numbers.

## What changed

- Members read: `u.role = 'teacher' AND u.is_test_user IS NOT TRUE`.
- FDE's view: a member counts only at a school on the programme list (fail-closed to a counted school when the list is missing); sector is her school's, not the August allocation. No more "No school" rows.
- Other organizations' areas (Moawin/GB) keep the rule they had.
- Completion percentages use the same base (denominator = the members).
