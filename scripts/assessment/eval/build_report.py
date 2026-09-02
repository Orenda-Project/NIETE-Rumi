"""Build the side-by-side AG eval report for one book: source pages | input | result.
    python3 build_report.py <evals_dir> <bookId> <out.html> "<Book label>"
"""
import json, base64, html, re, sys, datetime
from pathlib import Path
evals, book_id, out, label = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]

def b64(p): return "data:image/jpeg;base64," + base64.b64encode(Path(p).read_bytes()).decode()
def esc(s): return html.escape(str(s if s is not None else ""))
WORD = re.compile(r"[a-zA-Z]{4,}")

def q_text(q):
    parts = [q.get("main_question"), q.get("question"), q.get("answer")]
    for k in ("options", "words", "column_a", "column_b"):
        v = q.get(k)
        if isinstance(v, list): parts += [str(x) for x in v]
    return " ".join(str(p) for p in parts if p)

def grounding(q, vocab):
    words = {w.lower() for w in WORD.findall(q_text(q))}
    if not words: return None
    hit = sum(1 for w in words if w in vocab)
    return hit / len(words), len(words)

def walk(exam):
    for sec in ("seen", "unseen"):
        for cat, types in (exam.get(sec) or {}).items():
            if not isinstance(types, dict): continue
            for t, entry in types.items():
                qs = []
                if isinstance(entry, list): qs = [q for q in entry if isinstance(q, dict)]
                elif isinstance(entry, dict):
                    for sub in entry.values():
                        if isinstance(sub, list): qs += [q for q in sub if isinstance(q, dict)]
                if qs: yield sec, cat, t, qs

exams = []
for lab in ("A", "B"):
    d = evals / f"{book_id}-{lab}"
    if not d.exists(): continue
    spec = json.load(open(d / "spec.json")); res = json.load(open(d / "result.json"))
    pages = json.load(open(d / "pages.json")); exam = json.load(open(d / "exam.json"))
    src_index = json.load(open(d / "src_index.json"))
    content = (d / "content.txt").read_text(); user = (d / "user.txt").read_text(); system = (d / "system.txt").read_text()
    vocab = {w.lower() for w in WORD.findall(content)}
    paper_imgs = sorted((d / "paper").glob("p*.jpg"), key=lambda p: int(p.stem[1:]))
    exams.append(dict(lab=lab, spec=spec, res=res, pages=pages, exam=exam, src=src_index, content=content, user=user, system=system, vocab=vocab, paper=paper_imgs, dir=d))

def effective(ex, sec):
    """Items delivered, except Word Meanings where the unit the teacher asked for is a word, not the item."""
    n = 0
    for s_, cat, t, qs in walk(ex["exam"]):
        if s_ != sec: continue
        n += sum(len(q.get("words") or [1]) for q in qs) if t.lower().replace(" ", "") == "wordmeanings" else len(qs)
    return n
for ex in exams:
    ex["eff"] = {"seen": effective(ex, "seen"), "unseen": effective(ex, "unseen")}
    ex["eff"]["total"] = ex["eff"]["seen"] + ex["eff"]["unseen"]

spec0 = exams[0]["spec"]
model = exams[0]["res"]["tokens"]["model"]
today = datetime.date.today().isoformat()

def chip(txt, cls=""): return f'<span class="chip {cls}">{esc(txt)}</span>'

def asked_vs_got(ex):
    asked = {t["id"]: t["count"] for t in ex["spec"]["questionTypes"]}
    got = ex["res"]["delivered"]
    norm = lambda s: s.lower().replace(" ", "")
    rows = []
    for tid, n in asked.items():
        u = next((v for k, v in got["unseen"].items() if norm(k) == norm(tid)), 0)
        s = next((v for k, v in got["seen"].items() if norm(k) == norm(tid)), 0)
        # a Word Meanings item holds several words: count words, not items
        if tid == "Word Meanings":
            for sec, cat, t, qs in walk(ex["exam"]):
                if norm(t) == norm(tid) and sec == "unseen": u = sum(len(q.get("words") or []) for q in qs)
                if norm(t) == norm(tid) and sec == "seen": s = sum(len(q.get("words") or []) for q in qs)
        flag = "" if u == n else "warn"
        rows.append(f"<tr><td>{esc(tid)}</td><td class=num>{n}</td><td class='num {flag}'>{u}</td><td class=num>{s or '·'}</td></tr>")
    extra_seen = [(k, v) for k, v in got["seen"].items() if norm(k) not in {norm(t) for t in asked}]
    for k, v in extra_seen:
        rows.append(f"<tr class=extra><td>{esc(k)} <span class=tag>seen, not asked by type</span></td><td class=num>—</td><td class=num>·</td><td class=num>{v}</td></tr>")
    return f"""<table class=avg><thead><tr><th>Type</th><th>Asked (unseen)</th><th>Got unseen</th><th>Got seen</th></tr></thead><tbody>{''.join(rows)}</tbody>
    <tfoot><tr><td>Total <span class=hint>Word Meanings counted per word</span></td><td class=num>{ex['spec']['questionCount']}</td><td class=num>{ex['eff']['unseen']}</td><td class=num>{ex['eff']['seen'] or '·'}</td></tr></tfoot></table>"""

def questions_block(ex):
    out = []
    for sec, cat, t, qs in walk(ex["exam"]):
        items = []
        for i, q in enumerate(qs, 1):
            g = grounding(q, ex["vocab"])
            bar = "" if g is None else f'<span class=gbar title="{g[1]} distinct words checked"><i style="width:{g[0]*100:.0f}%"></i></span><span class=gpct>{g[0]*100:.0f}%</span>'
            body = esc(q.get("question") or q.get("main_question") or "")
            opts = q.get("options") or q.get("words") or []
            if isinstance(opts, list) and opts: body += "<div class=opts>" + " · ".join(esc(o) for o in opts) + "</div>"
            if q.get("column_a"): body += "<div class=opts>A: " + " · ".join(esc(o) for o in q["column_a"]) + "<br>B: " + " · ".join(esc(o) for o in q.get("column_b") or []) + "</div>"
            ans = q.get("answer"); ans_html = f"<div class=ans>Answer: {esc(ans)}</div>" if ans else ""
            items.append(f"<li><div class=qrow><div class=qtext>{body}{ans_html}</div><div class=qmeta><span class=marks>{esc(q.get('marks','?'))} mk</span>{bar}</div></div></li>")
        out.append(f"<section class=qgroup><h5><span class='sec {sec}'>{sec}</span> {esc(t)} <span class=count>{len(qs)}</span></h5><ol>{''.join(items)}</ol></section>")
    return "".join(out)

def exam_html(ex):
    s, r, p = ex["spec"], ex["res"], ex["pages"]
    thumbs = "".join(
        f'<figure><img src="{b64(ex["dir"]/e["file"])}" alt="Printed page {e["printed"]}" loading=lazy data-full="1"><figcaption>p.{e["printed"]} <span class=pdf>pdf {e["pdf"]}</span></figcaption></figure>'
        for e in ex["src"] if (ex["dir"]/e["file"]).exists())
    paper = "".join(f'<img class=paperpg src="{b64(f)}" alt="Generated paper page {i}" data-full="1">' for i, f in enumerate(ex["paper"], 1))
    types = " ".join(chip(f"{t['count']} × {t['id']}", "obj" if t["category"] == "objective" else "subj") for t in s["questionTypes"])
    source_word = {"both": "seen + unseen (a mix of both)", "unseen": "unseen only (new questions on the same topics)", "seen": "seen only (from the book)"}[s["contentSource"]]
    tok = r["tokens"]
    return f"""
<article class=exam id="exam-{ex['lab']}">
  <header class=exhead>
    <div><span class=eyebrow>Exam {ex['lab']} · chapter {s['chapterNumber']}</span><h2>{esc(s['chapterTitle'])}</h2>
    <p class=sub>Printed pages {esc(r['pageReference'])} · {r['pagesLoaded']} pages loaded · {r['contentChars']:,} characters of text · pdf pages {ex['src'][0]['pdf']}–{ex['src'][-1]['pdf']}</p></div>
    <dl class=kpis>
      <div><dt>Asked</dt><dd>{s['questionCount']}</dd></div>
      <div><dt>Delivered</dt><dd class="{'warn' if ex['eff']['total']!=s['questionCount'] else ''}">{ex['eff']['total']}</dd></div>
      <div><dt>Marks</dt><dd>{r['totalMarks']}</dd></div>
      <div><dt>Tokens in / out</dt><dd>{tok['inputTokens']:,} / {tok['outputTokens']:,}</dd></div>
      <div><dt>Model time</dt><dd>{r['elapsedMs']/1000:.0f}s</dd></div>
    </dl>
  </header>
  <div class=spread>
    <section class=col>
      <h3><span class=colnum>1</span> Source pages <span class=hint>what the OCR text was read from</span></h3>
      <div class=thumbs>{thumbs}</div>
    </section>
    <section class=col>
      <h3><span class=colnum>2</span> Input to the generator</h3>
      <div class=inputcard>
        <div class=row><span class=k>Where questions come from</span><span class=v>{esc(source_word)}</span></div>
        <div class=row><span class=k>How many</span><span class=v>{s['questionCount']} questions</span></div>
        <div class=row><span class=k>Question types</span><span class=v>{types}</span></div>
        <div class=row><span class=k>Answer key</span><span class=v>{'on' if s['includeAnswerKey'] else 'off'} · answer lines {'on' if s['answerLines'] else 'off'}</span></div>
        <div class=row><span class=k>Model</span><span class=v><code>{esc(tok['model'])}</code> · temperature 0.7 · JSON mode</span></div>
      </div>
      <details><summary>Text the model saw <span class=hint>{len(ex['content']):,} chars, {r['pagesLoaded']} page markers</span></summary><pre class=content>{esc(ex['content'])}</pre></details>
      <details><summary>User prompt <span class=hint>{len(ex['user']):,} chars — the text above is inside it</span></summary><pre class=content>{esc(ex['user'].split('**Book Text Content:**')[0])}<span class=elided>… book text ({len(ex['content']):,} chars, shown above) …</span>{esc(ex['user'].split('```', 2)[-1])}</pre></details>
      <details><summary>System prompt <span class=hint>{len(ex['system']):,} chars · subject prompt + task + output format + safety</span></summary><pre class=content>{esc(ex['system'])}</pre></details>
    </section>
    <section class=col>
      <h3><span class=colnum>3</span> Result</h3>
      <h4>Asked vs delivered</h4>
      {asked_vs_got(ex)}
      <h4>The paper, as the teacher receives it <span class=hint>{len(ex['paper'])} pages</span></h4>
      <div class=paper>{paper}</div>
      <h4>Every question, with vocabulary overlap against the chapter text <span class=hint>heuristic: share of the question's words (4+ letters) that occur in the pages above</span></h4>
      {questions_block(ex)}
      <details><summary>Raw exam JSON</summary><pre class=content>{esc(json.dumps(ex['exam'], ensure_ascii=False, indent=1))}</pre></details>
    </section>
  </div>
</article>"""

summary_rows = "".join(f"""<tr><td><a href="#exam-{e['lab']}">Exam {e['lab']}</a></td><td>{e['spec']['chapterNumber']} · {esc(e['spec']['chapterTitle'])}</td><td class=num>{esc(e['res']['pageReference'])}</td>
<td>{esc(e['spec']['contentSource'])}</td><td class=num>{e['spec']['questionCount']}</td><td class="num {'warn' if e['eff']['total']!=e['spec']['questionCount'] else ''}">{e['eff']['total']}</td>
<td class=num>{e['eff']['seen']}</td><td class=num>{e['eff']['unseen']}</td><td class=num>{e['res']['totalMarks']}</td><td class=num>{e['res']['tokens']['inputTokens']:,} / {e['res']['tokens']['outputTokens']:,}</td><td class=num>{e['res']['elapsedMs']/1000:.0f}s</td></tr>""" for e in exams)

page = f"""<title>AG Eval · {esc(label)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{{--ground:#F6F7F5;--surface:#FFFFFF;--surface2:#EEF3EF;--ink:#333748;--ink2:#565C6E;--muted:#6C7A72;--rule:#DCE3DE;--rule2:#C9D3CC;--accent:#47BA7D;--accent-ink:#2E8F5C;--accent-wash:#E4F4EB;--warn:#C9822B;--warn-wash:#F8EEDF;--seen:#5C6BC0;--seen-wash:#E8EAF6;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--shadow:0 1px 2px rgba(51,55,72,.06),0 8px 24px -16px rgba(51,55,72,.25)}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--ground:#1C1F26;--surface:#252932;--surface2:#2B3038;--ink:#E8EAE6;--ink2:#B9BEC8;--muted:#8E9A92;--rule:#353B45;--rule2:#454C58;--accent:#5CCB8E;--accent-ink:#7FD9A6;--accent-wash:#22382C;--warn:#E0A55A;--warn-wash:#3A2F1C;--seen:#8C98E0;--seen-wash:#2A2F45;--shadow:none}}}}
:root[data-theme="dark"]{{--ground:#1C1F26;--surface:#252932;--surface2:#2B3038;--ink:#E8EAE6;--ink2:#B9BEC8;--muted:#8E9A92;--rule:#353B45;--rule2:#454C58;--accent:#5CCB8E;--accent-ink:#7FD9A6;--accent-wash:#22382C;--warn:#E0A55A;--warn-wash:#3A2F1C;--seen:#8C98E0;--seen-wash:#2A2F45;--shadow:none}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--ground);color:var(--ink);font:15px/1.5 var(--sans)}}
.wrap{{max-width:1480px;margin:0 auto;padding:32px 28px 80px}}
h1,h2,h3,h4,h5{{text-wrap:balance;margin:0}}
.masthead{{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;padding-bottom:20px;border-bottom:2px solid var(--accent)}}
.masthead .eyebrow{{color:var(--accent-ink)}}
h1{{font-size:34px;font-weight:600;letter-spacing:-.02em;line-height:1.1;margin-top:6px}}
.lede{{max-width:68ch;color:var(--ink2);margin:12px 0 0}}
.eyebrow{{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}}
.facts{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:2px 24px;font-size:13px}}
.facts dt{{color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase}} .facts dd{{margin:0 0 8px;font-family:var(--mono);font-size:13px}}
table{{border-collapse:collapse;width:100%;font-size:13.5px}} th{{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--rule2)}}
td{{padding:8px 10px;border-bottom:1px solid var(--rule);vertical-align:top}} td.num,th.num{{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}} tfoot td{{font-weight:600;border-top:1px solid var(--rule2);border-bottom:0}}
.warn{{color:var(--warn);font-weight:600}} tr.extra td{{color:var(--ink2)}} .tag{{font-size:11px;background:var(--seen-wash);color:var(--seen);padding:1px 6px;border-radius:3px;margin-left:4px}}
.summary{{margin:28px 0 8px;background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:6px 8px;overflow-x:auto}}
.note{{background:var(--surface2);border-left:3px solid var(--accent);padding:12px 16px;margin:20px 0;font-size:14px;color:var(--ink2);max-width:90ch}}
.note b{{color:var(--ink)}}
.exam{{margin-top:44px;background:var(--surface);border:1px solid var(--rule);border-radius:8px;box-shadow:var(--shadow)}}
.exhead{{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start;padding:22px 26px 18px;border-bottom:1px solid var(--rule)}}
.exhead h2{{font-size:26px;font-weight:600;letter-spacing:-.015em;margin-top:4px}} .sub{{margin:6px 0 0;color:var(--ink2);font-size:14px}}
.kpis{{display:flex;gap:22px;margin:0}} .kpis div{{min-width:70px}} .kpis dt{{font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}} .kpis dd{{margin:2px 0 0;font-family:var(--mono);font-size:20px;font-variant-numeric:tabular-nums}}
.spread{{display:grid;grid-template-columns:minmax(300px,1.05fr) minmax(300px,.95fr) minmax(360px,1.3fr);gap:0}}
.col{{padding:20px 22px 26px;border-right:1px solid var(--rule);min-width:0}} .col:last-child{{border-right:0}}
.col h3{{font-size:15px;font-weight:600;display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}}
.colnum{{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font:600 12px var(--mono)}}
.hint{{font-weight:400;color:var(--muted);font-size:12.5px}}
h4{{font-size:13px;font-weight:600;color:var(--ink2);margin:22px 0 8px;letter-spacing:.01em}} h4:first-of-type{{margin-top:0}}
.thumbs{{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:12px}}
figure{{margin:0}} figure img{{width:100%;height:auto;border:1px solid var(--rule2);border-radius:3px;cursor:zoom-in;display:block;background:#fff}}
figcaption{{font:12px var(--mono);color:var(--ink2);margin-top:4px;display:flex;justify-content:space-between}} figcaption .pdf{{color:var(--muted)}}
.inputcard{{border:1px solid var(--rule);border-radius:6px;overflow:hidden;margin-bottom:14px}} .row{{display:grid;grid-template-columns:150px 1fr;gap:10px;padding:9px 12px;border-bottom:1px solid var(--rule);font-size:13.5px}} .row:last-child{{border-bottom:0}}
.row .k{{color:var(--muted);font-size:12px;padding-top:2px}} .row .v{{min-width:0}} code{{font-family:var(--mono);font-size:12.5px;background:var(--surface2);padding:1px 5px;border-radius:3px}}
.chip{{display:inline-block;font:12.5px var(--mono);padding:2px 8px;border-radius:12px;border:1px solid var(--rule2);margin:2px 4px 2px 0;background:var(--surface2)}} .chip.subj{{border-color:var(--accent);background:var(--accent-wash);color:var(--accent-ink)}}
details{{border:1px solid var(--rule);border-radius:6px;margin:10px 0;background:var(--surface)}} summary{{cursor:pointer;padding:9px 12px;font-size:13.5px;font-weight:500;list-style:none;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}} summary::before{{content:"▸";color:var(--accent-ink);font-size:12px}} details[open] summary::before{{content:"▾"}}
pre.content{{margin:0;padding:12px 14px;border-top:1px solid var(--rule);font:12.5px/1.5 var(--mono);white-space:pre-wrap;word-break:break-word;max-height:520px;overflow:auto;background:var(--surface2);color:var(--ink)}} .elided{{color:var(--muted);font-style:italic}}
.paper{{display:flex;flex-direction:column;gap:10px}} .paperpg{{width:100%;height:auto;border:1px solid var(--rule2);border-radius:3px;cursor:zoom-in;display:block;background:#fff}}
.qgroup{{margin:10px 0 16px}} .qgroup h5{{font-size:13px;font-weight:600;display:flex;gap:8px;align-items:center;margin-bottom:6px}} .sec{{font:600 10.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:3px}} .sec.seen{{background:var(--seen-wash);color:var(--seen)}} .sec.unseen{{background:var(--accent-wash);color:var(--accent-ink)}} .count{{color:var(--muted);font-family:var(--mono);font-weight:400}}
.qgroup ol{{margin:0;padding-left:22px}} .qgroup li{{padding:6px 0;border-bottom:1px dashed var(--rule);font-size:13.5px}} .qrow{{display:grid;grid-template-columns:1fr 120px;gap:12px;align-items:start}} .qtext{{min-width:0}}
.opts{{color:var(--ink2);font-size:12.5px;margin-top:2px}} .ans{{color:var(--accent-ink);font-size:12.5px;margin-top:2px}}
.qmeta{{display:grid;grid-template-columns:44px 1fr 34px;gap:6px;align-items:center;font:12px var(--mono);color:var(--muted)}} .gbar{{height:6px;background:var(--rule);border-radius:3px;overflow:hidden;display:block}} .gbar i{{display:block;height:100%;background:var(--accent)}} .gpct{{text-align:right;font-variant-numeric:tabular-nums}}
dialog{{border:0;padding:0;background:transparent;max-width:min(96vw,1100px);max-height:96vh}} dialog::backdrop{{background:rgba(20,24,30,.78)}} dialog img{{max-width:min(96vw,1100px);max-height:94vh;display:block;border-radius:4px;background:#fff}}
a{{color:var(--accent-ink)}} :focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
@media (max-width:1100px){{.spread{{grid-template-columns:1fr}} .col{{border-right:0;border-bottom:1px solid var(--rule)}} .exhead,.masthead{{grid-template-columns:1fr}} .kpis{{flex-wrap:wrap}}}}
@media (prefers-reduced-motion:no-preference){{details summary{{transition:background .15s}}}}
</style>
<div class=wrap>
<header class=masthead>
  <div><div class=eyebrow>Assessment Generator · eval run · NIETE staging</div><h1>{esc(label)}: two exams, page by page</h1>
  <p class=lede>The generator was run the way the worker runs it, on the same three services with the same arguments, and the delivery step cut off so the output could be read instead of received. For each exam: the textbook pages the text was read from, exactly what the model was given, and what came back.</p></div>
  <dl class=facts>
    <dt>Book</dt><dd>{esc(spec0['title'])} · id {book_id}</dd>
    <dt>Printed pages</dt><dd>166 · pdf offset {spec0['pdfPageOffset']}</dd>
    <dt>Model</dt><dd>{esc(model)}</dd>
    <dt>Run</dt><dd>{today} · staging DB</dd>
  </dl>
</header>
<div class=summary><table>
<thead><tr><th>Exam</th><th>Chapter</th><th class=num>Pages</th><th>Source</th><th class=num>Asked</th><th class=num>Got</th><th class=num>Seen</th><th class=num>Unseen</th><th class=num>Marks</th><th class=num>Tokens in / out</th><th class=num>Time</th></tr></thead>
<tbody>{summary_rows}</tbody></table></div>
<p class=note><b>How to read "asked".</b> The count a teacher types governs the <i>unseen</i> questions only. With "a mix of both", the prompt adds an uncapped instruction to lift all of the textbook's own questions as <i>seen</i> questions, so the paper is longer than the number typed. That is the open decision from 1 September, and Exam A shows it. Exam B asks for new questions only. Page numbers are printed page numbers; the pdf index each was read from is under every thumbnail.</p>
{''.join(exam_html(e) for e in exams)}
</div>
<dialog id=zoom><img alt=""></dialog>
<script>
(function(){{var d=document.getElementById('zoom'),im=d.querySelector('img');
document.addEventListener('click',function(e){{var t=e.target;if(t.tagName==='IMG'&&t.dataset.full){{im.src=t.src;im.alt=t.alt;d.showModal();}}else if(e.target===d||e.target===im){{d.close();}}}});
d.addEventListener('click',function(e){{if(e.target===d)d.close();}});}})();
</script>"""
Path(out).write_text(page)
print(out, f"{Path(out).stat().st_size/1e6:.2f} MB")
