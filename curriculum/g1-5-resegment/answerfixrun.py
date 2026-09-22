# -*- coding: utf-8 -*-
"""Repair the answer slots of the authored lessons, one call each.

bd-eakp8. The 44 Stage-C bodies pass grounding, Bloom's, the content budget
and the judge; what they do not do is answer the 407 questions they put to
the class. That is not a reason to re-generate them -- a re-roll throws away
work that already passed and buys a fresh set of defects. So this pass hands
the author its own lesson back, the exact list of unanswered slots, and the
printed page's own answer keys, and takes back ONLY answers.

The safety property lives in `answerfix`, not in the prompt above it. A model
asked to improve one part of a lesson improves other parts too, and a prompt
cannot stop it; a patch shaped as {path: answer} simply cannot express a
livelier hook or a tidier `say` line. This module's job is the three refusals
around that:

  * a lesson that needs nothing is never sent -- there is no such thing as a
    free re-roll of a lesson that already passed;
  * a refusal is worth exactly one retry, because it names what was wrong
    and the author can usually fix it; and
  * a body is written back ONLY when `answerslot` finds nothing left. `apply`
    succeeding means the patch was legal, not that the lesson is answered,
    and a half-repaired body written back would report as repaired and reach
    a teacher carrying the same complaint.

The model call is the only impure part and it is injected, so everything
above is testable without a key and without spending money -- the seam
`judgerun` uses, for the same reason.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

import answerask
import answerfix
import answerslot
import basicsjudge
import judgerun
import pagecheck
import pageres

#: Where the Stage-C bodies live, and the filename grammar they are written to.
AUTHORED = "corpus-local/authored"
STEM = re.compile(r"^(?P<book>.+)_ch(?P<chapter>\d+)_seg(?P<segment>\d+)$")

#: The author. `claude -p` and not OpenRouter: the Stage-C bodies were
#: written through the CLI backend (`spend.jsonl`), so the repair is made by
#: the same model family that wrote them.
MODEL = "sonnet"

_AGAIN = (u"\n\nYOUR PREVIOUS REPLY WAS REJECTED: %s\n"
          u"Return the same JSON object with that fixed. Change nothing "
          u"else about the lesson.")


def patch_of(raw):
    """The patch, recovered from a reply that may carry prose or a fence.

    `judgerun.review_of` already does the recovery and already refuses a
    reply with no JSON in it; the only thing added here is that a patch must
    be an object. A bare list or string would reach `answerfix.apply` and be
    refused there, but one module down from where the reply was misread.
    """
    out = judgerun.review_of(raw)
    if not isinstance(out, dict):
        raise ValueError("the reply is not a JSON object: %r" % (out,))
    return out


def _body(artefact):
    """The v9 body, whether the caller handed the envelope or the body."""
    d = artefact or {}
    return d.get("generated") or d


def _wrap(artefact, body):
    """The artefact to write back, carrying the fact that it was repaired.

    The `.score.json` beside it was computed on the pre-repair body, so the
    file has to say the two no longer agree; a re-judge is a batch decision
    (`judgerun`'s ONE JUDGE rule) and not this pass's to make. The marker
    goes on the envelope and never on a bare body -- a new top-level key in
    a body is a question site `answersites` has not classified, which would
    stop the gate on the lesson this pass just repaired.
    """
    if not (artefact or {}).get("generated"):
        return body
    out = dict(artefact)
    out["generated"] = body
    out["answers_repaired"] = "bd-eakp8"
    return out


def repair(artefact, ask, keys=None, book="", attempts=2):
    """One lesson repaired, or a reason it was not. Writes nothing."""
    body = _body(artefact)
    prompt = answerask.request(body, keys=keys, book=book)
    if not prompt:
        return {"status": "clean", "body": body,
                "artefact": artefact, "reason": "", "calls": 0}
    note, kind, reason = u"", "refused", "no attempt was made"
    for n in range(attempts):
        try:
            reply = ask(prompt + note)
        except Exception as exc:
            # The transport, not the lesson. The first batch lost two whole
            # shards to a `claude -p` exit 1 with empty stderr: the error
            # escaped here and the lessons queued behind it were never
            # attempted. It costs an attempt and says nothing to the author,
            # who never saw this prompt.
            kind, reason = "error", u"%s" % exc
            continue
        try:
            out = answerfix.apply(body, patch_of(reply))
        except (answerfix.Refused, ValueError) as exc:
            kind, reason = "refused", u"%s" % exc
            note = _AGAIN % reason
            continue
        gone = answerslot.failures(out)
        if not gone:
            return {"status": "repaired", "body": out,
                    "artefact": _wrap(artefact, out), "reason": "",
                    "calls": n + 1}
        kind, reason = "unrepaired", gone[0]["name"]
        note = _AGAIN % reason
    return {"status": kind, "body": None, "artefact": None,
            "reason": reason, "calls": attempts}


def call_claude(prompt, model=MODEL, timeout=900):
    """The one impure function. Everything else here runs without a key."""
    p = subprocess.Popen(["claude", "-p", "--model", model],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE)
    out, err = p.communicate(prompt.encode("utf-8"), timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError("claude -p failed (%d): %s"
                           % (p.returncode, err.decode("utf-8")[:300]))
    return out.decode("utf-8")


def parse_stem(name):
    """`grade_2_math_ch1_seg3` -> (book, chapter, segment_index)."""
    m = STEM.match(os.path.splitext(os.path.basename(name))[0])
    if not m:
        return None
    return (m.group("book"), int(m.group("chapter")), int(m.group("segment")))


def artefacts(root=AUTHORED):
    """Every authored body, newest name order, with its stem parsed."""
    out = []
    for name in sorted(os.listdir(root)):
        if not name.endswith(".json") or name.endswith(".score.json"):
            continue
        parsed = parse_stem(name)
        if parsed:
            out.append((os.path.join(root, name),) + parsed)
    return out


def segments_of(book):
    """The book's segments, keyed by (chapter, segment_index)."""
    with open(os.path.join(pagecheck.SEG, book + ".json")) as fh:
        segs = json.load(fh)["segments"]
    return dict(((s.get("chapter_number"), s.get("segment_index")), s)
                for s in segs)


def shard(items, spec):
    """`items` narrowed to shard i of n, written "i/n"; "" is everything."""
    if not spec:
        return list(items)
    try:
        i, n = [int(x) for x in spec.split("/")]
    except ValueError:
        raise ValueError('--shard wants "i/n", e.g. "0/4", not %r' % spec)
    if n < 1 or not 0 <= i < n:
        raise ValueError('--shard %r is out of range' % spec)
    return [x for k, x in enumerate(items) if k % n == i]


def basics_segments(briefs=basicsjudge.BRIEFS):
    """The synthesised segment row of every FLN basics period, by stem."""
    return dict((b["name"], b.get("segment") or {})
                for b in basicsjudge.load(briefs=briefs))


def segment_of(stem, book, chapter, index, briefs, books):
    """This lesson's segment row, from its brief or from the book.

    The brief wins. A basics period is out-of-textbook by construction, so
    it is never in `corpus/seg`; 36 of the 44 authored bodies are basics
    periods, and reading only the book would hand all 36 an empty page list
    and repair them with no answer keys at all.
    """
    if stem in briefs:
        return briefs[stem]
    return books.get(book, {}).get((chapter, index))


def spend(path, lesson_id, status, calls, seconds):
    """One line per lesson, in the shape the Stage-C authoring already logs."""
    with open(path, "a") as fh:
        fh.write(json.dumps(
            {"at": datetime.datetime.utcnow().isoformat() + "+00:00",
             "lesson_id": lesson_id, "stage": "answer-repair",
             "model": "claude -p --model " + MODEL, "backend": "cli",
             "status": status, "calls": calls,
             "seconds": round(seconds, 1)}) + "\n")


def run(paths, call=call_claude, write=True, log=None, out=sys.stdout):
    """Repair each artefact in turn. Returns one result row per lesson."""
    import time
    idx_of, seg_of, rows = {}, {}, []
    briefs = basics_segments()
    for path, book, chapter, segment in paths:
        if book not in idx_of:
            idx_of[book] = pageres.index(pagecheck.load_pages(
                os.path.join(pagecheck.TRUTH, book)))
            seg_of[book] = segments_of(book)
        stem = os.path.splitext(os.path.basename(path))[0]
        segment_d = segment_of(stem, book, chapter, segment, briefs, seg_of)
        pages = (judgerun.grounding_of(segment_d, idx_of[book])["pages"]
                 if segment_d else [])
        with open(path) as fh:
            artefact = json.load(fh)
        started = time.time()
        res = repair(artefact, lambda p: call(p),
                     keys=answerask.keys(pages), book=book)
        if res["status"] == "repaired" and write:
            with open(path, "w") as fh:
                json.dump(res["artefact"], fh, ensure_ascii=False, indent=2)
        if log:
            spend(log, stem, res["status"], res["calls"],
                  time.time() - started)
        rows.append({"stem": stem, "path": path, "status": res["status"],
                     "reason": res["reason"], "calls": res["calls"]})
        out.write(u"%-34s %-11s %s\n" % (stem, res["status"],
                                         res["reason"][:90]))
        out.flush()
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--authored", default=AUTHORED)
    ap.add_argument("--book", default="", help="only this book stem")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--shard", default="", help='run shard "i/n" only')
    ap.add_argument("--log", default="", help="append a spend.jsonl line here")
    ap.add_argument("--dry-run", action="store_true",
                    help="repair but do not write the bodies back")
    a = ap.parse_args()
    paths = [p for p in artefacts(a.authored) if not a.book or p[1] == a.book]
    if a.limit:
        paths = paths[:a.limit]
    paths = shard(paths, a.shard)
    rows = run(paths, write=not a.dry_run, log=a.log or None)
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print("---")
    print("  ".join("%s %d" % (k, counts[k]) for k in sorted(counts)))
    return 0 if counts.get("repaired", 0) + counts.get("clean", 0) == len(rows) \
        else 1


if __name__ == "__main__":
    sys.exit(main())
