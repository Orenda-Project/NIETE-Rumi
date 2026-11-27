#!/usr/bin/env python3
"""stale_text.py — which scenarios quote text the bot's source used to say, and no longer does?

WHY THIS EXISTS (bd-kbo9h0.10). The spec-first gate only checks that a .feature file changed, never that the right
scenario did, and nothing compared a scenario's quoted copy with the bot's. Main bot 639e0cdb5 (30 Oct 2026)
reworded the Urdu topic prompt; LP07 was written the same evening on a parallel branch, quoting the OLD prompt, and
merged after. LP07 then asserted text the bot could no longer send, and only a mutation pass three weeks later saw it.
Checking just the commit that changed the string would have missed it: LP07 was not on that commit's tree.

SO IT JUDGES A TREE, NOT A DIFF. A scenario's quote is STALE at <rev> when the bot's source at <rev> does not contain
it but some earlier commit's source did: that commit removed it, and it is named. A quote the source never had (an
LLM's answer, a DB row, a teacher's own words) is not judged. Fires both ways: at the commit that rewords a quoted
string, and at the merge that brings in a scenario quoting what the other side already reworded.

WHAT IS A QUOTE. "…" in a step, each data-table cell below the header, and doc-string lines, from scenarios that are
not @wip/@draft/@obsolete/@manual. Each is split at a literal \\n, an ellipsis, and a <placeholder> or {placeholder};
a part shorter than MIN_LEN, or with fewer than two letters, is ignored (button labels and ids are too common to
judge). The source is every tracked file under tenants.yaml's bot_root outside tests, specs, docs and .claude.

WHAT IT CANNOT SEE. A behaviour change that keeps every string: NIETE's lp612 receipt moved from the webhook's 👍 to
the bot's own 🙏, and 👍 is still in the source. Text the source builds from pieces, or escapes differently from
the scenario (\\' in JS), never matches, so it is never judged either way.

    python3 stale_text.py [--root <repo>] [--head <rev>] [--base <rev>] [--json]

THE RATCHET (--base), for the commit and push hooks: only what the change can have made stale is judged. A quote the
same scenario already had at <base>, which the source at <base> already lacked, is held and counted, not judged.
Without --base the whole tree is judged (slower: every quote the source lacks costs one history walk).
Exit 1 on any finding, else 0.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tenants_lite as _tl  # noqa: E402

MIN_LEN = 16
ID_TAG_RE = re.compile(r"^[A-Za-z]{1,5}\d{1,3}$")   # as check-scenario-coverage.py, priority tags excepted
PRIORITY_TAGS = frozenset({"p0", "p1", "p2", "p3"})
NOT_LIVE_TAGS = frozenset({"wip", "draft", "obsolete", "manual"})
STEP_KW = ("Given ", "When ", "Then ", "And ", "But ", "* ")
QUOTE_RE = re.compile(r'"([^"]+)"')
# a step that says a text is NOT sent quotes it to rule it out, and is right precisely when the source drops it (NIETE R08)
NEGATED_RE = re.compile(r"\b(not|never|no longer|without)\b|n't\b", re.I)
SLASH_CMD_RE = re.compile(r"(?<![\w/])(/[a-z][\w-]*)")
SPLIT_RE = re.compile(r"\\n|…|\.\.\.|<[^<>\s]+>|\{[^{}\s]+\}")
SOURCE_PATHSPEC = [":(exclude)tests", ":(exclude)test", ":(exclude).claude", ":(exclude)docs",
                   ":(exclude,glob)**/*.feature", ":(exclude,glob)**/*.md", ":(exclude,glob)**/__golden__/**",
                   ":(exclude,glob)**/__tests__/**", ":(exclude,glob)**/*.test.*"]


def _spec_dir(root):
    try:
        return _tl.load(root).spec_dir
    except _tl.ManifestError:
        return None


def _bot_root(root):
    """where the bot's runtime lives (tenants.yaml bot_root): NIETE `bot`, the main bot `.`. A WhatsApp scenario
    quotes the bot, and reading a stored revision's whole tree costs 2 s a pass on NIETE, portal and all."""
    try:
        return _tl.load(root).bot_root or "."
    except _tl.ManifestError:
        return "."


def _source(root):
    return [_bot_root(root)] + SOURCE_PATHSPEC


def git(root, *args, ok=(0,)):
    r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    if r.returncode not in ok:
        raise RuntimeError("git %s: %s" % (" ".join(args[:3]), r.stderr.strip()))
    return r.stdout


def parts(text):
    """the judgeable parts of one quote"""
    out = []
    for p in SPLIT_RE.split(text):
        p = p.strip().strip("\"'").strip()
        if len(p) >= MIN_LEN and sum(c.isalpha() for c in p) >= 2:
            out.append(p)
    return out


def quotes(spec_text):
    """[(id or None, scenario name, part)] for every live scenario in one .feature file"""
    feature_tags, pending, cur, out = [], [], None, []
    in_doc, header_next = False, False
    for raw in spec_text.splitlines():
        line = raw.strip()
        if line.startswith('"""') or line.startswith("```"):
            in_doc = not in_doc
            continue
        if in_doc:
            if cur:
                out += [(cur, p) for p in parts(line)]
            continue
        if not line or line.startswith("#"):
            continue
        if line.startswith("@"):
            pending += [t[1:] for t in line.split() if t.startswith("@")]
            continue
        if line.startswith("Feature:"):
            feature_tags, pending = pending, []
            continue
        if re.match(r"(Scenario|Scenario Outline|Scenario Template|Example):", line):
            tags = feature_tags + pending
            pending = []
            ids = [t for t in tags if ID_TAG_RE.match(t) and t.lower() not in PRIORITY_TAGS]
            cur = None if set(tags) & NOT_LIVE_TAGS else (ids[0] if ids else None, line.split(":", 1)[1].strip())
            continue
        if line.startswith(("Background:", "Rule:", "Examples:")):
            cur = cur if line.startswith("Examples:") else None
            header_next = line.startswith("Examples:")
            continue
        if cur is None:
            continue
        if line.startswith("|"):
            if header_next:
                header_next = False
                continue
            for cell in line.strip("|").split("|"):
                out += [(cur, p) for p in parts(cell.strip())]
            continue
        if line.startswith(STEP_KW):
            header_next = True
            if NEGATED_RE.search(QUOTE_RE.sub("", line)):
                continue
            for q in QUOTE_RE.findall(line):
                out += [(cur, p) for p in parts(q)]
    return [(sid, name, p) for (sid, name), p in out]


def scenario_quotes(root, rev, spec_dir):
    """{(feature, key): {"id", "scenario", "parts": set}} at rev, key = id or scenario name"""
    out = {}
    names = git(root, "ls-tree", "-r", "--name-only", rev, "--", spec_dir).split("\n")
    for path in (n for n in names if n.endswith(".feature")):
        feature = os.path.basename(path)[:-len(".feature")]
        for sid, name, p in quotes(git(root, "show", "%s:%s" % (rev, path))):
            e = out.setdefault((feature, sid or name), {"id": sid, "scenario": name, "parts": set()})
            e["parts"].add(p)
    return out


def _spellings(t):
    """how source code can spell t: as is, inside a string literal whose own quote mark it escapes, or with each
    /command between direction marks. Main bot
    66487daa6 moved LP07's Urdu prompt from '…"گریڈ 5…"' to "…\\"گریڈ 5…\\"": same text, and without this a false alarm."""
    out = {t, t.replace('"', '\\"'), t.replace("'", "\\'")}
    # NIETE c1fddf35a wraps a /command in U+2066…U+2069 so it prints left-to-right inside Urdu; the source spells
    # them as \u escapes, or as the characters themselves
    for lo, hi in (("\\u2066", "\\u2069"), ("\u2066", "\u2069")):
        out |= {SLASH_CMD_RE.sub(lambda m: lo + m.group(1) + hi, v) for v in list(out)}
    return out


def in_source(root, rev, texts):
    """the subset of texts present, in any spelling, in the bot's source at rev"""
    spelt = {}
    for t in texts:
        for v in _spellings(t):
            spelt.setdefault(v, set()).add(t)
    hit, left = set(), set(spelt)
    while left:
        # -o prints one match per position, so a text inside a longer one goes unreported while the longer one is
        # in the pattern set: ask again for what is left until a pass finds nothing new
        got = set()
        todo = sorted(left)
        for i in range(0, len(todo), 200):
            args = ["grep", "-F", "-o", "-h", "-I", "--no-color"]
            for v in todo[i:i + 200]:
                args += ["-e", v]
            got |= set(git(root, *args, rev, "--", *_source(root), ok=(0, 1)).split("\n")) & left
        if not got:
            break
        hit |= got
        left -= got
    return {t for v in hit for t in spelt[v]}


def removed_by(root, rev, texts):
    """{text: short sha of the newest commit (reachable from rev) that changed how often the source contains it}.
    The text is absent at rev, so that commit is the one that removed it. A text the source never had walks the
    whole history (1.7 s on the main bot's 5,000 commits), which is why check() asks only about what a change can
    have made stale. One --pickaxe-regex pass over many texts at once was slower still: 32 s for seven."""
    out = {}
    for t in sorted(texts):
        sha = git(root, "log", "-S", t, "-1", "--format=%h", "--abbrev=9", rev, "--", *_source(root)).strip()
        if sha:
            out[t] = sha
    return out


def stale(root, rev, spec_dir, settled=frozenset()):
    """(findings at rev, how many quotes were not judged because they are in `settled`)"""
    sq = scenario_quotes(root, rev, spec_dir)
    pairs = [(f, k, e, p) for (f, k), e in sorted(sq.items(), key=lambda kv: (kv[0][0], str(kv[0][1])))
             for p in sorted(e["parts"])]
    judge = {p for f, k, _, p in pairs if (f, k, p) not in settled}
    missing = judge - in_source(root, rev, judge)
    gone = removed_by(root, rev, missing) if missing else {}
    out = [{"feature": f, "id": e["id"], "scenario": e["scenario"], "text": p, "removed_by": gone[p]}
           for f, k, e, p in pairs if (f, k, p) not in settled and p in gone]
    return out, sum(1 for f, k, _, p in pairs if (f, k, p) in settled)


def check(root, head="HEAD", base=None):
    """(findings, held). Without base every quote at head is judged and held is 0. With base, a quote the same
    scenario already had at base, while the source at base already lacked it, is HELD: not judged. Either it was
    stale before this change or it was never the bot's text, and this change made neither so. Proving which would
    walk the whole history for every LLM answer a scenario quotes (32 s on the LP07 merge), so it is skipped."""
    spec_dir = _spec_dir(root)
    if not spec_dir:
        return [], 0
    settled = set()
    if base:
        bq = scenario_quotes(root, base, spec_dir)
        bparts = {p for e in bq.values() for p in e["parts"]}
        absent = bparts - in_source(root, base, bparts)
        settled = {(f, k, p) for (f, k), e in bq.items() for p in e["parts"] if p in absent}
    return stale(root, head, spec_dir, settled)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=None)
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--base", default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    root = a.root or _tl.repo_root()
    new, held = check(root, a.head, a.base)
    if a.json:
        print(json.dumps({"new": new, "held": held}, ensure_ascii=False, indent=2))
        return 1 if new else 0
    for f in new:
        print("  STALE %s/%s — quotes %r, which the bot's source no longer has (removed by %s). Update the "
              "scenario to what the bot says now: git show %s" % (f["feature"], f["id"] or f["scenario"], f["text"],
                                                                 f["removed_by"], f["removed_by"]))
    if new:
        return 1
    print("✓ no scenario quotes text the source removed%s" %
          (" · %d quote(s) already unmatched on %s, not judged" % (held, a.base) if held else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
