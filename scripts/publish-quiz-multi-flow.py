#!/usr/bin/env python3
"""
Publish the Quiz Multi-Select Flow JSON to Meta's WhatsApp Business Cloud API.

Copies scripts/publish-assessment-gen-flow.py's shape; the difference is that
this Flow is STATIC (no endpoint_uri at all — the question, options and
answer token are supplied per-send as navigate-mode screen data). A bare
flow-level POST with no endpoint_uri is fine for a static Flow; what the
whatsapp-flows skill (rule 13) warns against is a POST that WIPES an existing
endpoint_uri on a Flow that has one — this Flow never has one, so there is
nothing to wipe.

Env vars required (reads from NIETE-Rumi/.env):
  - WHATSAPP_TOKEN  (WhatsApp Business API token with `whatsapp_business_management` scope)
  - WABA_ID         (the NIETE WABA business account ID)

Usage:
  python3 scripts/publish-quiz-multi-flow.py                       # DRAFT (new flow)
  python3 scripts/publish-quiz-multi-flow.py --publish             # publish immediately (new flow)
  python3 scripts/publish-quiz-multi-flow.py --flow-id <id>        # update existing draft in place
  python3 scripts/publish-quiz-multi-flow.py --flow-id <id> --publish  # update existing + publish

The DRAFT path is the intended "staging" workflow for teacher testing: a
tester phone number can preview the DRAFT via Meta before it is exposed to
the general teacher population. Promote to PUBLISHED with --publish after
sign-off.
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"
FLOW_JSON = REPO / "docs" / "flows" / "quiz-multi-select-flow.json"


def env(k: str, required: bool = True):
    for line in ENV.read_text().splitlines():
        if line.startswith(k + "="):
            v = line.split("=", 1)[1]
            if v: return v
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
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n".encode())
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
    ap.add_argument("--flow-id", help="Update an existing draft Flow instead of creating a new one")
    ap.add_argument("--name", default="Quiz Multi-Select", help="Flow name — must match the FLOW_CONFIGS entry so the registrar finds it by name (default: Quiz Multi-Select)")
    args = ap.parse_args()

    waba_id = env("WABA_ID")
    # Meta's Flow JSON validator REJECTS unknown top-level properties:
    #   INVALID_PROPERTY_KEY — "Property '_comment' is not allowed."
    # and then refuses the publish outright (139002 / 4016011). Several older
    # flows in docs/flows/ carry _comment/_instructions/_notes and were accepted
    # by an earlier validator; a NEW flow is not. The comments are worth keeping
    # in the repo, so they are stripped here, at the boundary, instead.
    doc = json.loads(FLOW_JSON.read_text())
    stripped = sorted(k for k in doc if k.startswith("_"))
    for k in stripped:
        doc.pop(k)
    flow_json = json.dumps(doc, ensure_ascii=False, indent=2)
    print(f"Flow JSON: {len(flow_json):,} bytes  ·  source: {FLOW_JSON}")
    if stripped:
        print(f"Stripped repo-only keys before upload: {', '.join(stripped)}")

    if args.flow_id:
        flow_id = args.flow_id
        print(f"Updating existing Flow: {flow_id}")
    else:
        # STATIC flow: no endpoint_uri in the create call at all.
        create = api("POST", f"{waba_id}/flows",
                     body={"name": args.name, "categories": ["OTHER"]})
        flow_id = create["id"]
        print(f"Created Flow: {flow_id}")

    # Upload the flow.json asset
    upload = api(
        "POST",
        f"{flow_id}/assets",
        body={"name": "flow.json", "asset_type": "FLOW_JSON"},
        files={"file": ("flow.json", flow_json.encode(), "application/json")},
    )
    print("flow.json uploaded:", upload)
    # An upload "succeeds" while reporting validation_errors, and the publish
    # then fails with a message that does not name them. Stop here instead.
    errors = upload.get("validation_errors") or []
    if errors:
        for e in errors:
            print(f"  ✖ {e.get('error')}: {e.get('message')}")
        raise SystemExit("Flow JSON did not validate — nothing was published.")

    if args.publish:
        pub = api("POST", f"{flow_id}/publish", body={})
        print("Published:", pub)
        status = api("GET", f"{flow_id}?fields=id,name,status")
        print("Verified status:", status)
        print(f"\n✅ Flow published. Copy this into .env:")
        print(f"   QUIZ_MULTI_FLOW_ID={flow_id}")
    else:
        status = api("GET", f"{flow_id}?fields=id,name,status")
        print("Verified status:", status)
        print(f"\n✅ Flow saved as DRAFT. Copy this into .env:")
        print(f"   QUIZ_MULTI_FLOW_ID={flow_id}")
        print(f"   Then re-run with --publish, or publish via the Meta dashboard.")
        print(f"\n   To test the DRAFT: add your tester phone number as a WhatsApp Flow tester")
        print(f"   in the Meta Business Manager under Flow {flow_id}.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
