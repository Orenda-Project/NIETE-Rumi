#!/usr/bin/env python3
"""targets_lite.py — read ONE field of ONE profile out of whatsapp-targets.yaml, no dependencies.

    targets_lite.py <yaml> --where method=mock --get test_driver
    targets_lite.py <yaml> --where env=sandbox --where 'tenant~NIETE' --get method

Why not yaml_lite / PyYAML: the targets file carries flow mappings (`{ role_value: … }`) that
yaml_lite rejects by design, and PyYAML is not guaranteed on a fresh clone. Why not the old regex
over `re.split` blocks: a `method: mock` written in a COMMENT of the previous profile matched first
and returned an empty driver (2026-09-07). This reads only real `key: value` lines, two-space
indented under a `  <profile>:` header, and ignores comments — the subset the profiles actually use.
Prints the value, or nothing; exits 0 either way (callers decide what an empty answer means).
"""
import re
import sys


def profiles(text):
    out, cur = {}, None
    in_profiles = False
    for raw in text.splitlines():
        line = raw.split(" #", 1)[0].rstrip() if not raw.lstrip().startswith("#") else ""
        if not line.strip():
            continue
        if re.match(r"^profiles:\s*$", line):
            in_profiles = True
            continue
        if in_profiles and re.match(r"^\S", line):
            in_profiles = False
        if not in_profiles:
            continue
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if m:
            cur = m.group(1)
            out[cur] = {}
            continue
        m = re.match(r"^    ([A-Za-z0-9_-]+):\s*(.*)$", line)
        if m and cur:
            val = m.group(2).strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            out[cur][m.group(1)] = val
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path, where, get = argv[1], [], None
    i = 2
    while i < len(argv):
        if argv[i] == "--where":
            where.append(argv[i + 1]); i += 2
        elif argv[i] == "--get":
            get = argv[i + 1]; i += 2
        else:
            i += 1
    for name, p in profiles(open(path, encoding="utf-8").read()).items():
        ok = True
        for w in where:
            if "~" in w:
                k, v = w.split("~", 1); ok = ok and v in str(p.get(k, ""))
            else:
                k, v = w.split("=", 1); ok = ok and str(p.get(k, "")) == v
        if ok:
            print(p.get(get, "") if get else name)
            return 0
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
