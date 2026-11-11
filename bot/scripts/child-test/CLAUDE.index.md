# child-test — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/scripts/child-test -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `build-print-pack-v2.js` | Builds the child-test print pack v2 PDFs (coach set, cards per grade, Set A/B) from the item bank (bd-s1oo0.46.5) |
| `build-print-pack-v3.js` | Builds the child-test print pack v3 (A4 double-sided cover, coach cards, booklets) from the v3 item bank (bd-s1oo0.50.4) |
| `build-sa-bank.js` | Rewrites the SA battery bank and per-form engine JSONs from the v3 bank plus extra and W3 picks; --check mode |
| `purge-sa-game-audio.js` | Deletes kept game-run recordings older than a window from R2; dry run default, --apply deletes |
| `record-sa-voice.js` | Records every line the SA battery speaks in the chosen voice, levelled, into dashboard keys served by the SA engine |
| `sa-voice-providers.js` | Wraps the three TTS providers (Soniox, ElevenLabs, Uplift) a reviewed SA voice set can be recorded in |

## Who reads this (all, generated)
- `sa-voice-providers.js` ← imported by `bot/scripts/child-test/record-sa-voice.js:132:8d394319`
- env `FFMPEG_PATH` read at `bot/scripts/child-test/record-sa-voice.js:201:a2264dda`

## Tests (all, generated)
- `purge-sa-game-audio.js` ← `bot/tests/sa-game/sa-game-audio-purge.test.js`
- `record-sa-voice.js` ← `bot/tests/child-test/record-sa-voice-v4-english-ops.test.js` · `bot/tests/child-test/record-sa-voice-v4-equals.test.js` · `bot/tests/child-test/record-sa-voice-v4-held-words.test.js` · `bot/tests/child-test/record-sa-voice-v4-praise.test.js` · `bot/tests/child-test/record-sa-voice-v4-relevel.test.js` · `bot/tests/child-test/record-sa-voice-v4-sounds.test.js` (+5: `python3 kg/kg.py who-reads bot/scripts/child-test/record-sa-voice.js`)
- `sa-voice-providers.js` ← `bot/tests/child-test/record-sa-voice-v4-english-ops.test.js` · `bot/tests/child-test/record-sa-voice-v4-equals.test.js` · `bot/tests/child-test/record-sa-voice-v4-held-words.test.js` · `bot/tests/child-test/record-sa-voice-v4-praise.test.js` · `bot/tests/child-test/record-sa-voice-v4-sounds.test.js` · `bot/tests/child-test/record-sa-voice-v4.test.js`

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.md`?
