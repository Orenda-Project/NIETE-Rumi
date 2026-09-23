"""Pure helpers for scripts/schema-ledger-audit.py: which migration files have no schema_versions row."""
import re

_VERSION = re.compile(r"^V(\d+\.\d+\.\d+)__.*\.sql$")


def parse_version(filename):
    m = _VERSION.match(filename)
    return m.group(1) if m else None


def _key(v):
    return tuple(int(p) for p in v.split("."))


def diff_versions(files, applied):
    file_versions = {v for v in (parse_version(f) for f in files) if v}
    applied = set(applied)
    return {
        "missing_from_ledger": sorted(file_versions - applied, key=_key),
        "unknown_in_ledger": sorted(applied - file_versions, key=_key),
    }
