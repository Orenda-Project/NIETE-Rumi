#!/usr/bin/env python3
"""Stdlib assert tests for niete_registration_db (bd-2768).
Run: python3 test_niete_registration_db.py

Why this tool exists: 12 of registration.feature's 19 scenarios were BLOCKED because the
driver is already registered and the harness had no way to un-register it. Everything that
needs the Flow to OPEN needs first_name cleared — text-message.handler.js:1650 gates on that
field alone. Seeding it makes the whole file runnable on any account, reversibly.
"""
import niete_registration_db as r


def test_reuses_the_training_tool_env_guard():
    """Must NOT re-implement creds resolution — bd-2759's wrong-DB abort has to apply here too."""
    import niete_training_db as t
    assert r._creds is t._creds, "creds resolution must be imported, not duplicated"
    assert r.ENV_REFS is t.ENV_REFS


def test_registration_fields_cover_the_gate_and_the_flow_writes():
    f = set(r.REGISTRATION_FIELDS)
    # the gate itself (text-message.handler.js:1650)
    assert "first_name" in f
    # what the Flow writes back
    for col in ("name", "country", "organization", "school_name", "role",
                "registration_completed", "registration_state"):
        assert col in f, col


def test_language_is_opt_in_not_default():
    """Clearing preferred_language on every unregister would silently undo a teacher's
    language choice — it belongs behind an explicit flag."""
    assert "preferred_language" not in r.REGISTRATION_FIELDS
    assert "preferred_language" in r.LANGUAGE_FIELDS
    assert "language_locked" in r.LANGUAGE_FIELDS


def test_portal_credentials_are_never_touched():
    """portal_password_hash / invite token are real credentials and a live portal session."""
    every = set(r.REGISTRATION_FIELDS) | set(r.LANGUAGE_FIELDS)
    for col in ("portal_password_hash", "portal_invite_token", "portal_activated",
                "portal_last_login", "portal_invite_expires_at", "id", "phone_number"):
        assert col not in every, "%s must never be cleared" % col


def test_unregister_payload_clears_the_gate_and_flags():
    p = r.build_unregister_payload(include_language=False)
    assert p["first_name"] is None
    assert p["registration_completed"] is False
    assert p["registration_state"] == "unregistered"
    assert "preferred_language" not in p


def test_unregister_payload_with_language_clears_language_too():
    p = r.build_unregister_payload(include_language=True)
    assert p["first_name"] is None
    assert "preferred_language" in p and p["preferred_language"] is None
    assert p["language_locked"] is False


def test_restore_payload_round_trips_a_snapshot():
    snap = {"first_name": "Mah noor", "name": "Mah noor", "registration_completed": True,
            "registration_state": "unregistered", "role": "teacher", "portal_activated": True}
    p = r.build_restore_payload(snap)
    assert p["first_name"] == "Mah noor"
    assert p["registration_completed"] is True
    assert "portal_activated" not in p, "restore must not write back untouched columns"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn(); print("PASS", fn.__name__)
        except Exception as e:
            failed += 1; print("FAIL", fn.__name__, "->", type(e).__name__, e)
    print("\n%d/%d passed" % (len(fns) - failed, len(fns)))
    raise SystemExit(1 if failed else 0)
