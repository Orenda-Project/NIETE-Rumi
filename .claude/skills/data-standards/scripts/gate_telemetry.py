#!/usr/bin/env python3
"""Record every gate firing — the one thing the enforcement layers never did.

On 2026-09-25 all three gate hooks were triggered by hand, a real block was
produced, and no log anywhere recorded that it happened; the only trace was the
session transcript. Skill *invocations* were counted (hooks/skill-telemetry.py
in the team pack); gate *firings* — the thing that actually enforces — were not.
A gate that cannot be counted cannot be promoted, tuned, or retired on evidence.

One record per firing, pass or block, from every layer:

    gate     commit | live-edit | live-shape | ci | git-hook
    skill    data-standards | data-quality-gate
    result   pass | block | warn | bypass | error | no_change

Where it goes, in order:
  1. ALWAYS appended to <CLAUDE_CONFIG_DIR>/gate-events.jsonl (default ~/.claude),
     so per-machine counts exist with no network at all.
  2. If TELEMETRY_URL + TELEMETRY_KEY resolve (env, then a .env or
     telemetry.defaults found walking up from this file), queued to
     <CLAUDE_CONFIG_DIR>/.gate-events-queue.jsonl and POSTed as a JSON array to
     <TELEMETRY_URL with /events -> /gate-events>, with `Authorization: Bearer`
     and `apikey` — the same wire shape hooks/skill-telemetry.py uses. The POST
     runs in a detached child so a slow network never adds latency to the tool
     call that fired the gate; a failed POST leaves the record queued and the
     next firing retries the whole queue.

What is NEVER sent: file paths, finding text, SQL, prompts. `repo` is the
repository directory's basename only. Free-text values passed in `extra` are
dropped unless they are short tokens — see _clean(). Anything that still looks
like an absolute path is redacted before the record is written anywhere.

Hard rules, because this runs inside every gate:
  * never raise, never block, never print to stdout (hooks own stdout)
  * exit 0 whatever happens
  * TALEEMABAD_TELEMETRY_OFF=1 records nothing at all

CLI (for bash hooks and CI — the Python hooks import emit() directly):
    gate_telemetry.py emit --gate commit --skill data-standards --result block \
        [--standards D1,D5] [--findings N] [--files N] [--via hook|ci|git-hook] \
        [--repo-root PATH] [--duration-ms N] [--sync]
    gate_telemetry.py --flush          # send whatever is queued, then exit
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

SCHEMA_VERSION = 1
MAX_LOG_LINES = 5000
MAX_QUEUE = 500
POST_TIMEOUT = 5
GATES = ("commit", "live-edit", "live-shape", "ci", "git-hook")
RESULTS = ("pass", "block", "warn", "bypass", "error", "no_change")

_TOKEN = re.compile(r"^[\w.:@+-]{1,64}$")
_ABS_PATH = re.compile(r"(^|[\s\"'=:(])(/(?:home|Users|tmp|var|opt|mnt)/|[A-Za-z]:\\)")


def _claude_dir() -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or (Path.home() / ".claude"))


def _log_path() -> Path:
    return _claude_dir() / "gate-events.jsonl"


def _queue_path() -> Path:
    return _claude_dir() / ".gate-events-queue.jsonl"


# --------------------------------------------------------------- endpoint

def parse_dotenv(path: Path) -> dict:
    """KEY=value lines. `KEY=value  # note` is `value`; `KEY=   # comment` is
    blank (the 2026-09-22 pack bug: the comment used to BE the value, failed
    the https check, and every machine that copied .env.example sent nothing).
    A `#` with no space before it is part of the value."""
    out = {}
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if " #" in v:
                v = v.split(" #", 1)[0]
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            out[k.strip()] = v
    except OSError:
        pass
    return out


def resolve_endpoint(search_from: Path | None = None) -> tuple[str, str]:
    """(url, key). Environment first; then .env / telemetry.defaults found by
    walking up from `search_from` (default: this file). Only https is accepted."""
    url = (os.environ.get("TELEMETRY_URL") or "").strip()
    key = (os.environ.get("TELEMETRY_KEY") or "").strip()
    start = Path(search_from) if search_from else Path(__file__).resolve().parent
    for d in [start, *start.parents][:6]:
        if url and key:
            break
        for name in (".env", "telemetry.defaults"):
            f = d / name
            if f.is_file():
                vals = parse_dotenv(f)
                url = url or vals.get("TELEMETRY_URL", "").strip()
                key = key or vals.get("TELEMETRY_KEY", "").strip()
    if not url.startswith("https://"):
        url = ""
    return url, key


def gate_events_url(events_url: str) -> str:
    base = events_url[: -len("/events")] if events_url.endswith("/events") else events_url.rstrip("/")
    return base + "/gate-events"


# --------------------------------------------------------------- record

def _sh(args: list[str], cwd: Path | None) -> str:
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=5)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:  # noqa: BLE001 — telemetry must never raise
        return ""


def _repo_root(repo_root: Path | None) -> Path | None:
    if repo_root:
        return Path(repo_root)
    top = _sh(["git", "rev-parse", "--show-toplevel"], None)
    return Path(top) if top else None


def _actor(root: Path | None) -> str:
    return (os.environ.get("TALEEMABAD_USER_EMAIL")
            or _sh(["git", "config", "user.email"], root)
            or os.environ.get("USER") or os.environ.get("USERNAME") or "unknown")


def _clean(value):
    """Keep numbers/bools/None; keep strings only if they are short tokens.
    Paths and prose are the two things that leak — both fail the token test."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str) and _TOKEN.match(value) and not _ABS_PATH.search(value):
        return value
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return "[redacted]"


def _redact(obj):
    if isinstance(obj, str):
        return "[redacted]" if _ABS_PATH.search(obj) else obj
    if isinstance(obj, dict):
        return {k: _redact(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact(v) for v in obj]
    return obj


def build_record(gate: str, skill: str, result: str, *, standards=(), findings=0, files=0,
                 repo_root: Path | None = None, via: str = "hook", duration_ms=None,
                 extra: dict | None = None) -> dict:
    root = _repo_root(repo_root)
    try:
        cwd_is_repo = bool(root) and Path.cwd().resolve().is_relative_to(root.resolve())
    except Exception:  # noqa: BLE001
        cwd_is_repo = False
    rec = {
        "schema_version": SCHEMA_VERSION,
        "id": uuid.uuid4().hex,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "gate": gate if gate in GATES else "unknown",
        "skill": skill,
        "result": result if result in RESULTS else "unknown",
        "repo": root.name if root else "unknown",
        "branch": _sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], root) or "unknown",
        "actor": _actor(root),
        "device": socket.gethostname() or "unknown",
        "standards": sorted({str(s) for s in standards if s}),
        "findings": int(findings or 0),
        "files": int(files or 0),
        "cwd_is_repo": cwd_is_repo,
        "via": via if via in ("hook", "ci", "git-hook") else "hook",
        "duration_ms": int(duration_ms) if duration_ms is not None else None,
        "source": "taleemabad",
    }
    if extra:
        rec["extra"] = {str(k)[:32]: _clean(v) for k, v in extra.items()}
    return _redact(rec)


# --------------------------------------------------------------- storage + send

def _append(path: Path, record: dict, cap: int) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":")) + "\n")
        if path.stat().st_size > cap * 400:      # trim occasionally, not on every write
            lines = path.read_text(encoding="utf-8").splitlines()
            if len(lines) > cap:
                path.write_text("\n".join(lines[-(cap // 2):]) + "\n", encoding="utf-8")
    except Exception:  # noqa: BLE001 — a full disk must be invisible to the gate
        pass


def _read_queue(path: Path) -> list[dict]:
    try:
        return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    except Exception:  # noqa: BLE001
        return []


def post(url: str, key: str, records: list[dict]) -> bool:
    """One POST, JSON array, both auth headers. True on any 2xx."""
    if not records:
        return True
    try:
        req = urllib.request.Request(
            gate_events_url(url), data=json.dumps(records).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {key}", "apikey": key})
        with urllib.request.urlopen(req, timeout=POST_TIMEOUT) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except Exception:  # noqa: BLE001
        return False


def flush(url: str = "", key: str = "") -> bool:
    """Send the whole queue; clear it only on success."""
    if not url or not key:
        url, key = resolve_endpoint()
    if not url or not key:
        return False
    q = _queue_path()
    records = _read_queue(q)
    if not records:
        return True
    if post(url, key, records[-MAX_QUEUE:]):
        try:
            q.write_text("", encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass
        return True
    return False


def _spawn_flush() -> None:
    try:
        kwargs = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL,
                  "stderr": subprocess.DEVNULL}
        if os.name == "nt":
            kwargs["creationflags"] = 0x00000008 | 0x00000200   # DETACHED | NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--flush"], **kwargs)
    except Exception:  # noqa: BLE001
        pass


def emit(gate: str, skill: str, result: str, *, standards=(), findings=0, files=0,
         repo_root: Path | None = None, via: str = "hook", duration_ms=None,
         extra: dict | None = None, detach: bool = True) -> dict | None:
    """Record one gate firing. Returns the record, or None when switched off.
    Never raises."""
    try:
        if os.environ.get("TALEEMABAD_TELEMETRY_OFF", "").strip():
            return None
        rec = build_record(gate, skill, result, standards=standards, findings=findings,
                           files=files, repo_root=repo_root, via=via,
                           duration_ms=duration_ms, extra=extra)
        _append(_log_path(), rec, MAX_LOG_LINES)
        url, key = resolve_endpoint(repo_root)
        if url and key:
            _append(_queue_path(), rec, MAX_QUEUE)
            if detach:
                _spawn_flush()
            else:
                flush(url, key)
        return rec
    except Exception:  # noqa: BLE001
        return None


# --------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("command", nargs="?", choices=["emit"])
    ap.add_argument("--flush", action="store_true")
    ap.add_argument("--gate", default="unknown")
    ap.add_argument("--skill", default="data-standards")
    ap.add_argument("--result", default="unknown")
    ap.add_argument("--standards", default="")
    ap.add_argument("--findings", type=int, default=0)
    ap.add_argument("--files", type=int, default=0)
    ap.add_argument("--via", default="hook")
    ap.add_argument("--repo-root", default=None)
    ap.add_argument("--duration-ms", type=int, default=None)
    ap.add_argument("--sync", action="store_true", help="POST inline instead of detaching (CI)")
    ap.add_argument("--from-stdin-report", action="store_true",
                    help="read a validate_schema.py JSON report on stdin for standards/findings/files")
    try:
        a = ap.parse_args(argv)
        if a.flush:
            flush()
        elif a.command == "emit":
            standards = [s for s in a.standards.split(",") if s]
            findings, files = a.findings, a.files
            if a.from_stdin_report:
                # Tolerant on purpose: a validator error merges stderr into the same
                # stream the bash gate captures, and that must still produce a record.
                try:
                    rep = json.loads(sys.stdin.read() or "{}")
                except Exception:  # noqa: BLE001
                    rep = {}
                rep = rep if isinstance(rep, dict) else {}
                fs = [f for f in (rep.get("findings") or []) if isinstance(f, dict)]
                standards = standards or [f.get("standard") for f in fs]
                findings = findings or len(fs)
                files = files or len(rep.get("files_checked") or [])
            emit(a.gate, a.skill, a.result, standards=standards,
                 findings=findings, files=files, via=a.via,
                 repo_root=Path(a.repo_root) if a.repo_root else None,
                 duration_ms=a.duration_ms, detach=not a.sync)
    except Exception:  # noqa: BLE001
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
