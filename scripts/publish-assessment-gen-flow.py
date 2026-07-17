#!/usr/bin/env python3
"""
Publish the Assessment Generator Flow JSON to Meta's WhatsApp Business Cloud API.

Copies scripts/publish-exam-generator-flow.py's shape; only the FLOW_JSON
path, default flow name, default endpoint URI, and env-var-to-set differ.

FEAT-092 rev3 (Alishba fixes, 2026-07-17): re-publish after the OBJ_SUBJ
CheckboxGroup + expanded per-type count-input coverage change.

Env vars required (reads from NIETE-Rumi/.env):
  - WHATSAPP_TOKEN  (WhatsApp Business API token with `whatsapp_business_management` scope)
  - WABA_ID         (the NIETE WABA business account ID)

Usage:
  python3 scripts/publish-assessment-gen-flow.py                       # DRAFT (new flow)
  python3 scripts/publish-assessment-gen-flow.py --publish             # publish immediately (new flow)
  python3 scripts/publish-assessment-gen-flow.py --flow-id <id>        # update existing draft in place
  python3 scripts/publish-assessment-gen-flow.py --flow-id <id> --publish  # update existing + publish

The DRAFT path is the intended "staging" workflow for teacher testing:
Alishba (or any tester) can preview the DRAFT via a Meta-authenticated
tester phone number without exposing the change to the general teacher
population. Promote to PUBLISHED with --publish after sign-off.
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"
FLOW_JSON = REPO / "docs" / "flows" / "assessment-gen-flow.json"


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
    ap.add_argument("--name", default="assessment_gen_v3", help="Flow name (default: assessment_gen_v3 — bumped for FEAT-092 rev3)")
    ap.add_argument("--endpoint-uri", default="https://bot-production-2cb6.up.railway.app/api/flows/assessment-gen",
                    help="Public URL Meta calls for data_exchange (default: NIETE prod)")
    args = ap.parse_args()

    waba_id = env("WABA_ID")
    flow_json = FLOW_JSON.read_text()
    print(f"Flow JSON: {len(flow_json):,} bytes  ·  source: {FLOW_JSON}")

    if args.flow_id:
        flow_id = args.flow_id
        print(f"Updating existing Flow: {flow_id}")
    else:
        create = api("POST", f"{waba_id}/flows",
                     body={"name": args.name, "categories": ["OTHER"], "endpoint_uri": args.endpoint_uri})
        flow_id = create["id"]
        print(f"Created Flow: {flow_id}")

    # Ensure endpoint_uri is set (required before publish). Safe to run on
    # both new and existing flow ids — POST /{flow-id} accepts partial updates.
    print(f"Setting endpoint_uri: {args.endpoint_uri}")
    api("POST", f"{flow_id}", body={"endpoint_uri": args.endpoint_uri})

    # Upload the flow.json asset
    upload = api(
        "POST",
        f"{flow_id}/assets",
        body={"name": "flow.json", "asset_type": "FLOW_JSON"},
        files={"file": ("flow.json", flow_json.encode(), "application/json")},
    )
    print("flow.json uploaded:", upload)

    if args.publish:
        pub = api("POST", f"{flow_id}/publish", body={})
        print("Published:", pub)
        print(f"\n✅ Flow published. Copy this into .env:")
        print(f"   ASSESSMENT_GEN_FLOW_ID={flow_id}")
    else:
        print(f"\n✅ Flow saved as DRAFT. Copy this into .env:")
        print(f"   ASSESSMENT_GEN_FLOW_ID={flow_id}")
        print(f"   Then re-run with --publish, or publish via the Meta dashboard.")
        print(f"\n   To test the DRAFT: add your tester phone number as a WhatsApp Flow tester")
        print(f"   in the Meta Business Manager under Flow {flow_id}, then trigger `/assessment`.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
