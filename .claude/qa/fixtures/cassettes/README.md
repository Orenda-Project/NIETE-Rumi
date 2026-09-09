# Vendor cassette fixtures

Recorded answers for the vendor calls the mock lane cannot make live — Soniox transcription and the
OpenRouter LLM analysis (coaching), and any other LLM/ASR/TTS call a scenario reaches. One JSON file
per call, keyed by a hash of the request, exactly like `flows/` holds the Flow definitions.

**Record once, replayed by every run and every clone.** The mock lane runs `E2E_CASSETTE=replay-strict`:
a call with a recording here is replayed; a call without one FAILS the scenario (it never goes live),
and the miss is logged. So a green coaching/LLM scenario is proven against a real recorded answer, never
a fabricated one.

## Populating it (one time, needs real vendor keys)

    bash .claude/qa/shared/commit-e2e.sh HEAD --features coaching --record

`--record` un-seals the lane for that single run: it uses `keys/niete-record.env` (real Soniox /
OpenRouter / ElevenLabs keys — gitignored, never the sealed default), sets `E2E_CASSETTE=record`, drives
the deep pipeline for real, and writes the answers here. It makes LIVE, paid calls. Review the new
`*.json`, then commit them — from then on every replay uses them and needs no keys and no network.

Do NOT hand-write cassettes: a fabricated transcription/analysis would make the tests assert against
invented data and hide real bugs. A cassette is only ever a real recorded answer.
