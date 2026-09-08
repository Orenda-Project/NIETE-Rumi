#!/usr/bin/env python3
"""niete_sandbox_driver — the writes must survive the sandbox's lagging record_history sequence.

The shared sandbox has a trigger on `users` that inserts into `record_history`, whose id sequence
lags the table (bd-xje1k): the first write collides on the primary key with `23505 record_history_pkey`.
Every failed insert still consumes one sequence value, so a BOUNDED retry walks the sequence past the
occupied ids and the write lands. Anything else — another constraint, another status — aborts at once.
Red-first: fails on develop — _req exits on the first 409.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import niete_sandbox_driver as d   # noqa: E402

RH = '{"code":"23505","message":"duplicate key value violates unique constraint \\"record_history_pkey\\""}'
OTHER = '{"code":"23505","message":"duplicate key value violates unique constraint \\"users_phone_number_key\\""}'


class _A:
    def __init__(self, phone="923000000001", yes=True):
        self.phone, self.yes_write = phone, yes


def _stub(collisions, body=RH):
    calls = []
    def fake(creds, method, path, payload=None, prefer=None):
        calls.append((method, path))
        if method == "GET":
            return [] if "quiz_sessions" in path else [{"id": "u1", "phone_number": "923000000001",
                                                        "first_name": None, "registration_completed": False,
                                                        "conversation_state": "x"}]
        n = sum(1 for m, _ in calls if m == "PATCH")
        if n <= collisions:
            raise d.SupabaseHttpError(method, path, 409, body)
        return None
    return fake, calls


def _patches(calls):
    return sum(1 for m, _ in calls if m == "PATCH")


def test_ensure_walks_the_lagging_sequence_past_the_occupied_ids():
    fake, calls = _stub(collisions=25)
    d._req = fake
    assert d.cmd_ensure(("u", "k"), _A()) == 0
    assert _patches(calls) == 26          # 25 collisions burned, the 26th landed


def test_ensure_gives_up_after_a_bounded_number_of_collisions():
    fake, calls = _stub(collisions=10_000)
    d._req = fake
    try:
        d.cmd_ensure(("u", "k"), _A()); assert False, "expected SystemExit"
    except SystemExit as e:
        assert "record_history" in str(e)
    assert _patches(calls) == d.RECORD_HISTORY_RETRIES


def test_any_other_conflict_aborts_on_the_first_attempt():
    fake, calls = _stub(collisions=10_000, body=OTHER)
    d._req = fake
    try:
        d.cmd_ensure(("u", "k"), _A()); assert False, "expected SystemExit"
    except SystemExit as e:
        assert "users_phone_number_key" in str(e)
    assert _patches(calls) == 1


def test_reset_state_uses_the_same_resilient_writer():
    fake, calls = _stub(collisions=2)
    d._req = fake
    assert d.cmd_reset_state(("u", "k"), _A()) == 0
    assert _patches(calls) == 3


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print("ok   " + name)
            except BaseException as e:      # SystemExit from an un-retried write is a failure too
                fails += 1; print("FAIL " + name + ": " + repr(e))
    print("%d test(s), %d failed" % (len([n for n in globals() if n.startswith("test_")]), fails))
    sys.exit(1 if fails else 0)
