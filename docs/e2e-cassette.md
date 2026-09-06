# E2E cassette — replaying vendor calls so coaching E2E runs take minutes, not half an hour

**Staging only. Off by default. Forced off against the production database.**

## The problem it solves

A classroom-coaching E2E scenario uploads the same 16-minute recording every run and then waits on
three vendors: Soniox (transcription, 2–4 min), the LLM (FICO analysis, reflective question,
narrative, commitment card — 4–8 min across several calls) and ElevenLabs (voice debrief). On
2026-09-02 the DEEP coaching feature took 23.5 of a 59-minute `/niete-e2e all`. None of that time
tests our code; it re-buys the vendors' answers to identical requests.

## What it does

`bot/shared/services/e2e-cassette.js` sits at three seams and, for an identical request, returns
the vendor's previous answer instead of calling the vendor:

| seam | key = what determines the answer | stored |
|---|---|---|
| `AudioService._transcribeOnce` | sha256 of the audio **bytes** + diarization + language + roles | the transcription result object |
| `llm-client` `chat.completions.create` | the full request params (model, messages, temperature…) | the completion response |
| `ElevenLabsService._postTts` | url + body (text, voice settings) | `{status, headers, audio as base64}` |

Because the key is the request, a changed prompt, a new fixture or a different voice is a **miss**:
the call goes live and is recorded, so one slow run makes every later run fast. Cassettes make the
suite fast, never blind. Streaming LLM calls bypass the cassette. A thrown vendor error is never
recorded.

## Modes

| `E2E_CASSETTE` | behaviour |
|---|---|
| `off` (default, or unset, or anything else) | every call is live; nothing is written |
| `record` | every call is live; the answer is stored |
| `replay` | stored answer if present; otherwise live **and** stored |

Whatever the variable says, `mode()` returns `off` when `SUPABASE_URL` contains the NIETE
production project ref. That guard is a unit test, not a comment.

## Where cassettes live

One JSON file per key under `E2E_CASSETTE_DIR` (default `bot/temp/e2e-cassettes`). When
`R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` are set, each record is
mirrored to R2 under `e2e-cassettes/<key>.json` and a local miss is checked against R2 before going
live — so a Railway redeploy (ephemeral disk) does not lose the library.

## How to use it with the WhatsApp E2E suite

1. On the **NIETE-Rumi Staging** Railway project set `E2E_CASSETTE=replay` on `bot` and
   `sqs-worker` (the worker runs the pipeline; the bot handles the short voice-note path).
2. Run `/niete-e2e all` once — that run is slow and records.
3. Every later run of the same fixtures replays: coaching drops from ~23 min to the product's own
   waits (photo gate, lesson-plan gate, the reflective turn) plus WhatsApp round trips.
4. Weekly, or after a prompt change you want exercised for real, run once with `E2E_CASSETTE=record`
   to refresh the library — or just delete the affected keys.

## What it deliberately does not touch

WhatsApp delivery, native Flows, button taps, the report render, R2 uploads of the teacher's own
media, and the product's timers. Those are the point of an end-to-end test.

## Tests

`bot/tests/unit/e2e-cassette.test.js` — mode gating (incl. the production guard), key stability,
off/record/replay semantics, error non-recording, Buffer round-trip, and the streaming bypass on the
LLM wrapper. Red-first against `develop` (module absent), 13/13 green with the implementation.
