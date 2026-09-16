#!/usr/bin/env python3
"""Pure observed-vs-covered surface diff for the E2E discovery loop.

An `item` is a dict {"kind": str, "label": str}. `kind` is one of
list-row | button | flow-screen | command. Zero dependencies (stdlib only).
"""
import re


def slugify(kind, label):
    """Stable slug for a surface element: '<kind>-<lowercased-label>'.
    Strips leading command slashes and non-alphanumerics → hyphens."""
    base = "%s-%s" % (kind, label)
    base = base.lower().replace("/", " ")
    base = re.sub(r"[^a-z0-9]+", "-", base)
    return base.strip("-")


def _key(item):
    return (item["kind"], item["label"])


def diff_surface(observed, covered):
    """observed items whose (kind,label) is not in covered; deduped, order kept."""
    covered_keys = {_key(c) for c in covered}
    out, seen = [], set()
    for item in observed:
        k = _key(item)
        if k in covered_keys or k in seen:
            continue
        seen.add(k)
        out.append({"kind": item["kind"], "label": item["label"]})
    return out


def new_slugs(observed, covered, existing_slugs):
    """diff_surface results not already recorded (by slug), each with its slug."""
    out = []
    for item in diff_surface(observed, covered):
        slug = slugify(item["kind"], item["label"])
        if slug in existing_slugs:
            continue
        out.append({"kind": item["kind"], "label": item["label"], "slug": slug})
    return out
