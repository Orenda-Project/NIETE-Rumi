#!/usr/bin/env python3
"""Stdlib assert tests for select_scenarios. Run: python3 test_select_scenarios.py

The behaviours the scenario selector exists to get right:

  1. a source file a scenario NAMES          -> exactly the scenarios that name it
  2. a spec edit                             -> exactly the scenarios whose lines changed
  3. a spec deletion / header-only edit      -> nothing to drive (scope none)
  4. a path no scenario names                -> the WHOLE feature, with the path that forced it
  5. a scenarios: pin in feature-map.yaml    -> exactly the pinned ids, over name matching
  6. @obsolete scenarios                     -> never selected
  7. the `only` string run-suite takes       -> one `feature=ids` per subset feature
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import select_scenarios as ss  # noqa: E402

SPEC = """@whatsapp
Feature: demo

  @e2e @P1 @COA01
  Scenario: The menu row asks for a recording
    Given the chat is open
    # menu.service.js _handleClassroomCoachingChoice

  @e2e @wip @COA09
  Scenario: A second recording mid-analysis is deferred
    Given an analysis is in flight
    # coaching-inflight-guard.js shouldDeferNewClassroomAudio (bd-2376)

  @e2e @COA20
  Scenario: The same recording twice returns the old report
    Given a report exists
    # bd-7beiz — audio-hash-cache.js: SHA-256 of the downloaded audio

  @obsolete @e2e @COA33
  Scenario: A short reply is not a plan
    # coaching-inflight-guard.js was once part of this
"""


def sel(feature, *paths):
    return {"features": [feature], "reasons": {feature: [{"path": p} for p in paths]}}


def run(selection, pins=None, rev_range=None, repo="/nonexistent"):
    return ss.select(selection, repo, rev_range, pins or {}, spec_reader=lambda f: SPEC)


# 0. parsing: ids, ranges, comment lines belong to the scenario above them
sc = ss.spec_scenarios(SPEC)
assert [s["id"] for s in sc] == ["COA01", "COA09", "COA20", "COA33"], sc
assert "coaching-inflight-guard.js" in sc[1]["text"] and "audio-hash-cache" not in sc[1]["text"]
assert sc[3]["obsolete"] is True

# name tokens: basename, stem, distinctive core; short cores are not names
assert ss.name_tokens("bot/shared/services/coaching/coaching-inflight-guard.js") == [
    "coaching-inflight-guard", "coaching-inflight-guard.js"]
assert "audio" not in ss.name_tokens("bot/shared/services/audio.service.js")
assert "app-redirect" in ss.name_tokens("bot/x/app-redirect.service.js")   # 12 chars: distinctive enough to match
assert not ss.mentions("lp-menu.service.js", "menu.service.js")

# 1. a named source file → exactly the scenarios naming it (obsolete excluded — 6.)
r = run(sel("coaching", "bot/shared/services/coaching/coaching-inflight-guard.js"))["features"]["coaching"]
assert r["scope"] == "subset" and r["ids"] == ["COA09"], r
r = run(sel("coaching", "bot/shared/services/coaching/audio-hash-cache.js",
            "bot/shared/services/coaching/coaching-inflight-guard.js"))["features"]["coaching"]
assert r["ids"] == ["COA09", "COA20"], r   # spec order, not path order

# 4. a path no scenario names → the whole feature, and why
r = run(sel("coaching", "bot/shared/services/coaching/coaching-inflight-guard.js",
            "bot/shared/services/whatsapp.service.js"))["features"]["coaching"]
assert r["scope"] == "all" and any("whatsapp.service.js" in w for w in r["whole_feature_because"]), r

# 5. a pin wins over name matching for its path
pins = {"coaching": [("bot/shared/services/whatsapp.service.js", ["COA01", "COA20"])]}
r = run(sel("coaching", "bot/shared/services/whatsapp.service.js"), pins=pins)["features"]["coaching"]
assert r["scope"] == "subset" and r["ids"] == ["COA01", "COA20"], r
pins_bad = {"coaching": [("bot/shared/services/whatsapp.service.js", ["COA99"])]}
r = run(sel("coaching", "bot/shared/services/whatsapp.service.js"), pins=pins_bad)["features"]["coaching"]
assert r["scope"] == "all", r   # a pin to no live scenario is not a reason to drive nothing

# 2./3. spec edits, through a real git repo
tmp = tempfile.mkdtemp()
spec_dir = os.path.join(tmp, ss.SPEC_DIR)
os.makedirs(spec_dir)
spec_path = os.path.join(spec_dir, "coaching.feature")
g = lambda *a: subprocess.run(["git", "-C", tmp, *a], capture_output=True, text=True, check=True)  # noqa: E731
g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t")
g("config", "core.hooksPath", "/dev/null")
open(spec_path, "w").write(SPEC); g("add", "-A"); g("commit", "-qm", "base")
open(spec_path, "w").write(SPEC.replace("Given a report exists", "Given a report exists for that file"))
g("commit", "-qam", "edit COA20")
spec_rel = ss.SPEC_DIR + "/coaching.feature"
reader = lambda f: open(spec_path).read()  # noqa: E731
r = ss.select(sel("coaching", spec_rel), tmp, "HEAD~1...HEAD", {}, spec_reader=reader)["features"]["coaching"]
assert r["scope"] == "subset" and r["ids"] == ["COA20"], r
cur = open(spec_path).read()
open(spec_path, "w").write(cur.replace("@whatsapp\nFeature: demo", "@whatsapp @ict\nFeature: demo"))
g("commit", "-qam", "header only")
r = ss.select(sel("coaching", spec_rel), tmp, "HEAD~1...HEAD", {}, spec_reader=reader)["features"]["coaching"]
assert r["scope"] == "none", r
txt = open(spec_path).read()
cut = txt.index("  @e2e @COA20")
open(spec_path, "w").write(txt[:cut] + txt[txt.index("  @obsolete"):])
g("commit", "-qam", "delete COA20")
r = ss.select(sel("coaching", spec_rel), tmp, "HEAD~1...HEAD", {}, spec_reader=reader)["features"]["coaching"]
assert r["scope"] == "none", r   # a deleted scenario drives nothing

# 8. a scenario phase 1 adds AFTER the code commit is still driven (spec_base → the working tree).
#    The code commit narrows coaching to COA09; phase 1 then writes COA21 for the new behaviour, which
#    names no changed file. Diffing only the code commit never sees it, so it was silently left out.
tmp2 = tempfile.mkdtemp()
os.makedirs(os.path.join(tmp2, ss.SPEC_DIR))
os.makedirs(os.path.join(tmp2, "bot"))
sp2 = os.path.join(tmp2, ss.SPEC_DIR, "coaching.feature")
g2 = lambda *a: subprocess.run(["git", "-C", tmp2, *a], capture_output=True, text=True, check=True)  # noqa: E731
g2("init", "-q"); g2("config", "user.email", "t@t"); g2("config", "user.name", "t")
g2("config", "core.hooksPath", "/dev/null")
open(sp2, "w").write(SPEC); open(os.path.join(tmp2, "bot", "coaching-inflight-guard.js"), "w").write("a\n")
g2("add", "-A"); g2("commit", "-qm", "base")
open(os.path.join(tmp2, "bot", "coaching-inflight-guard.js"), "w").write("b\n")
g2("commit", "-qam", "code change")
NEW = ("\n  @e2e @COA21\n  Scenario: A recording sent while the guard is down is analysed\n"
       "    Given the guard is down\n")
open(sp2, "a").write(NEW)                                   # phase 1, not yet committed
reader2 = lambda f: open(sp2).read()  # noqa: E731
code_only = sel("coaching", "bot/coaching-inflight-guard.js")
r = ss.select(code_only, tmp2, "HEAD~1...HEAD", {}, spec_reader=reader2)["features"]["coaching"]
assert r["ids"] == ["COA09"], r                             # without spec_base: the old blind spot
r = ss.select(code_only, tmp2, "HEAD~1...HEAD", {}, spec_reader=reader2, spec_base="HEAD~1")["features"]["coaching"]
assert r["scope"] == "subset" and r["ids"] == ["COA09", "COA21"], r
g2("add", "-A"); g2("commit", "-qm", "test(gherkin): sync coaching")   # phase 1 committed separately
r = ss.select(code_only, tmp2, "HEAD~2...HEAD~1", {}, spec_reader=reader2, spec_base="HEAD~2")["features"]["coaching"]
assert r["ids"] == ["COA09", "COA21"], r
# a feature that runs whole stays whole; one with nothing to drive gains the new scenario
r = ss.select(sel("coaching", "bot/shared/services/whatsapp.service.js"), tmp2, "HEAD~2...HEAD~1", {},
              spec_reader=reader2, spec_base="HEAD~2")["features"]["coaching"]
assert r["scope"] == "all", r

# 7. the only string: subset features only
two = {"features": ["coaching", "menu"],
       "reasons": {"coaching": [{"path": "bot/x/coaching-inflight-guard.js"}],
                   "menu": [{"path": "bot/shared/services/whatsapp.service.js"}]}}
out = run(two)
assert out["only"] == "coaching=COA09", out["only"]
assert out["features"]["menu"]["scope"] == "all"

print("select_scenarios: all assertions passed")
