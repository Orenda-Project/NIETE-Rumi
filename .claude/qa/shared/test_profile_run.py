#!/usr/bin/env python3
"""Stdlib assert tests for profile_run (the mock-lane profiler). Run: python3 test_profile_run.py

Red-first: fails on sandbox — profile_run.py does not exist.

A synthetic run dir is built here on purpose: these are unit tests of the BUILDER (span tree,
layer split, percentiles, bottleneck ranking, run comparison). The dashboard itself is only ever
fed real runs — see docs/e2e-profiling.md.
"""
import json, os, tempfile

import profile_run as pr


def _write(p, rows):
    with open(p, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def _run_dir(scen_ms=(3000, 6000), base=1_700_000_000_000):
    d = tempfile.mkdtemp(prefix="profile-run-")
    os.makedirs(os.path.join(d, "db"))
    t = base
    spans = []
    sid = [0]

    def span(name, layer, kind, t0, ms, parent=None, status="ok", attrs=None):
        sid[0] += 1
        row = {"v": 1, "run": "r1", "feature": "menu", "span": "s%d" % sid[0], "parent": parent,
               "name": name, "layer": layer, "kind": kind, "t0": t0, "t1": t0 + ms, "ms": ms,
               "status": status, "attrs": attrs or {}}
        spans.append(row)
        return row["span"]

    # scenario M01: one send = quiesce 800 + inject 20 + bot 200 + detect 300 + settle 1500; 180 ms driver idle
    s = span("send", "harness", "primitive", t, 2820, attrs={"text": "/menu"})
    span("wait.quiesce", "wait", "intentional", t, 800, s)
    span("mock.inject", "mock", "http", t + 800, 20, s, attrs={"ackMs": 18, "messageId": "sim_1"})
    span("bot.reply", "bot", "processing", t + 820, 200, s)
    span("poll.detect", "harness", "polling", t + 1020, 300, s)
    span("wait.settle", "wait", "intentional", t + 1320, 1500, s)
    spans.append({"v": 1, "run": "r1", "feature": "menu", "span": "sc1", "parent": None, "name": "scenario",
                  "layer": "scenario", "kind": "scenario", "t0": t, "t1": t + scen_ms[0], "ms": scen_ms[0],
                  "status": "PASS", "attrs": {"id": "M01", "title": "/menu renders"}})
    t2 = t + scen_ms[0]
    # scenario M08: a send whose bot time is 4000 (an LLM answer), FAIL
    s2 = span("send", "harness", "primitive", t2, 5800, attrs={"text": "What are two…"})
    span("wait.quiesce", "wait", "intentional", t2, 800, s2)
    span("mock.inject", "mock", "http", t2 + 800, 30, s2, attrs={"ackMs": 25, "messageId": "sim_2"})
    span("bot.reply", "bot", "processing", t2 + 830, 4000, s2)
    span("poll.detect", "harness", "polling", t2 + 4830, 170, s2)
    span("wait.settle", "wait", "intentional", t2 + 5000, 800, s2)
    spans.append({"v": 1, "run": "r1", "feature": "menu", "span": "sc2", "parent": None, "name": "scenario",
                  "layer": "scenario", "kind": "scenario", "t0": t2, "t1": t2 + scen_ms[1], "ms": scen_ms[1],
                  "status": "FAIL", "attrs": {"id": "M08", "title": "Ask Anything answers"}})
    _write(os.path.join(d, "trace-menu.jsonl"), spans)
    # DB: two queries inside M01's bot window, one inside M08's
    _write(os.path.join(d, "db", "db-timing.jsonl"), [
        {"ts": t + 830, "ms": 12, "method": "GET", "table": "users", "status": 200, "bytes": 300, "query": "select=*"},
        {"ts": t + 850, "ms": 8, "method": "GET", "table": "app_settings", "status": 200, "bytes": 50, "query": ""},
        {"ts": t2 + 900, "ms": 40, "method": "POST", "table": "conversations", "status": 201, "bytes": 0, "query": ""},
    ])
    # cassette: one LLM hit inside M08's bot window, recorded live at 3.9 s
    _write(os.path.join(d, "cassette-trace.jsonl"), [
        {"ts": t2 + 1000, "kind": "llm", "outcome": "hit", "ms": 6, "liveMs": 3900, "key": "llm-abc"},
    ])
    json.dump({"feature": "menu", "wallMs": 9000, "scenarios": 2, "pass": 1, "fail": 1, "other": 0,
               "results": [{"id": "M01", "verdict": "PASS", "ms": scen_ms[0]}, {"id": "M08", "verdict": "FAIL", "ms": scen_ms[1]}]},
              open(os.path.join(d, "menu.json"), "w"))
    json.dump({"commit_sha": "abc123def4567890", "started_at": "2026-10-23T01:00:00Z", "db": "local", "queue": "bullmq"},
              open(os.path.join(d, "stack.json"), "w"))
    json.dump({"run": "r1", "method": "mock", "features_planned": {"menu": 2}, "driver": "923000000001"},
              open(os.path.join(d, "run.json"), "w"))
    with open(os.path.join(d, "runner.log"), "w") as f:
        f.write("=== suite start 2026-10-23T01:00:00Z\n--- menu START 01:00:30\n--- menu END 01:00:39 (9s) exit=0\n")
    return d


def test_scenarios_get_their_spans_by_time_and_a_layer_split():
    p = pr.build(_run_dir())
    assert p["run_id"] == "r1" and p["feature"] == "menu"
    m01 = next(s for s in p["scenarios"] if s["id"] == "M01")
    assert m01["status"] == "PASS" and m01["ms"] == 3000
    assert m01["layers"]["wait.intentional"] == 2300          # quiesce + settle
    assert m01["layers"]["bot.processing"] == 200
    assert m01["layers"]["harness.polling"] == 300
    assert m01["layers"]["mock.http"] == 20
    assert m01["layers"]["driver.unaccounted"] == 180         # 3000 - 2820
    assert m01["db"]["count"] == 2 and m01["db"]["ms"] == 20
    assert m01["vendor"]["count"] == 0


def test_vendor_calls_land_in_the_scenario_whose_window_they_fall_in():
    p = pr.build(_run_dir())
    m08 = next(s for s in p["scenarios"] if s["id"] == "M08")
    assert m08["vendor"] == {"count": 1, "ms": 6, "liveMs": 3900, "hits": 1, "misses": 0, "live": 0}
    assert m08["db"]["count"] == 1


def test_summary_percentiles_and_layer_totals():
    p = pr.build(_run_dir())
    s = p["summary"]
    assert s["scenarios"] == 2 and s["passed"] == 1 and s["failed"] == 1
    assert s["total_ms"] == 9000 and s["mean_ms"] == 4500 and s["p50_ms"] == 3000 and s["p95_ms"] == 6000
    assert s["layers"]["wait.intentional"] == 3900 and s["layers"]["bot.processing"] == 4200
    assert abs(s["intentional_share"] - 3900 / 9000) < 1e-6


def test_bottlenecks_are_ranked_by_total_and_classified():
    p = pr.build(_run_dir())
    top = p["bottlenecks"][0]
    assert top["op"] == "bot.reply" and top["total_ms"] == 4200 and top["count"] == 2 and top["category"] == "processing"
    names = [b["op"] for b in p["bottlenecks"]]
    assert names.index("wait.settle") < names.index("wait.quiesce")
    settle = next(b for b in p["bottlenecks"] if b["op"] == "wait.settle")
    assert settle["category"] == "intentional" and settle["p50_ms"] in (800, 1500) and settle["max_ms"] == 1500


def test_percentile_helper():
    assert pr.percentile([1, 2, 3, 4, 5], 50) == 3
    assert pr.percentile([1, 2, 3, 4, 5], 90) == 5
    assert pr.percentile([], 50) == 0


def test_compare_flags_regressions_and_improvements():
    a = pr.build(_run_dir(scen_ms=(3000, 6000)))
    b = pr.build(_run_dir(scen_ms=(3000, 9000), base=1_700_000_100_000))
    c = pr.compare(a, b)
    assert c["total_ms"] == {"a": 9000, "b": 9000 + 3000, "delta_ms": 3000}
    reg = [r for r in c["scenarios"] if r["id"] == "M08"][0]
    assert reg["delta_ms"] == 3000 and reg["verdict"] == "regression"
    same = [r for r in c["scenarios"] if r["id"] == "M01"][0]
    assert same["verdict"] == "same"


def test_bot_log_timeline_is_parsed_into_correlated_events():
    d = _run_dir()
    with open(os.path.join(d, "bot.log"), "w") as f:
        f.write("[2026-10-23 06:00:00.100 +0500] \x1b[32mINFO\x1b[39m: \x1b[36m=== INCOMING WEBHOOK ===\x1b[39m\n")
        f.write("    service: \"rumi-bot\"\n    correlationId: \"corr-1-aaa\"\n")
        f.write("[2026-10-23 06:00:00.105 +0500] INFO: Message received from 923\n    correlationId: \"corr-1-aaa\"\n    messageId: \"sim_1\"\n")
        f.write("[2026-10-23 06:00:00.300 +0500] INFO: Sent menu\n    correlationId: \"corr-1-aaa\"\n")
        f.write("[2026-10-23 06:00:01.000 +0500] WARN: unrelated line\n")
    tl = pr.parse_pino_pretty(os.path.join(d, "bot.log"))
    assert [e["msg"] for e in tl["corr-1-aaa"]] == ["=== INCOMING WEBHOOK ===", "Message received from 923", "Sent menu"]
    assert tl["corr-1-aaa"][0]["ts"] == 1792717200100
    assert tl["corr-1-aaa"][1]["fields"]["messageId"] == "sim_1"
    by_msg = pr.correlation_by_message(tl)
    assert by_msg["sim_1"] == "corr-1-aaa"


def test_index_lists_profiles_newest_first():
    d1 = _run_dir(); d2 = _run_dir(base=1_700_000_500_000)
    out = tempfile.mkdtemp(prefix="profiles-")
    p2 = pr.build(d2); p2["run_id"] = "r2"   # a re-publish of the SAME run replaces its entry
    pr.publish(pr.build(d1), out); pr.publish(p2, out); pr.publish(p2, out)
    idx = json.load(open(os.path.join(out, "index.json")))
    assert len(idx["profiles"]) == 2
    assert all(set(e) >= {"run_id", "feature", "started", "total_ms", "scenarios", "passed", "failed", "file"} for e in idx["profiles"])


if __name__ == "__main__":
    import sys
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print("ok   ", name)
            except AssertionError as e:
                fails += 1; print("FAIL ", name, e)
            except Exception as e:  # noqa: BLE001
                fails += 1; print("ERROR", name, type(e).__name__, e)
    sys.exit(1 if fails else 0)
