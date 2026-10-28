# bench — Dev-only pages for benchmarking and screenshotting the sound player

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/fln/player/bench kg=35674822ad5e gen=57d597f360c7 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bench.tsx` — drives the player on a fixture plan for tools/fln_audio_bench.py
- `states.tsx` — every sound control in every state, synthetic data
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `bench.tsx` | Dev-only bench page driving the player on a fixture plan; exposes window.__flnEvents/__flnAudios for the bench tool |
| `states.tsx` | Dev-only screenshot page showing every sound control in every state with a fake player and synthetic graphemes |
| `bench.html` | Dev-only Vite page shell for the FLN sound player bench (not in the production build) |
| `states.html` | Dev-only Vite page shell for the sound-control states screenshot page |

## Who reads this (generated)
- (none)

## Never (human)
- Not in the production build, whose only input is index.html (states.tsx:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `portal/src/portal/fln/player/CLAUDE.index.md`? · `portal/src/portal/fln/player/CLAUDE.md`? · `portal/src/portal/fln/player/bench/CLAUDE.md`?
