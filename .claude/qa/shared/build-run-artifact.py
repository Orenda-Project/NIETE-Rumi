#!/usr/bin/env python3
"""Render a NIETE E2E run directory into a single self-contained artifact page.

Usage: build-run-artifact.py <run_dir> [--out artifact.html]

Reads run.json, scenarios.json (from parse-per-scenario.py) and findings.json.
Rows are rendered server-side so the page is readable with JS disabled; JS only
filters. Publish the result with the Artifact tool, passing the SAME url every
run so the page updates in place rather than spawning a new one.
"""
import json, os, re, sys, html
from collections import Counter

ARABIC = re.compile(r'([؀-ۿݐ-ݿ][؀-ۿݐ-ݿ\s،؛؟.,!?—\-–"“”\'()/:0-9]*)')

LABEL = {
    "pass": "Passed", "promoted": "Passed · promoted", "fail": "Failed",
    "blocked": "Blocked", "skip": "Skipped", "partial": "Partial",
    "changed": "Known issue confirmed", "notdriven": "Not driven",
    "deferred": "Deferred", "other": "Other",
}
# Which bucket a verdict belongs to for the filter chips.
GROUP = {
    "pass": "ok", "promoted": "ok", "fail": "bad", "blocked": "held",
    "skip": "held", "notdriven": "held", "deferred": "held",
    "partial": "watch", "changed": "watch", "other": "watch",
}

def rich(text):
    """Escape, then mark Urdu runs so they get the Nastaliq face and RTL flow,
    and render `code` spans. The evidence quotes are genuinely bilingual, so this
    is a content requirement, not decoration."""
    out = html.escape(text or "")
    out = re.sub(r'`([^`]+)`', lambda m: '<code>%s</code>' % m.group(1), out)
    out = re.sub(r'\*\*([^*]+)\*\*', lambda m: '<strong>%s</strong>' % m.group(1), out)
    def wrap(m):
        s = m.group(1)
        return s if len(s.strip()) < 2 else '<span class="ur" dir="rtl" lang="ur">%s</span>' % s
    return ARABIC.sub(wrap, out)

def bar(counts, total):
    seg = []
    for v in ["pass","promoted","changed","partial","fail","blocked","skip","notdriven","deferred"]:
        n = counts.get(v, 0)
        if n:
            seg.append('<i class="v-%s" style="flex:%d" title="%s: %d"></i>' % (v, n, LABEL[v], n))
    return '<div class="bar">%s</div>' % "".join(seg)

def main():
    run_dir = sys.argv[1]
    out_path = sys.argv[sys.argv.index("--out")+1] if "--out" in sys.argv else os.path.join(run_dir, "artifact.html")
    meta = json.load(open(os.path.join(run_dir, "run.json"), encoding="utf-8"))
    rows = json.load(open(os.path.join(run_dir, "scenarios.json"), encoding="utf-8"))
    fpath = os.path.join(run_dir, "findings.json")
    F = json.load(open(fpath, encoding="utf-8")) if os.path.exists(fpath) else {}

    counts = Counter(r["verdict"] for r in rows)
    total = len(rows)
    passed = counts["pass"] + counts["promoted"]
    failed = counts["fail"]
    held = counts["blocked"] + counts["skip"] + counts["notdriven"] + counts["deferred"]
    verdict = "CRITICAL" if (failed >= 3 or counts["blocked"]) else ("DEGRADED" if failed else "HEALTHY")

    order = ["registration","menu","training","lesson-plan","coaching","language","status"]
    by_feat = {}
    for r in rows: by_feat.setdefault(r["feature"], []).append(r)

    # ---------- feature sections ----------
    sections = []
    for fi, feat in enumerate([f for f in order if f in by_feat], 1):
        frows = by_feat[feat]
        fc = Counter(r["verdict"] for r in frows)
        fpass = fc["pass"] + fc["promoted"]
        trs = []
        for r in frows:
            waited = r["waited"].strip()
            waited_html = '<span class="ms">%s</span>' % html.escape(waited) if waited and waited != "—" else '<span class="ms dim">—</span>'
            trs.append(
                '<tr class="row v-row-{v}" data-g="{g}" data-t="{t}">'
                '<td class="c-id"><span class="sid">{sid}</span></td>'
                '<td class="c-name"><div class="nm">{nm}</div><div class="tags">{tags}</div></td>'
                '<td class="c-verdict"><span class="pill p-{v}">{lab}</span></td>'
                '<td class="c-wait">{w}</td>'
                '<td class="c-ev">{ev}</td>'
                '</tr>'.format(
                    v=r["verdict"], g=GROUP[r["verdict"]],
                    t=html.escape((r["id"] + " " + r["name"] + " " + r["tags"] + " " + r["evidence"]).lower()),
                    sid=html.escape(r["id"]), nm=rich(r["name"]),
                    tags=html.escape(r["tags"]), lab=LABEL[r["verdict"]],
                    w=waited_html, ev=rich(r["evidence"])))
        sections.append(
            '<section class="feat" id="f-{feat}">'
            '<header class="feat-h">'
            '<div class="feat-t"><span class="fnum">{fi}</span><h3>{feat}</h3>'
            '<span class="feat-n">{n} scenarios</span></div>'
            '<div class="feat-m"><span class="mini ok">{p} passed</span>'
            '{failhtml}{heldhtml}{barhtml}</div>'
            '</header>'
            '<div class="tw"><table><tbody>{trs}</tbody></table></div>'
            '</section>'.format(
                feat=feat, fi=fi, n=len(frows), p=fpass,
                failhtml=('<span class="mini bad">%d failed</span>' % fc["fail"]) if fc["fail"] else "",
                heldhtml=('<span class="mini held">%d held</span>' % (fc["blocked"]+fc["skip"]+fc["notdriven"]+fc["deferred"])) if (fc["blocked"]+fc["skip"]+fc["notdriven"]+fc["deferred"]) else "",
                barhtml=bar(fc, len(frows)), trs="".join(trs)))

    def cards(items, cls):
        out = []
        for it in items:
            bead = it.get("bead","")
            out.append(
                '<article class="card {cls}">'
                '{beadhtml}<h4>{t}</h4><p>{b}</p>{proof}{impact}</article>'.format(
                    cls=cls,
                    beadhtml=('<span class="bead">%s</span>' % html.escape(bead)) if bead else "",
                    t=rich(it["title"]), b=rich(it["body"]),
                    proof=('<p class="sub"><span class="lbl">Proof</span>%s</p>' % rich(it["proof"])) if it.get("proof") else "",
                    impact=('<p class="sub"><span class="lbl">Impact</span>%s</p>' % rich(it["impact"])) if it.get("impact") else ""))
        return "".join(out)

    stat = lambda n, l, c="": '<div class="stat {c}"><span class="n">{n}</span><span class="l">{l}</span></div>'.format(n=n, l=l, c=c)

    fields = {
        "TITLE": "NIETE E2E Ledger",
        "VERDICT": verdict, "VCLASS": verdict.lower(),
        "RUN": html.escape(meta.get("run","")),
        "TARGET": html.escape(meta.get("target","")),
        "DRIVER": html.escape(meta.get("driver","")),
        "ENV": html.escape(meta.get("env","")),
        "DBREF": html.escape(meta.get("db_project_ref","")),
        "STATS": (stat(total,"scenarios") + stat(passed,"passed","ok") + stat(failed,"failed","bad")
                  + stat(counts["blocked"],"blocked","held") + stat(counts["changed"],"known issues","watch")
                  + stat(counts["promoted"],"promoted","ok")),
        "OVERALLBAR": bar(counts, total),
        "SECTIONS": "".join(sections),
        "CRITICAL": cards(F.get("critical",[]), "crit"),
        "NEWF": cards(F.get("new",[]), "newf"),
        "FIXED": cards(F.get("fixed",[]), "fix"),
        "UNVER": cards(F.get("unverified",[]), "unv"),
        "HARNESS": "".join('<li>%s</li>' % rich(h) for h in F.get("harness",[])),
        "NCRIT": str(len(F.get("critical",[]))), "NNEW": str(len(F.get("new",[]))),
        "NFIX": str(len(F.get("fixed",[]))), "NUNV": str(len(F.get("unverified",[]))),
    }
    doc = TEMPLATE
    for k, v in fields.items():
        doc = doc.replace("{{%s}}" % k, v)
    leftover = re.findall(r"\{\{[A-Z]+\}\}", doc)
    if leftover:
        sys.exit("unfilled template markers: %s" % sorted(set(leftover)))
    open(out_path, "w", encoding="utf-8").write(doc)
    print("wrote %s (%d bytes, %d scenarios, verdict %s)" % (out_path, len(doc), total, verdict))

TEMPLATE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "run-artifact.template.html"), encoding="utf-8").read() if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "run-artifact.template.html")) else ""

if __name__ == "__main__":
    if not TEMPLATE:
        sys.exit("missing run-artifact.template.html next to this script")
    main()
