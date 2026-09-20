#!/usr/bin/env python3
"""tenants_lite.py — the ONE reader for .claude/qa/config/tenants.yaml (bd-9157r).

Every engine script resolves the repo root and every tenant fact through here, so a region name never
appears in engine code. Zero dependencies: PyYAML when present, else yaml_lite beside this file. The
manifest is therefore BLOCK-STYLE YAML ONLY (yaml_lite rejects non-empty flow mappings).

    tenants_lite.py [--root R] --get <key[.sub]>        one value; lists print one per line; null prints nothing
    tenants_lite.py [--root R] --tenant <id> --get <k>
    tenants_lite.py [--root R] --list-tenants | --tenants-for <feature> | --tool <tenant_tools key> | --json

Two layouts. REPO mode: the bot repo carries .claude/qa/config/tenants.yaml. WORKSPACE mode: a workspace above the
bot clone carries .claude/qa/tenants/<name>/config/tenants.yaml (matched by the clone's origin basename); specs and
drivers stay in the bot repo, config/agents/fixtures/ledgers live in that layer dir. `--get layer_dir` says which.

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


TENANTS_DIR_REL = os.path.join(".claude", "qa", "tenants")


def _git_toplevel(d):
    try:
        import subprocess
        out = subprocess.run(["git", "-C", d, "rev-parse", "--show-toplevel"], capture_output=True, text=True)
        return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else None
    except Exception:
        return None


def _origin_basename(repo):
    try:
        import subprocess
        out = subprocess.run(["git", "-C", repo, "remote", "get-url", "origin"], capture_output=True, text=True)
        url = out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        url = ""
    name = url.rstrip("/").rsplit("/", 1)[-1] if url else ""
    return name[:-4] if name.endswith(".git") else name


def _workspace_layer(ws, repo):
    """In a WORKSPACE (a checkout carrying .claude/qa/tenants/), the tenant layer for `repo` (a nested clone) is the
    <ws>/.claude/qa/tenants/<name>/ whose tenants.yaml `repo:` equals the clone's origin basename (fallback: the clone's
    folder name). Returns the layer dir or None."""
    tdir = os.path.join(ws, TENANTS_DIR_REL)
    if not os.path.isdir(tdir) or not repo:
        return None
    want = {_origin_basename(repo), os.path.basename(repo.rstrip(os.sep))}
    want.discard("")
    for name in sorted(os.listdir(tdir)):
        mf = os.path.join(tdir, name, "config", "tenants.yaml")
        if not os.path.isfile(mf):
            continue
        try:
            with open(mf, encoding="utf-8") as fh:
                raw = _yaml().safe_load(fh) or {}
        except Exception:
            continue
        if str(raw.get("repo", "")) in want or name in want:
            return os.path.join(tdir, name)
    return None


def _env_workspace_layer(env):
    """CLAUDE_PROJECT_DIR as a NESTED CLONE: the layer of the first workspace above it that carries one for it, else None."""
    if not env or not os.path.isdir(env):
        return None
    ws = os.path.dirname(os.path.abspath(env).rstrip(os.sep))
    while ws and ws != os.path.dirname(ws):
        if os.path.isdir(os.path.join(ws, TENANTS_DIR_REL)):
            layer = _workspace_layer(ws, env)
            if layer:
                return layer
        ws = os.path.dirname(ws)
    return None


def discover(start=None):
    """→ (repo_root, layer_dir). Two layouts:
      repo mode       the bot repo carries <repo>/.claude/qa/config/tenants.yaml            → layer = <repo>/.claude/qa
      workspace mode  a workspace ABOVE the bot clone carries .claude/qa/tenants/<name>/     → layer = that dir
    Precedence: an explicit guarded start › CLAUDE_PROJECT_DIR (a guarded repo, or a nested clone some workspace above
    it carries a layer for) › walk up from start/cwd. The session's project dir beats the cwd in BOTH layouts: a
    vendored engine's tests run with cwd inside a guarded bot repo, and hooks run from wherever git put them.
    Never resolves symlinks: fixtures symlink the engine in and must resolve to the FIXTURE."""
    env = (os.environ.get("CLAUDE_PROJECT_DIR") or "").strip()
    if start and _has_manifest(os.path.abspath(start)):
        r = os.path.abspath(start); return r, os.path.join(r, ".claude", "qa")
    if _has_manifest(env):
        return env, os.path.join(env, ".claude", "qa")
    layer = _env_workspace_layer(env)
    if layer:
        return env, layer
    # No explicit start: prefer the shell's $PWD when it names the same directory as getcwd(), so a caller working
    # through a symlinked path (/var → /private/var on macOS) gets answers in ITS namespace, not the resolved one.
    if not start:
        pwd = (os.environ.get("PWD") or "").strip()
        start = pwd if pwd and os.path.realpath(pwd) == os.path.realpath(os.getcwd()) else os.getcwd()
    begin = os.path.abspath(start)
    d = begin
    while True:
        if _has_manifest(d):
            return d, os.path.join(d, ".claude", "qa")
        if os.path.isdir(os.path.join(d, TENANTS_DIR_REL)):
            # git reports the clone's REAL path (/private/var/… on macOS); compare real paths, but hand back the clone in
            # the caller's own namespace (d + the tail) — the engine never resolves symlinks for its callers.
            repo_real = _git_toplevel(begin)
            d_real = os.path.realpath(d)
            if repo_real and repo_real != d_real and repo_real.startswith(d_real + os.sep):
                repo = os.path.join(d, os.path.relpath(repo_real, d_real))
                layer = _workspace_layer(d, repo)
                if layer:
                    return repo, layer
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    raise ManifestError("no %s at or above %s, and no workspace .claude/qa/tenants/<name>/ matching it (CLAUDE_PROJECT_DIR=%r)"
                        % (MANIFEST_REL, start or os.getcwd(), env))


def repo_root(start=None):
    """The bot repo's root (see discover)."""
    return discover(start)[0]


def _yaml():
    try:
        import yaml  # type: ignore
        return yaml
    except ImportError:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import yaml_lite  # type: ignore
        return yaml_lite


class Manifest(object):
    def __init__(self, raw, root, layer=None):
        self.raw = raw or {}
        self.root = root
        # where the TENANT LAYER lives: <repo>/.claude/qa (repo mode) or <workspace>/.claude/qa/tenants/<name> (workspace mode)
        self.layer_dir = layer or os.path.join(root, ".claude", "qa")
        self.workspace_mode = os.path.normpath(self.layer_dir) != os.path.normpath(os.path.join(root, ".claude", "qa"))
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

        # Absolute locations. Specs, drivers and the command doc live with the BOT CODE (root); config, agents,
        # fixtures, ledgers and results live with the TENANT LAYER (layer_dir). Pending markers are per clone (root).
        self.spec_abs = os.path.join(root, self.spec_dir)
        self.drivers_abs = os.path.join(root, self.drivers_dir)
        self.command_doc_abs = os.path.join(root, self.command_doc)
        self.config_abs = os.path.join(self.layer_dir, "config")
        self.agents_abs = os.path.join(self.layer_dir, "agents") if not self.raw.get("agents_dir") else os.path.join(root, self.agents_dir)
        self.fixtures_abs = os.path.join(self.layer_dir, "fixtures")
        self.ledgers_abs = os.path.join(self.layer_dir, "ledgers")
        self.results_abs = os.path.join(self.layer_dir, "results")
        self.pending_abs = os.path.join(root, ".claude", ".e2e-pending")
        self.tenants = {}
        for tid, td in self.raw["tenants"].items():
            td = dict(td or {})
            td.setdefault("features", [])
            td.setdefault("chrome", None)
            td["features"] = [str(f) for f in (td["features"] or [])]
            self.tenants[str(tid)] = td
        self.multi = len(self.tenants) > 1

    def tool_path(self, name):
        """Absolute path of a tenant tool (tenant_tools.<name>): under the tenant layer when it exists there
        (workspace mode keeps the niete_* tools beside the manifest), else under the repo; None when unset."""
        rel = self.tenant_tools.get(name)
        if not rel or not isinstance(rel, str):
            return None
        for base in (self.layer_dir, self.root):
            cand = os.path.join(base, rel.replace(".claude/qa/", "", 1)) if base == self.layer_dir else os.path.join(base, rel)
            if os.path.isfile(cand):
                return cand
        return os.path.join(self.root, rel)

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
    _COMPUTED = ("spec_dir", "drivers_dir", "agents_dir", "command_doc", "bot_root", "e2e_scripts", "comment_marker", "multi", "root",
                 "layer_dir", "workspace_mode", "spec_abs", "drivers_abs", "command_doc_abs", "config_abs", "agents_abs",
                 "fixtures_abs", "ledgers_abs", "results_abs", "pending_abs")
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


def load(root=None, layer=None):
    if root and not layer:
        if _has_manifest(root):
            layer = os.path.join(root, ".claude", "qa")
        else:
            root, layer = discover(root)
    elif not root:
        root, layer = discover()
    path = os.path.join(layer, "config", "tenants.yaml")
    if not os.path.isfile(path):
        raise ManifestError("no manifest at %s" % path)
    with open(path, encoding="utf-8") as fh:
        try:
            raw = _yaml().safe_load(fh)
        except Exception as e:  # yaml_lite.ParseError or PyYAML errors
            raise ManifestError("cannot parse %s: %s (the manifest must be block-style YAML)" % (path, e))
    return Manifest(raw, root, layer)


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
            elif x == "--tool":
                mode = "tool"; feat = a.pop(0)
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
        if mode == "tool":
            v = m.tool_path(feat)
            if v is None:
                return 1
            print(v)
            return 0
        if mode == "json":
            print(json.dumps({"root": m.root, "repo": m.repo, "command": m.command, "spec_suite": m.spec_suite,
                              "spec_dir": m.spec_dir, "drivers_dir": m.drivers_dir, "agents_dir": m.agents_dir,
                              "command_doc": m.command_doc, "bot_root": m.bot_root, "e2e_scripts": m.e2e_scripts,
                              "runtime_scope": m.runtime_scope,
                              "branches": m.branches, "keys": m.keys, "db": m.db, "tenant_tools": m.tenant_tools,
                              "comment_marker": m.comment_marker, "multi": m.multi, "tenants": m.tenants,
                              "layer_dir": m.layer_dir, "workspace_mode": m.workspace_mode,
                              "spec_abs": m.spec_abs, "drivers_abs": m.drivers_abs, "command_doc_abs": m.command_doc_abs,
                              "config_abs": m.config_abs, "agents_abs": m.agents_abs, "fixtures_abs": m.fixtures_abs,
                              "ledgers_abs": m.ledgers_abs, "results_abs": m.results_abs, "pending_abs": m.pending_abs}))
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
