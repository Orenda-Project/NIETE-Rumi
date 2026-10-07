#!/usr/bin/env python3
"""Red-first (bd-yjyn0): reset-conversations must DELETE the driver's `conversations` rows so the
conversational voice/text-reply LLM prompt (openai.service loads the last 10 from `conversations`)
is deterministic run-to-run and its cassette (and the TTS it feeds) HITS under replay-strict."""
import os, sys, unittest.mock as m
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import niete_coaching_db as mod

def run():
    calls = []
    def fake_req(method, path, creds, body=None, prefer=None):
        calls.append((method, path)); return None
    def fake_get(creds, table, q):
        # first call: count before delete (2 rows); after delete: 0
        return [] if any(c[0] == "DELETE" for c in calls) else [{"id": "a"}, {"id": "b"}]
    with m.patch.object(mod, "_req", fake_req), m.patch.object(mod, "_get", fake_get):
        mod.reset_conversations({"url": "u", "key": "k"}, "UID-123", yes_write=True)
    deletes = [p for meth, p in calls if meth == "DELETE"]
    assert deletes, "reset_conversations issued no DELETE"
    assert any("conversations" in p and "user_id=eq.UID-123" in p for p in deletes), \
        "DELETE did not target conversations for the user: %r" % deletes
    print("PASS reset_conversations targets conversations for the driver")

def run_lp_context():
    """The open-chat prompt also carries her recent lessons (lp-context.service: the in-run Redis shelf,
    else niete_lp_downloads over 7 days). Those follow whatever this driver was sent on earlier runs and
    age out after a week, so the cassette key drifted per driver and per week. clear_lp_context resets
    both: the downloads rows and the shelf key."""
    calls, redis = [], []
    def fake_req(method, path, creds, body=None, prefer=None):
        calls.append((method, path)); return None
    def fake_get(creds, table, q):
        return [] if any(c[0] == "DELETE" for c in calls) else [{"id": "a"}]
    with m.patch.object(mod, "_req", fake_req), m.patch.object(mod, "_get", fake_get), \
         m.patch.object(mod, "_redis_del", lambda port, key: redis.append((port, key))):
        mod.reset_conversations({"url": "u", "key": "k"}, "UID-9", yes_write=True, clear_lp_context=True, redis_port=6397)
    deletes = [p for meth, p in calls if meth == "DELETE"]
    assert any("niete_lp_downloads" in p and "user_id=eq.UID-9" in p for p in deletes), deletes
    assert redis == [(6397, "lp_shelf:UID-9")], redis
    print("PASS reset_conversations clears the recent-lesson context (downloads + shelf)")

if __name__ == "__main__":
    run()
    run_lp_context()
