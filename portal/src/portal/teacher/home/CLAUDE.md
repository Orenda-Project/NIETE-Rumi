# home — Teacher Home card, score chips, Quizzes tile and Home data hook
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/teacher/home kg=d731a47cff1f gen=260449929d57 overflow=47 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `useHomeData.ts` — switches and GET /me/home load; `api.ts` — the server-shaped card read
- `NextCard.tsx`, `SlimCard.tsx`, `ScoresRow.tsx` — today's card shapes; `look/` is the newer look
- `api.test.ts` — vitest suite (jsdom): `cd portal && npx vitest run src/portal/teacher/home`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `activity/` | (no description yet) → `activity/CLAUDE.md` |
| `look/` | Teacher Home 'look' (portal_teacher_home_look): navy band, one card, rows, progress strip → `look/CLAUDE.md` |
| `api*` | 3 files; most used `api.ts`: Home card API: GET /api/portal/me/home and POST /me/home/tap; server picks card rung, tile order, scores, quiz home |
| `copy.ts` | English and Urdu words for the Home card, score chips and LP 'Quiz this lesson' button, registered COPY_ENTRY |
| … | 17 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `api.ts` ← imported by `portal/src/portal/teacher/notices/ReadyForYou.tsx:6:e4864c9e` · `portal/src/portal/teacher/home/LessonQuizButton.tsx:7:e60ade0a` (+13)
- `copy.ts` ← imported by `portal/src/portal/teacher/home/LessonQuizButton.tsx:6:b95df8e3` · `portal/src/portal/teacher/home/NextCard.tsx:7:b95df8e3` (+8)
- `useHomeData.ts` ← imported by `portal/src/portal/teacher/TeacherNavigation.tsx:10:4f102628` · `portal/src/portal/teacher/notices/ReadyForYou.tsx:7:fd0c8376` (+2)
- … 7 more → `CLAUDE.index.md`

## Never (human)
- Switches are fail-closed: unreadable /config leaves Home as before (useHomeData.ts:11)
- A lesson card draws at most COOL_DOWN_SHOWS (3) times per plan per device (coolDown.ts:10)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/teacher/home/look/LookCard.test.tsx` (NextCard.tsx, SlimCard.tsx, api.ts, coolDown.ts, copy.ts)
- `portal/src/portal/teacher/home/LessonQuizButton.test.tsx` (LessonQuizButton.tsx, api.ts, copy.ts, useHomeData.ts)
- … 25 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/pages/CLAUDE.md`?
