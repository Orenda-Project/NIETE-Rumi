#!/usr/bin/env python3
"""profile_run.py — the mock lane's performance profile for ONE run × feature (bd-5zzbvq).

    python3 profile_run.py <run_dir> [--feature <f>] [--publish <profiles_dir>] [--json]
    python3 profile_run.py --compare <a.json> <b.json> [--json]

Reads what the lane already leaves in a run dir, builds the span tree per scenario, splits every
scenario's time into layers, ranks the operations, and writes <run_dir>/profile-<feature>.json
(+ a copy under --publish, with an index.json the dashboard reads). Zero dependencies, never
fabricates: a layer with no evidence is reported as 0 and the gaps are named in `gaps`.

Inputs (all optional except the trace):
  trace-<feature>.jsonl        the harness span trace (trace.cjs via mock-api.cjs / feature-runner.cjs)
  transcript.jsonl             the mock Graph API's two-sided conversation (in / ack / out, with ts)
  db/db-timing.jsonl           every PostgREST request through the local DB proxy (ts, ms, table…)
  cassette-trace.jsonl         every vendor call the cassette mediated (hit/miss/live, ms, liveMs)
  bot.log / worker.log         pino-pretty logs; parsed into per-correlation timelines (point events)
  <feature>.json, stack.json, run.json, runner.log   verdicts and provenance

Layer taxonomy (own-time of each span, so nothing is counted twice):
  wait.intentional     quiesce / settle / app-setting settle — the harness CHOSE to wait
  bot.processing       webhook left the mock → the bot's first send landed (bot time, exact)
  harness.polling      the bot had answered, the harness had not noticed yet (poll granularity)
  mock.http            the inject round trip, incl. the bot's webhook ack
  flow                 Flow-emulator primitives (data_exchange calls to the bot's endpoint included)
  seed                 python seeds / DB reach-through / app-setting flips (setup inside a scenario)
  harness.overhead     a primitive's own compute (JSON, outbox scans) — usually ~0
  driver.unaccounted   scenario time no primitive covers: the driver's own sleeps and polling loops

Tests: python3 test_profile_run.py
"""
import argparse
import datetime
import glob
import json
import os
import re
import sys

# ── small helpers ───────────────────────────────────────────────────────────────

def percentile(xs, p):
    """Nearest-rank percentile on a list of numbers; 0 for an empty list."""
    if not xs:
        return 0
    ys = sorted(xs)
    k = max(1, -(-int(p * len(ys)) // 100))   # ceil(p/100 * n) without floats
    return ys[min(len(ys), k) - 1]


def _jsonl(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    return rows


def _json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _stats(xs):
    xs = [int(x) for x in xs]
    return {"count": len(xs), "total_ms": sum(xs), "mean_ms": (sum(xs) // len(xs)) if xs else 0,
            "p50_ms": percentile(xs, 50), "p90_ms": percentile(xs, 90), "p95_ms": percentile(xs, 95),
            "max_ms": max(xs) if xs else 0}


# ── layer classification ────────────────────────────────────────────────────────

LAYERS = ["wait.intentional", "bot.processing", "bot.pacing", "bot.timeout", "harness.polling", "mock.http", "flow", "seed",
          "harness.overhead", "driver.sleep", "driver.unaccounted"]
# driver.sleep: a feature script's sleep() on the mock lane (mock-api smartSleep, bd-aqi0ay) — long-polls the outbox and
# wakes when the bot answers. Accounted, so what remains in driver.unaccounted is the script's own compute and seeds.
# bot.timeout: a bot.reply that never came — the harness waited its full timeout (60–120 s). Not processing: nothing
# answered. Counted apart so one missing reply cannot masquerade as the slowest bot work of the run.
# bot.pacing: time the bot's own WhatsApp send pacer (whatsapp-send-pacer.js, GCRA per phone, 6 s interval,
# burst 8) made a reply WAIT before it reached the mock — read off the `whatsapp.paced` log events of the
# message's correlation (outcome 'waited', delayMs). It sits INSIDE bot.reply; the profiler moves it out of
# bot.processing so an intentional, production-faithful wait is never read as slow code.


def layer_of(span):
    """Which layer a span's OWN time belongs to."""
    layer, kind, name = span.get("layer"), span.get("kind"), span.get("name", "")
    if layer == "wait" or kind == "intentional":
        return "wait.intentional"
    if name == "bot.pacing":
        return "bot.pacing"
    if name == "bot.reply" and span.get("status") == "timeout":
        return "bot.timeout"
    if name == "bot.reply" or (layer == "bot" and kind == "processing"):
        return "bot.processing"
    if kind == "polling":
        return "harness.polling"
    if layer == "mock":
        return "mock.http"
    if layer == "flow":
        return "flow"
    if layer == "harness-db" or kind == "seed":
        return "seed"
    if layer == "driver":
        return "driver.sleep"
    return "harness.overhead"


def category_of(span):
    kind, name = span.get("kind"), span.get("name", "")
    if kind == "intentional":
        return "intentional"
    if name == "bot.reply" and span.get("status") == "timeout":
        return "timeout"
    if name == "bot.reply" or kind == "processing":
        return "processing"
    if kind == "polling":
        return "polling"
    if kind == "http":
        return "http"
    if kind == "seed":
        return "setup"
    if span.get("layer") == "flow":
        return "flow"
    return "harness"


# ── the pino-pretty parser (bot.log / worker.log) ───────────────────────────────

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_HEAD = re.compile(r"^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3}) ([+-])(\d{2})(\d{2})\] (\w+): (.*)$")
_FIELD = re.compile(r"^    (\w+): (.*)$")


def parse_pino_pretty(path, limit_per_corr=400):
    """{correlationId: [{ts, level, msg, fields}]} — the bot's own timeline per request, as point events.
    pino-pretty writes one header line per entry and one indented `key: value` line per scalar field;
    nested objects span several lines and are skipped (they carry no timing)."""
    out = {}
    cur = None
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return out
    with f:
        for raw in f:
            line = _ANSI.sub("", raw.rstrip("\n"))
            m = _HEAD.match(line)
            if m:
                d, t, ms, sign, hh, mm = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5), m.group(6)
                off = (int(hh) * 60 + int(mm)) * (1 if sign == "+" else -1)
                dt = datetime.datetime.strptime(d + " " + t, "%Y-%m-%d %H:%M:%S").replace(
                    tzinfo=datetime.timezone(datetime.timedelta(minutes=off)))
                cur = {"ts": int(dt.timestamp()) * 1000 + int(ms), "level": m.group(7), "msg": m.group(8).strip(), "fields": {}}
                continue
            fm = _FIELD.match(line) if cur is not None else None
            if fm:
                k, v = fm.group(1), fm.group(2)
                try:
                    v = json.loads(v)
                except ValueError:
                    pass
                cur["fields"][k] = v
                if k == "correlationId" and isinstance(v, str):
                    lst = out.setdefault(v, [])
                    if len(lst) < limit_per_corr:
                        lst.append(cur)
                continue
    return out


def correlation_by_message(timelines):
    """messageId → correlationId, from the bot's 'Message received' entries (fields.messageId)."""
    by = {}
    for corr, events in timelines.items():
        for e in events:
            mid = e.get("fields", {}).get("messageId")
            if isinstance(mid, str) and mid not in by:
                by[mid] = corr
    return by


# ── the builder ────────────────────────────────────────────────────────────────

def _load_spans(run_dir, feature):
    files = sorted(glob.glob(os.path.join(run_dir, "trace-*.jsonl")))
    if feature:
        files = [f for f in files if os.path.basename(f) == "trace-%s.jsonl" % feature]
    spans = []
    for f in files:
        spans.extend(_jsonl(f))
    return spans


def _runner_log(run_dir):
    """Suite start, per-feature START/END and the stack's own setup lines, from runner.log."""
    info = {"suite_start": None, "features": {}, "stack_lines": []}
    try:
        with open(os.path.join(run_dir, "runner.log"), encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.rstrip("\n")
                m = re.search(r"=== suite start (\S+)", line) or re.search(r"^=== .*? · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)", line)
                if m and not info["suite_start"]:
                    info["suite_start"] = m.group(1)
                m = re.search(r"--- (\S+) START (\d{2}:\d{2}:\d{2})", line)
                if m:
                    info["features"].setdefault(m.group(1), {})["start"] = m.group(2)
                m = re.search(r"--- (\S+) END (\d{2}:\d{2}:\d{2}) \((\d+)s\)", line)
                if m:
                    info["features"].setdefault(m.group(1), {}).update({"end": m.group(2), "seconds": int(m.group(3))})
                if "[local-stack]" in line or "[local-db]" in line:
                    info["stack_lines"].append(line.strip()[:200])
    except OSError:
        pass
    return info


def _hms_to_ms(hms):
    h, m, s = hms.split(":")
    return (int(h) * 3600 + int(m) * 60 + int(s)) * 1000


def build(run_dir, feature=None):
    run_dir = os.path.abspath(run_dir)
    spans = _load_spans(run_dir, feature)
    if not feature:
        feats = sorted({s.get("feature") for s in spans if s.get("feature")})
        feature = feats[0] if feats else None
    spans = [s for s in spans if not feature or s.get("feature") in (feature, None)]
    run_json = _json(os.path.join(run_dir, "run.json"), {}) or {}
    stack = _json(os.path.join(run_dir, "stack.json"), {}) or {}
    feat_json = _json(os.path.join(run_dir, "%s.json" % feature), {}) if feature else {}
    feat_json = feat_json or {}
    run_id = run_json.get("run") or os.path.basename(run_dir)

    by_id = {s["span"]: s for s in spans if "span" in s}
    children = {}
    for s in spans:
        if s.get("parent"):
            children.setdefault(s["parent"], []).append(s)
    scen_rows = sorted([s for s in spans if s.get("name") == "scenario"], key=lambda s: s["t0"])
    feature_rows = [s for s in spans if s.get("name") == "feature"]
    top = [s for s in spans if not s.get("parent") and s.get("name") not in ("scenario", "feature")]

    db_rows = _jsonl(os.path.join(run_dir, "db", "db-timing.jsonl"))
    vendor_rows = _jsonl(os.path.join(run_dir, "cassette-trace.jsonl"))
    transcript = _jsonl(os.path.join(run_dir, "transcript.jsonl"))

    def own_ms(s):
        kids = children.get(s.get("span"), [])
        return max(0, int(s.get("ms", 0)) - sum(int(k.get("ms", 0)) for k in kids))

    def tree(s):
        out = [s]
        for k in children.get(s.get("span"), []):
            out.extend(tree(k))
        return out

    # bot-side timelines, keyed by the mock message id the harness injected
    bot_tl = parse_pino_pretty(os.path.join(run_dir, "bot.log"))
    worker_tl = parse_pino_pretty(os.path.join(run_dir, "worker.log"))
    corr_of = correlation_by_message(bot_tl)

    def in_window(ts, a, b):
        return ts is not None and a <= ts < b

    scenarios, all_ops = [], []
    op_examples = {}
    for sc in scen_rows:
        a, b = sc["t0"], sc["t1"]
        prims = [p for p in top if in_window(p.get("t0"), a, b)]
        layers = {k: 0 for k in LAYERS}
        ops = []
        for p in prims:
            for s in tree(p):
                o = own_ms(s)
                layers[layer_of(s)] += o
                ops.append({"name": s.get("name"), "own_ms": o, "ms": int(s.get("ms", 0)), "status": s.get("status"),
                            "layer": s.get("layer"), "kind": s.get("kind"), "attrs": s.get("attrs") or {},
                            "span": s.get("span"), "parent": s.get("parent"), "t0": s.get("t0"), "t1": s.get("t1")})
        covered = sum(int(p.get("ms", 0)) for p in prims)
        layers["driver.unaccounted"] = max(0, int(sc.get("ms", 0)) - covered)
        dbw = [r for r in db_rows if in_window(r.get("ts"), a, b)]
        vw = [r for r in vendor_rows if in_window(r.get("ts"), a, b)]
        by_table = {}
        for r in dbw:
            t = by_table.setdefault("%s %s" % (r.get("method"), r.get("table")), {"count": 0, "ms": 0})
            t["count"] += 1
            t["ms"] += int(r.get("ms", 0))
        # the bot's own timeline for each message this scenario injected
        bot_traces = []
        for o in ops:
            mid = (o.get("attrs") or {}).get("messageId")
            if not mid or mid not in corr_of:
                continue
            corr = corr_of[mid]
            evs = bot_tl.get(corr, []) + worker_tl.get(corr, [])
            evs = sorted(evs, key=lambda e: e["ts"])
            if not evs:
                continue
            paced = sum(int(e.get("fields", {}).get("delayMs") or 0) for e in evs
                        if e.get("msg") == "whatsapp.paced" and e.get("fields", {}).get("outcome") == "waited")
            bot_traces.append({"messageId": mid, "correlationId": corr, "t0": evs[0]["ts"], "t1": evs[-1]["ts"],
                               "ms": evs[-1]["ts"] - evs[0]["ts"], "events": len(evs), "pacing_ms": paced,
                               "timeline": [{"dt": e["ts"] - evs[0]["ts"], "level": e["level"], "msg": e["msg"][:120],
                                             "src": "worker" if e in worker_tl.get(corr, []) else "bot"} for e in evs[:60]]})
        pacing = min(layers["bot.processing"], sum(b["pacing_ms"] for b in bot_traces))
        layers["bot.pacing"] = pacing
        layers["bot.processing"] -= pacing
        # the bot.reply spans carry the same split, so the op ranking separates pacing from processing too
        # the message id lives on the mock.inject sibling, not on bot.reply: map parent → messageId first
        mid_by_parent = {o["parent"]: (o.get("attrs") or {}).get("messageId") for o in ops if o["name"] == "mock.inject" and o.get("parent")}
        for o in list(ops):
            if o["name"] == "bot.reply" and pacing > 0:
                bt = next((b for b in bot_traces if b["messageId"] == mid_by_parent.get(o.get("parent"))), None)
                if bt and bt["pacing_ms"]:
                    cut = min(o["own_ms"], bt["pacing_ms"])
                    o["own_ms"] -= cut
                    ops.append({**o, "name": "bot.pacing", "own_ms": cut, "ms": cut, "kind": "intentional", "layer": "bot", "span": o["span"] + "-pace", "attrs": {**(o.get("attrs") or {}), "delayMs": cut}})
        scenarios.append({
            "id": (sc.get("attrs") or {}).get("id"), "title": (sc.get("attrs") or {}).get("title"),
            "status": sc.get("status"), "t0": a, "t1": b, "ms": int(sc.get("ms", 0)),
            "layers": layers, "primitives": len(prims),
            "db": {"count": len(dbw), "ms": sum(int(r.get("ms", 0)) for r in dbw), "by_table": by_table},
            "vendor": {"count": len(vw), "ms": sum(int(r.get("ms", 0)) for r in vw),
                       "liveMs": sum(int(r.get("liveMs") or 0) for r in vw),
                       "hits": sum(1 for r in vw if r.get("outcome") == "hit"),
                       "misses": sum(1 for r in vw if r.get("outcome") == "miss"),
                       "live": sum(1 for r in vw if r.get("outcome") == "live")},
            "spans": ops, "bot_traces": bot_traces,
        })
        for o in ops:
            all_ops.append((o, (sc.get("attrs") or {}).get("id")))

    # ── outside any scenario window: the feature's wall time is often far more than its scenarios' sum. A driver
    # seeds, navigates and polls BETWEEN the windows it measures (coaching walks a pipeline, training re-enters a
    # ladder) and a BLOCKED row is recorded with 0 ms after real work. Count the primitives that fall outside every
    # window, by op, and the idle time (no primitive, no scenario) — so the wall is accounted for, not just the sum.
    windows = sorted((sc["t0"], sc["t1"]) for sc in scenarios)
    inside = lambda t: any(a <= t < b for a, b in windows)   # noqa: E731
    out_prims = [p for p in top if not inside(p.get("t0", 0))]
    out_by_op = {}
    for p in out_prims:
        e = out_by_op.setdefault(p.get("name"), {"count": 0, "ms": 0})
        e["count"] += 1
        e["ms"] += int(p.get("ms", 0))
    feat_t0 = feature_rows[0]["t0"] if feature_rows else (min([sc["t0"] for sc in scenarios] + [p["t0"] for p in top]) if (scenarios or top) else 0)
    feat_t1 = feature_rows[0]["t1"] if feature_rows else (max([sc["t1"] for sc in scenarios] + [p["t1"] for p in top]) if (scenarios or top) else 0)
    busy = sorted([(sc["t0"], sc["t1"]) for sc in scenarios] + [(p["t0"], p["t1"]) for p in out_prims])
    busy_ms, cur = 0, None
    for a, b in busy:
        if cur is None or a > cur[1]:
            if cur:
                busy_ms += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        busy_ms += cur[1] - cur[0]
    outside = {"primitives_ms": sum(int(p.get("ms", 0)) for p in out_prims), "primitives": len(out_prims),
               "by_op": dict(sorted(out_by_op.items(), key=lambda kv: -kv[1]["ms"])[:20]),
               "idle_ms": max(0, (feat_t1 - feat_t0) - busy_ms), "feature_span_ms": max(0, feat_t1 - feat_t0)}

    # ── summary ──
    ms_list = [s["ms"] for s in scenarios]
    total = sum(ms_list)
    # Scenario windows can OVERLAP: a driver block that records two ids from one measured stretch (language
    # LANG06 + LANG18 share a 55 s window) makes the plain sum exceed the feature's wall time. `union_ms` is the
    # de-duplicated length of all windows; `overlap_ms` is what the sum double-counts. Per-scenario figures are
    # left as the driver reported them.
    union = 0
    cur = None
    for a, b in sorted((sc["t0"], sc["t1"]) for sc in scenarios):
        if cur is None or a > cur[1]:
            if cur:
                union += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        union += cur[1] - cur[0]
    layers_total = {k: sum(s["layers"][k] for s in scenarios) for k in LAYERS}
    summary = {
        "scenarios": len(scenarios),
        "passed": sum(1 for s in scenarios if s["status"] == "PASS"),
        "failed": sum(1 for s in scenarios if s["status"] == "FAIL"),
        "other": sum(1 for s in scenarios if s["status"] not in ("PASS", "FAIL")),
        "total_ms": total, "mean_ms": (total // len(ms_list)) if ms_list else 0,
        "p50_ms": percentile(ms_list, 50), "p90_ms": percentile(ms_list, 90), "p95_ms": percentile(ms_list, 95),
        "max_ms": max(ms_list) if ms_list else 0,
        "union_ms": union, "overlap_ms": max(0, total - union),
        "outside": outside,
        "layers": layers_total,
        "intentional_share": (layers_total["wait.intentional"] / total) if total else 0.0,
        "bot_share": (layers_total["bot.processing"] / total) if total else 0.0,
        "db": {"count": len(db_rows), "ms": sum(int(r.get("ms", 0)) for r in db_rows)},
        "vendor": {"count": len(vendor_rows), "ms": sum(int(r.get("ms", 0)) for r in vendor_rows),
                   "liveMs": sum(int(r.get("liveMs") or 0) for r in vendor_rows),
                   "hits": sum(1 for r in vendor_rows if r.get("outcome") == "hit"),
                   "misses": sum(1 for r in vendor_rows if r.get("outcome") == "miss")},
        "feature_wall_ms": int(feature_rows[0]["ms"]) if feature_rows else (feat_json.get("wallMs") or 0),
    }

    # ── bottlenecks: every span name, ranked by OWN time ──
    groups = {}
    for o, sid in all_ops:
        oname = "bot.reply.timeout" if (o["name"] == "bot.reply" and o.get("status") == "timeout") else o["name"]
        g = groups.setdefault(oname, {"own": [], "cat": category_of(o), "layer": o["layer"], "examples": []})
        g["own"].append(o["own_ms"])
        g["examples"].append((o["own_ms"], sid, (o.get("attrs") or {}).get("arg") or (o.get("attrs") or {}).get("label"), o.get("status")))
    bottlenecks = []
    for name, g in groups.items():
        st = _stats(g["own"])
        ex = sorted(g["examples"], key=lambda e: -e[0])[:3]
        bottlenecks.append({"op": name, "category": g["cat"], "layer": g["layer"], **st,
                            "share": (st["total_ms"] / total) if total else 0.0,
                            "examples": [{"ms": e[0], "scenario": e[1], "arg": e[2], "status": e[3]} for e in ex]})
    bottlenecks.sort(key=lambda b: -b["total_ms"])

    # DB and vendor rankings
    db_tables = {}
    for r in db_rows:
        k = "%s %s" % (r.get("method"), r.get("table"))
        db_tables.setdefault(k, []).append(int(r.get("ms", 0)))
    db_by_table = sorted([{"op": k, **_stats(v)} for k, v in db_tables.items()], key=lambda x: -x["total_ms"])
    vendor_kinds = {}
    for r in vendor_rows:
        vendor_kinds.setdefault(r.get("kind"), []).append(r)
    vendor_by_kind = [{"kind": k, "count": len(v), "ms": sum(int(r.get("ms", 0)) for r in v),
                       "liveMs": sum(int(r.get("liveMs") or 0) for r in v),
                       "hits": sum(1 for r in v if r.get("outcome") == "hit"),
                       "misses": sum(1 for r in v if r.get("outcome") == "miss"),
                       "live": sum(1 for r in v if r.get("outcome") == "live")} for k, v in vendor_kinds.items()]
    # repeated expensive calls: the same primitive with the same argument, more than once
    rep = {}
    for o, sid in all_ops:
        if o.get("kind") != "primitive" or o.get("parent"):
            continue
        key = (o["name"], (o.get("attrs") or {}).get("arg"))
        r = rep.setdefault(key, {"count": 0, "ms": 0, "scenarios": set()})
        r["count"] += 1
        r["ms"] += o["ms"]
        r["scenarios"].add(sid)
    repeats = sorted([{"op": k[0], "arg": k[1], "count": v["count"], "total_ms": v["ms"], "scenarios": sorted(x for x in v["scenarios"] if x)}
                      for k, v in rep.items() if v["count"] > 1], key=lambda x: -x["total_ms"])[:25]

    # ── setup / teardown from the run's own logs ──
    rl = _runner_log(run_dir)
    setup = {"suite_start": rl["suite_start"], "stack_started_at": stack.get("started_at"), "stack_lines": rl["stack_lines"][:12]}
    fe = rl["features"].get(feature or "", {})
    if rl["suite_start"] and fe.get("start"):
        try:
            ss = datetime.datetime.strptime(rl["suite_start"], "%Y-%m-%dT%H:%M:%SZ")
            fs = _hms_to_ms(fe["start"]) - (ss.hour * 3600 + ss.minute * 60 + ss.second) * 1000
            if fs < 0:
                fs += 86400000
            setup["before_first_scenario_ms"] = fs
        except ValueError:
            pass
    if fe.get("seconds") is not None:
        setup["feature_wall_s"] = fe["seconds"]
    # the mock transcript: bot processing per inbound message (first out after each in), independent of the trace
    tr_in = [r for r in transcript if r.get("dir") == "ack"]
    setup["transcript_acks"] = len(tr_in)

    gaps = [
        "bot.pacing is read from whatsapp.paced log events (delayMs, outcome=waited) on the message's correlation id; a paced send on a correlation the parser could not link stays inside bot.processing",
        "bot internals are point events parsed from pino-pretty logs (bot.log/worker.log), not timed spans — a stage's duration is the gap to the next log line",
        "DB queries carry no correlation id (supabase-js sends none); they are attributed to a scenario by timestamp window",
        "driver.unaccounted is derived (scenario − covered primitives): the feature scripts' own sleep()/polling loops are not individually instrumented",
        "vendor time is the cassette replay cost; liveMs is what the vendor took when recorded, not measured in this run",
    ]
    if outside["idle_ms"] > 0:
        gaps.append("%d ms of the feature's wall time is outside every scenario window and every primitive — driver sleeps/polls between scenarios, BLOCKED rows recorded with 0 ms, seeds run outside a window" % outside["idle_ms"])
    if summary["overlap_ms"] > 0:
        gaps.append("scenario windows overlap by %d ms (a driver block records several ids from one measured stretch): the per-scenario sum double-counts that much; union_ms is the de-duplicated total" % summary["overlap_ms"])
    if not db_rows:
        gaps.append("no db/db-timing.jsonl — the run predates the proxy timing log or ran on the sandbox DB (E2E_LOCAL_DB=0)")
    if not vendor_rows:
        gaps.append("no cassette-trace.jsonl — no vendor call was mediated, or the bot commit predates E2E_CASSETTE_TRACE_LOG")
    if not bot_tl:
        gaps.append("bot.log not parsed — no correlation timelines available")

    return {
        "v": 1, "run_id": run_id, "feature": feature, "run_dir": run_dir,
        "started": stack.get("started_at") or rl["suite_start"],
        "commit": (stack.get("commit_sha") or run_json.get("commit_sha") or "")[:12],
        "method": run_json.get("method"), "driver": run_json.get("driver"),
        "stack": {k: stack.get(k) for k in ("db", "files", "queue", "worker", "cassette_mode", "lock_blob") if k in stack},
        "verdict": {"pass": feat_json.get("pass"), "fail": feat_json.get("fail"), "other": feat_json.get("other"),
                    "wallMs": feat_json.get("wallMs"), "botWaitStats": feat_json.get("botWaitStats")},
        "summary": summary, "scenarios": scenarios, "bottlenecks": bottlenecks,
        "db_by_table": db_by_table[:40], "vendor_by_kind": vendor_by_kind, "repeats": repeats,
        "setup": setup, "gaps": gaps,
        "built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# ── compare ────────────────────────────────────────────────────────────────────

def _verdict(a, b):
    d = b - a
    if abs(d) <= max(300, 0.10 * max(a, 1)):
        return "same"
    return "regression" if d > 0 else "improvement"


def compare(a, b):
    sa = {s["id"]: s for s in a["scenarios"]}
    sb = {s["id"]: s for s in b["scenarios"]}
    scen = []
    for sid in sorted(set(sa) | set(sb), key=lambda x: str(x)):
        x, y = sa.get(sid), sb.get(sid)
        if x and y:
            scen.append({"id": sid, "a_ms": x["ms"], "b_ms": y["ms"], "delta_ms": y["ms"] - x["ms"], "verdict": _verdict(x["ms"], y["ms"]),
                         "a_status": x["status"], "b_status": y["status"],
                         "layers_delta": {k: y["layers"].get(k, 0) - x["layers"].get(k, 0) for k in LAYERS}})
        else:
            scen.append({"id": sid, "a_ms": x["ms"] if x else None, "b_ms": y["ms"] if y else None, "delta_ms": None,
                         "verdict": "only_in_b" if y else "only_in_a", "a_status": x["status"] if x else None, "b_status": y["status"] if y else None})
    oa = {o["op"]: o for o in a["bottlenecks"]}
    ob = {o["op"]: o for o in b["bottlenecks"]}
    ops = []
    for op in set(oa) | set(ob):
        x, y = oa.get(op), ob.get(op)
        ops.append({"op": op, "a_total_ms": x["total_ms"] if x else 0, "b_total_ms": y["total_ms"] if y else 0,
                    "delta_ms": (y["total_ms"] if y else 0) - (x["total_ms"] if x else 0),
                    "a_p50_ms": x["p50_ms"] if x else None, "b_p50_ms": y["p50_ms"] if y else None,
                    "a_count": x["count"] if x else 0, "b_count": y["count"] if y else 0})
    ops.sort(key=lambda o: -abs(o["delta_ms"]))
    return {
        "a": {"run_id": a["run_id"], "feature": a["feature"], "commit": a.get("commit"), "started": a.get("started")},
        "b": {"run_id": b["run_id"], "feature": b["feature"], "commit": b.get("commit"), "started": b.get("started")},
        "total_ms": {"a": a["summary"]["total_ms"], "b": b["summary"]["total_ms"], "delta_ms": b["summary"]["total_ms"] - a["summary"]["total_ms"]},
        "layers_delta": {k: b["summary"]["layers"].get(k, 0) - a["summary"]["layers"].get(k, 0) for k in LAYERS},
        "scenarios": scen, "ops": ops,
        "regressions": [s for s in scen if s["verdict"] == "regression"],
        "improvements": [s for s in scen if s["verdict"] == "improvement"],
    }


# ── publish ────────────────────────────────────────────────────────────────────

def _index_entry(p, fname):
    return {"run_id": p["run_id"], "feature": p["feature"], "started": p.get("started"), "commit": p.get("commit"),
            "total_ms": p["summary"]["total_ms"], "scenarios": p["summary"]["scenarios"], "passed": p["summary"]["passed"],
            "failed": p["summary"]["failed"], "other": p["summary"]["other"], "intentional_share": p["summary"]["intentional_share"],
            "bot_share": p["summary"]["bot_share"], "p95_ms": p["summary"]["p95_ms"], "file": fname, "built_at": p.get("built_at")}


def publish(profile, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    fname = "%s__%s.json" % (re.sub(r"[^A-Za-z0-9_.-]", "_", str(profile["run_id"])), profile.get("feature") or "run")
    with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False)
    idx_path = os.path.join(out_dir, "index.json")
    idx = _json(idx_path, {"profiles": []}) or {"profiles": []}
    entries = [e for e in idx.get("profiles", []) if e.get("file") != fname]
    entries.append(_index_entry(profile, fname))
    entries.sort(key=lambda e: (e.get("started") or "", e.get("built_at") or ""), reverse=True)
    idx = {"v": 1, "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "profiles": entries}
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=1)
    return os.path.join(out_dir, fname)


def _fmt_s(ms):
    return "%.1fs" % (ms / 1000.0)


def one_line(p):
    s = p["summary"]
    top = ", ".join("%s %s" % (b["op"], _fmt_s(b["total_ms"])) for b in p["bottlenecks"][:3])
    return ("%s %s: %d scenarios · %s · intentional waits %d%% · bot %d%% · p50 %s p95 %s · top: %s" % (
        p["feature"], p["run_id"], s["scenarios"], _fmt_s(s["total_ms"]), round(100 * s["intentional_share"]),
        round(100 * s["bot_share"]), _fmt_s(s["p50_ms"]), _fmt_s(s["p95_ms"]), top or "(no spans)"))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("run_dir", nargs="?")
    ap.add_argument("--feature")
    ap.add_argument("--publish", help="profiles dir (writes <run>__<feature>.json + index.json)")
    ap.add_argument("--compare", nargs=2, metavar=("A", "B"))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.compare:
        c = compare(_json(a.compare[0]), _json(a.compare[1]))
        if a.json:
            print(json.dumps(c, indent=1))
        else:
            print("total %s → %s (%+d ms) · regressions %d · improvements %d" % (
                _fmt_s(c["total_ms"]["a"]), _fmt_s(c["total_ms"]["b"]), c["total_ms"]["delta_ms"], len(c["regressions"]), len(c["improvements"])))
            for s in c["regressions"][:10]:
                print("  ▲ %-8s %s → %s (%+d ms)" % (s["id"], _fmt_s(s["a_ms"]), _fmt_s(s["b_ms"]), s["delta_ms"]))
            for s in c["improvements"][:10]:
                print("  ▼ %-8s %s → %s (%+d ms)" % (s["id"], _fmt_s(s["a_ms"]), _fmt_s(s["b_ms"]), s["delta_ms"]))
        return 0
    if not a.run_dir:
        ap.error("run_dir is required (or --compare A B)")
    p = build(a.run_dir, a.feature)
    if not p["feature"] or not p["scenarios"]:
        print("profile: no trace-*.jsonl with scenario rows in %s — nothing to profile (a run from before E2E_TRACE_FILE?)" % a.run_dir)
        return 0
    out = os.path.join(p["run_dir"], "profile-%s.json" % p["feature"])
    with open(out, "w", encoding="utf-8") as f:
        json.dump(p, f, ensure_ascii=False)
    if a.publish:
        publish(p, a.publish)
    if a.json:
        print(json.dumps(p, indent=1))
    else:
        print(one_line(p))
        print("written %s%s" % (out, (" · published to " + a.publish) if a.publish else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
