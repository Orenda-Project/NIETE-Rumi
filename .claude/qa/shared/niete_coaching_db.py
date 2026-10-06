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
import argparse, os, sys, re
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


def _redis_del(port, key):
    """DEL one key on the run's private redis-server (local-stack: --save "" — per run, per slot)."""
    import subprocess
    try:
        subprocess.run(["redis-cli", "-p", str(port), "DEL", key], capture_output=True, timeout=10)
    except Exception:
        pass


def reset_conversations(creds, uid, yes_write=False, clear_cache_url=None, clear_lp_context=False, redis_port=None):
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
    if clear_lp_context:
        # Her recent lessons ride in the open-chat prompt too (lp-context.service: the Redis shelf, else
        # niete_lp_downloads over 7 days). They follow whatever this driver was sent on EARLIER runs and
        # age out after a week, so the prompt — and its cassette key — drifted per driver and per week.
        _req("DELETE", "/rest/v1/niete_lp_downloads?user_id=eq.%s" % uid, creds, prefer="return=minimal")
        if redis_port:
            _redis_del(redis_port, "lp_shelf:%s" % uid)
        print("cleared recent-lesson context (niete_lp_downloads%s)" % (" + lp_shelf" if redis_port else ""))
    if left: sys.exit(1)


# ── coaching-ext levers (the 40 scenarios added 2026-09-30, bd-xub4s) ──────────────────────────────
# Every command below prints ONE JSON line; the driver parses it. Test driver on the sandbox DB only.
import json as _json, datetime as _dt, urllib.request as _ur, urllib.error as _ue

NUDGE_KIND = "coaching_after_lp"

def _post_soft(creds, path, body, prefer="return=representation"):
    """POST that returns (status, json|text) instead of exiting on an HTTP error — a seed that collides
    with the teacher_nudges UNIQUE (23505) IS the assertion (COA40), not a failure."""
    url, k = creds
    req = _ur.Request(url + path, data=_json.dumps(body).encode(), method="POST",
                      headers={"apikey": k, "Authorization": "Bearer " + k, "Content-Type": "application/json", "Prefer": prefer})
    try:
        with _ur.urlopen(req, timeout=60) as r:
            raw = r.read().decode(); return r.status, (_json.loads(raw) if raw.strip() else None)
    except _ue.HTTPError as e:
        return e.code, e.read().decode()[:400]

SESSION_COLS = ("id,status,created_at,updated_at,completed_at,report_pdf_url,conversation_state,analysis_data,"
                "lesson_plan_extraction_status,lesson_plan_link_method,has_lesson_plan,lesson_plan_text,"
                "duplicate_of_session_id,transcript_language,transcript_text")

def cmd_session_get(creds, uid, a):
    q = ("id=eq.%s" % a.session_id) if a.session_id and a.session_id != "latest" else ("user_id=eq.%s&order=created_at.desc&limit=1" % uid)
    if getattr(a, "status", None) and (not a.session_id or a.session_id == "latest"): q += "&status=eq.%s" % a.status
    rows = _get(creds, "coaching_sessions", q + "&select=" + SESSION_COLS) or []
    if not rows: print(_json.dumps({"found": False})); return
    r = rows[0]
    ad = r.get("analysis_data") or {}
    # trim the big blobs to what the scenarios assert on
    out = {k: r.get(k) for k in ("id", "status", "created_at", "updated_at", "completed_at", "report_pdf_url",
                                 "lesson_plan_extraction_status", "lesson_plan_link_method", "has_lesson_plan",
                                 "duplicate_of_session_id", "transcript_language")}
    out["lesson_plan_text_len"] = len(r.get("lesson_plan_text") or "")
    out["transcript_head"] = (r.get("transcript_text") or "")[:300]
    cs = r.get("conversation_state") or {}
    out["conversation_state"] = {k: cs.get(k) for k in ("current_state", "conversation_language", "questions_answered", "skipped", "classroom_photos")}
    out["questions"] = [{k: q.get(k) for k in ("question", "answer", "format", "language", "question_number", "delivery")} for q in (cs.get("questions") or [])]
    out["analysis"] = {k: ad.get(k) for k in ("framework", "voice_debrief_script", "scores", "photo_mode", "photo_count_analysed",
                                             "photo_vision", "photo_reads", "photo_evidence", "lp_fidelity", "has_lesson_plan", "topic", "subject")}
    print(_json.dumps({"found": True, **out}, ensure_ascii=False))

def cmd_age_sessions(creds, uid, a):
    """Move the driver's coaching sessions created in the last 24h back by --hours (default 26), so the
    coaching ask's coached_today ladder (lp-coaching-ask coachingReason) no longer sees today's runs."""
    since = (_dt.datetime.utcnow() - _dt.timedelta(hours=24)).replace(microsecond=0).isoformat() + "Z"
    rows = _get(creds, "coaching_sessions", "user_id=eq.%s&created_at=gte.%s&select=id,created_at" % (uid, since)) or []
    if not a.yes_write: print(_json.dumps({"dry_run": True, "would_age": len(rows)})); return
    hours = int(a.hours or 26)
    for r in rows:
        raw = r["created_at"].replace("Z", "+00:00")
        raw = re.sub(r"\.(\d+)(?=[+-]\d\d:\d\d$|$)", lambda m: "." + (m.group(1) + "000000")[:6], raw)   # 3.10 fromisoformat wants 3 or 6 fraction digits
        t = _dt.datetime.fromisoformat(raw) - _dt.timedelta(hours=hours)
        _req("PATCH", "/rest/v1/coaching_sessions?id=eq.%s&user_id=eq.%s" % (r["id"], uid), creds,
             body={"created_at": t.isoformat()}, prefer="return=minimal")
    print(_json.dumps({"aged": len(rows), "hours": hours}))

def cmd_seed_nudge(creds, uid, a):
    """One coaching_after_lp row for the driver, due now (or --scheduled-at), for a lesson delivered at
    --delivered-at. The sweeper (bot/scripts/e2e/sweep.js teacher-nudges) then sends it."""
    now = _dt.datetime.utcnow().replace(microsecond=0)
    delivered = a.delivered_at or (now.isoformat() + "Z")
    # Due TEN MINUTES AHEAD by default: the Railway sandbox worker sweeps this same DB every 5 min and would
    # claim a row due now (and send the ask over the real number). Our sweep passes now+10min, so only it sees
    # the row as due (bot/scripts/e2e/sweep.js E2E_SWEEP_NOW).
    scheduled = a.scheduled_at or ((now + _dt.timedelta(minutes=10)).isoformat() + "Z")
    # nudge_date = the PKT day the ask goes out (today unless told otherwise)
    pkt = now + _dt.timedelta(hours=5)
    nudge_date = a.nudge_date or pkt.strftime("%Y-%m-%d")
    body = {"user_id": uid, "kind": NUDGE_KIND, "nudge_date": nudge_date, "scheduled_at": scheduled,
            "context": {"lesson_id": a.lesson_id or "qa-coaching-ext", "delivered_at": delivered, "first_time": bool(a.first_time)}}
    if not a.yes_write: print(_json.dumps({"dry_run": True, "would_insert": body})); return
    st, res = _post_soft(creds, "/rest/v1/teacher_nudges", [body])
    if st in (200, 201):
        row = (res or [{}])[0]; print(_json.dumps({"created": True, "id": row.get("id"), "nudge_date": nudge_date, "status": row.get("status")}))
    else:
        print(_json.dumps({"created": False, "http": st, "error": str(res)[:300]}))

def cmd_nudge_rows(creds, uid, a):
    q = "user_id=eq.%s&select=id,kind,nudge_date,status,choice,scheduled_at,sent_at,answered_at,context,quiz_id&order=created_at.desc&limit=%d" % (uid, int(a.limit or 20))
    if a.kind: q += "&kind=eq.%s" % a.kind
    print(_json.dumps(_get(creds, "teacher_nudges", q) or [], ensure_ascii=False))

def cmd_purge_nudges(creds, uid, a):
    rows = _get(creds, "teacher_nudges", "user_id=eq.%s&select=id" % uid) or []
    if not a.yes_write: print(_json.dumps({"dry_run": True, "would_delete": len(rows)})); return
    if rows: _req("DELETE", "/rest/v1/teacher_nudges?user_id=eq.%s" % uid, creds, prefer="return=minimal")
    print(_json.dumps({"deleted": len(rows)}))

def cmd_user_get(creds, uid, a):
    r = (_get(creds, "users", "id=eq.%s&select=id,name,role,region,preferred_language,language_locked,conversation_state,conversation_state_expires_at,last_message_at" % uid) or [{}])[0]
    print(_json.dumps(r, ensure_ascii=False))

def cmd_first_use_rows(creds, uid, a):
    print(_json.dumps(_get(creds, "user_feature_first_use", "user_id=eq.%s&select=feature,feature_used_at,intro_shown_count" % uid) or []))

EXT_CMDS = {"session-get": cmd_session_get, "age-sessions": cmd_age_sessions, "seed-nudge": cmd_seed_nudge,
            "nudge-rows": cmd_nudge_rows, "purge-nudges": cmd_purge_nudges, "user-get": cmd_user_get,
            "first-use-rows": cmd_first_use_rows}
EXT_WRITES = {"age-sessions", "seed-nudge", "purge-nudges"}

def cmd_lesson_plans(creds, uid, a):
    print(_json.dumps(_get(creds, "lesson_plans", "user_id=eq.%s&select=id,created_at,status&order=created_at.desc&limit=5" % uid) or []))

def cmd_purge_first_use(creds, uid, a):
    """Delete the driver's user_feature_first_use row for --feature (e.g. lp_coaching_howto), so the
    how-to clip counts from zero again (COA42/COA43)."""
    rows = _get(creds, "user_feature_first_use", "user_id=eq.%s&feature=eq.%s&select=feature" % (uid, a.feature)) or []
    if not a.yes_write: print(_json.dumps({"dry_run": True, "would_delete": len(rows)})); return
    if rows: _req("DELETE", "/rest/v1/user_feature_first_use?user_id=eq.%s&feature=eq.%s" % (uid, a.feature), creds, prefer="return=minimal")
    print(_json.dumps({"deleted": len(rows), "feature": a.feature}))

EXT_CMDS.update({"lesson-plans": cmd_lesson_plans, "purge-first-use": cmd_purge_first_use})
EXT_WRITES.add("purge-first-use")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("list", "cancel-stuck", "reset-history", "reset-first-use", "reset-conversations") + tuple(EXT_CMDS):
        p = sub.add_parser(c); p.add_argument("--env"); p.add_argument("--phone", required=True)
        if c in ("cancel-stuck", "reset-history", "reset-first-use", "reset-conversations") or c in EXT_WRITES: p.add_argument("--yes-write", action="store_true")
        if c == "reset-conversations":
            p.add_argument("--clear-cache-url", help="bot base URL; also POSTs /clear-history/<uid> to clear the in-process history Map")
            p.add_argument("--clear-lp-context", action="store_true", help="also delete her niete_lp_downloads rows (+ the lp_shelf key with --redis-port)")
            p.add_argument("--redis-port", type=int, help="the run's private redis-server port (E2E_REDIS_PORT)")
        if c == "session-get": p.add_argument("--session-id", default="latest"); p.add_argument("--status")
        if c == "age-sessions": p.add_argument("--hours", default="26")
        if c == "seed-nudge":
            p.add_argument("--delivered-at"); p.add_argument("--scheduled-at"); p.add_argument("--nudge-date"); p.add_argument("--lesson-id")
            p.add_argument("--first-time", action="store_true")
        if c == "nudge-rows": p.add_argument("--kind"); p.add_argument("--limit", default="20")
        if c == "purge-first-use": p.add_argument("--feature", required=True)
    a = ap.parse_args()
    creds = _creds(a.env)
    uid = _user_id(creds, a.phone)
    if a.cmd in EXT_CMDS: EXT_CMDS[a.cmd](creds, uid, a); return
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
        reset_conversations(creds, uid, a.yes_write, getattr(a, "clear_cache_url", None),
                            getattr(a, "clear_lp_context", False), getattr(a, "redis_port", None)); return

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
