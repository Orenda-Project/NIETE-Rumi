# Stage C enrichment — worker brief (bd-20n98)

**One brief, every worker.** Your prompt names your slice; everything else is here.

## Do the whole task yourself in this one agent. Do NOT spawn sub-agents and do
## NOT write merge scaffolding. You own one slice, start to finish.

---

## What you are doing

The Grades 1-5 resegmentation matrix has enrichment columns standing at
`pending`. You fill them for **one slice** (one subject, one grade). You are
annotating days that already exist — you are not designing lessons, not
changing SLOs, and not touching segmentation.

**Your input:** `$SLICE` (an absolute path, given in your prompt). JSON:

```
{"slice": "english_G1", "subject": "English", "grade": 1, "band": "G1-2",
 "columns_to_fill": [...],
 "rows": [{"row": 6, "day": "Day 1", "chapter": 1, "chapter_title": "...",
           "topic": "...", "skill_type": "...", "pages": "2",
           "slo": "E-01-VO-01", "slo_desc": "...",
           "supporting": "...", "supporting_desc": "...",
           "bloom": "remember", "strand": "language-focus",
           "shape": "language_focus",
           "spine": "warm_up·2 | hook·3 | ...",
           "prior_slos_available": ["E-01-PH-01", ...]}, ...]}
```

**Your output:** write `$OUT` (also given in your prompt) as JSON:

```
{"slice": "english_G1",
 "cells": {"6":  {"Reading strategy": "...", "Collaboration structure": "...", ...},
           "12": {...}}}
```

One key per `row` value, as a string. Every column in `columns_to_fill`, every
row. No extra keys, no extra columns.

---

## What you must NOT write

`Moves`, `Teacher-primary min (of 40)` and `Strand` are **already filled** and
are not yours. `Moves` is derived from the skill type and grade band and is shown
to you as `spine` so you can see how the 40 minutes are spent — annotate to fit
it, never contradict it. If you emit any of these three columns your output is
rejected whole.

---

## The columns

### `Reading strategy`
One value, exactly:

  - `activate-prior-knowledge`
  - `predict`
  - `set-purpose`
  - `pre-teach-vocabulary`
  - `decode-blend`
  - `sight-word-recognition`
  - `choral-echo-read`
  - `repeated-read-fluency`
  - `partner-read`
  - `question-generate`
  - `clarify`
  - `visualise`
  - `infer`
  - `summarise`
  - `retell`
  - `text-structure`
  - `skim-scan`
  - `n/a`

`n/a` is a legitimate answer and an honest one — a Maths `Concrete` day teaching
place value with counters has no reading strategy, and saying so is better than
inventing one. Use it. But a `comprehension` shape day that says `n/a` is a
defect: english-skill-types.md requires an explicit strategy taught I-do / we-do
/ you-do on every reading-comprehension day.

### `Collaboration structure`
One value, exactly:

  - `think-pair-share`
  - `partner-dictation`
  - `partner-sound-check`
  - `describe-and-guess`
  - `info-gap-pairs`
  - `jigsaw`
  - `numbered-heads`
  - `round-robin`
  - `peer-check`
  - `group-task`
  - `mingle-find-someone`
  - `role-play`
  - `whole-class-only`
  - `individual-only`

`whole-class-only` and `individual-only` are real answers for days that genuinely
are that. Use them honestly rather than dressing a choral drill as `think-pair-share`.

**Choose on the day's own activity — the Topic, the SLO, what the children are
actually asked to produce.** Read the row before you answer it.

**The move spine is NOT evidence here.** Moves are derived from skill type and
grade band, so every day of a given skill type carries the same phases. A
`peer_review` step appears on nearly every row by construction. Reasoning "the
spine has peer_review, so the structure is `peer-check`" is reasoning from a
constant, and it produces a column that is identical on every day and therefore
useless. That is the single most common way this column is failed.

What the day is doing usually points at the structure:

| The day asks children to | Structures that fit |
| --- | --- |
| handle objects, count or build something together | `group-task`, `round-robin`, `describe-and-guess` |
| commit to an answer, then compare it | `think-pair-share`, `peer-check`, `numbered-heads` |
| tell a partner something the partner cannot see | `info-gap-pairs`, `describe-and-guess` |
| split a text or task and teach each other the parts | `jigsaw`, `group-task` |
| hear, say and check sounds, spellings or words | `partner-dictation`, `partner-sound-check` |
| read connected text to or with someone | `partner-read` is a reading strategy; pair it with `peer-check` |
| speak in role, or use the language socially | `role-play`, `mingle-find-someone` |
| work alone, or watch a demonstration | `individual-only`, `whole-class-only` |

**A slice is checked for flatness.** If one value lands on more than 60% of your
rows *and nothing else reaches 25%*, the column is dead and the slice is
rejected. A dominant value with a real runner-up is fine — it still tells days
apart. Separately, for this column only, a skill type with 8 or more days
sitting on a single value is rejected. Do NOT respond to this by sprinkling variety: a flat
column is a symptom of reading the spine instead of the day, and the fix is to
go back and read the days. Genuine repetition inside a *small* skill type is
fine and is not counted against you.

### `Prerequisite SLOs`
Comma-separated SLO codes **from `prior_slos_available` only** — that list is
every code taught on a strictly earlier day in this grade and subject. A code
that is not in that list is a forward reference and will be rejected. `none` is
correct and expected on the first days of a grade; write it rather than reaching.

Cite what the day genuinely depends on, usually one or two codes. Do not list
every earlier code.

---

## Language slices only (English, Urdu)

Maths and Science slices stop above. These four are additional.

### `Function`
The **child-facing can-do**, in the child's own register, taken from what the
day's SLO actually asks for. Never invented, never a restatement of the teacher's
objective. Short: "I can ask a friend what they like." / "میں اپنے گھر کے بارے میں بتا سکتا ہوں۔"

Write it in the language of instruction for the subject: English slices in
English, Urdu slices in Urdu.

### `Interaction`
One value, exactly:

  - `individual`
  - `teacher↔class`
  - `pair`
  - `group`
  - `mingle`

### `Gap`
One value, exactly:

  - `none`
  - `one-way`
  - `two-way`
  - `reasoning`
  - `opinion`

**`Interaction` and `Gap` are separate questions and both are needed.** A whole
term of `pair` at `Gap: none` is choral practice in pairs, and only both columns
together reveal it. **Never** replace either with a high/medium/low
"communicative focus" scale: it is unauditable and it hides the failure it is
meant to surface. Any such value is rejected.

**And they are checked together, not only separately.** If more than 60% of your
rows put children together (`pair`, `group`, `mingle`) at `Gap: none`, the slice
is rejected as choral practice in pairs. Neither column is wrong on its own
there — the pair of them is.

The honest response is not to relabel gaps upward. It is to notice that children
saying the same thing side by side have no information gap, then check whether
the day's activity really is that, or whether you read it too quickly.

`Gap` asks what the children do not already know about each other's answer:
- `none` — everyone can see or predict the answer (choral repetition, copying)
- `one-way` — one child holds information the other lacks
- `two-way` — each holds part, both must speak to complete it
- `reasoning` — the answer must be worked out, not transferred
- `opinion` — the answer differs by child and cannot be checked as right

A `none` gap is an honest finding on a decoding day. Write it. Do not upgrade
gaps to make the curriculum look communicative — surfacing where it is not is
exactly what this column is for.

### `Recycles`
Earlier functions or vocabulary this day re-meets, so that encounters-per-item
become computable. Short comma-separated phrases or codes, or `none` on a day
that genuinely introduces without recycling. Ground it in the earlier days of
your own slice — you can see them all.

---

## The Speaking / Listening floor — a hard rule

On any day whose `skill_type` names speech or listening (English
`Oral communication`; Urdu `بلند خوانی · Reading aloud`; Science `Engage`):

- `Interaction` may **not** be `individual` and may **not** be `teacher↔class`
- the spine already guarantees ≥5 minutes of child production; do not annotate
  against it

---

## How your work is checked

Your output runs through `stagec.py` — the same gate that produced the spines.
Every value is checked against the vocabularies above, every prerequisite
against `prior_slos_available`, every oral day against the floor. Anything that
fails comes back to you with the row number and the reason. A slice with any
failure is not written to the sheet.

You are not trusted on your own tally. Do not report a count; report what you
wrote, and the gate will count it.

---

## Rules of the house

- **Never invent to fill a blank.** `n/a`, `none`, `whole-class-only` and
  `individual-only` exist so that an honest empty answer has somewhere to go.
  A plausible wrong value is worse than an honest flat one, because it survives
  review.
- **Do not touch any file except `$OUT`.** No git, no bd, no scratch files
  beside your output.
- **Do not edit the slice file.**
- If a row genuinely cannot be annotated, write the string `pending` for that
  column and say why in your final message. Do not guess.
