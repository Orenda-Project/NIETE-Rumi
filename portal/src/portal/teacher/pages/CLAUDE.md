# pages — Teacher frame pages: Home, More and My profile
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/pages kg=dc7e8b8b10bc gen=760b11d53c93 overflow=11 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `routes.tsx` — Home at /portal/teacher, More at /more, My profile at /profile
- `Home.tsx` — tiles and card wiring; `Profile.tsx` — teaching-level picker
- `Home.test.tsx` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/pages`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `Home*` | 5 files; most used `Home.on.test.tsx`: Pins Home with portal_teacher_home_card ON: full card, chips, tiles in server order, slim card after tile 1, taps logged |
| `More.tsx` | Teacher v2 More at /portal/teacher/more: who they are, Language toggle, My profile link, Log out (bd-fmf24g.33) |
| `More.test.tsx` | Pins teacher More: identity block plus exactly Language toggle, My profile and Log out (bd-fmf24g.33) |
| `Profile.test.tsx` | Pins My profile: name, phone and school read-only; teaching level via GET/POST /training/bands, multi-pick and Save |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `More.tsx` ← imported by `portal/src/portal/coach/insights/components/MoreCoachip.tsx:3:d14be533` · `portal/src/portal/coach/pages/CoachHome.tsx:10:80ac37a5` (+3)
- `Home.tsx` ← imported by `portal/src/App.tsx:57:c88a91a7` · `portal/src/portal/teacher/pages/routes.tsx:6:f24d299d`
- `Profile.tsx` ← imported by `portal/src/portal/coach/profile/CoachProfile.tsx:8:0572f196` · `portal/src/portal/teacher/pages/routes.tsx:8:591421e5`

## Never (human)
- Teacher name, phone and school are shown read-only; only teaching level is editable (Profile.tsx header, bd-fmf24g.1)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/frame.ur.test.tsx` (Home.tsx, More.tsx)
- `portal/src/portal/teacher/home/QuizTile.test.tsx` (Home.tsx)
- … 7 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/home/CLAUDE.index.md`? · `portal/src/portal/teacher/home/CLAUDE.md`? · `portal/src/portal/teacher/home/look/CLAUDE.index.md`? · `portal/src/portal/teacher/pages/CLAUDE.index.md`? (+1)
