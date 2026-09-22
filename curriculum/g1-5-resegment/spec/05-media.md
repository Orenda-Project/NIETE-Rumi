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

Each mapped day gets TWO things in the Resources section:

| What | Holds |
|---|---|
| **Video** | Title and link |
| **What it covers** | One line, quoting the video's own evidence line |

This was three columns for one bead (bd-nsv74), the third being a
`Match: high|medium|low` grade. The operator cut it (bd-s429u): *"for the video,
just its URL and a description of what it entails is enough."*

`confidence` still rides on the document and stays in the schema — it is what
ranked the candidates at harvest time, so it is the join's own provenance and
dropping it would lose that. It is simply never painted.

**The description is not optional and is not generated prose.** It quotes
what the video says. A teacher who disagrees with a mapping can see, in one
line, what we thought the video taught — and tell us we were wrong. That is the
job the grade was doing less well.

## Rules

- **No loosely-related video is promoted to fill the column.** A day with no
  honest match stays unmapped; a wrong video costs a period in front of fifty
  children.
- **An unmapped day prints no video row at all** — not an empty row, not a
  "design pending" note. This half of the rule was REVERSED by the operator
  (bd-jka9b): *"what is pending is not relevant for Primary."* The renderer used
  to paint "design pending — no video mapped yet" on an unmapped day, on the
  reasoning that a blank cell is itself information. It is information for US,
  not for her — she cannot act on it, and the rationale given for it (the 403
  corrected below) was false. Primary now behaves as G6-12 always has: no pick, no line.
- **No grade is shown at any level.** The rule here used to read *"Low
  confidence is shown, not hidden"* — if the best match is weak, show it weak
  rather than rounding up. It went with the column in bd-s429u: we no longer
  paint a grade at any level, so there is no level at which one could be hidden.
  What the teacher gets instead is the description — she can read what the clip
  actually covers and judge the match herself, which is stronger evidence than a
  one-word grade.
- **Electives will come out mostly unmapped** — 16 GK videos and 11 Islamic
  Studies against 236 Maths. That is a finding to report, not a gap to fill with
  approximations. See [02-electives.md](02-electives.md).
- **The quizzes are a downstream opportunity, not in scope here.** Every mapped
  video already has 10 SLO-aligned questions; whether those become the exit
  check or a homework send is a later decision.

## There was never a blocker — what the 403 actually was

This section used to say the build service account **could not read the video
sheet**, that the Sheets API returned 403, and that *"nothing in the mapping can
run until"* the sheet was reshared. All three claims were wrong, and they sat
here long enough to be quoted as a reason in four other places (bd-v2ikv,
bd-jka9b). The correction, so nobody re-derives the false version:

- **The Sheet was never 403 to the build account.** It reads fine. The mapping
  ran against it and produced `data/videos-by-slo.json` — 658 SLOs, 1,461 videos.
- **The 403 was a User-Agent block on `r2.dev`**, the CDN the video FILES sit
  behind — a different host from the Sheet entirely. `r2.dev` rejects
  `Python-urllib/3.x` and accepts a browser UA. It is a fetch-time header
  problem, not a permissions problem, and it never touched the catalogue.

## Resolving a video to a URL

The catalogue carries two link shapes and both have to be handled:

| Shape | Rows | Resolution |
|---|---|---|
| A full URL | 617 | Used as-is |
| A bare library key | 844 | `https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/videos/<key>.mp4` |

## The join key, measured

**SLO alone is the key** — not grade, not subject, not the day number. Measured
on the catalogue: keying on SLO gives **658** distinct keys; keying on
grade+subject+SLO gives **659**. The one-key difference is the whole argument —
the SLO code already encodes its grade and subject, so adding them to the key
buys nothing and couples the mapping to fields that a boundary rebuild changes.

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
