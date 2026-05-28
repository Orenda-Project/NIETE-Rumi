# 🎯 Classroom Coaching

![Classroom Coaching](../images/features/coaching.jpg)

> The best time to coach a teacher is right after they teach. Rumi turns a class **audio recording** into a scored, framework-based coaching report — and a spoken reflective conversation — within minutes.

📄 **See a sample report:** [coaching-report-sample.pdf](../samples/coaching-report-sample.pdf) — the MEWAKA "hero" celebration report (the current shipped design), rendered by the actual pipeline (`node scripts/render-sample-report.js`).

## What it is

A teacher records part of a lesson as **audio** on their phone and sends the voice note to Rumi on WhatsApp. Rumi transcribes it, scores it against a research-backed classroom-observation framework, talks the teacher through a short reflection, and returns a professional PDF report with concrete next steps. No coach, no scheduled visit, no travel — just the phone in their pocket.

## How it works

1. **Teacher records** their classroom as audio and sends the voice note to Rumi. _(Audio only — Rumi does not process classroom video.)_
2. **Rumi transcribes** the recording (Soniox, with Whisper fallback), handling multilingual and code-switched speech.
3. **Rumi scores** the transcript against the teacher's selected framework:
   - **OECD** — the OECD Global Teaching InSights observation framework
   - **HOTS** — a higher-order-thinking classroom-observation tool
   - **TEACH** — the World Bank's TEACH observation tool
   - **FICO** — a domain-based observation framework

   (These four are the selectable scoring frameworks, registered in `framework-registry.js`.) The OSS bot also includes a **MEWAKA** report path (a Tanzania teacher-CPD format) — when a session's framework is `mewaka`, the report is rendered by a dedicated transformer + template (`pdf-report.service.js`, `framework === 'mewaka'`).
4. **Optional classroom photo analysis** — if the teacher also sends a photo, Rumi uses vision AI to score things only a picture can show (seating, materials, board use).
5. **Reflective conversation** — Rumi asks a few voice-delivered questions that prompt the teacher to think about specific moments in their own lesson.
6. **PDF report** — scores per goal, evidence quoted from the transcript, growth areas, prioritised recommendations, and charts. It ends with a coaching card naming the single highest-leverage next action.
7. **Progress over time** — each session remembers the last one, so feedback builds instead of repeating.

## What the teacher experiences

Send a recording → get a friendly "working on it" message → a few minutes later have a **short reflective voice conversation** (questions grounded in specific moments of *her own* lesson) → then a **scored celebration report** (image) → and finally a **commitment card** naming the one thing to try in the next class. The tone is supportive, never punitive.

### Walkthrough — what an adopter's teacher actually receives

A real, anonymized session in Kiswahili (teacher renamed **Asha**, students renamed too). Three artefacts arrive in order:

**1. The reflective conversation** — turn-based, in *her* language, grounded in moments from *her* lesson (not a generic prompt). English glosses + callouts explain what makes each turn coaching.

![Reflective conversation — Asha, Kiswahili (3 turns with English glosses + callouts)](../images/walkthroughs/1_reflective_conversation.png)

**2. The hero report** — scored, single-page A4 celebration design, delivered as an inline WhatsApp **image with caption** (not a PDF document). Header score · per-domain bars · "Your strength" + "Your next horizon" · the cross-session journey trend · the one thing to try next class. Caption: `📋 Ripoti yako ya ufundishaji · Maumbo ya namba 1–9 · 2026-05-26`.

![Hero coaching report — Asha, 60% Inakua, six MEWAKA domains, journey trend, next-step](../images/walkthroughs/2_hero_report.png)

**3. The commitment card** — separate image that arrives after the report. Content is **the teacher's own forward-commitment** from her Q3 answer (verbatim) fused with one specific, lesson-rooted action. Highlighted phrases call out what to actually *do*.

![Commitment card — Asha's own Q3 commitment + one specific action for next class](../images/walkthroughs/3_commitment_card.png)

These three artefacts are the live shipped Tanzanian (MEWAKA) experience. Follow-up PRs make this the **default for every framework**, not just MEWAKA — so OECD/HOTS/TEACH/FICO adopters get the same celebration design rendered against their framework's own scorecard.

## Enable it

Set **`SONIOX_API_KEY`** (transcription). For spoken reflective questions, also set `ELEVENLABS_API_KEY`. The framework is chosen per teacher and stored on their profile.

## Customize

Swap or add frameworks, change scoring rubrics, or adjust the reflection style — see [Agent Customization §1](../agent-customization.md#1-swap-the-coaching-framework).
