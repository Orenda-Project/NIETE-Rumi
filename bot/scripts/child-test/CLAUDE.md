# child-test — Print packs, SA battery bank build and SA voice recording for the child test
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/child-test kg=c996a80c9d6a gen=981a72803eb0 overflow=10 rendered=2026-11-24 kg.py=1.1.0 -->

## Entry points
- `build-sa-bank.js` — rebuilds the SA bank and engine JSONs (--check)
- `record-sa-voice.js` — records every SA battery voice line
- `sa-voice-providers.js` — the three TTS provider wrappers
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `record-sa-voice.js` | Records every line the SA battery speaks in the chosen voice, levelled, into dashboard keys served by the SA engine |
| `sa-voice-providers.js` | Wraps the three TTS providers (Soniox, ElevenLabs, Uplift) a reviewed SA voice set can be recorded in |
| `purge-sa-game-audio.js` | Deletes kept game-run recordings older than a window from R2; dry run default, --apply deletes |
| `build-sa-bank.js` | Rewrites the SA battery bank and per-form engine JSONs from the v3 bank plus extra and W3 picks; --check mode |
| `build-print-pack.v*.js` | 2 versions; v3: Builds the child-test print pack v3 (A4 double-sided cover, coach cards, booklets) from the v3 item bank (bd-s1oo0.50.4) |

## Who reads this (generated)
- `sa-voice-providers.js` ← imported by `bot/scripts/child-test/record-sa-voice.js:132:8d394319`
- env read here: `FFMPEG_PATH`

## Never (human)
- purge-sa-game-audio.js is dry run by default; --apply deletes (purge-sa-game-audio.js:9)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/record-sa-voice-v4-english-ops.test.js` (record-sa-voice.js, sa-voice-providers.js)
- `bot/tests/child-test/record-sa-voice-v4-equals.test.js` (record-sa-voice.js, sa-voice-providers.js)
- `bot/tests/child-test/record-sa-voice-v4-held-words.test.js` (record-sa-voice.js, sa-voice-providers.js)
- `bot/tests/child-test/record-sa-voice-v4-letter-names.test.js` (record-sa-voice.js, sa-voice-providers.js)
- `bot/tests/child-test/record-sa-voice-v4-line-fixes.test.js` (record-sa-voice.js, sa-voice-providers.js)
- `bot/tests/child-test/record-sa-voice-v4-praise.test.js` (record-sa-voice.js, sa-voice-providers.js)
- `bot/tests/child-test/record-sa-voice-v4-sounds-alone.test.js` (record-sa-voice.js, sa-voice-providers.js)
- … 10 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`?
