#!/usr/bin/env python3
"""Reversible registration-state seeding for registration.feature (bd-2768).

WHY: 12 of the 19 @e2e scenarios in registration.feature were BLOCKED on the /niete-e2e all
run of 2026-08-18 — not by bugs, but because the driver is already registered and nothing
could un-register it. `/register` gates on `user.first_name` ALONE
(text-message.handler.js:1650), so clearing that one column re-opens the whole onboarding
Flow. Snapshot -> unregister -> drive the file -> restore makes registration runnable on any
account, including a personal one, without a throwaway number.

Creds/env resolution is IMPORTED from niete_training_db, so the bd-2759 wrong-DB abort
(refuses to run when --env disagrees with the resolved Supabase project) applies here too.
Never duplicate that guard.

Usage (run from repo root):
  python .claude/qa/shared/niete_registration_db.py snapshot   --env staging --phone P
  python .claude/qa/shared/niete_registration_db.py unregister --env staging --phone P [--include-language] --yes-write
  python .claude/qa/shared/niete_registration_db.py restore    --env staging --phone P [--from FILE] --yes-write

`unregister` ALWAYS writes a snapshot first and prints the exact restore command. WRITES are
gated behind --yes-write; a dry run prints the intended change and exits.
"""
import argparse, json, os, sys, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from niete_training_db import _creds, _req, _get, ENV_REFS, _project_ref  # noqa: E402

# Everything the onboarding Flow writes, plus the gate. Cleared by `unregister`.
REGISTRATION_FIELDS = [
    "first_name", "last_name", "name",
    "country", "region",
    "organization", "school_name", "school_id",
    "grade", "grades_taught", "subject", "subjects_taught",
    "role",
    "registration_completed", "registration_completed_at",
    "registration_state", "registration_state_updated_at",
    "registration_pending_name", "registration_started_at",
]

# Opt-in only (--include-language). Clearing these silently undoes a teacher's language
# choice, which is its own class of bug (see the language audit), so it is never default.
LANGUAGE_FIELDS = ["preferred_language", "language_locked"]

# Deliberately NOT listed anywhere above: portal_password_hash, portal_invite_token,
# portal_invite_expires_at, portal_activated, portal_last_login, id, phone_number.
# Those are live credentials / identity, not registration state.

SNAP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "results", "_registration-snapshots")


def build_unregister_payload(include_language=False):
    """The reset. first_name=None is the load-bearing part — it is the gate."""
    p = {f: None for f in REGISTRATION_FIELDS}
    p["registration_completed"] = False
    p["registration_pending_name"] = False
    p["registration_state"] = "unregistered"
    p["grades_taught"] = ""
    p["subjects_taught"] = []
    p["country"] = ""
    if include_language:
        p["preferred_language"] = None
        p["language_locked"] = False
    return p


def build_restore_payload(snapshot):
    """Write back ONLY the columns we cleared — never anything else the snapshot happens
    to carry."""
    allowed = set(REGISTRATION_FIELDS) | set(LANGUAGE_FIELDS)
    return {k: v for k, v in snapshot.items() if k in allowed}


def _snap_path(phone, env):
    return os.path.abspath(os.path.join(SNAP_DIR, "%s-%s.json" % (phone, env)))


def _fetch(creds, phone):
    cols = ",".join(REGISTRATION_FIELDS + LANGUAGE_FIELDS + ["id"])
    rows = _get(creds, "users", "phone_number=eq.%s&select=%s" % (phone, cols))
    if not rows:
        sys.exit("no user for phone %s" % phone)
    return rows[0]


def cmd_snapshot(creds, a):
    row = _fetch(creds, a.phone)
    os.makedirs(SNAP_DIR, exist_ok=True)
    path = a.out or _snap_path(a.phone, a.env or "staging")
    row["_captured_at"] = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(row, fh, indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in row.items() if k != "id"}, indent=1, ensure_ascii=False))
    print("\nsnapshot written: %s" % path, file=sys.stderr)


def cmd_unregister(creds, a):
    row = _fetch(creds, a.phone)
    payload = build_unregister_payload(a.include_language)
    if not a.yes_write:
        print("DRY-RUN: would clear %d registration columns for %s (first_name %r -> None)."
              % (len(payload), a.phone, row.get("first_name")))
        print("Language columns %s." % ("INCLUDED" if a.include_language else "left untouched"))
        print("Re-run with --yes-write. A snapshot is taken automatically and restore is one command.")
        return
    os.makedirs(SNAP_DIR, exist_ok=True)
    path = _snap_path(a.phone, a.env or "staging")
    row["_captured_at"] = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(row, fh, indent=1, ensure_ascii=False)
    _req("PATCH", "/rest/v1/users?phone_number=eq.%s" % a.phone, creds,
         body=payload, prefer="return=minimal")
    print("UNREGISTERED %s — first_name cleared, so /register now opens the Flow." % a.phone)
    print("snapshot: %s" % path)
    print("RESTORE WITH:\n  python .claude/qa/shared/niete_registration_db.py restore "
          "--env %s --phone %s --yes-write" % (a.env or "staging", a.phone))


def cmd_restore(creds, a):
    path = a.from_file or _snap_path(a.phone, a.env or "staging")
    if not os.path.isfile(path):
        sys.exit("no snapshot at %s — cannot restore. Pass --from <file>." % path)
    snap = json.load(open(path, encoding="utf-8"))
    payload = build_restore_payload(snap)
    if not a.yes_write:
        print("DRY-RUN: would restore %d columns for %s from %s (first_name -> %r)."
              % (len(payload), a.phone, path, payload.get("first_name")))
        print("Re-run with --yes-write.")
        return
    _req("PATCH", "/rest/v1/users?phone_number=eq.%s" % a.phone, creds,
         body=payload, prefer="return=minimal")
    print("RESTORED %s from %s (first_name -> %r)." % (a.phone, path, payload.get("first_name")))


def main():
    p = argparse.ArgumentParser(description="NIETE registration-state seeding (reads free; writes gated by --yes-write).")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--env", choices=sorted(ENV_REFS),
                        help="which NIETE Supabase (default: the env of whatsapp-targets.yaml default_profile)")
    common.add_argument("--phone", required=True, help="driver phone, digits, no + (resolved at runtime; never hardcode)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("snapshot", parents=[common]); sp.add_argument("--out")
    un = sub.add_parser("unregister", parents=[common])
    un.add_argument("--include-language", action="store_true", dest="include_language")
    un.add_argument("--yes-write", action="store_true")
    rs = sub.add_parser("restore", parents=[common])
    rs.add_argument("--from", dest="from_file")
    rs.add_argument("--yes-write", action="store_true")
    a = p.parse_args()
    creds = _creds(getattr(a, "env", None))
    {"snapshot": cmd_snapshot, "unregister": cmd_unregister, "restore": cmd_restore}[a.cmd](creds, a)


if __name__ == "__main__":
    main()
