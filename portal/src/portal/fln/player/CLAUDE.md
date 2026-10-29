# player — FLN sound player engine and its pill/tile controls
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/fln/player kg=dee0897327af gen=c9ee10538c7b overflow=10 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `index.ts` — the only import surface the page may use
- `FlnPlayer.ts` — engine: one clip at a time, prefetch, retry
- `useFlnPlayer.ts` — one player per plan page
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `bench/` | Dev-only pages for benchmarking and screenshotting the sound player → `bench/CLAUDE.md` |
| `types.ts` | Types for the sound player: structural plan shape, Clip, PlayerState/Event, FlnPlayer API and deps |
| `useFlnPlayer.ts` | useFlnPlayer hook plus FlnPlayerProvider/context: one player per plan page, stops sound when page hides |
| `SoundPill.tsx` | Inline sound button in a lesson step: idle/loading/playing/error states by icon, aria-live text, fixed box (A10/A11) |
| `SoundTile.tsx` | Tile in the sounds grid: big grapheme with keyword caption, narration tile spans two columns; same states as SoundPill |
| `index.ts` | Public surface of the FLN sound player (hook, provider, SoundGrid/Pill/Tile, types); the page imports only from here |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `types.ts` ← imported by `portal/src/portal/fln/plan/SoundGrid.tsx:6:06021f22` · `portal/src/portal/fln/player/FlnPlayer.ts:9:716453f5` (+6)
- `useFlnPlayer.ts` ← imported by `portal/src/portal/fln/plan/SoundGrid.tsx:4:f46f4686` · `portal/src/portal/fln/player/SoundPill.tsx:3:7af19bf5` (+3)
- `index.ts` ← imported by `portal/src/portal/fln/PlanPage.tsx:24:6a0f866d` · `portal/src/portal/fln/plan/Move.tsx:7:38559e68` (+2)
- `SoundPill.tsx` ← imported by `portal/src/portal/fln/player/SoundTile.tsx:3:5003dd65` · `portal/src/portal/fln/player/index.ts:25:b173f424` (+1)
- … 4 more → `CLAUDE.index.md`

## Never (human)
- Import only from player/index.ts; the player stands alone, nothing from the teacher kit (types.ts:3-4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/fln/tests/tile-shift.test.tsx` (SoundPill.tsx, SoundTile.tsx, types.ts, useFlnPlayer.ts)
- `portal/src/portal/fln/tests/ui-owner.test.tsx` (SoundPill.tsx, SoundTile.tsx, types.ts, useFlnPlayer.ts)
- … 4 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/fln/CLAUDE.md`?
