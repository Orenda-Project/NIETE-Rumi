#!/usr/bin/env python3
"""Minimal Gherkin tag filter for the QA e2e agents.

Usage:
    python3 parse-gherkin.py <file.feature> [--tag @e2e]

Prints JSON: { count, feature_tags, scenarios:[{name, tags, steps}] }.
Feature-level tags (the @tags line directly above `Feature:`) are inherited by
every scenario. With --tag, only scenarios carrying that tag are returned.
Zero dependencies — standard library only.
"""
import sys
import json
import argparse


def parse(path):
    feature_tags = []
    scenarios = []
    pending = []          # tags accumulated since the last block
    cur = None            # current scenario dict

    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            if line.startswith("@"):
                pending += [t for t in line.split() if t.startswith("@")]
                continue
            if line.startswith("Feature:"):
                feature_tags = pending[:]
                pending = []
                continue
            if line.startswith("Scenario:") or line.startswith("Scenario Outline:"):
                if cur:
                    scenarios.append(cur)
                cur = {
                    "name": line.split(":", 1)[1].strip(),
                    "tags": feature_tags + pending,
                    "steps": [],
                }
                pending = []
                continue
            kw = line.split(" ", 1)[0]
            if cur and (kw in ("Given", "When", "Then", "And", "But")
                        or line.startswith("|") or line.startswith("#")):
                cur["steps"].append(line)

    if cur:
        scenarios.append(cur)
    return feature_tags, scenarios


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("feature")
    ap.add_argument("--tag", default=None, help="keep only scenarios carrying this tag (AND-ed with --exclude)")
    ap.add_argument("--exclude", default=None,
                    help="comma-separated tags to drop, e.g. '@destructive,@slow,@wip,@first-use,@config-gated'. "
                         "The /niete-e2e SAFE subset = --tag @e2e --exclude @destructive,@slow,@wip,@first-use,@config-gated")
    args = ap.parse_args()

    feature_tags, scenarios = parse(args.feature)
    if args.tag:
        scenarios = [s for s in scenarios if args.tag in s["tags"]]
    if args.exclude:
        drop = {t.strip() for t in args.exclude.split(",") if t.strip()}
        scenarios = [s for s in scenarios if not (drop & set(s["tags"]))]

    print(json.dumps(
        {"count": len(scenarios), "feature_tags": feature_tags, "scenarios": scenarios},
        indent=2, ensure_ascii=False,
    ))


if __name__ == "__main__":
    main()
