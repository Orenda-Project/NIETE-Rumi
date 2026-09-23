# Does the generator honour a count per question type?

**22 Sep 2026 · `google/gemini-3.1-pro-preview` · 8 ICT books**

Run it yourself:

```
node scripts/assessment/eval-per-type-counts.js --out <dir> --cases 8 --concurrency 2
```

## Why this was measured

The per-type counts change let a teacher name a number against each question type instead of typing
one total that `withCounts()` divided evenly over her picks. That is only worth
shipping if the number survives the model — a screen that collects "10 MCQs and
2 Brief Answers" and returns six of each has moved the lie rather than fixed it.

Every case asks for a **deliberately uneven** split, which is the shape the old
even spread could never produce. A run that passes under the old arithmetic
would prove nothing, so the baseline below was produced by running the SAME
eight asks through the old code path (one total, spread by `withCounts()`) and
scoring both against what the teacher actually wanted.

`unseen` only. `both` hands half the paper to the book's own exercises and
re-spreads the types over what is left (`planCounts`), so the number she typed
is deliberately not the number the model is asked for; measuring it here would
be measuring the halving.

## Result

| | types exact | papers exact on every type | totals exact |
|---|---|---|---|
| **Before** — one total, split evenly | **2/19 (11%)** | **0/8** | 6/8 |
| **After** — a count per type | **16/19 (84%)** | **5/8** | 6/8 |

Per book, types delivered exactly as asked:

| Grade · Subject | Before | After |
|---|---|---|
| 4 Science | 0/2 | **2/2** |
| 5 English | 0/3 | **2/3** |
| 3 Maths | 0/2 | **2/2** |
| 5 Science | 1/3 | **3/3** |
| 4 English | 0/2 | **2/2** |
| 5 Maths | 0/2 | **2/2** |
| 4 Islamiat | 0/2 | **1/2** |
| 3 English | 1/3 | **2/3** |

Every book improved or held. Note that "totals exact" barely moves (6/8 both
ways) — the old flow was already good at producing the RIGHT NUMBER OF
QUESTIONS. What it could not do was put them where she asked, which is the thing
teachers were actually complaining about and the thing this change fixes.

## The three misses, named

**Objective types were exact 13/13.** Only subjective types drift, and only one
is a real counting failure:

- **5 English, 3 English — `Word Meanings`: asked 2, got 1.** A genuine miss,
  and a small one. Both papers came back one question short of the total too, so
  the model dropped a question rather than misfiling it.
- **4 Islamiat — `Short Questions`: asked 3, got 0.** Not a counting failure.
  The model produced exactly 3 questions and the paper's total was exactly 10 —
  it filed them under `unseen.subjective.Brief Answers`, a key that is not in
  Islamiat's catalogue (`question-types.js` offers Islamiat `Short Questions`
  and `Long Question`). The count travelled; the label did not. Worth a separate
  look at whether the system prompt's tree constrains the model to the keys it
  was asked for — it is a schema-adherence bug, not a count-adherence one, and
  it is invisible to a teacher reading the paper.

## What the eval does not cover

- One run per book, one model, no repeats — enough to show a 11% → 84% shift,
  not enough to put a confidence interval on 84%.
- `seen` and `both` are out of scope by design (above).
- It scores the JSON tree, not the rendered PDF.
