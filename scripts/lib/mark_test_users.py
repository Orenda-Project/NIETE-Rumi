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
