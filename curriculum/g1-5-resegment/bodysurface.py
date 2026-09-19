"""Which capped surface an authored field's words are charged to.

`spec/07-lp-production.md` §4 states the word budget in RENDER surfaces —
`key_points` 120, `faded_example` 470, and over cap fails, the renderer never
trims. `briefs/enrich_brief_v3.md`, the only Stage-C brief there is, asks for
BODY fields — `hookStory`, `steps`, `problems`, `homework`. Nothing joined the
two, so an author following the brief could not tell whether the lesson fitted
the law, and §8's rule 4 — "write `key_points` last" — named a surface no
author ever writes.

This is that join. It is measured, not declared: `test_bodysurface.py` puts a
marker into each field, renders, and asserts where it comes out, so a renderer
change that moves a field fails a test rather than quietly falsifying a brief.

Three things the measurement settled that a reading of the code would not:

  `key_points` has FOUR unrelated feeders — the hook's narration, the hook
  characters, the You-Do move's script and the homework line. It is the
  tightest cap in §4 at 120 words, and the one 35 of the 38 corpus lessons
  miss. Nobody writing a hook is thinking about the homework line.

  `keyFact` feeds NO capped surface, and neither does the hook's provocation.
  `remember` is hardcoded to DESIGN_PENDING at `d0_close.py:40` — the comment
  beside it is explicit that it must not echo `keyFact`, which is the lesson's
  outcome and prints in its own uncapped section. So `keyFact` is free, and
  `remember` spends 10 words of the author's 120 on a hole they cannot fill.

  A field is not always charged. `hookStory` reaches `key_points` only through
  the narration OUTSIDE its quoted speech; the quoted question becomes an
  uncapped `ask`. Writing the hook as speech is therefore cheaper than writing
  it as stage directions, which is a fact about the budget an author can act on
  and could not have guessed.

Pure — `wordbudget` and nothing else, so the caps have one home.
"""
import wordbudget

# field -> the capped surface its words are charged to. `steps` is split by
# phase because one field feeds three different surfaces, which is the one
# thing about this map a reader would otherwise get wrong.
FEEDS = {
    "hookStory": "key_points",          # narration only; the question is uncapped
    "hookCharacters": "key_points",
    "steps[You-Do]": "key_points",
    "homework": "key_points",
    "steps[I-Do]": "worked_example",
    "workedExample": "worked_example",
    "steps[We-Do]": "faded_example",
    "partnerActivity": "faded_example",
    "problems": "practice",
    "bigIdea": "big_idea",
}

# Words the renderer spends that the author cannot write or shrink. Only the
# unconditional ones belong here: `big-idea` also prints DESIGN_PENDING today,
# but that is an absent field, and authoring `bigIdea` reclaims every word.
# `remember` is hardcoded, so those ten words are gone whatever the author does.
PLACEHOLDER_COST = {"remember": 10}
PLACEHOLDER_SURFACE = {"remember": "key_points"}

# Fields the brief asks for that reach no capped surface. Stated rather than
# left to silence: an author who does not know `keyFact` is free will ration it.
UNCHARGED = ("keyFact", "hookStory's quoted question", "boardWork", "keyWords",
             "warmUp", "exitTicket", "weakLearnerSupport", "challengeExtension",
             "coachingReflection", "nextTopicPreview")


def fields_of(surface):
    """Every authored field charged to `surface`."""
    return [f for f, s in FEEDS.items() if s == surface]


def placeholder_cost(surface):
    """Words `surface` loses to placeholders before the author writes anything."""
    return sum(n for b, n in PLACEHOLDER_COST.items()
               if PLACEHOLDER_SURFACE[b] == surface)


def targets():
    """What each capped surface allows, and what is left for the author.

    `cap` is §4's number, read from `wordbudget` so there is only ever one copy
    of it. `author_budget` is what remains once the renderer's own placeholders
    are paid for — the number an author should actually aim under.
    """
    out = {}
    for surface, cap in wordbudget.CAPS.items():
        spent = placeholder_cost(surface)
        out[surface] = {"cap": cap,
                        "author_budget": cap - spent,
                        "placeholder": spent,
                        "fields": sorted(fields_of(surface))}
    return out


def brief_table():
    """The map as an author-facing table, tightest cap first.

    Sorted by what is left per field rather than by the cap: `faded_example`
    is the biggest number in §4 and one of the easiest to stay inside, while
    `key_points` is the smallest and split four ways.
    """
    rows = []
    for surface, t in targets().items():
        fields = t["fields"] or ["-"]
        rows.append((round(t["author_budget"] / len(fields)), surface,
                     t["author_budget"], ", ".join(fields)))
    rows.sort()
    return [(s, b, f) for _, s, b, f in rows]
