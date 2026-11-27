# Who sees which training today (NIETE prod, 27 Nov 2026) — bd-tsa15l, queue #322

For checking Hashir's list against what the portal, the bot and the dashboard do now. Counts are canonical ICT teachers
(role teacher, not test, programme school): 6,354 across all bands.

## 1. How a teacher gets trainings

1. `users.teacher_level` (her own choice: PRIMARY / MIDDLE / HIGH, any mix) → `bandsToPrograms` (`band-selection.service.js`)
   writes `teacher_training_assignments`: PRIMARY → `niete_primary`; MIDDLE or HIGH → `niete_middle_high` (both bands → both programmes).
2. Each programme scopes providers and levels (`training_program_scopes`). Portal training pages, the WhatsApp Flow, the exam gate
   and the dashboard all read assignments → scopes.
3. Band gate (`vendor-band-gate.rules.js`): I-SAPS (Grades 9-12) reached through a band programme shows only if her bands include HIGH,
   or she already has I-SAPS work. The pilot programme `niete_isaps_pilot` is hand-assigned and not gated.
4. No band, no assignment, no training ("No training assigned yet", decision 13 Aug).

## 2. Programme → what it shows

| Programme | NIETE levels (Taleemabad vendor) | Partner providers |
|---|---|---|
| `niete_primary` (Grades 1-5) | all four: Aspiring Teacher (0), Emerging Practitioner (1), Skilled Practitioner (2), Teacher Leader (3) | none |
| `niete_middle_high` (Grades 6-10 in the name) | only Skilled Practitioner (2), Teacher Leader (3) | Oxbridge GBTLA (all), Beaconhouse AI-Powered Subject Pedagogy (all), I-SAPS Teacher Development Programme 9-12 (all; HIGH only by the gate) |
| `niete_isaps_pilot` | none | I-SAPS only; hand-assigned, ungated |
| `niete_standard` | all four | Oxbridge, Beaconhouse (held by 51 coaches, with the pilot) |

## 3. Teacher group → trainings, with prod counts (canonical teachers)

| teacher_level | Programme(s) held | Count | Sees |
|---|---|---|---|
| PRIMARY | niete_primary | 2,585 | NIETE levels 0-3 |
| MIDDLE | niete_middle_high | 476 | NIETE 2-3, Oxbridge, Beaconhouse; **no** I-SAPS (gate) |
| HIGH | niete_middle_high | 1,111 | NIETE 2-3, Oxbridge, Beaconhouse, I-SAPS |
| MIDDLE + HIGH | niete_middle_high | 1,387 | as HIGH |
| PRIMARY + MIDDLE | both | 350 | NIETE 0-3, Oxbridge, Beaconhouse; no I-SAPS |
| PRIMARY + HIGH | both | 123 | NIETE 0-3, Oxbridge, Beaconhouse, I-SAPS |
| PRIMARY + MIDDLE + HIGH | both | 173 | all of the above |
| no band | none | 126 | nothing |
| PRIMARY, programme missing | none | 14 | nothing (should have niete_primary) |
| mismatched (7 rows) | band and programme disagree | 7 | e.g. 4 PRIMARY-only holding both; 1 HIGH+PRIMARY holding mid/high only |

Other roles hold programmes too: principals 488 (niete_primary 341, middle/high 100, both 47), coaches 100 (with the pilot or standard),
unregistered 18. They are not teachers and no longer count on the dashboard; they still see the trainings above on the portal.

## 4. Dashboard vs portal

| Dashboard card | Population | Matches the portal? |
|---|---|---|
| Primary tab, NIETE levels 0-3 | niete_primary members | yes |
| Mid/High tab, NIETE levels 2-3, Oxbridge, Beaconhouse | niete_middle_high members | yes |
| Mid/High, I-SAPS | members assigned it | **was no**: counted MIDDLE-only teachers the portal hides it from. Fixed in this PR: HIGH, earned work, or pilot only |
| A teacher in both programmes | counts on both tabs | as the RDF's two cards |

## 5. For Hashir's list

- Is Middle-only meant to see Oxbridge and Beaconhouse (today yes) and NIETE level 2-3 but not 0-1 (today yes)?
- Primary + Middle teachers see NIETE 0-3 through niete_primary (today yes).
- I-SAPS: Grades 9-12 only (today yes)?
- Principals and coaches: should they hold any training programme (today yes, not counted on the dashboard)?
- The 126 no-band and 14 primary-without-programme teachers: assign or leave?
