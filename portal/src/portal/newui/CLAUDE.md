# newui — New-UI design kit (portal_new_ui flag): tokens, components, screens per feature
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui kg=55d18b720e11 gen=cd58af97a29f overflow=95 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `DESIGN.md` — rules, tokens and kit contract; read before building a screen
- `index.ts` — kit exports; `copy.ts` holds every word. Tests: `cd portal && npx vitest run src/portal/newui` (vitest.config.ts, jsdom); CI job portal-newui
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `assessment/` | New-UI Assessment screens: make a paper, writing/ready/failed, My assessments → `assessment/CLAUDE.md` |
| `checks/` | Design-rule tests that fail the build when the new UI breaks DESIGN.md → `checks/CLAUDE.md` |
| `coaching/` | New-UI teacher Coaching: record page, lesson view, live moves, send flow → `coaching/CLAUDE.md` |
| `home/` | New-UI teacher Home: date-range 'what you did' tiles and their lists → `home/CLAUDE.md` |
| … | 44 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/teacher/training/copy.ts:14:20bad875` · `portal/src/portal/teacher/ui/copy.ts:15:1956a8ba` (+41)
- `Chip.tsx` ← imported by `portal/src/portal/newui/AudioPlayer.tsx:5:86119bd6` · `portal/src/portal/newui/DateRange.tsx:6:86119bd6` (+29)
- `range.ts` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:9:8c76e8b8` · `portal/src/portal/analytics/format.ts:1:8c76e8b8` (+27)
- … 22 more → `CLAUDE.index.md`

## Never (human)
- Every word the new UI shows lives in copy.ts (copy.ts:2; checks/copy.test.ts)
- A feature colour is drawn only in FeatureIcon (FeatureIcon.tsx:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/newui/checks/tap.test.tsx` (Answers.tsx, AudioPlayer.tsx, BottomButton.tsx, Chip.tsx, DateRange.tsx, Hero.tsx, InnerBar.tsx, List.tsx, MainHeading.tsx, MetricTile.tsx, NumberGrid.tsx, Sheet.tsx, Stepper.tsx, ToggleList.tsx, range.ts)
- `portal/src/portal/newui/pickers.test.tsx` (Chip.tsx, Hero.tsx, NumberGrid.tsx, ToggleList.tsx, tokens.ts)
- … 29 more → `CLAUDE.index.md`

## Related (generated)
- docs: `dashboard/lib/CLAUDE.md`? · `portal/CLAUDE.md`? · `portal/README.md`? · `portal/src/components/ui/CLAUDE.md`? · `portal/src/portal/CLAUDE.md`? · `portal/src/portal/newui/DESIGN.md`? (+2)
