"""Everything about a revision day's three panels that can be checked for free.

`d0_route` refuses the wrong OBJECT -- a 990 rendered as a four-page teacher
lesson plan. It cannot see the other half of the failure, which is a 990 that
IS routed as a 990 and carries no panels. On the GK/Islamiat/SST pilot three
of four revision lessons reached the renderer with `revisionPanels: null`,
each burned a paid render slot, and the batch log still reported clean.

So this is the cheap half of the guard, and the skill's Law 18 asks for it in
as many words: mirror every engine refusal in the free pre-render lint. It
reads JSON, spends nothing, and `d0_panels` calls it and refuses on findings,
because a lint nobody runs is a comment.

Two things are easy to get backwards here:

  `revisionPanels` PRESENT AND NULL IS ABSENT. It is not "handled elsewhere"
  and it is not a placeholder the renderer will skip. The reference
  implementation's `normaliseRevisionPanels` returns null the moment any one
  of the three panels is missing, and `generate.js` then picks the ORDINARY
  page set -- so a revision day renders as a lesson plan with the teaching
  taken out, at full cost, silently. That is the single defect this module
  exists for and it is checked first.

  THE LENGTHS ARE WHERE CONTENT IS LOST, not where style begins. Every number
  in `MAX` is the width `transform.js` truncates at. A panel over them still
  renders; it renders with the end of a teacher's sentence missing, which on a
  re-teaching page is the part that did the work. The authoring brief asks for
  a tighter 220 on the explanation than the 300 the renderer allows -- a brief
  is guidance, and this is the refusal, so the refusal uses the renderer's
  number.

A revision script legally has NO iDo and NO youDo. One arriving with them is
a content lesson wearing a revision label, and it is flagged rather than
quietly dropped.
"""
import d0_route

LEVELS = ("beginner", "intermediate", "advanced")

# Two to three items a group works alone on while she teaches the next group.
# One is not enough to keep a group busy; four do not fit the panel.
MIN_PRACTICE, MAX_PRACTICE = 2, 3

# One to three lines, because the glance page prints them in a fixed card.
MAX_BOARD = 3

# The widths `transform.js` fits to. Past these the render loses the tail.
MAX = {
    "groupingNote": 200,
    "focus": 80,
    "board": 60,
    "explain.say": 300,
    "explain.sayLocal": 300,
    "guided.prompt": 115,
    "guided.strategy": 140,
    "guided.answer": 78,
    "practice.prompt": 115,
    "practice.answer": 78,
    "exit.prompt": 125,
    "exit.answer": 78,
}

# A revision day has no teaching blocks. These are the content-lesson ones.
CONTENT_BLOCKS = ("iDo", "weDo", "youDo")


def _val(d, key):
    """`key` from `d`, treating a present-but-null the same as missing."""
    v = (d or {}).get(key)
    return v if v not in (None, "") else None


def _find(code, name):
    return {"id": code, "name": name}


def panels_of(gen):
    """The authored panels, or None -- from wherever the envelope keeps them.

    Authoring writes `revisionPanels` at the top of the object; a normalised
    script has already moved it under `wrap`. Both are read, and an empty one
    is the same as none at all.
    """
    for src in (gen, (gen or {}).get("wrap")):
        rp = (src or {}).get("revisionPanels")
        if isinstance(rp, dict) and rp:
            return rp
    return None


def _length(where, value, field, out):
    cap = MAX[field]
    if isinstance(value, str) and len(value) > cap:
        out.append(_find("RP-12", "%s %s is %d characters and the render cuts "
                                  "it at %d" % (where, field, len(value), cap)))


def _board(p, where, out):
    board = [l for l in (p.get("board") or []) if l]
    if not 1 <= len(board) <= MAX_BOARD:
        out.append(_find("RP-07", "%s writes %d line(s) on the board -- it "
                                  "needs 1 to %d, and a group with none gets "
                                  "an empty card" % (where, len(board),
                                                     MAX_BOARD)))
    for line in board:
        _length(where, line, "board", out)


def _explain(p, where, out):
    ex = p.get("explain")
    say = _val(ex, "say") if isinstance(ex, dict) else None
    if say is None:
        out.append(_find("RP-08", "%s has no explanation to re-teach with -- "
                                  "the explaining is what a revision day is "
                                  "for" % where))
        return
    _length(where, say, "explain.say", out)
    _length(where, _val(ex, "sayLocal"), "explain.sayLocal", out)


def _guided(p, where, out):
    g = p.get("guided")
    g = g if isinstance(g, dict) else {}
    if _val(g, "prompt") is None or _val(g, "answer") is None:
        out.append(_find("RP-09", "%s has no complete guided item (needs a "
                                  "prompt and an answer) -- she models one "
                                  "with the group before they work alone"
                         % where))
        return
    for key in ("prompt", "strategy", "answer"):
        _length(where, _val(g, key), "guided.%s" % key, out)


def _practice(p, where, out):
    items = [o for o in (p.get("practice") or []) if o]
    if not MIN_PRACTICE <= len(items) <= MAX_PRACTICE:
        out.append(_find("RP-10", "%s gives %d practice item(s) -- it needs "
                                  "%d to %d to keep the group working while "
                                  "she teaches the next one"
                         % (where, len(items), MIN_PRACTICE, MAX_PRACTICE)))
        return
    for i, o in enumerate(items):
        if _val(o, "prompt") is None or _val(o, "answer") is None:
            out.append(_find("RP-10", "%s practice item %d is missing its "
                                      "prompt or its answer -- the answers "
                                      "footnote is how she marks it"
                             % (where, i + 1)))
            continue
        _length(where, _val(o, "prompt"), "practice.prompt", out)
        _length(where, _val(o, "answer"), "practice.answer", out)


def _exit(p, where, out):
    ex = p.get("exit")
    ex = ex if isinstance(ex, dict) else {}
    if _val(ex, "prompt") is None or _val(ex, "answer") is None:
        out.append(_find("RP-11", "%s has no complete exit ticket (needs a "
                                  "question and an answer) -- without it "
                                  "nothing checks the SLO at that group's "
                                  "level" % where))
        return
    _length(where, _val(ex, "prompt"), "exit.prompt", out)
    _length(where, _val(ex, "answer"), "exit.answer", out)


def _panel(p, level, out):
    where = "the %s panel" % level
    if _val(p, "focus") is None:
        out.append(_find("RP-06", "%s says nothing about what that group "
                                  "works on -- the glance page prints it"
                         % where))
    else:
        _length(where, p["focus"], "focus", out)
    _board(p, where, out)
    _explain(p, where, out)
    _guided(p, where, out)
    _practice(p, where, out)
    _exit(p, where, out)


def findings(enr, segment=None):
    """Everything wrong with this revision day, cheapest check first.

    A list of `{"id", "name"}`. Empty means nothing here blocks a render --
    not that the day is good, which is what the judge is for.
    """
    out = []
    what = d0_route.kind(enr, segment)
    if what != "revision":
        return [_find("RP-01", "this is a %s segment, not a revision day -- "
                               "the panel lint has nothing to say about it"
                      % what)]

    gen = (enr or {}).get("generated") or {}
    rp = panels_of(gen)
    if rp is None:
        # The pilot defect. Reported alone: a cascade behind it would bury it.
        return [_find("RP-02", "no revisionPanels -- a key present and null is "
                               "ABSENT, and the renderer answers it by "
                               "printing the ordinary lesson pages instead, "
                               "at full cost and without saying so")]

    if _val(rp, "groupingNote") is None:
        out.append(_find("RP-03", "no groupingNote -- it is the dominant card "
                                  "on the glance page and it is how she knows "
                                  "to teach one group at a time"))
    else:
        _length("the glance page", rp["groupingNote"], "groupingNote", out)

    extra = sorted(set(rp) - set(LEVELS) - {"groupingNote"})
    if extra:
        out.append(_find("RP-05", "the page holds exactly three groups and "
                                  "this carries %s as well" % ", ".join(extra)))

    for level in LEVELS:
        p = rp.get(level)
        if not isinstance(p, dict) or not p:
            out.append(_find("RP-04", "the %s panel is missing -- with one "
                                      "gone the renderer discards all three "
                                      "and falls back to the lesson pages"
                             % level))
            continue
        _panel(p, level, out)

    said = [b for b in CONTENT_BLOCKS if _val(gen, b) is not None]
    if said:
        out.append(_find("RP-13", "a revision day legally has no %s -- this "
                                  "one carries %s, which means it was authored "
                                  "as a content lesson"
                         % ("/".join(CONTENT_BLOCKS), ", ".join(said))))
    return out


def ok(enr, segment=None):
    """True when nothing blocks the render. The shape a caller usually wants."""
    return not findings(enr, segment)
