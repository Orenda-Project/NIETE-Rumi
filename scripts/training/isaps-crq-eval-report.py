#!/usr/bin/env python3
"""bd-60131 — build the CRQ marker eval report (HTML) from a golden set + results JSONL.

Shape follows the Assessment Generator eval pages: a masthead with the facts, one
tab per marker variant with a summary table and a per-answer spread (what the
teacher saw / the answer and its hand grade / what the marker returned), plus a
tab holding the golden set for the operator to validate.

Usage:
  python3 scripts/training/isaps-crq-eval-report.py --golden golden_set.json \
      --results results.jsonl --out report.html [--title "CRQ Marker Fairness"] \
      [--model openai/gpt-4o] [--date 2026-09-18]

Reads only. Confidential inputs (rubrics, model answers) end up IN the HTML, so
the page must stay a private artifact.
"""
import argparse, html, json, statistics, datetime
from collections import defaultdict

PASS_BAR_PCT = 50  # I-SAPS CRQ component bar (§5.2)


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def para(s):
    parts = [p.strip() for p in str(s or "").split("\n") if p.strip()]
    return "".join(f"<p>{esc(p)}</p>" for p in parts)


def load_results(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def rubric_table(rubric):
    """Render the flattened rubric text as readable rows: criterion, then bands."""
    return f"<pre class=content>{esc(rubric)}</pre>"


def stat(v):
    return f"{v:.2f}" if isinstance(v, float) else esc(v)


def bar(value, max_value, cls=""):
    pct = 0 if not max_value else max(0, min(100, 100.0 * value / max_value))
    return f'<span class="gbar {cls}" title="{value} of {max_value}"><i style="width:{pct:.0f}%"></i></span>'


def variant_summary(entries, by_id_variant, variant):
    rows, deltas, abs_deltas, agree, drift = [], [], [], [], []
    per_kind = defaultdict(lambda: {"n": 0, "abs": [], "delta": [], "agree": [], "drift": []})
    for e in entries:
        recs = sorted(by_id_variant.get((e["id"], variant), []), key=lambda r: r["run"])
        scores = [r["score"] for r in recs if r.get("score") is not None]
        if not scores:
            rows.append((e, recs, None, None, None, None))
            continue
        mean = statistics.fmean(scores)
        rng = max(scores) - min(scores)
        d = mean - e["golden_total"]
        golden_pass = e["golden_total"] * 100.0 / e["total_marks"] >= PASS_BAR_PCT
        marker_pass = [s * 100.0 / e["total_marks"] >= PASS_BAR_PCT for s in scores]
        ag = sum(1 for m in marker_pass if m == golden_pass) / len(marker_pass)
        rows.append((e, recs, mean, rng, d, ag))
        deltas.append(d); abs_deltas.append(abs(d)); agree.append(ag); drift.append(rng)
        k = per_kind[e["kind"]]
        k["n"] += 1; k["abs"].append(abs(d)); k["delta"].append(d); k["agree"].append(ag); k["drift"].append(rng)
    summary = {
        "n": len(deltas),
        "mae": statistics.fmean(abs_deltas) if abs_deltas else None,
        "bias": statistics.fmean(deltas) if deltas else None,
        "within1": (sum(1 for d in abs_deltas if d <= 1.0) / len(abs_deltas)) if abs_deltas else None,
        "agree": statistics.fmean(agree) if agree else None,
        "drift": statistics.fmean(drift) if drift else None,
        "drift_max": max(drift) if drift else None,
        "per_kind": {k: {"n": v["n"], "mae": statistics.fmean(v["abs"]), "bias": statistics.fmean(v["delta"]),
                         "agree": statistics.fmean(v["agree"]), "drift": statistics.fmean(v["drift"])} for k, v in per_kind.items()},
    }
    return rows, summary


def scatter_svg(rows, label):
    """golden (x) vs marker mean (y), one dot per answer, 0..10 both axes."""
    W, H, P = 260, 260, 28
    def x(v): return P + (W - 2 * P) * v / 10.0
    def y(v): return H - P - (H - 2 * P) * v / 10.0
    dots = []
    for e, recs, mean, rng, d, ag in rows:
        if mean is None:
            continue
        cls = "synth" if e["kind"] == "synthetic" else "model"
        dots.append(f'<circle cx="{x(e["golden_total"]):.1f}" cy="{y(mean):.1f}" r="4.5" class="dot {cls}"><title>{esc(e["id"])}: hand {e["golden_total"]}, marker mean {mean:.1f}</title></circle>')
    ticks = "".join(f'<text x="{x(v):.0f}" y="{H-P+14}" class=tick text-anchor=middle>{v}</text><text x="{P-8}" y="{y(v)+4:.0f}" class=tick text-anchor=end>{v}</text>' for v in (0, 2, 4, 6, 8, 10))
    bar_x = x(5.0); bar_y = y(5.0)
    return (f'<svg viewBox="0 0 {W} {H}" class=scatter role=img aria-label="{esc(label)}: hand grade on the x axis, marker mean on the y axis">'
            f'<line x1="{x(0)}" y1="{y(0)}" x2="{x(10)}" y2="{y(10)}" class=diag />'
            f'<line x1="{bar_x:.1f}" y1="{y(0)}" x2="{bar_x:.1f}" y2="{y(10)}" class=barline /><line x1="{x(0)}" y1="{bar_y:.1f}" x2="{x(10)}" y2="{bar_y:.1f}" class=barline />'
            f'<line x1="{x(0)}" y1="{y(0)}" x2="{x(10)}" y2="{y(0)}" class=axis /><line x1="{x(0)}" y1="{y(0)}" x2="{x(0)}" y2="{y(10)}" class=axis />'
            f'{ticks}{"".join(dots)}'
            f'<text x="{W/2:.0f}" y="{H-4}" class=axlabel text-anchor=middle>hand grade /10</text>'
            f'<text x="10" y="{H/2:.0f}" class=axlabel text-anchor=middle transform="rotate(-90 10 {H/2:.0f})">{esc(label)} mean /10</text></svg>')


def summary_table(rows, variant, runs):
    head = "".join(f"<th class=num>run {i}</th>" for i in range(1, runs + 1))
    out = [f"<table><thead><tr><th>Answer</th><th>Module · concept</th><th>Kind</th><th class=num>Hand</th>{head}<th class=num>Mean</th><th class=num>Δ</th><th class=num>Range</th><th>Pass agrees</th></tr></thead><tbody>"]
    for e, recs, mean, rng, d, ag in rows:
        cells = []
        for i in range(1, runs + 1):
            r = next((r for r in recs if r["run"] == i), None)
            if r is None or r.get("score") is None:
                cells.append("<td class=num>·</td>")
            else:
                off = r["score"] - e["golden_total"]
                cls = "bad" if abs(off) >= 3 else ("warn" if abs(off) == 2 else "")
                cells.append(f'<td class="num {cls}">{r["score"]}</td>')
        if mean is None:
            tail = "<td class=num>·</td><td class=num>·</td><td class=num>·</td><td>·</td>"
        else:
            dcls = "bad" if abs(d) >= 3 else ("warn" if abs(d) >= 2 else "")
            acls = "" if ag == 1 else "bad"
            tail = (f"<td class=num>{mean:.1f}</td><td class=\"num {dcls}\">{d:+.1f}</td><td class=num>{rng}</td>"
                    f"<td class=\"{acls}\">{'yes' if ag == 1 else f'{ag*100:.0f}% of runs'}</td>")
        kind = "I-SAPS model answer" if e["kind"] == "model_answer" else "synthetic"
        out.append(f'<tr><td><a href="#{variant}-{esc(e["id"])}">{esc(e["id"])}</a></td><td>M{e["module"]} · {esc(e["concept"])}</td><td>{kind}</td><td class=num>{e["golden_total"]}</td>{"".join(cells)}{tail}</tr>')
    out.append("</tbody></table>")
    return "".join(out)


def hand_grade_block(e):
    rows = []
    for c in e["criteria"]:
        extra = f' <span class=tag>{esc(c["borderline"])} borderline</span>' if c.get("borderline") else ""
        flag = f' <span class="tag flag">{esc(c["flag"])}</span>' if c.get("flag") else ""
        rows.append(f'<li><div class=qrow><div class=qtext><b>{esc(c["name"])}</b>{extra}{flag}<div class=opts>{esc(c["why"])}</div></div>'
                    f'<div class=qmeta><span class=marks>{c["golden"]}/{c["max"]}</span>{bar(c["golden"], c["max"])}</div></div></li>')
    lit = ""
    if e.get("literal_rubric_total") is not None:
        lit = f'<p class=flagnote>Literal rubric floor: {e["literal_rubric_total"]}/10. {esc(e.get("rubric_fix") or "")}</p>'
    notes = f'<p class=flagnote>{esc(e["notes"])}</p>' if e.get("notes") else ""
    return f'<ol class=hand>{"".join(rows)}</ol><p class=total>Hand grade <b>{e["golden_total"]}/{e["total_marks"]}</b></p>{lit}{notes}'


def marker_block(e, recs, variant):
    if not recs:
        return "<p class=elided>no result</p>"
    parts = []
    for r in sorted(recs, key=lambda r: r["run"]):
        if r.get("score") is None:
            parts.append(f'<div class=runcard><div class=runhead2>run {r["run"]} <span class=bad>error</span></div><p class=opts>{esc(r.get("error"))}</p></div>')
            continue
        off = r["score"] - e["golden_total"]
        cls = "bad" if abs(off) >= 3 else ("warn" if abs(off) == 2 else "ok")
        crit = ""
        if r.get("criteria"):
            crit = "<ol class=crit>" + "".join(
                f'<li><div class=qrow><div class=qtext>{esc(c["name"])}<div class=opts>{esc(c.get("evidence") or "")}</div></div>'
                f'<div class=qmeta><span class=marks>{c["marks"]}/{c["max"]}</span>{bar(c["marks"], c["max"], "seen" if c["marks"] != e["criteria"][i]["golden"] else "")}</div></div></li>'
                for i, c in enumerate(r["criteria"])) + "</ol>"
        usage = ""
        if r.get("usage"):
            u = r["usage"]; usage = f' · {u.get("prompt_tokens", "?")} in / {u.get("completion_tokens", "?")} out'
        parts.append(f'<div class=runcard><div class=runhead2>run {r["run"]} · <b class="{cls}">{r["score"]}/{e["total_marks"]}</b> <span class=hint>({off:+d} vs hand · {r["latency_ms"]} ms{usage})</span></div>'
                     f'{crit}<p class=fb>{esc(r.get("feedback") or "")}</p></div>')
    return "".join(parts)


def answer_article(e, recs, variant):
    kind = "I-SAPS model answer" if e["kind"] == "model_answer" else f'synthetic · {esc(e.get("design") or "")}'
    scores = [r["score"] for r in recs if r.get("score") is not None]
    mean = f"{statistics.fmean(scores):.1f}" if scores else "·"
    return f'''
<article class=exam id="{variant}-{esc(e["id"])}">
  <header class=exhead>
    <div><span class=eyebrow>{esc(e["id"])} · Module {e["module"]} · item {e["item_no"]}</span><h2>{esc(e["concept"])}</h2><p class=sub>{kind}</p></div>
    <dl class=kpis><div><dt>Hand</dt><dd>{e["golden_total"]}</dd></div><div><dt>Marker mean</dt><dd>{mean}</dd></div><div><dt>Runs</dt><dd>{len(scores)}</dd></div></dl>
  </header>
  <div class=spread>
    <section class=col><h3><span class=colnum>1</span> What the teacher saw <span class=hint>and the rubric the marker should follow</span></h3>
      <details><summary>Scenario and question <span class=hint>{len(e["prompt"])} chars</span></summary><pre class=content>{esc(e["prompt"])}</pre></details>
      <details><summary>I-SAPS rubric <span class=hint>{len(e["rubric"])} chars</span></summary>{rubric_table(e["rubric"])}</details>
      <details><summary>I-SAPS possible answer <span class=hint>{len(e["model_answer"])} chars</span></summary><pre class=content>{esc(e["model_answer"])}</pre></details>
    </section>
    <section class=col><h3><span class=colnum>2</span> The answer, graded by hand</h3>
      <details {"open" if e["kind"] == "synthetic" else ""}><summary>Answer text <span class=hint>{len(e["answer_text"])} chars</span></summary><pre class=content>{esc(e["answer_text"])}</pre></details>
      <h4>Hand grade on the rubric</h4>{hand_grade_block(e)}
    </section>
    <section class=col><h3><span class=colnum>3</span> What the {esc(variant)} marker returned</h3>{marker_block(e, recs, variant)}</section>
  </div>
</article>'''


def kpi(label, value, cls=""):
    return f'<div><dt>{esc(label)}</dt><dd class="{cls}">{value}</dd></div>'


def fmt_pct(v):
    return "·" if v is None else f"{v*100:.0f}%"


def fmt_num(v, signed=False):
    if v is None:
        return "·"
    return f"{v:+.2f}" if signed else f"{v:.2f}"


def build(golden, results, title, model, date, lede, findings_html):
    entries = golden
    by_id_variant = defaultdict(list)
    for r in results:
        by_id_variant[(r["id"], r["variant"])].append(r)
    variants = sorted({r["variant"] for r in results}, key=lambda v: 0 if v == "live" else 1)
    runs = max((r["run"] for r in results), default=1)
    calls = len(results)

    tabs, panels = [], []
    # Findings tab
    tabs.append('<button role=tab class="on" data-tab="0" aria-selected="true">Findings</button>')
    kpis_by_variant = {}
    scatter_html = []
    for v in variants:
        rows, s = variant_summary(entries, by_id_variant, v)
        kpis_by_variant[v] = (rows, s)
        scatter_html.append(f'<figure class=scfig>{scatter_svg(rows, v)}<figcaption><b>{esc(v)} marker.</b> Each dot is one answer: hand grade across, the marker\'s mean over {runs} runs up. On the diagonal is agreement. Lines mark the 50% pass bar. Green dots are I-SAPS\'s own model answers, orange are the synthetic answers.</figcaption></figure>')
    comp = ["<table><thead><tr><th>Marker</th><th>Answers</th><th class=num>Mean abs. error</th><th class=num>Bias</th><th class=num>Within ±1</th><th class=num>Pass/fail agreement</th><th class=num>Drift (mean range)</th><th class=num>Worst drift</th></tr></thead><tbody>"]
    for v in variants:
        rows, s = kpis_by_variant[v]
        comp.append(f"<tr><td><b>{esc(v)}</b></td><td>all {s['n']}</td><td class=num>{fmt_num(s['mae'])}</td><td class=num>{fmt_num(s['bias'], True)}</td><td class=num>{fmt_pct(s['within1'])}</td><td class=num>{fmt_pct(s['agree'])}</td><td class=num>{fmt_num(s['drift'])}</td><td class=num>{s['drift_max'] if s['drift_max'] is not None else '·'}</td></tr>")
        for k in ("model_answer", "synthetic"):
            pk = s["per_kind"].get(k)
            if pk:
                label = "I-SAPS model answers" if k == "model_answer" else "synthetic answers"
                comp.append(f"<tr class=extra><td></td><td>{label} ({pk['n']})</td><td class=num>{fmt_num(pk['mae'])}</td><td class=num>{fmt_num(pk['bias'], True)}</td><td class=num>·</td><td class=num>{fmt_pct(pk['agree'])}</td><td class=num>{fmt_num(pk['drift'])}</td><td class=num>·</td></tr>")
    comp.append("</tbody></table>")
    # synthetic design table
    syn = [e for e in entries if e["kind"] == "synthetic"]
    des = ["<table><thead><tr><th>Answer</th><th>What it tests</th><th class=num>Hand</th>" + "".join(f"<th class=num>{esc(v)} mean</th>" for v in variants) + "</tr></thead><tbody>"]
    for e in syn:
        cells = []
        for v in variants:
            recs = by_id_variant.get((e["id"], v), [])
            sc = [r["score"] for r in recs if r.get("score") is not None]
            if sc:
                m = statistics.fmean(sc); off = m - e["golden_total"]
                cls = "bad" if abs(off) >= 3 else ("warn" if abs(off) >= 2 else "")
                cells.append(f'<td class="num {cls}">{m:.1f} <span class=hint>({off:+.1f})</span></td>')
            else:
                cells.append("<td class=num>·</td>")
        short = (e.get("design") or "").split("Tests:")[0].split(".")[0].strip()
        des.append(f'<tr><td><a href="#{variants[0]}-{esc(e["id"])}">{esc(e["id"])}</a> · M{e["module"]} {esc(e["concept"])}</td><td>{esc(short)}</td><td class=num>{e["golden_total"]}</td>{"".join(cells)}</tr>')
    des.append("</tbody></table>")
    # model-answer deductions
    ded = [e for e in entries if e["kind"] == "model_answer" and e["golden_total"] < e["total_marks"]]
    flags = [(e, c) for e in entries if e["kind"] == "model_answer" for c in e["criteria"] if c.get("flag")]
    dedh = ["<table><thead><tr><th>Item</th><th class=num>Hand</th><th>Why the I-SAPS answer misses its own top band</th></tr></thead><tbody>"]
    for e in ded:
        why = "; ".join(f"{c['name']}: {c['why']}" for c in e["criteria"] if c["golden"] < c["max"])
        dedh.append(f'<tr><td><a href="#{variants[0]}-{esc(e["id"])}">{esc(e["id"])}</a> · {esc(e["concept"])}</td><td class=num>{e["golden_total"]}</td><td>{esc(why)}</td></tr>')
    dedh.append("</tbody></table>")
    flagh = ["<ul class=tight>"] + [f'<li><b>{esc(e["id"])} · {esc(c["name"])}</b> <span class="tag flag">{esc(c["flag"])}</span>: {esc(c["why"])}</li>' for e, c in flags] + ["</ul>"]

    panels.append(f'''
<section class=run id="run-0" role=tabpanel>
  {findings_html}
  <div class=summary>{"".join(comp)}</div>
  <div class=scgrid>{"".join(scatter_html)}</div>
  <h3 class=secttl>The ten synthetic answers</h3>
  <div class=summary>{"".join(des)}</div>
  <details><summary>Rubric and source defects found while grading <span class=hint>{len(flags)} flags, {len(ded)} deductions</span></summary>
  <div class=summary>{"".join(dedh)}</div>{"".join(flagh)}</details>
</section>''')

    for i, v in enumerate(variants, start=1):
        rows, s = kpis_by_variant[v]
        tabs.append(f'<button role=tab data-tab="{i}" aria-selected="false">{esc(v)} marker</button>')
        arts = "".join(answer_article(e, by_id_variant.get((e["id"], v), []), v) for e in entries)
        panels.append(f'''
<section class=run id="run-{i}" role=tabpanel hidden>
  <div class=runhead><div class=eyebrow>{esc(v)} marker</div><h2 class=runtitle>{"The production path, unchanged" if v == "live" else "Rubric-grounded, same model"}</h2>
  <p class=runnote>{"capstone-delivery scoreAnswer(question, answer, 10): the model sees the scenario, the question and the answer, with a generic instruction to score 0-10 for specific, practical, classroom-grounded writing. It has never seen the rubric or the possible answer, because neither is stored." if v == "live" else "Same model and temperature, handed the printed I-SAPS rubric and the possible answer as notes on key components, asked for a mark per criterion with evidence. Adds a zero band for non-answers, no marks for vocabulary alone, and no penalty for plain English or Urdu. A proposal for the operator, not production."}</p></div>
  <div class=summary>{summary_table(rows, v, runs)}</div>
  {arts}
</section>''')

    # Golden set tab
    gi = len(variants) + 1
    tabs.append(f'<button role=tab data-tab="{gi}" aria-selected="false">Golden set · validate</button>')
    gl = []
    for e in entries:
        if e["kind"] != "synthetic":
            continue
        gl.append(f'''<article class=exam id="golden-{esc(e["id"])}"><header class=exhead><div><span class=eyebrow>{esc(e["id"])} · Module {e["module"]} · item {e["item_no"]}</span><h2>{esc(e["concept"])}</h2><p class=sub>{esc(e.get("design") or "")}</p></div>
<dl class=kpis><div><dt>Hand</dt><dd>{e["golden_total"]}</dd></div><div><dt>Status</dt><dd class=warn>awaiting operator</dd></div></dl></header>
<div class="spread two"><section class=col><h3><span class=colnum>1</span> The answer</h3><pre class=content>{esc(e["answer_text"])}</pre>
<details><summary>Scenario and question</summary><pre class=content>{esc(e["prompt"])}</pre></details><details><summary>I-SAPS rubric</summary>{rubric_table(e["rubric"])}</details></section>
<section class=col><h3><span class=colnum>2</span> Hand grade, criterion by criterion</h3>{hand_grade_block(e)}</section></div></article>''')
    panels.append(f'''
<section class=run id="run-{gi}" role=tabpanel hidden>
  <div class=runhead><div class=eyebrow>Golden set</div><h2 class=runtitle>Ten synthetic answers for validation</h2>
  <p class=runnote>Written to sit at known points on the rubric. Each carries its hand grade per criterion and the reason. The eval is only as good as these grades; disagree with any of them and the marker numbers move. The 36 I-SAPS model answers were graded the same way and sit inside each marker tab.</p></div>
  {"".join(gl)}
</section>''')

    css = r'''
:root{--ground:#F6F7F5;--surface:#FFFFFF;--surface2:#EEF3EF;--ink:#333748;--ink2:#565C6E;--muted:#6C7A72;--rule:#DCE3DE;--rule2:#C9D3CC;--accent:#47BA7D;--accent-ink:#2E8F5C;--accent-wash:#E4F4EB;--warn:#C9822B;--warn-wash:#F8EEDF;--bad:#B4544A;--seen:#5C6BC0;--seen-wash:#E8EAF6;--synth:#D98B3B;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--shadow:0 1px 2px rgba(51,55,72,.06),0 8px 24px -16px rgba(51,55,72,.25)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#1C1F26;--surface:#252932;--surface2:#2B3038;--ink:#E8EAE6;--ink2:#B9BEC8;--muted:#8E9A92;--rule:#353B45;--rule2:#454C58;--accent:#5CCB8E;--accent-ink:#7FD9A6;--accent-wash:#22382C;--warn:#E0A55A;--warn-wash:#3A2F1C;--bad:#E07B70;--seen:#8C98E0;--seen-wash:#2A2F45;--synth:#E9A25C;--shadow:none}}
:root[data-theme="dark"]{--ground:#1C1F26;--surface:#252932;--surface2:#2B3038;--ink:#E8EAE6;--ink2:#B9BEC8;--muted:#8E9A92;--rule:#353B45;--rule2:#454C58;--accent:#5CCB8E;--accent-ink:#7FD9A6;--accent-wash:#22382C;--warn:#E0A55A;--warn-wash:#3A2F1C;--bad:#E07B70;--seen:#8C98E0;--seen-wash:#2A2F45;--synth:#E9A25C;--shadow:none}
*{box-sizing:border-box} body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.5 var(--sans)}
.wrap{max-width:1480px;margin:0 auto;padding:32px 16px 80px}
h1,h2,h3,h4,h5{text-wrap:balance;margin:0}
.masthead{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;padding-bottom:20px;border-bottom:2px solid var(--accent)}
.masthead .eyebrow{color:var(--accent-ink)} h1{font-size:34px;font-weight:600;letter-spacing:-.02em;line-height:1.1;margin-top:6px}
.lede{max-width:70ch;color:var(--ink2);margin:12px 0 0} .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:2px 24px;font-size:13px} .facts dt{color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase} .facts dd{margin:0 0 8px;font-family:var(--mono);font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13.5px} th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--rule2)}
td{padding:8px 10px;border-bottom:1px solid var(--rule);vertical-align:top} td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums} tr.extra td{color:var(--ink2);font-size:12.5px}
.warn{color:var(--warn);font-weight:600} .bad{color:var(--bad);font-weight:600} .ok{color:var(--accent-ink)}
.tag{font-size:11px;background:var(--seen-wash);color:var(--seen);padding:1px 6px;border-radius:3px;margin-left:4px} .tag.flag{background:var(--warn-wash);color:var(--warn)}
.summary{margin:14px 0 8px;background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:6px 8px;overflow-x:auto}
.note{background:var(--surface2);border-left:3px solid var(--accent);padding:12px 16px;margin:20px 0;font-size:14px;color:var(--ink2);max-width:95ch} .note b{color:var(--ink)} .note.red{border-left-color:var(--bad)}
.secttl{font-size:17px;font-weight:600;margin:30px 0 6px}
.exam{margin-top:28px;background:var(--surface);border:1px solid var(--rule);border-radius:8px;box-shadow:var(--shadow)}
.exhead{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start;padding:20px 24px 16px;border-bottom:1px solid var(--rule)} .exhead h2{font-size:22px;font-weight:600;letter-spacing:-.015em;margin-top:4px} .sub{margin:6px 0 0;color:var(--ink2);font-size:14px;max-width:80ch}
.kpis{display:flex;gap:22px;margin:0} .kpis div{min-width:70px} .kpis dt{font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase} .kpis dd{margin:2px 0 0;font-family:var(--mono);font-size:20px;font-variant-numeric:tabular-nums}
.spread{display:grid;grid-template-columns:minmax(280px,1fr) minmax(300px,1.15fr) minmax(320px,1.2fr);gap:0} .spread.two{grid-template-columns:minmax(300px,1.2fr) minmax(300px,1fr)}
.col{padding:18px 20px 24px;border-right:1px solid var(--rule);min-width:0} .col:last-child{border-right:0}
.col h3{font-size:15px;font-weight:600;display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap} .colnum{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font:600 12px var(--mono)}
.hint{font-weight:400;color:var(--muted);font-size:12.5px} h4{font-size:13px;font-weight:600;color:var(--ink2);margin:16px 0 8px}
details{border:1px solid var(--rule);border-radius:6px;margin:8px 0;background:var(--surface)} summary{cursor:pointer;padding:8px 12px;font-size:13.5px;font-weight:500;list-style:none;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap} summary::before{content:"▸";color:var(--accent-ink);font-size:12px} details[open] summary::before{content:"▾"}
pre.content{margin:0;padding:12px 14px;border-top:1px solid var(--rule);font:12.5px/1.5 var(--mono);white-space:pre-wrap;word-break:break-word;max-height:520px;overflow:auto;background:var(--surface2);color:var(--ink)} .elided{color:var(--muted);font-style:italic}
ol.hand,ol.crit{margin:0;padding-left:0;list-style:none} ol.hand li,ol.crit li{padding:7px 0;border-bottom:1px dashed var(--rule);font-size:13.5px}
.qrow{display:grid;grid-template-columns:1fr 130px;gap:12px;align-items:start} .qtext{min-width:0} .opts{color:var(--ink2);font-size:12.5px;margin-top:2px}
.qmeta{display:grid;grid-template-columns:44px 1fr;gap:6px;align-items:center;font:12px var(--mono);color:var(--muted)} .gbar{height:6px;background:var(--rule);border-radius:3px;overflow:hidden;display:block} .gbar i{display:block;height:100%;background:var(--accent)} .gbar.seen i{background:var(--warn)}
.total{margin:10px 0 0;font-size:14px} .flagnote{font-size:12.5px;color:var(--warn);margin:8px 0 0;max-width:70ch}
.runcard{border:1px solid var(--rule);border-radius:6px;padding:10px 12px;margin-bottom:10px;background:var(--surface2)} .runhead2{font-size:13.5px;margin-bottom:6px} .fb{margin:8px 0 0;font-size:13px;color:var(--ink2)}
.tabs{display:flex;gap:4px;margin:22px 0 4px;border-bottom:1px solid var(--rule2);flex-wrap:wrap} .tabs button{appearance:none;background:none;border:0;border-bottom:3px solid transparent;padding:10px 16px;font:600 14px var(--sans);color:var(--muted);cursor:pointer;margin-bottom:-1px} .tabs button.on{color:var(--ink);border-bottom-color:var(--accent)} .tabs button:hover{color:var(--ink)}
.runhead{margin-top:26px} .runtitle{font-size:22px;font-weight:600;letter-spacing:-.01em} .runnote{margin:6px 0 0;color:var(--ink2);max-width:95ch}
.scgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin:18px 0} .scfig{margin:0;background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:10px} .scatter{width:100%;height:auto;max-width:320px;display:block;margin:0 auto} .scfig figcaption{font-size:12.5px;color:var(--ink2);margin-top:6px}
.scatter .diag{stroke:var(--rule2);stroke-dasharray:4 3} .scatter .barline{stroke:var(--rule);stroke-dasharray:2 3} .scatter .axis{stroke:var(--muted)} .scatter .tick{font:10px var(--mono);fill:var(--muted)} .scatter .axlabel{font:11px var(--sans);fill:var(--ink2)} .scatter .dot{fill-opacity:.75} .scatter .dot.model{fill:var(--accent)} .scatter .dot.synth{fill:var(--synth)}
ul.tight{margin:6px 0;padding-left:18px;max-width:100ch} ul.tight li{margin:0 0 6px;font-size:13.5px}
a{color:var(--accent-ink)} :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:1100px){.spread,.spread.two{grid-template-columns:1fr} .col{border-right:0;border-bottom:1px solid var(--rule)} .exhead,.masthead{grid-template-columns:1fr} .kpis{flex-wrap:wrap} .qrow{grid-template-columns:1fr 110px}}
'''
    js = r'''
(function(){var tabs=document.querySelectorAll('.tabs [role=tab]'),panels=document.querySelectorAll('.run');
function show(i){tabs.forEach(function(x){var on=x.dataset.tab===String(i);x.classList.toggle('on',on);x.setAttribute('aria-selected',on?'true':'false');});panels.forEach(function(p){p.hidden=(p.id!=='run-'+i);});try{localStorage.setItem('crq-eval-tab',String(i));}catch(e){}}
tabs.forEach(function(t){t.addEventListener('click',function(){show(t.dataset.tab);});});
try{var saved=localStorage.getItem('crq-eval-tab');if(saved!==null&&document.getElementById('run-'+saved))show(saved);}catch(e){}
document.addEventListener('click',function(e){var a=e.target.closest('a[href^="#"]');if(!a)return;var id=a.getAttribute('href').slice(1);var el=document.getElementById(id);if(!el)return;var panel=el.closest('.run');if(panel&&panel.hidden){show(panel.id.replace('run-',''));}});
window.addEventListener('hashchange',function(){var el=document.getElementById(location.hash.slice(1));if(el){var panel=el.closest('.run');if(panel&&panel.hidden)show(panel.id.replace('run-',''));el.scrollIntoView();}});
})();
'''
    # Published as a claude.ai artifact, which wraps the file in its own
    # doctype/head/body at publish time: the page starts at <title>.
    return f'''<title>{esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>{css}</style>
<div class=wrap>
<header class=masthead>
  <div><div class=eyebrow>I-SAPS Level 1 · CRQ marker eval · NIETE sandbox</div><h1>{esc(title)}</h1><p class=lede>{lede}</p></div>
  <dl class=facts><dt>Run date</dt><dd>{esc(date)}</dd><dt>Model</dt><dd>{esc(model)}</dd><dt>Answers</dt><dd>{len(entries)}</dd><dt>Runs each</dt><dd>{runs}</dd><dt>Marker calls</dt><dd>{calls}</dd><dt>Pass bar</dt><dd>{PASS_BAR_PCT}%</dd></dl>
</header>
<nav class=tabs role=tablist>{"".join(tabs)}</nav>
{"".join(panels)}
</div>
<script>{js}</script>
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--golden", required=True)
    ap.add_argument("--results", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="CRQ Marker Fairness")
    ap.add_argument("--model", default=None)
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--lede", default="")
    ap.add_argument("--findings", default="", help="path to an HTML fragment placed at the top of the Findings tab")
    a = ap.parse_args()
    golden = json.load(open(a.golden, encoding="utf-8"))
    results = load_results(a.results)
    model = a.model or (results[0]["model"] if results else "?")
    findings_html = open(a.findings, encoding="utf-8").read() if a.findings else ""
    html_out = build(golden, results, a.title, model, a.date, a.lede, findings_html)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(html_out)
    print(f"wrote {a.out} ({len(html_out)/1024:.0f} KB) from {len(results)} results over {len(golden)} answers")


if __name__ == "__main__":
    main()
