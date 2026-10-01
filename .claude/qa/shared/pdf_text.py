#!/usr/bin/env python3
"""pdf_text.py — the text of a PDF the bot sent, for a driver assertion (COA16 bands, COA18 partial note).

    python3 pdf_text.py <url-or-path>        prints {"ok":true,"pages":N,"text":"..."} as one JSON line

The mock Graph API serves every outbound media's bytes at /media/<id>/bytes; a driver passes that URL.
"""
import json, sys, io, urllib.request

def main():
    src = sys.argv[1]
    try:
        data = urllib.request.urlopen(src, timeout=30).read() if src.startswith("http") else open(src, "rb").read()
        from pypdf import PdfReader
        r = PdfReader(io.BytesIO(data))
        text = "\n".join((p.extract_text() or "") for p in r.pages)
        print(json.dumps({"ok": True, "pages": len(r.pages), "bytes": len(data), "text": text}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "err": str(e)[:300]}))

if __name__ == "__main__":
    main()
