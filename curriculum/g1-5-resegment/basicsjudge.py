"""Send the basics lessons to the judge, which `judgerun.main` cannot do.

`judgerun.main` finds its work by reading `corpus/seg/<book>.json` and keeping
the rows whose chapter matches. That is the right way to find every other
lesson in this build, and it cannot find a basics period at all. A basics
period is a calendar slot rather than a span of book: `ramp.allocate` places
it, `basicseg.segment()` synthesises a row for it, and that row lives in the
brief file and nowhere else. Asked for segment 801, `judgerun` reads the
segmentation corpus, finds no such row, and prints "no authored artefact" --
naming the artefact, which exists, rather than the row, which does not.

So the selection is the only thing this module owns. Everything that follows
it -- grounding, rendering, the rubric call, `gate4`, the `.score.json` beside
the artefact -- is `judgerun`'s, called here unchanged. There is no second
judging path, and there must not be: the day there are two, one of them will
quietly fall behind the gate the other enforces.

Two differences from typing `judgerun` by hand, both of them the kind of thing
that goes wrong at 366 lessons rather than at one:

  Subject and grade are read off the brief's own envelope instead of being
  typed as flags. `judgerun --subject English --grade 1` against a Maths book
  runs perfectly happily and rates the lesson against the wrong rubric.

  A brief with no artefact yet is NAMED. A silent skip and a clean exit code
  is how a run of thirty-six reports success having judged four.
"""
import argparse
import collections
import json
import os

import judgerun
import pagecheck
import pageres

HERE = os.path.dirname(os.path.abspath(__file__))
BRIEFS = os.path.join(HERE, "corpus-local", "briefs")
AUTHORED = os.path.join(HERE, "corpus-local", "authored")

# One lesson ready to judge. `segment` is the synthesised basics row, which is
# what carries `content_min` -- so the content budget reaches `gate4` here the
# same way it would for a row read off disk.
Ready = collections.namedtuple("Ready", "name path segment stem grade subject")


def load(stem=None, skill=None, names=None, briefs=BRIEFS):
    """Every basics brief on disk, narrowed, in name order.

    A missing brief directory is not an error: nothing has been built yet is a
    state this build passes through, not a fault.
    """
    if not os.path.isdir(briefs):
        return []
    want = set(names) if names else None
    out = []
    for fn in sorted(os.listdir(briefs)):
        if fn.startswith("_") or not fn.endswith(".json"):
            continue
        with open(os.path.join(briefs, fn)) as fh:
            b = json.load(fh)
        env = (b.get("brief") or {}).get("envelope") or {}
        if stem and env.get("book_stem") != stem:
            continue
        if skill and env.get("skill_type") != skill:
            continue
        if want is not None and b.get("name") not in want:
            continue
        out.append(b)
    return out


def authored_path(b, authored=AUTHORED):
    """Where this brief's lesson is written. The brief's name IS the stem."""
    return os.path.join(authored, b["name"] + ".json")


def work(briefs, authored=AUTHORED):
    """`(ready, missing)` -- what can be judged, and what has not been written.

    `missing` is a list of names rather than a count, because the only useful
    next action is opening the ones that are not there yet.
    """
    ready, missing = [], []
    for b in briefs:
        path = authored_path(b, authored=authored)
        if not os.path.exists(path):
            missing.append(b["name"])
            continue
        env = (b.get("brief") or {}).get("envelope") or {}
        ready.append(Ready(b["name"], path, b.get("segment") or {},
                           env.get("book_stem"), env.get("grade"),
                           env.get("subject")))
    return ready, missing


def index_of(stem):
    """The page index for one book. Built once per book, not once per lesson."""
    return pageres.index(pagecheck.load_pages(
        os.path.join(pagecheck.TRUTH, stem)))


def by_book(ready):
    """`ready` grouped by book, in first-seen order, so each index is built once."""
    groups = collections.OrderedDict()
    for r in ready:
        groups.setdefault(r.stem, []).append(r)
    return groups


def main(argv=None, briefs=BRIEFS, authored=AUTHORED, index=index_of,
         run=judgerun.run_batch, call=judgerun.call_openrouter):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--book", help="page-truth stem, e.g. grade_2_math")
    ap.add_argument("--skill", help="basics skill, e.g. number_fluency")
    ap.add_argument("--name", action="append", dest="names",
                    help="one brief name; repeatable")
    ap.add_argument("--judge", default=judgerun.DEFAULT_JUDGE)
    a = ap.parse_args(argv)

    ready, missing = work(load(stem=a.book, skill=a.skill, names=a.names,
                               briefs=briefs), authored=authored)
    for name in missing:
        print("not written yet: %s" % name)
    if not ready:
        print("nothing to judge")
        return 1

    print("judging %d basics lessons with %s\n" % (len(ready), a.judge))
    results = []
    for stem, group in by_book(ready).items():
        idx = index(stem)
        pairs = [(r.path, r.segment) for r in group]
        renders = {}
        for r in group:
            with open(r.path) as fh:
                lp = json.load(fh)
            g = judgerun.grounding_of(r.segment, idx)
            renders[r.path] = judgerun.render_of(lp, r.segment, g["pages"])
        results.extend(run(pairs, idx, group[0].subject, group[0].grade,
                           model=a.judge, call=call, renders=renders))

    for r in results:
        print(judgerun.line(r["stem"], r["score"], r["verdict"]))
    passed = sum(1 for r in results if r["verdict"].get("pass"))
    print("\n%d/%d pass the production gate" % (passed, len(results)))
    return 0 if passed == len(results) and not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
