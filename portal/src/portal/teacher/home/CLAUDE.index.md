# home — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/home -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `look/` | Teacher Home 'look' (portal_teacher_home_look): navy band, one card, rows, progress strip → `look/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `LessonQuizButton.test.tsx` | Pins 'Quiz this lesson': shown only with the Home card switch and a signed quiz home, logs lp_quiz or coach_quiz |
| `LessonQuizButton.tsx` | 'Quiz this lesson' button on an open lesson plan and a ready DC report; opens the signed quiz home and logs the tap |
| `NextCard.test.tsx` | Pins the full Home card per rung in English and Urdu: no score in headline, 48px buttons, RTL lines, tap targets |
| `NextCard.tsx` | Shape A full Home card 'Next for you' for coach report, observation and first-plan rungs, with two 48px buttons |
| `QuizTile.test.tsx` | Pins the Home Quizzes tile: 2nd tile after Lesson plans when GET /me/home says quizTile true (27 Oct 2026) |
| `QuizTile.tsx` | Home 'Quizzes' tile (portal_teacher_home_quiz_tile) as a feature tile or look row opening the teacher's quiz home |
| `ScoresRow.test.tsx` | Pins ScoresRow chips: two chips each to its report, no score no chip, never a stand-in zero |
| `ScoresRow.tsx` | Row of at most two pale score chips under the Home card: latest AI-coach and observation score, each to its report |
| `SlimCard.test.tsx` | Pins the slim Home card for class and lesson rungs and the lesson cool-down (3 draws per plan per device) |
| `SlimCard.tsx` | Shape B slim Home card for the two quiz rungs: one line, a navy pill and a text link, spanning the tile grid |
| `api.test.ts` | Tests readHome for GET /me/home and POST /me/home/tap: server shape read as is, failures return null, bad order dropped |
| `api.ts` | Home card API: GET /api/portal/me/home and POST /me/home/tap; server picks card rung, tile order, scores, quiz home |
| `chips.ts` | Score-chip rule shared by ScoresRow and the look's strip: pickChips from latest scores, skipping the card's own rung |
| `coolDown.ts` | Lesson card cool-down: localStorage counter limits a plan's card to a few home loads per device, fail-open |
| `copy.test.ts` | Guards Home card copy: registered with copyRegistry, Urdu complete, within caps at 360 wide in code points |
| `copy.ts` | English and Urdu words for the Home card, score chips and LP 'Quiz this lesson' button, registered COPY_ENTRY |
| `useHomeData.test.ts` | Tests the Home data hook: single request, tile order kept unless the fetched order lands within 300ms budget |
| `useHomeData.ts` | Hooks for Home: reads switches (card, order, look) from /config fail-closed and loads GET /me/home with a reorder budget |

## Who reads this (all, generated)
- `LessonQuizButton.tsx` ← imported by `portal/src/portal/teacher/coaching/ReportPage.tsx:27:18b028fe` · `portal/src/portal/teacher/lessons/ViewerPage.tsx:20:18b028fe`
- `NextCard.tsx` ← imported by `portal/src/portal/teacher/pages/Home.tsx:15:f37f5d85` · `portal/src/portal/teacher/home/look/LookHome.tsx:11:6cf38df8`
- `QuizTile.tsx` ← imported by `portal/src/portal/teacher/pages/Home.tsx:20:a8ed77a2` · `portal/src/portal/teacher/home/look/FeatureRows.tsx:8:0f102e63`
- `ScoresRow.tsx` ← imported by `portal/src/portal/teacher/pages/Home.tsx:17:34259cf6`
- `SlimCard.tsx` ← imported by `portal/src/portal/teacher/pages/Home.tsx:16:d625f5f2` · `portal/src/portal/teacher/home/look/LookHome.tsx:12:1c8bea70`
- `api.ts` ← imported by `portal/src/portal/teacher/home/LessonQuizButton.tsx:7:e60ade0a` · `portal/src/portal/teacher/home/NextCard.tsx:9:f2ddb384` · `portal/src/portal/teacher/home/QuizTile.tsx:6:4de7cdaf` · `portal/src/portal/teacher/home/ScoresRow.tsx:7:9663c29b` (+10: `python3 kg/kg.py who-reads api.ts`)
- `chips.ts` ← imported by `portal/src/portal/teacher/home/ScoresRow.tsx:6:ab21523c` · `portal/src/portal/teacher/home/look/LookHome.tsx:14:4190547a` · `portal/src/portal/teacher/home/look/LookScores.tsx:6:f0104c46`
- `coolDown.ts` ← imported by `portal/src/portal/teacher/home/SlimCard.tsx:7:c984ca6b` · `portal/src/portal/teacher/home/look/LookCard.tsx:8:b4937ac5`
- `copy.ts` ← imported by `portal/src/portal/teacher/home/LessonQuizButton.tsx:6:b95df8e3` · `portal/src/portal/teacher/home/NextCard.tsx:7:b95df8e3` · `portal/src/portal/teacher/home/QuizTile.tsx:5:3834b44c` · `portal/src/portal/teacher/home/ScoresRow.tsx:5:b95df8e3` (+6: `python3 kg/kg.py who-reads copy.ts`)
- `useHomeData.ts` ← imported by `portal/src/portal/teacher/TeacherNavigation.tsx:10:4f102628` · `portal/src/portal/teacher/pages/Home.tsx:18:5e28519f` · `portal/src/portal/teacher/home/LessonQuizButton.tsx:8:b9500ee2`

## Tests (all, generated)
- `LessonQuizButton.tsx` ← `portal/src/portal/teacher/home/LessonQuizButton.test.tsx`
- `NextCard.tsx` ← `portal/src/portal/teacher/home/NextCard.test.tsx` · `portal/src/portal/teacher/home/look/LookCard.test.tsx`
- `QuizTile.tsx` ← `portal/src/portal/teacher/home/QuizTile.test.tsx`?
- `ScoresRow.tsx` ← `portal/src/portal/teacher/home/ScoresRow.test.tsx` · `portal/src/portal/teacher/home/look/LookScores.test.tsx`
- `SlimCard.tsx` ← `portal/src/portal/teacher/home/SlimCard.test.tsx` · `portal/src/portal/teacher/home/look/LookCard.test.tsx`
- `api.ts` ← `portal/src/portal/teacher/home/LessonQuizButton.test.tsx` · `portal/src/portal/teacher/home/NextCard.test.tsx` · `portal/src/portal/teacher/home/QuizTile.test.tsx` · `portal/src/portal/teacher/home/ScoresRow.test.tsx` · `portal/src/portal/teacher/home/SlimCard.test.tsx` · `portal/src/portal/teacher/home/api.test.ts` (+8: `python3 kg/kg.py who-reads portal/src/portal/teacher/home/api.ts`)
- `coolDown.ts` ← `portal/src/portal/teacher/home/look/LookCard.test.tsx`
- `copy.ts` ← `portal/src/portal/teacher/home/LessonQuizButton.test.tsx` · `portal/src/portal/teacher/home/NextCard.test.tsx` · `portal/src/portal/teacher/home/QuizTile.test.tsx` · `portal/src/portal/teacher/home/copy.test.ts` · `portal/src/portal/teacher/home/look/LookCard.test.tsx` · `portal/src/portal/teacher/home/look/cardWords.test.ts`
- `useHomeData.ts` ← `portal/src/portal/teacher/TeacherNavigation.test.tsx` · `portal/src/portal/teacher/home/LessonQuizButton.test.tsx` · `portal/src/portal/teacher/home/QuizTile.test.tsx` · `portal/src/portal/teacher/home/look/LookHome.test.tsx` · `portal/src/portal/teacher/home/useHomeData.test.ts` · `portal/src/portal/teacher/pages/Home.on.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/teacher/home/useHomeData.ts`)

## Related (all, generated)
- docs: `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/home/CLAUDE.index.md`? · `portal/src/portal/teacher/home/CLAUDE.md`? · `portal/src/portal/teacher/home/look/CLAUDE.index.md`? · `portal/src/portal/teacher/home/look/CLAUDE.md`? · `portal/src/portal/teacher/pages/CLAUDE.index.md`? · `portal/src/portal/teacher/pages/CLAUDE.md`?
