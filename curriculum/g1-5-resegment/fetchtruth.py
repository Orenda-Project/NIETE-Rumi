"""Pull the Stage-A page truth for the 17 in-scope books out of Drive.

The corpus is `restricted-educational-internal` (NBF/FBISE), and NIETE-Rumi is
a PUBLIC fork, so this writes into `corpus-local/` — gitignored, same as the
segmentation corpus beside it. Nothing here is ever committed or redistributed.

Drive is reached with the service account the sheet build already uses, not
the Drive MCP: the MCP connector was signed out on 18 Sep 2026 and the folder
turned out to be shared with the service account anyway.

Idempotent: a page already on disk is not re-fetched, so an interrupted run is
resumed by running it again. That only holds if a half-written file never
looks finished, so a page is written to a temp name and renamed into place —
the first run died on a read timeout partway through, and a truncated JSON
file that the resume step skips is worse than no file at all.

Drive times out. Roughly 3,400 small files over one service account will drop
a read somewhere, so a transient failure retries with a backoff and only a
whole book's worth of failure is given up on. One book failing must not take
the other sixteen with it, which is what happened the first time.
"""
import concurrent.futures as cf
import io
import os
import random
import socket
import ssl
import sys
import time

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

TRUTH_FOLDER = "1jTv0cs0iBwazqe8hIWGL-QCR3qVF-e9m"   # Handoff:Hataf/01_page_truth
# Beside `seg/` and `fde/`, not above them: `corpus/seg` is a symlink whose
# target resolves relative to `corpus/`, which puts the real corpus-local
# inside this build directory rather than in `curriculum/`.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "corpus-local", "pagetruth")

# The 17 books this build segments. The Drive tree also holds islamiat,
# social studies and general knowledge; those are out of scope (Science is
# G4-5 General Science only, operator 2026-09-04) and are not pulled.
IN_SCOPE = {
    "grade_1_english", "grade_1_maths", "grade_1_urdu",
    "grade_2_english", "grade_2_math", "grade_2_urdu",
    "grade_3_english", "grade_3_math", "grade_3_urdu",
    "grade_4_english", "grade_4_math", "grade_4_urdu", "grade_4_general_science",
    "grade_5_english", "grade_5_math", "grade_5_urdu", "grade_5_general_science",
}


def client():
    cr = service_account.Credentials.from_service_account_file(
        os.environ["GOOGLE_SERVICE_ACCOUNT_PATH"],
        scopes=["https://www.googleapis.com/auth/drive.readonly"])
    return build("drive", "v3", credentials=cr, cache_discovery=False)


def listing(svc, folder):
    """Every non-trashed child of `folder`, paging until Drive stops."""
    out, tok = [], None
    while True:
        r = svc.files().list(
            q=f"'{folder}' in parents and trashed=false",
            fields="nextPageToken,files(id,name,mimeType)",
            pageSize=1000, pageToken=tok,
            supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        out += r.get("files", [])
        tok = r.get("nextPageToken")
        if not tok:
            return out


# What a flaky connection looks like from here. An auth or permission error
# is NOT in this list on purpose: retrying it just fails four times slower and
# buries the message that says what is actually wrong.
TRANSIENT = (socket.timeout, ssl.SSLError, ConnectionError, TimeoutError, OSError)


def with_retry(op, attempts=4, sleep=time.sleep, jitter=random.random):
    """Run `op()`, retrying a transient network failure with a backoff.

    `sleep` and `jitter` are arguments so the retry rule can be tested at full
    speed and deterministically; nothing else should pass them.
    """
    for n in range(attempts):
        try:
            return op()
        except TRANSIENT:
            if n == attempts - 1:
                raise
            sleep(2 ** n * (0.5 + jitter()))


def fetch(svc, fid, dest):
    """Download one page into `dest`, atomically.

    The rename is the point: an interrupted run leaves a `.part` file, which
    the resume step does not mistake for a finished page.
    """
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, svc.files().get_media(fileId=fid))
    done = False
    while not done:
        _status, done = dl.next_chunk()
    tmp = dest + ".part"
    with open(tmp, "wb") as fh:
        fh.write(buf.getvalue())
    os.replace(tmp, dest)


def book(name, fid):
    """Download one book. Returns (name, fetched, skipped)."""
    svc = client()                      # one client per thread; not shareable
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    got = skip = 0
    for f in with_retry(lambda: listing(svc, fid)):
        if not f["name"].endswith(".json"):
            continue                    # .DS_Store and friends
        dest = os.path.join(d, f["name"])
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            skip += 1
            continue
        with_retry(lambda: fetch(svc, f["id"], dest))
        got += 1
    return name, got, skip


def attempt(name, fid):
    """`book` with its failure turned into a value, so one book cannot take
    the pool down with it. The run is idempotent, so the answer to a failed
    book is to run the script again."""
    try:
        return book(name, fid) + (None,)
    except Exception as exc:                 # noqa: BLE001 - reported, not swallowed
        return name, 0, 0, "%s: %s" % (type(exc).__name__, exc)


def main():
    svc = client()
    books = [(f["name"], f["id"]) for f in listing(svc, TRUTH_FOLDER)
             if f["mimeType"].endswith("folder") and f["name"] in IN_SCOPE]
    missing = IN_SCOPE - {n for n, _ in books}
    if missing:
        print("NOT IN DRIVE:", sorted(missing), file=sys.stderr)
    os.makedirs(OUT, exist_ok=True)
    failed = []
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for name, got, skip, err in pool.map(lambda b: attempt(*b), books):
            print(f"{name:<28} fetched {got:>4}  already had {skip:>4}"
                  f"{'  FAILED ' + err if err else ''}", flush=True)
            if err:
                failed.append(name)
    if failed:
        print("INCOMPLETE:", sorted(failed), "- run again to resume",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
