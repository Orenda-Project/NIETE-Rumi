"""The pure part of scripts/migrate-gb-from-rumi.py (bd-97daxo.7): Gilgit-Baltistan's people, schools, coach-school
links and finished coaching sessions, read from main Rumi and turned into NIETE's OWN rows.

Nothing here touches a database or the network. The driver reads both sides, hands the rows to plan(), prints what
plan() decided and, with --commit, writes exactly those rows. Every rule below is pinned by
scripts/tests/test_gb_migration.py.

Decisions (operator, 2026-10-29, and the reasons where they were ours):
  * every GB person moves: non-test main-Rumi users whose region is gilgit_baltistan or whose school is in it;
  * users.region = 'Gilgit-Baltistan' (the region registry's display name); organization 'moawin' for Moawin people,
    else their main-Rumi organization ('none' and blank become NULL);
  * roles land inside NIETE's users_role_check (teacher, principal, coach, unregistered): school_leader → principal,
    fmo and supervisor → coach (both observe teachers across schools, which is what a NIETE coach does);
  * ids are uuid5 of the main-Rumi id under one fixed namespace. Re-running maps every row to the same id, so a
    re-run is an upsert of the same rows, and a version-5 id can never equal one Postgres generated (v4);
  * fake phones (sandbox/staging) sit in 0399-7xxxxxx. 0399 is no Pakistani mobile operator's code, so the number
    reaches no phone, and it still has the 92-3-nine-digits shape every validator in the repo accepts;
  * leader_teachers is DEPRECATED in NIETE (V1.2.4): who a coach observes is derived from
    leader_schools x users.school_id. So the coach→school links are migrated, each teacher's school is set
    (from her leader's roster when main Rumi had none on her row), and the main-Rumi roster is only measured
    against what NIETE will derive (report['patch_coverage']), never copied;
  * dropped on purpose: pic-to-LP, chats, nudges, failed LP requests, and the main-Rumi-only links on a session
    (its chat session, conversation state, linked lesson plan).
"""
import hashlib
import json
import re
import unicodedata
import uuid
from urllib.parse import urlparse

GB_REGION = "Gilgit-Baltistan"            # region_features.display_name of the 'gilgit-baltistan' row (V1.8.5)
SOURCE_REGION = "gilgit_baltistan"        # main Rumi's spelling
SOURCE_SYSTEM = "main_rumi"               # schools.source_system
USER_SOURCE = "main_rumi_gb"              # users.source (VARCHAR 50)
LEADER_SOURCE = "niete_ict"               # leader_schools_source_check allows only this value
NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/Orenda-Project/NIETE-Rumi/scripts/migrate-gb-from-rumi.py")

TARGET_REFS = {"sandbox": "olvritwoqujtjvwfulbh", "staging": "rpqkekcfvumypldbejhp", "prod": "ihzciabopbttygxxgrkm"}
SOURCE_REF = "jlpenspfdcwxkopaidys"       # main Rumi production (read through the SELECT-only analyst role)

FAKE_PHONE_PREFIX = "92399" + "7"         # + 6 digits = 12 digits; 0399 is unallocated in Pakistan
NIETE_ROLES = ("teacher", "principal", "coach", "unregistered")
ROLE_MAP = {"teacher": "teacher", "principal": "principal", "school_leader": "principal", "head_teacher": "principal",
            "fmo": "coach", "supervisor": "coach", "coach": "coach", "aeo": "coach"}
PATCH_ROLES = ("teacher", "principal")    # patch-resolver.service.js PATCH_ROLES
NIETE_LANGUAGES = ("ur", "en")            # bot/shared/config/languages.js LANGUAGE_OFFER, default first
# bot/shared/config/registration-data.js GRADES_DROPDOWN / SUBJECTS_DROPDOWN ids (main Rumi uses the same ids).
GRADE_IDS = ("early_years", "grade_1", "grade_2", "grade_3", "grade_4", "grade_5", "grade_6", "grade_7", "grade_8",
             "grade_9", "grade_10", "higher_secondary")
SUBJECT_IDS = ("maths", "english", "urdu", "islamiat", "science", "physics", "chemistry", "biology", "social_studies",
               "computer_science", "other")
COACHING_STATUSES = ("completed", "observer_review_complete")

SCHOOL_COLUMNS = ("id", "name", "region", "emis", "source_system", "source_school_id", "is_active", "is_probable_test")
USER_COLUMNS = ("id", "phone_number", "name", "region", "organization", "role", "school_id", "school_name", "country",
                "preferred_language", "language_locked", "grades_taught", "subjects_taught", "registration_completed",
                "registration_completed_at", "registration_state", "is_test_user", "source", "created_at",
                "preferences")
LEADER_SCHOOL_COLUMNS = ("id", "leader_user_id", "source", "school_ext_id", "school_id", "school_name", "emis",
                         "name_match_quality")
# NIETE coaching_sessions columns filled straight from the main-Rumi row (same meaning on both sides).
SESSION_COPY = (
    "audio_url", "audio_duration_seconds", "audio_format", "audio_size_bytes", "transcript_text",
    "transcript_language", "diarization_data", "diarization_confidence", "lesson_plan_url", "lesson_plan_text",
    "lesson_plan_format", "has_lesson_plan", "analysis_data", "report_pdf_url", "report_generated_at",
    "voice_debrief_url", "voice_debrief_duration_seconds", "voice_debrief_language", "status",
    "last_successful_step", "failed_step", "error_message", "transcription_cost", "analysis_cost", "total_cost",
    "gpt5_input_tokens", "gpt5_output_tokens", "gpt5_cached_tokens", "created_at", "confirmed_at",
    "transcription_started_at", "transcription_completed_at", "analysis_started_at", "analysis_completed_at",
    "completed_at", "updated_at", "audio_id", "report_gamma_url", "lesson_plan_r2_key", "lesson_plan_excerpt",
    "lesson_plan_structured", "lesson_plan_word_count", "lesson_plan_extraction_status",
    "lesson_plan_extraction_error", "reminder_sent_at", "tokens_raw", "silence_markers", "prioritized_action",
    "classroom_photos", "observation_type", "autofill_analysis_data", "debrief_status", "audio_hash",
)
# Set by the migration, not copied: NIETE ids, the framework column, and the main-Rumi-only links cleared.
SESSION_SET = ("id", "user_id", "observer_user_id", "framework", "framework_selection_reason", "can_resume",
               "session_id", "conversation_state", "linked_lesson_plan_id", "lesson_plan_link_method",
               "duplicate_of_session_id", "error_stack")
SESSION_COLUMNS = SESSION_SET + SESSION_COPY
SESSION_FILE_FIELDS = ("audio_url", "report_pdf_url", "lesson_plan_url", "voice_debrief_url")


# ── ids and phones ────────────────────────────────────────────────────────────────────────────────────
def niete_id(kind, source_id):
    """The NIETE id of a main-Rumi row: stable across runs, version 5, distinct per table."""
    return str(uuid.uuid5(NAMESPACE, f"main-rumi:{kind}:{source_id}"))


def _fake_candidate(source_id, attempt):
    h = hashlib.sha256(f"gb-fake-phone:{source_id}:{attempt}".encode()).hexdigest()
    return FAKE_PHONE_PREFIX + str(int(h, 16) % 10 ** 6).zfill(6)


def fake_phone(source_id, taken=frozenset()):
    """A deterministic number in the unallocated block, the first candidate not in `taken`."""
    for attempt in range(10 ** 4):
        c = _fake_candidate(source_id, attempt)
        if c not in taken:
            return c
    raise RuntimeError("fake phone block exhausted")


def assign_fake_phones(source_ids, taken=None):
    """{source id: fake phone}, unique, the same whatever order the ids come in, avoiding `taken`."""
    taken = set(taken or ())
    out = {}
    for sid in sorted({str(s) for s in source_ids}):
        p = fake_phone(sid, taken)
        taken.add(p)
        out[sid] = p
    return out


def is_fake_phone(phone):
    return bool(re.fullmatch(re.escape(FAKE_PHONE_PREFIX) + r"\d{6}", str(phone or "")))


def mask_phone(phone):
    s = str(phone or "")
    return f"…{s[-4:]}" if s else None


# ── mapping ───────────────────────────────────────────────────────────────────────────────────────────
def map_role(role):
    return ROLE_MAP.get(str(role or "").strip().lower(), "unregistered")


def map_organization(org):
    s = str(org or "").strip()
    if not s or s.lower() == "none":
        return None
    return "moawin" if s.lower() == "moawin" else s


def clamp_language(lang, locked):
    """NIETE serves ur/en only. A language it does not offer becomes its default, and is not locked."""
    code = str(lang or "").strip().lower()
    if code in NIETE_LANGUAGES:
        return code, bool(locked)
    return NIETE_LANGUAGES[0], False


def slug(text):
    folded = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", folded).strip("-")


def canon(name):
    """The schools idx_schools_name_canon_region key: letters and digits, upper-cased."""
    return re.sub(r"[^A-Za-z0-9]", "", str(name or "")).upper()


def _as_list(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = [v.strip() for v in value.split(",")]
    return [str(v) for v in value] if isinstance(value, list) else []


def _as_dict(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


# ── rows ──────────────────────────────────────────────────────────────────────────────────────────────
def transform_school(src):
    emis = str(src.get("emis")).strip() if src.get("emis") not in (None, "") else None
    ext = emis or str(src.get("ext_id") or "").strip() or slug(src.get("name"))
    return {
        "id": niete_id("schools", src["id"]),
        "name": str(src["name"]).strip()[:255],
        "region": GB_REGION,
        "emis": emis or None,
        "source_system": SOURCE_SYSTEM,
        "source_school_id": None,   # BIGINT; the main-Rumi uuid is in the mapping file and in the uuid5 id
        "is_active": True,
        "is_probable_test": False,
        # Not columns: the coach-school key NIETE joins on ('niete:' || emis), and where the row came from.
        "_ext_key": f"niete:{ext}",
        "_source_id": src["id"],
    }


def resolve_leader_school(row, schools_by_id):
    """The main-Rumi GB school a leader_schools / leader_teachers row means, or None.

    main Rumi left school_id empty on most of these rows and keyed them 'sch:gb:<slug of the name>'; the emis on the
    row is sometimes another school's (the Deosai FMO row carries Sun Valley's). So: the school id, then the slug,
    then the emis when exactly one school has it.
    """
    sid = row.get("school_id")
    if sid and sid in schools_by_id:
        return sid
    m = re.match(r"^sch:gb:(.+)$", str(row.get("school_ext_id") or ""))
    if m:
        hits = sorted(s["id"] for s in schools_by_id.values() if slug(s.get("name")) == m.group(1))
        if len(hits) == 1:
            return hits[0]
    emis = str(row.get("emis") or "").strip()
    if emis:
        hits = sorted(s["id"] for s in schools_by_id.values() if str(s.get("emis") or "").strip() == emis)
        if len(hits) == 1:
            return hits[0]
    return None


def transform_user(src, *, school, phone, fake, migrated_at):
    name = str(src.get("name") or "").strip() or " ".join(
        x for x in (str(src.get("first_name") or "").strip(), str(src.get("last_name") or "").strip()) if x)
    lang, locked = clamp_language(src.get("preferred_language"), src.get("language_locked"))
    grades = [g for g in _as_list(src.get("grades_taught")) if g in GRADE_IDS]
    subjects = [s for s in _as_list(src.get("subjects_taught")) if s in SUBJECT_IDS]
    completed = bool(src.get("registration_completed"))
    school_name = school["name"] if school else (str(src.get("school_name") or "").strip() or None)
    return {
        "id": niete_id("users", src["id"]),
        "phone_number": phone,
        "name": name[:100] or None,
        "region": GB_REGION,
        "organization": map_organization(src.get("organization")),
        "role": map_role(src.get("role")),
        "school_id": school["id"] if school else None,
        "school_name": school_name[:200] if school_name else None,
        "country": "PK",
        "preferred_language": lang,
        "language_locked": locked,
        "grades_taught": json.dumps(grades) if grades else None,
        "subjects_taught": subjects,
        "registration_completed": completed,
        "registration_completed_at": src.get("registration_completed_at") if completed else None,
        "registration_state": "completed" if completed else "unregistered",
        "is_test_user": False,
        "source": USER_SOURCE,
        "created_at": src.get("created_at"),
        "preferences": {"main_rumi": {
            "user_id": src["id"], "role": src.get("role"), "organization": src.get("organization"),
            "region": src.get("region"), "school_id": src.get("school_id"), "fake_phone": bool(fake),
            "migrated_at": migrated_at,
        }},
    }


def transform_session(src, user_ids, session_ids):
    """A NIETE coaching_sessions row, or None when its teacher is not migrated."""
    uid = user_ids.get(src.get("user_id"))
    if not uid:
        return None
    analysis = _as_dict(src.get("analysis_data"))
    row = {c: src.get(c) for c in SESSION_COPY}
    obs = src.get("observer_user_id")
    dup = src.get("duplicate_of_session_id")
    row.update({
        "id": niete_id("coaching_sessions", src["id"]),
        "user_id": uid,
        "observer_user_id": user_ids.get(obs) if obs else None,
        "framework": analysis.get("framework") or None,
        "framework_selection_reason": "main_rumi_import",
        "can_resume": False,
        "session_id": None,                 # main Rumi's chat_sessions row is not migrated
        "conversation_state": None,         # main Rumi's flow state, meaningless here
        "linked_lesson_plan_id": None,      # main Rumi's lesson_plans row is not migrated
        "lesson_plan_link_method": None,
        "duplicate_of_session_id": niete_id("coaching_sessions", dup) if dup and dup in session_ids else None,
        "error_stack": None,
    })
    return row


# ── the plan ──────────────────────────────────────────────────────────────────────────────────────────
def plan(source, target, *, fake, migrated_at=None):
    """Everything the run would write, and why anything is left out.

    source: people, schools, leader_schools, leader_teachers, sessions (main-Rumi rows, live ones only).
    target: phones {phone: niete user id}, emis {emis: school id}, canon_name_region {(canon, region): school id}
            for EMIS-less schools, user_ids / school_ids / session_ids already present.
    """
    report = {"school_inferred_from_roster": 0, "school_ambiguous_roster": 0, "users_existing": 0,
              "leader_schools_skipped_leader_not_migrated": 0, "leader_schools_unresolved_school": 0,
              "leader_schools_duplicate": 0, "sessions_skipped_teacher_not_migrated": 0,
              "sessions_observer_link_dropped": 0, "sessions_skipped_status": 0}
    guards = {}

    # schools
    schools_src = {s["id"]: s for s in source["schools"] if s.get("region") == SOURCE_REGION}
    school_rows = {sid: transform_school(s) for sid, s in sorted(schools_src.items())}
    for row in school_rows.values():
        if row["emis"]:
            other = target["emis"].get(row["emis"])
            if other and other != row["id"]:
                guards.setdefault("emis_taken_by_other_school", []).append(
                    {"emis": row["emis"], "school": row["name"], "niete_school_id": other})
        else:
            other = target["canon_name_region"].get((canon(row["name"]), GB_REGION))
            if other and other != row["id"]:
                guards.setdefault("name_taken_by_other_school", []).append(
                    {"school": row["name"], "niete_school_id": other})

    # people: collisions first, so nothing hangs off a person who is not written
    people = sorted(source["people"], key=lambda p: str(p["id"]))
    collisions, kept = [], []
    for p in people:
        nid = niete_id("users", p["id"])
        existing = target["phones"].get(p.get("phone_number"))
        if existing and existing != nid:
            collisions.append({"main_rumi_user_id": p["id"], "niete_user_id": existing,
                               "phone": mask_phone(p.get("phone_number")), "name": p.get("name"),
                               "role": p.get("role"), "organization": p.get("organization")})
            continue
        kept.append(p)
    user_ids = {p["id"]: niete_id("users", p["id"]) for p in kept}
    ours = set(user_ids.values())
    report["users_existing"] = len(ours & set(target["user_ids"]))

    phone_of = {}
    if fake:
        existing_phone = {uid: ph for ph, uid in target["phones"].items() if uid in ours}
        taken = {ph for ph, uid in target["phones"].items() if uid not in ours}
        taken |= {str(p.get("phone_number")) for p in people}
        fresh = assign_fake_phones([p["id"] for p in kept if user_ids[p["id"]] not in existing_phone],
                                   taken=taken | set(existing_phone.values()))
        for p in kept:
            phone_of[p["id"]] = existing_phone.get(user_ids[p["id"]]) or fresh[str(p["id"])]
    else:
        phone_of = {p["id"]: p.get("phone_number") for p in kept}

    # a teacher with no GB school on her row takes the one her leader's roster puts her in, when it is one school
    roster_schools = {}
    for lt in source["leader_teachers"]:
        t = lt.get("teacher_user_id")
        if t in user_ids:
            s = resolve_leader_school(lt, schools_src)
            if s:
                roster_schools.setdefault(t, set()).add(s)
    school_of = {}
    for p in kept:
        if p.get("school_id") in schools_src:
            school_of[p["id"]] = p["school_id"]
        elif p["id"] in roster_schools:
            if len(roster_schools[p["id"]]) == 1:
                school_of[p["id"]] = next(iter(roster_schools[p["id"]]))
                report["school_inferred_from_roster"] += 1
            else:
                report["school_ambiguous_roster"] += 1

    users = []
    for p in kept:
        sid = school_of.get(p["id"])
        users.append(transform_user(p, school=school_rows[sid] if sid else None, phone=phone_of[p["id"]],
                                    fake=fake, migrated_at=migrated_at))
    role_of = {u["preferences"]["main_rumi"]["user_id"]: u["role"] for u in users}

    # a school's principal, when it has exactly one
    principals = {}
    for u in users:
        if u["role"] == "principal" and u["school_id"]:
            principals.setdefault(u["school_id"], []).append(u["id"])
    school_principals = {sid: ids[0] for sid, ids in sorted(principals.items()) if len(ids) == 1}

    # coach → school links, in NIETE's key
    ls_rows, unresolved = {}, []
    ordered = sorted(source["leader_schools"], key=lambda r: (str(r.get("leader_user_id")),
                                                              str(r.get("school_id") or ""),
                                                              str(r.get("school_ext_id") or "")), reverse=True)
    for ls in ordered:
        lid = user_ids.get(ls.get("leader_user_id"))
        if not lid:
            report["leader_schools_skipped_leader_not_migrated"] += 1
            continue
        sid = resolve_leader_school(ls, schools_src)
        if not sid:
            report["leader_schools_unresolved_school"] += 1
            unresolved.append({"leader_main_rumi_id": ls.get("leader_user_id"),
                               "school_ext_id": ls.get("school_ext_id"), "emis": ls.get("emis")})
            continue
        srow = school_rows[sid]
        key = (lid, srow["_ext_key"])
        if key in ls_rows:
            report["leader_schools_duplicate"] += 1
            continue
        ls_rows[key] = {"id": niete_id("leader_schools", f"{ls['leader_user_id']}:{sid}"), "leader_user_id": lid,
                        "source": LEADER_SOURCE, "school_ext_id": srow["_ext_key"], "school_id": srow["id"],
                        "school_name": srow["name"], "emis": srow["emis"], "name_match_quality": "main_rumi_import"}
    leader_schools = [ls_rows[k] for k in sorted(ls_rows)]

    # main Rumi's explicit roster, measured against what NIETE derives (leader_schools x users.school_id)
    held = set(ls_rows)
    covered, not_covered, not_applicable = 0, [], 0
    for lt in source["leader_teachers"]:
        lid, t = user_ids.get(lt.get("leader_user_id")), lt.get("teacher_user_id")
        if not lid or t not in user_ids:
            not_applicable += 1
            continue
        sid = school_of.get(t)
        if sid and (lid, school_rows[sid]["_ext_key"]) in held and role_of.get(t) in PATCH_ROLES:
            covered += 1
        else:
            not_covered.append({"leader_main_rumi_id": lt.get("leader_user_id"), "teacher_main_rumi_id": t,
                                 "teacher_school": school_rows[sid]["name"] if sid else None})
    report["patch_coverage"] = {"covered": covered, "not_covered": len(not_covered), "not_applicable": not_applicable}

    # finished coaching sessions
    live = [s for s in sorted(source["sessions"], key=lambda s: str(s["id"]))]
    written_ids = {s["id"] for s in live if s.get("status") in COACHING_STATUSES and s.get("user_id") in user_ids}
    sessions, frameworks = [], {}
    for s in live:
        if s.get("status") not in COACHING_STATUSES:
            report["sessions_skipped_status"] += 1
            continue
        row = transform_session(s, user_ids, written_ids)
        if row is None:
            report["sessions_skipped_teacher_not_migrated"] += 1
            continue
        if s.get("observer_user_id") and row["observer_user_id"] is None:
            report["sessions_observer_link_dropped"] += 1
        frameworks[row["framework"] or "none"] = frameworks.get(row["framework"] or "none", 0) + 1
        sessions.append(row)
    report["session_frameworks"] = dict(sorted(frameworks.items()))

    report["roles"] = _count((p.get("role"), role_of[p["id"]]) for p in kept)
    report["organizations"] = _count(u["organization"] for u in users)
    report["users_without_school"] = sum(1 for u in users if not u["school_id"])
    report["not_covered_roster_links"] = not_covered
    mapping = {
        "users": {p["id"]: user_ids[p["id"]] for p in kept},
        "schools": {sid: r["id"] for sid, r in school_rows.items()},
        "leader_schools": {r["id"]: {"leader_user_id": r["leader_user_id"], "school_id": r["school_id"]}
                           for r in leader_schools},
        "coaching_sessions": {s["id"]: niete_id("coaching_sessions", s["id"]) for s in live if s["id"] in written_ids},
        "fake_phones": {p["id"]: phone_of[p["id"]] for p in kept} if fake else {},
    }
    return {"schools": [school_rows[k] for k in sorted(school_rows)], "users": users,
            "school_principals": school_principals, "leader_schools": leader_schools,
            "coaching_sessions": sessions, "collisions": collisions, "unresolved_leader_schools": unresolved,
            "guards": guards, "report": report, "mapping": mapping}


def _count(values):
    out = {}
    for v in values:
        k = " -> ".join(str(x) for x in v) if isinstance(v, tuple) else str(v)
        out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items()))


# ── guards around a run ───────────────────────────────────────────────────────────────────────────────
def run_refusal(env, *, fake, commit, confirm_ref=None, go=None):
    """Why this run must not happen, or None."""
    if env not in TARGET_REFS:
        return f"unknown --env {env!r}"
    if env != "prod" and not fake:
        return f"--env {env} needs --fake-phones: a non-production bot must never hold a real teacher's number."
    if env == "prod" and fake:
        return "--fake-phones is for sandbox/staging; production gets the real numbers."
    if env == "prod" and commit and (confirm_ref != TARGET_REFS["prod"] or go != "yes"):
        return ("a production write needs --confirm-ref <prod ref> AND GB_MIGRATION_PROD_GO=yes "
                "(after reviewing a dry run).")
    return None


def ref_of(env):
    m = re.search(r"postgres\.([a-z0-9]{20})[:@]", env.get("DATABASE_URL", "") or "")
    if m:
        return m.group(1)
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", env.get("SUPABASE_URL", "") or "")
    return m.group(1) if m else None


def assert_target(env_name, env):
    """The project ref the env file points at, if it is the one --env names; else stop before any connection."""
    want, have = TARGET_REFS[env_name], ref_of(env)
    if have != want:
        raise SystemExit(f"ABORT: the env file points at '{have}', but --env {env_name} is '{want}'. Nothing opened.")
    return have


def assert_source(dsn):
    """The source must be main Rumi production, never a NIETE database."""
    dsn = str(dsn or "")
    if not dsn:
        raise SystemExit("ABORT: RUMI_SOURCE_DATABASE_URL is not set.")
    if any(ref in dsn for ref in TARGET_REFS.values()):
        raise SystemExit("ABORT: RUMI_SOURCE_DATABASE_URL points at a NIETE database; the source is main Rumi.")
    m = re.search(r"(?:analyst|postgres)\.([a-z0-9]{20})[:@]", dsn)
    if not m or m.group(1) != SOURCE_REF:
        raise SystemExit(f"ABORT: RUMI_SOURCE_DATABASE_URL is not main Rumi ('{SOURCE_REF}').")
    return m.group(1)


# ── files (coaching audio, reports, photos) ───────────────────────────────────────────────────────────
def bucket_and_key(url):
    """(bucket, key) of a path-style R2 URL, or None."""
    try:
        u = urlparse(str(url or ""))
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.netloc.endswith("r2.cloudflarestorage.com"):
        return None
    parts = u.path.lstrip("/").split("/", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]


def rehost_url(url, endpoint, bucket):
    bk = bucket_and_key(url)
    return f"{endpoint.rstrip('/')}/{bucket}/{bk[1]}" if bk else url


def session_files(row):
    """[(field, url)] for every R2 file a session points at: audio, report, plan, debrief, photos."""
    out = [(f, row.get(f)) for f in SESSION_FILE_FIELDS if bucket_and_key(row.get(f))]
    for i, photo in enumerate(row.get("classroom_photos") or []):
        if isinstance(photo, dict) and bucket_and_key(photo.get("url")):
            out.append((f"classroom_photos[{i}]", photo["url"]))
    return out


def rehost_session(row, endpoint, bucket):
    """The same row with every R2 URL pointed at `bucket` (the keys stay as they are)."""
    out = dict(row)
    for f in SESSION_FILE_FIELDS:
        if bucket_and_key(out.get(f)):
            out[f] = rehost_url(out[f], endpoint, bucket)
    photos = []
    for photo in out.get("classroom_photos") or []:
        if isinstance(photo, dict) and bucket_and_key(photo.get("url")):
            photo = {**photo, "url": rehost_url(photo["url"], endpoint, bucket)}
        photos.append(photo)
    out["classroom_photos"] = photos
    return out
