#!/usr/bin/env python3
"""
Publish the Student Join Flow (name + class, shown to a child opening a quiz
share link) to a WhatsApp Business Account.

Shape copied from scripts/publish-assessment-gen-flow.py. Two deliberate
differences, both forced by what this Flow IS:

  * NO endpoint_uri. This is a NAVIGATE flow: its single screen is terminal
    and its footer action is `complete`, so the whole payload arrives as an
    nfm_reply and is handled in-process. Setting an endpoint_uri would make
    Meta call a data_exchange route that does not exist.
  * The flow id it prints goes into STUDENT_JOIN_FLOW_ID. With that env var
    unset the join still works — the bot falls back to asking for the name in
    chat (video-quiz-share.service.js) — it is just three round trips instead
    of one screen.

Env vars, read from the repo-root .env of whichever deployment you are
publishing to:
  WHATSAPP_TOKEN   token with the whatsapp_business_management scope
  WABA_ID          the WhatsApp Business Account the Flow is created under

Usage:
  python3 scripts/publish-student-join-flow.py                          # DRAFT (new flow)
  python3 scripts/publish-student-join-flow.py --publish                # create + publish
  python3 scripts/publish-student-join-flow.py --flow-id <id>           # update an existing flow
  python3 scripts/publish-student-join-flow.py --flow-id <id> --publish # update + publish

A Flow id is per-WABA by design: the same JSON published to a second WABA gets
a different id, and each deployment sets its own STUDENT_JOIN_FLOW_ID.
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"
FLOW_JSON = REPO / "docs" / "flows" / "student-join-flow.json"


def env(k: str, required: bool = True):
    for line in ENV.read_text().splitlines():
        if line.startswith(k + "="):
            v = line.split("=", 1)[1]
            if v:
                return v
    if required:
        print(f"ERROR: {k} not set in .env.", file=sys.stderr)
        sys.exit(1)
    return None


def api(method: str, path: str, body: dict | None = None, files: dict | None = None) -> dict:
    token = env("WHATSAPP_TOKEN")
    url = f"https://graph.facebook.com/v20.0/{path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if files:
        boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        parts = []
        for k, v in (body or {}).items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
        for name, (filename, content, ctype) in files.items():
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; "
                f"filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n".encode()
            )
            parts.append(content)
            parts.append(b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        data = b"".join(parts)
    elif body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Meta API {method} {path} failed: {e.code} {e.read().decode()[:500]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true", help="Publish the Flow immediately (default: DRAFT)")
    ap.add_argument("--flow-id", help="Update an existing Flow instead of creating a new one")
    ap.add_argument("--name", default="Student join — name and class", help="Flow name shown in the Meta dashboard")
    ap.add_argument("--dry-run", action="store_true", help="Validate the JSON and print the plan; call nothing")
    args = ap.parse_args()

    flow_json = FLOW_JSON.read_text()
    parsed = json.loads(flow_json)          # fail loudly here, not at Meta
    screens = [s.get("id") for s in parsed.get("screens", [])]
    print(f"Flow JSON: {len(flow_json):,} bytes · version {parsed.get('version')} · screens {screens}")
    if "WHO" not in screens:
        raise SystemExit("ERROR: the bot routes this Flow onto screen 'WHO' — it is not in this JSON.")

    if args.dry_run:
        print(f"DRY RUN — would {'update ' + args.flow_id if args.flow_id else 'create a new Flow'} "
              f"on WABA {env('WABA_ID')} and {'publish' if args.publish else 'leave it as a DRAFT'}.")
        return 0

    waba_id = env("WABA_ID")
    if args.flow_id:
        flow_id = args.flow_id
        print(f"Updating existing Flow: {flow_id}")
    else:
        create = api("POST", f"{waba_id}/flows", body={"name": args.name, "categories": ["OTHER"]})
        flow_id = create["id"]
        print(f"Created Flow: {flow_id}")

    upload = api(
        "POST",
        f"{flow_id}/assets",
        body={"name": "flow.json", "asset_type": "FLOW_JSON"},
        files={"file": ("flow.json", flow_json.encode(), "application/json")},
    )
    print("flow.json uploaded:", upload)
    errors = upload.get("validation_errors") or []
    if errors:
        raise SystemExit(f"Meta rejected the Flow JSON: {json.dumps(errors)[:800]}")

    if args.publish:
        print("Published:", api("POST", f"{flow_id}/publish", body={}))
        print("\n✅ Flow published. Set on every service that answers the webhook:")
    else:
        print("\n✅ Flow saved as a DRAFT. Publish it with --flow-id "
              f"{flow_id} --publish, then set:")
    print(f"   STUDENT_JOIN_FLOW_ID={flow_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
