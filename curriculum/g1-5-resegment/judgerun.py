"""Run the v3 rubric judge over authored lessons and gate what comes back.

Everything else in G4 has been running for weeks. The judge has not, and
without it `compose` cannot form a composite at all — every gate report this
build has produced says `not-judged` and `composite 0.0 < 92.0`. So the gate
has been measuring its deterministic half and calling the result a failure of
the lesson, when it was a failure to ask.

The pieces already exist on both sides. `score_lp.py` in the migrated reviewer
knows how to build the prompt, call OpenRouter and tally the ratings;
`gate4.evaluate` knows how to read a review. Nothing joined them, and the
joining is not mechanical — three things have to be got right or the number
that comes back is worse than no number.

THE BOOK. Checks 1D, 7A and 8C ask whether the lesson matches the textbook,
whether its references are plausible, and whether it uses the book's material.
A judge shown no book cannot answer them and returns them not-assessable,
which is honest but leaves the alignment question unasked — and alignment is
the whole of the no-fabrication guarantee. A judge shown the WRONG pages
answers them confidently and wrongly, which is worse. So the excerpt is
resolved through `pageres`, by both page keys, against the segment's own
chapter. Grade 5 Urdu prints page 131 twice; that is not a hypothetical.

THE WORKSHEET. The v3 rubric is a LESSON rubric. A student-facing chapter
worksheet has no hook, no explanation, no modelling, no gradual release, no
section timings and no exit ticket, and roughly ten of the rubric's checks ask
for exactly those. Scored naively they become ratings of 1, and one rating of
1 fails `production_gate` outright — the same category error that made
`qa_checks` produce six impossible hard failures on the same artefact before
`_worksheet_qa` existed.

The scope note was the first answer and it was not enough. It said what the
artefact was; it could not stop a lesson rubric asking lesson questions, and
the lesson FRAME was meanwhile naming "a full-chapter assessment" among the
unit-plan red flags and telling the judge not to reward what was inside one.
The first paid batch measured the result (bd-cds95, 19 Sep 2026): eighteen
checks not-assessable, the denominator down from 220 to 148 where the six
sibling lessons sat at 204-216, and a gate failure at 90.55 with zero
1-ratings and zero 2-ratings anywhere in it.

So the evidence came back and the answer is yes: a worksheet is scored on
`asmtrubric`, which drops the fourteen checks a sat paper structurally cannot
answer, asks seven it can, and carries a frame that knows what it is looking
at. The note is KEPT alongside it — only English's C8 was measured, so the
other subjects' subject-specific checks stay whole and still need the
rubric's own `notAssessable` path rather than a rating of 1.

ONE JUDGE. `production_gate` corrects for judge bias per model — sonnet faces
94.0 where opus faces 92.0 — so a batch judged by two models is a batch whose
scores cannot be compared with each other. Pinned, per batch, by argument.

The call is the only impure part and it is injected, so everything above is
testable without a key and without spending money.
"""
import argparse
import json
import os
import sys

import asmtrubric
import d0_route
import gate4
import pageres

REVIEWER = gate4.reviewer_path()
DEFAULT_JUDGE = "anthropic/claude-opus-5"

# What the judge is told a 995 is. It names the artefact and routes the checks
# it cannot have to the rubric's own not-assessable path. It does not lower a
# bar, excuse a weakness, or drop a criterion — a worksheet that is badly
# written still scores as one.
WORKSHEET_SCOPE = """SCOPE NOTE — READ BEFORE SCORING.

This artefact is a STUDENT-FACING CHAPTER ASSESSMENT WORKSHEET, not a lesson
plan. It is the paper a child writes on: a set of questions with marks, space
to answer, and an accompanying answer key. It has no teacher script, no hook,
no explanation, no modelling, no I-Do/We-Do/You-Do, no section timings and no
exit ticket, because a worksheet is not taught — it is sat.

Score every check that CAN apply to such an artefact, at full strictness:
curriculum and SLO alignment, measurability, textbook grounding, factual
accuracy, question quality and cognitive demand, accessibility and language
level, cultural relevance and inclusion, and the subject-specific checks.

For a check that asks about a feature a worksheet cannot have, return it in
the list with "rating": null, "notAssessable": true and a "contextMissing"
saying which feature is absent. Do NOT rate it 1, and do NOT rate it 4. A
not-assessable check is excluded from the total and from the denominator, so
it neither punishes nor rewards.

Judge the worksheet as a worksheet. Do not soften any check that does apply."""


def _page_lines(p):
    """One page of Stage-A description, flattened for a prompt.

    Not only the running text. 1D asks whether the lesson is aligned with the
    page, 7A whether its references are plausible, 8C whether it uses the
    book's own material — and at Grade 1 the page is mostly an illustration
    and an activity, so prose alone would leave all three half-answered.
    """
    ch = p.get("chapter") if isinstance(p.get("chapter"), dict) else None
    head = "--- page %s" % p.get("printed_page_number")
    if ch:
        head += " (chapter %s: %s)" % (ch.get("number"), ch.get("title") or "")
    out = [head.rstrip() + " ---"]

    headings = [h for h in (p.get("headings") or []) if h]
    if headings:
        out.append("headings: " + " | ".join(str(h) for h in headings))

    text = (p.get("text_verbatim") or "").strip()
    if text:
        out.append(text)

    for ex in p.get("exercises") or []:
        label = ex.get("label") or "exercise"
        out.append("exercise: " + str(label))
        instr = (ex.get("instruction_verbatim") or "").strip()
        if instr:
            out.append("  instruction: " + instr)
        items = [str(i) for i in (ex.get("items") or []) if i]
        if items:
            out.append("  items: " + " | ".join(items))

    for il in p.get("illustrations") or []:
        desc = (il.get("description") or "").strip()
        if desc:
            out.append("illustration: " + desc)

    for t in p.get("tables") or []:
        cap = t.get("caption") or t.get("title")
        out.append("table: " + str(cap) if cap else "table: (untitled)")

    notes = (p.get("visual_layout_notes") or "").strip()
    if notes:
        out.append("layout: " + notes)
    return out


def book_excerpt(pages):
    """The pages a segment resolved to, labelled by printed number.

    Empty where nothing resolved, so the caller can tell "no book" from "a
    book with nothing on it" and refuse to claim the context token.

    A page Stage A described nothing for still renders, as its heading alone.
    That is information — the segment named that page and there is nothing on
    it — and it is `context_of` that declines to call it a book.
    """
    return "\n\n".join("\n".join(_page_lines(p)) for p in pages)


def context_of(excerpt):
    """Does this excerpt actually carry the book? A labelled blank does not.

    `build_reviewer_prompt` takes a set of context tokens and, for a token it
    is not given, tells the judge to return the checks that need it as
    not-assessable rather than guessing. Claiming `book_content` over an
    excerpt that is only page headings would spend that mechanism on nothing
    and let 1D, 7A and 8C be answered from the lesson alone.
    """
    body = [l for l in excerpt.splitlines()
            if l.strip() and not l.startswith("--- page ")]
    return {"book_content"} if body else set()


def grounding_of(segment, idx):
    """G1's input: did this segment's pages resolve, and if not why not."""
    r = pageres.resolve(segment, idx)
    return {"resolved": r.resolved, "flags": r.flags, "pages": r.pages}


def scope_note(segment, lp=None):
    """What to tell the judge the artefact is, or None for an ordinary lesson."""
    if d0_route.kind(lp or {}, segment) != "assessment":
        return None
    return WORKSHEET_SCOPE


def review_of(raw):
    """The judge's review, recovered from a reply that may carry prose around it.

    A reply with no JSON at all raises. It must not become an empty review:
    an empty review tallies to a denominator of zero, which `gate4` reads as
    "never rated" — indistinguishable from not having run, and a paid call
    silently reported as an unrated lesson is the worst of both.
    """
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        pass
    start, end = raw.find("{") if isinstance(raw, str) else -1, -1
    if start >= 0:
        end = raw.rfind("}") + 1
    if start < 0 or end <= start:
        raise ValueError("the judge returned no JSON object: %r" % (raw or "")[:200])
    return json.loads(raw[start:end])


def _rated(check):
    """One check with a digit-string rating turned into the int the gate reads."""
    if not isinstance(check, dict):
        return check
    r = check.get("rating")
    if isinstance(r, str) and r.strip().lstrip("+-").isdigit():
        return dict(check, rating=int(r.strip()))
    return check


def normalise(review):
    """Rename the judge's keys to the ones `score_lp.tally` actually reads.

    They do not match, and nothing in the tree noticed because nothing had
    ever run the two together. `build_reviewer_prompt` asks for

        {"evaluation": [{"criterionId": "C0", "subCriteria": [...]}]}

    and `tally` reads `review["criteria"]` or `review["scores"]`. A real reply
    therefore tallies to 0/0, `gate4.evaluate` turns a zero denominator into
    `judge_pct = None`, and `compose` reports `not-judged` — a lesson that was
    judged, paid for, and filed as never rated, with nothing saying so.

    The shape `tally` wants is not invented here: the prior Stage-C corpus at
    `corpus-local/prior/g1e/*.score.json` is already in it, carrying
    `review.criteria[].checks[].rating`. So this is the missing half of a
    normalisation that once existed, restored rather than designed, and a
    review already in that shape passes through untouched.

    Nulls, `notAssessable` and `contextMissing` are carried through exactly as
    the judge sent them, because dropping a not-assessable check would stop it
    shrinking the denominator — which is the entire mechanism the worksheet's
    rubric relies on.

    A rating the judge wrote as a digit STRING is coerced to int, and that is
    not cosmetic (bd-fmw2t). `production_gate._low_checks` counts a check only
    where `isinstance(rating, (int, float))`, so while every rating in this
    tree was a string the gate's conditions (b) — no check rated 1, at most
    MAX_TWOS rated 2 — never fired on a single artefact, and hard-QA plus the
    composite were quietly the whole gate. Measured on the first paid batch:
    seg5 carried five non-strict 2s, seg6 four, seg995 six, and all seven were
    reported clean of them. The prior Stage-C corpus carries int ratings,
    which is why nothing had noticed. `score_lp.tally` coerces internally, so
    the composites were always right; only the gate was blind.

    Anything that is not a whole number is left exactly as it arrived. "N/A"
    is not a 0, and inventing one would fail a check the judge declined to
    rate.
    """
    if not isinstance(review, dict) or "evaluation" not in review:
        return review
    out = dict(review)
    out["criteria"] = [
        dict(c, id=c.get("criterionId") or c.get("id") or c.get("criterion"),
             checks=[_rated(k) for k in
                     (c.get("subCriteria") or c.get("checks") or [])])
        for c in (review.get("evaluation") or [])]
    return out


def prompt_for(lp, segment, excerpt, subject, grade):
    """The system and user messages for one artefact.

    The route picks the instrument. `d0_route.kind` reads both `skill_type`
    and `lp_type` over the segment AND the enrichment envelope, which is what
    makes this work outside English: Maths, Urdu and Science segments carry no
    `lp_type` at all and declare themselves only through `skill_type`. Keying
    off the 995 index instead would have scored every one of those on the
    lesson rubric.
    """
    sys.path.insert(0, REVIEWER) if REVIEWER not in sys.path else None
    from reviewer_prompt_v3 import build_reviewer_prompt
    worksheet = d0_route.kind(lp or {}, segment) == "assessment"
    system = build_reviewer_prompt(
        subject, available_context=context_of(excerpt) or None,
        scope_note=scope_note(segment, lp),
        active_override=(asmtrubric.assessment_rubric(subject)
                         if worksheet else None),
        frame_override=asmtrubric.FRAME if worksheet else None)
    user = "GRADE: %s\nSUBJECT: %s\n\n%s TO REVIEW:\n%s" % (
        grade, subject, "WORKSHEET" if worksheet else "LESSON PLAN",
        json.dumps(lp, ensure_ascii=False, indent=2))
    if excerpt.strip():
        user += ("\n\nBOOK CONTENT (page-truth excerpt, for alignment checks):\n"
                 + excerpt)
    return system, user


# The skill documents the first name; the second is what this machine's
# `NIETE-Rumi/.env` actually holds. Refusing to run over that gap would stop a
# batch that has a working key two directories up.
KEY_NAMES = ("OPENROUTER_ICT_ENRICH_KEY", "OPENROUTER_API_KEY")


def api_key():
    """The OpenRouter key, by either name. Never returned to a caller that prints."""
    for name in KEY_NAMES:
        key = os.environ.get(name)
        if key:
            return key
    raise RuntimeError(
        "no OpenRouter key: set %s. They live in a .env — source it with "
        "`set -a && . ./.env && set +a`, do not print or echo it."
        % " or ".join(KEY_NAMES))


def call_openrouter(system, user, model):
    """The one impure function. Everything else here runs without a key."""
    import urllib.request
    key = api_key()
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "usage": {"include": True}}).encode("utf-8")
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions", data=body,
        headers={"Authorization": "Bearer " + key,
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as fh:
        data = json.loads(fh.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"], data.get("usage") or {}


def render_of(lp, segment, pages):
    """The D0 document W1 measures, or None where there is nothing to render.

    A worksheet has no render and its own lint already stands in W1's place
    inside `compose`; an unresolved segment has no page truth to render from.
    """
    if not pages or d0_route.kind(lp, segment) == "assessment":
        return None
    import d0_primary
    return d0_primary.to_lp_doc(lp, pages[0], segment=segment,
                                topic=segment.get("topic"))


def run_one(path, segment, idx, subject, grade, model=DEFAULT_JUDGE,
            call=call_openrouter, render=None):
    """Judge one artefact and gate it. Writes `<stem>.score.json` beside it."""
    with open(path) as fh:
        lp = json.load(fh)
    g = grounding_of(segment, idx)
    excerpt = book_excerpt(g["pages"])
    system, user = prompt_for(lp, segment, excerpt, subject, grade)
    raw, usage = call(system, user, model)
    review = normalise(review_of(raw))
    score, verdict = gate4.evaluate(
        lp, segment, review, judge=model, subject=subject,
        grounding={"resolved": g["resolved"], "flags": g["flags"]},
        render=render)
    out = os.path.splitext(path)[0] + ".score.json"
    with open(out, "w") as fh:
        json.dump({"stem": os.path.basename(os.path.splitext(path)[0]),
                   "judge": model, "usage": usage, "verdict": verdict,
                   "pages_used": [p.get("printed_page_number")
                                  for p in g["pages"]],
                   "score": {k: v for k, v in score.items() if k != "review"},
                   "review": review}, fh, ensure_ascii=False, indent=2)
    return {"score": score, "verdict": verdict, "usage": usage, "path": out,
            "stem": os.path.basename(os.path.splitext(path)[0])}


def run_batch(pairs, idx, subject, grade, model=DEFAULT_JUDGE,
              call=call_openrouter, renders=None):
    """`pairs` is [(path, segment)]. One judge across all of them, by contract."""
    renders = renders or {}
    out = []
    for path, segment in pairs:
        out.append(run_one(path, segment, idx, subject, grade, model=model,
                           call=call, render=renders.get(path)))
    return out


def line(stem, score, verdict):
    """One row of the report. A verdict with no reason is not actionable."""
    def pct(v):
        return "  n/a" if v is None else "%5.1f" % v
    reasons = "; ".join(verdict.get("reasons") or [])
    return ("%-34s %s  judge %s  soft %s  composite %s  %s"
            % (stem, "PASS" if verdict.get("pass") else "FAIL",
               pct(score.get("judge_pct")), pct(score.get("soft_pct")),
               pct(score.get("composite_pct")), reasons))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--book", required=True, help="page-truth stem, e.g. grade_1_english")
    ap.add_argument("--chapter", type=int, required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--grade", type=int, required=True)
    ap.add_argument("--judge", default=DEFAULT_JUDGE)
    ap.add_argument("--segments", help="comma-separated segment_index filter")
    a = ap.parse_args()

    import pagecheck
    here = os.path.dirname(os.path.abspath(__file__))
    idx = pageres.index(pagecheck.load_pages(
        os.path.join(pagecheck.TRUTH, a.book)))
    with open(os.path.join(pagecheck.SEG, a.book + ".json")) as fh:
        segments = [s for s in json.load(fh)["segments"]
                    if s.get("chapter_number") == a.chapter]
    # A basics period is a calendar slot rather than a span of book: its row
    # is synthesised into the brief by `basicseg` and the segmentation corpus
    # never carries it. Filtering to one therefore filters to nothing -- and a
    # silent nothing is how a re-judge of twelve lessons judged seven and
    # still exited 0. Name every index that was asked for and not found, and
    # say where a basics period IS judged. bd-p8f1x.
    missing = []
    if a.segments:
        keep = {int(n) for n in a.segments.split(",")}
        segments = [s for s in segments if s.get("segment_index") in keep]
        found = {s.get("segment_index") for s in segments}
        for n in sorted(keep - found):
            missing.append(n)
            print("no segment row for %d in corpus/seg/%s.json, so it is a "
                  "basics period -- judge it with `basicsjudge --name "
                  "%s_ch%d_seg%d`" % (n, a.book, a.book, a.chapter, n))

    authored = os.path.join(here, "corpus-local", "authored")
    pairs, renders = [], {}
    for s in segments:
        path = os.path.join(authored, "%s_ch%d_seg%d.json"
                            % (a.book, a.chapter, s["segment_index"]))
        if not os.path.exists(path):
            print("no authored artefact for segment %s" % s["segment_index"])
            missing.append(s["segment_index"])
            continue
        pairs.append((path, s))
        with open(path) as fh:
            lp = json.load(fh)
        renders[path] = render_of(lp, s, grounding_of(s, idx)["pages"])

    # Judging nothing is not a pass. `basicsjudge` already holds this line;
    # the module it calls did not.
    if not pairs:
        print("nothing was judged")
        return 1
    print("judging %d artefacts with %s\n" % (len(pairs), a.judge))
    results = run_batch(pairs, idx, a.subject, a.grade, model=a.judge,
                        renders=renders)
    for r in results:
        print(line(r["stem"], r["score"], r["verdict"]))
    passed = sum(1 for r in results if r["verdict"].get("pass"))
    print("\n%d/%d pass the production gate" % (passed, len(results)))
    return 0 if passed == len(results) and not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
