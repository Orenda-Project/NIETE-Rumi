# Hashir's rules, implemented (bd-tsa15l, queue #322)

Operator go, 27 Nov ~15:40: assignment follows Hashir's list; TDP Level 1/2/3 rows; his two status rules.

## What changed

| Where | Change |
|---|---|
| `bot/shared/services/training/vendor-band-gate.rules.js` + `.service.js` | Through a band programme, NIETE 2-3, GBTLA and AI-Powered need MIDDLE, TDP needs HIGH, NIETE via the primary programme needs PRIMARY. Soft: a teacher with no level recorded keeps her programmes (principals, coaches); earned work is never taken away. One place for the portal, the WhatsApp Flow, the exam gate and the coach card. `requirementsFor(bands)` is the seven-combination table. |
| `dashboard/services/training-levels-analytics.service.js` | Sections follow teaching levels (Primary = PRIMARY; Middle/High = MIDDLE or HIGH); each card counts only the teachers required to take it; TDP is three level rows (passed / in progress / not started), no overall status; AI-Powered complete if any one subject. |
| `portal/.../TrainingPartners.tsx`, `TrainingTab.tsx`, types, fixture | TDP panel = three level cards; the sector chart and rows have one series per TDP level. |

## Resulting requirements (matches his list)

| Levels | NIETE | GBTLA | AI-Powered | TDP |
|---|---|---|---|---|
| Primary only | 0-3 | | | |
| Primary + Middle | 0-3 | yes | yes | |
| Primary + Middle + High | 0-3 | yes | yes | yes |
| Primary + High | 0-3 | | | yes |
| Middle + High | 2-3 | yes | yes | yes |
| Middle only | 2-3 | yes | yes | |
| High only | | | | yes |

## Counts after the change (prod data, read-only, 27 Nov, FDE programme schools, teacher role, not test)

| | Hashir | Data Analyst | RDF | Dashboard (new rule) |
|---|---|---|---|---|
| Primary section | ~3,250 | 3,250 | 3,253 | 3,251 |
| Middle/High section | ~3,600 | 3,625 | - | 3,625 |
| Primary only | 2,602 | 2,602 | - | 2,603 |
| Middle/High only | ~2,980 | 2,977 | - | 2,977 |
| Across | ~650 | 648 | - | 648 |
| No level recorded (in no section) | 126 | 126 | - | 127 |
| NIETE 2-3 card (Mid/High tab) | - | - | - | 2,514 |
| GBTLA / AI-Powered cards | - | - | - | 2,390 each |
| TDP cards (each level) | - | - | - | 2,795 |

The differences of 1 are a day's data movement between reads.

## Still open
- 14 PRIMARY teachers hold no programme assignment, so they see no training. `scripts/backfill-training-assignments.js --env=prod --apply` assigns them (a prod write: needs its own go).
