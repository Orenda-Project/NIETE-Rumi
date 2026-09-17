#!/usr/bin/env python3
"""Clear stuck TEST coaching sessions on the driver before an E2E run (2026-09-02).

WHY. A coaching session left non-terminal (initiated / awaiting_classroom_photo / transcribing …)
makes the bot DEFER the next classroom upload, so COA04 blocks and the DEEP pipeline never runs; its
late messages then land mid-run and other features' reply detection takes them as answers. The
/status Flow offers a "Stop" row for observation items only — a coaching session has no product
exit — so this is the only way to start a run with nothing in flight. Driver account only; every
write is gated behind --yes-write and the env/project-ref guard from niete_training_db.

  python3 niete_coaching_db.py list           --env staging --phone 923…
  python3 niete_coaching_db.py cancel-stuck    --env staging --phone 923… [--yes-write]
  python3 niete_coaching_db.py reset-history   --env staging --phone 923… [--yes-write]
  python3 niete_coaching_db.py reset-first-use --env staging --phone 923… [--yes-write]

reset-history archives the driver's COMPLETED coaching sessions (status completed → archived) so the
analysis prompt no longer embeds a growing "N prior coaching sessions" block. That block is what
makes each run's LLM request unique and defeats the e2e cassette; with 0 prior sessions the prompt is
identical every run and the cassette (E2E_CASSETTE=replay) HITS the analysis calls. Reversible — the
prior-feedback query filters on status='completed', so archived rows simply drop out; flip back with
status='completed' if ever needed. Test driver on the staging DB only.

reset-first-use deletes the driver's user_feature_first_use row for feature='coaching' so the bot
treats the next coaching interaction as the teacher's FIRST EVER use — which is the only time the
FeatureIntroService intro offer + "Just tell me" button appear (feature-intro.service.js /
feature-keyword-detector.service.js). Without it, COA02 ("Declining the intro asks for the class
audio") can never run on an already-used driver: the intro simply doesn't fire. FeatureIntroService
re-creates the row on the next use, so this is self-healing. Test driver on the staging DB only.
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from niete_training_db import _creds, _req, _get  # noqa: E402

TERMINAL = ("completed", "failed", "cancelled", "abandoned")


def _user_id(creds, phone):
    rows = _get(creds, "users", "phone_number=eq.%s&select=id" % phone)
    if not rows: sys.exit("no user with phone_number=%s on this DB" % phone)
    return rows[0]["id"]


def sessions(creds, uid, limit=15):
    return _get(creds, "coaching_sessions",
                "user_id=eq.%s&select=id,status,created_at,updated_at&order=created_at.desc&limit=%d" % (uid, limit))



def _clear_history_cache(base_url, uid):
    """POST {base}/clear-history/{uid} — clears openai.service's PROCESS-LEVEL conversationHistory Map.
    getConversationHistory is cache-first (openai.service.js:28-66): the DB is read only on a cache
    miss, so while the bot process is up, deleting DB rows alone leaves the stale turns replaying from
    memory. This is the half the DB delete cannot reach; both are needed for a deterministic reset."""
    import urllib.request
    url = "%s/clear-history/%s" % (base_url.rstrip("/"), uid)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=b"", method="POST"), timeout=10) as r:
            r.read()
        print("cleared in-memory history cache: %s" % url)
    except Exception as e:  # never fatal — a QA reset must not break the run
        print("WARN: in-memory history-cache clear failed (%s): %s" % (url, e))


def reset_conversations(creds, uid, yes_write=False, clear_cache_url=None):
    """Reset the driver's conversation history so the conversational voice/text reply LLM prompt starts
    from a fixed baseline. Two independent stores must be cleared (they are written by separate paths):
    the `conversations` DB rows (openai.service loads the last 10 as `existingHistory`) AND the bot's
    in-process history cache (the singleton Map). That history accumulates across scenarios/runs and,
    like prior-feedback, makes the LLM request — and the TTS it feeds — unique every run, defeating the
    e2e cassette. Pass --clear-cache-url to also clear the live process. Sandbox/staging DB only."""
    rows = _get(creds, "conversations", "user_id=eq.%s&select=id" % uid) or []
    if not yes_write:
        print("would delete %d conversation row(s)%s" % (len(rows), " + clear in-memory cache" if clear_cache_url else ""))
        print("dry run — re-run with --yes-write"); return
    if rows:
        _req("DELETE", "/rest/v1/conversations?user_id=eq.%s" % uid, creds, prefer="return=minimal")
    left = _get(creds, "conversations", "user_id=eq.%s&select=id" % uid) or []
    print("deleted; conversation rows now: %d" % len(left))
    if clear_cache_url:
        _clear_history_cache(clear_cache_url, uid)
    if left: sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("list", "cancel-stuck", "reset-history", "reset-first-use", "reset-conversations"):
        p = sub.add_parser(c); p.add_argument("--env"); p.add_argument("--phone", required=True)
        if c in ("cancel-stuck", "reset-history", "reset-first-use", "reset-conversations"): p.add_argument("--yes-write", action="store_true")
        if c == "reset-conversations": p.add_argument("--clear-cache-url", help="bot base URL; also POSTs /clear-history/<uid> to clear the in-process history Map")
    a = ap.parse_args()
    creds = _creds(a.env)
    uid = _user_id(creds, a.phone)
    rows = sessions(creds, uid)
    stuck = [r for r in rows if r.get("status") not in TERMINAL]
    if a.cmd == "list":
        for r in rows: print(r["created_at"][:19], r["id"][:8], r.get("status"))
        print("%d non-terminal" % len(stuck)); return
    if a.cmd == "reset-history":
        done = _get(creds, "coaching_sessions", "user_id=eq.%s&status=eq.completed&select=id" % uid) or []
        if not done: print("no completed sessions for %s — prior-feedback block is already empty" % a.phone); return
        print(("would archive" if not a.yes_write else "archiving") + " %d completed session(s) → 'archived'" % len(done))
        if not a.yes_write: print("dry run — re-run with --yes-write"); return
        _req("PATCH", "/rest/v1/coaching_sessions?user_id=eq.%s&status=eq.completed" % uid, creds,
             body={"status": "archived"}, prefer="return=minimal")
        left = _get(creds, "coaching_sessions", "user_id=eq.%s&status=eq.completed&select=id" % uid) or []
        print("archived; completed sessions now: %d" % len(left))
        if left: sys.exit(1)
        return
    if a.cmd == "reset-first-use":
        seen = _get(creds, "user_feature_first_use",
                    "user_id=eq.%s&feature=eq.coaching&select=feature,feature_used_at" % uid) or []
        if not seen:
            print("no coaching first-use row for %s — intro will already fire on next use" % a.phone); return
        print(("would delete" if not a.yes_write else "deleting") + " coaching first-use row (used_at=%s)" % seen[0].get("feature_used_at"))
        if not a.yes_write: print("dry run — re-run with --yes-write"); return
        _req("DELETE", "/rest/v1/user_feature_first_use?user_id=eq.%s&feature=eq.coaching" % uid, creds,
             prefer="return=minimal")
        left = _get(creds, "user_feature_first_use", "user_id=eq.%s&feature=eq.coaching&select=feature" % uid) or []
        print("deleted; coaching first-use rows now: %d" % len(left))
        if left: sys.exit(1)
        return

    if a.cmd == "reset-conversations":
        reset_conversations(creds, uid, a.yes_write, getattr(a, "clear_cache_url", None)); return

    if not stuck: print("nothing in flight for %s" % a.phone); return
    for r in stuck: print("would cancel" if not a.yes_write else "cancelling", r["id"][:8], r.get("status"), r["created_at"][:19])
    if not a.yes_write: print("dry run — re-run with --yes-write"); return
    for r in stuck:
        _req("PATCH", "/rest/v1/coaching_sessions?id=eq.%s&user_id=eq.%s" % (r["id"], uid), creds,
             body={"status": "cancelled"}, prefer="return=minimal")
    left = [r for r in sessions(creds, uid) if r.get("status") not in TERMINAL]
    print("cancelled %d; %d still non-terminal" % (len(stuck), len(left)))
    if left: sys.exit(1)


if __name__ == "__main__":
    main()
