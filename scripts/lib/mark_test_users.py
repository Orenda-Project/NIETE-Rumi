"""Pure helpers for scripts/mark-test-users.py: merge a predicate's rows with an allowlist, count per rule."""
from collections import Counter


def build_selection(predicate_rows, allowlist_ids):
    """{user_id: [rule, ...]} — every rule that selected the user, predicate rules first."""
    sel = {}
    for r in predicate_rows:
        sel.setdefault(r["id"], []).append(r["rule"])
    for i in allowlist_ids:
        sel.setdefault(i, []).append("allowlist")
    if not sel:
        raise ValueError("the predicate and the allowlist selected nobody; refusing to run")
    return sel


def rule_counts(selection):
    return dict(Counter(rule for rules in selection.values() for rule in rules))


def parse_allowlist(text):
    """One entry per line; blank lines and '#' comments ignored; surrounding whitespace dropped."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


def check_signed_off(predicate_ids, signed_ids):
    """(ok, missing, extra): does the live predicate select exactly the signed-off list?
    missing = signed but no longer selected; extra = selected now but never signed. Both sorted."""
    signed = {s for s in signed_ids if s}
    if not signed:
        raise ValueError("the signed-off list is empty; refusing to run")
    live = {p for p in predicate_ids if p}
    missing = sorted(signed - live)
    extra = sorted(live - signed)
    return (not missing and not extra, missing, extra)


def drift_lines(missing, extra, limit=10, labels=("signed but no longer selected", "selected but never signed")):
    """Readable lines naming the ids that moved since sign-off (ids only, never names), at most `limit` of each."""
    out = []
    for label, ids in zip(labels, (missing, extra)):
        if ids:
            more = f", and {len(ids) - limit} more" if len(ids) > limit else ""
            out.append(f"{label} ({len(ids)}): {', '.join(ids[:limit])}{more}")
    return out
