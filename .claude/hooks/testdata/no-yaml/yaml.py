# Test shim for data-gates.test.sh: simulates a machine without pyyaml.
raise ImportError("pyyaml deliberately unavailable (data-gates.test.sh)")
