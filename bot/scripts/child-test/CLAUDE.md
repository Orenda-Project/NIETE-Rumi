# child-test — Print packs, SA battery bank build and SA voice recording for the child test

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/child-test kg=cbeb0bd60be8 gen=4a2ee58c2678 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `build-sa-bank.js` — rebuilds the SA bank and engine JSONs (--check)
- `record-sa-voice.js` — records every SA battery voice line
- `sa-voice-providers.js` — the three TTS provider wrappers
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `record-sa-voice.js` | Records every line the SA battery speaks in the chosen voice, levelled, into dashboard keys served by the SA engine |
| `CLAUDE.md` | (unmapped) |
| `sa-voice-providers.js` | Wraps the three TTS providers (Soniox, ElevenLabs, Uplift) a reviewed SA voice set can be recorded in |
| `purge-sa-game-audio.js` | Deletes kept game-run recordings older than a window from R2; dry run default, --apply deletes |
| `build-print-pack-v2.js` | Builds the child-test print pack v2 PDFs (coach set, cards per grade, Set A/B) from the item bank (bd-s1oo0.46.5) |
| `build-print-pack-v3.js` | Builds the child-test print pack v3 (A4 double-sided cover, coach cards, booklets) from the v3 item bank (bd-s1oo0.50.4) |
| `build-sa-bank.js` | Rewrites the SA battery bank and per-form engine JSONs from the v3 bank plus extra and W3 picks; --check mode |

## Who reads this (generated)
- `sa-voice-providers.js` ← imported by `bot/scripts/child-test/record-sa-voice.js:120:8d394319`

## Never (human)
- purge-sa-game-audio.js is dry run by default; --apply deletes (purge-sa-game-audio.js:9)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/record-sa-voice-v4.test.js` (record-sa-voice.js, sa-voice-providers.js)
- `bot/tests/child-test/sa-voice-sustained-sounds.test.js` (record-sa-voice.js)
- `bot/tests/child-test/sa-voice-tashdeed.test.js` (record-sa-voice.js)
- `bot/tests/child-test/sa-voice.test.js` (record-sa-voice.js)
- `bot/tests/sa-game/sa-game-audio-purge.test.js` (purge-sa-game-audio.js)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/child-test/CLAUDE.md`? · `bot/tests/child-test/CLAUDE.index.md`? · `bot/tests/child-test/CLAUDE.md`? · `bot/tests/sa-game/CLAUDE.md`?
