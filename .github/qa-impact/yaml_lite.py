#!/usr/bin/env python3
"""yaml_lite — a zero-dependency reader for the YAML subset this QA tooling ships.

WHY THIS EXISTS. `select_e2e.py` read feature-map.yaml with PyYAML, and PyYAML
is not in the standard library. On the laptop that wrote the tooling it was
installed in the user's home-directory site-packages, so nothing noticed; on a
fresh clone on another machine `import yaml` failed and the whole pipeline —
git hook, Claude hook, CI — went silent, because the selector fails silent by
design. Found by scripts/qa/verify-clean-clone.sh on 2026-09-07, which is the
point of that script. A pipeline that must work for any developer on any
machine cannot hinge on a pip install nobody was told about.

PyYAML is still preferred when present (select_e2e tries it first). This is the
fallback, and it deliberately reads ONLY what our config files use:

  key: value                  block mappings, nested by indentation
  - item / - key: value       block sequences of scalars or of mappings
  [a, b, c]                   flow sequences, possibly spanning lines
  {}                          an EMPTY flow mapping (any other `{…}` is rejected)
  "quoted" / 'quoted'         quoted scalars (a `#` inside quotes is not a comment)
  # comment                   full-line and trailing comments
  ints, true/false, null, ~   the usual scalar coercions

Anything else (anchors, multi-line block scalars `|`/`>`, flow mappings `{}`,
tags, multi-documents) raises ParseError with a line number rather than
guessing. test_yaml_lite.py checks that, for every YAML file under .claude/qa,
this parser and PyYAML agree exactly whenever PyYAML is available.
"""
import re


class ParseError(ValueError):
    pass


_INT = re.compile(r"^-?\d+$")
_FLOAT = re.compile(r"^-?\d+\.\d+$")


def _strip_comment(s):
    """Drop a trailing ` # comment`, respecting quotes."""
    out, q = [], None
    for i, ch in enumerate(s):
        if q:
            out.append(ch)
            if ch == q:
                q = None
            continue
        if ch in "\"'":
            q = ch; out.append(ch); continue
        if ch == "#" and (i == 0 or s[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def _scalar(tok, lineno):
    tok = tok.strip()
    if tok == "" or tok in ("~", "null", "Null", "NULL"):
        return None
    if len(tok) >= 2 and tok[0] == tok[-1] and tok[0] in "\"'":
        body = tok[1:-1]
        if tok[0] == '"':
            body = body.replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")
        else:
            body = body.replace("''", "'")
        return body
    if tok in ("true", "True", "TRUE"):
        return True
    if tok in ("false", "False", "FALSE"):
        return False
    if _INT.match(tok):
        return int(tok)
    if _FLOAT.match(tok):
        return float(tok)
    if tok[0] in "{&*!|>%@`":
        raise ParseError("line %d: unsupported YAML construct %r" % (lineno, tok))
    return tok


def _split_flow(body, lineno):
    """Split the inside of `[ ... ]` on commas, respecting quotes."""
    items, cur, q = [], [], None
    for ch in body:
        if q:
            cur.append(ch)
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch; cur.append(ch)
        elif ch == ",":
            items.append("".join(cur)); cur = []
        elif ch in "[]{}":
            raise ParseError("line %d: nested flow collections are not supported" % lineno)
        else:
            cur.append(ch)
    items.append("".join(cur))
    return [_scalar(t, lineno) for t in items if t.strip() != ""]


def _split_key(text, lineno):
    """`key: rest` → (key, rest) or None when the text has no mapping colon."""
    q = None
    for i, ch in enumerate(text):
        if q:
            if ch == q:
                q = None
            continue
        if ch in "\"'":
            q = ch; continue
        if ch == ":" and (i + 1 == len(text) or text[i + 1] in " \t"):
            key = text[:i].strip()
            if len(key) >= 2 and key[0] == key[-1] and key[0] in "\"'":
                key = key[1:-1]
            return key, text[i + 1:].strip()
    return None


class _Reader(object):
    def __init__(self, text):
        self.lines = []  # (indent, content, lineno)
        pending, pend_indent, pend_no, depth = None, 0, 0, 0
        for n, raw in enumerate(text.splitlines(), 1):
            if pending is not None:              # continuing a multi-line flow sequence
                piece = _strip_comment(raw).strip()  # comments go BEFORE joining, or `# x]` eats the bracket
                pending += " " + piece
                depth += piece.count("[") - piece.count("]")
                if depth <= 0:
                    self.lines.append((pend_indent, pending.strip(), pend_no)); pending = None
                continue
            content = _strip_comment(raw)
            if not content.strip():
                continue
            indent = len(raw) - len(raw.lstrip(" "))
            if "\t" in raw[:indent]:
                raise ParseError("line %d: tabs are not allowed for indentation" % n)
            if content.rstrip().endswith("[") or (content.count("[") > content.count("]")):
                pending, pend_indent, pend_no = content.strip(), indent, n
                depth = content.count("[") - content.count("]")
                continue
            self.lines.append((indent, content.strip(), n))
        if pending is not None:
            raise ParseError("line %d: unterminated flow sequence" % pend_no)
        self.i = 0

    def peek(self):
        return self.lines[self.i] if self.i < len(self.lines) else None

    def parse_block(self, indent):
        item = self.peek()
        if item is None:
            return None
        if item[0] < indent:
            return None
        if item[1].startswith("- ") or item[1] == "-":
            return self.parse_seq(item[0])
        if item[1].startswith("["):                  # `key:` with the flow sequence on the next line
            ind, content, lineno = item
            self.i += 1
            if not content.endswith("]"):
                raise ParseError("line %d: unterminated flow sequence" % lineno)
            return _split_flow(content[1:-1], lineno)
        return self.parse_map(item[0])

    def parse_value(self, rest, indent, lineno):
        """The value after `key:` or `- `: inline scalar/flow, or a nested block."""
        if rest == "":
            nxt = self.peek()
            if nxt is not None and nxt[0] > indent:
                return self.parse_block(nxt[0])
            return None
        if rest.startswith("["):
            if not rest.endswith("]"):
                raise ParseError("line %d: unterminated flow sequence" % lineno)
            return _split_flow(rest[1:-1], lineno)
        if rest.replace(" ", "") == "{}":              # the one flow mapping we accept: empty
            return {}
        return _scalar(rest, lineno)

    def parse_map(self, indent):
        out = {}
        while True:
            item = self.peek()
            if item is None or item[0] < indent:
                return out
            ind, content, lineno = item
            if ind > indent:
                raise ParseError("line %d: unexpected indentation" % lineno)
            if content.startswith("- "):
                raise ParseError("line %d: sequence item where a mapping key was expected" % lineno)
            kv = _split_key(content, lineno)
            if kv is None:
                raise ParseError("line %d: expected `key: value`, got %r" % (lineno, content))
            key, rest = kv
            self.i += 1
            out[key] = self.parse_value(rest, indent, lineno)

    def parse_seq(self, indent):
        out = []
        while True:
            item = self.peek()
            if item is None or item[0] < indent:
                return out
            ind, content, lineno = item
            if ind > indent:
                raise ParseError("line %d: unexpected indentation" % lineno)
            if not (content.startswith("- ") or content == "-"):
                return out
            rest = content[1:].strip()
            self.i += 1
            kv = _split_key(rest, lineno) if rest and not rest.startswith(("[", "\"", "'")) else None
            if kv is not None:
                # `- key: value` opens a mapping whose further keys sit at indent+2
                key, r = kv
                first = {key: self.parse_value(r, indent + 2, lineno)}
                nxt = self.peek()
                if nxt is not None and nxt[0] > indent and not nxt[1].startswith("- "):
                    more = self.parse_map(nxt[0])
                    first.update(more)
                out.append(first)
            else:
                out.append(self.parse_value(rest, indent, lineno))


def safe_load(stream):
    text = stream.read() if hasattr(stream, "read") else stream
    if text.startswith("\ufeff"):
        text = text[1:]
    if "\n---" in "\n" + text.lstrip():
        # a document marker is fine at the very top; anything else is multi-doc
        body = text.lstrip()
        if body.startswith("---"):
            text = body[3:]
        if "\n---" in text:
            raise ParseError("multi-document YAML is not supported")
    r = _Reader(text)
    if not r.lines:
        return None
    val = r.parse_block(r.lines[0][0])
    if r.peek() is not None:
        raise ParseError("line %d: trailing content" % r.peek()[2])
    return val
