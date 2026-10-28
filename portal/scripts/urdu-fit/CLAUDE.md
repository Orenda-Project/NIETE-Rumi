# urdu-fit — Measures whether Urdu (Nastaliq) text fits its boxes in the teacher kit

<!-- kg:meta repo=NIETE-Rumi dir=portal/scripts/urdu-fit kg=07c6484f71a6 gen=15fff4128440 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `run.mjs` — run `cd portal && node scripts/urdu-fit/run.mjs`; exits 1 on any clipped Urdu box
- `harness.tsx` — renders real components with Urdu copy by ?lang= and ?case=
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `PortalLayoutStub.tsx` | bd-fmf24g.24 stub replacing PortalLayout in the Urdu-fit harness: renders children only, no auth or queries |
| `harness.tsx` | bd-fmf24g.24 harness: renders teacher-kit and auth components with real Urdu copy by ?lang= and ?case= for measurement |
| `run.mjs` | bd-fmf24g.24 CLI: runs the harness in headless Chromium, fails when Nastaliq text is clipped (layout and ink checks) |
| `harness.html` | bd-fmf24g.24 local page for the Urdu-fit harness; loads the repo's Noto Nastaliq TTF, never part of the vite build |

## Who reads this (generated)
- (none)

## Never (human)
- Ship harness.html: it is a local page, never part of the build (harness.html:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/insights/tests/harness.test.tsx`? (harness.tsx)
- `portal/src/portal/coach/insights/tests/harness.tsx`? (harness.tsx)
- `portal/src/portal/rm/tests/harness.tsx`? (harness.tsx)
- `tests/child-test/L37/harness.js`? (harness.tsx)
- `tests/run.js`? (run.mjs)

## Related (generated)
- docs: `portal/scripts/CLAUDE.md`? · `portal/scripts/urdu-fit/CLAUDE.md`? · `portal/src/portal/coach/insights/tests/CLAUDE.index.md`? · `portal/src/portal/coach/insights/tests/CLAUDE.md`? · `portal/src/portal/rm/tests/CLAUDE.index.md`? · `portal/src/portal/rm/tests/CLAUDE.md`? (+2)
