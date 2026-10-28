# player — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/fln/player -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `bench/` | Dev-only pages for benchmarking and screenshotting the sound player → `bench/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `FlnPlayer.ts` | createFlnPlayer: the audio engine, one clip at a time, prefetch/warm, state events, retry, timing (player.md v2) |
| `SoundPill.tsx` | Inline sound button in a lesson step: idle/loading/playing/error states by icon, aria-live text, fixed box (A10/A11) |
| `SoundTile.tsx` | Tile in the sounds grid: big grapheme with keyword caption, narration tile spans two columns; same states as SoundPill |
| `clips.ts` | Derives clips from a plan: one clip per distinct audio file in first-appearance order; clipIdOf, boldRun, fileStem |
| `index.ts` | Public surface of the FLN sound player (hook, provider, SoundGrid/Pill/Tile, types); the page imports only from here |
| `player.css` | Sound control styles scoped under .fln-snd; beats index.css's global Urdu font rule for English controls |
| `types.ts` | Types for the sound player: structural plan shape, Clip, PlayerState/Event, FlnPlayer API and deps |
| `useFlnPlayer.ts` | useFlnPlayer hook plus FlnPlayerProvider/context: one player per plan page, stops sound when page hides |

## Who reads this (all, generated)
- `FlnPlayer.ts` ← imported by `portal/src/portal/fln/player/index.ts:22:88a42e97` · `portal/src/portal/fln/player/useFlnPlayer.ts:2:a08ee82b`
- `SoundPill.tsx` ← imported by `portal/src/portal/fln/player/SoundTile.tsx:3:5003dd65` · `portal/src/portal/fln/player/index.ts:25:b173f424` · `portal/src/portal/fln/player/bench/states.tsx:10:47713ce4`
- `SoundTile.tsx` ← imported by `portal/src/portal/fln/plan/SoundGrid.tsx:5:d814f36e` · `portal/src/portal/fln/player/index.ts:26:c91b7379` · `portal/src/portal/fln/player/bench/states.tsx:11:16270c6a`
- `clips.ts` ← imported by `portal/src/portal/fln/plan/SoundGrid.tsx:3:11f7429e` · `portal/src/portal/fln/player/index.ts:24:e993e5f0` · `portal/src/portal/fln/player/useFlnPlayer.ts:3:3b33ba76`
- `index.ts` ← imported by `portal/src/portal/fln/PlanPage.tsx:24:6a0f866d` · `portal/src/portal/fln/plan/Move.tsx:7:38559e68` · `portal/src/portal/fln/plan/Section.tsx:11:e71bc90a` · `portal/src/portal/fln/player/bench/bench.tsx:9:e31259d6`
- `player.css` ← imported by `portal/src/portal/fln/plan/SoundGrid.tsx:8:835f3892` · `portal/src/portal/fln/player/SoundPill.tsx:6:943f34ed` · `portal/src/portal/fln/player/SoundTile.tsx:6:943f34ed`
- `types.ts` ← imported by `portal/src/portal/fln/plan/SoundGrid.tsx:6:06021f22` · `portal/src/portal/fln/player/FlnPlayer.ts:9:716453f5` · `portal/src/portal/fln/player/SoundPill.tsx:4:6c1c92c5` · `portal/src/portal/fln/player/SoundTile.tsx:4:5b903937` (+4: `python3 kg/kg.py who-reads types.ts`)
- `useFlnPlayer.ts` ← imported by `portal/src/portal/fln/plan/SoundGrid.tsx:4:f46f4686` · `portal/src/portal/fln/player/SoundPill.tsx:3:7af19bf5` · `portal/src/portal/fln/player/SoundTile.tsx:2:7af19bf5` · `portal/src/portal/fln/player/index.ts:23:829f39a0` (+1: `python3 kg/kg.py who-reads useFlnPlayer.ts`)

## Tests (all, generated)
- `FlnPlayer.ts` ← `portal/src/portal/fln/tests/player.test.ts`
- `SoundPill.tsx` ← `portal/src/portal/fln/tests/tile-shift.test.tsx` · `portal/src/portal/fln/tests/ui-owner.test.tsx` · `portal/src/portal/fln/tests/ui.test.tsx`
- `SoundTile.tsx` ← `portal/src/portal/fln/tests/tile-shift.test.tsx` · `portal/src/portal/fln/tests/ui-owner.test.tsx` · `portal/src/portal/fln/tests/ui.test.tsx`
- `clips.ts` ← `portal/src/portal/fln/tests/clips.test.ts`
- `types.ts` ← `portal/src/portal/fln/tests/clips.test.ts` · `portal/src/portal/fln/tests/player.test.ts` · `portal/src/portal/fln/tests/tile-shift.test.tsx` · `portal/src/portal/fln/tests/ui-owner.test.tsx` · `portal/src/portal/fln/tests/ui.test.tsx`
- `useFlnPlayer.ts` ← `portal/src/portal/fln/tests/player.test.ts` · `portal/src/portal/fln/tests/tile-shift.test.tsx` · `portal/src/portal/fln/tests/ui-owner.test.tsx` · `portal/src/portal/fln/tests/ui.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/fln/CLAUDE.index.md`? · `portal/src/portal/fln/CLAUDE.md`? · `portal/src/portal/fln/player/CLAUDE.index.md`? · `portal/src/portal/fln/player/CLAUDE.md`? · `portal/src/portal/fln/player/bench/CLAUDE.md`? · `portal/src/portal/fln/tests/CLAUDE.index.md`?
