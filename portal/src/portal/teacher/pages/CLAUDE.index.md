# pages — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/pages -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `Home.language.test.tsx` | Pins the English | اردو switch in Home's band: current picked, saves via the one writer, same language writes nothing |
| `Home.on.test.tsx` | Pins Home with portal_teacher_home_card ON: full card, chips, tiles in server order, slim card after tile 1, taps logged |
| `Home.remind.test.tsx` | Pins that the evening reminder card sits after the feature tiles on both Homes, below the full or slim card |
| `Home.test.tsx` | Pins teacher v2 Home: greeting with full name, date and school, one tile per feature, no numbers on tiles (bd-fmf24g.1) |
| `Home.tsx` | Teacher v2 Home at /portal/teacher: NIETE band greeting, 2-column feature tiles, Ready for you, card and look switches |
| `More.test.tsx` | Pins teacher More: identity block plus exactly Language toggle, My profile and Log out (bd-fmf24g.33) |
| `More.tsx` | Teacher v2 More at /portal/teacher/more: who they are, Language toggle, My profile link, Log out (bd-fmf24g.33) |
| `Profile.test.tsx` | Pins My profile: name, phone and school read-only; teaching level via GET/POST /training/bands, multi-pick and Save |
| `Profile.tsx` | My profile at /portal/teacher/profile: read-only identity plus the teaching-level (bands) picker with 48-hour lock |
| `routes.tsx` | Registers lazy Home (/portal/teacher), More and My profile via TeacherGate; the frame's own pages |

## Who reads this (all, generated)
- `Home.tsx` ← imported by `portal/src/App.tsx:57:c88a91a7` · `portal/src/portal/teacher/pages/routes.tsx:6:f24d299d`
- `More.tsx` ← imported by `portal/src/portal/coach/pages/CoachHome.tsx:10:80ac37a5` · `portal/src/portal/coach/profile/CoachMore.tsx:6:6fd6bd67` · `portal/src/portal/coach/profile/CoachProfile.tsx:7:0f6f4e8b` · `portal/src/portal/teacher/pages/routes.tsx:7:38887f9c`
- `Profile.tsx` ← imported by `portal/src/portal/coach/profile/CoachProfile.tsx:8:0572f196` · `portal/src/portal/teacher/pages/routes.tsx:8:591421e5`

## Tests (all, generated)
- `Home.tsx` ← `portal/src/portal/teacher/frame.ur.test.tsx` · `portal/src/portal/teacher/home/QuizTile.test.tsx` · `portal/src/portal/teacher/home/look/LookHome.test.tsx` · `portal/src/portal/teacher/pages/Home.language.test.tsx` · `portal/src/portal/teacher/pages/Home.on.test.tsx` · `portal/src/portal/teacher/pages/Home.remind.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/teacher/pages/Home.tsx`)
- `More.tsx` ← `portal/src/portal/teacher/frame.ur.test.tsx` · `portal/src/portal/teacher/pages/More.test.tsx`
- `Profile.tsx` ← `portal/src/portal/teacher/pages/Profile.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/teacher/CLAUDE.md`?
