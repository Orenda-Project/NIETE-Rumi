#!/usr/bin/env python3
"""mock_driver.py — the mock lane's synthetic driver number, PER MACHINE.

    python3 .claude/qa/engine/bin/mock_driver.py            → 92300XXXXXXX (12 digits)
    python3 .claude/qa/engine/bin/mock_driver.py --explain  → the number + the machine key it came from

The mock lane has no WhatsApp number: its "teacher" is a synthetic phone that exists only as a row in
the E2E DB, which the repo's sandbox_driver tenant tool (tenants.yaml) creates on first use. Until 2026-09-18 every
machine used the same fixed 923000000001. The run lock (driver_lock.py) is a local file, so two
machines could not see each other and drove the same row at once — seeds and reads interleaved
(bd-yj4e4). Deriving the number from the machine gives each machine its own row with zero
configuration; nothing is shared between machines but the content.

Resolution order:
  1. E2E_MOCK_DRIVER      — a pinned number (digits only), e.g. one shared CI box. Refused if not digits.
  2. sha256("<hostname>|<user>") → 7 digits mapped into 1000000..9999999, prefixed 92300.
     E2E_MOCK_DRIVER_MACHINE overrides the "<hostname>|<user>" key (tests).
The 92300 prefix is a range no Pakistani subscriber has; the suffix can never be 0000001, so the
legacy shared number is never produced by derivation.
"""
import getpass, hashlib, os, socket, sys

LEGACY = "923000000001"
PREFIX = "92300"


def machine_key(tenant=None):
    forced = os.environ.get("E2E_MOCK_DRIVER_MACHINE")
    if forced:
        return forced if not tenant else "%s|%s" % (forced, tenant)
    try:
        user = getpass.getuser()
    except Exception:
        user = os.environ.get("USER") or os.environ.get("USERNAME") or "user"
    key = "%s|%s" % (socket.gethostname(), user)
    # A multi-tenant repo (run-suite passes --tenant there) needs one row PER TENANT per machine.
    return key if not tenant else "%s|%s" % (key, tenant)


def derive(key):
    h = int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16)
    suffix = 1000000 + (h % 9000000)          # 1000000..9999999 — never the legacy 0000001
    return PREFIX + str(suffix)


def resolve(tenant=None):
    pinned = os.environ.get("E2E_MOCK_DRIVER")
    if pinned is not None and pinned != "":
        if not pinned.isdigit():
            sys.stderr.write("E2E_MOCK_DRIVER must be digits only (got %r)\n" % pinned)
            sys.exit(2)
        return pinned, "E2E_MOCK_DRIVER (pinned)"
    key = machine_key(tenant)
    return derive(key), key


def main(argv):
    tenant = argv[argv.index("--tenant") + 1] if "--tenant" in argv and argv.index("--tenant") + 1 < len(argv) else None
    number, source = resolve(tenant)
    if "--explain" in argv:
        print("%s  ← %s" % (number, source))
    else:
        print(number)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
