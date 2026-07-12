# Audio LP — Deferred Roadmap

**Status**: Deferred (scoped 2026-07-12). Pick up after v7 math-English ships and stabilizes.

## What this is

Layer a **90-120 second voicenote narration** on top of every lesson plan we deliver. Teacher receives:
1. The PDF (as today)
2. Followed by a WhatsApp voicenote — a warm coach-style walkthrough that highlights the pedagogical moves, common misconceptions, and the load-bearing 1-2 things the teacher should watch for in class

Not a replacement for the PDF — a companion.

## Why this is worth ~1 week of work later

The teacher-facing benefit is disproportionate to the engineering cost. Voicenote is Rumi's most-used channel for teacher-to-Rumi messages (voice > text) so making Rumi *speak back* in the same modality matters. And most of the plumbing already exists.

## What's already there (no new engineering needed)

| Piece | Where |
|---|---|
| TTS provider — **ElevenLabs** (Sara voice `9cI5mhBtM4WtQ9Fo6jWQ`, `eleven_v3` model with emotion tags) | `bot/shared/services/elevenlabs.service.js` |
| TTS fallback for Urdu/Sindhi/Balochi — **Uplift AI** | `bot/shared/services/audio.service.js` (lines 641-773) |
| **WhatsApp voicenote delivery** (`sendAudio`, `sendAudioFromUrl`, OGG-Opus mime type) | `bot/shared/services/whatsapp.service.js` |
| Env vars: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `UPLIFT_API_KEY` | `.env` |
| Async worker pattern (ack + queue + cache + delivery) | `bot/workers/lesson-plan-generation.worker.js` (from this session) |
| **Battle-tested narration playbook** — 109 feedback items across 16 iteration rounds, V20 spec locked | `.claude/skills/lp-voicenotes/SKILL.md` |

## What's genuinely new

1. **Narration prompt template adapted for LP scope**. The lp-voicenotes skill locks a great pattern for *textbook segments*, but LPs are structurally different. Need a fresh prompt targeting: (a) the LP topic, (b) the 6-slide v7 flow, (c) the "coach's corner" style — warm, brief, ends on a self-check question.
2. **New service** `bot/shared/services/voicenote-lp.service.js` — mirrors `grounded-lp-render.service.js`. Calls ElevenLabs → encodes OGG-Opus → uploads R2 → returns cache key.
3. **Worker step** — after v7 PDF is cached + delivered, kick off voicenote render + delivery. Parallel R2 cache lane at `lps/curriculum-ast-v7/{uuid}.en.ogg`.
4. **Duration gate** — per lp-voicenotes rule #7, ~15% of PROJ-42 audios ended mid-sentence. Compute expected duration from text length; regenerate if actual < 80%.

## Effort estimate

**4-5 days engineering + 1-2 iteration sessions.** Sequenced:

| Day | Work |
|---|---|
| 1 | Prompt adaptation from `.claude/skills/lp-voicenotes/reference/segment-brief.md` to LP scope |
| 2 | `voicenote-lp.service.js` service + OGG-Opus encoder (ffmpeg `libopus 32k mono 48000 -application voip`) |
| 3 | Worker wiring: after PDF delivery, generate voicenote → upload → send. Cache lane. Failure isolation (voicenote failure ≠ PDF failure) |
| 4 | Duration gate + 3-5 test LPs eyeballed for pronunciation, timing, coach-tone |
| 5 | Buffer / eval iterations |

## Blocking risks to resolve before starting

1. **Does Sara pronounce math English cleanly?** Sara is locked for Urdu — English math vocabulary (addition, digit-column, subtract) may glitch. Verify with a $0.04 test render of 3 sentences before committing 4-5 days.
2. **Timing** — a 90-120s voicenote is a big commitment for the teacher's WhatsApp thread. First-cut length may need to shrink to 60-90s.
3. **Async delivery UX** — currently we send `📝 Preparing your lesson plan...` then the PDF. When we add audio, the teacher gets three messages: ack → PDF → voicenote. Design the sequencing: is there a second ack ("🎧 Recording a voicenote walkthrough..."), or does the voicenote just arrive silently after the PDF?

## Cost model (fits your on-demand + no-pre-render decision)

- First teacher per LP: ~$0.58 (v7 PDF ~$0.54 + ElevenLabs ~$0.04)
- Subsequent teachers: ~$0 — both hit R2 cache
- No pre-render investment. Purely demand-driven.

## What to reference when you pick this up

- `.claude/skills/lp-voicenotes/SKILL.md` — full V20 spec, prompt discipline, scanner rules
- `.claude/skills/lp-voicenotes/reference/segment-brief.md` — the pattern to adapt for LP scope
- `.claude/skills/kie-ai-imagegen/SKILL.md` (Nastaliq / diacritics rules apply to audio prompt language too)
- This document — the sequenced plan
