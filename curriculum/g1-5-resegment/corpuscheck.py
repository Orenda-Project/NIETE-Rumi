"""Is the corpus actually there, before the build reads a byte of it.

The corpus is not committed. Its licence is restricted-educational-internal,
so page truth, the pipeline intermediates and every rendered lesson plan stay
local and untracked, and `corpus/` beside build.py is normally three symlinks
into wherever this machine keeps them. Two things follow, and both have bitten:

  * a fresh clone has no corpus at all, and `glob` over a missing directory
    returns an empty list rather than complaining — so the build found no
    books, wrote four empty subject tabs over a live workbook, and reported
    success;
  * a symlink outlives its target, and `os.path.exists` follows the link, so
    a dangling link and an absent file are the same answer. The reader is
    then told "no such file" about a path they can see with their own eyes.

So the check runs first and says which path, whether the link is the problem,
and that CORPUS_DIR is the one env var that moves all three.
"""
import os

WAY_OUT = ("set CORPUS_DIR to the directory holding seg/, fde/ and "
           "skillsmap.json, or link them into corpus/ beside build.py")


def problems(seg, fde, skillsmap):
    """One line per thing the build cannot read. Empty means go ahead."""
    out = []
    for what, path, kind in (("the segmentation corpus", seg, "directory"),
                             ("the FDE syllabus breakdowns", fde, "directory"),
                             ("the skills map", skillsmap, "file")):
        if os.path.isdir(path) if kind == "directory" else os.path.isfile(path):
            continue
        # islink is asked before exists on purpose: a dangling link is the
        # common case here and the only one where the path the reader sees is
        # not the path that is missing.
        if os.path.islink(path):
            out.append(f"{what}: {path} is a symlink to "
                       f"{os.readlink(path)}, which does not exist — "
                       f"{WAY_OUT}")
        else:
            out.append(f"{what}: no {kind} at {path} — {WAY_OUT}")
    return out


def require(seg, fde, skillsmap):
    """Stop the build rather than write empty tabs over a live workbook."""
    found = problems(seg, fde, skillsmap)
    if found:
        raise SystemExit("Cannot build — the corpus is not readable:\n  "
                         + "\n  ".join(found))
