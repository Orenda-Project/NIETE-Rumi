# 08 — The budget in the fields an author actually writes

`07-lp-production.md` §4 is the law and this does not change it. It restates
it in the only vocabulary a Stage-C author has.

§4 caps RENDER surfaces — `key_points` 120 words, `faded_example` 470, over cap
fails and the renderer never trims. The Stage-C brief asks for BODY fields —
`hookStory`, `steps`, `problems`, `homework`. They are different names for
different things, and until this document nothing joined them. An author
obeying the brief could not tell whether the lesson fitted the law, and §8's
own rule 4 — "write `key_points` last" — named a surface no author ever
writes. That is the gap this closes.

The join is measured, not asserted: `bodysurface.py` holds it and
`test_bodysurface.py` proves it by putting a marker in each field, rendering,
and checking which surface it comes out in. If the renderer moves a field, that
test fails rather than this page quietly becoming untrue.

## The table

| Surface | Words | The fields charged to it |
|---|---|---|
| `key_points` | **110** | `hookStory` · `hookCharacters` · `steps[You-Do]` · `homework` |
| `big_idea` | 80 | `bigIdea` |
| `practice` | 350 | `problems` |
| `worked_example` | 470 | `steps[I-Do]` · `workedExample` |
| `faded_example` | 470 | `partnerActivity` · `steps[We-Do]` |

`key_points` reads 110 and not §4's 120 because ten of those words are already
spent: `remember` is hardcoded to "design pending" at `d0_close.py:40` and the
author cannot write or shrink it. The other four caps are whole.

## The four things this measured that reading the brief would not tell you

**`key_points` is split four ways and is the tightest cap in the spec.** The
hook's narration, the hook characters, the You-Do script and the homework line
all land in the same 110 words, and nobody writing a hook is thinking about the
homework line. §4 predicted the consequence and the corpus confirms it: it is
the first surface over budget in 35 of 38 lessons. On the first lesson of Grade
1 English Ch. 1 the You-Do script alone renders 196 words — 1.6× the whole cap,
in a block the author never wrote as `key_points` at all.

**A hook written as speech is cheaper than the same hook written as stage
directions.** `hookStory` reaches `key_points` only through the narration
outside its quoted speech; the quoted question becomes an `ask`, which is
uncapped. This is not a licence to pad the quotes — it is a reason to write the
provocation as the pupil hears it rather than as a description of saying it.

**`keyFact` costs nothing.** It prints in its own uncapped section and
deliberately does not echo into `remember`. An author who assumes it is charged
will ration the one line of the lesson that should be sharpest.

**Uncapped is not unbudgeted.** `ask`, `warmUp`, `boardWork`, `keyWords`,
`exitTicket`, `weakLearnerSupport`, `challengeExtension`, `coachingReflection`
and `nextTopicPreview` carry no cap because §4 measured them as small and
self-limiting, not because they are free. They still print on the page the
teacher has to read at 9am, and §3's arithmetic assumed their measured size.

## What to do when a surface runs over

§7 is unchanged and unsoftened: over cap fails, the lesson goes back to its
author with the surface named and the overage in words, and the check reports
per-surface because "you are 200 words over" is not actionable.

- `practice` over → **split it across days** (§8 rule 2). Never compress it.
- `key_points` over → cut the You-Do script first. It is the largest feeder and
  the one most often restating what `worked_example` already modelled.
- `worked_example` / `faded_example` over → the move has too many steps, not
  too many words. Drop a step.
- `big_idea` over 80 → the distinction is not sharp enough yet. It is the one
  cap where the fix is thinking, not editing.

Do not reach for a diagram to save space (§1), and do not fill a surface to
reach its cap — the caps are ceilings.
