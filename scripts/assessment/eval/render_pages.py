"""Render, per exam folder: the source PDF pages the model was given (by pdf index)
and the generated paper's pages, as small JPEGs for the report.
    python3 render_pages.py <evals_dir> <pdfs_dir> [--dpi 50] [--only 1171-A,...]
Writes <exam>/src/p<pdfidx>.jpg (+ src_index.json) and <exam>/paper/p<n>.jpg."""
import json, subprocess, sys, os, glob, shutil
from pathlib import Path
evals, pdfs = Path(sys.argv[1]), Path(sys.argv[2])
dpi = int(sys.argv[sys.argv.index("--dpi")+1]) if "--dpi" in sys.argv else 50
only = sys.argv[sys.argv.index("--only")+1].split(",") if "--only" in sys.argv else None
def render(pdf, first, last, outprefix):
    subprocess.run(["pdftoppm","-r",str(dpi),"-jpeg","-jpegopt","quality=62","-f",str(first),"-l",str(last),str(pdf),outprefix],check=True,capture_output=True)
for d in sorted(evals.iterdir()):
    if not d.is_dir() or (only and d.name not in only): continue
    spec=json.load(open(d/"spec.json")); pages_f=d/"pages.json"
    book=pdfs/f"{spec['bookId']}.pdf"
    if pages_f.exists() and book.exists():
        pages=json.load(open(pages_f))["pages"]
        idx=sorted({p["pdf_page_index"] for p in pages if p.get("pdf_page_index")})
        src=d/"src"; shutil.rmtree(src, ignore_errors=True); src.mkdir()
        if idx:
            render(book, min(idx), max(idx), str(src/"p"))
            # pdftoppm names p-<n>.jpg with zero padding; normalise to p<pdfidx>.jpg and drop pages not in idx
            for f in src.glob("p-*.jpg"):
                n=int(f.stem.split("-")[1])
                if n in idx: f.rename(src/f"p{n}.jpg")
                else: f.unlink()
        json.dump([{"printed":p["textbook_page_number"],"pdf":p["pdf_page_index"],"file":f"src/p{p['pdf_page_index']}.jpg"} for p in pages], open(d/"src_index.json","w"))
    paper=d/"paper.pdf"
    if paper.exists():
        pp=d/"paper"; shutil.rmtree(pp, ignore_errors=True); pp.mkdir()
        render(paper, 1, 99, str(pp/"p"))
        for f in sorted(pp.glob("p-*.jpg")): f.rename(pp/f"p{int(f.stem.split('-')[1])}.jpg")
    key=d/"key.pdf"
    if key.exists():
        kp=d/"key"; shutil.rmtree(kp, ignore_errors=True); kp.mkdir()
        render(key, 1, 99, str(kp/"p"))
        for f in sorted(kp.glob("p-*.jpg")): f.rename(kp/f"p{int(f.stem.split('-')[1])}.jpg")
    print(d.name, "src", len(list((d/"src").glob("*.jpg"))) if (d/"src").exists() else "-", "paper", len(list((d/"paper").glob("*.jpg"))) if (d/"paper").exists() else "-", flush=True)
