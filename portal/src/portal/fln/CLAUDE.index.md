# fln — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/fln -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `lib/` | FLN path and sign-in return helpers → `lib/CLAUDE.md` |
| `login/` | FLN banner and next= exports used by the portal sign-in page → `login/CLAUDE.md` |
| `plan/` | Parts of the FLN plan page: header, sections, moves, media, time bar → `plan/CLAUDE.md` |
| `player/` | FLN sound player engine and its pill/tile controls → `player/CLAUDE.md` |
| `send/` | → (no door; 2 files) |
| `share/` | Leader sharing: Share bar, send to teachers, share link, WhatsApp text → `share/CLAUDE.md` |
| `tests/` | Tests for the FLN pages, player, gate, share and flag-off goldens → `tests/CLAUDE.md` |
| `Bdi.tsx` | Wraps Latin/digit runs in <bdi> inside RTL Urdu text so SLO, 5, 24/48 keep order; LTR text untouched |
| `FlnBand.tsx` | Small door on New-lesson page: asks GET /fln/me and lazy-loads FlnBandBody only if lessons are on, else renders null |
| `FlnBandBody.tsx` | "Reading Hour & Numeracy" band body on New-lesson page: grade chips 1-5, subject entries; defaultGrade/bandGrade helpers |
| `FlnContext.tsx` | FlnProvider/useFln: the /fln/me user, UI language (ui_lang), direction and chrome words every FLN page reads |
| `FlnGate.tsx` | Sign-in gate for /portal/fln/*: fetches /fln/me each mount; 401 goes to login with next=, off/failed shows notices |
| `FlnRoutes.tsx` | Route table under /portal/fln/* (plan p/:id, list/:subject, send), all behind FlnGate; mounted from App.tsx |
| `FlnSendCard.tsx` | Leader-home card opening /portal/fln/send; renders nothing unless /fln/me says share:true |
| `FlnSendEntry.test.tsx` | Vitest: send-a-lesson entries (leader home card, coach library tile) render nothing unless /me share:true |
| `FlnSendTile.tsx` | Coach Training Library tile opening the lesson-plan builder; renders nothing unless /fln/me says share:true |
| `LessonList.tsx` | Level lesson list page (S3/S5): sub-header, strand tabs, other-levels menu, lessons from the placement table |
| `PlanPage.tsx` | Plan page /portal/fln/p/:id: header, goal, time bar, sound grid, closed section bands, homework; logs the open |
| `api.ts` | FLN API client: plain fetch with cookie; 404 gives null, 401 throws FlnAuthError, outages FlnUnavailableError |
| `fln.css` | FLN page styles scoped under .fln-root / .fln-band so no other portal page is touched; NIETE navy and green |
| `hooks.test.tsx` | Vitest for one-line FLN hooks in shared pages: TeacherGate next=, PortalLogin next=/banner, LeaderHome send card |
| `libraryHook.test.tsx` | Vitest: coach Training Library shows the "Send a lesson plan" tile only when /me.share, in page language |
| `listShared.tsx` | Shared bits for FLN list pages: catalogue loader, top bar with Back, FLN_SUBJECTS, NEW_LESSON path, isFlnSubject |
| `strings.audio.ts` | All EN+UR words the FLN sound controls show or speak; audioLang helper (player.md v2, AUDIO_BAR A6/A10) |
| `strings.ts` | All EN+UR chrome words for the FLN (Reading Hour, Numeracy) pages; flnStrings(lang), num() Urdu digits |
| `types.ts` | Types for FLN pages: FlnMe, plan, placement, catalogue shapes (server-owned; client derives no numbers) |

## Who reads this (all, generated)
- `Bdi.tsx` ← imported by `portal/src/portal/fln/LessonList.tsx:18:72167946` · `portal/src/portal/fln/listShared.tsx:10:72167946`
- `FlnBand.tsx` ← imported by `portal/src/portal/teacher/lessons/LessonsHome.tsx:17:0c817659` · `portal/src/portal/teacher/lessons/NewLessonPage.tsx:13:0c817659`
- `FlnBandBody.tsx` ← imported by `portal/src/portal/fln/FlnBand.tsx:15:805387e8`
- `FlnContext.tsx` ← imported by `portal/src/portal/fln/FlnGate.tsx:16:6028f41a` · `portal/src/portal/fln/FlnRoutes.tsx:17:27bf7e20` · `portal/src/portal/fln/LessonList.tsx:16:27bf7e20` · `portal/src/portal/fln/PlanPage.tsx:23:27bf7e20`
- `FlnGate.tsx` ← imported by `portal/src/portal/fln/FlnRoutes.tsx:16:3fd51080` · `portal/src/portal/fln/LessonList.tsx:17:701a9700`
- `FlnRoutes.tsx` ← imported by `portal/src/App.tsx:161:56ef1400`
- `FlnSendCard.tsx` ← imported by `portal/src/portal/pages/LeaderHome.tsx:13:d3b0edb8`
- `FlnSendTile.tsx` ← imported by `portal/src/portal/coach/training/LibraryPages.tsx:23:6907e93d`
- `LessonList.tsx` ← imported by `portal/src/portal/fln/FlnRoutes.tsx:18:175e80eb`
- `PlanPage.tsx` ← imported by `portal/src/portal/fln/FlnRoutes.tsx:20:036cde34`
- `api.ts` ← imported by `portal/src/portal/fln/FlnBand.tsx:12:3367dabe` · `portal/src/portal/fln/FlnBandBody.tsx:25:3367dabe` · `portal/src/portal/fln/FlnGate.tsx:15:7af565ea` · `portal/src/portal/fln/PlanPage.tsx:21:3367dabe` (+1: `python3 kg/kg.py who-reads api.ts`)
- `fln.css` ← imported by `portal/src/portal/fln/FlnBandBody.tsx:32:3377d62d` · `portal/src/portal/fln/FlnGate.tsx:21:3377d62d`
- `listShared.tsx` ← imported by `portal/src/portal/fln/FlnBandBody.tsx:28:e4b15f54` · `portal/src/portal/fln/FlnRoutes.tsx:19:09fbb17e` · `portal/src/portal/fln/LessonList.tsx:22:0cd80724` · `portal/src/portal/fln/PlanPage.tsx:31:f7f32be9` (+1: `python3 kg/kg.py who-reads listShared.tsx`)
- `strings.audio.ts` ← imported by `portal/src/portal/fln/plan/SoundGrid.tsx:7:467c0a81` · `portal/src/portal/fln/player/SoundPill.tsx:5:84b263b1` · `portal/src/portal/fln/player/SoundTile.tsx:5:84b263b1`
- `strings.ts` ← imported by `portal/src/portal/fln/FlnBandBody.tsx:26:2f8deb7e` · `portal/src/portal/fln/FlnContext.tsx:7:8d6a1774` · `portal/src/portal/fln/FlnGate.tsx:17:8d6a1774` · `portal/src/portal/fln/LessonList.tsx:20:b755bcbc` (+11: `python3 kg/kg.py who-reads strings.ts`)
- `types.ts` ← imported by `portal/src/portal/fln/FlnBandBody.tsx:27:09b7cd91` · `portal/src/portal/fln/FlnContext.tsx:8:93f16bf1` · `portal/src/portal/fln/FlnGate.tsx:18:93f16bf1` · `portal/src/portal/fln/LessonList.tsx:21:4e1ebc58` (+10: `python3 kg/kg.py who-reads types.ts`)

## Tests (all, generated)
- `FlnBand.tsx` ← `portal/src/portal/fln/tests/band.test.tsx` · `portal/src/portal/fln/tests/counts.test.tsx`
- `FlnBandBody.tsx` ← `portal/src/portal/fln/tests/band.test.tsx`
- `FlnContext.tsx` ← `portal/src/portal/fln/tests/counts.test.tsx` · `portal/src/portal/fln/tests/gate.test.tsx` · `portal/src/portal/fln/tests/list.test.tsx` · `portal/src/portal/fln/tests/low-r5.test.tsx` · `portal/src/portal/fln/tests/naskh.test.tsx`
- `FlnGate.tsx` ← `portal/src/portal/fln/tests/gate.test.tsx` · `portal/src/portal/fln/tests/rootScope.test.tsx` · `portal/src/portal/teacher/lessons/leaders.test.tsx`
- `FlnRoutes.tsx` ← `portal/src/portal/fln/tests/gate.test.tsx` · `portal/src/portal/fln/tests/mlinksMount.test.tsx`
- `FlnSendCard.tsx` ← `portal/src/portal/fln/FlnSendEntry.test.tsx` · `portal/src/portal/fln/tests/rootScope.test.tsx`
- `FlnSendTile.tsx` ← `portal/src/portal/fln/FlnSendEntry.test.tsx` · `portal/src/portal/fln/tests/rootScope.test.tsx`
- `LessonList.tsx` ← `portal/src/portal/fln/tests/counts.test.tsx` · `portal/src/portal/fln/tests/list.test.tsx` · `portal/src/portal/fln/tests/low-r5.test.tsx` · `portal/src/portal/fln/tests/naskh.test.tsx`
- `PlanPage.tsx` ← `portal/src/portal/fln/tests/backlink.test.tsx` · `portal/src/portal/fln/tests/counts.test.tsx` · `portal/src/portal/fln/tests/fixtures/renderPlan.tsx` · `portal/src/portal/fln/tests/planpage.test.tsx` · `portal/src/portal/teacher/lessons/leaders.test.tsx`
- `listShared.tsx` ← `portal/src/portal/teacher/lessons/leaders.test.tsx`
- `strings.audio.ts` ← `portal/src/portal/fln/tests/tile-shift.test.tsx` · `portal/src/portal/fln/tests/ui.test.tsx`
- `strings.ts` ← `portal/src/portal/fln/tests/band.test.tsx` · `portal/src/portal/fln/tests/counts.test.tsx` · `portal/src/portal/fln/tests/fixtures/renderPlan.tsx` · `portal/src/portal/fln/tests/gate.test.tsx` · `portal/src/portal/fln/tests/hiddenBand.page.test.tsx` · `portal/src/portal/fln/tests/list.test.tsx`
- `types.ts` ← `portal/src/portal/fln/tests/backlink.test.tsx` · `portal/src/portal/fln/tests/band.test.tsx` · `portal/src/portal/fln/tests/counts.test.tsx` · `portal/src/portal/fln/tests/fixtures/plans.ts` · `portal/src/portal/fln/tests/fixtures/renderPlan.tsx` · `portal/src/portal/fln/tests/hiddenBand.page.test.tsx` (+6: `python3 kg/kg.py who-reads portal/src/portal/fln/types.ts`)

## Related (all, generated)
- docs: `portal/src/portal/CLAUDE.md`?
