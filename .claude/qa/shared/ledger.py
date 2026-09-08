#!/usr/bin/env python3
"""Frozen-schema validation + append helpers for the E2E ledgers.

Hand-rolled validation (jsonschema is NOT installed). Schemas mirror
docs/superpowers/specs/2026-08-04-e2e-discovery-loop-design.md §5.
runs.jsonl is append-only and never rewritten; a bad row is never appended.
"""
import json
import os

RUN_STATUSES = {"HEALTHY", "DEGRADED", "CRITICAL"}
DRIFT_VERDICTS = {"pending", "intended", "bug"}
ASSERTION_KINDS = {"contract", "copy"}


def verdict(passed, failed=0, blocked=0):
    """The ONE place the run-status rule lives (was hand-copied ~24x across agents/command).
    CRITICAL: any blocked, or 3+ failed. DEGRADED: 1-2 failed. HEALTHY: otherwise.
    Mirrors /niete-e2e §3 and the runs-ledger ternaries in the per-feature agents."""
    if blocked or failed >= 3:
        return "CRITICAL"
    if failed >= 1:
        return "DEGRADED"
    return "HEALTHY"

_RUN_STR = ["run_id", "ts", "surface", "tenant", "env", "method", "feature",
            "status", "evidence_dir"]
_RUN_INT = ["duration_ms", "drift_count", "discovery_count"]
_SUMMARY_INT = ["total", "passed", "failed", "blocked"]
_COVERAGE_INT = ["scenarios", "surface_observed", "uncovered"]


def _require(row, key, typ, probs, prefix=""):
    full = prefix + key
    if key not in row:
        probs.append("missing key: %s" % full)
    elif not isinstance(row[key], typ) or (typ is int and isinstance(row[key], bool)):
        probs.append("%s must be %s" % (full, typ.__name__))


def validate_run(row):
    probs = []
    if not isinstance(row, dict):
        return ["run row must be an object"]
    for k in _RUN_STR:
        _require(row, k, str, probs)
    for k in _RUN_INT:
        _require(row, k, int, probs)
    if row.get("status") not in RUN_STATUSES:
        probs.append("status must be one of %s" % sorted(RUN_STATUSES))
    for name, keys in (("summary", _SUMMARY_INT), ("coverage", _COVERAGE_INT)):
        sub = row.get(name)
        if not isinstance(sub, dict):
            probs.append("missing object: %s" % name)
            continue
        for k in keys:
            _require(sub, k, int, probs, prefix=name + ".")
    return probs


def validate_drift(row):
    probs = []
    if not isinstance(row, dict):
        return ["drift row must be an object"]
    for k in ["run_id", "ts", "scenario", "step", "evidence"]:
        _require(row, k, str, probs)
    if "expected" not in row:
        probs.append("missing key: expected")
    if "actual" not in row:
        probs.append("missing key: actual")
    if row.get("assertion_kind") not in ASSERTION_KINDS:
        probs.append("assertion_kind must be one of %s" % sorted(ASSERTION_KINDS))
    if row.get("verdict") not in DRIFT_VERDICTS:
        probs.append("verdict must be one of %s" % sorted(DRIFT_VERDICTS))
    return probs


def _append(row, path, validator):
    probs = validator(row)
    if probs:
        raise ValueError("; ".join(probs))
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def append_run(row, path):
    _append(row, path, validate_run)


def append_drift(row, path):
    _append(row, path, validate_drift)
