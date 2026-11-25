# urdu-fit — Measures whether Urdu (Nastaliq) text fits its boxes in the teacher kit

<!-- kg:meta repo=NIETE-Rumi dir=portal/scripts/urdu-fit kg=6a612293c306 gen=5ecf38c4df0d overflow=0 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `run.mjs` — run `cd portal && node scripts/urdu-fit/run.mjs`; exits 1 on any clipped Urdu box
- `harness.tsx` — renders real components with Urdu copy by ?lang= and ?case=
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
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
- (none)

## Related (generated)
- docs: `portal/scripts/CLAUDE.md`?
