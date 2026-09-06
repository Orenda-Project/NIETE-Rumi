#!/usr/bin/env python3
"""
Publish the Transcript Quiz Flow JSON (`docs/flows/transcript-quiz-flow.json`)
to Meta's WhatsApp Business Cloud API.

This is the `/quiz` menu as ONE Flow: the lesson list, its in-Flow paging, the
lesson screen with the live per-student results, and the terminal screen. It is
an ENDPOINT Flow (data_api_version 3.0), so `--endpoint-uri` is REQUIRED and has
no default — a wrong default here would point a WABA's Flow at another
deployment's bot, and Meta probes that URL before it will publish.

Shape copied from `publish-assessment-gen-flow.py` (endpoint Flow: create with
`endpoint_uri`, upload the FLOW_JSON asset, publish) with two additions carried
over from `publish-quiz-multi-flow.py`:
  * repo-only top-level keys beginning `_` are stripped before upload — Meta's
    validator answers INVALID_PROPERTY_KEY on them and then refuses the publish;
  * an upload that reports `validation_errors` STOPS here instead of failing
    later at publish with a message that does not name them.

ORDER MATTERS: Meta calls the endpoint's health check during `--publish`, so the
code that serves `/api/flows/transcript-quiz` must be DEPLOYED first. Uploading
the asset (no `--publish`) needs no endpoint and is the way to get the
validator's verdict on the JSON before anything is deployed.

Env vars (read from this repo's `.env`):
  - WHATSAPP_TOKEN   token with `whatsapp_business_management` scope
  - WABA_ID          the WhatsApp Business Account the Flow is created on

Usage:
  # validate the JSON against Meta without publishing anything
  python3 scripts/publish-transcript-quiz-flow.py --dry-run
  python3 scripts/publish-transcript-quiz-flow.py --endpoint-uri https://<bot-host>/api/flows/transcript-quiz
  # ...then, once that host serves the endpoint:
  python3 scripts/publish-transcript-quiz-flow.py --endpoint-uri https://<bot-host>/api/flows/transcript-quiz \
      --flow-id <id> --publish

Set the published id as TRANSCRIPT_QUIZ_FLOW_ID on the bot service. Leaving it
unset is the rollback lever: `/quiz` falls back to the interactive list message.
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"
FLOW_JSON = REPO / "docs" / "flows" / "transcript-quiz-flow.json"


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
        raise SystemExit(f"Meta API {method} {path} failed: {e.code} {e.read().decode()[:800]}")


def load_flow_json() -> str:
    """The Flow JSON as Meta will receive it: repo-only `_`-prefixed top-level
    keys removed, everything else byte-for-byte."""
    doc = json.loads(FLOW_JSON.read_text())
    stripped = sorted(k for k in doc if k.startswith("_"))
    for k in stripped:
        doc.pop(k)
    out = json.dumps(doc, ensure_ascii=False, indent=2)
    print(f"Flow JSON: {len(out):,} bytes  ·  source: {FLOW_JSON}")
    if stripped:
        print(f"Stripped repo-only keys before upload: {', '.join(stripped)}")
    return out


def offline_checks(doc: dict) -> list[str]:
    """The rules Meta enforces that are cheap to check before spending a call.
    Returns a list of problems; empty means it is worth uploading."""
    problems = []
    order = [s["id"] for s in doc["screens"]]
    rm = doc.get("routing_model", {})
    if sorted(rm.keys()) != sorted(order):
        problems.append(f"routing_model keys {sorted(rm)} != screen ids {sorted(order)}")
    for frm, tos in rm.items():
        for to in tos:
            if to == frm:
                problems.append(f"routing_model self route {frm} -> {to} (INVALID_ROUTING_MODEL)")
            elif order.index(to) <= order.index(frm):
                problems.append(f"routing_model backward route {frm} -> {to} (INVALID_ROUTING_MODEL)")
    for screen in doc["screens"]:
        children = json.dumps(screen["layout"]["children"], ensure_ascii=False)
        if '"NavigationList"' in children:
            if screen.get("terminal"):
                problems.append(f"{screen['id']}: a NavigationList cannot sit on a terminal screen")
            if children.count('"NavigationList"') > 2:
                problems.append(f"{screen['id']}: more than 2 NavigationLists")
            for other in ("Dropdown", "RadioButtonsGroup", "CheckboxGroup", "Footer",
                          "TextInput", "TextArea", "TextHeading", "TextBody", "Form"):
                if f'"{other}"' in children:
                    problems.append(f"{screen['id']}: NavigationList cannot share a screen with {other}")
        ex = (screen.get("data") or {}).get("items", {}).get("__example__")
        if ex:
            if len(ex) > 20:
                problems.append(f"{screen['id']}: {len(ex)} example items (max 20)")
            for item in ex:
                mc = item.get("main-content", {})
                for field, cap in (("title", 30), ("description", 20), ("metadata", 80)):
                    v = mc.get(field)
                    if v is not None and len(v) > cap:
                        problems.append(f"{screen['id']}: item {field} is {len(v)} code points (max {cap})")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true",
                    help="Publish the Flow (default: leave it a DRAFT). Requires the endpoint to be live.")
    ap.add_argument("--flow-id", help="Update an existing Flow instead of creating a new one")
    ap.add_argument("--name", default="Transcript Quiz",
                    help="Flow name — must match the FLOW_CONFIGS entry so the registrar finds it by name")
    ap.add_argument("--endpoint-uri",
                    help="Public URL Meta calls for data_exchange. REQUIRED unless --dry-run. "
                         "There is deliberately no default: pointing a WABA at another deployment's bot "
                         "is not a mistake a default should be able to make.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Validate the JSON offline and print it. No Meta call, no .env needed.")
    args = ap.parse_args()

    doc = json.loads(FLOW_JSON.read_text())
    problems = offline_checks(doc)
    if problems:
        for p in problems:
            print(f"  ✖ {p}")
        raise SystemExit("Flow JSON failed the offline checks — nothing was sent to Meta.")
    print("Offline checks passed: routing forward-only, NavigationList screens clean, item caps within 30/20/80.")

    if args.dry_run:
        flow_json = load_flow_json()
        print(f"\n✅ Dry run only. {len(doc['screens'])} screens: {', '.join(s['id'] for s in doc['screens'])}")
        return 0

    if not args.endpoint_uri:
        print("ERROR: --endpoint-uri is required (or use --dry-run).", file=sys.stderr)
        return 2

    waba_id = env("WABA_ID")
    flow_json = load_flow_json()

    if args.flow_id:
        flow_id = args.flow_id
        print(f"Updating existing Flow: {flow_id}")
    else:
        create = api("POST", f"{waba_id}/flows",
                     body={"name": args.name, "categories": ["OTHER"], "endpoint_uri": args.endpoint_uri})
        flow_id = create["id"]
        print(f"Created Flow: {flow_id}")

    print(f"Setting endpoint_uri: {args.endpoint_uri}")
    api("POST", f"{flow_id}", body={"endpoint_uri": args.endpoint_uri})

    upload = api(
        "POST",
        f"{flow_id}/assets",
        body={"name": "flow.json", "asset_type": "FLOW_JSON"},
        files={"file": ("flow.json", flow_json.encode(), "application/json")},
    )
    print("flow.json uploaded:", upload)
    errors = upload.get("validation_errors") or []
    if errors:
        for e in errors:
            print(f"  ✖ {e.get('error')}: {e.get('message')}  {e.get('pointers') or ''}")
        raise SystemExit(f"Flow JSON did not validate — nothing was published. Flow id: {flow_id}")

    if args.publish:
        pub = api("POST", f"{flow_id}/publish", body={})
        print("Published:", pub)
        status = api("GET", f"{flow_id}?fields=id,name,status")
        print("Verified status:", status)
        print("\n✅ Flow published. Set this on the bot service (and only that service):")
        print(f"   TRANSCRIPT_QUIZ_FLOW_ID={flow_id}")
    else:
        status = api("GET", f"{flow_id}?fields=id,name,status")
        print("Verified status:", status)
        print("\n✅ Flow saved as DRAFT — the JSON validated.")
        print(f"   Flow id: {flow_id}")
        print("   Deploy the endpoint, then re-run with --flow-id <id> --publish.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
