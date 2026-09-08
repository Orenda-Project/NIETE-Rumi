#!/usr/bin/env python3
"""
Put ONE screen of a Flow on a phone, with the exact payload that is failing.

    python3 scripts/flow-probe.py docs/flows/assessment-review-flow.json KEEP \
        --data payload.json --to 9233XXXXXXX --env prod
    python3 scripts/flow-probe.py --deprecate 1577908044032259 --env prod

Why this exists. A WhatsApp Flow that renders and then dies with "Something went
wrong" leaves NOTHING in our logs: the endpoint answered 200 with a well-formed
screen and the CLIENT refused it. On 6 Sep 2026 four fixes shipped off
server-side evidence for a screen whose only fault was its POSITION (it sat at
screens[6], reachable only from a terminal screen). The experiment that settled
it in fifteen minutes was this: publish the screen ALONE as a one-screen Flow,
send it with the captured payload, watch whether it renders. If it does, the
screen is innocent and the fault is where it sits. If it dies, bisect the screen.

Run this BEFORE changing code on any renders-then-dies Flow.

The probe Flow is static (navigate mode, data supplied at send time), so it needs
no endpoint. Published Flows cannot be deleted — deprecate afterwards.

Env: reads WHATSAPP_TOKEN, WABA_ID, WHATSAPP_PHONE_NUMBER_ID from the env file
for --env (prod: ./.env; staging: ./.env.staging if present, else prompts).
"""
from __future__ import annotations
import argparse, copy, json, re, sys, urllib.request, urllib.error, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GRAPH = "https://graph.facebook.com/v20.0"


def env_from(path: Path) -> dict:
    out = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def api(token: str, method: str, path: str, body=None, files=None):
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if files:
        b = f"----probe{uuid.uuid4().hex}"
        headers["Content-Type"] = f"multipart/form-data; boundary={b}"
        parts = []
        for k, v in (body or {}).items():
            parts.append(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
        for n, (fn, content, ct) in files.items():
            parts.append(f"--{b}\r\nContent-Disposition: form-data; name=\"{n}\"; filename=\"{fn}\"\r\nContent-Type: {ct}\r\n\r\n".encode())
            parts.append(content); parts.append(b"\r\n")
        parts.append(f"--{b}--\r\n".encode())
        data = b"".join(parts)
    elif body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(f"{GRAPH}/{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"__err": e.read().decode()[:600]}


def isolate(flow: dict, screen_id: str) -> tuple[dict, list[str]]:
    """The named screen, alone, as a terminal screens[0]. Returns (probe, notes)."""
    scr = next((s for s in flow["screens"] if s["id"] == screen_id), None)
    if not scr:
        sys.exit(f"no screen {screen_id!r} in flow; have {[s['id'] for s in flow['screens']]}")
    scr = copy.deepcopy(scr)
    scr["terminal"] = True
    notes = []

    def fix_actions(o):
        if isinstance(o, dict):
            a = o.get("on-click-action")
            if isinstance(a, dict) and a.get("name") in ("data_exchange", "navigate"):
                if o.get("type") == "Footer":
                    o["on-click-action"] = {"name": "complete", "payload": {}}
                    notes.append(f"Footer '{o.get('label')}' → complete")
                else:
                    # EmbeddedLink / NavigationList rows cannot `complete`; drop the
                    # action so the component still renders.
                    o.pop("on-click-action", None)
                    notes.append(f"{o.get('type')} action dropped (cannot complete)")
            for v in o.values():
                fix_actions(v)
        elif isinstance(o, list):
            for v in o:
                fix_actions(v)

    fix_actions(scr)
    # NavigationList rows carry their own on-click-action inside DATA, not the JSON;
    # nothing to strip here for those.
    blob = json.dumps(scr, ensure_ascii=False)
    used = set(re.findall(r"\$\{data\.([A-Za-z_][A-Za-z0-9_]*)\}", blob))
    declared = scr.get("data") or {}
    dropped = [k for k in declared if k not in used]
    scr["data"] = {k: v for k, v in declared.items() if k in used}
    if dropped:
        notes.append(f"unreferenced data keys dropped: {dropped}")
    probe = {"version": flow.get("version", "7.0"), "screens": [scr]}
    return probe, notes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("flow_json", nargs="?", help="path to the Flow JSON")
    ap.add_argument("screen", nargs="?", help="screen id to isolate")
    ap.add_argument("--data", help="JSON file: the payload the endpoint sends for this screen")
    ap.add_argument("--to", help="recipient phone, digits only (a tester number)")
    ap.add_argument("--env", choices=("prod", "staging"), default="staging")
    ap.add_argument("--env-file", help="override the env file")
    ap.add_argument("--deprecate", metavar="FLOW_ID", help="deprecate a probe Flow and exit")
    ap.add_argument("--keep", action="store_true", help="do not print the deprecate reminder")
    args = ap.parse_args()

    env_path = Path(args.env_file) if args.env_file else (REPO / (".env" if args.env == "prod" else ".env.staging"))
    env = env_from(env_path)
    token = env.get("WHATSAPP_TOKEN")
    waba = env.get("WABA_ID")
    phone_id = env.get("WHATSAPP_PHONE_NUMBER_ID")
    if not token or not waba:
        sys.exit(f"WHATSAPP_TOKEN / WABA_ID missing in {env_path}")

    if args.deprecate:
        print(api(token, "POST", f"{args.deprecate}/deprecate", {}))
        return 0

    if not (args.flow_json and args.screen and args.data and args.to):
        ap.error("flow_json, screen, --data and --to are required (or --deprecate)")

    flow = json.loads(Path(args.flow_json).read_text())
    data = json.loads(Path(args.data).read_text())
    probe, notes = isolate(flow, args.screen)
    for n in notes:
        print("  note:", n)
    payload_data = {k: data[k] for k in probe["screens"][0].get("data", {}) if k in data}
    missing = [k for k in probe["screens"][0].get("data", {}) if k not in data]
    if missing:
        sys.exit(f"payload lacks declared keys {missing} — this alone would kill the render")

    name = f"probe-{args.screen.lower()}-{uuid.uuid4().hex[:6]}"
    created = api(token, "POST", f"{waba}/flows", {"name": name, "categories": ["OTHER"]})
    fid = created.get("id")
    if not fid:
        sys.exit(f"create failed: {created}")
    print(f"probe flow {fid} ({name})")

    up = api(token, "POST", f"{fid}/assets", {"name": "flow.json", "asset_type": "FLOW_JSON"},
             {"file": ("flow.json", json.dumps(probe, ensure_ascii=False).encode(), "application/json")})
    errs = up.get("validation_errors", up)
    print("upload validation:", json.dumps(errs, ensure_ascii=False)[:800])
    if errs:
        print("→ upload-tier refusal. Fix the JSON; no need to send.")
        api(token, "DELETE", fid)
        return 2

    pub = api(token, "POST", f"{fid}/publish", {})
    print("publish:", pub)
    if not pub.get("success"):
        api(token, "DELETE", fid)
        return 2

    if not phone_id:
        sys.exit("WHATSAPP_PHONE_NUMBER_ID missing — cannot send")
    msg = {
        "messaging_product": "whatsapp", "recipient_type": "individual", "to": args.to,
        "type": "interactive",
        "interactive": {"type": "flow",
            "header": {"type": "text", "text": f"PROBE — {args.screen} alone"},
            "body": {"text": "Diagnostic only. Tap Open: does this screen render, or say Something went wrong?"},
            "action": {"name": "flow", "parameters": {
                "flow_message_version": "3", "flow_token": f"probe-{args.screen.lower()}",
                "flow_id": fid, "flow_cta": "Open probe", "flow_action": "navigate",
                "flow_action_payload": {"screen": args.screen, "data": payload_data}}}}}
    sent = api(token, "POST", f"{phone_id}/messages", msg)
    print("sent:", json.dumps(sent)[:300])
    if not args.keep:
        print(f"\nWhen done:  python3 scripts/flow-probe.py --deprecate {fid} --env {args.env}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
