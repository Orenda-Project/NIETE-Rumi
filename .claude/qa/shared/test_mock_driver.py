#!/usr/bin/env python3
"""mock_driver.py — the mock lane's synthetic driver number is PER MACHINE.

Until 2026-09-18 every machine drove the same fixed 923000000001 on the same shared sandbox DB. The run
lock is a local file, so two machines could not see each other and interleaved seeds/reads (bd-yj4e4).
A number derived from the machine keeps each machine on its own driver row, with zero configuration:
the sandbox tooling `ensure`s whatever number it is handed.

Run: python3 .claude/qa/shared/test_mock_driver.py
"""
import os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "mock_driver.py")
LEGACY = "923000000001"
fails = 0
if not os.path.isfile(SCRIPT):
    print("FAIL mock_driver.py does not exist at %s" % SCRIPT); sys.exit(1)
def ok(name): print("PASS " + name)
def bad(name, got, want): 
    global fails; fails += 1; print("FAIL %s: got %r want %r" % (name, got, want))
def check(name, got, want):
    (ok if got == want else lambda n: bad(n, got, want))(name)
def run(env=None, *args):
    e = dict(os.environ); e.pop("E2E_MOCK_DRIVER", None); e.update(env or {})
    p = subprocess.run([sys.executable, SCRIPT, *args], env=e, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

rc, a, _ = run({"E2E_MOCK_DRIVER_MACHINE": "alpha.local|mac"})
check("exits 0", rc, 0)
check("12 digits like a PK E.164 number without +", bool(re.fullmatch(r"\d{12}", a)), True)
check("synthetic prefix 92300 (a range no real subscriber has)", a[:5], "92300")
check("never the legacy shared number", a != LEGACY, True)
rc, a2, _ = run({"E2E_MOCK_DRIVER_MACHINE": "alpha.local|mac"})
check("deterministic: the same machine always gets the same number", a2, a)
rc, b, _ = run({"E2E_MOCK_DRIVER_MACHINE": "beta.local|mac"})
check("a different machine gets a different number", b != a, True)
rc, c, _ = run({"E2E_MOCK_DRIVER_MACHINE": "alpha.local|otheruser"})
check("a different user on the same host gets a different number", c != a, True)
rc, d, _ = run({})
check("with no override it derives from THIS machine (hostname|user) and is still 12 digits", bool(re.fullmatch(r"92300\d{7}", d)), True)
check("…and never the legacy number", d != LEGACY, True)
rc, e_, _ = run({"E2E_MOCK_DRIVER": "923000000777"})
check("E2E_MOCK_DRIVER overrides (a pinned number for a shared CI box)", e_, "923000000777")
rc, _, err = run({"E2E_MOCK_DRIVER": "not-a-number"})
check("a non-digit override is refused (exit 2)", rc, 2)
check("…and says why", "digits" in err, True)
rc, x, _ = run({"E2E_MOCK_DRIVER_MACHINE": "alpha.local|mac"}, "--explain")
check("--explain names the machine key it derived from", "alpha.local|mac" in x, True)
check("--explain still carries the number", a in x, True)
# the 7-digit suffix is mapped into 1000000..9999999 so the legacy 0000001 can never be produced
seen = set()
for i in range(200):
    rc, n, _ = run({"E2E_MOCK_DRIVER_MACHINE": "host%d|u" % i}); seen.add(n)
    if not (1000000 <= int(n[5:]) <= 9999999): bad("suffix in range for host%d" % i, n, "92300[1000000..9999999]"); break
else: ok("200 machines: every suffix in 1000000..9999999")
check("200 machines → 200 distinct numbers (no collision in the sample)", len(seen), 200)
print(); print("%d test(s), %d failed" % (17, fails)); sys.exit(1 if fails else 0)
