# tests — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/fln/tests -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 3 files: 0 test + 3 support) |
| `__snapshots__/` | → (not mapped: excluded; 1 files) |
| `appRoute.test.tsx` | Vitest: real App mounts /portal/fln/* route table; signed-out cold open asks /fln/me and goes to sign-in with next= |
| `backlink.test.tsx` | Vitest (R5 QL-backlink): Back on a plan reached via link sign-in goes to the subject list, not out of the app |
| `band.test.tsx` | Vitest for FlnBand on New-lesson page: who sees it, grade chips, counts, lazy chunk, CSS read from disk (bd-4tsjcr) |
| `bidi.test.tsx` | Vitest porting red-team bidi check: Urdu plan DOM has no bare ASCII runs outside <bdi> and no «·» separator |
| `clips.test.ts` | Vitest for player/clips.ts: label chain (label_ur/en), clip ids, first-appearance order, grid clips |
| `counts.test.tsx` | Vitest (R5 Q1): band, list and plan kicker use the placement count of the grade the teacher is viewing |
| `fln-ab-isolation.client.test.ts` | Vitest: FLN client folder must not import K-5 lesson-plan A/B code (lessonPlansApi, useOpenLesson); server half separate |
| `gate.test.tsx` | Vitest for FlnGate and FlnRoutes: /me each mount, 401 to sign-in, 404/lessons:false shows unavailable notice |
| `golden.flagOff.test.tsx` | Vitest with recorded snapshots: with FLN off, NewLessonPage and OpenPlanPage render byte-identical to pre-FLN |
| `hiddenBand.page.test.tsx` | Vitest (bd-4tsjcr): teacher of Grades 6-12 only gets no FLN band, page identical to switch-off; coach still gets it |
| `hooks.test.tsx` | Vitest for FLN hook lines in shared files: appReady ALWAYS_OPEN, CoachAppGuard lets a v2 coach reach /portal/fln |
| `list.test.tsx` | Vitest for LessonList: running number = pos, pinned guide, screener chip, Next marker, strand tabs, Urdu bdi rules |
| `listFixtures.ts` | Synthetic catalogue answers (levels, guide, screener, core rows, Urdu title, extended strand) for list/band/gate tests |
| `low-r5.test.tsx` | Vitest for the R5 LOW batch: singular counts, no mid-word time-bar breaks, Urdu "MB" label and other QA fixes |
| `mlinksMount.test.tsx` | Vitest: PlanPage mounts ShareBar when me.share and FlnRoutes has the send route, via the real pages |
| `move.test.tsx` | Vitest for Move: markdown subset only, escaped text, one pill per audio, image retry, videos not preloaded, PDF link |
| `narration.test.tsx` | Vitest: story narration step reaches the real SoundPill with its clip role ("Listen to the story") |
| `naskh.test.tsx` | Vitest (R5 RT5-NASKH): Arabic-script text under an Urdu FLN root computes the Nastaliq stack whatever html lang says |
| `openLink.test.tsx` | Vitest for open_link event: one per /go (src=send) or ?src=wa landing, none on 404 or without src |
| `planpage.test.tsx` | Vitest for plan page states: 404/503 notices, kicker from placement, no Share slot for teachers, batched telemetry |
| `player.test.ts` | Vitest for createFlnPlayer with fake audio/clock: one at a time, restart/repeat, prefetch, errors and retry |
| `qa-r1.test.tsx` | Vitest for qa-render r1 defects: no badges on self-numbered steps, trailing "+" stays in its Latin run, others |
| `readers.test.tsx` | Vitest: teacher Home/Recent/All-lesson-plans readers handle kind 'fln' plans and link to the FLN plan path |
| `rootScope.test.tsx` | Vitest (R5 RT5-ROOT100VH): full-height page rule applies only to the gate root, not embedded .fln-root surfaces |
| `section.test.tsx` | Vitest: plan sections are closed bands by default and expand in place; sound grid rendering |
| `tile-shift.test.tsx` | Vitest (AUDIO_BAR A11): sound tile box stays fixed across states; state line always rendered in a two-line box |
| `ui-owner.test.tsx` | Vitest: SoundPill/SoundTile owner prop passes through to the player; PlanPage draws the grid heading |
| `ui.test.tsx` | Vitest for SoundPill and SoundTile states (idle/loading/playing/error) against a recording fake player |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `portal/src/CLAUDE.md`? · `portal/src/portal/coach/insights/components/CLAUDE.md`? · `portal/src/portal/fln/CLAUDE.md`? · `portal/src/portal/fln/lib/CLAUDE.md`? · `portal/src/portal/fln/login/CLAUDE.md`? · `portal/src/portal/fln/plan/CLAUDE.md`? · `portal/src/portal/fln/player/CLAUDE.md`? · `portal/src/portal/fln/share/CLAUDE.md`? · `portal/src/portal/newui/home/CLAUDE.md`? · `portal/src/portal/newui/lessons/CLAUDE.md`?
