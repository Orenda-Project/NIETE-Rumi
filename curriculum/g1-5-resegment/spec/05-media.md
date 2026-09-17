# Media — video and voice note

**Parent:** [00-program.md](00-program.md) · Runs alongside Slices 2 and 3. Keyed
on **SLO**, never on day number, so a boundary rebuild does not invalidate it.

Two media artefacts reach the teacher. The video reaches the classroom through
her; the voice note reaches only her, before class. They fail in opposite ways —
a wrong video wastes a period in front of fifty children, a wrong voice note
wastes ninety seconds of her morning — so they get different standards of proof.

---

# 1 · Video → SLO mapping

## What the catalogue already gives us

Source: **[Taleemabad Videos & Quizzes](https://docs.google.com/spreadsheets/d/1BVRPpq2-5XDxqRJs_JpIe6BqgZFCAx9OPeRkhDqrti0)**
(owner `rumi@hellorumi.ai`) — 915 videos in the student video library.

The catalogue is more useful than "a list of links", and this changes the design:

- **Every video already carries an SLO derived from its transcript, not its
  title, with an evidence quote.** The audio was transcribed (Soniox
  `stt-async-v3`, en+ur hints) and the SLO was written against what the video
  actually says.
- Every video has 10 post-video quiz questions written against that SLO, at a
  fixed difficulty spread, with a per-wrong-option response.
- Maths answers were independently re-computed by script; any quiz with a wrong
  marked answer was rejected and rebuilt.

Coverage by subject:

| Subject | Videos | | Subject | Videos |
|---|---|---|---|---|
| Maths | 236 | | Geography | 39 |
| English | 207 | | General Knowledge | 16 |
| Science | 201 | | History | 16 |
| Urdu | 189 | | Islamic Studies | 11 |

## The mapping

Because both sides carry an SLO, this is an **SLO-to-SLO match**, not a
title-keyword search. That is the whole reason it can be trusted enough to put
in front of a class.

Each mapped day gets three columns in the Resources section:

| Column | Holds |
|---|---|
| **Video** | Title and link, as its own column in Resources |
| **Confidence** | How well the video's transcript-SLO matches the day's SLO |
| **Why it maps here** | One line, quoting the video's own evidence line |

**"Why it maps here" is not optional and is not generated prose.** It quotes
what the video says. A teacher who disagrees with a mapping can see, in one
line, what we thought the video taught — and tell us we were wrong.

## Rules

- **An unmapped day says so.** No loosely-related video is promoted to fill the
  column. A blank video cell is information; a wrong one costs a period.
- **Low confidence is shown, not hidden.** If the best match is weak, the row
  shows it as weak rather than dropping to blank or rounding up to strong.
- **Electives will come out mostly unmapped** — 16 GK videos and 11 Islamic
  Studies against 236 Maths. That is a finding to report, not a gap to fill with
  approximations. See [02-electives.md](02-electives.md).
- **The quizzes are a downstream opportunity, not in scope here.** Every mapped
  video already has 10 SLO-aligned questions; whether those become the exit
  check or a homework send is a later decision.

## Known blocker

The build service account **cannot read the video sheet** — it is owned by
`rumi@hellorumi.ai` and shared with the operator, not with the SA, so the Sheets
API returns 403. Either the sheet is shared with the service account, or the
catalogue is exported to a local CSV through the operator's own Drive access.
**Nothing in the mapping can run until one of those happens.**

---

# 2 · The voice note

## The spec is locked and is not being reopened

Operator: *"no the voice note spec seems fine on its own pls, dont change it."*

The authority is `.claude/skills/lp-voicenotes/` — V20 LOCKED for segment notes,
chapter-heart v4 LOCKED — built from 109 feedback items across 16 iteration
rounds. Nothing in this programme edits it. What this file does is decide **which
note primary gets, and what has to be in it**.

Two artefacts, different jobs:

| Artefact | Length | The moment |
|---|---|---|
| **Segment note** | 45–90s | She has the day's plan and teaches in ten minutes |
| **Chapter-heart note** | 90–150s | She has the whole chapter and needs the arc |

Non-negotiables carried over, none of them ours to change: Sara on `eleven_v3`;
body ≥55% Urdu Nastaliq with English content words inline as Latin; never
Roman-Urdu; never Markdown; inline digits spelled as English words; the pre-TTS
scanner runs before every ElevenLabs call, including hand-written drafts.

## What this programme adds

**It replaces the delivery message.** Primary gets no delivery message — the
voice note goes instead. That makes it the only thing some teachers hear before
teaching, which raises the bar on the next point.

**The heart stays, and the note has to teach.** The operator's judgement is that
the heart is very important and must be kept, *and* that the note currently does
not nail the teaching. Both are true at once. The note carries **the moves of the
lesson plan** — what she does first, what the children do, where it usually goes
wrong — with the heart as its frame rather than its content. A note that is all
warmth and no moves is the failure mode being named here.

**Two minutes is a hard ceiling.** *"Voice note cant be more than 2 mnts long
pls!"*

This is **open decision D4**, and it is a real conflict, not a rounding error:
the segment note at 45–90s is comfortably inside the cap; the chapter-heart note
is specified at 90–150s and its top half breaches it. Three options, none of
which this spec takes unilaterally because the brief is locked:

1. **Primary gets segment notes only.** Cap respected, chapter arc lost.
2. **Chapter-heart is rendered to the bottom of its band** (90–120s) for primary,
   leaving the brief untouched and constraining the render.
3. **The brief's band is narrowed for primary** — which is an edit to a locked
   spec and therefore the operator's call, not ours.

## Gate O2

Sample before committing. Generate one segment note and one chapter-heart note
for the same chapter, run both through the scanner, render both, and report:
actual duration, Urdu-character ratio, and whether a listener can name the
lesson's moves afterwards. O2 answers D4 with a measurement instead of a
preference.
