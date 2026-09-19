#!/usr/bin/env python3
"""tenants_lite.py — the ONE reader for .claude/qa/config/tenants.yaml (bd-9157r).

Every engine script resolves the repo root and every tenant fact through here, so a region name never
appears in engine code. Zero dependencies: PyYAML when present, else yaml_lite beside this file. The
manifest is therefore BLOCK-STYLE YAML ONLY (yaml_lite rejects non-empty flow mappings).

    tenants_lite.py [--root R] --get <key[.sub]>        one value; lists print one per line; null prints nothing
    tenants_lite.py [--root R] --tenant <id> --get <k>
    tenants_lite.py [--root R] --list-tenants | --tenants-for <feature> | --json

Exit 0 on success, 1 for a manifest problem (message on stderr), 2 for bad usage.
"""
import json
import os
import sys

MANIFEST_REL = os.path.join(".claude", "qa", "config", "tenants.yaml")
REQUIRED = ("repo", "command", "spec_suite", "runtime_scope", "tenants")


class ManifestError(Exception):
    pass


def _has_manifest(d):
    return bool(d) and os.path.isfile(os.path.join(d, MANIFEST_REL))


def repo_root(start=None):
    """CLAUDE_PROJECT_DIR wins when it holds a manifest; otherwise walk up from `start` (default: cwd).

    Never resolves symlinks: a test fixture that symlinks the engine in must resolve to the FIXTURE, and
    a session's CLAUDE_PROJECT_DIR pointing at a manifest-less parent must not shadow the real repo.
    """
    # Precedence: an EXPLICIT start that is itself a guarded repo (`--repo X`) › CLAUDE_PROJECT_DIR › walk up from
    # start/cwd. The explicit repo must win, or a tool analysing a throwaway repo from inside a guarded session
    # silently reads the session's manifest instead (impact.py's own tests caught this once vendored).
    if start and _has_manifest(os.path.abspath(start)):
        return os.path.abspath(start)
    env = (os.environ.get("CLAUDE_PROJECT_DIR") or "").strip()
    if _has_manifest(env):
        return env
    d = os.path.abspath(start or os.getcwd())
    while True:
        if _has_manifest(d):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            raise ManifestError("no %s at or above %s (CLAUDE_PROJECT_DIR=%r holds none either)"
                                % (MANIFEST_REL, start or os.getcwd(), env))
        d = parent


def _yaml():
    try:
        import yaml  # type: ignore
        return yaml
    except ImportError:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import yaml_lite  # type: ignore
        return yaml_lite


class Manifest(object):
    def __init__(self, raw, root):
        self.raw = raw or {}
        self.root = root
        missing = [k for k in REQUIRED if not self.raw.get(k)]
        if missing:
            raise ManifestError("tenants.yaml is missing required key(s): %s" % ", ".join(missing))
        if not isinstance(self.raw["tenants"], dict) or not self.raw["tenants"]:
            raise ManifestError("tenants.yaml: `tenants:` must be a non-empty mapping of id -> fields")

        self.repo = str(self.raw["repo"])
        self.command = str(self.raw["command"])
        self.spec_suite = str(self.raw["spec_suite"])
        self.spec_dir = self.raw.get("spec_dir") or os.path.join("tests", "features", "whatsapp", self.spec_suite)
        self.runtime_scope = [str(x) for x in self.raw["runtime_scope"]]
        self.drivers_dir = self.raw.get("drivers_dir") or os.path.join(".claude", "qa", "shared", "features")
        self.agents_dir = self.raw.get("agents_dir") or os.path.join(".claude", "qa", "agents")
        self.command_doc = self.raw.get("command_doc") or os.path.join(".claude", "commands", self.command.lstrip("/") + ".md")
        # where the bot runtime lives inside the repo — NIETE: `bot/`; the main bot: `.` (whatsapp-bot.js at the root)
        self.bot_root = self.raw.get("bot_root") or "bot"
        # where the bot's own E2E helpers live (mock Graph API, local stack, flow emulator) — default <bot_root>/scripts/e2e
        self.e2e_scripts = self.raw.get("e2e_scripts") or os.path.normpath(os.path.join(self.bot_root, "scripts", "e2e"))

        b = dict(self.raw.get("branches") or {})
        b.setdefault("landing", "main")
        b.setdefault("release", "main")
        triggers = list(b.get("deploy_triggers") or [])
        for x in (b["landing"], b["release"]):
            if x not in triggers:
                triggers.append(x)
        b["deploy_triggers"] = [str(x) for x in triggers]
        b["full_suite_on"] = [str(x) for x in (b.get("full_suite_on") or [b["release"]])]
        self.branches = b

        self.keys = dict(self.raw.get("keys") or {})
        self.db = dict(self.raw.get("db") or {})
        self.tenant_tools = dict(self.raw.get("tenant_tools") or {})
        self.comment_marker = self.raw.get("comment_marker") or "<!-- %s-qa-impact -->" % self.spec_suite

        self.tenants = {}
        for tid, td in self.raw["tenants"].items():
            td = dict(td or {})
            td.setdefault("features", [])
            td.setdefault("chrome", None)
            td["features"] = [str(f) for f in (td["features"] or [])]
            self.tenants[str(tid)] = td
        self.multi = len(self.tenants) > 1

    # ── tenants ────────────────────────────────────────────────────────────────
    def tenant(self, tid):
        if tid not in self.tenants:
            raise ManifestError("unknown tenant %r (known: %s)" % (tid, ", ".join(self.tenants)))
        return self.tenants[tid]

    def tenants_for(self, feature):
        return [tid for tid, td in self.tenants.items() if feature in td["features"]]

    def tenant_features(self, features):
        out = {}
        for f in features:
            for tid in self.tenants_for(f):
                out.setdefault(tid, []).append(f)
        return out

    # ── generic lookup ─────────────────────────────────────────────────────────
    _COMPUTED = ("spec_dir", "drivers_dir", "agents_dir", "command_doc", "bot_root", "e2e_scripts", "comment_marker", "multi", "root")
    _BLOCKS = {"branches": "branches", "keys": "keys", "db": "db", "tenant_tools": "tenant_tools"}

    def get(self, dotted):
        """Dotted lookup with the computed defaults folded in. An OPTIONAL block's missing member is None
        (`tenant_tools.training_db` → None); a genuinely unknown top-level key raises."""
        head, _, rest = dotted.partition(".")
        if head in self._BLOCKS:
            cur = getattr(self, self._BLOCKS[head])
            if not rest:
                return cur
            for part in rest.split("."):
                if not isinstance(cur, dict) or part not in cur:
                    return None
                cur = cur[part]
            return cur
        if not rest and head in self._COMPUTED:
            return getattr(self, head)
        if not rest and head in self.raw:
            return self.raw[head]
        if head in self.raw and isinstance(self.raw[head], dict):
            cur = self.raw[head]
            for part in rest.split("."):
                if not isinstance(cur, dict) or part not in cur:
                    return None
                cur = cur[part]
            return cur
        raise ManifestError("no key %r in tenants.yaml" % dotted)


def load(root=None):
    root = root or repo_root()
    path = os.path.join(root, MANIFEST_REL)
    if not os.path.isfile(path):
        raise ManifestError("no manifest at %s" % path)
    with open(path, encoding="utf-8") as fh:
        try:
            raw = _yaml().safe_load(fh)
        except Exception as e:  # yaml_lite.ParseError or PyYAML errors
            raise ManifestError("cannot parse %s: %s (the manifest must be block-style YAML)" % (path, e))
    return Manifest(raw, root)


def _print(v):
    if isinstance(v, (list, tuple)):
        for x in v:
            print(x)
    elif isinstance(v, dict):
        print(json.dumps(v))
    elif v is None or v is False and False:
        pass
    elif isinstance(v, bool):
        print("true" if v else "false")
    else:
        print(v)


def main(argv):
    root = tenant = key = mode = feat = None
    a = list(argv[1:])
    try:
        while a:
            x = a.pop(0)
            if x == "--root":
                root = a.pop(0)
            elif x == "--tenant":
                tenant = a.pop(0)
            elif x == "--get":
                key = a.pop(0)
            elif x == "--list-tenants":
                mode = "list"
            elif x == "--tenants-for":
                mode = "for"
                feat = a.pop(0)
            elif x == "--json":
                mode = "json"
            elif x in ("-h", "--help"):
                print(__doc__)
                return 0
            else:
                print("tenants_lite: unknown argument %s" % x, file=sys.stderr)
                return 2
    except IndexError:
        print("tenants_lite: an option is missing its value", file=sys.stderr)
        return 2
    try:
        m = load(root or repo_root())
        if mode == "list":
            _print(list(m.tenants))
            return 0
        if mode == "for":
            _print(m.tenants_for(feat))
            return 0
        if mode == "json":
            print(json.dumps({"root": m.root, "repo": m.repo, "command": m.command, "spec_suite": m.spec_suite,
                              "spec_dir": m.spec_dir, "drivers_dir": m.drivers_dir, "agents_dir": m.agents_dir,
                              "command_doc": m.command_doc, "bot_root": m.bot_root, "e2e_scripts": m.e2e_scripts,
                              "runtime_scope": m.runtime_scope,
                              "branches": m.branches, "keys": m.keys, "db": m.db, "tenant_tools": m.tenant_tools,
                              "comment_marker": m.comment_marker, "multi": m.multi, "tenants": m.tenants}))
            return 0
        if key is None:
            print(__doc__)
            return 2
        if tenant:
            td = m.tenant(tenant)
            _print(td.get(key))
        else:
            _print(m.get(key))
        return 0
    except ManifestError as e:
        print("tenants_lite: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
