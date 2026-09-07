#!/usr/bin/env python3
"""Reusable NIETE training DB tool for the @destructive/@seed e2e scenarios.

Encodes the repeatable procedure used to drive training.feature #3 (finish-all ->
grand quiz -> certify), #4 (certificate by code), #9 (fail exam -> cooldown), and
the vendor-programme scenarios (#2/#5/#6/#15). No third-party deps (urllib + REST).

Creds are resolved PER ENVIRONMENT (bd-2759). `--env staging|prod`; the default
follows whatsapp-targets.yaml `default_profile`, so the tool talks to the same DB
the e2e suite is driving (currently STAGING). Sources, first hit wins:
  staging -> NIETE_STAGING_SUPABASE_URL/_SERVICE_ROLE_KEY, else keys/niete-staging.env, else .env.staging
  prod    -> NIETE_PROD_SUPABASE_URL/_SERVICE_ROLE_KEY,    else keys/niete-prod.env,    else .env
  (all paths relative to THIS repo's root; a worktree also checks its main checkout)
The resolved project ref is asserted against ENV_REFS and the run ABORTS before any
request on a mismatch — previously this file read NIETE-Rumi/.env unconditionally, so
seeding during a staging run wrote to PROD and did nothing to the bot under test.
The service_role key is never printed (only the project ref + file name).
READS run freely. WRITES are GATED behind `--yes-write` (a dry-run prints the intended
change and exits) so the operator keeps control of prod-DB writes (root CLAUDE Rule 7).

Usage (run from repo root) — `--env staging|prod` is accepted on EVERY subcommand and
defaults to the env of whatsapp-targets.yaml `default_profile` (currently staging):
  python .claude/qa/shared/niete_training_db.py lookup             [--env E] --phone <driver>
  python .claude/qa/shared/niete_training_db.py answer-key         [--env E] --level <level_id>
  python .claude/qa/shared/niete_training_db.py answer-key         [--env E] --grand-quiz <gq_id>
  python .claude/qa/shared/niete_training_db.py seed-level-complete [--env E] --phone P --level <id> [--yes-write]
  python .claude/qa/shared/niete_training_db.py revert-level        [--env E] --phone P --level <id> [--yes-write]
  python .claude/qa/shared/niete_training_db.py activate-program    [--env E] --phone P --program-key niete_standard [--yes-write]
  python .claude/qa/shared/niete_training_db.py seed-module-pass    [--env E] --phone P --module <id> [--program-key niete_standard] [--yes-write]

Answer-key output feeds the browser exam-driver (see grandquiz_exam_drive.js):
each row is {q, correct} — resolve the served question by `q` (substring),
select the option whose TEXT matches `correct` (correct_option is 1-based).
"""
import argparse, subprocess, json, os, re, sys, uuid, datetime, urllib.request, urllib.parse, urllib.error

# sandbox = the local mock E2E lane's database (keys/niete-sandbox.env): the bot under test runs on
# this machine from a pinned commit and must never write to staging or prod while doing it.
ENV_REFS = {"staging": "rpqkekcfvumypldbejhp", "prod": "ihzciabopbttygxxgrkm", "sandbox": "olvritwoqujtjvwfulbh"}

def _repo_root():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", ".."))

def _main_checkout():
    """The MAIN checkout, even when this file is running from a git worktree.

    `keys/` is gitignored, so it exists only in the main checkout — but root
    CLAUDE.md rule 21 says do all work in a worktree, where `_repo_root()`
    resolves to the worktree and the creds look absent. That made every DB op
    fail with a bare 'no SUPABASE_URL' from exactly the place people are told to
    work. `--git-common-dir` points at the main repo's .git from anywhere inside
    it; its parent is the main checkout. Same trick beads-ledger.py uses to reach
    the canonical ledger. Returns None outside a repo."""
    try:
        out = subprocess.run(["git", "rev-parse", "--git-common-dir"],
                             cwd=_repo_root(), capture_output=True, text=True, timeout=5)
        if out.returncode != 0:
            return None
        gitdir = out.stdout.strip()
        if not os.path.isabs(gitdir):
            gitdir = os.path.abspath(os.path.join(_repo_root(), gitdir))
        return os.path.dirname(gitdir)
    except (OSError, subprocess.SubprocessError):
        return None   # not a repo / git unavailable — a NameError here must NOT be swallowed

def _project_ref(url):
    """https://<ref>.supabase.co -> <ref> (None if unparseable)."""
    m = re.match(r"https?://([a-z0-9]+)\.supabase\.co", (url or "").strip().rstrip("/"))
    return m.group(1) if m else None

def _default_env():
    """Follow whatsapp-targets.yaml `default_profile` -> that profile's `env`.

    So the seed tool defaults to the SAME environment the e2e suite drives. Falls
    back to staging (the safer of the two) if the config can't be read."""
    path = os.path.join(_repo_root(), ".claude", "qa", "config", "whatsapp-targets.yaml")
    if not os.path.isfile(path):
        return "staging"
    lines = open(path, encoding="utf-8").read().splitlines()
    prof = next((m.group(1) for m in (re.match(r"^default_profile:\s*(\S+)", l) for l in lines) if m), None)
    if not prof:
        return "staging"
    in_profiles = in_prof = False
    for l in lines:
        if re.match(r"^profiles:\s*$", l):
            in_profiles = True; continue
        if in_profiles and re.match(r"^\S", l):
            in_profiles = False
        if not in_profiles:
            continue
        if re.match(r"^  %s:\s*$" % re.escape(prof), l):
            in_prof = True; continue
        if in_prof and re.match(r"^  \S", l):
            in_prof = False
        if in_prof:
            m = re.match(r"^\s+env:\s*(\S+)", l)
            if m:
                return m.group(1)
    return "staging"

def _env_candidates(env):
    """Per-env dotenv search path, most-canonical first. Staging creds live in a
    SEPARATE file from prod so a staging run can never pick up the prod
    service_role key by accident.

    `keys/` at the repo root is the documented credential home and is gitignored
    (so is every `.env.*`), so it wins over the dotenvs. Everything is resolved
    from THIS repo's root — the QA tooling ships inside NIETE-Rumi and must work
    from any clone on any machine, so no path here may reach for a parent
    workspace. A git worktree additionally checks its main checkout, because
    gitignored files exist only there."""
    name = ".env.staging" if env == "staging" else ".env"
    roots, seen = [], set()
    for r in (_repo_root(), _main_checkout()):   # worktree first, then the main checkout
        if r and r not in seen:
            seen.add(r); roots.append(r)
    out = []
    for root in roots:
        out += [os.path.join(root, "keys", "niete-%s.env" % env),
                os.path.join(root, name),
                os.path.join(root, "bot", name)]
    return out

def _read_env_file(path):
    url = key = None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = line.strip()
            if m.startswith("SUPABASE_URL="):
                url = m.split("=", 1)[1].strip().strip('"\'')
            elif m.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                key = m.split("=", 1)[1].strip().strip('"\'')
    return url, key

def _assert_ref(env, url):
    """Abort BEFORE any request if the creds point at a different project than the
    chosen env (bd-2759 / the bd-2533 wrong-prod-DB class)."""
    want, got = ENV_REFS.get(env), _project_ref(url)
    if want and got != want:
        other = next((e for e, r in ENV_REFS.items() if r == got), None)
        sys.exit("REFUSING TO RUN: --env %s expects Supabase project %s, but the resolved "
                 "creds point at %s%s.\n  Fix the creds file for this env, or pass the correct "
                 "--env. (bd-2759)" % (env, want, got or "<unparseable>",
                                       " — that is %s" % other if other else ""))

def _creds(env=None):
    env = env or _default_env()
    if env not in ENV_REFS:
        sys.exit("unknown --env %r (expected one of: %s)" % (env, ", ".join(sorted(ENV_REFS))))
    prefix = "NIETE_%s_SUPABASE_" % env.upper()
    url, key = os.environ.get(prefix + "URL"), os.environ.get(prefix + "SERVICE_ROLE_KEY")
    source = prefix + "*"
    if not (url and key):
        for cand in _env_candidates(env):
            if os.path.isfile(cand):
                u, k = _read_env_file(cand)
                if u and k:
                    url, key, source = u, k, cand
                    break
    if not url or not key:
        sys.exit("no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for env=%s.\n  Looked in: %s\n"
                 "  ...and env vars %sURL / %sSERVICE_ROLE_KEY.\n"
                 "  Staging creds: railway link -p 'NIETE-Rumi Staging' && railway variables --service bot"
                 % (env, ", ".join(_env_candidates(env)), prefix, prefix))
    _assert_ref(env, url)
    sys.stderr.write("[niete_training_db] env=%s project=%s source=%s\n"
                     % (env, _project_ref(url), os.path.basename(str(source))))
    return url.rstrip("/"), key

def _req(method, path, key, body=None, prefer=None):
    url, k = key
    headers = {"apikey": k, "Authorization": "Bearer " + k, "Content-Type": "application/json"}
    if prefer: headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else None, r.status
    except urllib.error.HTTPError as e:
        sys.exit("HTTP %s on %s %s: %s" % (e.code, method, path, e.read().decode()[:300]))

def _upsert_path(table, conflict_cols):
    """PostgREST upsert target. `Prefer: resolution=merge-duplicates` is only honoured
    when the request also names the unique constraint via `on_conflict` — without it an
    INSERT over existing rows fails with 409 / 23505 (bd-2760)."""
    return "/rest/v1/%s?on_conflict=%s" % (table, ",".join(conflict_cols))

def _get(creds, table, q):  return _req("GET", "/rest/v1/%s?%s" % (table, q), creds)[0]

def cmd_lookup(creds, a):
    phone = a.phone
    u = _get(creds, "users", "phone_number=eq.%s&select=id,phone_number,first_name,name,registration_completed,registration_state,preferred_language,language_locked,role" % phone)
    print("USER:", json.dumps(u, ensure_ascii=False, indent=1))
    print("PROGRAMS:", json.dumps(_get(creds, "training_programs", "select=id,key,name,is_active&order=key"), ensure_ascii=False, indent=1))
    print("VENDORS:", json.dumps(_get(creds, "training_vendors", "select=id,key,name,passing_pct,unlock_logic&order=key"), ensure_ascii=False, indent=1))
    print("LEVELS:", json.dumps(_get(creds, "training_levels", "select=id,name,order_index,vendor_id&order=vendor_id,order_index"), ensure_ascii=False, indent=1))
    print("GRAND_QUIZZES:", json.dumps(_get(creds, "training_grand_quizzes", "select=id,level_id,quiz_type,is_active"), ensure_ascii=False, indent=1))
    if u:
        print("ASSIGNMENTS:", json.dumps(_get(creds, "teacher_training_assignments", "user_id=eq.%s&select=id,program_id,assigned_by,is_active" % u[0]["id"]), ensure_ascii=False, indent=1))

def _resolve_gq(creds, level_id):
    gq = _get(creds, "training_grand_quizzes", "level_id=eq.%s&quiz_type=eq.grand_quiz&select=id" % level_id)
    if not gq: sys.exit("no grand_quiz for level %s" % level_id)
    return gq[0]["id"]

def cmd_answer_key(creds, a):
    gq = a.grand_quiz or _resolve_gq(creds, a.level)
    qs = _get(creds, "training_questions", "grand_quiz_id=eq.%s&is_active=eq.true&select=question_text,options,correct_option&order=order_index" % gq)
    out = []
    for q in qs:
        opts = q["options"]
        texts = [o if isinstance(o, str) else (o.get("text") or o.get("label") or "") for o in opts]
        co = str(q["correct_option"]).strip()
        idx = int(co) - 1 if co.isdigit() and 0 <= int(co) - 1 < len(texts) else None
        if idx is None:
            for j, o in enumerate(opts):
                if isinstance(o, dict) and str(o.get("key")) == co: idx = j; break
        out.append({"q": (q["question_text"] or "").strip(), "correct": texts[idx] if idx is not None else None})
    print(json.dumps(out, ensure_ascii=False))
    sys.stderr.write("resolved %d/%d answers for grand_quiz %s\n" % (sum(1 for o in out if o["correct"]), len(out), gq))

def _uid(creds, phone):
    u = _get(creds, "users", "phone_number=eq.%s&select=id" % phone)
    if not u: sys.exit("no user for phone %s" % phone)
    return u[0]["id"]

def _level_module_ids(creds, level_id):
    courses = _get(creds, "training_courses", "level_id=eq.%s&select=id" % level_id)
    cids = ",".join(str(c["id"]) for c in courses)
    if not cids: return []
    mods = _get(creds, "training_modules", "course_id=in.(%s)&is_active=eq.true&select=id" % cids)
    return [m["id"] for m in mods]

def cmd_seed_level_complete(creds, a):
    uid, mids = _uid(creds, a.phone), _level_module_ids(creds, a.level)
    if not a.yes_write:
        print("DRY-RUN: would INSERT %d teacher_training_progress rows (all modules of level %s) for user %s." % (len(mids), a.level, uid))
        print("Re-run with --yes-write to apply. Reversible via revert-level.")
        return
    body = [{"user_id": uid, "module_id": m} for m in mids]
    _req("POST", _upsert_path("teacher_training_progress", ["user_id", "module_id"]), creds, body=body, prefer="resolution=merge-duplicates,return=minimal")
    print("SEEDED %d modules done for level %s (user %s). Grand quiz should now unlock." % (len(mids), a.level, uid))

def cmd_revert_level(creds, a):
    uid, mids = _uid(creds, a.phone), _level_module_ids(creds, a.level)
    if not a.yes_write:
        print("DRY-RUN: would DELETE this user's teacher_training_progress for level %s modules, plus training_certificates + training_assessment_attempts for level %s." % (a.level, a.level))
        print("Re-run with --yes-write to apply.")
        return
    inlist = "in.(%s)" % ",".join(str(m) for m in mids)
    _req("DELETE", "/rest/v1/teacher_training_progress?user_id=eq.%s&module_id=%s" % (uid, inlist), creds, prefer="return=minimal")
    _req("DELETE", "/rest/v1/training_certificates?user_id=eq.%s&level_id=eq.%s" % (uid, a.level), creds, prefer="return=minimal")
    _req("DELETE", "/rest/v1/training_assessment_attempts?user_id=eq.%s&level_id=eq.%s" % (uid, a.level), creds, prefer="return=minimal")
    print("REVERTED level %s for user %s (progress + certificate + attempts)." % (a.level, uid))

def _module_level_and_count(creds, module_id):
    """module -> course -> level_id, plus the active question count for the module."""
    mod = _get(creds, "training_modules", "id=eq.%s&select=id,course_id" % module_id)
    if not mod: sys.exit("no module %s" % module_id)
    course = _get(creds, "training_courses", "id=eq.%s&select=level_id" % mod[0]["course_id"])
    if not course: sys.exit("no course for module %s" % module_id)
    qs = _get(creds, "training_questions", "training_module_id=eq.%s&is_active=eq.true&select=id" % module_id) or []
    return course[0]["level_id"], len(qs)

def cmd_seed_module_pass(creds, a):
    """Mark ONE training module as done + insert a PASSED module-quiz attempt (100%),
    so certificate.service.maybeIssueQuizScoreCertificate sees it clear the 70% bar.
    Used to amortize the Oxbridge 'certified from module scores, no exam' drive
    (training.feature): seed all-but-the-last module, then drive the last one LIVE
    so the real grading path issues the certificate. Reversible via revert-level."""
    uid = _uid(creds, a.phone)
    prog = _get(creds, "training_programs", "key=eq.%s&select=id" % a.program_key)
    if not prog: sys.exit("no program with key %s" % a.program_key)
    pid = prog[0]["id"]
    level_id, qcount = _module_level_and_count(creds, a.module)
    total = qcount or 10
    if not a.yes_write:
        print("DRY-RUN: would mark module %s done + INSERT a PASSED training_module attempt "
              "(score %d/%d, level %s, program %s) for user %s." % (a.module, total, total, level_id, a.program_key, uid))
        print("Re-run with --yes-write. Reversible via revert-level --level %s." % level_id)
        return
    now = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    _req("POST", _upsert_path("teacher_training_progress", ["user_id", "module_id"]), creds,
         body=[{"user_id": uid, "module_id": a.module}], prefer="resolution=merge-duplicates,return=minimal")
    _req("POST", "/rest/v1/training_assessment_attempts", creds, body=[{
        "id": str(uuid.uuid4()), "user_id": uid, "program_id": pid, "quiz_kind": "training_module",
        "training_module_id": a.module, "level_id": level_id, "current_question_index": total,
        "total_questions": total, "total_score": total, "score": total, "is_passed": True,
        "status": "passed", "completed_at": now, "last_activity_at": now,
    }], prefer="return=minimal")
    print("SEEDED module %s PASSED (%d/%d) for user %s (level %s). Certifiable once every module clears 70%%." % (
        a.module, total, total, uid, level_id))

def cmd_activate_program(creds, a):
    uid = _uid(creds, a.phone)
    prog = _get(creds, "training_programs", "key=eq.%s&select=id" % a.program_key)
    if not prog: sys.exit("no program with key %s" % a.program_key)
    pid = prog[0]["id"]
    existing = _get(creds, "teacher_training_assignments", "user_id=eq.%s&program_id=eq.%s&select=id,is_active" % (uid, pid))
    if not a.yes_write:
        print("DRY-RUN: would set is_active=true on assignment %s (or INSERT) linking user %s -> program %s (%s)." % (
            existing[0]["id"] if existing else "(new)", uid, pid, a.program_key))
        print("Re-run with --yes-write. Reversible: set is_active=false.")
        return
    if existing:
        _req("PATCH", "/rest/v1/teacher_training_assignments?id=eq.%s" % existing[0]["id"], creds, body={"is_active": True}, prefer="return=minimal")
        print("ACTIVATED existing assignment %s (user %s -> %s)." % (existing[0]["id"], uid, a.program_key))
    else:
        _req("POST", "/rest/v1/teacher_training_assignments", creds, body=[{"user_id": uid, "program_id": pid, "assigned_by": "qa_seed", "is_active": True}], prefer="return=minimal")
        print("INSERTED assignment (user %s -> %s)." % (uid, a.program_key))

def main():
    p = argparse.ArgumentParser(description="NIETE training DB tool (reads free; writes gated by --yes-write).")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--env", choices=sorted(ENV_REFS),
                        help="which NIETE Supabase to talk to (default: the env of "
                             "whatsapp-targets.yaml default_profile — currently %s)" % _default_env())
    sub = p.add_subparsers(dest="cmd", required=True)
    lp = sub.add_parser("lookup", parents=[common]); lp.add_argument("--phone", required=True, help="driver to inspect (digits, no +) — resolved at runtime from the runner's own linked session; never hardcoded (bd-2748/bd-2767)")
    ak = sub.add_parser("answer-key", parents=[common]); ak.add_argument("--grand-quiz", type=int, dest="grand_quiz"); ak.add_argument("--level", type=int)
    for name in ("seed-level-complete", "revert-level"):
        s = sub.add_parser(name, parents=[common]); s.add_argument("--phone", required=True); s.add_argument("--level", type=int, required=True); s.add_argument("--yes-write", action="store_true")
    apg = sub.add_parser("activate-program", parents=[common]); apg.add_argument("--phone", required=True); apg.add_argument("--program-key", required=True, dest="program_key"); apg.add_argument("--yes-write", action="store_true")
    smp = sub.add_parser("seed-module-pass", parents=[common]); smp.add_argument("--phone", required=True); smp.add_argument("--module", type=int, required=True); smp.add_argument("--program-key", default="niete_standard", dest="program_key"); smp.add_argument("--yes-write", action="store_true")
    a = p.parse_args()
    creds = _creds(getattr(a, "env", None))
    {"lookup": cmd_lookup, "answer-key": cmd_answer_key, "seed-level-complete": cmd_seed_level_complete,
     "revert-level": cmd_revert_level, "activate-program": cmd_activate_program,
     "seed-module-pass": cmd_seed_module_pass}[a.cmd](creds, a)

if __name__ == "__main__":
    main()
