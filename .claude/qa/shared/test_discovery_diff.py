#!/usr/bin/env python3
"""Stdlib assert tests for discovery_diff. Run: python3 test_discovery_diff.py"""
import discovery_diff as dd


def test_slugify():
    assert dd.slugify("list-row", "Report a Problem") == "list-row-report-a-problem"
    assert dd.slugify("button", "View Features!") == "button-view-features"
    assert dd.slugify("command", "/menu") == "command-menu"


def test_diff_surface_flags_only_new():
    observed = [{"kind": "list-row", "label": "Teacher Training"},
                {"kind": "list-row", "label": "Report a Problem"}]
    covered = [{"kind": "list-row", "label": "Teacher Training"}]
    out = dd.diff_surface(observed, covered)
    assert out == [{"kind": "list-row", "label": "Report a Problem"}]


def test_diff_surface_empty_when_all_covered():
    observed = [{"kind": "list-row", "label": "Teacher Training"}]
    covered = [{"kind": "list-row", "label": "Teacher Training"}]
    assert dd.diff_surface(observed, covered) == []


def test_diff_surface_dedups_observed():
    observed = [{"kind": "button", "label": "Open"},
                {"kind": "button", "label": "Open"}]
    assert dd.diff_surface(observed, []) == [{"kind": "button", "label": "Open"}]


def test_new_slugs_filters_existing():
    observed = [{"kind": "list-row", "label": "Report a Problem"}]
    out = dd.new_slugs(observed, [], existing_slugs={"list-row-report-a-problem"})
    assert out == []
    out2 = dd.new_slugs(observed, [], existing_slugs=set())
    assert out2 == [{"kind": "list-row", "label": "Report a Problem",
                     "slug": "list-row-report-a-problem"}]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
