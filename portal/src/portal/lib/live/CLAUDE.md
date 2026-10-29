# live — Live moves while a teacher records: tick state and Soniox stream tee

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/lib/live kg=7f112bda7bf7 gen=d51861002bec overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `liveMovesState.ts` — pure state: ticks only add, taps never change a tick, clock moves the now-move
- `sonioxTee.ts` — second reader of each recorded chunk; push cannot throw into the recording
- Tests sit beside sources (*.test.ts(x)), vitest jsdom: `cd portal && npx vitest run src/portal/lib/live`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `liveMovesState.ts` | bd-v0toag.31: pure state for live moves while a teacher records (ticks, taps, the "now" move, lesson clock) |
| `sonioxTee.ts` | bd-v0toag.31: second reader of each recorded chunk, streaming it to Soniox real time; never blocks the recording |
| `liveMovesState.test.ts` | bd-v0toag.31: pins liveMovesState against the g4_english_ch12 card fixture: ticks only add, taps, now-move, lesson clock |
| `sonioxTee.test.ts` | bd-v0toag.31: pins sonioxTee: key in first message, tokens, reconnect resends chunk 0; never touches the recording |

## Who reads this (generated)
- `liveMovesState.ts` ← imported by `portal/src/portal/newui/coaching/LiveMovesList.tsx:4:554b97dd` · `portal/src/portal/newui/coaching/useLiveMoves.ts:5:158d9c7d`
- `sonioxTee.ts` ← imported by `portal/src/portal/newui/coaching/LiveMovesList.tsx:5:cd3ea024` · `portal/src/portal/newui/coaching/useLiveMoves.ts:4:73af159e`

## Never (human)
- The tee only reads; a drop or refused key must never hold up or touch the recording (lib/live/sonioxTee.ts:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/lib/live/liveMovesState.test.ts` (liveMovesState.ts)
- `portal/src/portal/lib/live/sonioxTee.test.ts` (sonioxTee.ts)
- `portal/src/portal/newui/coaching/LiveMovesList.test.tsx` (liveMovesState.ts)
- `portal/src/portal/newui/coaching/useLiveMoves.test.ts` (sonioxTee.ts)

## Related (generated)
- docs: `portal/src/portal/lib/CLAUDE.md`?
