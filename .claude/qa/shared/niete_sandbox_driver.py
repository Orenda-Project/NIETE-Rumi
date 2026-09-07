#!/usr/bin/env python3
"""niete_sandbox_driver.py — the synthetic driver account for the local mock E2E lane.

The mock lane has no WhatsApp number: the "teacher" is a fixed synthetic phone that exists only
in the SANDBOX database (keys/niete-sandbox.env). This tool makes that row exist, registered, and
puts it back to a clean conversational state between features — the job reset-state.cjs does
through the /status Flow on the chrome lane, which the mock cannot render.

    niete_sandbox_driver.py ensure       --phone 923000000001 [--yes-write]
    niete_sandbox_driver.py reset-state  --phone 923000000001 [--yes-write]
    niete_sandbox_driver.py lookup       --phone 923000000001

Creds resolve through niete_training_db._creds("sandbox"), which ABORTS unless the project ref is
the sandbox — this tool can never touch staging or prod. Dry-run without --yes-write.
"""
import argparse, json, sys, os, urllib.request, urllib.error, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import niete_training_db as t   # noqa: E402

ENV = "sandbox"


def _req(creds, method, path, body=None, prefer=None):
    url, key = creds
    hdrs = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if prefer:
        hdrs["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url.rstrip("/") + "/rest/v1/" + path, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit("supabase %s %s -> %s %s" % (method, path, e.code, e.read().decode()[:300]))


def lookup(creds, phone):
    rows = _req(creds, "GET", "users?select=id,phone_number,first_name,registration_completed,registration_state,"
                              "preferred_language,language_locked,conversation_state,role,country&phone_number=eq." + phone)
    return rows[0] if rows else None


def cmd_lookup(creds, a):
    row = lookup(creds, a.phone)
    print("USER: " + json.dumps([row] if row else [], indent=1, ensure_ascii=False))
    return 0


def cmd_ensure(creds, a):
    row = lookup(creds, a.phone)
    want = {"phone_number": a.phone, "first_name": "E2E Driver", "registration_completed": True,
            "registration_state": "completed", "preferred_language": "en", "role": "teacher",
            "country": "Pakistan", "conversation_state": None}
    if row and row.get("registration_completed") and row.get("first_name"):
        print("driver %s exists and is registered (id %s)" % (a.phone, row["id"]))
        return 0
    if not a.yes_write:
        print("DRY RUN: would %s driver %s as a registered teacher (--yes-write to apply)" % ("update" if row else "insert", a.phone))
        return 0
    if row:
        _req(creds, "PATCH", "users?phone_number=eq." + a.phone, want, prefer="return=minimal")
        print("driver %s updated to registered" % a.phone)
    else:
        _req(creds, "POST", "users", want, prefer="return=minimal")
        print("driver %s inserted as a registered teacher" % a.phone)
    return 0


def cmd_reset_state(creds, a):
    row = lookup(creds, a.phone)
    if not row:
        sys.exit("no driver row for %s — run `ensure` first" % a.phone)
    if not a.yes_write:
        print("DRY RUN: would clear conversation_state (now %r) on %s" % (row.get("conversation_state"), a.phone))
        return 0
    _req(creds, "PATCH", "users?phone_number=eq." + a.phone,
         {"conversation_state": None, "conversation_state_expires_at": None}, prefer="return=minimal")
    print("driver %s: conversation_state cleared (was %r)" % (a.phone, row.get("conversation_state")))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("lookup", "ensure", "reset-state"):
        sp = sub.add_parser(name)
        sp.add_argument("--phone", required=True)
        sp.add_argument("--yes-write", action="store_true")
    a = p.parse_args(argv)
    creds = t._creds(ENV)
    return {"lookup": cmd_lookup, "ensure": cmd_ensure, "reset-state": cmd_reset_state}[a.cmd](creds, a)


if __name__ == "__main__":
    sys.exit(main())
